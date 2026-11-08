import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import {
  getArticles,
  getArticleById,
  insertArticle,
  getReadingStats,
  markArticleSeen,
  markArticleLiked,
  recordArticleRead,
  updateArticleContent,
  getRetryArticles,
  getRetryStats,
} from '../db.js'
import { createFeed, getDb } from '../db.js'

beforeEach(() => {
  setupTestDb()
})

function seedFeed(overrides: Partial<Parameters<typeof createFeed>[0]> = {}) {
  return createFeed({ name: 'Test Feed', url: 'https://example.com', ...overrides })
}

function seedArticle(feedId: number, overrides: Partial<Parameters<typeof insertArticle>[0]> = {}) {
  return insertArticle({
    feed_id: feedId,
    title: 'Test Article',
    url: `https://example.com/article/${Math.random()}`,
    published_at: '2025-01-01T00:00:00Z',
    ...overrides,
  })
}

// --- getArticles: read filter and ordering ---

describe('getArticles read filter', () => {
  it('filters by read (read_at IS NOT NULL)', () => {
    const feed = seedFeed()
    const id1 = seedArticle(feed.id, { url: 'https://example.com/1' })
    seedArticle(feed.id, { url: 'https://example.com/2' })

    recordArticleRead(id1)

    const { articles, total } = getArticles({ read: true, limit: 100, offset: 0 })
    expect(articles).toHaveLength(1)
    expect(total).toBe(1)
    expect(articles[0].read_at).not.toBeNull()
  })

  it('returns only read articles when read filter is active', () => {
    const feed = seedFeed()
    const id1 = seedArticle(feed.id, { url: 'https://example.com/1', published_at: '2025-01-01T00:00:00Z' })
    seedArticle(feed.id, { url: 'https://example.com/2', published_at: '2025-01-02T00:00:00Z' })

    recordArticleRead(id1)

    const { articles, total } = getArticles({ read: true, limit: 100, offset: 0 })
    expect(articles).toHaveLength(1)
    expect(total).toBe(1)
    expect(articles[0].read_at).not.toBeNull()
  })

  it('returns only liked articles when liked filter is active', () => {
    const feed = seedFeed()
    const id1 = seedArticle(feed.id, { url: 'https://example.com/1' })
    seedArticle(feed.id, { url: 'https://example.com/2' })

    markArticleLiked(id1, true)

    const { articles, total } = getArticles({ liked: true, limit: 100, offset: 0 })
    expect(articles).toHaveLength(1)
    expect(total).toBe(1)
    expect(articles[0].liked_at).not.toBeNull()
  })
})

// --- getReadingStats ---

describe('getReadingStats', () => {
  it('returns totals for all articles', () => {
    const feed = seedFeed()
    const id1 = seedArticle(feed.id, { url: 'https://example.com/1' })
    seedArticle(feed.id, { url: 'https://example.com/2' })
    seedArticle(feed.id, { url: 'https://example.com/3' })

    markArticleSeen(id1, true)

    const stats = getReadingStats()
    expect(stats.total).toBe(3)
    expect(stats.read).toBe(1)
    expect(stats.unread).toBe(2)
  })

  it('returns by_feed breakdown', () => {
    const feed1 = seedFeed({ name: 'Feed A', url: 'https://a.com' })
    const feed2 = seedFeed({ name: 'Feed B', url: 'https://b.com' })
    seedArticle(feed1.id, { url: 'https://a.com/1' })
    seedArticle(feed1.id, { url: 'https://a.com/2' })
    seedArticle(feed2.id, { url: 'https://b.com/1' })

    const id = insertArticle({ feed_id: feed1.id, title: 'Read', url: 'https://a.com/3', published_at: '2025-01-01T00:00:00Z' })
    markArticleSeen(id, true)

    const stats = getReadingStats()
    expect(stats.by_feed).toHaveLength(2)

    const feedA = stats.by_feed.find(f => f.feed_name === 'Feed A')!
    expect(feedA.total).toBe(3)
    expect(feedA.read).toBe(1)
    expect(feedA.unread).toBe(2)

    const feedB = stats.by_feed.find(f => f.feed_name === 'Feed B')!
    expect(feedB.total).toBe(1)
    expect(feedB.read).toBe(0)
    expect(feedB.unread).toBe(1)
  })

  it('filters by date range', () => {
    const feed = seedFeed()
    seedArticle(feed.id, { url: 'https://example.com/old', published_at: '2024-01-01T00:00:00Z' })
    seedArticle(feed.id, { url: 'https://example.com/new', published_at: '2025-06-01T00:00:00Z' })

    const stats = getReadingStats({ since: '2025-01-01', until: '2025-12-31' })
    expect(stats.total).toBe(1)
  })

  it('returns zeros/nulls when no articles', () => {
    const stats = getReadingStats()
    expect(stats.total).toBe(0)
    // SUM on empty set returns null in SQLite
    expect(stats.read).toBeNull()
    expect(stats.unread).toBeNull()
    expect(stats.by_feed).toHaveLength(0)
  })
})

// --- updateArticleContent edge case ---

describe('updateArticleContent edge cases', () => {
  it('does nothing when no fields provided', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { full_text: 'original' })

    updateArticleContent(id, {})

    const article = getArticleById(id)!
    expect(article.full_text).toBe('original')
  })

  it('updates only specified fields', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { full_text: 'original', excerpt: 'old excerpt' })

    updateArticleContent(id, { excerpt: 'new excerpt' })

    const article = getArticleById(id)!
    expect(article.full_text).toBe('original')
    expect(article.excerpt).toBe('new excerpt')
  })
})

// --- getRetryArticles ---

describe('getRetryArticles', () => {
  it('returns articles with last_error and no full_text', () => {
    const feed = seedFeed()
    seedArticle(feed.id, { url: 'https://example.com/err1', last_error: 'fetch failed' })

    const results = getRetryArticles()
    expect(results).toHaveLength(1)
  })

  it('excludes articles with full_text even if last_error is set', () => {
    const feed = seedFeed()
    seedArticle(feed.id, { url: 'https://example.com/partial', full_text: 'partial content', last_error: 'Turndown failed' })

    const results = getRetryArticles()
    expect(results).toHaveLength(0)
  })

  it('excludes articles where only summary is NULL (full_text exists)', () => {
    const feed = seedFeed()
    seedArticle(feed.id, { url: 'https://example.com/no-summary', full_text: 'body text', last_error: 'summary error' })

    const results = getRetryArticles()
    expect(results).toHaveLength(0)
  })

  it('excludes articles exceeding max retry attempts', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/maxed', last_error: 'fail' })
    getDb().prepare('UPDATE articles SET retry_count = 5 WHERE id = ?').run(id)

    const results = getRetryArticles()
    expect(results).toHaveLength(0)
  })

  it('excludes articles within backoff period', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/backoff', last_error: 'fail' })
    // retry_count = 0 → backoff = 30 min. Set last_retry_at to now (within 30 min)
    getDb().prepare("UPDATE articles SET retry_count = 0, last_retry_at = datetime('now') WHERE id = ?").run(id)

    const results = getRetryArticles()
    expect(results).toHaveLength(0)
  })

  it('includes articles past backoff period', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/ready', last_error: 'fail' })
    // retry_count = 0 → backoff = 30 min. Set last_retry_at to 31 min ago
    getDb().prepare("UPDATE articles SET retry_count = 0, last_retry_at = datetime('now', '-31 minutes') WHERE id = ?").run(id)

    const results = getRetryArticles()
    expect(results).toHaveLength(1)
  })

  it('includes articles with last_retry_at = NULL (first retry)', () => {
    const feed = seedFeed()
    seedArticle(feed.id, { url: 'https://example.com/first', last_error: 'fail' })

    const results = getRetryArticles()
    expect(results).toHaveLength(1)
  })

  it('respects batch limit', () => {
    const feed = seedFeed()
    for (let i = 0; i < 10; i++) {
      seedArticle(feed.id, { url: `https://example.com/batch-${i}`, last_error: 'fail' })
    }

    const results = getRetryArticles()
    expect(results).toHaveLength(3) // RETRY_BATCH_LIMIT default = 3
  })

  it('sorts by retry_count ASC then last_retry_at ASC', () => {
    const feed = seedFeed()
    const id1 = seedArticle(feed.id, { url: 'https://example.com/r2', last_error: 'fail' })
    seedArticle(feed.id, { url: 'https://example.com/r0', last_error: 'fail' })
    const id3 = seedArticle(feed.id, { url: 'https://example.com/r1', last_error: 'fail' })
    // id1: retry_count=2, old retry
    getDb().prepare("UPDATE articles SET retry_count = 2, last_retry_at = datetime('now', '-5 hours') WHERE id = ?").run(id1)
    // id2: retry_count=0, no retry yet
    // id3: retry_count=1, old retry
    getDb().prepare("UPDATE articles SET retry_count = 1, last_retry_at = datetime('now', '-2 hours') WHERE id = ?").run(id3)

    const results = getRetryArticles()
    expect(results.map(r => r.url)).toEqual([
      'https://example.com/r0', // retry_count=0
      'https://example.com/r1', // retry_count=1
      'https://example.com/r2', // retry_count=2
    ])
  })
})

// --- getRetryStats ---

describe('getRetryStats', () => {
  it('returns zeros when no retry candidates exist', () => {
    const stats = getRetryStats()
    expect(stats.eligible).toBe(0)
    expect(stats.backoff_waiting).toBe(0)
    expect(stats.exceeded).toBe(0)
  })

  it('counts eligible, backoff-waiting, and exceeded correctly', () => {
    const feed = seedFeed()
    // eligible: last_error set, no full_text, retry_count=0, no last_retry_at
    seedArticle(feed.id, { url: 'https://example.com/e1', last_error: 'fail' })

    // backoff-waiting: retry_count=1, last_retry_at = now (within 60min backoff)
    const id2 = seedArticle(feed.id, { url: 'https://example.com/bw1', last_error: 'fail' })
    getDb().prepare("UPDATE articles SET retry_count = 1, last_retry_at = datetime('now') WHERE id = ?").run(id2)

    // exceeded: retry_count=5 (>= RETRY_MAX_ATTEMPTS default)
    const id3 = seedArticle(feed.id, { url: 'https://example.com/ex1', last_error: 'fail' })
    getDb().prepare('UPDATE articles SET retry_count = 5 WHERE id = ?').run(id3)

    const stats = getRetryStats()
    expect(stats.eligible).toBe(1)
    expect(stats.backoff_waiting).toBe(1)
    expect(stats.exceeded).toBe(1)
  })
})
