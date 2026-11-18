import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock Anthropic SDK ---

const mockCreate = vi.fn()
const mockStream = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: (...args: unknown[]) => mockCreate(...args),
        stream: (...args: unknown[]) => mockStream(...args),
      }
    },
  }
})

// Need fresh imports after mock
let anthropicProvider: typeof import('./anthropic.js')['anthropicProvider']
let getAnthropicClient: typeof import('./anthropic.js')['getAnthropicClient']
let upsertSettingFresh: typeof import('../../db.js')['upsertSetting']

beforeEach(async () => {
  mockCreate.mockReset()
  mockStream.mockReset()
  vi.resetModules()

  // Re-import db module AFTER resetModules so it gets fresh state
  const dbMod = await import('../../db.js')
  const { _resetDb, runMigrations } = await import('../../db/connection.js')
  _resetDb(':memory:')
  runMigrations()
  upsertSettingFresh = dbMod.upsertSetting

  const mod = await import('./anthropic.js')
  anthropicProvider = mod.anthropicProvider
  getAnthropicClient = mod.getAnthropicClient
})

describe('anthropicProvider', () => {
  describe('requireKey', () => {
    it('throws when API key is not set', () => {
      expect(() => anthropicProvider.requireKey()).toThrow('ANTHROPIC_KEY_NOT_SET')
    })

    it('does not throw when API key is set', () => {
      upsertSettingFresh('api_key.anthropic', 'sk-ant-test')
      expect(() => anthropicProvider.requireKey()).not.toThrow()
    })
  })

  describe('name', () => {
    it('is "anthropic"', () => {
      expect(anthropicProvider.name).toBe('anthropic')
    })
  })

  describe('createMessage', () => {
    it('calls messages.create and returns result', async () => {
      upsertSettingFresh('api_key.anthropic', 'sk-ant-test')

      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello from Claude' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })

      const result = await anthropicProvider.createMessage({
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 1024,
        messages: [{ role: 'user', content: 'Hi' }],
        systemInstruction: 'Be helpful',
      })

      expect(result.text).toBe('Hello from Claude')
      expect(result.inputTokens).toBe(10)
      expect(result.outputTokens).toBe(5)

      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: 'Be helpful',
        messages: [{ role: 'user', content: 'Hi' }],
      }))
    })

    it('omits system when not provided', async () => {
      upsertSettingFresh('api_key.anthropic', 'sk-ant-test')

      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 5, output_tokens: 3 },
      })

      await anthropicProvider.createMessage({
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 512,
        messages: [{ role: 'user', content: 'Hello' }],
      })

      const call = mockCreate.mock.calls[0][0]
      expect(call).not.toHaveProperty('system')
    })

    it('throws on non-text response', async () => {
      upsertSettingFresh('api_key.anthropic', 'sk-ant-test')

      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'tu-1' }],
        usage: { input_tokens: 5, output_tokens: 3 },
      })

      await expect(anthropicProvider.createMessage({
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 512,
        messages: [{ role: 'user', content: 'Hello' }],
      })).rejects.toThrow('Unexpected response type')
    })
  })

  describe('streamMessage', () => {
    it('streams text deltas and returns final result', async () => {
      upsertSettingFresh('api_key.anthropic', 'sk-ant-test')

      const textCallbacks: Array<(delta: string) => void> = []
      mockStream.mockReturnValue({
        on: (event: string, cb: (delta: string) => void) => {
          if (event === 'text') textCallbacks.push(cb)
        },
        finalMessage: () => Promise.resolve({
          content: [{ type: 'text', text: 'Hello world' }],
          usage: { input_tokens: 8, output_tokens: 4 },
        }),
      })

      const onText = vi.fn()
      const resultPromise = anthropicProvider.streamMessage(
        {
          model: 'claude-haiku-4-5-20251001',
          maxTokens: 1024,
          messages: [{ role: 'user', content: 'Hi' }],
        },
        onText,
      )

      // Simulate streaming
      for (const cb of textCallbacks) {
        cb('Hello ')
        cb('world')
      }

      const result = await resultPromise

      expect(onText).toHaveBeenCalledWith('Hello ')
      expect(onText).toHaveBeenCalledWith('world')
      expect(result.text).toBe('Hello world')
      expect(result.inputTokens).toBe(8)
      expect(result.outputTokens).toBe(4)
    })

    it('passes system instruction when provided', async () => {
      upsertSettingFresh('api_key.anthropic', 'sk-ant-test')

      mockStream.mockReturnValue({
        on: vi.fn(),
        finalMessage: () => Promise.resolve({
          content: [{ type: 'text', text: 'OK' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      })

      await anthropicProvider.streamMessage(
        {
          model: 'claude-haiku-4-5-20251001',
          maxTokens: 512,
          messages: [{ role: 'user', content: 'Test' }],
          systemInstruction: 'Summarize',
        },
        vi.fn(),
      )

      expect(mockStream).toHaveBeenCalledWith(expect.objectContaining({
        system: 'Summarize',
      }))
    })

    it('throws on non-text final message', async () => {
      upsertSettingFresh('api_key.anthropic', 'sk-ant-test')

      mockStream.mockReturnValue({
        on: vi.fn(),
        finalMessage: () => Promise.resolve({
          content: [{ type: 'tool_use', id: 'tu-1' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      })

      await expect(anthropicProvider.streamMessage(
        {
          model: 'claude-haiku-4-5-20251001',
          maxTokens: 512,
          messages: [{ role: 'user', content: 'Test' }],
        },
        vi.fn(),
      )).rejects.toThrow('Unexpected response type')
    })
  })
})

describe('getAnthropicClient', () => {
  it('returns cached client for same key', () => {
    upsertSettingFresh('api_key.anthropic', 'sk-ant-key1')
    const client1 = getAnthropicClient()
    const client2 = getAnthropicClient()
    expect(client1).toBe(client2)
  })

  it('creates new client when key changes', () => {
    upsertSettingFresh('api_key.anthropic', 'sk-ant-key1')
    const client1 = getAnthropicClient()

    upsertSettingFresh('api_key.anthropic', 'sk-ant-key2')
    const client2 = getAnthropicClient()

    expect(client1).not.toBe(client2)
  })
})
