import { describe, it, expect, beforeEach, vi } from 'vitest'

// --- global.fetch mock (used by queryRssBridge) ---

const mockFetch = vi.fn()

// --- env setup (must be set BEFORE import so module-level const captures it) ---

const BRIDGE_URL = 'http://rss-bridge.local'
process.env.RSS_BRIDGE_URL = BRIDGE_URL

// --- import after mocks and env ---

const { queryRssBridge } = await import('./rss-bridge.js')

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

// ============================================================
// queryRssBridge
// ============================================================

describe('queryRssBridge', () => {
  it('returns the first feed URL from RSS-Bridge response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ url: 'https://example.com/feed.xml' }],
    })

    const result = await queryRssBridge('https://example.com')
    expect(result).toBe('https://example.com/feed.xml')
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockFetch.mock.calls[0][0]).toContain('action=findfeed')
    expect(mockFetch.mock.calls[0][0]).toContain(encodeURIComponent('https://example.com'))
  })

  it('returns null when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })

    const result = await queryRssBridge('https://example.com')
    expect(result).toBeNull()
  })

  it('returns null when response is empty array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    })

    const result = await queryRssBridge('https://example.com')
    expect(result).toBeNull()
  })

  it('returns null when feeds is not an array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ url: 'something' }),
    })

    const result = await queryRssBridge('https://example.com')
    expect(result).toBeNull()
  })

  it('returns null when first feed has no url string', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ title: 'Feed', url: 123 }],
    })

    const result = await queryRssBridge('https://example.com')
    expect(result).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'))

    const result = await queryRssBridge('https://example.com')
    expect(result).toBeNull()
  })
})
