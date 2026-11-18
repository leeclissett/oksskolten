import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from './__tests__/helpers/testDb.js'
import { buildApp } from './__tests__/helpers/buildApp.js'
import {
  createFeed,
  insertArticle,
  createConversation,
  insertChatMessage,
} from './db.js'

// Mock the adapter
vi.mock('./chat/adapter.js', () => ({
  runChatTurn: vi.fn().mockImplementation(async (_backend, { messages, onEvent }) => {
    onEvent({ type: 'text_delta', text: 'Hello' })
    onEvent({ type: 'text_delta', text: ' there!' })
    onEvent({ type: 'done', usage: { input_tokens: 10, output_tokens: 5 } })
    return {
      allMessages: [
        ...messages,
        { role: 'assistant', content: [{ type: 'text', text: 'Hello there!' }] },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    }
  }),
}))

// Mock fetcher (needed by api.ts)
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

// Mock anthropic (needed by tools.ts)
vi.mock('./anthropic.js', () => ({
  anthropic: { messages: { stream: vi.fn(), create: vi.fn() } },
}))

let app: Awaited<ReturnType<typeof buildApp>>
const json = { 'content-type': 'application/json' }

async function getAuthToken(): Promise<string> {
  // Seed user via login
  const bcryptjs = await import('bcryptjs')
  const { getDb } = await import('./db.js')

  // Create user
  const hash = await bcryptjs.hash('testpass', 10)
  getDb().prepare(
    'INSERT OR REPLACE INTO users (email, password_hash) VALUES (?, ?)',
  ).run('test@example.com', hash)

  const res = await app.inject({
    method: 'POST',
    url: '/api/login',
    headers: json,
    payload: { email: 'test@example.com', password: 'testpass' },
  })
  return JSON.parse(res.body).token
}

beforeEach(async () => {
  setupTestDb()
  app = await buildApp()
})

describe('Chat API', () => {
  describe('POST /api/chat', () => {
    it('creates new conversation and streams response', async () => {
      const token = await getAuthToken()

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { ...json, authorization: `Bearer ${token}` },
        payload: { message: 'Hello' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toBe('text/event-stream')

      const lines = res.body.split('\n').filter((l: string) => l.startsWith('data: '))
      const events = lines.map((l: string) => JSON.parse(l.slice(6)))

      // Should have conversation_id event
      expect(events.some((e: any) => e.type === 'conversation_id')).toBe(true)
      // Should have text deltas
      expect(events.some((e: any) => e.type === 'text_delta')).toBe(true)
      // Should have done event
      expect(events.some((e: any) => e.type === 'done')).toBe(true)
    })

    it('continues existing conversation', async () => {
      const token = await getAuthToken()
      createConversation({ id: 'conv-existing', title: 'Test' })

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { ...json, authorization: `Bearer ${token}` },
        payload: { message: 'Continue chat', conversation_id: 'conv-existing' },
      })

      expect(res.statusCode).toBe(200)
      const lines = res.body.split('\n').filter((l: string) => l.startsWith('data: '))
      const events = lines.map((l: string) => JSON.parse(l.slice(6)))
      const convIdEvent = events.find((e: any) => e.type === 'conversation_id')
      expect(convIdEvent.conversation_id).toBe('conv-existing')
    })

    it('returns 404 for non-existent conversation_id', async () => {
      const token = await getAuthToken()

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { ...json, authorization: `Bearer ${token}` },
        payload: { message: 'test', conversation_id: 'nonexistent' },
      })

      expect(res.statusCode).toBe(404)
    })

    it('returns 400 for empty message', async () => {
      const token = await getAuthToken()

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { ...json, authorization: `Bearer ${token}` },
        payload: { message: '' },
      })

      expect(res.statusCode).toBe(400)
    })

  })

  describe('GET /api/chat/conversations', () => {
    it('returns conversation list', async () => {
      const token = await getAuthToken()
      createConversation({ id: 'conv-1', title: 'Chat 1' })
      insertChatMessage({ conversation_id: 'conv-1', role: 'user', content: JSON.stringify([{ type: 'text', text: 'Hi' }]) })
      createConversation({ id: 'conv-2', title: 'Chat 2' })
      insertChatMessage({ conversation_id: 'conv-2', role: 'user', content: JSON.stringify([{ type: 'text', text: 'Hi' }]) })

      const res = await app.inject({
        method: 'GET',
        url: '/api/chat/conversations',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.conversations).toHaveLength(2)
    })

    it('filters by article_id', async () => {
      const token = await getAuthToken()
      const feed = createFeed({ name: 'F', url: 'https://x.com' })
      const articleId = insertArticle({
        feed_id: feed.id,
        title: 'A',
        url: 'https://x.com/a',
        published_at: null,
      })
      createConversation({ id: 'conv-with-article', article_id: articleId })
      insertChatMessage({ conversation_id: 'conv-with-article', role: 'user', content: JSON.stringify([{ type: 'text', text: 'Hi' }]) })
      createConversation({ id: 'conv-without' })
      insertChatMessage({ conversation_id: 'conv-without', role: 'user', content: JSON.stringify([{ type: 'text', text: 'Hi' }]) })

      const res = await app.inject({
        method: 'GET',
        url: `/api/chat/conversations?article_id=${articleId}`,
        headers: { authorization: `Bearer ${token}` },
      })

      const body = JSON.parse(res.body)
      expect(body.conversations).toHaveLength(1)
      expect(body.conversations[0].id).toBe('conv-with-article')
    })
  })

  describe('GET /api/chat/:id/messages', () => {
    it('returns messages for conversation', async () => {
      const token = await getAuthToken()
      createConversation({ id: 'conv-1' })
      insertChatMessage({
        conversation_id: 'conv-1',
        role: 'user',
        content: JSON.stringify([{ type: 'text', text: 'Hello' }]),
      })
      insertChatMessage({
        conversation_id: 'conv-1',
        role: 'assistant',
        content: JSON.stringify([{ type: 'text', text: 'Hi!' }]),
      })

      const res = await app.inject({
        method: 'GET',
        url: '/api/chat/conv-1/messages',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.messages).toHaveLength(2)
    })

    it('returns 404 for non-existent conversation', async () => {
      const token = await getAuthToken()

      const res = await app.inject({
        method: 'GET',
        url: '/api/chat/nonexistent/messages',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(404)
    })
  })

  describe('DELETE /api/chat/:id', () => {
    it('deletes conversation', async () => {
      const token = await getAuthToken()
      createConversation({ id: 'conv-to-delete' })

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/chat/conv-to-delete',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(204)
    })

    it('returns 404 for non-existent conversation', async () => {
      const token = await getAuthToken()

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/chat/nonexistent',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(404)
    })
  })
})
