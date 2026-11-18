import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from './__tests__/helpers/testDb.js'
import { buildApp } from './__tests__/helpers/buildApp.js'
import {
  createFeed,
  insertArticle,
  createConversation,
  upsertSetting,
  getDb,
  getConversationById,
  getChatMessages,
  insertChatMessage,
} from './db.js'
import { hashSync } from 'bcryptjs'
import { afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockRunChatTurn } = vi.hoisted(() => ({
  mockRunChatTurn: vi.fn(),
}))

vi.mock('./chat/adapter.js', () => ({
  runChatTurn: (...args: unknown[]) => mockRunChatTurn(...args),
}))

vi.mock('./fetcher.js', () => ({
  fetchAllFeeds: vi.fn(),
  fetchSingleFeed: vi.fn(),
  discoverRssUrl: vi.fn().mockResolvedValue({ rssUrl: null, title: null }),
  summarizeArticle: vi.fn(),
  streamSummarizeArticle: vi.fn(),
  translateArticle: vi.fn(),
  streamTranslateArticle: vi.fn(),
  fetchProgress: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  getFeedState: vi.fn(),
}))

vi.mock('./anthropic.js', () => ({
  anthropic: { messages: { stream: vi.fn(), create: vi.fn() } },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let app: Awaited<ReturnType<typeof buildApp>>
let savedAuthDisabled: string | undefined
const json = { 'content-type': 'application/json' }

function seedUser() {
  const db = getDb()
  const hash = hashSync('testpass', 4)
  db.prepare('INSERT OR REPLACE INTO users (email, password_hash) VALUES (?, ?)').run('test@example.com', hash)
}

function getToken(): string {
  return app.jwt.sign({ email: 'test@example.com', token_version: 0 })
}

function defaultChatMock() {
  mockRunChatTurn.mockImplementation(async (_backend: string, { messages, onEvent }: any) => {
    onEvent({ type: 'text_delta', text: 'Response' })
    onEvent({ type: 'done', usage: { input_tokens: 10, output_tokens: 5 } })
    return {
      allMessages: [
        ...messages,
        { role: 'assistant', content: [{ type: 'text', text: 'Response' }] },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    }
  })
}

function parseSSEEvents(body: string) {
  return body
    .split('\n')
    .filter((l: string) => l.startsWith('data: '))
    .map((l: string) => JSON.parse(l.slice(6)))
}

beforeEach(async () => {
  setupTestDb()
  app = await buildApp()
  vi.clearAllMocks()
  defaultChatMock()
  savedAuthDisabled = process.env.AUTH_DISABLED
  delete process.env.AUTH_DISABLED
})

afterEach(() => {
  if (savedAuthDisabled !== undefined) {
    process.env.AUTH_DISABLED = savedAuthDisabled
  } else {
    delete process.env.AUTH_DISABLED
  }
})

// ---------------------------------------------------------------------------
// Auth requirement
// ---------------------------------------------------------------------------
describe('auth requirement', () => {
  it('returns 401 for POST /api/chat without auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/chat', headers: json, payload: { message: 'hi' } })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for GET /api/chat/conversations without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/chat/conversations' })
    expect(res.statusCode).toBe(401)
  })

})

// ---------------------------------------------------------------------------
// POST /api/chat — article context
// ---------------------------------------------------------------------------
describe('POST /api/chat with article_id', () => {
  it('includes article context in system prompt', async () => {
    seedUser()
    const token = getToken()
    const feed = createFeed({ name: 'TestFeed', url: 'https://example.com' })
    const articleId = insertArticle({
      feed_id: feed.id,
      title: 'Test Article',
      url: 'https://example.com/article',
      published_at: null,
      full_text: 'This is the article body.',
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { message: 'Summarize this', article_id: articleId },
    })
    expect(res.statusCode).toBe(200)

    // Verify article context was passed to the adapter
    const callArgs = mockRunChatTurn.mock.calls[0][1]
    expect(callArgs.system).toContain('Test Article')
    expect(callArgs.system).toContain('This is the article body.')
  })

  it('truncates long article text', async () => {
    seedUser()
    const token = getToken()
    const feed = createFeed({ name: 'F', url: 'https://example.com' })
    const longText = 'x'.repeat(15000)
    const articleId = insertArticle({
      feed_id: feed.id,
      title: 'Long',
      url: 'https://example.com/long',
      published_at: null,
      full_text: longText,
    })

    await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { message: 'test', article_id: articleId },
    })

    const callArgs = mockRunChatTurn.mock.calls[0][1]
    expect(callArgs.system).toContain('(truncated)')
    // Should not contain the full 5000 chars
    expect(callArgs.system.length).toBeLessThan(longText.length)
  })
})

// ---------------------------------------------------------------------------
// POST /api/chat — auto-title
// ---------------------------------------------------------------------------
describe('POST /api/chat — auto-title', () => {
  it('sets conversation title from first message', async () => {
    seedUser()
    const token = getToken()

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { message: 'What is RSS?' },
    })
    expect(res.statusCode).toBe(200)

    const events = parseSSEEvents(res.body)
    const convId = events.find((e: any) => e.type === 'conversation_id')!.conversation_id
    const conv = getConversationById(convId)
    expect(conv!.title).toBe('What is RSS?')
  })

  it('truncates long messages for title', async () => {
    seedUser()
    const token = getToken()
    const longMessage = 'A'.repeat(60)

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { message: longMessage },
    })

    const events = parseSSEEvents(res.body)
    const convId = events.find((e: any) => e.type === 'conversation_id')!.conversation_id
    const conv = getConversationById(convId)
    expect(conv!.title!.length).toBeLessThanOrEqual(51) // 50 + "…"
    expect(conv!.title).toContain('…')
  })

  it('does not overwrite existing title', async () => {
    seedUser()
    const token = getToken()
    createConversation({ id: 'titled-conv', title: 'Original Title' })

    await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { message: 'New message', conversation_id: 'titled-conv' },
    })

    const conv = getConversationById('titled-conv')
    expect(conv!.title).toBe('Original Title')
  })
})

// ---------------------------------------------------------------------------
// POST /api/chat — error handling
// ---------------------------------------------------------------------------
describe('POST /api/chat — error handling', () => {
  it('sends error event and removes user message on adapter failure', async () => {
    seedUser()
    const token = getToken()

    mockRunChatTurn.mockRejectedValue(new Error('LLM API failed'))

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { message: 'fail please' },
    })

    expect(res.statusCode).toBe(200) // SSE always 200
    const events = parseSSEEvents(res.body)
    const errorEvent = events.find((e: any) => e.type === 'error')
    expect(errorEvent).toBeDefined()
    expect(errorEvent.error).toBe('LLM API failed')

    // User message should have been deleted
    const convId = events.find((e: any) => e.type === 'conversation_id')!.conversation_id
    const messages = getChatMessages(convId)
    expect(messages).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /api/chat — provider/model settings
// ---------------------------------------------------------------------------
describe('POST /api/chat — settings', () => {
  it('uses custom chat provider from settings', async () => {
    seedUser()
    const token = getToken()
    upsertSetting('chat.provider', 'gemini')

    await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { message: 'test' },
    })

    expect(mockRunChatTurn).toHaveBeenCalledWith('gemini', expect.anything())
  })

  it('uses custom chat model from settings', async () => {
    seedUser()
    const token = getToken()
    upsertSetting('chat.model', 'gpt-4.1')

    await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { message: 'test' },
    })

    const callArgs = mockRunChatTurn.mock.calls[0][1]
    expect(callArgs.model).toBe('gpt-4.1')
  })
})

// ---------------------------------------------------------------------------
// GET /api/chat/conversations — message_count
// ---------------------------------------------------------------------------
describe('GET /api/chat/conversations — message_count', () => {
  it('counts only text messages, excluding tool_use and tool_result', async () => {
    seedUser()
    const token = getToken()

    // Create a conversation with mixed message types (simulating tool use flow)
    createConversation({ id: 'conv-tool' })
    // 1. user text
    insertChatMessage({ conversation_id: 'conv-tool', role: 'user', content: JSON.stringify([{ type: 'text', text: 'recommend an article' }]) })
    // 2. assistant tool_use (not visible)
    insertChatMessage({ conversation_id: 'conv-tool', role: 'assistant', content: JSON.stringify([{ type: 'tool_use', id: 'call_1', name: 'search_articles', input: {} }]) })
    // 3. user tool_result (not visible)
    insertChatMessage({ conversation_id: 'conv-tool', role: 'user', content: JSON.stringify([{ type: 'tool_result', tool_use_id: 'call_1', content: '[]' }]) })
    // 4. assistant text
    insertChatMessage({ conversation_id: 'conv-tool', role: 'assistant', content: JSON.stringify([{ type: 'text', text: 'Here is an article.' }]) })

    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/conversations',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(200)
    const { conversations } = res.json()
    const conv = conversations.find((c: any) => c.id === 'conv-tool')
    expect(conv).toBeDefined()
    expect(conv.message_count).toBe(2)
  })
})

