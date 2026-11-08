import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createFeed, createCategory, insertArticle, markArticleSeen } from '../db.js'
import type { FastifyInstance } from 'fastify'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../fetcher.js', async () => {
  const { EventEmitter } = await import('events')
  return {
    fetchAllFeeds: vi.fn(),
    fetchSingleFeed: vi.fn(),
    discoverRssUrl: vi.fn().mockResolvedValue({ rssUrl: null, title: null }),
    fetchProgress: new EventEmitter(),
    getFeedState: vi.fn(),
  }
})

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

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

beforeEach(async () => {
  setupTestDb()
  app = await buildApp()
})

// ---------------------------------------------------------------------------
// Limit/offset boundary values
// ---------------------------------------------------------------------------

describe('GET /api/articles boundary values', () => {
  it('clamps limit to 1-100 range', async () => {
    const feed = seedFeed()
    for (let i = 0; i < 3; i++) seedArticle(feed.id)

    // limit=0 → NaN || 20 → clamped to 20 via Math.min(Math.max(NaN||20,1),100)
    const res1 = await app.inject({ method: 'GET', url: '/api/articles?limit=0' })
    expect(res1.statusCode).toBe(200)
    // 0 is falsy so Number(0)||20 = 20, returns all 3
    expect(res1.json().articles.length).toBe(3)

    // limit=999 → clamped to 100
    const res2 = await app.inject({ method: 'GET', url: '/api/articles?limit=999' })
    expect(res2.statusCode).toBe(200)

    // limit=2 → returns exactly 2
    const res3 = await app.inject({ method: 'GET', url: '/api/articles?limit=2' })
    expect(res3.json().articles.length).toBe(2)
    expect(res3.json().has_more).toBe(true)
  })

  it('clamps negative offset to 0', async () => {
    const feed = seedFeed()
    seedArticle(feed.id)

    const res = await app.inject({ method: 'GET', url: '/api/articles?offset=-10' })
    expect(res.statusCode).toBe(200)
    expect(res.json().articles).toHaveLength(1)
  })

  it('handles non-numeric limit/offset gracefully', async () => {
    const feed = seedFeed()
    seedArticle(feed.id)

    const res = await app.inject({ method: 'GET', url: '/api/articles?limit=abc&offset=xyz' })
    expect(res.statusCode).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Category filter
// ---------------------------------------------------------------------------

describe('GET /api/articles?category_id', () => {
  it('filters articles by category', async () => {
    const cat = createCategory('Tech')
    const f1 = seedFeed({ category_id: cat.id, url: 'https://a.com' })
    const f2 = seedFeed({ url: 'https://b.com' })
    seedArticle(f1.id)
    seedArticle(f2.id)

    const res = await app.inject({
      method: 'GET',
      url: `/api/articles?category_id=${cat.id}`,
    })
    expect(res.json().articles).toHaveLength(1)
    expect(res.json().total).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Read filter
// ---------------------------------------------------------------------------

describe('GET /api/articles?read=1', () => {
  it('filters read articles', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id)
    seedArticle(feed.id)

    // Record a read
    await app.inject({ method: 'POST', url: `/api/articles/${artId}/read` })

    const res = await app.inject({ method: 'GET', url: '/api/articles?read=1' })
    expect(res.json().articles).toHaveLength(1)
    expect(res.json().articles[0].read_at).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// total_all: distinguish "no articles" from "all read"
// ---------------------------------------------------------------------------

describe('GET /api/articles?unread=1 — total_all field', () => {
  it('returns total_all when unread filter yields 0 results but articles exist', async () => {
    const feed = seedFeed()
    const artId1 = seedArticle(feed.id)
    const artId2 = seedArticle(feed.id)
    markArticleSeen(artId1, true)
    markArticleSeen(artId2, true)

    const res = await app.inject({ method: 'GET', url: '/api/articles?unread=1' })
    expect(res.statusCode).toBe(200)
    expect(res.json().articles).toHaveLength(0)
    expect(res.json().total).toBe(0)
    expect(res.json().total_all).toBe(2)
  })

  it('returns total_all scoped to category_id', async () => {
    const cat = createCategory('News')
    const f1 = seedFeed({ category_id: cat.id, url: 'https://a.com' })
    const f2 = seedFeed({ url: 'https://b.com' })
    const a1 = seedArticle(f1.id)
    seedArticle(f2.id) // different category — should not count
    markArticleSeen(a1, true)

    const res = await app.inject({
      method: 'GET',
      url: `/api/articles?unread=1&category_id=${cat.id}`,
    })
    expect(res.json().articles).toHaveLength(0)
    expect(res.json().total_all).toBe(1)
  })

  it('does not include total_all when there are unread articles', async () => {
    const feed = seedFeed()
    seedArticle(feed.id) // unread

    const res = await app.inject({ method: 'GET', url: '/api/articles?unread=1' })
    expect(res.json().articles).toHaveLength(1)
    expect(res.json().total_all).toBeUndefined()
  })

  it('does not include total_all when no articles at all', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/articles?unread=1' })
    expect(res.json().articles).toHaveLength(0)
    expect(res.json().total).toBe(0)
    // total_all is 0, so it should still be included (to confirm "truly empty")
    expect(res.json().total_all).toBe(0)
  })

  it('does not include total_all for non-unread queries', async () => {
    const feed = seedFeed()
    seedArticle(feed.id)

    const res = await app.inject({ method: 'GET', url: '/api/articles' })
    expect(res.json().total_all).toBeUndefined()
  })
})

describe('GET /api/articles/by-url — source_url', () => {
  async function detail(url: string) {
    const res = await app.inject({ method: 'GET', url: `/api/articles/by-url?url=${encodeURIComponent(url)}` })
    expect(res.statusCode).toBe(200)
    return res.json()
  }

  it('is the article URL for an ordinary article', async () => {
    const feed = seedFeed()
    seedArticle(feed.id, { url: 'https://example.com/ordinary' })

    const body = await detail('https://example.com/ordinary')
    expect(body.source_url).toBe('https://example.com/ordinary')
    expect(body).not.toHaveProperty('stored_source_url')
    expect(body).not.toHaveProperty('feed_rss_url')
  })

  it('is the stored post address for an inline feed entry, and null when none is known', async () => {
    const rssUrl = 'http://192.168.1.50:3100/api/feeds/newsletter'
    const feed = seedFeed({ url: 'http://192.168.1.50:3100', rss_url: rssUrl })
    seedArticle(feed.id, { url: `${rssUrl}#urn:letterfeed:entry:1`, source_url: 'https://open.substack.com/pub/example/p/one' })
    seedArticle(feed.id, { url: `${rssUrl}#urn:letterfeed:entry:2` })

    expect((await detail(`${rssUrl}#urn:letterfeed:entry:1`)).source_url).toBe('https://open.substack.com/pub/example/p/one')
    const withoutSource = await detail(`${rssUrl}#urn:letterfeed:entry:2`)
    expect(withoutSource.source_url).toBeNull()
    expect(withoutSource.url).toBe(`${rssUrl}#urn:letterfeed:entry:2`)
  })
})
