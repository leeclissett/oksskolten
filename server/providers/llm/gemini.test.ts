import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockGetSetting, mockGenerateContent, mockGenerateContentStream } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockGenerateContent: vi.fn(),
  mockGenerateContentStream: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = {
      generateContent: (...args: unknown[]) => mockGenerateContent(...args),
      generateContentStream: (...args: unknown[]) => mockGenerateContentStream(...args),
    }
    constructor(public opts: any) {}
  },
}))

import { geminiProvider, getGeminiClient } from './gemini.js'

beforeEach(() => {
  vi.clearAllMocks()
})

// --- requireKey ---

describe('geminiProvider.requireKey', () => {
  it('throws when api key is not set', () => {
    mockGetSetting.mockReturnValue(undefined)
    expect(() => geminiProvider.requireKey()).toThrow('GEMINI_KEY_NOT_SET')
  })

  it('does not throw when api key is set', () => {
    mockGetSetting.mockReturnValue('gemini-key')
    expect(() => geminiProvider.requireKey()).not.toThrow()
  })
})

// --- getGeminiClient ---

describe('getGeminiClient', () => {
  it('returns a client', () => {
    mockGetSetting.mockReturnValue('gemini-key')
    const client = getGeminiClient()
    expect(client).toBeDefined()
  })

  it('caches client for same key', () => {
    mockGetSetting.mockReturnValue('gemini-key')
    const c1 = getGeminiClient()
    const c2 = getGeminiClient()
    expect(c1).toBe(c2)
  })

  it('creates new client when key changes', () => {
    mockGetSetting.mockReturnValue('key-1')
    const c1 = getGeminiClient()
    mockGetSetting.mockReturnValue('key-2')
    const c2 = getGeminiClient()
    expect(c1).not.toBe(c2)
  })
})

// --- createMessage ---

describe('geminiProvider.createMessage', () => {
  it('returns text and token counts', async () => {
    mockGetSetting.mockReturnValue('gemini-key')
    mockGenerateContent.mockResolvedValue({
      text: 'Generated text',
      usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
    })

    const result = await geminiProvider.createMessage({
      model: 'gemini-pro',
      maxTokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.text).toBe('Generated text')
    expect(result.inputTokens).toBe(15)
    expect(result.outputTokens).toBe(8)
  })

  it('maps assistant role to model', async () => {
    mockGetSetting.mockReturnValue('gemini-key')
    mockGenerateContent.mockResolvedValue({
      text: 'ok',
      usageMetadata: {},
    })

    await geminiProvider.createMessage({
      model: 'gemini-pro',
      maxTokens: 1024,
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ],
    })

    const call = mockGenerateContent.mock.calls[0][0]
    expect(call.contents[0].role).toBe('user')
    expect(call.contents[1].role).toBe('model')
  })

  it('passes systemInstruction when provided', async () => {
    mockGetSetting.mockReturnValue('gemini-key')
    mockGenerateContent.mockResolvedValue({
      text: 'ok',
      usageMetadata: {},
    })

    await geminiProvider.createMessage({
      model: 'gemini-pro',
      maxTokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }],
      systemInstruction: 'Be helpful',
    })

    const call = mockGenerateContent.mock.calls[0][0]
    expect(call.config.systemInstruction).toBe('Be helpful')
  })

  it('omits systemInstruction when not provided', async () => {
    mockGetSetting.mockReturnValue('gemini-key')
    mockGenerateContent.mockResolvedValue({
      text: 'ok',
      usageMetadata: {},
    })

    await geminiProvider.createMessage({
      model: 'gemini-pro',
      maxTokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const call = mockGenerateContent.mock.calls[0][0]
    expect(call.config.systemInstruction).toBeUndefined()
  })

  it('handles empty text response', async () => {
    mockGetSetting.mockReturnValue('gemini-key')
    mockGenerateContent.mockResolvedValue({
      text: undefined,
      usageMetadata: {},
    })

    const result = await geminiProvider.createMessage({
      model: 'gemini-pro',
      maxTokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(result.text).toBe('')
  })
})

// --- streamMessage ---

describe('geminiProvider.streamMessage', () => {
  it('streams text deltas and calls onText', async () => {
    mockGetSetting.mockReturnValue('gemini-key')

    const chunks = [
      { text: 'Hello', usageMetadata: null },
      { text: ' world', usageMetadata: null },
      { text: '', usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6 } },
    ]

    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) yield chunk
      },
    })

    const onText = vi.fn()
    const result = await geminiProvider.streamMessage(
      { model: 'gemini-pro', maxTokens: 1024, messages: [{ role: 'user', content: 'Hi' }] },
      onText,
    )

    expect(onText).toHaveBeenCalledWith('Hello')
    expect(onText).toHaveBeenCalledWith(' world')
    expect(result.text).toBe('Hello world')
    expect(result.inputTokens).toBe(12)
    expect(result.outputTokens).toBe(6)
  })

  it('maps roles correctly in stream request', async () => {
    mockGetSetting.mockReturnValue('gemini-key')
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {},
    })

    await geminiProvider.streamMessage(
      {
        model: 'gemini-pro',
        maxTokens: 1024,
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hey' },
        ],
      },
      vi.fn(),
    )

    const call = mockGenerateContentStream.mock.calls[0][0]
    expect(call.contents[1].role).toBe('model')
  })
})
