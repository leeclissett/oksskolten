import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import {
  getArticles,
  getArticleById,
  insertArticle,
  getRetentionStats,
  purgeExpiredArticles,
  getExistingArticleUrls,
  markArticleSeen,
  markArticleBookmarked,
  markArticleLiked,
  getReadingStats,
  getRetryArticles,
  searchArticles,
  getLikeCount,
  getBookmarkCount,
  createFeed,
  getDb,
} from '../db.js'

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
    full_text: 'Some content here',
    summary: 'A summary',
    excerpt: 'An excerpt',
    ...overrides,
  })
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

// Helper: directly set seen_at to a past date for retention eligibility
function setSeenAt(id: number, date: string) {
  getDb().prepare('UPDATE articles SET seen_at = ? WHERE id = ?').run(date, id)
}

// Helper: directly set fetched_at to a past date for unread retention eligibility
function setFetchedAt(id: number, date: string) {
  getDb().prepare('UPDATE articles SET fetched_at = ? WHERE id = ?').run(date, id)
}

// --- getRetentionStats ---

describe('getRetentionStats', () => {
  it('returns zeros when no articles are eligible', () => {
    const feed = seedFeed()
    seedArticle(feed.id, { url: 'https://example.com/1' })

    const stats = getRetentionStats(90, 180)
    expect(stats.readEligible).toBe(0)
    expect(stats.unreadEligible).toBe(0)
  })

  it('counts read articles past retention window', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/old-read' })
    markArticleSeen(id, true)
    setSeenAt(id, daysAgo(100))

    const stats = getRetentionStats(90, 180)
    expect(stats.readEligible).toBe(1)
    expect(stats.unreadEligible).toBe(0)
  })

  it('counts unread articles past retention window', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/old-unread' })
    setFetchedAt(id, daysAgo(200))

    const stats = getRetentionStats(90, 180)
    expect(stats.readEligible).toBe(0)
    expect(stats.unreadEligible).toBe(1)
  })

  it('excludes bookmarked articles', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/bookmarked' })
    markArticleSeen(id, true)
    setSeenAt(id, daysAgo(100))
    markArticleBookmarked(id, true)

    const stats = getRetentionStats(90, 180)
    expect(stats.readEligible).toBe(0)
  })

  it('excludes liked articles', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/liked' })
    markArticleSeen(id, true)
    setSeenAt(id, daysAgo(100))
    markArticleLiked(id, true)

    const stats = getRetentionStats(90, 180)
    expect(stats.readEligible).toBe(0)
  })

  it('excludes clip feed articles', () => {
    const clipFeed = seedFeed({ name: 'Clips', url: 'https://clip.example.com', type: 'clip' })
    const id = seedArticle(clipFeed.id, { url: 'https://example.com/clipped' })
    markArticleSeen(id, true)
    setSeenAt(id, daysAgo(100))

    const stats = getRetentionStats(90, 180)
    expect(stats.readEligible).toBe(0)
  })
})

// --- purgeExpiredArticles ---

describe('purgeExpiredArticles', () => {
  it('returns zero when nothing to purge', () => {
    const feed = seedFeed()
    seedArticle(feed.id, { url: 'https://example.com/fresh' })

    const { purged } = purgeExpiredArticles(90, 180)
    expect(purged).toBe(0)
  })

  it('purges old read articles', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/old-read' })
    markArticleSeen(id, true)
    setSeenAt(id, daysAgo(100))

    const { purged } = purgeExpiredArticles(90, 180)
    expect(purged).toBe(1)
  })

  it('purges old unread articles', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/old-unread' })
    setFetchedAt(id, daysAgo(200))

    const { purged } = purgeExpiredArticles(90, 180)
    expect(purged).toBe(1)
  })

  it('nullifies content columns on purge', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, {
      url: 'https://example.com/to-purge',
      full_text: 'Full content',
      summary: 'Summary text',
      excerpt: 'Excerpt text',
      og_image: 'https://example.com/image.jpg',
    })
    markArticleSeen(id, true)
    setSeenAt(id, daysAgo(100))

    purgeExpiredArticles(90, 180)

    // Read directly from base table to verify nullification
    const row = getDb().prepare('SELECT full_text, full_text_translated, summary, excerpt, og_image, purged_at, last_error, retry_count FROM articles WHERE id = ?').get(id) as Record<string, unknown>
    expect(row.full_text).toBeNull()
    expect(row.full_text_translated).toBeNull()
    expect(row.summary).toBeNull()
    expect(row.excerpt).toBeNull()
    expect(row.og_image).toBeNull()
    expect(row.last_error).toBeNull()
    expect(row.retry_count).toBe(0)
    expect(row.purged_at).not.toBeNull()
  })

  it('preserves bookmarked articles', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/keep-bookmarked' })
    markArticleSeen(id, true)
    setSeenAt(id, daysAgo(100))
    markArticleBookmarked(id, true)

    const { purged } = purgeExpiredArticles(90, 180)
    expect(purged).toBe(0)

    const article = getArticleById(id)
    expect(article).toBeDefined()
    expect(article!.full_text).toBe('Some content here')
  })

  it('preserves liked articles', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/keep-liked' })
    markArticleSeen(id, true)
    setSeenAt(id, daysAgo(100))
    markArticleLiked(id, true)

    const { purged } = purgeExpiredArticles(90, 180)
    expect(purged).toBe(0)
  })

  it('preserves clip feed articles', () => {
    const clipFeed = seedFeed({ name: 'Clips', url: 'https://clip.example.com', type: 'clip' })
    const id = seedArticle(clipFeed.id, { url: 'https://example.com/clip-article' })
    markArticleSeen(id, true)
    setSeenAt(id, daysAgo(100))

    const { purged } = purgeExpiredArticles(90, 180)
    expect(purged).toBe(0)
  })

  it('does not purge the same article twice', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/once' })
    markArticleSeen(id, true)
    setSeenAt(id, daysAgo(100))

    const first = purgeExpiredArticles(90, 180)
    expect(first.purged).toBe(1)

    const second = purgeExpiredArticles(90, 180)
    expect(second.purged).toBe(0)
  })
})

// --- active_articles VIEW filters purged articles ---

describe('active_articles VIEW', () => {
  function purgeArticle(id: number) {
    // Mark as read and backdate, then purge
    markArticleSeen(id, true)
    setSeenAt(id, daysAgo(100))
    purgeExpiredArticles(90, 180)
  }

  it('getArticles excludes purged articles', () => {
    const feed = seedFeed()
    const id1 = seedArticle(feed.id, { url: 'https://example.com/active' })
    const id2 = seedArticle(feed.id, { url: 'https://example.com/purged' })
    purgeArticle(id2)

    const { articles, total } = getArticles({ limit: 100, offset: 0 })
    expect(total).toBe(1)
    expect(articles).toHaveLength(1)
    expect(articles[0].id).toBe(id1)
  })

  it('getArticleById returns undefined for purged article', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/gone' })
    purgeArticle(id)

    expect(getArticleById(id)).toBeUndefined()
  })

  it('searchArticles excludes purged articles', () => {
    const feed = seedFeed()
    seedArticle(feed.id, { url: 'https://example.com/search-active', title: 'Findable' })
    const id2 = seedArticle(feed.id, { url: 'https://example.com/search-purged', title: 'Findable' })
    purgeArticle(id2)

    const results = searchArticles({ query: 'Findable' })
    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://example.com/search-active')
  })

  it('getReadingStats excludes purged articles', () => {
    const feed = seedFeed()
    seedArticle(feed.id, { url: 'https://example.com/stat-active' })
    const id2 = seedArticle(feed.id, { url: 'https://example.com/stat-purged' })
    purgeArticle(id2)

    const stats = getReadingStats()
    expect(stats.total).toBe(1)
  })

  it('getLikeCount excludes purged articles', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/liked-purged' })
    markArticleLiked(id, true)
    // Unlike so it becomes purgeable, then manually purge
    markArticleLiked(id, false)
    markArticleSeen(id, true)
    setSeenAt(id, daysAgo(100))
    purgeExpiredArticles(90, 180)

    expect(getLikeCount()).toBe(0)
  })

  it('getBookmarkCount excludes purged articles', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/bm-purged' })
    markArticleBookmarked(id, true)
    markArticleBookmarked(id, false)
    markArticleSeen(id, true)
    setSeenAt(id, daysAgo(100))
    purgeExpiredArticles(90, 180)

    expect(getBookmarkCount()).toBe(0)
  })

  it('getRetryArticles excludes purged articles', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/retry-purged', last_error: 'fail', full_text: null })
    // Unread article, backdate fetched_at
    setFetchedAt(id, daysAgo(200))
    purgeExpiredArticles(90, 180)

    expect(getRetryArticles()).toHaveLength(0)
  })

  it('getExistingArticleUrls still includes purged URLs (dedup)', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/dedup-test' })
    purgeArticle(id)

    const existing = getExistingArticleUrls(['https://example.com/dedup-test', 'https://example.com/new'])
    expect(existing.has('https://example.com/dedup-test')).toBe(true)
    expect(existing.has('https://example.com/new')).toBe(false)
  })
})
