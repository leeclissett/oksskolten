/**
 * Contract tests for the Google Reader API in its FreshRSS dialect.
 *
 * The oracle is FreshRSS's p/api/greader.php and FreshRSS_Entry::toGReader()
 * (compat mode); see docs/greader-compat.md for the dialect, verified line by
 * line. Every endpoint is exercised under both base URLs a reader app may use:
 * the root (`/reader/api/0/...`, generic "Google Reader" option) and the
 * FreshRSS prefix (`/api/greader.php/reader/api/0/...`).
 *
 * Conventions:
 * - Tests for behaviour `main` already matches run and must pass.
 * - Tests for behaviour a later work package implements are kept in full but
 *   registered with `it.skip('WP<n>: ...')` (or `it.todo` where the body needs
 *   network mocking). Each WP un-skips its own.
 * - The fork deliberately emits Google-era keys FreshRSS omits
 *   (`itemRefs[].directStreamIds`, `itemRefs[].timestampUsec`, per-item
 *   `updated`, `subscriptions[].firstitemmsec`), and accepts input FreshRSS
 *   rejects (`output=json` optional, any `T`). So these tests assert required
 *   keys and types, never exact key sets.
 * - Login rate limiting is owned by WP1 and is not tested here. Reader
 *   requests authenticate with a token signed directly, so these tests do not
 *   depend on how ClientLogin is limited.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashSync } from 'bcryptjs'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createCategory, createFeed, getDb, insertArticle } from '../db.js'

let app: FastifyInstance
let savedAuthDisabled: string | undefined

beforeEach(async () => {
  setupTestDb()
  app = await buildApp()
  savedAuthDisabled = process.env.AUTH_DISABLED
  delete process.env.AUTH_DISABLED
})

afterEach(async () => {
  await app.close()
  if (savedAuthDisabled !== undefined) {
    process.env.AUTH_DISABLED = savedAuthDisabled
  } else {
    delete process.env.AUTH_DISABLED
  }
})

// ── Constants ────────────────────────────────────────────────────────────────

const PREFIXES = [
  { label: 'root', base: '' },
  { label: '/api/greader.php', base: '/api/greader.php' },
] as const

const API = '/reader/api/0'
const EMAIL = 'reader@example.com'
const PASSWORD = 'correct-horse-battery'

const READING_LIST = 'user/-/state/com.google/reading-list'
const READ = 'user/-/state/com.google/read'
const UNREAD = 'user/-/state/com.google/unread'
const STARRED = 'user/-/state/com.google/starred'

const ITEM_TAG_ID = /^tag:google\.com,2005:reader\/item\/[0-9a-f]{16}$/
const DECIMAL = /^\d+$/
const JSON_CT = /^application\/json; charset=utf-8$/i
const TEXT_CT = /^text\/plain/
const TEXT_CT_EXACT = /^text\/plain; charset=utf-8$/i

/** Arrival times (created_at) of the seeded articles, distinct from their publication dates. */
const ARRIVAL = ['2026-10-01 10:00:00', '2026-10-01 10:01:00', '2026-10-01 10:02:00'] as const
const arrivalMs = (sqlite: string) => Date.parse(`${sqlite.replace(' ', 'T')}Z`)

// ── Helpers ──────────────────────────────────────────────────────────────────

function seedUser() {
  getDb().prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(EMAIL, hashSync(PASSWORD, 4))
}

/** A reader token as ClientLogin would issue it, without going through ClientLogin. */
function readerToken(): string {
  return app.jwt.sign({ email: EMAIL, token_version: 0 }, { expiresIn: '3650d' })
}

type Form = Record<string, string | string[] | undefined>

function encodeForm(form: Form): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(form)) {
    if (value === undefined) continue
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v)
  }
  return params.toString()
}

/** Request helpers bound to one base URL (root or FreshRSS prefix). */
function client(base: string) {
  const authHeader = () => ({ authorization: `GoogleLogin auth=${readerToken()}` })
  return {
    get(path: string, opts: { auth?: boolean; headers?: Record<string, string> } = {}): Promise<LightMyRequestResponse> {
      return app.inject({
        method: 'GET',
        url: `${base}${path}`,
        headers: { ...(opts.auth === false ? {} : authHeader()), ...opts.headers },
      })
    },
    post(path: string, form: Form | string, opts: { auth?: boolean; headers?: Record<string, string> } = {}): Promise<LightMyRequestResponse> {
      return app.inject({
        method: 'POST',
        url: `${base}${path}`,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          ...(opts.auth === false ? {} : authHeader()),
          ...opts.headers,
        },
        payload: typeof form === 'string' ? form : encodeForm(form),
      })
    },
  }
}

/**
 * The world every endpoint test starts from:
 * - categories "News" (one feed) and "Empty Folder" (no feeds);
 * - feed Alpha in News, feed Beta with no category;
 * - three articles published in 2020 that arrived on 1 Oct 2026, one unread,
 *   one read, one starred (and unread).
 */
function seedWorld() {
  seedUser()
  const news = createCategory('News')
  const empty = createCategory('Empty Folder')
  const alpha = createFeed({ name: 'Alpha', url: 'https://alpha.example.com', rss_url: 'https://alpha.example.com/rss', category_id: news.id })
  const beta = createFeed({ name: 'Beta', url: 'https://beta.example.com', rss_url: 'https://beta.example.com/feed.xml' })
  const unreadId = insertArticle({ feed_id: alpha.id, title: 'Unread one', url: 'https://alpha.example.com/1', published_at: '2020-01-01T00:00:00Z', summary: 'Body one' })
  const readId = insertArticle({ feed_id: alpha.id, title: 'Read one', url: 'https://alpha.example.com/2', published_at: '2020-01-02T00:00:00Z', summary: 'Body two' })
  const starredId = insertArticle({ feed_id: beta.id, title: 'Starred one', url: 'https://beta.example.com/3', published_at: '2020-01-03T00:00:00Z', summary: 'Body three' })
  const db = getDb()
  db.prepare("UPDATE articles SET seen_at = datetime('now'), read_at = datetime('now') WHERE id = ?").run(readId)
  db.prepare("UPDATE articles SET liked_at = datetime('now') WHERE id = ?").run(starredId)
  const setArrival = db.prepare('UPDATE articles SET created_at = ? WHERE id = ?')
  setArrival.run(ARRIVAL[0], unreadId)
  setArrival.run(ARRIVAL[1], readId)
  setArrival.run(ARRIVAL[2], starredId)
  return { news, empty, alpha, beta, unreadId, readId, starredId }
}

/** Add `count` unread articles to a feed, arriving one second apart after the seeded ones. */
function seedMany(feedId: number, count: number, startSec = Date.UTC(2026, 9, 2) / 1000): number[] {
  const ids: number[] = []
  const setArrival = getDb().prepare("UPDATE articles SET created_at = datetime(?, 'unixepoch') WHERE id = ?")
  for (let i = 0; i < count; i++) {
    const id = insertArticle({ feed_id: feedId, title: `Bulk ${i}`, url: `https://bulk.example.com/${feedId}/${startSec + i}`, published_at: '2021-01-01T00:00:00Z' })
    setArrival.run(startSec + i, id)
    ids.push(id)
  }
  return ids
}

function state(id: number): { seen_at: string | null; read_at: string | null; liked_at: string | null } {
  const row = getDb().prepare('SELECT seen_at, read_at, liked_at FROM articles WHERE id = ?').get(id) as {
    seen_at: string | null
    read_at: string | null
    liked_at: string | null
  }
  return { seen_at: row.seen_at, read_at: row.read_at, liked_at: row.liked_at }
}

const hex16 = (id: number) => id.toString(16).padStart(16, '0')
const tagId = (id: number) => `tag:google.com,2005:reader/item/${hex16(id)}`
const enc = encodeURIComponent

/** Required keys and value types of an item in compat mode (toGReader('compat')). */
function expectItemShape(item: Record<string, unknown>) {
  expect(item.id).toMatch(ITEM_TAG_ID)
  expect(item.crawlTimeMsec).toEqual(expect.stringMatching(DECIMAL))
  expect(item.timestampUsec).toEqual(expect.stringMatching(DECIMAL))
  expect(typeof item.published).toBe('number')
  expect(Number.isInteger(item.published)).toBe(true)
  expect(typeof item.title).toBe('string')
  expect(item.canonical).toEqual([expect.objectContaining({ href: expect.any(String) })])
  expect(item.alternate).toEqual([expect.objectContaining({ href: expect.any(String) })])
  expect(Array.isArray(item.categories)).toBe(true)
  expect(item.categories).toContain(READING_LIST)
  for (const c of item.categories as unknown[]) expect(typeof c).toBe('string')
  expect(item.origin).toEqual(expect.objectContaining({
    streamId: expect.stringMatching(/^feed\//),
    htmlUrl: expect.any(String),
    title: expect.any(String),
  }))
  expect(item.summary).toEqual(expect.objectContaining({ content: expect.any(String) }))
  if ('author' in item) expect(typeof item.author).toBe('string')
}

/** Wrapper of stream/contents and stream/items/contents. */
function expectStreamWrapper(body: Record<string, unknown>) {
  expect(typeof body.id).toBe('string')
  expect(Number.isInteger(body.updated)).toBe(true)
  expect(Array.isArray(body.items)).toBe(true)
  // Never an empty-string continuation: NNW, Capy Reader and Read You loop on it.
  if ('continuation' in body) expect(body.continuation).toEqual(expect.stringMatching(/.+/))
}

function expectItemRefs(body: Record<string, unknown>) {
  expect(Array.isArray(body.itemRefs)).toBe(true)
  for (const ref of body.itemRefs as Record<string, unknown>[]) {
    expect(ref.id).toEqual(expect.stringMatching(DECIMAL))
    // Google-era extras the fork keeps (FreshRSS emits `id` only).
    if ('timestampUsec' in ref) expect(ref.timestampUsec).toEqual(expect.stringMatching(DECIMAL))
    if ('directStreamIds' in ref) expect(Array.isArray(ref.directStreamIds)).toBe(true)
  }
  if ('continuation' in body) expect(body.continuation).toEqual(expect.stringMatching(/.+/))
}

const refIds = (body: { itemRefs: { id: string }[] }) => body.itemRefs.map((ref) => Number(ref.id))
const itemNumericId = (item: { id: string }) => parseInt(item.id.split('/item/')[1], 16)

// ── ClientLogin ──────────────────────────────────────────────────────────────

describe.each(PREFIXES)('POST /accounts/ClientLogin ($label)', ({ base }) => {
  const login = (form: Form) => client(base).post('/accounts/ClientLogin', form, { auth: false })

  it('returns 200 plain text with SID and Auth lines; the token has no "=" or whitespace and authenticates', async () => {
    seedUser()
    const res = await login({ Email: EMAIL, Passwd: PASSWORD })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(TEXT_CT)
    const lines = res.body.split('\n')
    expect(lines.some((l) => l.startsWith('SID='))).toBe(true)
    const authLine = lines.find((l) => l.startsWith('Auth='))
    expect(authLine).toBeDefined()
    const token = authLine!.slice('Auth='.length)
    // NNW and Capy Reader split each line on "=".
    expect(token).toMatch(/^[^\s=]+$/)

    const userInfo = await client(base).get(`${API}/user-info`, { auth: false, headers: { authorization: `GoogleLogin auth=${token}` } })
    expect(userInfo.statusCode).toBe(200)
  })

  it('treats the email case-insensitively', async () => {
    seedUser()
    const res = await login({ Email: EMAIL.toUpperCase(), Passwd: PASSWORD })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatch(/^Auth=/m)
  })

  it('rejects a wrong password with a 4xx and no token', async () => {
    seedUser()
    const res = await login({ Email: EMAIL, Passwd: 'wrong' })
    expect([401, 403]).toContain(res.statusCode)
    expect(res.body).not.toMatch(/Auth=/)
  })

  it('rejects a request without Passwd with 400', async () => {
    seedUser()
    const res = await login({ Email: EMAIL })
    expect(res.statusCode).toBe(400)
  })

  it.skip('WP5: success body is exactly SID=<t>\\nLSID=null\\nAuth=<t>\\n, text/plain; charset=UTF-8', async () => {
    seedUser()
    const res = await login({ Email: EMAIL, Passwd: PASSWORD })
    expect(res.headers['content-type']).toMatch(TEXT_CT_EXACT)
    const token = res.body.match(/^Auth=(.+)$/m)![1]
    expect(res.body).toBe(`SID=${token}\nLSID=null\nAuth=${token}\n`)
  })

  it.skip('WP5: a wrong password returns 401 Unauthorized! with Google-Bad-Token: true', async () => {
    seedUser()
    const res = await login({ Email: EMAIL, Passwd: 'wrong' })
    expect(res.statusCode).toBe(401)
    expect(res.headers['content-type']).toMatch(TEXT_CT_EXACT)
    expect(res.headers['google-bad-token']).toBe('true')
    expect(res.body).toBe('Unauthorized!')
  })

  it.skip('WP5: a request without Passwd returns 400 Bad Request! as plain text', async () => {
    seedUser()
    const res = await login({ Email: EMAIL })
    expect(res.statusCode).toBe(400)
    expect(res.headers['content-type']).toMatch(TEXT_CT_EXACT)
    expect(res.body).toBe('Bad Request!')
  })

  // Owned by WP1 (developed in parallel); un-skip once WP1 is merged.
  it.skip('WP1: accepts GET with Email and Passwd in the query string', async () => {
    seedUser()
    const res = await client(base).get(`/accounts/ClientLogin?Email=${enc(EMAIL)}&Passwd=${enc(PASSWORD)}`, { auth: false })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatch(/^Auth=[^\s=]+$/m)
  })
})

// ── Authentication of reader routes ──────────────────────────────────────────

const READER_ROUTES: { method: 'GET' | 'POST'; path: string }[] = [
  { method: 'GET', path: `${API}/token` },
  { method: 'GET', path: `${API}/user-info` },
  { method: 'GET', path: `${API}/tag/list?output=json` },
  { method: 'GET', path: `${API}/subscription/list?output=json` },
  { method: 'GET', path: `${API}/unread-count?output=json` },
  { method: 'GET', path: `${API}/stream/contents?s=${enc(READING_LIST)}` },
  { method: 'GET', path: `${API}/stream/contents/${READING_LIST}` },
  { method: 'GET', path: `${API}/stream/items/ids?s=${enc(READING_LIST)}` },
  { method: 'POST', path: `${API}/stream/items/contents` },
  { method: 'POST', path: `${API}/edit-tag` },
  { method: 'POST', path: `${API}/mark-all-as-read` },
]

/** Routes WP4 adds; they must be protected too. */
const WP4_ROUTES: { method: 'GET' | 'POST'; path: string }[] = [
  { method: 'POST', path: `${API}/subscription/edit` },
  { method: 'POST', path: `${API}/subscription/quickadd` },
  { method: 'POST', path: `${API}/subscription/import` },
  { method: 'GET', path: `${API}/subscription/export` },
  { method: 'POST', path: `${API}/rename-tag` },
  { method: 'POST', path: `${API}/disable-tag` },
]

describe.each(PREFIXES)('reader route authentication ($label)', ({ base }) => {
  const request = (route: { method: 'GET' | 'POST'; path: string }, authorization?: string) => app.inject({
    method: route.method,
    url: `${base}${route.path}`,
    headers: {
      ...(route.method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...(authorization ? { authorization } : {}),
    },
    payload: route.method === 'POST' ? `i=1&a=${enc(READ)}&s=${enc(READING_LIST)}` : undefined,
  })

  it.each(READER_ROUTES)('$method $path returns 401 without credentials', async (route) => {
    seedUser()
    const res = await request(route)
    expect(res.statusCode).toBe(401)
  })

  it.each(READER_ROUTES)('$method $path returns 401 with an invalid token', async (route) => {
    seedUser()
    const res = await request(route, 'GoogleLogin auth=not-a-token')
    expect(res.statusCode).toBe(401)
  })

  it.skip.each(WP4_ROUTES)('WP4: $method $path returns 401 without credentials', async (route) => {
    seedUser()
    const res = await request(route)
    expect(res.statusCode).toBe(401)
  })

  it.skip.each([...READER_ROUTES, ...WP4_ROUTES])('WP5: $method $path auth failure is 401 Unauthorized! with Google-Bad-Token: true', async (route) => {
    seedUser()
    for (const authorization of [undefined, 'GoogleLogin auth=not-a-token']) {
      const res = await request(route, authorization)
      expect(res.statusCode).toBe(401)
      expect(res.headers['content-type']).toMatch(TEXT_CT_EXACT)
      expect(res.headers['google-bad-token']).toBe('true')
      expect(res.body).toBe('Unauthorized!')
    }
  })

  it.skip('WP5: a token whose token_version was bumped gets the same 401 Unauthorized!', async () => {
    seedUser()
    getDb().prepare('UPDATE users SET token_version = token_version + 1').run()
    const res = await client(base).get(`${API}/user-info`)
    expect(res.statusCode).toBe(401)
    expect(res.headers['google-bad-token']).toBe('true')
    expect(res.body).toBe('Unauthorized!')
  })
})

// ── token ────────────────────────────────────────────────────────────────────

describe.each(PREFIXES)('GET /reader/api/0/token ($label)', ({ base }) => {
  it('returns 200 with a non-empty plain-text token', async () => {
    seedUser()
    const res = await client(base).get(`${API}/token`)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(TEXT_CT)
    expect(res.body.trim().length).toBeGreaterThan(0)
  })

  it.skip('WP3: returns a stable 57-character token followed by a newline, accepted as T', async () => {
    seedWorld()
    const api = client(base)
    const first = await api.get(`${API}/token`)
    const second = await api.get(`${API}/token`)
    expect(first.body).toMatch(/^[0-9A-Za-z]{57}\n$/)
    expect(second.body).toBe(first.body)

    const res = await api.post(`${API}/edit-tag`, { i: '1', a: READ, T: first.body.trim() })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('OK')
  })
})

// ── user-info ────────────────────────────────────────────────────────────────

describe.each(PREFIXES)('GET /reader/api/0/user-info ($label)', ({ base }) => {
  it('returns JSON with userId, userName, userProfileId and userEmail strings', async () => {
    seedUser()
    const res = await client(base).get(`${API}/user-info`)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(JSON_CT)
    const body = res.json()
    for (const key of ['userId', 'userName', 'userProfileId', 'userEmail']) {
      expect(typeof body[key]).toBe('string')
    }
    expect(body.userEmail).toBe(EMAIL)
  })

})

// ── tag/list ─────────────────────────────────────────────────────────────────

describe.each(PREFIXES)('GET /reader/api/0/tag/list ($label)', ({ base }) => {
  it('lists the starred state and every category as a folder, including empty ones, without output=json', async () => {
    const { news, empty } = seedWorld()
    const res = await client(base).get(`${API}/tag/list`)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(JSON_CT)
    const { tags } = res.json() as { tags: { id: string; type?: string }[] }
    expect(Array.isArray(tags)).toBe(true)
    for (const tag of tags) expect(typeof tag.id).toBe('string')
    expect(tags.map((t) => t.id)).toContain(STARRED)
    expect(tags).toContainEqual(expect.objectContaining({ id: `user/-/label/${news.name}`, type: 'folder' }))
    expect(tags).toContainEqual(expect.objectContaining({ id: `user/-/label/${empty.name}`, type: 'folder' }))
  })

})

// ── subscription/list ────────────────────────────────────────────────────────

describe.each(PREFIXES)('GET /reader/api/0/subscription/list ($label)', ({ base }) => {
  it('returns every feed with id, title, categories, url and htmlUrl, without output=json', async () => {
    const { alpha, beta, news } = seedWorld()
    const res = await client(base).get(`${API}/subscription/list`)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(JSON_CT)
    const { subscriptions } = res.json() as { subscriptions: Record<string, unknown>[] }
    expect(subscriptions).toHaveLength(2)
    for (const sub of subscriptions) {
      expect(sub.id).toEqual(expect.stringMatching(/^feed\/.+/))
      expect(typeof sub.title).toBe('string')
      expect(typeof sub.url).toBe('string')
      expect(typeof sub.htmlUrl).toBe('string') // Capy Reader requires it
      expect(Array.isArray(sub.categories)).toBe(true)
      for (const cat of sub.categories as Record<string, unknown>[]) {
        expect(cat.id).toEqual(expect.stringMatching(/^user\/-\/label\/.+/))
        expect(typeof cat.label).toBe('string')
      }
      if ('iconUrl' in sub) expect(typeof sub.iconUrl).toBe('string')
      if ('firstitemmsec' in sub) expect(sub.firstitemmsec).toEqual(expect.stringMatching(DECIMAL))
    }
    const byTitle = new Map(subscriptions.map((s) => [s.title, s]))
    expect(byTitle.get(alpha.name)!.categories).toEqual([{ id: `user/-/label/${news.name}`, label: news.name }])
    expect(byTitle.get(alpha.name)!.url).toBe(alpha.rss_url)
    expect(byTitle.get(beta.name)!.categories).toEqual([])
  })

  it.skip('WP4: feed stream IDs are feed/<numeric id>, and iconUrl is never an empty string', async () => {
    const { alpha, beta } = seedWorld()
    const res = await client(base).get(`${API}/subscription/list?output=json`)
    const subs = res.json().subscriptions as Record<string, unknown>[]
    expect(subs.map((s) => s.id).sort()).toEqual([`feed/${alpha.id}`, `feed/${beta.id}`].sort())
    for (const sub of subs) {
      if ('iconUrl' in sub) expect(sub.iconUrl).toEqual(expect.stringMatching(/^https?:\/\/.+/))
    }
  })

})

// ── unread-count ─────────────────────────────────────────────────────────────

describe.each(PREFIXES)('GET /reader/api/0/unread-count ($label)', ({ base }) => {
  it('returns max and per-feed, per-label and reading-list rows, reading-list last, without output=json', async () => {
    const { news, empty } = seedWorld()
    const res = await client(base).get(`${API}/unread-count`)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(JSON_CT)
    const body = res.json() as { max: unknown; unreadcounts: { id: string; count: unknown; newestItemTimestampUsec: unknown }[] }

    expect(body.max).toBe(2)
    for (const row of body.unreadcounts) {
      expect(typeof row.id).toBe('string')
      expect(Number.isInteger(row.count)).toBe(true)
      expect(row.newestItemTimestampUsec).toEqual(expect.stringMatching(DECIMAL))
    }
    const rows = new Map(body.unreadcounts.map((row) => [row.id, row]))
    expect(rows.get(`user/-/label/${news.name}`)!.count).toBe(1)
    expect(rows.get(`user/-/label/${empty.name}`)).toEqual({ id: `user/-/label/${empty.name}`, count: 0, newestItemTimestampUsec: '0' })
    expect(body.unreadcounts.at(-1)).toEqual({
      id: READING_LIST,
      count: 2,
      newestItemTimestampUsec: String(arrivalMs(ARRIVAL[2]) * 1000),
    })
    const feedRows = body.unreadcounts.filter((row) => row.id.startsWith('feed/'))
    expect(feedRows.map((row) => row.count).sort()).toEqual([1, 1])
    // newestItemTimestampUsec is arrival time of the newest item, read or not (Alpha's newest is the read one).
    expect(feedRows.map((row) => row.newestItemTimestampUsec).sort()).toEqual(
      [String(arrivalMs(ARRIVAL[1]) * 1000), String(arrivalMs(ARRIVAL[2]) * 1000)].sort(),
    )
  })

  it.skip('WP4: feed rows use feed/<numeric id>, matching subscription/list', async () => {
    const { alpha, beta } = seedWorld()
    const res = await client(base).get(`${API}/unread-count?output=json`)
    const ids = (res.json().unreadcounts as { id: string }[]).map((row) => row.id).filter((id) => id.startsWith('feed/'))
    expect(ids.sort()).toEqual([`feed/${alpha.id}`, `feed/${beta.id}`].sort())
  })

})

// ── stream/items/ids ─────────────────────────────────────────────────────────

describe.each(PREFIXES)('GET /reader/api/0/stream/items/ids ($label)', ({ base }) => {
  const ids = (query: string) => client(base).get(`${API}/stream/items/ids?output=json&${query}`)

  it('returns decimal-string refs, newest arrival first, with no continuation on the last page', async () => {
    const { unreadId, readId, starredId } = seedWorld()
    const res = await ids(`s=${enc(READING_LIST)}&n=1000`)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expectItemRefs(body)
    expect(refIds(body)).toEqual([starredId, readId, unreadId])
    expect(body).not.toHaveProperty('continuation')
  })

  it('reports arrival time in the Google-era itemRefs[].timestampUsec', async () => {
    const { unreadId } = seedWorld()
    const body = (await ids(`s=${enc(READING_LIST)}&n=1000`)).json()
    const ref = (body.itemRefs as { id: string; timestampUsec?: string }[]).find((r) => Number(r.id) === unreadId)!
    expect(ref.timestampUsec).toBe(String(arrivalMs(ARRIVAL[0]) * 1000))
  })

  it('honours xt=read, the starred state, feed and label streams, and r=o', async () => {
    const { unreadId, readId, starredId, alpha, news } = seedWorld()
    expect(refIds((await ids(`s=${enc(READING_LIST)}&xt=${enc(READ)}`)).json())).toEqual([starredId, unreadId])
    expect(refIds((await ids(`s=${enc(STARRED)}`)).json())).toEqual([starredId])
    expect(refIds((await ids(`s=${enc(`feed/${alpha.rss_url}`)}`)).json())).toEqual([readId, unreadId])
    expect(refIds((await ids(`s=${enc(`user/-/label/${news.name}`)}`)).json())).toEqual([readId, unreadId])
    expect(refIds((await ids(`s=${enc(READING_LIST)}&r=o`)).json())).toEqual([unreadId, readId, starredId])
  })

  it('honours n up to 10000', async () => {
    const { beta } = seedWorld()
    seedMany(beta.id, 30)
    expect((await ids(`s=${enc(READING_LIST)}&n=10000`)).json().itemRefs).toHaveLength(33)
    expect((await ids(`s=${enc(READING_LIST)}&n=5`)).json().itemRefs).toHaveLength(5)
  })

  it.skip('WP2: defaults n to 20 and pages with a continuation until the last page, which has none', async () => {
    const { beta } = seedWorld()
    seedMany(beta.id, 42) // 45 in total
    const first = (await ids(`s=${enc(READING_LIST)}`)).json()
    expect(first.itemRefs).toHaveLength(20)
    expect(first.continuation).toEqual(expect.stringMatching(/.+/))

    const seen: number[] = refIds(first)
    let continuation: string | undefined = first.continuation
    let pages = 1
    while (continuation && pages < 10) {
      const page = (await ids(`s=${enc(READING_LIST)}&c=${enc(continuation)}`)).json()
      expectItemRefs(page)
      seen.push(...refIds(page))
      continuation = page.continuation
      pages++
    }
    expect(pages).toBe(3)
    expect(seen).toHaveLength(45)
    expect(new Set(seen).size).toBe(45)
  })

  it('a page of exactly n items that ends the stream may carry a continuation, but the next page then has none and no items', async () => {
    const { beta } = seedWorld()
    seedMany(beta.id, 17) // 20 in total
    const first = (await ids(`s=${enc(READING_LIST)}&n=20`)).json()
    expect(first.itemRefs).toHaveLength(20)
    if (first.continuation !== undefined) {
      const next = (await ids(`s=${enc(READING_LIST)}&n=20&c=${enc(first.continuation)}`)).json()
      expect(next.itemRefs).toEqual([])
      expect(next).not.toHaveProperty('continuation')
    }
  })

  it.skip('WP2: paging is stable when articles arrive between pages', async () => {
    const { beta } = seedWorld()
    seedMany(beta.id, 37) // 40 in total
    const first = (await ids(`s=${enc(READING_LIST)}&n=20`)).json()
    seedMany(beta.id, 5, Date.UTC(2026, 9, 3) / 1000) // newer than everything
    const second = (await ids(`s=${enc(READING_LIST)}&n=20&c=${enc(first.continuation)}`)).json()
    const all = [...refIds(first), ...refIds(second)]
    expect(all).toHaveLength(40)
    expect(new Set(all).size).toBe(40)
  })

  it.skip('WP3: s=user/-/state/com.google/read and .../unread return only read or only unread items', async () => {
    const { unreadId, readId, starredId } = seedWorld()
    expect(refIds((await ids(`s=${enc(READ)}`)).json())).toEqual([readId])
    expect(refIds((await ids(`s=${enc(UNREAD)}`)).json())).toEqual([starredId, unreadId])
  })

  it.skip('WP3: it= filters by state (read, unread, starred)', async () => {
    const { unreadId, readId, starredId } = seedWorld()
    expect(refIds((await ids(`s=${enc(READING_LIST)}&it=${enc(READ)}`)).json())).toEqual([readId])
    expect(refIds((await ids(`s=${enc(READING_LIST)}&it=${enc(UNREAD)}`)).json())).toEqual([starredId, unreadId])
    expect(refIds((await ids(`s=${enc(READING_LIST)}&it=${enc(STARRED)}`)).json())).toEqual([starredId])
  })

  it.skip('WP3: xt=unread and xt=starred exclude those states', async () => {
    const { unreadId, readId } = seedWorld()
    expect(refIds((await ids(`s=${enc(READING_LIST)}&xt=${enc(UNREAD)}`)).json())).toEqual([readId])
    expect(refIds((await ids(`s=${enc(READING_LIST)}&xt=${enc(STARRED)}`)).json())).toEqual([readId, unreadId])
  })

  it.skip('WP4: accepts feed/<numeric id> as well as feed/<url>', async () => {
    const { readId, unreadId, alpha } = seedWorld()
    expect(refIds((await ids(`s=${enc(`feed/${alpha.id}`)}`)).json())).toEqual([readId, unreadId])
    expect(refIds((await ids(`s=${enc(`feed/${alpha.rss_url}`)}`)).json())).toEqual([readId, unreadId])
  })
})

// ── stream/items/contents ────────────────────────────────────────────────────

describe.each(PREFIXES)('POST /reader/api/0/stream/items/contents ($label)', ({ base }) => {
  const contents = (i: string[] | string) => client(base).post(`${API}/stream/items/contents`, { i })

  it('accepts tag-form and bare decimal IDs and returns items in the compat shape', async () => {
    const { unreadId, readId, starredId } = seedWorld()
    const res = await contents([tagId(unreadId), String(readId), tagId(starredId)])
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(JSON_CT)
    const body = res.json()
    expectStreamWrapper(body)
    expect(body.id).toBe(READING_LIST)
    expect(body.items).toHaveLength(3)
    for (const item of body.items) expectItemShape(item)
    expect(body.items.map(itemNumericId).sort()).toEqual([unreadId, readId, starredId].sort())
  })

  it('reports publication seconds in published, and state and label in categories', async () => {
    const { unreadId, readId, starredId, news } = seedWorld()
    const items = new Map<number, Record<string, unknown>>(
      (await contents([String(unreadId), String(readId), String(starredId)])).json().items
        .map((item: { id: string }) => [itemNumericId(item), item]),
    )
    const unread = items.get(unreadId)!
    expect(unread.published).toBe(Date.UTC(2020, 0, 1) / 1000)
    expect(unread.categories).toEqual(expect.arrayContaining([READING_LIST, `user/-/label/${news.name}`]))
    expect(unread.categories).not.toContain(READ)
    expect(unread.categories).not.toContain(STARRED)
    expect(items.get(readId)!.categories).toContain(READ)
    expect(items.get(starredId)!.categories).toContain(STARRED)
    expect(items.get(starredId)!.categories).not.toContain(READ)
  })

  it("reports each item's origin.streamId exactly as subscription/list reports the feed's id", async () => {
    const { unreadId, starredId } = seedWorld()
    const subs = (await client(base).get(`${API}/subscription/list?output=json`)).json().subscriptions as { id: string }[]
    const items = (await contents([String(unreadId), String(starredId)])).json().items as { origin: { streamId: string } }[]
    for (const item of items) expect(subs.map((s) => s.id)).toContain(item.origin.streamId)
  })

  it('silently drops IDs that do not exist', async () => {
    const { unreadId } = seedWorld()
    const body = (await contents([String(unreadId), '999999', tagId(888888)])).json()
    expect(body.items).toHaveLength(1)
  })

  // main parses the SQLite created_at ("YYYY-MM-DD HH:MM:SS", UTC) with new Date(),
  // which reads it as local time: crawlTimeMsec is off by the server's UTC offset
  // whenever TZ is not UTC. dateToTimestampUsec() in greader.ts already does it right.
  it.skip('WP3: crawlTimeMsec is arrival time in UTC milliseconds, whatever the server time zone', async () => {
    const { unreadId } = seedWorld()
    const [item] = (await contents(String(unreadId))).json().items
    expect(item.crawlTimeMsec).toBe(String(arrivalMs(ARRIVAL[0])))
  })

  it.skip('WP3: timestampUsec is arrival time in microseconds, equal to crawlTimeMsec * 1000', async () => {
    const { unreadId } = seedWorld()
    const [item] = (await contents(String(unreadId))).json().items
    expect(item.timestampUsec).toBe(String(arrivalMs(ARRIVAL[0]) * 1000))
    expect(item.timestampUsec).toBe(`${item.crawlTimeMsec}000`)
  })

  it.skip('WP3: omits author when the article has none, never substituting the feed name', async () => {
    const { unreadId } = seedWorld()
    const [item] = (await contents(String(unreadId))).json().items
    expect(item).not.toHaveProperty('author')
  })

  it.skip('WP3: decodes an all-digit ID with a leading zero as hex (0000000000001000 is 4096, not 1000)', async () => {
    const { alpha } = seedWorld()
    const a = insertArticle({ feed_id: alpha.id, title: 'Article 1000', url: 'https://alpha.example.com/1000', published_at: null })
    const b = insertArticle({ feed_id: alpha.id, title: 'Article 4096', url: 'https://alpha.example.com/4096', published_at: null })
    getDb().prepare('UPDATE articles SET id = ? WHERE id = ?').run(1000, a)
    getDb().prepare('UPDATE articles SET id = ? WHERE id = ?').run(4096, b)

    const [padded] = (await contents('0000000000001000')).json().items
    expect(padded.title).toBe('Article 4096')
    const [decimal] = (await contents('1000')).json().items
    expect(decimal.title).toBe('Article 1000')
    const [tagged] = (await contents('tag:google.com,2005:reader/item/0000000000001000')).json().items
    expect(tagged.title).toBe('Article 4096')
  })

  it.skip('WP2: returns every item of a 250-ID request (Capy Reader batch size)', async () => {
    const { beta } = seedWorld()
    const bulk = seedMany(beta.id, 250)
    const body = (await contents(bulk.map(String))).json()
    expect(body.items).toHaveLength(250)
  })

  it.skip('WP2: rejects more than 1000 IDs with 400 Bad Request!', async () => {
    seedWorld()
    const res = await contents(Array.from({ length: 1001 }, (_, n) => String(n + 1)))
    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Bad Request!')
  })

  it.skip('WP2: orders items like FreshRSS (newest arrival first; oldest first with r=o), whatever the request order', async () => {
    const { unreadId, readId, starredId } = seedWorld()
    const request = [String(readId), String(unreadId), String(starredId)]
    const desc = (await contents(request)).json().items.map(itemNumericId)
    expect(desc).toEqual([starredId, readId, unreadId])
    const asc = (await client(base).post(`${API}/stream/items/contents?r=o`, { i: request })).json().items.map(itemNumericId)
    expect(asc).toEqual([unreadId, readId, starredId])
  })

  it.skip('WP4: origin.streamId is feed/<numeric id>', async () => {
    const { unreadId, alpha } = seedWorld()
    const [item] = (await contents(String(unreadId))).json().items
    expect(item.origin.streamId).toBe(`feed/${alpha.id}`)
  })

})

// ── stream/contents ──────────────────────────────────────────────────────────

describe.each(PREFIXES)('GET /reader/api/0/stream/contents ($label)', ({ base }) => {
  const get = (path: string) => client(base).get(`${API}/stream/contents${path}`)
  const titles = (body: { items: { title: string }[] }) => body.items.map((item) => item.title)

  it('serves the query form (s=) with the stream wrapper and compat items', async () => {
    seedWorld()
    const res = await get(`?output=json&s=${enc(READING_LIST)}`)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(JSON_CT)
    const body = res.json()
    expectStreamWrapper(body)
    expect(titles(body)).toEqual(['Starred one', 'Read one', 'Unread one'])
    for (const item of body.items) expectItemShape(item)
    expect(body).not.toHaveProperty('continuation')
  })

  it('serves the path forms for reading-list, starred, label and percent-encoded feed URL streams', async () => {
    const { alpha, news } = seedWorld()
    expect(titles((await get(`/${READING_LIST}`)).json())).toEqual(['Starred one', 'Read one', 'Unread one'])
    expect(titles((await get(`/${STARRED}`)).json())).toEqual(['Starred one'])
    expect(titles((await get(`/user/-/label/${enc(news.name)}`)).json())).toEqual(['Read one', 'Unread one'])
    expect(titles((await get(`/feed/${enc(alpha.rss_url!)}`)).json())).toEqual(['Read one', 'Unread one'])
  })

  it('serves the reading list when no stream is given', async () => {
    seedWorld()
    expect(titles((await get('')).json())).toEqual(['Starred one', 'Read one', 'Unread one'])
  })

  it('honours xt=read and r=o', async () => {
    seedWorld()
    expect(titles((await get(`?s=${enc(READING_LIST)}&xt=${enc(READ)}`)).json())).toEqual(['Starred one', 'Unread one'])
    expect(titles((await get(`?s=${enc(READING_LIST)}&r=o`)).json())).toEqual(['Unread one', 'Read one', 'Starred one'])
  })

  it('pages with a non-empty continuation and omits it on the last page', async () => {
    const { beta } = seedWorld()
    seedMany(beta.id, 22) // 25 in total
    const first = (await get(`?s=${enc(READING_LIST)}&n=20`)).json()
    expectStreamWrapper(first)
    expect(first.items).toHaveLength(20)
    expect(first.continuation).toEqual(expect.stringMatching(/.+/))
    const second = (await get(`?s=${enc(READING_LIST)}&n=20&c=${enc(first.continuation)}`)).json()
    expectStreamWrapper(second)
    expect(second.items).toHaveLength(5)
    expect(second).not.toHaveProperty('continuation')
    const all = [...first.items, ...second.items].map((item: { id: string }) => item.id)
    expect(new Set(all).size).toBe(25)
  })

  it.skip('WP2: paging is stable when articles arrive between pages', async () => {
    const { beta } = seedWorld()
    seedMany(beta.id, 37) // 40 in total
    const first = (await get(`?s=${enc(READING_LIST)}&n=20`)).json()
    seedMany(beta.id, 5, Date.UTC(2026, 9, 3) / 1000)
    const second = (await get(`?s=${enc(READING_LIST)}&n=20&c=${enc(first.continuation)}`)).json()
    const all = [...first.items, ...second.items].map((item: { id: string }) => item.id)
    expect(all).toHaveLength(40)
    expect(new Set(all).size).toBe(40)
  })

  it.skip('WP2: honours n up to 1000 (default 20)', async () => {
    const { beta } = seedWorld()
    seedMany(beta.id, 147) // 150 in total
    expect((await get(`?s=${enc(READING_LIST)}`)).json().items).toHaveLength(20)
    const all = (await get(`?s=${enc(READING_LIST)}&n=1000`)).json()
    expect(all.items).toHaveLength(150)
    expect(all).not.toHaveProperty('continuation')
  })

  it.skip('WP3: it= filters by state', async () => {
    seedWorld()
    expect(titles((await get(`?s=${enc(READING_LIST)}&it=${enc(READ)}`)).json())).toEqual(['Read one'])
    expect(titles((await get(`?s=${enc(READING_LIST)}&it=${enc(STARRED)}`)).json())).toEqual(['Starred one'])
  })

  it.skip('WP4: accepts feed/<numeric id> in the path and in s=, and feed/<url> containing ?, & and #', async () => {
    const { alpha } = seedWorld()
    const odd = createFeed({ name: 'Odd', url: 'https://odd.example.com', rss_url: 'https://odd.example.com/feed/?a=1&b=2#x' })
    insertArticle({ feed_id: odd.id, title: 'Odd one', url: 'https://odd.example.com/1', published_at: null })
    expect(titles((await get(`/feed/${alpha.id}`)).json())).toEqual(['Read one', 'Unread one'])
    expect(titles((await get(`?s=${enc(`feed/${alpha.id}`)}`)).json())).toEqual(['Read one', 'Unread one'])
    expect(titles((await get(`/feed/${enc(odd.rss_url!)}`)).json())).toEqual(['Odd one'])
    expect(titles((await get(`?s=${enc(`feed/${odd.rss_url}`)}`)).json())).toEqual(['Odd one'])
  })

})

// ── edit-tag ─────────────────────────────────────────────────────────────────

describe.each(PREFIXES)('POST /reader/api/0/edit-tag ($label)', ({ base }) => {
  const editTag = (form: Form) => client(base).post(`${API}/edit-tag`, form)

  it('marks repeated i= (tag and decimal forms) read and answers plain-text OK', async () => {
    const { unreadId, starredId } = seedWorld()
    const res = await editTag({ i: [tagId(unreadId), String(starredId)], a: READ })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(TEXT_CT)
    expect(res.body).toBe('OK')
    expect(state(unreadId).seen_at).not.toBeNull()
    expect(state(starredId).seen_at).not.toBeNull()
  })

  it('marks unread with r=read, and stars and unstars', async () => {
    const { readId, unreadId, starredId } = seedWorld()
    expect((await editTag({ i: String(readId), r: READ })).body).toBe('OK')
    expect(state(readId).seen_at).toBeNull()
    expect((await editTag({ i: String(unreadId), a: STARRED })).body).toBe('OK')
    expect(state(unreadId).liked_at).not.toBeNull()
    expect((await editTag({ i: String(starredId), r: STARRED })).body).toBe('OK')
    expect(state(starredId).liked_at).toBeNull()
  })

  it.each([
    { label: 'T absent', form: {} },
    { label: 'T empty (FeedMe)', form: { T: '' } },
    { label: 'T=x (Reeder)', form: { T: 'x' } },
  ])('accepts the request with $label', async ({ form }) => {
    const { unreadId } = seedWorld()
    const res = await editTag({ i: String(unreadId), a: READ, ...form })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('OK')
  })

  it('answers OK to a user label on an item without changing its state', async () => {
    const { unreadId } = seedWorld()
    const res = await editTag({ i: String(unreadId), a: 'user/-/label/Later' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('OK')
    expect(state(unreadId)).toEqual({ seen_at: null, read_at: null, liked_at: null })
  })

  it.skip('WP3: applies every repeated a= and r=', async () => {
    const { unreadId, starredId } = seedWorld()
    expect((await editTag({ i: String(unreadId), a: [READ, STARRED] })).body).toBe('OK')
    expect(state(unreadId).seen_at).not.toBeNull()
    expect(state(unreadId).liked_at).not.toBeNull()
    getDb().prepare("UPDATE articles SET seen_at = datetime('now') WHERE id = ?").run(starredId)
    expect((await editTag({ i: String(starredId), r: [READ, STARRED] })).body).toBe('OK')
    expect(state(starredId).seen_at).toBeNull()
    expect(state(starredId).liked_at).toBeNull()
  })

  it.skip('WP3: decodes an all-digit ID with a leading zero as hex', async () => {
    const { alpha } = seedWorld()
    const a = insertArticle({ feed_id: alpha.id, title: 'Article 1000', url: 'https://alpha.example.com/1000', published_at: null })
    const b = insertArticle({ feed_id: alpha.id, title: 'Article 4096', url: 'https://alpha.example.com/4096', published_at: null })
    getDb().prepare('UPDATE articles SET id = ? WHERE id = ?').run(1000, a)
    getDb().prepare('UPDATE articles SET id = ? WHERE id = ?').run(4096, b)
    expect((await editTag({ i: '0000000000001000', a: STARRED })).body).toBe('OK')
    expect(state(4096).liked_at).not.toBeNull()
    expect(state(1000).liked_at).toBeNull()
  })

  it.skip('WP5: OK is text/plain; charset=UTF-8 with no trailing newline', async () => {
    const { unreadId } = seedWorld()
    const res = await editTag({ i: String(unreadId), a: READ })
    expect(res.headers['content-type']).toMatch(TEXT_CT_EXACT)
    expect(res.body).toBe('OK')
  })
})

// ── mark-all-as-read ─────────────────────────────────────────────────────────

describe.each(PREFIXES)('POST /reader/api/0/mark-all-as-read ($label)', ({ base }) => {
  const markAll = (form: Form) => client(base).post(`${API}/mark-all-as-read`, form)

  it('marks the whole reading list read and answers plain-text OK', async () => {
    const { unreadId, starredId } = seedWorld()
    const res = await markAll({ s: READING_LIST })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(TEXT_CT)
    expect(res.body).toBe('OK')
    expect(state(unreadId).seen_at).not.toBeNull()
    expect(state(starredId).seen_at).not.toBeNull()
  })

  it('marks only the given feed (feed/<url>) or label', async () => {
    const { unreadId, starredId, alpha, beta, news } = seedWorld()
    expect((await markAll({ s: `feed/${beta.rss_url}` })).body).toBe('OK')
    expect(state(starredId).seen_at).not.toBeNull()
    expect(state(unreadId).seen_at).toBeNull()

    const another = insertArticle({ feed_id: beta.id, title: 'Beta two', url: 'https://beta.example.com/4', published_at: null })
    expect((await markAll({ s: `user/-/label/${news.name}` })).body).toBe('OK')
    expect(state(unreadId).seen_at).not.toBeNull()
    expect(state(another).seen_at).toBeNull()
    expect(alpha.category_id).toBe(news.id)
  })

  it.skip('WP3: honours ts (microseconds): only items that arrived at or before ts', async () => {
    const { unreadId, starredId } = seedWorld()
    const ts = String(arrivalMs(ARRIVAL[0]) * 1000)
    expect((await markAll({ s: READING_LIST, ts })).body).toBe('OK')
    expect(state(unreadId).seen_at).not.toBeNull()
    expect(state(starredId).seen_at).toBeNull()
  })

  it.skip('WP3: accepts the starred stream and marks only starred items', async () => {
    const { unreadId, starredId } = seedWorld()
    expect((await markAll({ s: STARRED })).body).toBe('OK')
    expect(state(starredId).seen_at).not.toBeNull()
    expect(state(unreadId).seen_at).toBeNull()
  })

  it.skip('WP4: accepts feed/<numeric id>', async () => {
    const { unreadId, starredId, beta } = seedWorld()
    expect((await markAll({ s: `feed/${beta.id}` })).body).toBe('OK')
    expect(state(starredId).seen_at).not.toBeNull()
    expect(state(unreadId).seen_at).toBeNull()
  })

  it.skip('WP5: OK is text/plain; charset=UTF-8', async () => {
    seedWorld()
    const res = await markAll({ s: READING_LIST })
    expect(res.headers['content-type']).toMatch(TEXT_CT_EXACT)
    expect(res.body).toBe('OK')
  })
})

// ── subscription/edit (WP4) ──────────────────────────────────────────────────

describe.each(PREFIXES)('POST /reader/api/0/subscription/edit ($label)', ({ base }) => {
  const edit = (form: Form) => client(base).post(`${API}/subscription/edit`, form)
  const subscriptions = async () => (await client(base).get(`${API}/subscription/list?output=json`)).json().subscriptions as {
    id: string; title: string; categories: { id: string; label: string }[]
  }[]

  it.skip('WP4: ac=edit with t= renames the feed', async () => {
    const { alpha } = seedWorld()
    const res = await edit({ ac: 'edit', s: `feed/${alpha.id}`, t: 'Alpha renamed' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('OK')
    expect((await subscriptions()).map((s) => s.title)).toContain('Alpha renamed')
  })

  it.skip('WP4: ac=edit with a=user/-/label/<new> creates the category and moves the feed (a= alone replaces)', async () => {
    const { alpha } = seedWorld()
    expect((await edit({ ac: 'edit', s: `feed/${alpha.id}`, a: 'user/-/label/Brand New' })).body).toBe('OK')
    const sub = (await subscriptions()).find((s) => s.id === `feed/${alpha.id}`)!
    expect(sub.categories).toEqual([{ id: 'user/-/label/Brand New', label: 'Brand New' }])
    const tags = (await client(base).get(`${API}/tag/list?output=json`)).json().tags as { id: string }[]
    expect(tags.map((t) => t.id)).toContain('user/-/label/Brand New')
  })

  it.skip('WP4: ac=edit with r=user/-/label/<current> and no a= removes the feed from its category', async () => {
    const { alpha, news } = seedWorld()
    expect((await edit({ ac: 'edit', s: `feed/${alpha.id}`, r: `user/-/label/${news.name}` })).body).toBe('OK')
    expect((await subscriptions()).find((s) => s.id === `feed/${alpha.id}`)!.categories).toEqual([])
  })

  it.skip('WP4: accepts feed/<url> and repeated s=', async () => {
    const { alpha, beta } = seedWorld()
    expect((await edit({ ac: 'edit', s: [`feed/${alpha.rss_url}`, `feed/${beta.id}`], a: 'user/-/label/Both' })).body).toBe('OK')
    for (const sub of await subscriptions()) expect(sub.categories).toEqual([{ id: 'user/-/label/Both', label: 'Both' }])
  })

  it.skip('WP4: ac=unsubscribe deletes the feed', async () => {
    const { alpha } = seedWorld()
    expect((await edit({ ac: 'unsubscribe', s: `feed/${alpha.id}` })).body).toBe('OK')
    expect((await subscriptions()).map((s) => s.id)).not.toContain(`feed/${alpha.id}`)
  })

  it.skip.each([
    { label: 'no s', form: { ac: 'edit', t: 'x' } },
    { label: 'no ac', form: { s: 'feed/1' } },
    { label: 'an unknown ac', form: { ac: 'rename', s: 'feed/1' } },
    { label: 'an unknown feed', form: { ac: 'edit', s: 'feed/999999', t: 'x' } },
    { label: 'unsubscribe from an unknown feed', form: { ac: 'unsubscribe', s: 'feed/999999' } },
  ])('WP4: answers 400 Bad Request! for $label', async ({ form }) => {
    seedWorld()
    const res = await edit(form)
    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Bad Request!')
  })

  it.todo('WP4: ac=subscribe with s=feed/<url> adds the feed through the add-feed path, then applies t= and a= (needs fetch mocking)')
  it.todo('WP4: ac=subscribe for a feed that is already subscribed answers 400 Bad Request! (greader.php behaviour)')
})

// ── subscription/quickadd (WP4) ──────────────────────────────────────────────

describe.each(PREFIXES)('POST /reader/api/0/subscription/quickadd ($label)', ({ base }) => {
  it.skip('WP4: an already-subscribed URL gives numResults 0 and an error starting "Already subscribed!"', async () => {
    const { alpha } = seedWorld()
    const res = await client(base).post(`${API}/subscription/quickadd`, { quickadd: alpha.rss_url! })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.numResults).toBe(0)
    expect(body.error).toEqual(expect.stringMatching(/^Already subscribed!/))
  })

  it.todo('WP4: success gives {numResults: 1, query: <feed url>, streamId: "feed/<id>", streamName: <title>} (needs fetch mocking)')
  it.todo('WP4: quickadd is also read from the query string and accepts a feed/ prefix')
})

// ── rename-tag and disable-tag (WP4) ─────────────────────────────────────────

describe.each(PREFIXES)('POST /reader/api/0/rename-tag and disable-tag ($label)', ({ base }) => {
  const tagIds = async () => ((await client(base).get(`${API}/tag/list?output=json`)).json().tags as { id: string }[]).map((t) => t.id)

  it.skip('WP4: rename-tag renames the category', async () => {
    const { news } = seedWorld()
    const res = await client(base).post(`${API}/rename-tag`, { s: `user/-/label/${news.name}`, dest: 'user/-/label/Headlines' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('OK')
    const ids = await tagIds()
    expect(ids).toContain('user/-/label/Headlines')
    expect(ids).not.toContain(`user/-/label/${news.name}`)
  })

  it.skip('WP4: rename-tag of an unknown label, or without the user/-/label/ prefix, answers 400 Bad Request!', async () => {
    seedWorld()
    for (const form of [{ s: 'user/-/label/Nope', dest: 'user/-/label/X' }, { s: 'News', dest: 'Headlines' }]) {
      const res = await client(base).post(`${API}/rename-tag`, form)
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Bad Request!')
    }
  })

  it.skip('WP4: disable-tag deletes the category and keeps its feeds without a category', async () => {
    const { news, alpha } = seedWorld()
    const res = await client(base).post(`${API}/disable-tag`, { s: `user/-/label/${news.name}` })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('OK')
    expect(await tagIds()).not.toContain(`user/-/label/${news.name}`)
    const subs = (await client(base).get(`${API}/subscription/list?output=json`)).json().subscriptions as { title: string; categories: unknown[] }[]
    expect(subs.find((s) => s.title === alpha.name)!.categories).toEqual([])
  })

  it.skip('WP4: disable-tag of an unknown label answers 400 Bad Request!', async () => {
    seedWorld()
    const res = await client(base).post(`${API}/disable-tag`, { s: 'user/-/label/Nope' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Bad Request!')
  })
})

// ── subscription/import and export (WP4) ─────────────────────────────────────

describe.each(PREFIXES)('subscription/import and subscription/export ($label)', ({ base }) => {
  it.skip('WP4: GET subscription/export returns OPML as XML', async () => {
    const { alpha } = seedWorld()
    const res = await client(base).get(`${API}/subscription/export`)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^(application|text)\/xml/)
    expect(res.body).toContain('<opml')
    expect(res.body).toContain(alpha.rss_url)
  })

  it.todo('WP4: POST subscription/import with an OPML body imports the feeds and answers OK (needs fetch mocking)')
})

// ── check/compatibility (WP4) ────────────────────────────────────────────────

describe.each(PREFIXES)('GET /check/compatibility ($label)', ({ base }) => {
  it.skip('WP4: answers PASS when an Authorization: GoogleLogin auth=... header reaches the server (no auth check)', async () => {
    const res = await client(base).get('/check/compatibility', { auth: false, headers: { authorization: 'GoogleLogin auth=anything' } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(TEXT_CT)
    expect(res.body).toBe('PASS')
  })

  it.skip('WP4: answers the FAIL message with 200 when no Authorization header arrives', async () => {
    const res = await client(base).get('/check/compatibility', { auth: false })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('FAIL get HTTP Authorization header! Wrong Web server configuration.')
  })
})

// ── Error conventions (WP5) ──────────────────────────────────────────────────

describe.each(PREFIXES)('unknown paths ($label)', ({ base }) => {
  it.skip('WP5: an unknown authenticated reader path answers 400 Bad Request! as plain text', async () => {
    seedUser()
    for (const path of [`${API}/no-such-endpoint`, `${API}/stream/nothing`, `${API}/subscription/nothing`]) {
      const res = await client(base).get(path)
      expect(res.statusCode).toBe(400)
      expect(res.headers['content-type']).toMatch(TEXT_CT_EXACT)
      expect(res.body).toBe('Bad Request!')
    }
  })
})

describe('unknown paths under /api/greader.php', () => {
  it.skip('WP5: answer 400 Bad Request!, never the SPA or the JSON 404', async () => {
    seedUser()
    for (const url of ['/api/greader.php/nothing', '/api/greader.php/reader/nothing/here']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Bad Request!')
    }
  })
})
