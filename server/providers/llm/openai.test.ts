import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockGetSetting, mockCreate } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockCreate: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}))

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: (...args: unknown[]) => mockCreate(...args),
      },
    }
    constructor(public opts: any) {}
  },
}))

import { openaiProvider, getOpenAIClient } from './openai.js'

beforeEach(() => {
  vi.clearAllMocks()
})

// --- requireKey ---

describe('openaiProvider.requireKey', () => {
  it('throws when api key is not set', () => {
    mockGetSetting.mockReturnValue(undefined)
    expect(() => openaiProvider.requireKey()).toThrow('OPENAI_KEY_NOT_SET')
  })

  it('does not throw when api key is set', () => {
    mockGetSetting.mockReturnValue('sk-test')
    expect(() => openaiProvider.requireKey()).not.toThrow()
  })
})

// --- getOpenAIClient ---

describe('getOpenAIClient', () => {
  it('returns a client', () => {
    mockGetSetting.mockReturnValue('sk-test')
    const client = getOpenAIClient()
    expect(client).toBeDefined()
  })

  it('caches client for same key', () => {
    mockGetSetting.mockReturnValue('sk-test')
    const c1 = getOpenAIClient()
    const c2 = getOpenAIClient()
    expect(c1).toBe(c2)
  })

  it('creates new client when key changes', () => {
    mockGetSetting.mockReturnValue('sk-key-1')
    const c1 = getOpenAIClient()
    mockGetSetting.mockReturnValue('sk-key-2')
    const c2 = getOpenAIClient()
    expect(c1).not.toBe(c2)
  })
})

// --- createMessage ---

describe('openaiProvider.createMessage', () => {
  it('returns text and token counts', async () => {
    mockGetSetting.mockReturnValue('sk-test')
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Hello world' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })

    const result = await openaiProvider.createMessage({
      model: 'gpt-4',
      maxTokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(result.text).toBe('Hello world')
    expect(result.inputTokens).toBe(10)
    expect(result.outputTokens).toBe(5)
  })

  it('includes system instruction as system message', async () => {
    mockGetSetting.mockReturnValue('sk-test')
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    })

    await openaiProvider.createMessage({
      model: 'gpt-4',
      maxTokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }],
      systemInstruction: 'You are a helper',
    })

    const call = mockCreate.mock.calls[0][0]
    expect(call.messages[0]).toEqual({ role: 'system', content: 'You are a helper' })
  })

  it('maps assistant role correctly', async () => {
    mockGetSetting.mockReturnValue('sk-test')
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: {},
    })

    await openaiProvider.createMessage({
      model: 'gpt-4',
      maxTokens: 1024,
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ],
    })

    const call = mockCreate.mock.calls[0][0]
    expect(call.messages[0].role).toBe('user')
    expect(call.messages[1].role).toBe('assistant')
  })

  it('handles empty response', async () => {
    mockGetSetting.mockReturnValue('sk-test')
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
      usage: {},
    })

    const result = await openaiProvider.createMessage({
      model: 'gpt-4',
      maxTokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(result.text).toBe('')
  })
})

// --- streamMessage ---

describe('openaiProvider.streamMessage', () => {
  it('streams text deltas and calls onText', async () => {
    mockGetSetting.mockReturnValue('sk-test')

    const chunks = [
      { choices: [{ delta: { content: 'Hello' } }], usage: null },
      { choices: [{ delta: { content: ' world' } }], usage: null },
      { choices: [{ delta: { content: '' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ]

    mockCreate.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) yield chunk
      },
    })

    const onText = vi.fn()
    const result = await openaiProvider.streamMessage(
      { model: 'gpt-4', maxTokens: 1024, messages: [{ role: 'user', content: 'Hi' }] },
      onText,
    )

    expect(onText).toHaveBeenCalledWith('Hello')
    expect(onText).toHaveBeenCalledWith(' world')
    expect(result.text).toBe('Hello world')
    expect(result.inputTokens).toBe(10)
    expect(result.outputTokens).toBe(5)
  })

  it('requests stream with usage included', async () => {
    mockGetSetting.mockReturnValue('sk-test')
    mockCreate.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {},
    })

    await openaiProvider.streamMessage(
      { model: 'gpt-4', maxTokens: 1024, messages: [{ role: 'user', content: 'Hi' }] },
      vi.fn(),
    )

    const call = mockCreate.mock.calls[0][0]
    expect(call.stream).toBe(true)
    expect(call.stream_options).toEqual({ include_usage: true })
  })
})
