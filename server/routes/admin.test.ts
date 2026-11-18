import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import type { FastifyInstance } from 'fastify'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockFetchAllFeeds, mockGetFeedState, mockFetchProgress } = vi.hoisted(() => {
  const { EventEmitter } = require('events')
  return {
    mockFetchAllFeeds: vi.fn(),
    mockGetFeedState: vi.fn(),
    mockFetchProgress: new EventEmitter(),
  }
})

vi.mock('../fetcher.js', () => ({
  fetchAllFeeds: (...args: unknown[]) => mockFetchAllFeeds(...args),
  fetchSingleFeed: vi.fn(),
  discoverRssUrl: vi.fn().mockResolvedValue({ rssUrl: null, title: null }),
  summarizeArticle: vi.fn(),
  streamSummarizeArticle: vi.fn(),
  translateArticle: vi.fn(),
  streamTranslateArticle: vi.fn(),
  fetchProgress: mockFetchProgress,
  getFeedState: (...args: unknown[]) => mockGetFeedState(...args),
}))

vi.mock('../anthropic.js', () => ({
  anthropic: { messages: { stream: vi.fn(), create: vi.fn() } },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSSE(body: string): Record<string, unknown>[] {
  return body
    .split('\n')
    .filter(l => l.startsWith('data: '))
    .map(l => JSON.parse(l.slice(6)))
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  setupTestDb()
  app = await buildApp()
  mockFetchAllFeeds.mockReset()
  mockGetFeedState.mockReset().mockReturnValue(null)
  mockFetchProgress.removeAllListeners()
})

// =========================================================================
// POST /api/admin/fetch-all
// =========================================================================

describe('POST /api/admin/fetch-all', () => {
  it('returns SSE stream with progress events', async () => {
    mockFetchAllFeeds.mockImplementation(async (onEvent: (e: any) => void) => {
      onEvent({ type: 'feed-articles-found', feed_id: 1, total: 3 })
      onEvent({ type: 'article-done', feed_id: 1, fetched: 1, total: 3 })
      onEvent({ type: 'article-done', feed_id: 1, fetched: 2, total: 3 })
      onEvent({ type: 'article-done', feed_id: 1, fetched: 3, total: 3 })
      onEvent({ type: 'feed-complete', feed_id: 1 })
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/fetch-all',
      headers: { 'content-type': 'application/json' },
      payload: {},
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')

    const events = parseSSE(res.body)
    expect(events.find(e => e.type === 'feed-articles-found')).toBeDefined()
    expect(events.filter(e => e.type === 'article-done')).toHaveLength(3)
    expect(events.find(e => e.type === 'feed-complete')).toBeDefined()
  })

  it('handles fetch with multiple feeds', async () => {
    mockFetchAllFeeds.mockImplementation(async (onEvent: (e: any) => void) => {
      onEvent({ type: 'feed-articles-found', feed_id: 1, total: 1 })
      onEvent({ type: 'feed-complete', feed_id: 1 })
      onEvent({ type: 'feed-articles-found', feed_id: 2, total: 2 })
      onEvent({ type: 'feed-complete', feed_id: 2 })
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/fetch-all',
      headers: { 'content-type': 'application/json' },
      payload: {},
    })

    const events = parseSSE(res.body)
    expect(events.filter(e => e.type === 'feed-articles-found')).toHaveLength(2)
    expect(events.filter(e => e.type === 'feed-complete')).toHaveLength(2)
  })

  it('handles empty feed list', async () => {
    mockFetchAllFeeds.mockResolvedValue(undefined)

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/fetch-all',
      headers: { 'content-type': 'application/json' },
      payload: {},
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
  })
})

// =========================================================================
// GET /api/feeds/:id/fetch-progress — late subscriber replay
// =========================================================================

describe('GET /api/feeds/:id/fetch-progress', () => {
  it('replays current state for late subscriber (in progress)', async () => {
    mockGetFeedState.mockReturnValue({
      total: 5,
      fetched: 2,
      done: false,
    })

    // The SSE endpoint stays open waiting for events.
    // Emit feed-complete shortly after to close the stream.
    setTimeout(() => {
      mockFetchProgress.emit('event', { type: 'feed-complete', feed_id: 42 })
    }, 50)

    const res = await app.inject({
      method: 'GET',
      url: '/api/feeds/42/fetch-progress',
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')

    const events = parseSSE(res.body)
    // Should replay: feed-articles-found + article-done
    const foundEvent = events.find(e => e.type === 'feed-articles-found')
    expect(foundEvent).toBeDefined()
    expect(foundEvent!.feed_id).toBe(42)
    expect(foundEvent!.total).toBe(5)

    const doneEvent = events.find(e => e.type === 'article-done')
    expect(doneEvent).toBeDefined()
    expect(doneEvent!.fetched).toBe(2)
  })

  it('replays completed state and closes immediately', async () => {
    mockGetFeedState.mockReturnValue({
      total: 3,
      fetched: 3,
      done: true,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/feeds/42/fetch-progress',
    })

    const events = parseSSE(res.body)
    // Should replay all three: found, article-done, feed-complete
    expect(events.find(e => e.type === 'feed-articles-found')).toBeDefined()
    expect(events.find(e => e.type === 'article-done')).toBeDefined()
    expect(events.find(e => e.type === 'feed-complete')).toBeDefined()
  })

  it('does not replay article-done when fetched is 0', async () => {
    mockGetFeedState.mockReturnValue({
      total: 10,
      fetched: 0,
      done: false,
    })

    // Close stream via feed-complete event
    setTimeout(() => {
      mockFetchProgress.emit('event', { type: 'feed-complete', feed_id: 99 })
    }, 50)

    const res = await app.inject({
      method: 'GET',
      url: '/api/feeds/99/fetch-progress',
    })

    const events = parseSSE(res.body)
    const replayEvents = events.filter(e => e.type !== 'feed-complete')
    expect(replayEvents.find(e => e.type === 'feed-articles-found')).toBeDefined()
    expect(replayEvents.find(e => e.type === 'article-done')).toBeUndefined()
  })

  it('returns empty stream when no state exists', async () => {
    mockGetFeedState.mockReturnValue(null)

    // Close stream via feed-complete event
    setTimeout(() => {
      mockFetchProgress.emit('event', { type: 'feed-complete', feed_id: 42 })
    }, 50)

    const res = await app.inject({
      method: 'GET',
      url: '/api/feeds/42/fetch-progress',
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    // Only the closing feed-complete event, no replay events
    const events = parseSSE(res.body)
    expect(events.filter(e => e.type !== 'feed-complete')).toHaveLength(0)
  })

  it('filters events by feed ID', async () => {
    mockGetFeedState.mockReturnValue(null)

    // Emit events for different feed IDs, then close
    setTimeout(() => {
      mockFetchProgress.emit('event', { type: 'article-done', feed_id: 99, fetched: 1 })
      mockFetchProgress.emit('event', { type: 'article-done', feed_id: 42, fetched: 1 })
      mockFetchProgress.emit('event', { type: 'feed-complete', feed_id: 42 })
    }, 50)

    const res = await app.inject({
      method: 'GET',
      url: '/api/feeds/42/fetch-progress',
    })

    const events = parseSSE(res.body)
    // Should only contain events for feed_id 42
    const feedIds = events.map(e => e.feed_id).filter(Boolean)
    expect(feedIds.every(id => id === 42)).toBe(true)
  })
})
