import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { createFeed, insertArticle, markArticleSeen, createCategory, getDb } from '../db.js'
import { generateSuggestions } from './suggestions.js'

beforeEach(() => {
  setupTestDb()
})

function seedFeed(overrides: Partial<Parameters<typeof createFeed>[0]> = {}) {
  return createFeed({ name: 'Test Feed', url: 'https://example.com', ...overrides })
}

describe('generateSuggestions', () => {
  it('returns suggestions with key field', () => {
    const suggestions = generateSuggestions()
    expect(suggestions.length).toBeGreaterThan(0)
    for (const s of suggestions) {
      expect(s).toHaveProperty('key')
      expect(s.key).toBeTruthy()
    }
  })

  it('includes unreadMany key with count param when unread > 50', () => {
    const feed = seedFeed()
    for (let i = 0; i < 55; i++) {
      insertArticle({ feed_id: feed.id, title: `A${i}`, url: `https://example.com/${i}`, published_at: '2025-01-01T00:00:00Z' })
    }

    const suggestions = generateSuggestions()
    const unreadSuggestion = suggestions.find(s => s.key === 'suggestion.unreadMany')
    expect(unreadSuggestion).toBeDefined()
    expect(unreadSuggestion!.params).toEqual({ count: 55 })
  })

  it('includes topCategory key with category param', () => {
    const cat = createCategory('Tech')
    const feed = seedFeed({ category_id: cat.id })
    const id = insertArticle({ feed_id: feed.id, title: 'Art', url: 'https://example.com/a', published_at: '2025-01-01T00:00:00Z' })
    markArticleSeen(id, true)
    getDb().prepare("UPDATE articles SET read_at = datetime('now') WHERE id = ?").run(id)

    const suggestions = generateSuggestions()
    const catSuggestion = suggestions.find(s => s.key === 'suggestion.topCategory')
    expect(catSuggestion).toBeDefined()
    expect(catSuggestion!.params).toEqual({ category: 'Tech' })
  })

  it('includes time-based suggestion keys', () => {
    const suggestions = generateSuggestions()
    const timeKeys = ['suggestion.morning.newArticles', 'suggestion.morning.readToday', 'suggestion.daytime.highlights', 'suggestion.evening.review']
    const hasTimeSuggestion = suggestions.some(s => timeKeys.includes(s.key))
    expect(hasTimeSuggestion).toBe(true)
  })

  it('always includes generic suggestion keys', () => {
    const suggestions = generateSuggestions()
    const genericKeys = ['suggestion.weeklyDigest', 'suggestion.trending', 'suggestion.surprise']
    const found = suggestions.filter(s => genericKeys.includes(s.key))
    expect(found.length).toBe(3)
  })
})
