import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupTestDb } from './__tests__/helpers/testDb.js'
import { createFeed, enqueueArticleTranslation, getDb, insertArticle, recoverStuckTranslationJobs } from './db.js'

const { mockTranslateArticleFields, mockDetectLanguage } = vi.hoisted(() => ({
  mockTranslateArticleFields: vi.fn(),
  mockDetectLanguage: vi.fn(),
}))

vi.mock('./fetcher/ai.js', () => ({
  detectLanguage: (...args: unknown[]) => mockDetectLanguage(...args),
  translateArticleFields: (...args: unknown[]) => mockTranslateArticleFields(...args),
}))

import { queueFeedTranslations, runTranslationWorkerOnce } from './translation-worker.js'

beforeEach(() => {
  setupTestDb()
  vi.clearAllMocks()
  mockDetectLanguage.mockReturnValue('nl')
})

function seedQueuedArticle(): number {
  const feed = createFeed({
    name: 'Dutch feed',
    url: `https://example.com/${Math.random()}`,
    auto_translate_target: 'en',
  })
  const articleId = insertArticle({
    feed_id: feed.id,
    title: 'Nederlandse titel',
    url: `https://example.com/article/${Math.random()}`,
    published_at: '2026-01-01T00:00:00Z',
    lang: 'nl',
    full_text: 'Dit is de volledige Nederlandse tekst van het artikel.',
  })
  expect(enqueueArticleTranslation(articleId, 'en')).toBe(true)
  return articleId
}

describe('automatic translation worker', () => {
  it('stores translated title, body, excerpt and token usage', async () => {
    const articleId = seedQueuedArticle()
    mockTranslateArticleFields.mockResolvedValue({
      titleTranslated: 'Dutch title',
      fullTextTranslated: 'This is the complete English text of the article.',
      inputTokens: 120,
      outputTokens: 90,
      billingMode: 'openai',
      model: 'gpt-4.1-mini',
    })

    expect(await runTranslationWorkerOnce()).toBe(true)

    const row = getDb().prepare(`
      SELECT title_translated, full_text_translated, excerpt_translated,
             translated_lang, translation_status, translation_input_tokens,
             translation_output_tokens
      FROM articles WHERE id = ?
    `).get(articleId) as Record<string, unknown>
    expect(row.title_translated).toBe('Dutch title')
    expect(row.full_text_translated).toBe('This is the complete English text of the article.')
    expect(row.excerpt_translated).toBe('This is the complete English text of the article.')
    expect(row.translated_lang).toBe('en')
    expect(row.translation_status).toBe('completed')
    expect(row.translation_input_tokens).toBe(120)
    expect(row.translation_output_tokens).toBe(90)
  })

  it('records a retry with backoff without affecting the feed', async () => {
    const articleId = seedQueuedArticle()
    mockTranslateArticleFields.mockRejectedValue(new Error('provider unavailable'))

    expect(await runTranslationWorkerOnce()).toBe(true)

    const row = getDb().prepare(`
      SELECT translation_status, translation_attempts, translation_error,
             translation_next_attempt_at
      FROM articles WHERE id = ?
    `).get(articleId) as Record<string, unknown>
    expect(row.translation_status).toBe('failed')
    expect(row.translation_attempts).toBe(1)
    expect(row.translation_error).toBe('provider unavailable')
    expect(row.translation_next_attempt_at).toBeTruthy()
  })

  it('recovers an in-flight job immediately after a restart', () => {
    const articleId = seedQueuedArticle()
    getDb().prepare("UPDATE articles SET translation_status = 'processing', translation_started_at = datetime('now') WHERE id = ?").run(articleId)

    expect(recoverStuckTranslationJobs()).toBe(1)
    const row = getDb().prepare('SELECT translation_status, translation_started_at FROM articles WHERE id = ?').get(articleId) as Record<string, unknown>
    expect(row.translation_status).toBe('pending')
    expect(row.translation_started_at).toBeNull()
  })

  it('backfills only articles detected as non-English', () => {
    const feed = createFeed({ name: 'Mixed feed', url: 'https://example.com/mixed' })
    insertArticle({ feed_id: feed.id, title: 'Dutch', url: 'https://example.com/mixed/nl', published_at: null, lang: 'en', full_text: 'Dutch body' })
    insertArticle({ feed_id: feed.id, title: 'English', url: 'https://example.com/mixed/en', published_at: null, lang: 'en', full_text: 'English body' })
    mockDetectLanguage.mockReturnValueOnce('nl').mockReturnValueOnce('en')

    const result = queueFeedTranslations(feed.id, 'en')

    expect(result).toEqual({ queued: 1, inspected: 2 })
    const statuses = getDb().prepare('SELECT lang, translation_status FROM articles WHERE feed_id = ? ORDER BY id').all(feed.id) as Array<Record<string, unknown>>
    expect(statuses).toEqual([
      { lang: 'nl', translation_status: 'pending' },
      { lang: 'en', translation_status: null },
    ])
  })
})
