import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { createConversation, getConversationById, updateConversation } from '../db.js'

// Mock the LLM provider
const mockCreateMessage = vi.fn()
vi.mock('../providers/llm/index.js', () => ({
  getProvider: () => ({
    createMessage: mockCreateMessage,
  }),
}))

import { generateConversationTitle } from './title-generator.js'

beforeEach(() => {
  setupTestDb()
  vi.clearAllMocks()
})

describe('generateConversationTitle', () => {
  it('generates title and updates conversation', async () => {
    createConversation({ id: 'conv-1', article_id: null })
    updateConversation('conv-1', { title: 'fallback' })

    mockCreateMessage.mockResolvedValue({ text: 'Kubernetes記事の推薦', inputTokens: 50, outputTokens: 10 })

    await generateConversationTitle('conv-1', 'おすすめある？', 'Kubernetes関連の記事を...', 'anthropic')

    const conv = getConversationById('conv-1')
    expect(conv?.title).toBe('Kubernetes記事の推薦')
  })

  it('truncates long generated titles to 50 chars', async () => {
    createConversation({ id: 'conv-2', article_id: null })

    mockCreateMessage.mockResolvedValue({ text: 'A'.repeat(100), inputTokens: 50, outputTokens: 10 })

    await generateConversationTitle('conv-2', 'test', 'response', 'anthropic')

    const conv = getConversationById('conv-2')
    expect(conv?.title).toHaveLength(50)
  })

  it('does nothing for unknown provider', async () => {
    createConversation({ id: 'conv-3', article_id: null })

    await generateConversationTitle('conv-3', 'test', 'response', 'unknown-provider')

    expect(mockCreateMessage).not.toHaveBeenCalled()
  })

  it('uses claude-code provider directly for claude-code', async () => {
    createConversation({ id: 'conv-4', article_id: null })

    mockCreateMessage.mockResolvedValue({ text: 'タイトル', inputTokens: 50, outputTokens: 10 })

    await generateConversationTitle('conv-4', 'test', 'response', 'claude-code')

    expect(mockCreateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }),
    )
  })

  it('does not update if generated title is empty', async () => {
    createConversation({ id: 'conv-5', article_id: null })
    updateConversation('conv-5', { title: 'original' })

    mockCreateMessage.mockResolvedValue({ text: '   ', inputTokens: 50, outputTokens: 10 })

    await generateConversationTitle('conv-5', 'test', 'response', 'anthropic')

    const conv = getConversationById('conv-5')
    expect(conv?.title).toBe('original')
  })

  it('does not update if generated title is too short', async () => {
    createConversation({ id: 'conv-6', article_id: null })
    updateConversation('conv-6', { title: 'ハーネスエンジニアリングのブログ出して。' })

    mockCreateMessage.mockResolvedValue({ text: 'ハー', inputTokens: 50, outputTokens: 10 })

    await generateConversationTitle('conv-6', 'test', 'response', 'anthropic')

    const conv = getConversationById('conv-6')
    expect(conv?.title).toBe('ハーネスエンジニアリングのブログ出して。')
  })
})
