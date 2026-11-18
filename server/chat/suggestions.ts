import { getDb } from '../db.js'

interface Suggestion {
  /** i18n key for the suggestion text */
  key: string
  /** Interpolation params (e.g. { count: 55, category: 'Tech' }) */
  params?: Record<string, string | number>
}

export function generateSuggestions(): Suggestion[] {
  const db = getDb()
  const hour = new Date().getHours()

  const suggestions: Suggestion[] = []

  // Time-based suggestions
  if (hour >= 5 && hour < 10) {
    suggestions.push({ key: 'suggestion.morning.newArticles' })
    suggestions.push({ key: 'suggestion.morning.readToday' })
  } else if (hour >= 10 && hour < 18) {
    suggestions.push({ key: 'suggestion.daytime.highlights' })
  } else {
    suggestions.push({ key: 'suggestion.evening.review' })
  }

  // Unread count suggestion
  const unreadRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    WHERE a.seen_at IS NULL AND f.type != 'clip'
  `).get() as { cnt: number }
  if (unreadRow.cnt > 50) {
    suggestions.push({ key: 'suggestion.unreadMany', params: { count: unreadRow.cnt } })
  } else if (unreadRow.cnt > 0) {
    suggestions.push({ key: 'suggestion.unreadSome' })
  }

  // Top category suggestion
  const topCategory = db.prepare(`
    SELECT c.name
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    JOIN categories c ON f.category_id = c.id
    WHERE a.read_at IS NOT NULL AND f.type != 'clip'
    GROUP BY c.id
    ORDER BY COUNT(*) DESC
    LIMIT 1
  `).get() as { name: string } | undefined
  if (topCategory) {
    suggestions.push({ key: 'suggestion.topCategory', params: { category: topCategory.name } })
  }

  // Generic suggestions
  suggestions.push({ key: 'suggestion.weeklyDigest' })
  suggestions.push({ key: 'suggestion.trending' })
  suggestions.push({ key: 'suggestion.surprise' })

  return suggestions
}
