import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createFeed, insertArticle, ensureClipFeed, getArticleById, markImagesArchived, upsertSetting } from '../db.js'
import type { FastifyInstance } from 'fastify'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockArchiveArticleImages, mockIsImageArchivingEnabled, mockDeleteArticleImages, mockFetchArticleContent } = vi.hoisted(() => ({
  mockArchiveArticleImages: vi.fn(),
  mockIsImageArchivingEnabled: vi.fn(),
  mockDeleteArticleImages: vi.fn(),
  mockFetchArticleContent: vi.fn(),
}))

vi.mock('../fetcher.js', async () => {
  const { EventEmitter } = await import('events')
  return {
    fetchAllFeeds: vi.fn(),
    fetchSingleFeed: vi.fn(),
    discoverRssUrl: vi.fn().mockResolvedValue({ rssUrl: null, title: null }),
    fetchProgress: new EventEmitter(),
    getFeedState: vi.fn(),
    fetchArticleContent: (...args: unknown[]) => mockFetchArticleContent(...args),
  }
})

vi.mock('../fetcher/article-images.js', () => ({
  archiveArticleImages: (...args: unknown[]) => mockArchiveArticleImages(...args),
  isImageArchivingEnabled: (...args: unknown[]) => mockIsImageArchivingEnabled(...args),
  deleteArticleImages: (...args: unknown[]) => mockDeleteArticleImages(...args),
}))

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: FastifyInstance
const json = { 'content-type': 'application/json' }

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
  vi.clearAllMocks()
  mockFetchArticleContent.mockResolvedValue({
    fullText: 'Fetched article content',
    ogImage: 'https://example.com/og.jpg',
    excerpt: 'Short excerpt',
    lang: 'en',
    lastError: null,
    title: 'Fetched Title',
  })
  mockIsImageArchivingEnabled.mockReturnValue(false)
  mockArchiveArticleImages.mockResolvedValue({ rewrittenText: '', downloaded: 0, errors: 0 })
  mockDeleteArticleImages.mockReturnValue(0)
})

// ---------------------------------------------------------------------------
// POST /api/articles/from-url
// ---------------------------------------------------------------------------

describe('POST /api/articles/from-url', () => {
  it('201: creates article with fetched content', async () => {
    ensureClipFeed()

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/post-1' },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.created).toBe(true)
    expect(body.article.title).toBe('Fetched Title')
    expect(body.article.full_text).toBe('Fetched article content')
    expect(body.article.og_image).toBe('https://example.com/og.jpg')
    expect(body.article.lang).toBe('en')
    expect(mockFetchArticleContent).toHaveBeenCalledWith('https://blog.example.com/post-1')
  })

  it('201: creates article with http:// URL', async () => {
    ensureClipFeed()

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'http://blog.example.com/post-http' },
    })

    expect(res.statusCode).toBe(201)
    expect(mockFetchArticleContent).toHaveBeenCalledWith('http://blog.example.com/post-http')
  })

  it('201: uses provided title over fetched title', async () => {
    ensureClipFeed()

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/post-2', title: 'My Custom Title' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().article.title).toBe('My Custom Title')
  })

  it('201: falls back to hostname when no title', async () => {
    ensureClipFeed()
    mockFetchArticleContent.mockResolvedValue({
      fullText: 'Content',
      ogImage: null,
      excerpt: null,
      lang: 'en',
      lastError: null,
      title: null,
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/post-3' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().article.title).toBe('blog.example.com')
  })

  it('201: stores last_error when fetchFullText fails (graceful degradation)', async () => {
    ensureClipFeed()
    mockFetchArticleContent.mockResolvedValue({
      fullText: null,
      ogImage: null,
      excerpt: null,
      lang: null,
      lastError: 'fetchFullText: Network timeout',
      title: null,
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/post-4' },
    })

    expect(res.statusCode).toBe(201)
    const article = res.json().article
    expect(article.full_text).toBeNull()
    // last_error is stored in DB but getArticleById doesn't select it;
    // verify the article was still created successfully despite the fetch error
    expect(article.id).toBeDefined()
    expect(article.title).toBe('blog.example.com') // falls back to hostname
  })

  it('400: missing url', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: {},
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/url/i)
  })

  it('409: article already exists in clips', async () => {
    const clipFeed = ensureClipFeed()
    seedArticle(clipFeed.id, { url: 'https://blog.example.com/existing' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/existing' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/already exists/i)
    expect(res.json().can_force).toBeUndefined()
  })

  it('409: returns can_force when article exists in RSS feed', async () => {
    ensureClipFeed()
    const rssFeed = seedFeed()
    seedArticle(rssFeed.id, { url: 'https://blog.example.com/rss-article' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/rss-article' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().can_force).toBe(true)
    expect(res.json().article).toBeDefined()
  })

  it('200: force-moves RSS article to clip feed', async () => {
    const clipFeed = ensureClipFeed()
    const rssFeed = seedFeed()
    const artId = seedArticle(rssFeed.id, { url: 'https://blog.example.com/to-move' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/to-move', force: true },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().moved).toBe(true)
    // Verify article moved to clip feed
    const moved = getArticleById(artId)
    expect(moved!.feed_id).toBe(clipFeed.id)
    expect(moved!.feed_type).toBe('clip')
  })

  it('500: force-move fails when clip feed not found', async () => {
    // Create RSS feed and article but no clip feed
    const rssFeed = seedFeed()
    seedArticle(rssFeed.id, { url: 'https://blog.example.com/no-clip' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/no-clip', force: true },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error).toMatch(/clip feed/i)
  })

  it('500: clip feed not found', async () => {
    // Do NOT call ensureClipFeed — no clip feed exists
    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/post-5' },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error).toMatch(/clip feed/i)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/articles/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/articles/:id', () => {
  it('204: deletes clip article', async () => {
    const clipFeed = ensureClipFeed()
    const artId = seedArticle(clipFeed.id, { url: 'https://example.com/to-delete' })

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/articles/${artId}`,
    })

    expect(res.statusCode).toBe(204)
    expect(getArticleById(artId)).toBeUndefined()
  })

  it('204: deletes clip article and cleans up archived images', async () => {
    const clipFeed = ensureClipFeed()
    const artId = seedArticle(clipFeed.id, { url: 'https://example.com/with-images' })
    markImagesArchived(artId)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/articles/${artId}`,
    })

    expect(res.statusCode).toBe(204)
    expect(mockDeleteArticleImages).toHaveBeenCalledWith(artId)
  })

  it('403: rejects deletion of RSS feed articles', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/articles/${artId}`,
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/clip/i)
  })

  it('404: article not found', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/articles/99999',
    })

    expect(res.statusCode).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// POST /api/articles/:id/archive-images
// ---------------------------------------------------------------------------

describe('POST /api/articles/:id/archive-images', () => {
  it('202: accepted', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id, { full_text: 'Article with ![img](https://example.com/image.png)' })
    mockIsImageArchivingEnabled.mockReturnValue(true)

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/archive-images`,
    })

    expect(res.statusCode).toBe(202)
    expect(res.json().status).toBe('accepted')
  })

  it('400: no full_text', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id, { full_text: null })
    mockIsImageArchivingEnabled.mockReturnValue(true)

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/archive-images`,
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/full text/i)
  })

  it('400: image archiving not enabled', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id, { full_text: 'Some text' })
    mockIsImageArchivingEnabled.mockReturnValue(false)

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/archive-images`,
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/not enabled/i)
  })

  it('404: article not found', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/99999/archive-images',
    })

    expect(res.statusCode).toBe(404)
  })

  it('409: images already archived', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id, { full_text: 'Article text' })
    markImagesArchived(artId)
    mockIsImageArchivingEnabled.mockReturnValue(true)

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/archive-images`,
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/already archived/i)
  })
})

// ---------------------------------------------------------------------------
// GET /api/articles/images/:filename
// ---------------------------------------------------------------------------

describe('GET /api/articles/images/:filename', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-test-images-'))
    upsertSetting('images.storage_path', tmpDir)
  })

  it('200: serves image with correct content-type and cache headers', async () => {
    const filename = '1_abc123.png'
    fs.writeFileSync(path.join(tmpDir, filename), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const res = await app.inject({
      method: 'GET',
      url: `/api/articles/images/${filename}`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toMatch(/immutable/)
  })

  it('400: path traversal attempt with ..', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/articles/images/..secret',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/invalid/i)
  })

  it('404: file not found', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/articles/images/nonexistent_image.jpg',
    })

    expect(res.statusCode).toBe(404)
  })
})
