import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { upsertSetting, getSetting } from '../db.js'
import type { FastifyInstance } from 'fastify'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockAssertSafeUrl } = vi.hoisted(() => ({
  mockAssertSafeUrl: vi.fn(),
}))

vi.mock('../fetcher.js', async () => {
  const { EventEmitter } = await import('events')
  return {
    fetchAllFeeds: vi.fn(),
    fetchSingleFeed: vi.fn(),
    discoverRssUrl: vi.fn().mockResolvedValue({ rssUrl: null, title: null }),
    summarizeArticle: vi.fn(),
    streamSummarizeArticle: vi.fn(),
    translateArticle: vi.fn(),
    streamTranslateArticle: vi.fn(),
    fetchProgress: new EventEmitter(),
    getFeedState: vi.fn(),
  }
})

vi.mock('../anthropic.js', () => ({
  anthropic: { messages: { stream: vi.fn(), create: vi.fn() } },
}))

vi.mock('../fetcher/ssrf.js', () => ({
  assertSafeUrl: (...args: unknown[]) => mockAssertSafeUrl(...args),
  safeFetch: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: FastifyInstance
const json = { 'content-type': 'application/json' }

beforeEach(async () => {
  setupTestDb()
  app = await buildApp()
  vi.clearAllMocks()
  mockAssertSafeUrl.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// GET /api/settings/image-storage
// ---------------------------------------------------------------------------

describe('GET /api/settings/image-storage', () => {
  it('returns default values when no settings configured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/image-storage',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body['images.enabled']).toBeNull()
    expect(body.mode).toBe('local')
    expect(body.url).toBe('')
    expect(body.headersConfigured).toBe(false)
    expect(body.fieldName).toBe('image')
    expect(body.respPath).toBe('')
  })

  it('returns stored values after PATCH', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/settings/image-storage',
      headers: json,
      payload: {
        'images.enabled': '1',
        'images.storage_path': '/tmp/images',
        'images.max_size_mb': '20',
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/image-storage',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body['images.enabled']).toBe('1')
    expect(body['images.storage_path']).toBe('/tmp/images')
    expect(body['images.max_size_mb']).toBe('20')
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/settings/image-storage
// ---------------------------------------------------------------------------

describe('PATCH /api/settings/image-storage', () => {
  it('updates images.enabled', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/image-storage',
      headers: json,
      payload: { 'images.enabled': '1' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()['images.enabled']).toBe('1')
    expect(getSetting('images.enabled')).toBe('1')
  })

  it('updates images.storage_path', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/image-storage',
      headers: json,
      payload: { 'images.storage_path': '/custom/path' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()['images.storage_path']).toBe('/custom/path')
  })

  it('validates images.max_size_mb range (1-100)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/image-storage',
      headers: json,
      payload: { 'images.max_size_mb': '50' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()['images.max_size_mb']).toBe('50')
  })

  it('rejects invalid max_size_mb (over 100)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/image-storage',
      headers: json,
      payload: { 'images.max_size_mb': '200' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/max_size_mb/)
  })

  it('rejects invalid max_size_mb (zero)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/image-storage',
      headers: json,
      payload: { 'images.max_size_mb': '0' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/max_size_mb/)
  })

  it('rejects invalid max_size_mb (NaN)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/image-storage',
      headers: json,
      payload: { 'images.max_size_mb': 'abc' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('validates mode enum (local/remote)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/image-storage',
      headers: json,
      payload: { mode: 'remote' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().mode).toBe('remote')
  })

  it('rejects invalid mode', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/image-storage',
      headers: json,
      payload: { mode: 'cloud' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/mode/)
  })

  it('validates URL via SSRF check', async () => {
    mockAssertSafeUrl.mockRejectedValue(new Error('SSRF blocked'))

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/image-storage',
      headers: json,
      payload: { url: 'http://127.0.0.1/upload' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/blocked/i)
  })

  it('validates headers is valid JSON object (rejects array)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/image-storage',
      headers: json,
      payload: { headers: '[1,2,3]' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/headers/)
  })

  it('validates headers is valid JSON object (rejects non-JSON)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/image-storage',
      headers: json,
      payload: { headers: 'not json' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/headers/)
  })

  it('accepts valid JSON object headers', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/image-storage',
      headers: json,
      payload: { headers: '{"Authorization":"Bearer token"}' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().headersConfigured).toBe(true)
  })

  it('deletes settings when empty string sent', async () => {
    upsertSetting('images.enabled', '1')
    upsertSetting('images.storage_path', '/custom')

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/image-storage',
      headers: json,
      payload: { 'images.enabled': '', 'images.storage_path': '' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()['images.enabled']).toBeNull()
    expect(res.json()['images.storage_path']).toBeNull()
  })

  it('updates fieldName and respPath', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/image-storage',
      headers: json,
      payload: { fieldName: 'file', respPath: 'data.url' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().fieldName).toBe('file')
    expect(res.json().respPath).toBe('data.url')
  })
})

// ---------------------------------------------------------------------------
// POST /api/settings/image-storage/test
// ---------------------------------------------------------------------------

describe('POST /api/settings/image-storage/test', () => {
  it('400: mode is not remote', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/image-storage/test',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/not set to remote/i)
  })

  it('400: incomplete settings (no uploadUrl or respPath)', async () => {
    upsertSetting('images.storage', 'remote')

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/image-storage/test',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/incomplete/i)
  })
})
