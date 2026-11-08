import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { upsertSetting, getSetting, createFeed, insertArticle, markArticleSeen, getDb } from '../db.js'
import type { FastifyInstance } from 'fastify'

// ---------------------------------------------------------------------------
// Mocks — same as api.test.ts (needed for buildApp imports)
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
const json = { 'content-type': 'application/json' }

beforeEach(async () => {
  setupTestDb()
  app = await buildApp()
})

// =========================================================================
// POST preferences endpoint (same handler as PATCH)
// =========================================================================

describe('POST /api/settings/preferences', () => {
  it('updates preferences via POST (same handler)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.date_mode': 'absolute' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()['reading.date_mode']).toBe('absolute')
  })
})

// =========================================================================
// Boolean/on-off preferences
// =========================================================================

describe('PATCH /api/settings/preferences — on/off toggles', () => {
  it('accepts on/off for auto_mark_read', async () => {
    const resOn = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.auto_mark_read': 'on' },
    })
    expect(resOn.statusCode).toBe(200)
    expect(resOn.json()['reading.auto_mark_read']).toBe('on')

    const resOff = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.auto_mark_read': 'off' },
    })
    expect(resOff.statusCode).toBe(200)
    expect(resOff.json()['reading.auto_mark_read']).toBe('off')
  })

  it('rejects invalid on/off value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.auto_mark_read': 'yes' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects invalid unread_indicator value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.unread_indicator': 'true' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects invalid internal_links value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.internal_links': '1' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects invalid show_thumbnails value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.show_thumbnails': 'true' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('accepts on/off for category_unread_only', async () => {
    const resOn = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.category_unread_only': 'on' },
    })
    expect(resOn.statusCode).toBe(200)
    expect(resOn.json()['reading.category_unread_only']).toBe('on')

    const resOff = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.category_unread_only': 'off' },
    })
    expect(resOff.statusCode).toBe(200)
    expect(resOff.json()['reading.category_unread_only']).toBe('off')
  })

  it('rejects invalid category_unread_only value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.category_unread_only': 'yes' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// =========================================================================
// Profile — avatar_seed
// =========================================================================

describe('PATCH /api/settings/profile — avatar_seed', () => {
  it('updates avatar_seed', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: json,
      payload: { avatar_seed: 'my-seed-123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().avatar_seed).toBe('my-seed-123')
  })

  it('clears avatar_seed with null', async () => {
    // Set first
    await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: json,
      payload: { avatar_seed: 'seed' },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: json,
      payload: { avatar_seed: null },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().avatar_seed).toBeNull()
  })
})

// =========================================================================
// Profile — default account_name initialization
// =========================================================================

describe('GET /api/settings/profile — defaults', () => {
  it('initializes account_name from auth email on first access', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/profile' })
    expect(res.statusCode).toBe(200)
    // Should auto-initialize
    expect(res.json().account_name).toBeDefined()
    expect(res.json().account_name.length).toBeGreaterThan(0)

    // Should persist after initialization
    const stored = getSetting('profile.account_name')
    expect(stored).toBe(res.json().account_name)
  })
})

// =========================================================================
// Retention policy endpoints
// =========================================================================

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('GET /api/settings/retention/stats', () => {
  it('returns zeros when retention is not configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/retention/stats' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ readDays: 0, unreadDays: 0, readEligible: 0, unreadEligible: 0 })
  })

  it('returns eligible counts when configured', async () => {
    const feed = createFeed({ name: 'F', url: 'https://f.com' })
    const id = insertArticle({ feed_id: feed.id, title: 'Old', url: 'https://f.com/1', published_at: '2025-01-01T00:00:00Z' })
    markArticleSeen(id, true)
    getDb().prepare('UPDATE articles SET seen_at = ? WHERE id = ?').run(daysAgo(100), id)

    upsertSetting('retention.enabled', 'on')
    upsertSetting('retention.read_days', '90')
    upsertSetting('retention.unread_days', '180')

    const res = await app.inject({ method: 'GET', url: '/api/settings/retention/stats' })
    expect(res.statusCode).toBe(200)
    expect(res.json().readEligible).toBe(1)
    expect(res.json().readDays).toBe(90)
  })
})

describe('POST /api/settings/retention/purge', () => {
  it('returns 400 when retention is not enabled', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/settings/retention/purge' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/not enabled/)
  })

  it('returns purged: 0 when enabled but no days configured', async () => {
    upsertSetting('retention.enabled', 'on')

    const res = await app.inject({ method: 'POST', url: '/api/settings/retention/purge' })
    expect(res.statusCode).toBe(200)
    expect(res.json().purged).toBe(0)
  })

  it('purges eligible articles', async () => {
    const feed = createFeed({ name: 'F', url: 'https://f.com' })
    const id = insertArticle({ feed_id: feed.id, title: 'Old', url: 'https://f.com/1', published_at: '2025-01-01T00:00:00Z' })
    markArticleSeen(id, true)
    getDb().prepare('UPDATE articles SET seen_at = ? WHERE id = ?').run(daysAgo(100), id)

    upsertSetting('retention.enabled', 'on')
    upsertSetting('retention.read_days', '90')
    upsertSetting('retention.unread_days', '180')

    const res = await app.inject({ method: 'POST', url: '/api/settings/retention/purge' })
    expect(res.statusCode).toBe(200)
    expect(res.json().purged).toBe(1)
  })
})

describe('PATCH /api/settings/preferences — retention validation', () => {
  it('accepts valid retention day values', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'retention.read_days': '90', 'retention.unread_days': '180' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('rejects non-integer retention days', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'retention.read_days': '3.5' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects zero retention days', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'retention.read_days': '0' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects negative retention days', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'retention.unread_days': '-10' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects retention days exceeding 9999', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'retention.read_days': '10000' },
    })
    expect(res.statusCode).toBe(400)
  })
})
