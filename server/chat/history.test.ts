import { describe, it, expect } from 'vitest'
import { repairStoredConversation } from './history.js'

describe('repairStoredConversation', () => {
  it('splits mixed assistant tool_use/text messages into valid sequence', () => {
    const repaired = repairStoredConversation([
      {
        id: 1,
        conversation_id: 'conv-1',
        role: 'assistant',
        content: JSON.stringify([
          { type: 'tool_use', id: 'gen-1', name: 'search_articles', input: { query: 'go' } },
          { type: 'text', text: '結果です' },
        ]),
        created_at: '',
      },
      {
        id: 2,
        conversation_id: 'conv-1',
        role: 'user',
        content: JSON.stringify([
          { type: 'tool_result', tool_use_id: 'gen-1', content: '[]' },
        ]),
        created_at: '',
      },
    ])

    expect(repaired.changed).toBe(true)
    expect(repaired.storedMessages).toHaveLength(3)
    expect(repaired.storedMessages[0].content[0].type).toBe('tool_use')
    expect(repaired.storedMessages[1].content[0].type).toBe('tool_result')
    expect(repaired.storedMessages[2].content[0].type).toBe('text')
  })

  it('drops orphan tool_use blocks and duplicate consecutive user messages', () => {
    const repaired = repairStoredConversation([
      {
        id: 1,
        conversation_id: 'conv-1',
        role: 'user',
        content: JSON.stringify([{ type: 'text', text: '10万って書いてあった？' }]),
        created_at: '',
      },
      {
        id: 2,
        conversation_id: 'conv-1',
        role: 'user',
        content: JSON.stringify([{ type: 'text', text: '10万って書いてあった？' }]),
        created_at: '',
      },
      {
        id: 3,
        conversation_id: 'conv-1',
        role: 'assistant',
        content: JSON.stringify([
          { type: 'tool_use', id: 'gen-1', name: 'search_articles', input: { query: '10万' } },
        ]),
        created_at: '',
      },
    ])

    expect(repaired.changed).toBe(true)
    expect(repaired.storedMessages).toHaveLength(1)
    expect(repaired.storedMessages[0].role).toBe('user')
  })
})
