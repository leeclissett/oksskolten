import { getDb, runNamed, allNamed } from './connection.js'
import type { Conversation, ChatMessage } from './types.js'

export function createConversation(data: {
  id: string
  title?: string | null
  article_id?: number | null
}): Conversation {
  runNamed(`
    INSERT INTO conversations (id, title, article_id)
    VALUES (@id, @title, @article_id)
  `, {
    id: data.id,
    title: data.title ?? null,
    article_id: data.article_id ?? null,
  })
  return getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(data.id) as Conversation
}

export function getConversations(opts?: {
  article_id?: number
  limit?: number
}): Conversation[] {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (opts?.article_id) {
    conditions.push('c.article_id = @article_id')
    params.article_id = opts.article_id
  }

  conditions.push('EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.id)')

  const where = 'WHERE ' + conditions.join(' AND ')
  const limit = opts?.limit ?? 50

  return allNamed<Conversation & {
    message_count: number
    article_title: string | null
    article_url: string | null
    article_og_image: string | null
    first_user_message: string | null
    first_assistant_preview: string | null
  }>(`
    SELECT c.*,
           (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id AND m.content LIKE '%"type":"text"%') AS message_count,
           a.title AS article_title,
           a.url AS article_url,
           a.og_image AS article_og_image,
           (SELECT content FROM chat_messages m WHERE m.conversation_id = c.id AND m.role = 'user' ORDER BY m.id ASC LIMIT 1) AS first_user_message,
           (SELECT content FROM chat_messages m WHERE m.conversation_id = c.id AND m.role = 'assistant' AND content LIKE '%"type":"text"%' ORDER BY m.id ASC LIMIT 1) AS first_assistant_preview
    FROM conversations c
    LEFT JOIN active_articles a ON c.article_id = a.id
    ${where}
    ORDER BY c.updated_at DESC
    LIMIT ${Number(limit)}
  `, params)
}

export function getConversationById(id: string): Conversation | undefined {
  return getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation | undefined
}

export function updateConversation(
  id: string,
  data: { title?: string },
): Conversation | undefined {
  const conv = getConversationById(id)
  if (!conv) return undefined

  const fields: string[] = ["updated_at = datetime('now')"]
  const params: Record<string, unknown> = { id }

  if (data.title !== undefined) {
    fields.push('title = @title')
    params.title = data.title
  }

  runNamed(`UPDATE conversations SET ${fields.join(', ')} WHERE id = @id`, params)
  return getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation
}

export function deleteConversation(id: string): boolean {
  const result = getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id)
  return result.changes > 0
}

// --- Chat message queries ---

export function insertChatMessage(data: {
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
}): ChatMessage {
  return getDb().transaction(() => {
    const info = runNamed(`
      INSERT INTO chat_messages (conversation_id, role, content)
      VALUES (@conversation_id, @role, @content)
    `, data)
    getDb().prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(data.conversation_id)
    return getDb().prepare('SELECT * FROM chat_messages WHERE id = ?').get(info.lastInsertRowid) as ChatMessage
  })()
}

export function getChatMessages(conversationId: string): ChatMessage[] {
  return getDb().prepare(
    'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC',
  ).all(conversationId) as ChatMessage[]
}

export function deleteChatMessage(id: number): boolean {
  return getDb().transaction(() => {
    const message = getDb().prepare('SELECT conversation_id FROM chat_messages WHERE id = ?').get(id) as { conversation_id: string } | undefined
    if (!message) return false
    const result = getDb().prepare('DELETE FROM chat_messages WHERE id = ?').run(id)
    if (result.changes > 0) {
      getDb().prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(message.conversation_id)
    }
    return result.changes > 0
  })()
}

export function replaceChatMessages(
  conversationId: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): void {
  const tx = getDb().transaction(() => {
    getDb().prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(conversationId)
    const insertSql = `
      INSERT INTO chat_messages (conversation_id, role, content)
      VALUES (@conversation_id, @role, @content)
    `
    for (const message of messages) {
      runNamed(insertSql, {
        conversation_id: conversationId,
        role: message.role,
        content: message.content,
      })
    }
    getDb().prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversationId)
  })
  tx()
}
