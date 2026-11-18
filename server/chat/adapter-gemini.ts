import type { Content, FunctionCall, Part } from '@google/genai'
import type { Message, ContentBlock, TextBlock, ToolUseBlock, ToolResultBlock } from './types.js'
import { getGeminiClient } from '../providers/llm/gemini.js'
import { getSetting } from '../db.js'
import { toGeminiTools } from './tools.js'
import type { ChatTurnParams, RunChatTurnResult } from './adapter.js'
import { runToolLoop } from './tool-loop.js'

// --- Neutral → Gemini message conversion ---

function convertMessagesToGemini(messages: Message[]): Content[] {
  const result: Content[] = []

  // Build tool_use_id → name mapping from assistant messages
  const toolIdToName = new Map<string, string>()
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          toolIdToName.set((block as ToolUseBlock).id, (block as ToolUseBlock).name)
        }
      }
    }
  }

  for (const msg of messages) {
    const blocks = Array.isArray(msg.content)
      ? msg.content
      : [{ type: 'text' as const, text: String(msg.content) }]

    if (msg.role === 'user') {
      const toolResults = blocks.filter((b): b is ToolResultBlock => b.type === 'tool_result')
      if (toolResults.length > 0) {
        const parts: Part[] = toolResults.map(tr => ({
          functionResponse: {
            id: tr.tool_use_id,
            name: toolIdToName.get(tr.tool_use_id) || 'unknown',
            response: (() => {
              const parsed = typeof tr.content === 'string' ? JSON.parse(tr.content || '{}') : tr.content
              // Gemini requires response to be an object, not an array
              return Array.isArray(parsed) ? { results: parsed } : parsed
            })(),
          },
        }))
        result.push({ role: 'user', parts })
        continue
      }

      const textParts = blocks.filter((b): b is TextBlock => b.type === 'text').map(b => b.text)
      result.push({
        role: 'user',
        parts: [{ text: textParts.join('\n') || String(msg.content) }],
      })
    } else if (msg.role === 'assistant') {
      const parts: Part[] = []

      for (const block of blocks) {
        if (block.type === 'text' && (block as TextBlock).text) {
          parts.push({ text: (block as TextBlock).text })
        } else if (block.type === 'tool_use') {
          const tu = block as ToolUseBlock
          parts.push({
            functionCall: {
              id: tu.id,
              name: tu.name,
              args: tu.input,
            } as FunctionCall,
          })
        }
      }

      if (parts.length > 0) {
        result.push({ role: 'model', parts })
      }
    }
  }

  return result
}

export async function runGeminiTurn(params: ChatTurnParams): Promise<RunChatTurnResult> {
  if (!getSetting('api_key.gemini')) {
    throw new Error('GEMINI_KEY_NOT_SET')
  }

  const { system, model } = params
  const ai = getGeminiClient()
  const tools = toGeminiTools()

  return runToolLoop(params, async (allMessages, onEvent) => {
    const geminiContents = convertMessagesToGemini(allMessages)

    const stream = await ai.models.generateContentStream({
      model,
      contents: geminiContents,
      config: {
        systemInstruction: system,
        tools,
      },
    })

    // Accumulate response
    let fullText = ''
    const functionCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = []
    let usage = { input_tokens: 0, output_tokens: 0 }

    for await (const chunk of stream) {
      const textDelta = chunk.text ?? ''
      if (textDelta) {
        fullText += textDelta
        onEvent({ type: 'text_delta', text: textDelta })
      }

      if (chunk.candidates?.[0]?.content?.parts) {
        for (const part of chunk.candidates[0].content.parts) {
          if (part.functionCall) {
            const fc = part.functionCall
            const id = (fc as FunctionCall & { id?: string }).id || `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            functionCalls.push({
              id,
              name: fc.name!,
              args: (fc.args ?? {}) as Record<string, unknown>,
            })
            onEvent({ type: 'tool_use_start', name: fc.name!, tool_use_id: id })
          }
        }
      }

      if (chunk.usageMetadata) {
        usage.input_tokens = chunk.usageMetadata.promptTokenCount ?? usage.input_tokens
        usage.output_tokens = chunk.usageMetadata.candidatesTokenCount ?? usage.output_tokens
      }
    }

    // Build neutral content blocks
    const content: ContentBlock[] = []
    if (fullText) {
      content.push({ type: 'text', text: fullText })
    }
    for (const fc of functionCalls) {
      content.push({
        type: 'tool_use',
        id: fc.id,
        name: fc.name,
        input: fc.args,
      })
    }

    return { content, usage }
  })
}
