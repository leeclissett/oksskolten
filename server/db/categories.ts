import { getDb, runNamed } from './connection.js'
import type { Category } from './types.js'

export function getCategories(): Category[] {
  return getDb().prepare('SELECT * FROM categories ORDER BY sort_order ASC, name COLLATE NOCASE ASC').all() as Category[]
}

export function getCategoryById(id: number): Category | undefined {
  return getDb().prepare('SELECT * FROM categories WHERE id = ?').get(id) as Category | undefined
}

export function createCategory(name: string): Category {
  const maxOrder = getDb().prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM categories').get() as { next: number }
  const info = getDb().prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)').run(name, maxOrder.next)
  return getDb().prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid) as Category
}

export function updateCategory(
  id: number,
  data: { name?: string; sort_order?: number; collapsed?: number },
): Category | undefined {
  const cat = getCategoryById(id)
  if (!cat) return undefined

  const fields: string[] = []
  const params: Record<string, unknown> = { id }

  if (data.name !== undefined) {
    fields.push('name = @name')
    params.name = data.name
  }
  if (data.sort_order !== undefined) {
    fields.push('sort_order = @sort_order')
    params.sort_order = data.sort_order
  }
  if (data.collapsed !== undefined) {
    fields.push('collapsed = @collapsed')
    params.collapsed = data.collapsed
  }

  if (fields.length === 0) return cat

  runNamed(`UPDATE categories SET ${fields.join(', ')} WHERE id = @id`, params)
  return getDb().prepare('SELECT * FROM categories WHERE id = ?').get(id) as Category
}

export function deleteCategory(id: number): boolean {
  const result = getDb().prepare('DELETE FROM categories WHERE id = ?').run(id)
  return result.changes > 0
}

export function markAllSeenByCategory(categoryId: number): { updated: number } {
  const result = getDb().prepare(
    "UPDATE articles SET seen_at = datetime('now') WHERE seen_at IS NULL AND purged_at IS NULL AND category_id = ?",
  ).run(categoryId)
  return { updated: result.changes }
}
