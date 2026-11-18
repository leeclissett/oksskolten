import type { ContentBlock, TextBlock, ToolUseBlock, ToolResultBlock, Message } from './types.js'
import type { ChatMessage } from '../db.js'

interface StoredMessage {
  role: 'user' | 'assistant'
  content: ContentBlock[]
}

function normalizeContent(raw: string): ContentBlock[] {
  const parsed = JSON.parse(raw)
  const blocks = Array.isArray(parsed) ? parsed : [{ type: 'text' as const, text: String(parsed) }]
  return blocks.filter((block): block is ContentBlock => {
    if (!block || typeof block !== 'object' || typeof block.type !== 'string') return false
    if (block.type === 'text') return typeof (block as TextBlock).text === 'string' && (block as TextBlock).text.length > 0
    return true
  })
}

function textOnlyValue(message: StoredMessage): string | null {
  if (message.role !== 'user') return null
  if (message.content.length !== 1) return null
  const [block] = message.content
  if (block.type !== 'text') return null
  return (block as TextBlock).text
}

export function repairStoredConversation(rawMessages: ChatMessage[]): {
  changed: boolean
  storedMessages: StoredMessage[]
  messages: Message[]
} {
  let changed = false
  const expanded: StoredMessage[] = []

  for (const raw of rawMessages) {
    const normalized = normalizeContent(raw.content)
    const message: StoredMessage = { role: raw.role, content: normalized }
    if (JSON.stringify(normalized) !== raw.content) changed = true
    expanded.push(message)
  }

  const repaired: StoredMessage[] = []
  let pendingAssistantMessage: StoredMessage | null = null

  for (let i = 0; i < expanded.length; i++) {
    const current = expanded[i]

    const duplicateText = textOnlyValue(current)
    const prevText = repaired.length > 0 ? textOnlyValue(repaired[repaired.length - 1]) : null
    if (duplicateText && prevText && duplicateText === prevText) {
      changed = true
      continue
    }

    if (current.role === 'assistant') {
      const toolUseBlocks = current.content.filter((block): block is ToolUseBlock => block.type === 'tool_use')
      if (toolUseBlocks.length > 0) {
        const next = expanded[i + 1]
        const nextToolResultIds = new Set(
          next?.role === 'user'
            ? next.content
              .filter((block): block is ToolResultBlock => block.type === 'tool_result')
              .map(block => block.tool_use_id)
            : [],
        )
        const validToolUses = toolUseBlocks.filter(block => nextToolResultIds.has(block.id))
        const nonToolBlocks = current.content.filter(block => block.type !== 'tool_use')

        if (validToolUses.length > 0) {
          repaired.push({ role: 'assistant', content: validToolUses })
          if (nonToolBlocks.length > 0) pendingAssistantMessage = { role: 'assistant', content: nonToolBlocks }
          if (validToolUses.length !== toolUseBlocks.length || nonToolBlocks.length > 0) {
            changed = true
          }
          continue
        }

        if (nonToolBlocks.length > 0) {
          repaired.push({ role: 'assistant', content: nonToolBlocks })
        }
        changed = true
        continue
      }
    }

    if (current.role === 'user') {
      const toolResultBlocks = current.content.filter((block): block is ToolResultBlock => block.type === 'tool_result')
      if (toolResultBlocks.length > 0) {
        const prev = repaired[repaired.length - 1]
        const prevToolUseIds = new Set(
          prev?.role === 'assistant'
            ? prev.content
              .filter((block): block is ToolUseBlock => block.type === 'tool_use')
              .map(block => block.id)
            : [],
        )
        const validToolResults = toolResultBlocks.filter(block => prevToolUseIds.has(block.tool_use_id))
        const nonToolBlocks = current.content.filter(block => block.type !== 'tool_result')

        if (validToolResults.length > 0) {
          repaired.push({ role: 'user', content: [...validToolResults, ...nonToolBlocks] })
          if (validToolResults.length !== toolResultBlocks.length) changed = true
          if (pendingAssistantMessage) {
            repaired.push(pendingAssistantMessage)
            pendingAssistantMessage = null
          }
          continue
        }

        if (nonToolBlocks.length > 0) repaired.push({ role: 'user', content: nonToolBlocks })
        changed = true
        continue
      }
    }

    repaired.push(current)
  }

  if (pendingAssistantMessage) {
    repaired.push(pendingAssistantMessage)
    pendingAssistantMessage = null
  }

  return {
    changed,
    storedMessages: repaired,
    messages: repaired.map(message => ({ role: message.role, content: message.content })),
  }
}
