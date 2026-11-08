import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { getDb, createCategory, createFeed, getCategories, insertArticle } from '../db.js'
import { hashSync } from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import { clientLoginAttempts } from '../lib/login-attempts.js'
import { isRateLimitExempt } from '../lib/routed-path.js'
import { rateLimitKey } from '../lib/client-ip.js'
import { decodeItemId } from './greader.js'
import { registerSpaFallback } from '../lib/spa-fallback.js'

// Subscribing discovers and fetches the feed over the network; mock both, as
// server/routes/feeds.test.ts does.
const { mockDiscoverRssUrl, mockFetchSingleFeed, mockQueryRssBridge } = vi.hoisted(() => ({
  mockDiscoverRssUrl: vi.fn(),
  mockFetchSingleFeed: vi.fn(),
  mockQueryRssBridge: vi.fn(),
}))

vi.mock('../fetcher.js', async () => {
  const { EventEmitter } = await import('events')
  return {
    fetchAllFeeds: vi.fn(),
    fetchSingleFeed: (...args: unknown[]) => mockFetchSingleFeed(...args),
    discoverRssUrl: (...args: unknown[]) => mockDiscoverRssUrl(...args),
    fetchProgress: new EventEmitter(),
    getFeedState: vi.fn(),
  }
})

vi.mock('../rss-bridge.js', () => ({
  queryRssBridge: (...args: unknown[]) => mockQueryRssBridge(...args),
}))

let app: FastifyInstance
let savedAuthDisabled: string | undefined

function seedUser(email = 'test@example.com', password = 'password123') {
  const hash = hashSync(password, 4) // low cost for tests
  getDb().prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash)
}

async function clientLogin(email = 'test@example.com', password = 'password123') {
  const res = await app.inject({
    method: 'POST',
    url: '/accounts/ClientLogin',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: `Email=${encodeURIComponent(email)}&Passwd=${encodeURIComponent(password)}`,
  })
  const auth = res.body.match(/Auth=(.+)/)?.[1]?.trim()
  return { res, auth: auth ?? null }
}

beforeEach(async () => {
  setupTestDb()
  clientLoginAttempts.clear()
  mockDiscoverRssUrl.mockReset().mockResolvedValue({ rssUrl: null, title: null, usedFlareSolverr: false })
  mockFetchSingleFeed.mockReset().mockResolvedValue(undefined)
  mockQueryRssBridge.mockReset().mockResolvedValue(null)
  app = await buildApp()
  // Remove AUTH_DISABLED so greader JWT auth is exercised properly
  savedAuthDisabled = process.env.AUTH_DISABLED
  delete process.env.AUTH_DISABLED
})

afterEach(() => {
  if (savedAuthDisabled !== undefined) {
    process.env.AUTH_DISABLED = savedAuthDisabled
  } else {
    delete process.env.AUTH_DISABLED
  }
})

// ── ClientLogin ──────────────────────────────────────────────────────────────

describe('POST /accounts/ClientLogin', () => {
  it('returns 401 Unauthorized! for bad credentials', async () => {
    seedUser()
    const { res } = await clientLogin('test@example.com', 'wrongpassword')
    expect(res.statusCode).toBe(401)
    expect(res.body).toBe('Unauthorized!')
  })

  it('returns token on valid credentials', async () => {
    seedUser()
    const { res, auth } = await clientLogin()
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    expect(auth).toBeTruthy()
    expect(res.body).toContain('SID=')
    expect(res.body).toContain('Auth=')
  })

  it('includes token_version in JWT payload', async () => {
    seedUser()
    const { auth } = await clientLogin()
    const decoded = app.jwt.decode(auth!) as { email: string; token_version: number }
    expect(decoded.email).toBe('test@example.com')
    expect(decoded.token_version).toBe(0)
  })

  it('issues a long-lived token so reader apps are not signed out monthly', async () => {
    seedUser()
    const { auth } = await clientLogin()
    const decoded = app.jwt.decode(auth!) as { iat: number; exp: number }
    const lifetimeDays = (decoded.exp - decoded.iat) / 86_400
    expect(lifetimeDays).toBe(3650)
  })

  it('still accepts the token after the 30-day web session lifetime', async () => {
    seedUser()
    const { auth } = await clientLogin()
    vi.useFakeTimers({ now: Date.now() + 45 * 86_400_000, toFake: ['Date'] })
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/reader/api/0/user-info',
        headers: { authorization: `GoogleLogin auth=${auth}` },
      })
      expect(res.statusCode).toBe(200)
    } finally {
      vi.useRealTimers()
    }
  })

  it('still rejects the token once the password changes (token_version bump)', async () => {
    seedUser()
    const { auth } = await clientLogin()
    getDb().prepare('UPDATE users SET token_version = token_version + 1').run()
    const res = await app.inject({
      method: 'GET',
      url: '/reader/api/0/user-info',
      headers: { authorization: `GoogleLogin auth=${auth}` },
    })
    expect(res.statusCode).toBe(401)
  })
})

// ── ClientLogin failure limiter and GET login (both prefixes) ────────────────

describe.each([
  ['root', ''],
  ['FreshRSS prefix', '/api/greader.php'],
])('ClientLogin limiter and GET login (%s)', (_name, prefix) => {
  const loginUrl = `${prefix}/accounts/ClientLogin`

  function postLogin(email: string, password: string, ip = '203.0.113.7') {
    return app.inject({
      method: 'POST',
      url: loginUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip },
      payload: `Email=${encodeURIComponent(email)}&Passwd=${encodeURIComponent(password)}`,
    })
  }

  function getLogin(email: string, password: string, ip = '203.0.113.7') {
    return app.inject({
      method: 'GET',
      url: `${loginUrl}?Email=${encodeURIComponent(email)}&Passwd=${encodeURIComponent(password)}`,
      headers: { 'cf-connecting-ip': ip },
    })
  }

  async function failTimes(n: number, email = 'test@example.com', ip?: string) {
    for (let i = 0; i < n; i++) {
      const res = await postLogin(email, 'wrongpassword', ip)
      expect(res.statusCode).toBe(401)
    }
  }

  function expectTooManyRequests(res: Awaited<ReturnType<typeof postLogin>>, maxSeconds = 900) {
    expect(res.statusCode).toBe(429)
    expect(res.headers['content-type']).toBe('text/plain; charset=UTF-8')
    expect(res.body).toBe('Too Many Requests\n')
    const retryAfter = res.headers['retry-after']
    expect(retryAfter).toMatch(/^\d+$/)
    expect(Number(retryAfter)).toBeGreaterThan(0)
    expect(Number(retryAfter)).toBeLessThanOrEqual(maxSeconds)
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows many successful logins in a row (no per-request login limit)', async () => {
    seedUser()
    for (let i = 0; i < 12; i++) {
      const res = await postLogin('test@example.com', 'password123')
      expect(res.statusCode).toBe(200)
    }
  })

  it('returns 429 with Retry-After after 10 failed attempts', async () => {
    seedUser()
    await failTimes(10)
    expectTooManyRequests(await postLogin('test@example.com', 'wrongpassword'))
  })

  it('keeps returning 429 for the correct password until the window expires', async () => {
    seedUser()
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] })
    await failTimes(10)
    expectTooManyRequests(await postLogin('test@example.com', 'password123'))

    vi.setSystemTime(Date.now() + 14 * 60_000)
    expectTooManyRequests(await postLogin('test@example.com', 'password123'), 60)

    vi.setSystemTime(Date.now() + 60_000)
    expect((await postLogin('test@example.com', 'password123')).statusCode).toBe(200)
  })

  it('a successful login before the limit resets the counter', async () => {
    seedUser()
    await failTimes(9)
    expect((await postLogin('test@example.com', 'password123')).statusCode).toBe(200)
    await failTimes(9)
    expect((await postLogin('test@example.com', 'password123')).statusCode).toBe(200)
  })

  it('counts the email case-insensitively', async () => {
    seedUser()
    await failTimes(5, 'test@example.com')
    await failTimes(5, 'TEST@Example.COM')
    expectTooManyRequests(await postLogin('Test@Example.com', 'password123'))
  })

  it('gives a different email from the same IP its own bucket', async () => {
    seedUser()
    seedUser('other@example.com')
    await failTimes(10, 'test@example.com')
    expect((await postLogin('other@example.com', 'password123')).statusCode).toBe(200)
  })

  it('gives the same email from a different IP its own bucket', async () => {
    seedUser()
    await failTimes(10, 'test@example.com', '203.0.113.7')
    expect((await postLogin('test@example.com', 'password123', '198.51.100.9')).statusCode).toBe(200)
  })

  it('accepts GET with Email/Passwd query parameters and returns the same body as POST', async () => {
    seedUser()
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] })
    const post = await postLogin('test@example.com', 'password123')
    const get = await getLogin('test@example.com', 'password123')
    expect(get.statusCode).toBe(200)
    expect(get.headers['content-type']).toBe(post.headers['content-type'])
    expect(get.body).toBe(post.body)
    const auth = get.body.match(/Auth=(.+)/)?.[1]?.trim()
    const userInfo = await app.inject({
      method: 'GET',
      url: `${prefix}/reader/api/0/user-info`,
      headers: { authorization: `GoogleLogin auth=${auth}` },
    })
    expect(userInfo.statusCode).toBe(200)
  })

  it('GET with a wrong password fails like POST and counts toward the same limit', async () => {
    seedUser()
    const res = await getLogin('test@example.com', 'wrongpassword')
    expect(res.statusCode).toBe(401)
    expect(res.body).toBe('Unauthorized!')
    await failTimes(9)
    expectTooManyRequests(await getLogin('test@example.com', 'password123'))
  })

  it('returns 400 when GET has no credentials', async () => {
    const res = await app.inject({ method: 'GET', url: loginUrl })
    expect(res.statusCode).toBe(400)
  })
})

describe.each([
  ['root', ''],
  ['FreshRSS prefix', '/api/greader.php'],
])('global rate limit (%s)', (_name, prefix) => {
  // Mirror server/index.ts: 300/min per client, reader routes exempt.
  beforeEach(async () => {
    await app.close()
    app = await buildApp({
      rateLimit: { max: 300, timeWindow: '1 minute', allowList: isRateLimitExempt, keyGenerator: rateLimitKey },
    })
  })

  it('does not limit authenticated reader routes: 301 tag/list requests all return 200', async () => {
    seedUser()
    const login = await app.inject({
      method: 'POST',
      url: `${prefix}/accounts/ClientLogin`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'Email=test%40example.com&Passwd=password123',
    })
    const auth = login.body.match(/Auth=(.+)/)?.[1]?.trim()
    const codes = new Set<number>()
    for (let i = 0; i < 301; i++) {
      const res = await app.inject({
        method: 'GET',
        url: `${prefix}/reader/api/0/tag/list?output=json`,
        headers: { authorization: `GoogleLogin auth=${auth}` },
      })
      codes.add(res.statusCode)
    }
    expect([...codes]).toEqual([200])
  })

  it('still limits ClientLogin globally', async () => {
    const codes: number[] = []
    for (let i = 0; i < 301; i++) {
      const res = await app.inject({ method: 'GET', url: `${prefix}/accounts/ClientLogin` })
      codes.push(res.statusCode)
    }
    expect(codes.slice(0, 300).every((c) => c === 400)).toBe(true)
    expect(codes[300]).toBe(429)
  })

  it('still limits the web app API (/api/feeds)', async () => {
    const codes: number[] = []
    for (let i = 0; i < 301; i++) {
      codes.push((await app.inject({ method: 'GET', url: '/api/feeds' })).statusCode)
    }
    expect(codes.slice(0, 300)).not.toContain(429)
    expect(codes[300]).toBe(429)
  })
})

// ── Auth middleware ──────────────────────────────────────────────────────────

describe('/reader/api/0/* auth', () => {
  it('returns 401 with no auth header', async () => {
    const res = await app.inject({ method: 'GET', url: '/reader/api/0/user-info' })
    expect(res.statusCode).toBe(401)
    expect(res.body).toBe('Unauthorized!')
  })

  it('returns 401 with invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reader/api/0/user-info',
      headers: { authorization: 'GoogleLogin auth=not-a-valid-token' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.body).toBe('Unauthorized!')
  })

  // request.url keeps percent-encoding, but routing decodes it: "/%72eader/..."
  // reaches the "/reader/..." handler. The auth check must not be fooled.
  it.each([
    ['GET', '/%72eader/api/0/user-info'],
    ['GET', '/reader/%61pi/0/subscription/list?output=json'],
    ['GET', '/%72eader/api/0/stream/contents/user/-/state/com.google/reading-list'],
    ['GET', '/%72eader/api/0/stream/items/ids?output=json'],
    ['POST', '/%72eader/api/0/edit-tag'],
    ['POST', '/%72eader/api/0/mark-all-as-read'],
  ])('returns 401 for unauthenticated %s %s (percent-encoded path)', async (method, url) => {
    seedUser()
    const res = await app.inject({
      method: method as 'GET' | 'POST',
      url,
      headers: method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {},
      payload: method === 'POST' ? 'i=1&a=user/-/state/com.google/read&s=user/-/state/com.google/reading-list' : undefined,
    })
    expect(res.statusCode).toBe(401)
    expect(res.body).toBe('Unauthorized!')
  })

  // The form parser runs before the auth hook. Copying the value array on
  // every repeated key made a ~240 KB body of `i=1&i=1&...` cost ~20 s of CPU
  // (1 MiB, the body limit, several minutes); parsing must stay linear.
  it.each(['', '/api/greader.php'])('parses a large repeated-field body in linear time before rejecting it unauthenticated (%s)', async (base) => {
    const payload = Array.from({ length: 60_000 }, () => 'i=1').join('&')
    const started = Date.now()
    const res = await app.inject({
      method: 'POST',
      url: `${base}/reader/api/0/stream/items/contents`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload,
    })
    expect(res.statusCode).toBe(401)
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('returns 401 when token_version is bumped', async () => {
    seedUser()
    const { auth } = await clientLogin()

    // Bump token_version to invalidate the issued token
    getDb().prepare('UPDATE users SET token_version = token_version + 1 WHERE email = ?').run('test@example.com')

    const res = await app.inject({
      method: 'GET',
      url: '/reader/api/0/user-info',
      headers: { authorization: `GoogleLogin auth=${auth}` },
    })
    expect(res.statusCode).toBe(401)
    expect(res.body).toBe('Unauthorized!')
  })
})

// ── Read endpoints ───────────────────────────────────────────────────────────

describe('GET /reader/api/0/subscription/list', () => {
  it('returns empty subscriptions when no feeds', async () => {
    seedUser()
    const { auth } = await clientLogin()
    const res = await app.inject({
      method: 'GET',
      url: '/reader/api/0/subscription/list',
      headers: { authorization: `GoogleLogin auth=${auth}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().subscriptions).toEqual([])
  })

  it('returns feeds as subscriptions', async () => {
    seedUser()
    const feed = createFeed({ name: 'My Feed', url: 'https://example.com', rss_url: 'https://example.com/rss' })
    const { auth } = await clientLogin()
    const res = await app.inject({
      method: 'GET',
      url: '/reader/api/0/subscription/list',
      headers: { authorization: `GoogleLogin auth=${auth}` },
    })
    expect(res.statusCode).toBe(200)
    const { subscriptions } = res.json()
    expect(subscriptions).toHaveLength(1)
    expect(subscriptions[0].id).toBe(`feed/${feed.id}`)
    expect(subscriptions[0].title).toBe('My Feed')
  })
})

describe('GET /reader/api/0/unread-count', () => {
  it('returns per-feed, category, and reading-list unread counts', async () => {
    seedUser()
    const category = createCategory('News')
    const categorizedFeed = createFeed({
      name: 'Categorized Feed',
      url: 'https://example.com/categorized',
      rss_url: 'https://example.com/categorized/rss',
      category_id: category.id,
    })
    const uncategorizedFeed = createFeed({
      name: 'Uncategorized Feed',
      url: 'https://example.com/uncategorized',
    })

    insertArticle({
      feed_id: categorizedFeed.id,
      title: 'Unread categorized article',
      url: 'https://example.com/categorized/unread',
      published_at: '2025-01-01T00:00:00Z',
    })
    const readArticleId = insertArticle({
      feed_id: categorizedFeed.id,
      title: 'Read categorized article',
      url: 'https://example.com/categorized/read',
      published_at: '2025-01-02T00:00:00Z',
    })
    getDb().prepare("UPDATE articles SET seen_at = datetime('now') WHERE id = ?").run(readArticleId)
    insertArticle({
      feed_id: uncategorizedFeed.id,
      title: 'Unread uncategorized article',
      url: 'https://example.com/uncategorized/unread',
      published_at: '2025-01-03T00:00:00Z',
    })
    // newestItemTimestampUsec follows arrival time (created_at), so pin it to
    // values that differ from every published_at above.
    const setArrival = getDb().prepare('UPDATE articles SET created_at = ? WHERE url = ?')
    setArrival.run('2025-02-01 00:00:00', 'https://example.com/categorized/unread')
    setArrival.run('2025-02-02 00:00:00', 'https://example.com/categorized/read')
    setArrival.run('2025-02-03 00:00:00', 'https://example.com/uncategorized/unread')

    const { auth } = await clientLogin()
    const res = await app.inject({
      method: 'GET',
      url: '/reader/api/0/unread-count?output=json',
      headers: { authorization: `GoogleLogin auth=${auth}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.max).toBe(2)

    const counts = new Map(body.unreadcounts.map((entry: { id: string }) => [entry.id, entry]))
    expect(counts.get(`feed/${categorizedFeed.id}`)).toEqual({
      id: `feed/${categorizedFeed.id}`,
      count: 1,
      newestItemTimestampUsec: '1738454400000000',
    })
    expect(counts.get('user/-/label/News')).toEqual({
      id: 'user/-/label/News',
      count: 1,
      newestItemTimestampUsec: '1738454400000000',
    })
    expect(counts.get('user/-/state/com.google/reading-list')).toEqual({
      id: 'user/-/state/com.google/reading-list',
      count: 2,
      newestItemTimestampUsec: '1738540800000000',
    })
  })

  it('reports a newly added feed as changed even when its newest article was published long ago', async () => {
    seedUser()
    const feed = createFeed({ name: 'Just Added', url: 'https://example.com/added', rss_url: 'https://example.com/added/rss' })
    const emptyFeed = createFeed({ name: 'No Articles Yet', url: 'https://example.com/empty', rss_url: 'https://example.com/empty/rss' })
    const beforeSec = Math.floor(Date.now() / 1000) - 5
    insertArticle({
      feed_id: feed.id,
      title: 'Backlog article',
      url: 'https://example.com/added/old-post',
      published_at: '2020-06-01T00:00:00Z',
    })

    const { auth } = await clientLogin()
    const res = await app.inject({
      method: 'GET',
      url: '/reader/api/0/unread-count?output=json',
      headers: { authorization: `GoogleLogin auth=${auth}` },
    })

    const counts = new Map<string, { newestItemTimestampUsec: string }>(
      res.json().unreadcounts.map((entry: { id: string }) => [entry.id, entry]),
    )
    const newestSec = Number(counts.get(`feed/${feed.id}`)!.newestItemTimestampUsec) / 1_000_000
    // Arrival time (now), not the 2020 publication date.
    expect(newestSec).toBeGreaterThanOrEqual(beforeSec)
    expect(counts.get(`feed/${emptyFeed.id}`)!.newestItemTimestampUsec).toBe('0')
  })
})

describe('GET /reader/api/0/stream/items/ids', () => {
  it('returns item refs for existing articles', async () => {
    seedUser()
    const feed = createFeed({ name: 'Test Feed', url: 'https://example.com' })
    insertArticle({ feed_id: feed.id, title: 'Article 1', url: 'https://example.com/1', published_at: '2025-01-01T00:00:00Z' })
    const { auth } = await clientLogin()
    const res = await app.inject({
      method: 'GET',
      url: '/reader/api/0/stream/items/ids',
      headers: { authorization: `GoogleLogin auth=${auth}` },
    })
    expect(res.statusCode).toBe(200)
    const { itemRefs } = res.json()
    expect(itemRefs).toHaveLength(1)
    // IDs should be bare decimal strings
    expect(/^\d+$/.test(itemRefs[0].id)).toBe(true)
  })
})

// ── Write endpoints ──────────────────────────────────────────────────────────

describe('POST /reader/api/0/edit-tag', () => {
  it('marks article as read using decimal ID', async () => {
    seedUser()
    const feed = createFeed({ name: 'Test Feed', url: 'https://example.com' })
    const articleId = insertArticle({ feed_id: feed.id, title: 'Test', url: 'https://example.com/a', published_at: '2025-01-01T00:00:00Z' })
    const { auth } = await clientLogin()

    const res = await app.inject({
      method: 'POST',
      url: '/reader/api/0/edit-tag',
      headers: {
        authorization: `GoogleLogin auth=${auth}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `i=${articleId}&a=user/-/state/com.google/read`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('OK')

    // An explicit GReader read action represents an actual read, not merely
    // awareness from scrolling past an article.
    const row = getDb().prepare('SELECT seen_at, read_at FROM articles WHERE id = ?').get(articleId) as {
      seen_at: string | null
      read_at: string | null
    }
    expect(row.seen_at).not.toBeNull()
    expect(row.read_at).not.toBeNull()
  })

  it('marks a read article as unread', async () => {
    seedUser()
    const feed = createFeed({ name: 'Test Feed', url: 'https://example.com' })
    const articleId = insertArticle({ feed_id: feed.id, title: 'Test', url: 'https://example.com/unread', published_at: '2025-01-01T00:00:00Z' })
    getDb().prepare("UPDATE articles SET seen_at = datetime('now'), read_at = datetime('now') WHERE id = ?").run(articleId)
    const { auth } = await clientLogin()

    const res = await app.inject({
      method: 'POST',
      url: '/reader/api/0/edit-tag',
      headers: {
        authorization: `GoogleLogin auth=${auth}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `i=${articleId}&r=user/-/state/com.google/read`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('OK')

    const row = getDb().prepare('SELECT seen_at, read_at FROM articles WHERE id = ?').get(articleId) as {
      seen_at: string | null
      read_at: string | null
    }
    expect(row.seen_at).toBeNull()
    expect(row.read_at).toBeNull()
  })

  it('marks article as starred using tag URI ID', async () => {
    seedUser()
    const feed = createFeed({ name: 'Test Feed', url: 'https://example.com' })
    const articleId = insertArticle({ feed_id: feed.id, title: 'Test', url: 'https://example.com/b', published_at: '2025-01-01T00:00:00Z' })
    const { auth } = await clientLogin()

    // Encode ID as tag URI with hex suffix
    const hexId = articleId.toString(16).padStart(16, '0')
    const tagUri = encodeURIComponent(`tag:google.com,2005:reader/item/${hexId}`)

    const res = await app.inject({
      method: 'POST',
      url: '/reader/api/0/edit-tag',
      headers: {
        authorization: `GoogleLogin auth=${auth}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `i=${tagUri}&a=user/-/state/com.google/starred`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('OK')

    const row = getDb().prepare('SELECT liked_at FROM articles WHERE id = ?').get(articleId) as { liked_at: string | null }
    expect(row.liked_at).not.toBeNull()
  })
})

// ── Stream ordering: newest-arrived first, as FreshRSS does ──────────────────

describe('stream ordering and time filters', () => {
  const READING_LIST = 'user/-/state/com.google/reading-list'

  /**
   * 150 recently published articles that reached the server a day ago, then a
   * feed subscribed just now whose three backlog articles were published years
   * earlier.
   */
  function seedEstablishedFeedThenNewFeed(): { backlogIds: number[]; addedFeedId: number } {
    const established = createFeed({ name: 'Established', url: 'https://example.com/old', rss_url: 'https://example.com/old/rss' })
    for (let i = 0; i < 150; i++) {
      insertArticle({
        feed_id: established.id,
        title: `Recent ${i}`,
        url: `https://example.com/old/${i}`,
        published_at: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
      })
    }
    getDb().prepare("UPDATE articles SET created_at = '2026-09-30 12:00:00'").run()

    const added = createFeed({ name: 'Just Added', url: 'https://example.com/new', rss_url: 'https://example.com/new/rss' })
    const backlogIds = [0, 1, 2].map((i) => insertArticle({
      feed_id: added.id,
      title: `Backlog ${i}`,
      url: `https://example.com/new/${i}`,
      published_at: `2020-01-0${i + 1}T00:00:00Z`,
    }))
    getDb().prepare("UPDATE articles SET created_at = '2026-10-01 12:00:00' WHERE feed_id = ?").run(added.id)
    return { backlogIds, addedFeedId: added.id }
  }

  async function get(url: string, auth: string | null) {
    const res = await app.inject({ method: 'GET', url, headers: { authorization: `GoogleLogin auth=${auth}` } })
    expect(res.statusCode).toBe(200)
    return res.json()
  }

  it('puts a newly added feed at the head of the reading list even though its articles are old', async () => {
    seedUser()
    const { backlogIds, addedFeedId } = seedEstablishedFeedThenNewFeed()
    const { auth } = await clientLogin()

    // The request a reader app makes on a routine sync: first page, no time filter.
    const body = await get(`/reader/api/0/stream/contents?output=json&s=${READING_LIST}&n=100`, auth)

    expect(body.items).toHaveLength(100)
    const firstThree = body.items.slice(0, 3).map((item: { origin: { streamId: string } }) => item.origin.streamId)
    expect(firstThree).toEqual(Array(3).fill(`feed/${addedFeedId}`))
    expect(body.items.slice(0, 3).map((item: { title: string }) => item.title)).toEqual(['Backlog 2', 'Backlog 1', 'Backlog 0'])
    expect(body.continuation).toBeTruthy()

    // Item IDs follow the same order.
    const ids = await get(`/reader/api/0/stream/items/ids?output=json&s=${READING_LIST}&n=3`, auth)
    expect(ids.itemRefs.map((ref: { id: string }) => Number(ref.id))).toEqual([...backlogIds].reverse())
  })

  it('pages through the whole stream with the continuation token, without gaps or repeats', async () => {
    seedUser()
    seedEstablishedFeedThenNewFeed()
    const { auth } = await clientLogin()

    const seen: string[] = []
    let continuation: string | undefined
    let pages = 0
    let lateTitle = ''
    do {
      const c = continuation ? `&c=${continuation}` : ''
      const body = await get(`/reader/api/0/stream/contents?output=json&s=${READING_LIST}&n=100${c}`, auth)
      seen.push(...body.items.map((item: { id: string }) => item.id))
      continuation = body.continuation
      pages++
      if (pages === 1) {
        // A new article reaches the server while the app is between pages.
        const feed = createFeed({ name: 'Late', url: 'https://example.com/late', rss_url: 'https://example.com/late/rss' })
        lateTitle = 'Arrived between pages'
        insertArticle({ feed_id: feed.id, title: lateTitle, url: 'https://example.com/late/1', published_at: null })
      }
    } while (continuation && pages < 10)

    expect(pages).toBe(2)
    expect(seen).toHaveLength(153)
    expect(new Set(seen).size).toBe(153)
    // The late article is newer than the walk's start, so it belongs to the next sync's head.
    const head = await get(`/reader/api/0/stream/contents?output=json&s=${READING_LIST}&n=1`, auth)
    expect(head.items[0].title).toBe(lateTitle)
    expect(seen).not.toContain(head.items[0].id)
  })

  it('applies ot and nt to arrival time, on both stream endpoints', async () => {
    seedUser()
    const { backlogIds } = seedEstablishedFeedThenNewFeed()
    const { auth } = await clientLogin()
    const cutoff = Math.floor(Date.UTC(2026, 9, 1, 0, 0, 0) / 1000) // between the two arrival times

    const since = await get(`/reader/api/0/stream/contents?output=json&s=${READING_LIST}&n=100&ot=${cutoff}`, auth)
    expect(since.items.map((item: { title: string }) => item.title).sort()).toEqual(['Backlog 0', 'Backlog 1', 'Backlog 2'])
    expect(since.continuation).toBeUndefined()

    const until = await get(`/reader/api/0/stream/contents?output=json&s=${READING_LIST}&n=100&nt=${cutoff}`, auth)
    expect(until.items).toHaveLength(100)
    expect(until.items.every((item: { title: string }) => item.title.startsWith('Recent'))).toBe(true)

    // ot is applied before the limit: a small n must not hide matching items.
    const ids = await get(`/reader/api/0/stream/items/ids?output=json&s=${READING_LIST}&n=2&ot=${cutoff}`, auth)
    expect(ids.itemRefs).toHaveLength(2)
    expect(ids.itemRefs.every((ref: { id: string }) => backlogIds.includes(Number(ref.id)))).toBe(true)
  })

  it('returns oldest-arrived first when r=o', async () => {
    seedUser()
    seedEstablishedFeedThenNewFeed()
    const { auth } = await clientLogin()

    const body = await get(`/reader/api/0/stream/contents?output=json&s=${READING_LIST}&n=100&r=o`, auth)

    expect(body.items[0].title).toBe('Recent 0')
    expect(body.items.some((item: { title: string }) => item.title.startsWith('Backlog'))).toBe(false)
  })

  it('still honours the unread filter and per-feed streams', async () => {
    seedUser()
    const { backlogIds } = seedEstablishedFeedThenNewFeed()
    getDb().prepare("UPDATE articles SET seen_at = datetime('now') WHERE id = ?").run(backlogIds[2])
    const { auth } = await clientLogin()

    const unread = await get(`/reader/api/0/stream/items/ids?output=json&s=${READING_LIST}&n=10000&xt=user/-/state/com.google/read`, auth)
    expect(unread.itemRefs).toHaveLength(152)
    expect(unread.itemRefs.map((ref: { id: string }) => Number(ref.id))).not.toContain(backlogIds[2])

    const feedStream = await get(`/reader/api/0/stream/contents?output=json&s=${encodeURIComponent('feed/https://example.com/new/rss')}&n=100`, auth)
    expect(feedStream.items).toHaveLength(3)
  })
})

// ── Pagination and caps (WP2) ────────────────────────────────────────────────

describe.each([
  { label: 'root', base: '' },
  { label: '/api/greader.php', base: '/api/greader.php' },
])('pagination and caps ($label)', ({ base }) => {
  const READING_LIST = 'user/-/state/com.google/reading-list'
  const API = `${base}/reader/api/0`
  const BASE_SEC = Date.UTC(2026, 9, 2) / 1000

  /**
   * `count` articles in one feed. Arrival times advance one second every
   * three articles, so ties on created_at exercise the id tiebreak.
   */
  function seedArticles(count: number, opts: { feedId?: number; startSec?: number; tag?: string } = {}): number[] {
    const feedId = opts.feedId ?? createFeed({ name: 'Bulk', url: 'https://bulk.example.com', rss_url: 'https://bulk.example.com/rss' }).id
    const startSec = opts.startSec ?? BASE_SEC
    const tag = opts.tag ?? 'a'
    const db = getDb()
    const setArrival = db.prepare("UPDATE articles SET created_at = datetime(?, 'unixepoch') WHERE id = ?")
    return db.transaction(() => Array.from({ length: count }, (_, i) => {
      const id = insertArticle({ feed_id: feedId, title: `Bulk ${tag}${i}`, url: `https://bulk.example.com/${tag}/${i}`, published_at: '2021-01-01T00:00:00Z' })
      setArrival.run(startSec + Math.floor(i / 3), id)
      return id
    }))()
  }

  /** All article ids ordered by arrival, newest first (or oldest first). */
  function arrivalOrder(ascending = false): number[] {
    const dir = ascending ? 'ASC' : 'DESC'
    return (getDb().prepare(`SELECT id FROM articles ORDER BY created_at ${dir}, id ${dir}`).all() as { id: number }[]).map((r) => r.id)
  }

  let auth: string | null = null
  beforeEach(async () => {
    seedUser()
    auth = (await clientLogin()).auth
  })

  async function get(path: string) {
    const res = await app.inject({ method: 'GET', url: `${API}${path}`, headers: { authorization: `GoogleLogin auth=${auth}` } })
    expect(res.statusCode).toBe(200)
    return res.json()
  }

  async function postItems(ids: string[], query = '') {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/stream/items/contents${query}`,
      headers: { authorization: `GoogleLogin auth=${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      payload: ids.map((id) => `i=${encodeURIComponent(id)}`).join('&'),
    })
    expect(res.statusCode).toBe(200)
    return res.json()
  }

  const itemNumericId = (item: { id: string }) => parseInt(item.id.split('/').pop()!, 16)

  type Endpoint = { name: string; path: string; ids: (body: Record<string, unknown>) => number[] }
  const ENDPOINTS: Endpoint[] = [
    {
      name: 'stream/items/ids',
      path: `/stream/items/ids?output=json&s=${READING_LIST}`,
      ids: (body) => (body.itemRefs as { id: string }[]).map((ref) => Number(ref.id)),
    },
    {
      name: 'stream/contents',
      path: `/stream/contents?output=json&s=${READING_LIST}`,
      ids: (body) => (body.items as { id: string }[]).map(itemNumericId),
    },
  ]

  /** Follow continuations from the first page; `between` runs after each page. */
  async function walk(endpoint: Endpoint, query: string, between?: (page: number) => void) {
    const pages: { ids: number[]; continuation: unknown; hasKey: boolean }[] = []
    let continuation: string | undefined
    do {
      const c = continuation ? `&c=${encodeURIComponent(continuation)}` : ''
      const body = await get(`${endpoint.path}${query}${c}`)
      pages.push({ ids: endpoint.ids(body), continuation: body.continuation, hasKey: 'continuation' in body })
      continuation = body.continuation as string | undefined
      between?.(pages.length)
    } while (continuation && pages.length < 20)
    return pages
  }

  describe.each(ENDPOINTS)('$name', (endpoint) => {
    it('pages 2,500 articles at n=1000 as 1000/1000/500, with a continuation on the first two pages only', async () => {
      seedArticles(2500)
      const pages = await walk(endpoint, '&n=1000')
      expect(pages.map((p) => p.ids.length)).toEqual([1000, 1000, 500])
      expect(pages.map((p) => p.hasKey)).toEqual([true, true, false])
      for (const p of pages.slice(0, 2)) expect(p.continuation).toEqual(expect.stringMatching(/.+/))
      expect(pages.flatMap((p) => p.ids)).toEqual(arrivalOrder())
    }, 30_000)

    it('ends a stream of exactly n=1000 with an empty page that has no continuation', async () => {
      seedArticles(1000)
      const pages = await walk(endpoint, '&n=1000')
      expect(pages.map((p) => p.ids.length)).toEqual([1000, 0])
      expect(pages[0].continuation).toEqual(expect.stringMatching(/.+/))
      expect(pages[1].hasKey).toBe(false)
    })

    it('neither repeats nor skips an item when articles arrive between pages (newest first)', async () => {
      const feedId = createFeed({ name: 'Bulk', url: 'https://bulk.example.com', rss_url: 'https://bulk.example.com/rss' }).id
      seedArticles(45, { feedId })
      const expected = arrivalOrder()
      // Newer arrivals after page 1, and one sharing the arrival second of the
      // page-1 boundary (it gets a higher id, so it sorts before the cursor).
      const pages = await walk(endpoint, '&n=20', (page) => {
        if (page !== 1) return
        seedArticles(5, { feedId, startSec: BASE_SEC + 3600, tag: 'late' })
        const boundary = getDb().prepare('SELECT created_at FROM articles WHERE id = ?').get(expected[19]) as { created_at: string }
        const tie = insertArticle({ feed_id: feedId, title: 'Tie', url: 'https://bulk.example.com/tie', published_at: null })
        getDb().prepare('UPDATE articles SET created_at = ? WHERE id = ?').run(boundary.created_at, tie)
      })
      const seen = pages.flatMap((p) => p.ids)
      expect(seen).toEqual(expected)
      expect(pages.map((p) => p.ids.length)).toEqual([20, 20, 5])
    })

    it('walks oldest first with r=o, with the same guarantees, and picks up later arrivals at the end', async () => {
      const feedId = createFeed({ name: 'Bulk', url: 'https://bulk.example.com', rss_url: 'https://bulk.example.com/rss' }).id
      seedArticles(40, { feedId })
      const expected = arrivalOrder(true)
      let late: number[] = []
      const pages = await walk(endpoint, '&n=20&r=o', (page) => {
        if (page === 1) late = seedArticles(3, { feedId, startSec: BASE_SEC + 3600, tag: 'late' })
      })
      const seen = pages.flatMap((p) => p.ids)
      expect(seen).toEqual([...expected, ...late])
      expect(new Set(seen).size).toBe(43)
      expect(pages.map((p) => p.ids.length)).toEqual([20, 20, 3])
      expect(pages[2].hasKey).toBe(false)
    })

    it('defaults n to 20', async () => {
      seedArticles(25)
      const first = await get(endpoint.path)
      expect(endpoint.ids(first)).toEqual(arrivalOrder().slice(0, 20))
      expect(first.continuation).toEqual(expect.stringMatching(/.+/))
    })

    it('never emits an empty-string continuation, and treats an unreadable one as the first page', async () => {
      seedArticles(3)
      const body = await get(`${endpoint.path}&n=20`)
      expect(body).not.toHaveProperty('continuation')
      // A pre-cursor offset token ("MTAw" = base64 of "100") restarts the stream.
      const legacy = await get(`${endpoint.path}&n=20&c=MTAw`)
      expect(endpoint.ids(legacy)).toEqual(arrivalOrder())
    })
  })

  it('honours n up to 10000 on stream/items/ids', async () => {
    seedArticles(10_001)
    const all = await get(`${ENDPOINTS[0].path}&n=10000`)
    expect(all.itemRefs).toHaveLength(10_000)
    expect(all.continuation).toEqual(expect.stringMatching(/.+/))
    const capped = await get(`${ENDPOINTS[0].path}&n=20000`)
    expect(capped.itemRefs).toHaveLength(10_000)
    const rest = await get(`${ENDPOINTS[0].path}&n=10000&c=${encodeURIComponent(all.continuation)}`)
    expect(rest.itemRefs).toHaveLength(1)
    expect(rest).not.toHaveProperty('continuation')
  }, 30_000) // seeding 10,001 articles takes a few seconds

  it('honours n=1000 on stream/contents and caps n=5000 to 1000', async () => {
    seedArticles(1200)
    expect((await get(`${ENDPOINTS[1].path}&n=1000`)).items).toHaveLength(1000)
    const capped = await get(`${ENDPOINTS[1].path}&n=5000`)
    expect(capped.items).toHaveLength(1000)
    expect(capped.continuation).toEqual(expect.stringMatching(/.+/))
  })

  it.each([250, 1500])('returns every item of a %i-ID stream/items/contents request, newest arrival first', async (count) => {
    const ids = seedArticles(count)
    // Request in an unrelated order, tag form for half of them.
    const request = [...ids].reverse().map((id, i) => (i % 2 === 0
      ? `tag:google.com,2005:reader/item/${id.toString(16).padStart(16, '0')}`
      : String(id)))
    const body = await postItems(request)
    expect(body.items.map(itemNumericId)).toEqual(arrivalOrder())
  }, 30_000)

  it('returns stream/items/contents oldest arrival first with r=o', async () => {
    const ids = seedArticles(300)
    const body = await postItems(ids.map(String), '?r=o')
    expect(body.items.map(itemNumericId)).toEqual(arrivalOrder(true))
  })

  it('returns each item once when stream/items/contents repeats an ID', async () => {
    const [first, second] = seedArticles(2)
    const body = await postItems([String(first), String(second), String(first)])
    expect(body.items.map(itemNumericId)).toEqual([second, first])
  })
})

// ── Article links ────────────────────────────────────────────────────────────

describe('article links for reader apps', () => {
  const FEED_RSS = 'http://192.168.1.50:3100/api/feeds/newsletter'

  async function linkOf(articleId: number): Promise<{ canonical: string; alternate: string }> {
    const { auth } = await clientLogin()
    const res = await app.inject({
      method: 'POST',
      url: '/reader/api/0/stream/items/contents',
      headers: {
        authorization: `GoogleLogin auth=${auth}`,
        'content-type': 'application/x-www-form-urlencoded',
        host: 'rss.example.com',
      },
      payload: `i=${articleId}`,
    })
    expect(res.statusCode).toBe(200)
    const [item] = res.json().items
    return { canonical: item.canonical[0].href, alternate: item.alternate[0].href }
  }

  it('uses the article URL for an ordinary article', async () => {
    seedUser()
    const feed = createFeed({ name: 'Blog', url: 'https://blog.example.com', rss_url: 'https://blog.example.com/feed.xml' })
    const id = insertArticle({ feed_id: feed.id, title: 'Post', url: 'https://blog.example.com/post', published_at: '2025-01-01T00:00:00Z' })

    expect(await linkOf(id)).toEqual({ canonical: 'https://blog.example.com/post', alternate: 'https://blog.example.com/post' })
  })

  it('keeps the page URL of an anchor-link article on some other page', async () => {
    seedUser()
    const feed = createFeed({ name: 'Changelog', url: 'https://example.com', rss_url: 'https://example.com/changelog.xml' })
    const id = insertArticle({ feed_id: feed.id, title: '2.1.74', url: 'https://example.com/changelog#2-1-74', published_at: '2025-01-01T00:00:00Z' })

    expect((await linkOf(id)).alternate).toBe('https://example.com/changelog#2-1-74')
  })

  it('uses the original post for an inline feed entry that has one', async () => {
    seedUser()
    const feed = createFeed({ name: 'Newsletter', url: 'http://192.168.1.50:3100', rss_url: FEED_RSS })
    const id = insertArticle({
      feed_id: feed.id,
      title: 'Issue',
      url: `${FEED_RSS}#urn:letterfeed:entry:123`,
      published_at: '2025-01-01T00:00:00Z',
      source_url: 'https://open.substack.com/pub/example/p/the-issue',
    })

    expect(await linkOf(id)).toEqual({
      canonical: 'https://open.substack.com/pub/example/p/the-issue',
      alternate: 'https://open.substack.com/pub/example/p/the-issue',
    })
  })

  it("falls back to this server's own article page, never the private feed address", async () => {
    seedUser()
    const feed = createFeed({ name: 'Newsletter', url: 'http://192.168.1.50:3100', rss_url: FEED_RSS })
    const id = insertArticle({
      feed_id: feed.id,
      title: 'Issue',
      url: `${FEED_RSS}#urn:letterfeed:entry:124`,
      published_at: '2025-01-01T00:00:00Z',
    })

    const { canonical, alternate } = await linkOf(id)
    expect(alternate).toBe('http://rss.example.com/http/192.168.1.50:3100/api/feeds/newsletter%23urn:letterfeed:entry:124')
    expect(canonical).toBe(alternate)
  })
})

// ── Feed websites ────────────────────────────────────────────────────────────

describe('feed website (htmlUrl) for newsletter feeds sharing one host', () => {
  const BRIDGE = 'http://192.168.1.50:3100'

  function newsletterFeed(slug: string, name: string) {
    return createFeed({ name, url: `${BRIDGE}/api/feeds/${slug}`, rss_url: `${BRIDGE}/api/feeds/${slug}` })
  }

  function issue(feed: { id: number; rss_url: string | null }, n: number, sourceUrl?: string): number {
    return insertArticle({
      feed_id: feed.id,
      title: `Issue ${n}`,
      url: `${feed.rss_url}#urn:letterfeed:entry:${feed.id}-${n}`,
      published_at: '2025-01-01T00:00:00Z',
      source_url: sourceUrl,
    })
  }

  async function subscriptions(): Promise<Map<string, string>> {
    const { auth } = await clientLogin()
    const res = await app.inject({
      method: 'GET',
      url: '/reader/api/0/subscription/list?output=json',
      headers: { authorization: `GoogleLogin auth=${auth}`, host: 'rss.example.com' },
    })
    expect(res.statusCode).toBe(200)
    return new Map(res.json().subscriptions.map((sub: { title: string; htmlUrl: string }) => [sub.title, sub.htmlUrl]))
  }

  it('gives every newsletter feed its own website instead of the shared bridge host', async () => {
    seedUser()
    const gems = newsletterFeed('growth-gems', 'Growth Gems')
    const lenny = newsletterFeed('lenny', "Lenny's Newsletter")
    const howIAi = newsletterFeed('how-i-ai', 'How I AI')
    const plain = newsletterFeed('other', 'No Post Links')
    issue(gems, 1, 'https://open.substack.com/pub/growthgems/p/one')
    issue(lenny, 1, 'https://open.substack.com/pub/lenny/p/one')
    issue(lenny, 2, 'https://open.substack.com/pub/lenny/p/two')
    issue(lenny, 3, 'https://open.substack.com/pub/theskip/p/a-cross-post')
    issue(howIAi, 1, 'https://open.substack.com/pub/lenny/p/how-i-ai-one')
    issue(plain, 1)

    const sites = await subscriptions()

    expect(sites.get('Growth Gems')).toBe(`https://growthgems.substack.com/#feed-${gems.id}`)
    // The publication most of the feed's articles come from, not the cross-post's.
    expect(sites.get("Lenny's Newsletter")).toBe(`https://lenny.substack.com/#feed-${lenny.id}`)
    // Same publication as another feed, still a distinct address.
    expect(sites.get('How I AI')).toBe(`https://lenny.substack.com/#feed-${howIAi.id}`)
    // No post link known: this server's page for the feed, never the bridge.
    expect(sites.get('No Post Links')).toBe(`http://rss.example.com/feeds/${plain.id}`)

    expect(new Set(sites.values()).size).toBe(4)
    for (const site of sites.values()) expect(site).not.toContain('192.168.1.50')
  })

  it('leaves ordinary feeds on their origin, including anchor-link feeds', async () => {
    seedUser()
    const blog = createFeed({ name: 'Blog', url: 'https://blog.example.com', rss_url: 'https://blog.example.com/feed.xml' })
    const changelog = createFeed({ name: 'Changelog', url: 'https://example.com/changelog', rss_url: 'https://example.com/changelog.xml' })
    insertArticle({ feed_id: blog.id, title: 'Post', url: 'https://blog.example.com/post', published_at: '2025-01-01T00:00:00Z' })
    insertArticle({ feed_id: changelog.id, title: '2.1.74', url: 'https://example.com/changelog#2-1-74', published_at: '2025-01-01T00:00:00Z' })

    const sites = await subscriptions()

    expect(sites.get('Blog')).toBe('https://blog.example.com')
    expect(sites.get('Changelog')).toBe('https://example.com')
  })

  it("reports the same website on each article's origin as on its subscription", async () => {
    seedUser()
    const gems = newsletterFeed('growth-gems', 'Growth Gems')
    const articleId = issue(gems, 1, 'https://open.substack.com/pub/growthgems/p/one')
    const sites = await subscriptions()
    const { auth } = await clientLogin()

    const res = await app.inject({
      method: 'POST',
      url: '/reader/api/0/stream/items/contents',
      headers: {
        authorization: `GoogleLogin auth=${auth}`,
        'content-type': 'application/x-www-form-urlencoded',
        host: 'rss.example.com',
      },
      payload: `i=${articleId}`,
    })

    const [item] = res.json().items
    expect(item.origin.htmlUrl).toBe(sites.get('Growth Gems'))
    expect(item.origin.streamId).toBe(`feed/${gems.id}`)
  })
})

// ── WP3: item IDs, arrival timestamps, tag edits, state streams ──────────────

describe('decodeItemId (FreshRSS rule)', () => {
  it.each([
    ['0000000000001000', 4096], // all digits but a leading zero: hex
    ['1000', 1000], // all digits, no leading zero: decimal (stream/items/ids form)
    ['tag:google.com,2005:reader/item/000000000000000f', 15],
    ['tag:google.com,2005:reader/item/0000000000001000', 4096],
    ['abc', 2748], // not all digits: hex
    ['00000000000000ff', 255],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
  ])('%s → %d', (raw, expected) => {
    expect(decodeItemId(raw)).toBe(expected)
  })

  it.each([
    '5d0cfa30041d4348', // a FreshRSS µs-timestamp ID: beyond the safe integer range
    'fb115bd6d34a8e9f', // above 0x7fff… (two's-complement negative in some clients)
    '9007199254740992', // MAX_SAFE_INTEGER + 1
    '0', '0000000000000000', // not a positive ID
    '00000000000000001', // 17 hex digits
    'xyz', '', '-1', '12.5',
    'tag:google.com,2005:reader/item/', 'tag:google.com,2005:reader/item/zz',
  ])('rejects %j', (raw) => {
    expect(decodeItemId(raw)).toBeNull()
  })
})

describe.each([
  ['root', ''],
  ['FreshRSS prefix', '/api/greader.php'],
])('WP3 behaviour (%s)', (_name, prefix) => {
  const API = `${prefix}/reader/api/0`
  const READING_LIST = 'user/-/state/com.google/reading-list'
  const READ = 'user/-/state/com.google/read'
  const UNREAD = 'user/-/state/com.google/unread'
  const STARRED = 'user/-/state/com.google/starred'
  const KEPT_UNREAD = 'user/-/state/com.google/kept-unread'
  const enc = encodeURIComponent

  const token = () => app.jwt.sign({ email: 'test@example.com', token_version: 0 }, { expiresIn: '3650d' })
  const get = (path: string) => app.inject({ method: 'GET', url: `${API}${path}`, headers: { authorization: `GoogleLogin auth=${token()}` } })
  const post = (path: string, form: Record<string, string | string[]>) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(form)) for (const x of Array.isArray(v) ? v : [v]) params.append(k, x)
    return app.inject({
      method: 'POST',
      url: `${API}${path}`,
      headers: { authorization: `GoogleLogin auth=${token()}`, 'content-type': 'application/x-www-form-urlencoded' },
      payload: params.toString(),
    })
  }
  const state = (id: number) => {
    const row = getDb().prepare('SELECT seen_at, liked_at FROM articles WHERE id = ?').get(id) as { seen_at: string | null; liked_at: string | null }
    return { seen_at: row.seen_at, liked_at: row.liked_at }
  }

  /** One unread, one read and one starred (unread) article; published in 2019, arrived in Oct 2026. */
  function seed() {
    seedUser()
    const cat = createCategory('Tech')
    const feed = createFeed({ name: 'Feed Name', url: 'https://example.com', rss_url: 'https://example.com/rss', category_id: cat.id })
    const other = createFeed({ name: 'Other', url: 'https://other.example.com' })
    const unread = insertArticle({ feed_id: feed.id, title: 'Unread', url: 'https://example.com/u', published_at: '2019-06-01T12:00:00Z' })
    const read = insertArticle({ feed_id: feed.id, title: 'Read', url: 'https://example.com/r', published_at: '2019-06-02T12:00:00Z' })
    const starred = insertArticle({ feed_id: other.id, title: 'Starred', url: 'https://other.example.com/s', published_at: '2019-06-03T12:00:00Z' })
    const db = getDb()
    db.prepare("UPDATE articles SET seen_at = datetime('now'), read_at = datetime('now') WHERE id = ?").run(read)
    db.prepare("UPDATE articles SET liked_at = datetime('now') WHERE id = ?").run(starred)
    const arrive = db.prepare('UPDATE articles SET created_at = ? WHERE id = ?')
    arrive.run('2026-10-01 08:00:00', unread)
    arrive.run('2026-10-01 08:30:00', read)
    arrive.run('2026-10-01 09:00:00', starred)
    return { cat, feed, other, unread, read, starred }
  }
  const items = async (ids: number[]) => (await post('/stream/items/contents', { i: ids.map(String) })).json().items as Record<string, unknown>[]
  const refIds = async (query: string) => ((await get(`/stream/items/ids?${query}`)).json().itemRefs as { id: string }[]).map((r) => Number(r.id))
  const contentIds = async (query: string) => ((await get(`/stream/contents?${query}`)).json().items as { id: string }[]).map((i) => decodeItemId(i.id))

  describe.each(['UTC', 'Europe/Amsterdam'])('timestamps with TZ=%s', (tz) => {
    const savedTz = process.env.TZ
    beforeEach(() => { process.env.TZ = tz })
    afterEach(() => {
      if (savedTz === undefined) delete process.env.TZ
      else process.env.TZ = savedTz
    })

    it('reports arrival in crawlTimeMsec and timestampUsec (items and itemRefs) and publication in published', async () => {
      const { unread } = seed()
      const arrivalMs = Date.UTC(2026, 9, 1, 8, 0, 0)
      const [item] = await items([unread])
      expect(item.crawlTimeMsec).toBe(String(arrivalMs))
      expect(item.timestampUsec).toBe(String(arrivalMs * 1000))
      expect(item.timestampUsec).toBe(`${item.crawlTimeMsec as string}000`)
      expect(item.published).toBe(Date.UTC(2019, 5, 1, 12) / 1000)
      expect(item).toHaveProperty('updated')

      const refs = (await get(`/stream/items/ids?s=${enc(READING_LIST)}&n=100`)).json().itemRefs as { id: string; timestampUsec: string }[]
      expect(refs.find((r) => Number(r.id) === unread)!.timestampUsec).toBe(item.timestampUsec)

      const fromContents = ((await get(`/stream/contents?s=${enc(READING_LIST)}`)).json().items as Record<string, unknown>[])
        .find((i) => decodeItemId(i.id as string) === unread)!
      expect(fromContents.crawlTimeMsec).toBe(item.crawlTimeMsec)
    })

    it('reports arrival in unread-count newestItemTimestampUsec', async () => {
      seed()
      const rows = (await get('/unread-count')).json().unreadcounts as { id: string; newestItemTimestampUsec: string }[]
      expect(rows.at(-1)!.newestItemTimestampUsec).toBe(String(Date.UTC(2026, 9, 1, 9) * 1000))
    })

    it('mark-all-as-read ts compares with arrival in UTC', async () => {
      const { unread, starred } = seed()
      const ts = String(Date.UTC(2026, 9, 1, 8, 0, 0) * 1000)
      expect((await post('/mark-all-as-read', { s: READING_LIST, ts })).body).toBe('OK')
      expect(state(unread).seen_at).not.toBeNull()
      expect(state(starred).seen_at).toBeNull()
    })
  })

  describe('item fields', () => {
    it('omits author (no article author is stored) instead of using the feed name', async () => {
      const { unread } = seed()
      const [item] = await items([unread])
      expect(item).not.toHaveProperty('author')
      expect(JSON.stringify(item)).toContain('"title":"Feed Name"') // origin.title still names the feed
    })

    it('lists reading-list, read, starred and the feed label in categories', async () => {
      const { unread, read, starred, cat } = seed()
      const byId = new Map((await items([unread, read, starred])).map((i) => [decodeItemId(i.id as string), i.categories]))
      expect(byId.get(unread)).toEqual([READING_LIST, `user/-/label/${cat.name}`])
      expect(byId.get(read)).toEqual([READING_LIST, READ, `user/-/label/${cat.name}`])
      expect(byId.get(starred)).toEqual([READING_LIST, STARRED])
    })

    it('keeps the Google-era summary.direction and alternate[].type keys', async () => {
      const { unread } = seed()
      const [item] = await items([unread])
      expect(item.summary).toEqual(expect.objectContaining({ direction: 'ltr' }))
      expect(item.alternate).toEqual([expect.objectContaining({ type: 'text/html' })])
    })
  })

  describe('edit-tag', () => {
    it('applies repeated a= values in one request', async () => {
      const { unread } = seed()
      const res = await post('/edit-tag', { i: String(unread), a: [READ, STARRED] })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toMatch(/^text\/plain/)
      expect(res.body).toBe('OK')
      expect(state(unread).seen_at).not.toBeNull()
      expect(state(unread).liked_at).not.toBeNull()
    })

    it('applies repeated r= values in one request', async () => {
      const { read, starred } = seed()
      expect((await post('/edit-tag', { i: [String(read), String(starred)], r: [READ, STARRED] })).body).toBe('OK')
      expect(state(read)).toEqual({ seen_at: null, liked_at: null })
      expect(state(starred)).toEqual({ seen_at: null, liked_at: null })
    })

    it('marks unread with a=kept-unread', async () => {
      const { read } = seed()
      expect((await post('/edit-tag', { i: String(read), a: KEPT_UNREAD })).body).toBe('OK')
      expect(state(read).seen_at).toBeNull()
    })

    it('ignores a user label and the reading-list state, still answering OK', async () => {
      const { unread } = seed()
      expect((await post('/edit-tag', { i: String(unread), a: ['user/-/label/Later', READING_LIST] })).body).toBe('OK')
      expect(state(unread)).toEqual({ seen_at: null, liked_at: null })
    })

    it('decodes a zero-padded all-digit ID as hex', async () => {
      const { unread, read } = seed()
      getDb().prepare('UPDATE articles SET id = ? WHERE id = ?').run(16, unread)
      getDb().prepare('UPDATE articles SET id = ? WHERE id = ?').run(10, read)
      expect((await post('/edit-tag', { i: '0000000000000010', a: STARRED })).body).toBe('OK')
      expect(state(16).liked_at).not.toBeNull()
      expect(state(10).liked_at).toBeNull()
    })
  })

  describe('mark-all-as-read', () => {
    it('ts excludes an article that arrived later', async () => {
      const { unread, starred, feed } = seed()
      const later = insertArticle({ feed_id: feed.id, title: 'Later', url: 'https://example.com/later', published_at: '2001-01-01T00:00:00Z' })
      getDb().prepare('UPDATE articles SET created_at = ? WHERE id = ?').run('2026-10-02 00:00:00', later)
      const ts = String(Date.UTC(2026, 9, 1, 9) * 1000 + 999_999)
      expect((await post('/mark-all-as-read', { s: READING_LIST, ts })).body).toBe('OK')
      expect(state(unread).seen_at).not.toBeNull()
      expect(state(starred).seen_at).not.toBeNull()
      expect(state(later).seen_at).toBeNull()
    })

    it.each<{ label: string; form: Record<string, string> }>([
      { label: 'absent', form: {} },
      { label: '0', form: { ts: '0' } },
    ])('ts $label means now', async ({ form }) => {
      const { unread, starred } = seed()
      expect((await post('/mark-all-as-read', { s: READING_LIST, ...form })).body).toBe('OK')
      expect(state(unread).seen_at).not.toBeNull()
      expect(state(starred).seen_at).not.toBeNull()
    })

    it.each(['abc', '-1', '1.5', '1e6'])('answers 400 Bad Request! for ts=%j', async (ts) => {
      const { unread } = seed()
      const res = await post('/mark-all-as-read', { s: READING_LIST, ts })
      expect(res.statusCode).toBe(400)
      expect(res.headers['content-type']).toMatch(/^text\/plain/)
      expect(res.body).toBe('Bad Request!')
      expect(state(unread).seen_at).toBeNull()
    })

    it.each([
      { label: 'empty', s: '' },
      { label: 'unknown state', s: 'user/-/state/com.google/broadcast' },
      { label: 'garbage', s: 'nonsense' },
      { label: 'unknown label', s: 'user/-/label/Nope' },
    ])('answers 400 Bad Request! for an $label stream', async ({ s }) => {
      const { unread } = seed()
      const res = await post('/mark-all-as-read', { s })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Bad Request!')
      expect(state(unread).seen_at).toBeNull()
    })

    it('marks only starred items for the starred stream', async () => {
      const { unread, starred } = seed()
      expect((await post('/mark-all-as-read', { s: STARRED })).body).toBe('OK')
      expect(state(starred).seen_at).not.toBeNull()
      expect(state(unread).seen_at).toBeNull()
    })

    it('marks a feed by URL or numeric ID, and a label', async () => {
      const { unread, starred, other, cat } = seed()
      expect((await post('/mark-all-as-read', { s: `feed/${other.id}` })).body).toBe('OK')
      expect(state(starred).seen_at).not.toBeNull()
      expect(state(unread).seen_at).toBeNull()
      expect((await post('/mark-all-as-read', { s: `user/-/label/${cat.name}` })).body).toBe('OK')
      expect(state(unread).seen_at).not.toBeNull()
    })
  })

  describe('state streams and filters', () => {
    it('serves the read and unread streams on stream/items/ids and stream/contents', async () => {
      const { unread, read, starred } = seed()
      expect(await refIds(`s=${enc(READ)}`)).toEqual([read])
      expect(await refIds(`s=${enc(UNREAD)}`)).toEqual([starred, unread])
      expect(await contentIds(`s=${enc(READ)}`)).toEqual([read])
      expect(await contentIds(`s=${enc(UNREAD)}`)).toEqual([starred, unread])
      const path = (await get(`/stream/contents/${READ}`)).json().items as { id: string }[]
      expect(path.map((i) => decodeItemId(i.id))).toEqual([read])
    })

    it('honours it=starred, it=read and it=unread on both endpoints', async () => {
      const { unread, read, starred } = seed()
      expect(await refIds(`s=${enc(READING_LIST)}&it=${enc(STARRED)}`)).toEqual([starred])
      expect(await contentIds(`s=${enc(READING_LIST)}&it=${enc(STARRED)}`)).toEqual([starred])
      expect(await refIds(`it=${enc(READ)}`)).toEqual([read])
      expect(await contentIds(`it=${enc(UNREAD)}`)).toEqual([starred, unread])
    })

    it('combines it= with xt=, and ignores it/xt values that are not one of the three states', async () => {
      const { unread, read, starred } = seed()
      expect(await refIds(`it=${enc(UNREAD)}&xt=${enc(STARRED)}`)).toEqual([unread])
      expect(await refIds(`xt=${enc(READ)}`)).toEqual([starred, unread])
      expect(await refIds(`it=${enc(READING_LIST)}`)).toEqual([starred, read, unread])
      expect(await refIds(`xt=${enc('feed/https://example.com/rss')}`)).toEqual([starred, read, unread])
      expect(await refIds(`xt=${enc('user/-/state/com.google/reading-list')}`)).toEqual([starred, read, unread])
    })
  })

  describe('token', () => {
    it('is a stable 57-character token followed by a newline', async () => {
      seedUser()
      const auth = token()
      const fetchToken = () => app.inject({ method: 'GET', url: `${API}/token`, headers: { authorization: `GoogleLogin auth=${auth}` } })
      const first = await fetchToken()
      expect(first.statusCode).toBe(200)
      expect(first.body).toMatch(/^[0-9a-f]{40}Z{17}\n$/)
      expect((await fetchToken()).body).toBe(first.body)
    })
  })
})

// ── WP4: numeric feed IDs and subscription management ───────────────────────

describe.each([
  ['root', ''],
  ['FreshRSS prefix', '/api/greader.php'],
])('WP4 subscriptions (%s)', (_label, prefix) => {
  const API = `${prefix}/reader/api/0`
  const enc = encodeURIComponent
  const READING_LIST = 'user/-/state/com.google/reading-list'
  const token = () => app.jwt.sign({ email: 'test@example.com', token_version: 0 }, { expiresIn: '3650d' })
  const headers = () => ({ authorization: `GoogleLogin auth=${token()}` })
  const get = (path: string) => app.inject({ method: 'GET', url: `${API}${path}`, headers: headers() })
  const post = (path: string, form: Record<string, string | string[]>) => {
    const body = new URLSearchParams()
    for (const [k, v] of Object.entries(form)) for (const value of Array.isArray(v) ? v : [v]) body.append(k, value)
    return app.inject({
      method: 'POST',
      url: `${API}${path}`,
      headers: { ...headers(), 'content-type': 'application/x-www-form-urlencoded' },
      payload: body.toString(),
    })
  }
  const titles = async (path: string) => (await get(path)).json().items.map((i: { title: string }) => i.title)
  const refCount = async (query: string) => (await get(`/stream/items/ids?${query}`)).json().itemRefs.length
  const subscriptions = async () => (await get('/subscription/list')).json().subscriptions as {
    id: string; title: string; url: string; htmlUrl: string; iconUrl: string; categories: { id: string; label: string }[]
  }[]

  /** A feed whose URL holds every character that broke feed/<url> IDs. */
  const ODD_URL = 'https://odd.example.com/feed/?a=1&b=2#frag'

  function seed() {
    seedUser()
    const news = createCategory('News')
    const empty = createCategory('Empty')
    const plain = createFeed({ name: 'Plain', url: 'https://plain.example.com', rss_url: 'https://plain.example.com/feed/', category_id: news.id })
    const odd = createFeed({ name: 'Odd', url: 'https://odd.example.com', rss_url: ODD_URL })
    insertArticle({ feed_id: plain.id, title: 'Plain one', url: 'https://plain.example.com/1', published_at: null })
    insertArticle({ feed_id: odd.id, title: 'Odd one', url: 'https://odd.example.com/1', published_at: null })
    return { news, empty, plain, odd }
  }

  describe('feed stream lookup', () => {
    it('finds a feed by numeric ID on the wildcard path, s= of stream/contents and s= of stream/items/ids', async () => {
      const { odd } = seed()
      expect(await titles(`/stream/contents/feed/${odd.id}`)).toEqual(['Odd one'])
      expect(await titles(`/stream/contents?s=feed/${odd.id}`)).toEqual(['Odd one'])
      expect(await titles(`/stream/contents?s=${enc(`feed/${odd.id}`)}`)).toEqual(['Odd one'])
      expect(await refCount(`s=feed/${odd.id}`)).toBe(1)
    })

    it('finds a feed by a percent-encoded URL containing ?, & and #, on the path and in s=', async () => {
      const { odd } = seed()
      expect(odd.rss_url).toBe(ODD_URL)
      expect(await titles(`/stream/contents/feed/${enc(ODD_URL)}`)).toEqual(['Odd one'])
      expect(await titles(`/stream/contents?s=${enc(`feed/${ODD_URL}`)}`)).toEqual(['Odd one'])
      expect(await refCount(`s=${enc(`feed/${ODD_URL}`)}`)).toBe(1)
    })

    it('finds a feed by a raw (unencoded) URL containing /feed/, on the path and in s=, and one with a raw ? in s=', async () => {
      seed()
      createFeed({ name: 'Query', url: 'https://q.example.com', rss_url: 'https://q.example.com/feed/?format=rss' })
      const q = getDb().prepare("SELECT id FROM feeds WHERE name = 'Query'").get() as { id: number }
      insertArticle({ feed_id: q.id, title: 'Query one', url: 'https://q.example.com/1', published_at: null })
      expect(await titles('/stream/contents/feed/https://plain.example.com/feed/')).toEqual(['Plain one'])
      expect(await titles('/stream/contents?s=feed/https://plain.example.com/feed/')).toEqual(['Plain one'])
      expect(await refCount('s=feed/https://plain.example.com/feed/')).toBe(1)
      expect(await titles('/stream/contents?s=feed/https://q.example.com/feed/?format=rss')).toEqual(['Query one'])
    })

    it('finds a feed whose URL a client percent-encoded twice', async () => {
      seed()
      expect(await titles(`/stream/contents/feed/${enc(enc(ODD_URL))}`)).toEqual(['Odd one'])
    })

    it('falls back to the site URL when no RSS URL matches', async () => {
      seed()
      expect(await titles(`/stream/contents?s=${enc('feed/https://odd.example.com')}`)).toEqual(['Odd one'])
    })

    it('serves an empty page, not the reading list, for an unknown feed (by URL or ID)', async () => {
      seed()
      for (const stream of ['feed/https://unknown.example.com/rss', 'feed/999999']) {
        const res = await get(`/stream/contents?s=${enc(stream)}`)
        expect(res.statusCode).toBe(200)
        expect(res.json().items).toEqual([])
        expect(res.json()).not.toHaveProperty('continuation')
        expect((await get(`/stream/contents/${stream}`)).json().items).toEqual([])
        expect(await refCount(`s=${enc(stream)}`)).toBe(0)
      }
      // A literal % that is not percent-encoding must not break the path form.
      const res = await get('/stream/contents/feed/100%25')
      expect(res.statusCode).toBe(200)
      expect(res.json().items).toEqual([])
    })

    it("reports each item's origin.streamId as the subscription/list id of its feed", async () => {
      const { plain, odd } = seed()
      const subs = await subscriptions()
      expect(subs.map((s) => s.id).sort()).toEqual([`feed/${plain.id}`, `feed/${odd.id}`].sort())
      const items = (await get(`/stream/contents?s=${enc(READING_LIST)}`)).json().items as { origin: { streamId: string; title: string } }[]
      for (const item of items) {
        expect(item.origin.streamId).toBe(subs.find((s) => s.title === item.origin.title)!.id)
      }
    })

    it('mark-all-as-read accepts feed/<id> and feed/<encoded odd url>', async () => {
      const { odd, plain } = seed()
      expect((await post('/mark-all-as-read', { s: `feed/${plain.id}` })).body).toBe('OK')
      expect((await post('/mark-all-as-read', { s: `feed/${ODD_URL}` })).body).toBe('OK')
      const unseen = getDb().prepare('SELECT COUNT(*) AS n FROM articles WHERE seen_at IS NULL AND feed_id IN (?, ?)').get(plain.id, odd.id) as { n: number }
      expect(unseen.n).toBe(0)
    })
  })

  describe('subscription/list, tag/list, unread-count', () => {
    it('lists id, title, categories, url, htmlUrl, iconUrl and firstitemmsec, without frss:priority or sortid', async () => {
      const { plain, odd, news } = seed()
      const subs = await subscriptions()
      expect(subs.find((s) => s.id === `feed/${plain.id}`)).toEqual({
        id: `feed/${plain.id}`,
        title: 'Plain',
        categories: [{ id: 'user/-/label/News', label: 'News' }],
        url: plain.rss_url,
        htmlUrl: 'https://plain.example.com',
        iconUrl: '',
        firstitemmsec: '0',
      })
      expect(subs.find((s) => s.id === `feed/${odd.id}`)!.categories).toEqual([])
      expect(news.id).toBeGreaterThan(0)
    })

    it('tag/list is starred (no type), reading-list, then every category from getCategories(), empty ones included', async () => {
      seed()
      createCategory('Zeta')
      const res = await get('/tag/list?output=json')
      expect(res.json().tags).toEqual([
        { id: 'user/-/state/com.google/starred' },
        { id: READING_LIST },
        ...getCategories().map((c) => ({ id: `user/-/label/${c.name}`, type: 'folder' })),
      ])
      expect(getCategories().map((c) => c.name)).toEqual(['News', 'Empty', 'Zeta'])
    })

    it("unread-count orders rows as FreshRSS: each category's feeds then the category, uncategorised feeds, reading-list last", async () => {
      const { news, plain, odd } = seed()
      const second = createFeed({ name: 'Another', url: 'https://another.example.com', rss_url: 'https://another.example.com/rss', category_id: news.id })
      const readId = insertArticle({ feed_id: second.id, title: 'Read', url: 'https://another.example.com/1', published_at: null })
      getDb().prepare("UPDATE articles SET seen_at = datetime('now'), created_at = '2030-01-01 00:00:00' WHERE id = ?").run(readId)

      const body = (await get('/unread-count?output=json')).json() as { max: number; unreadcounts: { id: string; count: number; newestItemTimestampUsec: string }[] }
      expect(body.unreadcounts.map((r) => r.id)).toEqual([
        `feed/${second.id}`, `feed/${plain.id}`, 'user/-/label/News',
        'user/-/label/Empty',
        `feed/${odd.id}`,
        READING_LIST,
      ])
      expect(body.max).toBe(2)
      const rows = new Map(body.unreadcounts.map((r) => [r.id, r]))
      expect(rows.get(READING_LIST)!.count).toBe(2)
      // Newest arrival, read or not: the read article arrived last.
      const readUsec = String(Date.UTC(2030, 0, 1) * 1000)
      expect(rows.get(`feed/${second.id}`)).toEqual({ id: `feed/${second.id}`, count: 0, newestItemTimestampUsec: readUsec })
      expect(rows.get('user/-/label/News')!.newestItemTimestampUsec).toBe(readUsec)
      expect(rows.get(READING_LIST)!.newestItemTimestampUsec).toBe(readUsec)
      expect(rows.get('user/-/label/Empty')).toEqual({ id: 'user/-/label/Empty', count: 0, newestItemTimestampUsec: '0' })
    })
  })

  describe('subscription/edit', () => {
    it('renames with t=, moves with a= (creating the category), clears with r= alone', async () => {
      const { plain } = seed()
      expect((await post('/subscription/edit', { ac: 'edit', s: `feed/${plain.id}`, t: 'Renamed', T: 'x' })).body).toBe('OK')
      expect((await subscriptions()).find((s) => s.id === `feed/${plain.id}`)!.title).toBe('Renamed')

      expect((await post('/subscription/edit', { ac: 'edit', s: `feed/${plain.id}`, a: 'user/-/label/Moved' })).body).toBe('OK')
      expect((await subscriptions()).find((s) => s.id === `feed/${plain.id}`)!.categories).toEqual([{ id: 'user/-/label/Moved', label: 'Moved' }])
      expect(getCategories().map((c) => c.name)).toContain('Moved')
      // Articles follow the feed into its new category.
      expect(await titles(`/stream/contents/user/-/label/Moved`)).toEqual(['Plain one'])

      // r= names some other label: the category is cleared anyway (greader.php).
      expect((await post('/subscription/edit', { ac: 'edit', s: `feed/${plain.id}`, r: 'user/-/label/Whatever' })).body).toBe('OK')
      expect((await subscriptions()).find((s) => s.id === `feed/${plain.id}`)!.categories).toEqual([])
    })

    it('uses the first of repeated a= values, and a= wins over r=', async () => {
      const { plain } = seed()
      const res = await post('/subscription/edit', { ac: 'edit', s: `feed/${plain.id}`, a: ['user/-/label/First', 'user/-/label/Second'], r: 'user/-/label/News' })
      expect(res.body).toBe('OK')
      expect((await subscriptions()).find((s) => s.id === `feed/${plain.id}`)!.categories).toEqual([{ id: 'user/-/label/First', label: 'First' }])
      expect(getCategories().map((c) => c.name)).not.toContain('Second')
    })

    it('pairs repeated t= with repeated s= by position, and accepts feed/<url>', async () => {
      const { plain, odd } = seed()
      expect((await post('/subscription/edit', { ac: 'edit', s: [`feed/${plain.id}`, `feed/${ODD_URL}`], t: ['P2', 'O2'] })).body).toBe('OK')
      const subs = await subscriptions()
      expect(subs.find((s) => s.id === `feed/${plain.id}`)!.title).toBe('P2')
      expect(subs.find((s) => s.id === `feed/${odd.id}`)!.title).toBe('O2')
    })

    it('changes nothing when one of several feeds is unknown', async () => {
      const { plain } = seed()
      const res = await post('/subscription/edit', { ac: 'edit', s: [`feed/${plain.id}`, 'feed/999999'], t: ['Nope', 'Nope'] })
      expect(res.statusCode).toBe(400)
      expect((await subscriptions()).find((s) => s.id === `feed/${plain.id}`)!.title).toBe('Plain')
    })

    it('unsubscribes a feed and its articles', async () => {
      const { odd } = seed()
      expect((await post('/subscription/edit', { ac: 'unsubscribe', s: `feed/${odd.id}` })).body).toBe('OK')
      expect((await subscriptions()).map((s) => s.id)).not.toContain(`feed/${odd.id}`)
      expect(await titles(`/stream/contents?s=${enc(READING_LIST)}`)).toEqual(['Plain one'])
    })

    it('never touches the clip feed', async () => {
      seed()
      const clip = createFeed({ name: 'Clips', url: 'clip://saved', type: 'clip' })
      const res = await post('/subscription/edit', { ac: 'unsubscribe', s: `feed/${clip.id}` })
      expect(res.statusCode).toBe(400)
    })

    it('subscribes through discovery, then applies t= and a=', async () => {
      seed()
      mockDiscoverRssUrl.mockResolvedValue({ rssUrl: 'https://new.example.com/rss', title: 'Discovered', usedFlareSolverr: false })
      const res = await post('/subscription/edit', { ac: 'subscribe', s: 'feed/https://new.example.com', t: 'Mine', a: 'user/-/label/News' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toBe('OK')
      const sub = (await subscriptions()).find((s) => s.title === 'Mine')!
      expect(sub).toMatchObject({ url: 'https://new.example.com/rss', categories: [{ id: 'user/-/label/News', label: 'News' }] })
      expect(mockFetchSingleFeed).toHaveBeenCalledTimes(1)
    })

    it('subscribes through the RSS-Bridge fallback when discovery finds no feed', async () => {
      seed()
      mockQueryRssBridge.mockResolvedValue('https://bridge.example.com/?action=display')
      const res = await post('/subscription/edit', { ac: 'subscribe', s: 'feed/https://site.example.com' })
      expect(res.body).toBe('OK')
      const row = getDb().prepare("SELECT name, rss_bridge_url FROM feeds WHERE url = 'https://site.example.com'").get()
      expect(row).toMatchObject({ name: 'site.example.com', rss_bridge_url: 'https://bridge.example.com/?action=display' })
    })

    it.each([
      ['no s', { ac: 'edit', t: 'x' }],
      ['no ac', { s: 'feed/1' }],
      ['an unknown ac', { ac: 'rename', s: 'feed/1' }],
      ['edit of an unknown feed', { ac: 'edit', s: 'feed/999999', t: 'x' }],
      ['unsubscribe of an unknown feed', { ac: 'unsubscribe', s: 'feed/https://unknown.example.com/rss' }],
      ['subscribe to an existing feed', { ac: 'subscribe', s: 'feed/https://plain.example.com/feed/' }],
      ['subscribe to a URL discovery cannot resolve', { ac: 'subscribe', s: 'feed/https://nothing.example.com' }],
      ['subscribe to a non-http URL', { ac: 'subscribe', s: 'feed/file:///etc/passwd' }],
    ])('answers 400 Bad Request! for %s', async (_case, form) => {
      seed()
      const res = await post('/subscription/edit', form)
      expect(res.statusCode).toBe(400)
      expect(res.headers['content-type']).toMatch(/^text\/plain; charset=utf-8$/i)
      expect(res.body).toBe('Bad Request!')
    })

    it('answers 400 when discovery leads to a feed that already exists', async () => {
      seed()
      mockDiscoverRssUrl.mockResolvedValue({ rssUrl: ODD_URL, title: 'Odd', usedFlareSolverr: false })
      const res = await post('/subscription/edit', { ac: 'subscribe', s: 'feed/https://odd.example.com/blog' })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('subscription/quickadd', () => {
    it('answers 200 with numResults 1, the feed URL, feed/<id> and the title', async () => {
      seed()
      mockDiscoverRssUrl.mockResolvedValue({ rssUrl: 'https://new.example.com/rss', title: 'New', usedFlareSolverr: false })
      const res = await post('/subscription/quickadd', { quickadd: 'https://new.example.com', T: 'x' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      const created = getDb().prepare("SELECT id FROM feeds WHERE url = 'https://new.example.com'").get() as { id: number }
      expect(body).toEqual({ numResults: 1, query: 'https://new.example.com/rss', streamId: `feed/${created.id}`, streamName: 'New' })
    })

    it('answers 200 with "Already subscribed! <url>" for a feed that exists', async () => {
      seed()
      const res = await post('/subscription/quickadd', { quickadd: ODD_URL })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ numResults: 0, error: `Already subscribed! ${ODD_URL}` })
      expect(mockDiscoverRssUrl).not.toHaveBeenCalled()
    })

    it('answers 200 with numResults 0 and an error when no feed can be found', async () => {
      seed()
      const res = await post('/subscription/quickadd', { quickadd: 'https://nothing.example.com' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ numResults: 0, error: 'RSS could not be detected for this URL' })
    })

    it('answers 400 Bad Request! without quickadd', async () => {
      seed()
      const res = await post('/subscription/quickadd', {})
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Bad Request!')
    })
  })

  describe('rename-tag and disable-tag', () => {
    it('rename-tag renames the category; its feeds and articles follow', async () => {
      const { plain } = seed()
      expect((await post('/rename-tag', { s: 'user/-/label/News', dest: 'user/-/label/Headlines', T: 'x' })).body).toBe('OK')
      expect(getCategories().map((c) => c.name)).toEqual(['Headlines', 'Empty'])
      expect((await subscriptions()).find((s) => s.id === `feed/${plain.id}`)!.categories).toEqual([{ id: 'user/-/label/Headlines', label: 'Headlines' }])
      expect(await titles('/stream/contents/user/-/label/Headlines')).toEqual(['Plain one'])
    })

    it.each([
      ['an unknown label', { s: 'user/-/label/Nope', dest: 'user/-/label/X' }],
      ['ids without the label prefix', { s: 'News', dest: 'Headlines' }],
      ['a missing dest', { s: 'user/-/label/News' }],
      ['an empty new name', { s: 'user/-/label/News', dest: 'user/-/label/' }],
    ])('rename-tag answers 400 Bad Request! for %s', async (_case, form) => {
      seed()
      const res = await post('/rename-tag', form)
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Bad Request!')
      expect(getCategories().map((c) => c.name)).toEqual(['News', 'Empty'])
    })

    it('disable-tag deletes only the first s; feeds and articles survive without a category', async () => {
      const { plain } = seed()
      expect((await post('/disable-tag', { s: ['user/-/label/News', 'user/-/label/Empty'] })).body).toBe('OK')
      expect(getCategories().map((c) => c.name)).toEqual(['Empty'])
      expect((await subscriptions()).find((s) => s.id === `feed/${plain.id}`)!.categories).toEqual([])
      expect(await titles(`/stream/contents/feed/${plain.id}`)).toEqual(['Plain one'])
      const article = getDb().prepare('SELECT category_id FROM articles WHERE feed_id = ?').get(plain.id) as { category_id: number | null }
      expect(article.category_id).toBeNull()
    })

    it.each([
      ['an unknown label', { s: 'user/-/label/Nope' }],
      ['no s', {}],
      ['a non-label stream', { s: 'feed/1' }],
    ])('disable-tag answers 400 Bad Request! for %s', async (_case, form) => {
      seed()
      const res = await post('/disable-tag', form)
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Bad Request!')
    })
  })

  describe('subscription/import and subscription/export', () => {
    it('round-trips: the exported OPML imported into an empty server recreates feeds and categories', async () => {
      seed()
      const exported = await get('/subscription/export')
      expect(exported.statusCode).toBe(200)
      expect(exported.headers['content-type']).toBe('application/xml; charset=UTF-8')
      expect(exported.headers['content-disposition']).toMatch(/^attachment/)
      expect(exported.body).toContain('<opml')

      getDb().prepare('DELETE FROM feeds').run()
      getDb().prepare('DELETE FROM categories').run()
      for (const contentType of ['text/xml']) {
        const res = await app.inject({
          method: 'POST',
          url: `${API}/subscription/import`,
          headers: { ...headers(), 'content-type': contentType },
          payload: exported.body,
        })
        expect(res.statusCode).toBe(200)
        expect(res.body).toBe('OK')
      }
      const subs = await subscriptions()
      expect(subs.map((s) => [s.title, s.url, s.categories]).sort()).toEqual([
        ['Odd', ODD_URL, []],
        ['Plain', 'https://plain.example.com/feed/', [{ id: 'user/-/label/News', label: 'News' }]],
      ])
      expect(mockFetchSingleFeed).toHaveBeenCalledTimes(2)
    })

    it.each(['application/xml', 'text/x-opml', 'text/plain'])('accepts an OPML body sent as %s', async (contentType) => {
      seedUser()
      const opml = '<?xml version="1.0"?><opml version="2.0"><body><outline text="One" xmlUrl="https://one.example.com/rss"/></body></opml>'
      const res = await app.inject({ method: 'POST', url: `${API}/subscription/import`, headers: { ...headers(), 'content-type': contentType }, payload: opml })
      expect(res.body).toBe('OK')
      expect((await subscriptions()).map((s) => s.url)).toEqual(['https://one.example.com/rss'])
    })

    it.each([['an empty body', ''], ['a body that is not OPML', '<html></html>']])('import answers 400 Bad Request! for %s', async (_case, payload) => {
      seedUser()
      const res = await app.inject({ method: 'POST', url: `${API}/subscription/import`, headers: { ...headers(), 'content-type': 'text/xml' }, payload })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Bad Request!')
    })
  })

  describe('authentication', () => {
    it.each([
      ['POST', '/subscription/edit'],
      ['POST', '/subscription/quickadd'],
      ['POST', '/subscription/import'],
      ['GET', '/subscription/export'],
      ['POST', '/rename-tag'],
      ['POST', '/disable-tag'],
    ] as const)('%s %s answers 401 without a token and changes nothing', async (method, path) => {
      seed()
      const res = await app.inject({
        method,
        url: `${API}${path}`,
        headers: method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {},
        payload: method === 'POST' ? 'ac=unsubscribe&s=feed%2F1&s=user%2F-%2Flabel%2FNews&quickadd=https%3A%2F%2Fx.example.com' : undefined,
      })
      expect(res.statusCode).toBe(401)
      expect(getCategories().map((c) => c.name)).toEqual(['News', 'Empty'])
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM feeds').get()).toMatchObject({ n: 2 })
      expect(mockDiscoverRssUrl).not.toHaveBeenCalled()
    })

    it('check/compatibility needs no token: PASS with a GoogleLogin header, the FAIL line without one', async () => {
      const pass = await app.inject({ method: 'GET', url: `${prefix}/check/compatibility`, headers: { authorization: 'GoogleLogin auth=not-a-real-token' } })
      expect(pass.statusCode).toBe(200)
      expect(pass.headers['content-type']).toBe('text/plain; charset=UTF-8')
      expect(pass.body).toBe('PASS')
      const fail = await app.inject({ method: 'GET', url: `${prefix}/check/compatibility` })
      expect(fail.statusCode).toBe(200)
      expect(fail.body).toBe('FAIL get HTTP Authorization header! Wrong Web server configuration.')
    })
  })
})

// ── FreshRSS error and response conventions (WP5, both prefixes) ────────────

describe.each([
  ['root', ''],
  ['FreshRSS prefix', '/api/greader.php'],
])('FreshRSS response conventions (%s)', (_name, prefix) => {
  const API = `${prefix}/reader/api/0`
  const TEXT = 'text/plain; charset=UTF-8'

  function expectUnauthorized(res: { statusCode: number; headers: Record<string, unknown>; body: string }) {
    expect(res.statusCode).toBe(401)
    expect(res.headers['content-type']).toBe(TEXT)
    expect(res.headers['google-bad-token']).toBe('true')
    expect(res.body).toBe('Unauthorized!')
  }

  function expectBadRequest(res: { statusCode: number; headers: Record<string, unknown>; body: string }) {
    expect(res.statusCode).toBe(400)
    expect(res.headers['content-type']).toBe(TEXT)
    expect(res.body).toBe('Bad Request!')
  }

  function login(form: string) {
    return app.inject({
      method: 'POST',
      url: `${prefix}/accounts/ClientLogin`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: form,
    })
  }

  async function token(): Promise<string> {
    const res = await login('Email=test%40example.com&Passwd=password123')
    return res.body.match(/^Auth=(.+)$/m)![1]
  }

  function post(path: string, payload: string, auth: string | null, contentType = 'application/x-www-form-urlencoded') {
    return app.inject({
      method: 'POST',
      url: `${API}${path}`,
      headers: { 'content-type': contentType, ...(auth ? { authorization: `GoogleLogin auth=${auth}` } : {}) },
      payload,
    })
  }

  function get(path: string, auth: string | null) {
    return app.inject({
      method: 'GET',
      url: `${API}${path}`,
      headers: auth ? { authorization: `GoogleLogin auth=${auth}` } : {},
    })
  }

  describe('unknown reader paths', () => {
    const UNKNOWN = ['/nope', '/stream/nothing', '/subscription/nothing', '/', '/user-info/extra']

    it.each(UNKNOWN)('%s without a token is 401 Unauthorized! (auth is checked first)', async (path) => {
      seedUser()
      expectUnauthorized(await get(path, null))
      expectUnauthorized(await get(path, 'not-a-token'))
    })

    it.each(UNKNOWN)('%s with a valid token is 400 Bad Request!', async (path) => {
      seedUser()
      expectBadRequest(await get(path, await token()))
    })

    it.each(['POST', 'PUT', 'DELETE', 'PATCH'] as const)('any method: %s on an unknown path is 400 with a token, 401 without', async (method) => {
      seedUser()
      const auth = await token()
      const withToken = await app.inject({ method, url: `${API}/nope`, headers: { authorization: `GoogleLogin auth=${auth}` } })
      expectBadRequest(withToken)
      expectUnauthorized(await app.inject({ method, url: `${API}/nope` }))
    })

    it('a known path with the wrong method is 400 (e.g. DELETE user-info)', async () => {
      seedUser()
      expectBadRequest(await app.inject({ method: 'DELETE', url: `${API}/user-info`, headers: { authorization: `GoogleLogin auth=${await token()}` } }))
    })

    it('real routes still win over the catch-all', async () => {
      seedUser()
      const auth = await token()
      expect((await get('/user-info', auth)).statusCode).toBe(200)
      expect((await get('/stream/contents/user/-/state/com.google/reading-list', auth)).statusCode).toBe(200)
      expect((await get('/stream/contents', auth)).statusCode).toBe(200)
      expect((await get('/stream/items/ids', auth)).statusCode).toBe(200)
      expect((await get('/subscription/export', auth)).statusCode).toBe(200)
    })
  })

  describe('auth failures', () => {
    it('missing Authorization header', async () => {
      seedUser()
      expectUnauthorized(await get('/user-info', null))
    })

    it('Authorization header that is not GoogleLogin', async () => {
      seedUser()
      expectUnauthorized(await app.inject({ method: 'GET', url: `${API}/user-info`, headers: { authorization: 'Bearer abc' } }))
    })

    it('a token signed with another secret', async () => {
      seedUser()
      const forged = (await token()).replace(/\.[^.]+$/, '.AAAA')
      expectUnauthorized(await get('/user-info', forged))
    })

    it('an expired token', async () => {
      seedUser()
      const expired = app.jwt.sign({ email: 'test@example.com', token_version: 0 }, { expiresIn: '1s' })
      vi.useFakeTimers({ now: Date.now() + 60_000, toFake: ['Date'] })
      try {
        expectUnauthorized(await get('/user-info', expired))
      } finally {
        vi.useRealTimers()
      }
    })

    it('a bumped token_version', async () => {
      seedUser()
      const auth = await token()
      getDb().prepare('UPDATE users SET token_version = token_version + 1').run()
      expectUnauthorized(await get('/user-info', auth))
    })

    it('a token for an account that no longer exists', async () => {
      seedUser()
      const auth = await token()
      getDb().prepare('DELETE FROM users').run()
      expectUnauthorized(await get('/user-info', auth))
    })

    it('ClientLogin with a wrong password', async () => {
      seedUser()
      const res = await login('Email=test%40example.com&Passwd=wrong')
      expectUnauthorized(res)
      expect(res.body).not.toMatch(/Auth=/)
    })

    it('ClientLogin with an unknown email', async () => {
      seedUser()
      expectUnauthorized(await login('Email=nobody%40example.com&Passwd=password123'))
    })

    it('ClientLogin without Passwd is 400 Bad Request!', async () => {
      seedUser()
      expectBadRequest(await login('Email=test%40example.com'))
    })

    it('the failure limiter still answers 429 before the password is checked', async () => {
      seedUser()
      for (let i = 0; i < 10; i++) expectUnauthorized(await login('Email=test%40example.com&Passwd=wrong'))
      const res = await login('Email=test%40example.com&Passwd=password123')
      expect(res.statusCode).toBe(429)
      expect(res.headers['content-type']).toBe(TEXT)
      expect(res.body).toBe('Too Many Requests\n')
    })
  })

  describe('success bodies', () => {
    it('ClientLogin success is exactly SID=<t>\\nLSID=null\\nAuth=<t>\\n', async () => {
      seedUser()
      const res = await login('Email=test%40example.com&Passwd=password123')
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toBe(TEXT)
      const auth = res.body.match(/^Auth=(.+)$/m)![1]
      expect(auth).toMatch(/^[^\s=]+$/)
      expect(res.body).toBe(`SID=${auth}\nLSID=null\nAuth=${auth}\n`)
    })

    it('token is text/plain; charset=UTF-8', async () => {
      seedUser()
      const res = await get('/token', await token())
      expect(res.headers['content-type']).toBe(TEXT)
      expect(res.body).toMatch(/^[0-9a-fZ]{57}\n$/)
    })

    it('every OK endpoint answers exactly OK, text/plain; charset=UTF-8', async () => {
      seedUser()
      const auth = await token()
      const cat = createCategory('News')
      createCategory('Old')
      const feed = createFeed({ name: 'Alpha', url: 'https://alpha.example.com', rss_url: 'https://alpha.example.com/feed', category_id: cat.id })
      const articleId = insertArticle({ feed_id: feed.id, title: 'A', url: 'https://alpha.example.com/1', published_at: null })
      const opml = '<?xml version="1.0"?><opml version="2.0"><body><outline type="rss" text="Beta" xmlUrl="https://beta.example.com/feed" htmlUrl="https://beta.example.com"/></body></opml>'

      const responses = [
        await post('/edit-tag', `i=${articleId}&a=user%2F-%2Fstate%2Fcom.google%2Fread`, auth),
        await post('/mark-all-as-read', 's=user%2F-%2Fstate%2Fcom.google%2Freading-list', auth),
        await post('/subscription/edit', `ac=edit&s=feed%2F${feed.id}&t=Alpha2`, auth),
        await post('/rename-tag', 's=user%2F-%2Flabel%2FNews&dest=user%2F-%2Flabel%2FNews2', auth),
        await post('/disable-tag', 's=user%2F-%2Flabel%2FOld', auth),
        await post('/subscription/import', opml, auth, 'text/xml'),
      ]
      for (const res of responses) {
        expect(res.statusCode).toBe(200)
        expect(res.headers['content-type']).toBe(TEXT)
        expect(res.body).toBe('OK')
        expect(res.rawPayload.equals(Buffer.from('OK'))).toBe(true)
      }
    })

    it('JSON responses are application/json; charset=utf-8, export application/xml', async () => {
      seedUser()
      const auth = await token()
      for (const path of ['/user-info', '/tag/list', '/subscription/list', '/unread-count', '/stream/items/ids', '/stream/contents']) {
        expect((await get(path, auth)).headers['content-type']).toBe('application/json; charset=utf-8')
      }
      expect((await get('/subscription/export', auth)).headers['content-type']).toMatch(/^application\/xml/)
    })

    it('user-info has exactly userId, userName, userProfileId and userEmail, all the email', async () => {
      seedUser()
      const body = (await get('/user-info', await token())).json()
      expect(Object.keys(body).sort()).toEqual(['userEmail', 'userId', 'userName', 'userProfileId'])
      for (const value of Object.values(body)) expect(value).toBe('test@example.com')
    })
  })

  describe('stream/contents wrapper and unknown streams', () => {
    function seedStream() {
      const cat = createCategory('News')
      const feed = createFeed({ name: 'Alpha', url: 'https://alpha.example.com', rss_url: 'https://alpha.example.com/feed', category_id: cat.id })
      const id = insertArticle({ feed_id: feed.id, title: 'A', url: 'https://alpha.example.com/1', published_at: null })
      getDb().prepare("UPDATE articles SET liked_at = datetime('now') WHERE id = ?").run(id)
      return { feed, id }
    }

    it('wrapper id is the reading list for a feed, a label and starred, path and query forms', async () => {
      seedUser()
      const { feed } = seedStream()
      const auth = await token()
      for (const stream of [`feed/${feed.id}`, 'user/-/label/News', 'user/-/state/com.google/starred']) {
        for (const path of [`/stream/contents/${stream}`, `/stream/contents?s=${encodeURIComponent(stream)}`]) {
          const body = (await get(path, auth)).json()
          expect(body.id).toBe('user/-/state/com.google/reading-list')
          expect(body.items).toHaveLength(1)
          expect(typeof body.updated).toBe('number')
        }
      }
    })

    it('an unknown label is an empty page on stream/items/ids and stream/contents', async () => {
      seedUser()
      seedStream()
      const auth = await token()
      const ids = await get(`/stream/items/ids?s=${encodeURIComponent('user/-/label/Nope')}`, auth)
      expect(ids.statusCode).toBe(200)
      expect(ids.json()).toEqual({ itemRefs: [] })
      for (const path of ['/stream/contents/user/-/label/Nope', `/stream/contents?s=${encodeURIComponent('user/-/label/Nope')}`]) {
        const res = await get(path, auth)
        expect(res.statusCode).toBe(200)
        expect(res.json().items).toEqual([])
        expect(res.json()).not.toHaveProperty('continuation')
      }
    })

    it('output=json is accepted and ignored; T is not validated', async () => {
      seedUser()
      const { id } = seedStream()
      const auth = await token()
      for (const path of ['/tag/list', '/subscription/list', '/unread-count', '/stream/items/ids']) {
        const plain = await get(path, auth)
        const json = await get(`${path}?output=json`, auth)
        expect(plain.statusCode).toBe(200)
        expect(json.statusCode).toBe(200)
        expect(Object.keys(json.json())).toEqual(Object.keys(plain.json()))
      }
      for (const T of ['', 'x', 'garbage-token']) {
        const res = await post('/edit-tag', `T=${T}&i=${id}&a=user%2F-%2Fstate%2Fcom.google%2Fread`, auth)
        expect(res.statusCode).toBe(200)
        expect(res.body).toBe('OK')
      }
      expect((await post('/edit-tag', `i=${id}&r=user%2F-%2Fstate%2Fcom.google%2Fread`, auth)).body).toBe('OK')
    })
  })
})

// ── Unknown paths and the SPA fallback (server/index.ts) ────────────────────

describe('SPA fallback alongside the reader routes', () => {
  let distDir: string

  beforeEach(async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksskolten-dist-'))
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>SPA</title>')
    await app.close()
    app = await buildApp()
    await registerSpaFallback(app, distDir)
  })

  afterEach(async () => {
    const fs = await import('node:fs')
    fs.rmSync(distDir, { recursive: true, force: true })
  })

  it.each(['/', '/some-page', '/feeds/12', '/reader/other', '/reader/api/1/x'])('serves index.html for %s', async (url) => {
    const res = await app.inject({ method: 'GET', url })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/html/)
    expect(res.body).toContain('<title>SPA</title>')
  })

  it('keeps the JSON 404 for unknown /api paths outside greader.php', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nothing-here' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'Not found' })
  })

  it.each(['', '/api/greader.php'])('never serves the SPA for an unknown reader path (%s)', async (prefix) => {
    seedUser()
    const noToken = await app.inject({ method: 'GET', url: `${prefix}/reader/api/0/nope` })
    expect(noToken.statusCode).toBe(401)
    expect(noToken.body).toBe('Unauthorized!')
    const { auth } = await clientLogin()
    const withToken = await app.inject({ method: 'GET', url: `${prefix}/reader/api/0/nope`, headers: { authorization: `GoogleLogin auth=${auth}` } })
    expect(withToken.statusCode).toBe(400)
    expect(withToken.body).toBe('Bad Request!')
  })

  it('never serves the SPA or the JSON 404 under /api/greader.php/', async () => {
    for (const url of ['/api/greader.php/', '/api/greader.php/nothing', '/api/greader.php/reader/nothing/here']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode).toBe(400)
      expect(res.headers['content-type']).toBe('text/plain; charset=UTF-8')
      expect(res.body).toBe('Bad Request!')
    }
  })
})
