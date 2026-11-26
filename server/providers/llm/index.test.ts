import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LLMMessageParams } from './provider.js'

// ---------------------------------------------------------------------------
// Hoisted mocks (accessible inside vi.mock factories)
// ---------------------------------------------------------------------------

const {
  mockGetSetting,
  mockAnthropicCreate,
  mockAnthropicStream,
  mockChatCreate,
  mockGenerateContent,
  mockGenerateContentStream,
} = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockAnthropicCreate: vi.fn(),
  mockAnthropicStream: vi.fn(),
  mockChatCreate: vi.fn(),
  mockGenerateContent: vi.fn(),
  mockGenerateContentStream: vi.fn(),
}))

vi.mock('../../db.js', () => ({ getSetting: (...args: unknown[]) => mockGetSetting(...args) }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: (...args: unknown[]) => mockAnthropicCreate(...args),
      stream: (...args: unknown[]) => mockAnthropicStream(...args),
    }
  },
}))

vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: (...args: unknown[]) => mockChatCreate(...args),
      },
    }
  },
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: (...args: unknown[]) => mockGenerateContent(...args),
      generateContentStream: (...args: unknown[]) => mockGenerateContentStream(...args),
    }
  },
}))

// ---------------------------------------------------------------------------
// Shared params
// ---------------------------------------------------------------------------

const baseParams: LLMMessageParams = {
  model: 'test-model',
  maxTokens: 100,
  messages: [{ role: 'user', content: 'hello' }],
}

const paramsWithSystem: LLMMessageParams = {
  ...baseParams,
  systemInstruction: 'You are a helpful assistant.',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSetting.mockReturnValue('test-key')
})

// ---------------------------------------------------------------------------
// getProvider (index.ts)
// ---------------------------------------------------------------------------
describe('getProvider', () => {
  it('returns registered providers', async () => {
    const { getProvider } = await import('./index.js')
    expect(getProvider('anthropic').name).toBe('anthropic')
    expect(getProvider('gemini').name).toBe('gemini')
    expect(getProvider('openai').name).toBe('openai')
    expect(getProvider('claude-code').name).toBe('claude-code')
  })

  it('throws for unknown provider', async () => {
    const { getProvider } = await import('./index.js')
    expect(() => getProvider('llama')).toThrow('Unknown LLM provider: llama')
  })
})

// ---------------------------------------------------------------------------
// anthropicProvider
// ---------------------------------------------------------------------------
describe('anthropicProvider', () => {
  it('requireKey throws when key is not set', async () => {
    mockGetSetting.mockReturnValue(null)
    const { anthropicProvider } = await import('./anthropic.js')
    expect(() => anthropicProvider.requireKey()).toThrow('ANTHROPIC_KEY_NOT_SET')
  })

  it('requireKey passes when key is set', async () => {
    const { anthropicProvider } = await import('./anthropic.js')
    expect(() => anthropicProvider.requireKey()).not.toThrow()
  })

  it('createMessage returns text and usage', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Hello!' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    })

    const { anthropicProvider } = await import('./anthropic.js')
    const result = await anthropicProvider.createMessage(baseParams)

    expect(result).toEqual({ text: 'Hello!', inputTokens: 10, outputTokens: 5 })
    expect(mockAnthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'test-model', max_tokens: 100 }),
    )
  })

  it('createMessage passes system instruction', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    const { anthropicProvider } = await import('./anthropic.js')
    await anthropicProvider.createMessage(paramsWithSystem)

    expect(mockAnthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'You are a helpful assistant.' }),
    )
  })

  it('createMessage omits system when not provided', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    const { anthropicProvider } = await import('./anthropic.js')
    await anthropicProvider.createMessage(baseParams)

    const callArgs = mockAnthropicCreate.mock.calls[0][0]
    expect(callArgs).not.toHaveProperty('system')
  })

  it('createMessage throws on non-text response', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'x' }],
      usage: { input_tokens: 0, output_tokens: 0 },
    })

    const { anthropicProvider } = await import('./anthropic.js')
    await expect(anthropicProvider.createMessage(baseParams)).rejects.toThrow('Unexpected response type')
  })

  it('streamMessage collects text via onText and returns result', async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {}
    const mockStreamObj = {
      on(event: string, fn: (...args: unknown[]) => void) {
        handlers[event] = fn
        return mockStreamObj
      },
      finalMessage: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'streamed' }],
        usage: { input_tokens: 8, output_tokens: 3 },
      }),
    }
    mockAnthropicStream.mockReturnValue(mockStreamObj)

    const { anthropicProvider } = await import('./anthropic.js')
    const deltas: string[] = []

    const resultPromise = anthropicProvider.streamMessage(baseParams, (d) => deltas.push(d))

    handlers['text']?.('str')
    handlers['text']?.('eamed')

    const result = await resultPromise
    expect(result).toEqual({ text: 'streamed', inputTokens: 8, outputTokens: 3 })
    expect(deltas).toEqual(['str', 'eamed'])
  })
})

// ---------------------------------------------------------------------------
// openaiProvider
// ---------------------------------------------------------------------------
describe('openaiProvider', () => {
  it('requireKey throws when key is not set', async () => {
    mockGetSetting.mockReturnValue(null)
    const { openaiProvider } = await import('./openai.js')
    expect(() => openaiProvider.requireKey()).toThrow('OPENAI_KEY_NOT_SET')
  })

  it('createMessage returns text and usage', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'Hi there' } }],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    })

    const { openaiProvider } = await import('./openai.js')
    const result = await openaiProvider.createMessage(baseParams)

    expect(result).toEqual({ text: 'Hi there', inputTokens: 12, outputTokens: 4 })
  })

  it('createMessage prepends system instruction', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    const { openaiProvider } = await import('./openai.js')
    await openaiProvider.createMessage(paramsWithSystem)

    expect(mockChatCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          { role: 'system', content: 'You are a helpful assistant.' },
        ]),
      }),
    )
  })

  it('createMessage handles missing usage', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'text' } }],
      usage: undefined,
    })

    const { openaiProvider } = await import('./openai.js')
    const result = await openaiProvider.createMessage(baseParams)
    expect(result.inputTokens).toBe(0)
    expect(result.outputTokens).toBe(0)
  })

  it('streamMessage collects chunks and returns result', async () => {
    const chunks = [
      { choices: [{ delta: { content: 'He' } }], usage: null },
      { choices: [{ delta: { content: 'llo' } }], usage: null },
      { choices: [{ delta: { content: '' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } },
    ]

    mockChatCreate.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        for (const c of chunks) yield c
      },
    })

    const { openaiProvider } = await import('./openai.js')
    const deltas: string[] = []
    const result = await openaiProvider.streamMessage(baseParams, (d) => deltas.push(d))

    expect(result.text).toBe('Hello')
    expect(deltas).toEqual(['He', 'llo'])
    expect(result.inputTokens).toBe(5)
    expect(result.outputTokens).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// geminiProvider
// ---------------------------------------------------------------------------
describe('geminiProvider', () => {
  it('requireKey throws when key is not set', async () => {
    mockGetSetting.mockReturnValue(null)
    const { geminiProvider } = await import('./gemini.js')
    expect(() => geminiProvider.requireKey()).toThrow('GEMINI_KEY_NOT_SET')
  })

  it('createMessage returns text and usage', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'Gemini says hi',
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
    })

    const { geminiProvider } = await import('./gemini.js')
    const result = await geminiProvider.createMessage(baseParams)

    expect(result).toEqual({ text: 'Gemini says hi', inputTokens: 7, outputTokens: 3 })
  })

  it('createMessage maps role "assistant" to "model"', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'ok',
      usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 },
    })

    const { geminiProvider } = await import('./gemini.js')
    await geminiProvider.createMessage({
      ...baseParams,
      messages: [{ role: 'assistant', content: 'prev' }, { role: 'user', content: 'next' }],
    })

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: [
          { role: 'model', parts: [{ text: 'prev' }] },
          { role: 'user', parts: [{ text: 'next' }] },
        ],
      }),
    )
  })

  it('createMessage passes system instruction in config', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'ok',
      usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 },
    })

    const { geminiProvider } = await import('./gemini.js')
    await geminiProvider.createMessage(paramsWithSystem)

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          systemInstruction: 'You are a helpful assistant.',
        }),
      }),
    )
  })

  it('createMessage handles missing usageMetadata', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok', usageMetadata: undefined })

    const { geminiProvider } = await import('./gemini.js')
    const result = await geminiProvider.createMessage(baseParams)
    expect(result.inputTokens).toBe(0)
    expect(result.outputTokens).toBe(0)
  })

  it('streamMessage collects chunks and returns result', async () => {
    const chunks = [
      { text: 'Gem', usageMetadata: null },
      { text: 'ini', usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 2 } },
    ]

    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        for (const c of chunks) yield c
      },
    })

    const { geminiProvider } = await import('./gemini.js')
    const deltas: string[] = []
    const result = await geminiProvider.streamMessage(baseParams, (d) => deltas.push(d))

    expect(result.text).toBe('Gemini')
    expect(deltas).toEqual(['Gem', 'ini'])
    expect(result.inputTokens).toBe(6)
    expect(result.outputTokens).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// claudeCodeProvider
// ---------------------------------------------------------------------------
describe('claudeCodeProvider', () => {
  it('requireKey does not throw (CLI auth)', async () => {
    const { claudeCodeProvider } = await import('./claude-code.js')
    expect(() => claudeCodeProvider.requireKey()).not.toThrow()
  })
})
