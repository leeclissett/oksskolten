import type Anthropic from '@anthropic-ai/sdk'
import type { ContentBlock } from './types.js'
import { anthropic } from '../providers/llm/anthropic.js'
import { getSetting } from '../db.js'
import { toAnthropicTools } from './tools.js'
import type { ChatTurnParams, RunChatTurnResult } from './adapter.js'
import { runToolLoop, CHAT_MAX_TOKENS } from './tool-loop.js'

function toAnthropicMessages(messages: import('./types.js').Message[]): Anthropic.MessageParam[] {
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content as Anthropic.MessageParam['content'],
  }))
}

function toNeutralContent(blocks: Anthropic.ContentBlock[]): ContentBlock[] {
  const result: ContentBlock[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      result.push({ type: 'text' as const, text: block.text })
    } else if (block.type === 'tool_use') {
      result.push({
        type: 'tool_use' as const,
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      })
    }
    // Skip unsupported block types (thinking, etc.)
  }
  return result
}

export async function runAnthropicTurn(params: ChatTurnParams): Promise<RunChatTurnResult> {
  if (!getSetting('api_key.anthropic')) {
    throw new Error('ANTHROPIC_KEY_NOT_SET')
  }

  const { system, model } = params
  const tools = toAnthropicTools()

  return runToolLoop(params, async (allMessages, onEvent) => {
    const apiMessages = toAnthropicMessages(allMessages)
    const stream = anthropic.messages.stream({
      model,
      max_tokens: CHAT_MAX_TOKENS,
      system,
      tools,
      messages: apiMessages,
    })

    stream.on('contentBlock', (block: Anthropic.ContentBlock) => {
      if (block.type === 'tool_use') {
        onEvent({ type: 'tool_use_start', name: block.name, tool_use_id: block.id })
      }
    })

    stream.on('text', (delta: string) => {
      onEvent({ type: 'text_delta', text: delta })
    })

    const finalMessage = await stream.finalMessage()
    const content = toNeutralContent(finalMessage.content)

    // Only include tool_use blocks when stop_reason indicates tool execution
    if (finalMessage.stop_reason !== 'tool_use') {
      return {
        content: content.filter(b => b.type !== 'tool_use'),
        usage: finalMessage.usage,
      }
    }

    return { content, usage: finalMessage.usage }
  })
}
