import Anthropic from '@anthropic-ai/sdk'
import { getSetting } from '../../db.js'
import type { LLMProvider, LLMMessageParams, LLMStreamResult } from './provider.js'

// --- Cached client (moved from server/anthropic.ts) ---

let cachedKey = ''
let cachedClient: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  const key = getSetting('api_key.anthropic') || ''
  if (cachedClient && key === cachedKey) return cachedClient
  cachedKey = key
  cachedClient = new Anthropic({ apiKey: key })
  return cachedClient
}

export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop: string | symbol) {
    return getAnthropicClient()[prop as keyof Anthropic]
  },
})

// --- LLMProvider implementation ---

export const anthropicProvider: LLMProvider = {
  name: 'anthropic',

  requireKey() {
    if (!getSetting('api_key.anthropic')) {
      throw new Error('ANTHROPIC_KEY_NOT_SET')
    }
  },

  async createMessage(params: LLMMessageParams): Promise<LLMStreamResult> {
    const message = await anthropic.messages.create({
      model: params.model,
      max_tokens: params.maxTokens,
      ...(params.systemInstruction ? { system: params.systemInstruction } : {}),
      messages: params.messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    })
    const block = message.content[0]
    if (block.type !== 'text') throw new Error('Unexpected response type')
    return {
      text: block.text,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    }
  },

  async streamMessage(params: LLMMessageParams, onText: (delta: string) => void): Promise<LLMStreamResult> {
    const stream = anthropic.messages.stream({
      model: params.model,
      max_tokens: params.maxTokens,
      ...(params.systemInstruction ? { system: params.systemInstruction } : {}),
      messages: params.messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    })

    stream.on('text', (delta) => onText(delta))

    const finalMessage = await stream.finalMessage()
    const block = finalMessage.content[0]
    if (block.type !== 'text') throw new Error('Unexpected response type')

    return {
      text: block.text,
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    }
  },
}
