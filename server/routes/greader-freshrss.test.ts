import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashSync } from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createFeed, getDb, insertArticle } from '../db.js'
import { clientLoginAttempts } from '../lib/login-attempts.js'

const { mockDiscoverRssUrl } = vi.hoisted(() => ({ mockDiscoverRssUrl: vi.fn() }))

vi.mock('../fetcher.js', async () => {
  const { EventEmitter } = await import('events')
  return {
    fetchAllFeeds: vi.fn(),
    fetchSingleFeed: vi.fn().mockResolvedValue(undefined),
    discoverRssUrl: (...args: unknown[]) => mockDiscoverRssUrl(...args),
    summarizeArticle: vi.fn(),
    streamSummarizeArticle: vi.fn(),
    translateArticle: vi.fn(),
    streamTranslateArticle: vi.fn(),
    fetchProgress: new EventEmitter(),
    getFeedState: vi.fn(),
  }
})

vi.mock('../rss-bridge.js', () => ({
  queryRssBridge: vi.fn().mockResolvedValue(null),
  inferCssSelectorBridge: vi.fn().mockResolvedValue(null),
}))

let app: FastifyInstance
let savedAuthDisabled: string | undefined

function seedUser(email = 'test@example.com', password = 'password123') {
  const hash = hashSync(password, 4)
  getDb().prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash)
}

async function freshRssLogin(email = 'test@example.com', password = 'password123') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/greader.php/accounts/ClientLogin',
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

describe('FreshRSS-compatible GReader prefix', () => {
  it('accepts ClientLogin under /api/greader.php', async () => {
    seedUser()

    const { res, auth } = await freshRssLogin()

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    expect(auth).toBeTruthy()
    expect(res.body).toContain('SID=')
    expect(res.body).toContain('Auth=')
  })

  it('protects prefixed reader endpoints', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/greader.php/reader/api/0/user-info',
    })

    expect(res.statusCode).toBe(401)
    expect(res.body).toContain('Error=NeedsBrowser')
  })

  it.each([
    '/api/greader.php/%72eader/api/0/user-info',
    '/api/greader.php/reader/%61pi/0/subscription/list?output=json',
    '/api/greader%2Ephp/reader/api/0/user-info',
    '/%61pi/greader.php/reader/api/0/stream/contents/user/-/state/com.google/reading-list',
  ])('protects prefixed reader endpoints reached through a percent-encoded path: %s', async (url) => {
    const res = await app.inject({ method: 'GET', url })

    expect(res.statusCode).toBe(401)
    expect(res.body).toContain('Error=NeedsBrowser')
  })

  it('serves authenticated reader endpoints under the FreshRSS base URL', async () => {
    seedUser()
    const feed = createFeed({ name: 'My Feed', url: 'https://example.com', rss_url: 'https://example.com/rss' })
    const { auth } = await freshRssLogin()

    const userInfo = await app.inject({
      method: 'GET',
      url: '/api/greader.php/reader/api/0/user-info',
      headers: { authorization: `GoogleLogin auth=${auth}` },
    })
    expect(userInfo.statusCode).toBe(200)
    expect(userInfo.json().userEmail).toBe('test@example.com')

    const subscriptions = await app.inject({
      method: 'GET',
      url: '/api/greader.php/reader/api/0/subscription/list?output=json',
      headers: { authorization: `GoogleLogin auth=${auth}` },
    })
    expect(subscriptions.statusCode).toBe(200)
    expect(subscriptions.json().subscriptions).toHaveLength(1)
    expect(subscriptions.json().subscriptions[0].id).toBe(`feed/${feed.id}`)
    expect(subscriptions.json().subscriptions[0].url).toBe('https://example.com/rss')

    const tags = await app.inject({
      method: 'GET',
      url: '/api/greader.php/reader/api/0/tag/list?output=json',
      headers: { authorization: `GoogleLogin auth=${auth}` },
    })
    expect(tags.statusCode).toBe(200)
    expect(tags.json().tags).toContainEqual({
      id: 'user/-/state/com.google/reading-list',
    })
  })

  it('completes the prefixed unread article sync sequence', async () => {
    seedUser()
    const feed = createFeed({
      name: 'My Feed',
      url: 'https://example.com',
      rss_url: 'https://example.com/rss',
    })
    const articleId = insertArticle({
      feed_id: feed.id,
      title: 'Visible article',
      url: 'https://example.com/article',
      published_at: '2025-01-01T00:00:00Z',
      summary: 'Article body',
    })
    const { auth } = await freshRssLogin()
    const headers = { authorization: `GoogleLogin auth=${auth}` }

    const stream = await app.inject({
      method: 'GET',
      url: '/api/greader.php/reader/api/0/stream/contents?output=json&n=1000&s=user%2F-%2Fstate%2Fcom.google%2Freading-list&xt=user%2F-%2Fstate%2Fcom.google%2Fread',
      headers,
    })
    expect(stream.statusCode).toBe(200)
    expect(stream.json()).toMatchObject({
      id: 'user/-/state/com.google/reading-list',
      items: [{ title: 'Visible article' }],
    })

    const unread = await app.inject({
      method: 'GET',
      url: '/api/greader.php/reader/api/0/unread-count?output=json',
      headers,
    })
    expect(unread.statusCode).toBe(200)
    expect(unread.json().max).toBe(1)

    const ids = await app.inject({
      method: 'GET',
      url: '/api/greader.php/reader/api/0/stream/items/ids?output=json&xt=user%2F-%2Fstate%2Fcom.google%2Fread',
      headers,
    })
    expect(ids.statusCode).toBe(200)
    expect(ids.json().itemRefs).toHaveLength(1)

    const contents = await app.inject({
      method: 'POST',
      url: '/api/greader.php/reader/api/0/stream/items/contents',
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `i=${encodeURIComponent(ids.json().itemRefs[0].id)}`,
    })
    expect(contents.statusCode).toBe(200)
    expect(contents.json().items).toHaveLength(1)
    expect(contents.json().items[0]).toMatchObject({
      title: 'Visible article',
      summary: { content: '<p>Article body</p>\n' },
      origin: { streamId: `feed/${feed.id}` },
    })

    const token = await app.inject({
      method: 'GET',
      url: '/api/greader.php/reader/api/0/token',
      headers,
    })
    expect(token.statusCode).toBe(200)

    const markRead = await app.inject({
      method: 'POST',
      url: '/api/greader.php/reader/api/0/edit-tag',
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `i=${articleId}&a=${encodeURIComponent('user/-/state/com.google/read')}&T=${encodeURIComponent(token.body)}`,
    })
    expect(markRead.statusCode).toBe(200)
    expect(markRead.body).toBe('OK')

    const row = getDb().prepare('SELECT seen_at, read_at FROM articles WHERE id = ?').get(articleId) as {
      seen_at: string | null
      read_at: string | null
    }
    expect(row.seen_at).not.toBeNull()
    expect(row.read_at).not.toBeNull()
  })

  it.each([
    { queueState: 'completed', translationStatus: 'completed', translationTargetLang: 'en', translatedTitle: 'English title', expectedTitle: 'English title' },
    { queueState: 'legacy or manually cached', translationStatus: null, translationTargetLang: null, translatedTitle: 'English title', expectedTitle: 'English title' },
    { queueState: 'body-only', translationStatus: 'completed', translationTargetLang: 'en', translatedTitle: null, expectedTitle: 'Nederlandse titel' },
  ])('serves a matching $queueState feed translation through stream and item content responses', async ({ translationStatus, translationTargetLang, translatedTitle, expectedTitle }) => {
    seedUser()
    const feed = createFeed({
      name: 'Dutch Feed',
      url: 'https://example.com/nl',
      rss_url: 'https://example.com/nl/rss',
      auto_translate_target: 'en',
    })
    const articleId = insertArticle({
      feed_id: feed.id,
      title: 'Nederlandse titel',
      url: 'https://example.com/nl/article',
      published_at: '2025-01-01T00:00:00Z',
      lang: 'nl',
      full_text: 'Nederlandse tekst.',
      full_text_translated: 'English body.',
      translated_lang: 'en',
    })
    getDb().prepare(`
      UPDATE articles
      SET title_translated = ?, excerpt_translated = ?,
          translation_target_lang = ?, translation_status = ?
      WHERE id = ?
    `).run(translatedTitle, 'English excerpt.', translationTargetLang, translationStatus, articleId)

    const { auth } = await freshRssLogin()
    const headers = { authorization: `GoogleLogin auth=${auth}` }
    const stream = await app.inject({
      method: 'GET',
      url: '/api/greader.php/reader/api/0/stream/contents?output=json&s=user%2F-%2Fstate%2Fcom.google%2Freading-list',
      headers,
    })

    expect(stream.statusCode).toBe(200)
    expect(stream.json().items).toHaveLength(1)
    expect(stream.json().items[0]).toMatchObject({
      title: expectedTitle,
      summary: { content: '<p>English body.</p>\n' },
    })

    const contents = await app.inject({
      method: 'POST',
      url: '/api/greader.php/reader/api/0/stream/items/contents',
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `i=${articleId}`,
    })

    expect(contents.statusCode).toBe(200)
    expect(contents.json().items).toHaveLength(1)
    expect(contents.json().items[0]).toMatchObject({
      title: expectedTitle,
      summary: { content: '<p>English body.</p>\n' },
    })
  })

  it.each([
    {
      reason: 'the translated language differs from the feed target',
      translatedLang: 'ja',
      translatedBody: '日本語の本文。',
      feedTarget: 'en',
    },
    {
      reason: 'the translated body is empty',
      translatedLang: 'en',
      translatedBody: '',
      feedTarget: 'en',
    },
    {
      reason: 'the translated body is whitespace',
      translatedLang: 'en',
      translatedBody: '   ',
      feedTarget: 'en',
    },
    {
      reason: 'automatic translation is disabled for the feed',
      translatedLang: 'en',
      translatedBody: 'English body.',
      feedTarget: null,
    },
  ])('serves original content when $reason', async ({ translatedLang, translatedBody, feedTarget }) => {
    seedUser()
    const feed = createFeed({
      name: 'Dutch Feed',
      url: 'https://example.com/nl',
      rss_url: 'https://example.com/nl/rss',
      auto_translate_target: feedTarget,
    })
    const articleId = insertArticle({
      feed_id: feed.id,
      title: 'Nederlandse titel',
      url: 'https://example.com/nl/article',
      published_at: '2025-01-01T00:00:00Z',
      lang: 'nl',
      full_text: 'Nederlandse tekst.',
      full_text_translated: translatedBody,
      translated_lang: translatedLang,
    })
    getDb().prepare(`
      UPDATE articles
      SET title_translated = ?, excerpt_translated = ?,
          translation_target_lang = ?, translation_status = ?
      WHERE id = ?
    `).run('Translated title', 'Translated excerpt.', 'en', 'completed', articleId)

    const { auth } = await freshRssLogin()
    const response = await app.inject({
      method: 'GET',
      url: '/api/greader.php/reader/api/0/stream/contents?output=json&s=user%2F-%2Fstate%2Fcom.google%2Freading-list',
      headers: { authorization: `GoogleLogin auth=${auth}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().items).toHaveLength(1)
    expect(response.json().items[0]).toMatchObject({
      title: 'Nederlandse titel',
      summary: { content: '<p>Nederlandse tekst.</p>\n' },
    })
  })
})

describe('full unread sync under /api/greader.php (4 Nov 2026 log)', () => {
  // The app asked stream/items/ids?n=1000&xt=read over ~4,700 unread articles
  // and got exactly 1,000 refs with no continuation, so it never saw the rest.
  it('pages every unread ref at n=1000 and fetches them all in 250-ID batches, with an arrival mid-walk', async () => {
    seedUser()
    const feed = createFeed({ name: 'Busy', url: 'https://busy.example.com', rss_url: 'https://busy.example.com/rss' })
    const db = getDb()
    const setArrival = db.prepare("UPDATE articles SET created_at = datetime(?, 'unixepoch') WHERE id = ?")
    const startSec = Date.UTC(2026, 9, 1) / 1000
    const seeded = db.transaction(() => Array.from({ length: 2500 }, (_, i) => {
      const id = insertArticle({ feed_id: feed.id, title: `Unread ${i}`, url: `https://busy.example.com/${i}`, published_at: '2026-01-01T00:00:00Z' })
      setArrival.run(startSec + i, id)
      return id
    }))()
    db.prepare("UPDATE articles SET seen_at = datetime('now'), read_at = datetime('now') WHERE id IN (?, ?)").run(seeded[0], seeded[1])
    const unread = seeded.slice(2)

    const { auth } = await freshRssLogin()
    const headers = { authorization: `GoogleLogin auth=${auth}` }
    const idsUrl = '/api/greader.php/reader/api/0/stream/items/ids?output=json&n=1000&s=user%2F-%2Fstate%2Fcom.google%2Freading-list&xt=user%2F-%2Fstate%2Fcom.google%2Fread'

    const refs: string[] = []
    const pageSizes: number[] = []
    let continuation: string | undefined
    do {
      const res = await app.inject({ method: 'GET', url: `${idsUrl}${continuation ? `&c=${encodeURIComponent(continuation)}` : ''}`, headers })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      refs.push(...body.itemRefs.map((ref: { id: string }) => ref.id))
      pageSizes.push(body.itemRefs.length)
      continuation = body.continuation
      if (pageSizes.length === 1) {
        insertArticle({ feed_id: feed.id, title: 'Arrived mid-sync', url: 'https://busy.example.com/late', published_at: null })
      }
    } while (continuation && pageSizes.length < 10)

    expect(pageSizes).toEqual([1000, 1000, 498])
    expect(refs.map(Number)).toEqual([...unread].reverse())

    const titles = new Set<string>()
    for (let i = 0; i < refs.length; i += 250) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/greader.php/reader/api/0/stream/items/contents',
        headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
        payload: refs.slice(i, i + 250).map((id) => `i=${id}`).join('&'),
      })
      expect(res.statusCode).toBe(200)
      for (const item of res.json().items as { title: string }[]) titles.add(item.title)
    }
    expect(titles.size).toBe(2498)
  }, 30_000)
})

describe('ClientLogin under /api/greader.php', () => {
  it('accepts GET with Email/Passwd query parameters', async () => {
    seedUser()
    const res = await app.inject({
      method: 'GET',
      url: '/api/greader.php/accounts/ClientLogin?Email=test%40example.com&Passwd=password123',
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatch(/^SID=.+\nLSID=.+\nAuth=.+\n$/)
  })

  it('shares one failure bucket with the root path, so alternating paths gains no attempts', async () => {
    seedUser()
    for (let i = 0; i < 10; i++) {
      const url = i % 2 === 0 ? '/accounts/ClientLogin' : '/api/greader.php/accounts/ClientLogin'
      const res = await app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'Email=test%40example.com&Passwd=wrong',
      })
      expect(res.statusCode).toBe(403)
    }
    const { res } = await freshRssLogin()
    expect(res.statusCode).toBe(429)
    expect(res.headers['content-type']).toBe('text/plain; charset=UTF-8')
    expect(res.headers['retry-after']).toMatch(/^\d+$/)
    expect(res.body).toBe('Too Many Requests\n')
  })
})

describe('FreshRSS item IDs, timestamps and states under /api/greader.php (WP3)', () => {
  const API = '/api/greader.php/reader/api/0'

  async function authed() {
    seedUser()
    const { auth } = await freshRssLogin()
    return { authorization: `GoogleLogin auth=${auth}` }
  }

  it('serves Capy Reader\'s read stream and fetches the items by zero-padded hex ID, with arrival timestamps', async () => {
    const headers = await authed()
    const feed = createFeed({ name: 'Feed', url: 'https://example.com', rss_url: 'https://example.com/rss' })
    const read = insertArticle({ feed_id: feed.id, title: 'Read', url: 'https://example.com/r', published_at: '2018-03-04T05:06:07Z' })
    insertArticle({ feed_id: feed.id, title: 'Unread', url: 'https://example.com/u', published_at: '2018-03-04T05:06:07Z' })
    getDb().prepare("UPDATE articles SET seen_at = datetime('now'), created_at = '2026-11-01 12:00:00' WHERE id = ?").run(read)

    const ids = await app.inject({ method: 'GET', url: `${API}/stream/items/ids?s=${encodeURIComponent('user/-/state/com.google/read')}&n=1000`, headers })
    const refs = ids.json().itemRefs as { id: string; timestampUsec: string }[]
    expect(refs.map((r) => Number(r.id))).toEqual([read])

    const contents = await app.inject({
      method: 'POST',
      url: `${API}/stream/items/contents`,
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `i=${read.toString(16).padStart(16, '0')}`,
    })
    const [item] = contents.json().items
    expect(item.title).toBe('Read')
    expect(item.crawlTimeMsec).toBe(String(Date.UTC(2026, 10, 1, 12)))
    expect(item.timestampUsec).toBe(refs[0].timestampUsec)
    expect(item.published).toBe(Date.UTC(2018, 2, 4, 5, 6, 7) / 1000)
  })

  it('answers token with 57 characters and a newline', async () => {
    const headers = await authed()
    const res = await app.inject({ method: 'GET', url: `${API}/token`, headers })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatch(/^[0-9A-Za-z]{57}\n$/)
  })

  it('rejects mark-all-as-read with a non-numeric ts or an unknown stream', async () => {
    const headers = { ...(await authed()), 'content-type': 'application/x-www-form-urlencoded' }
    for (const payload of ['s=user%2F-%2Fstate%2Fcom.google%2Freading-list&ts=now', 's=nonsense', '']) {
      const res = await app.inject({ method: 'POST', url: `${API}/mark-all-as-read`, headers, payload })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Bad Request!')
    }
  })

  it('manages subscriptions under the prefix the way Capy Reader does: quickadd, move, rename folder, delete folder, unsubscribe', async () => {
    seedUser()
    const { auth } = await freshRssLogin()
    const base = '/api/greader.php/reader/api/0'
    const headers = { authorization: `GoogleLogin auth=${auth}`, 'content-type': 'application/x-www-form-urlencoded' }
    const post = (path: string, payload: string) => app.inject({ method: 'POST', url: `${base}${path}`, headers, payload })
    const subs = async () => (await app.inject({ method: 'GET', url: `${base}/subscription/list?output=json`, headers })).json().subscriptions

    mockDiscoverRssUrl.mockResolvedValue({ rssUrl: 'https://capy.example.com/feed/', title: 'Capy', usedFlareSolverr: false })
    const added = await post('/subscription/quickadd', 'quickadd=https%3A%2F%2Fcapy.example.com')
    expect(added.statusCode).toBe(200)
    const { streamId } = added.json()
    expect(streamId).toMatch(/^feed\/\d+$/)

    const again = await post('/subscription/quickadd', 'quickadd=https%3A%2F%2Fcapy.example.com%2Ffeed%2F')
    expect(again.json()).toEqual({ numResults: 0, error: 'Already subscribed! https://capy.example.com/feed/' })

    expect((await post('/subscription/edit', `ac=edit&s=${encodeURIComponent(streamId)}&a=user%2F-%2Flabel%2FPets`)).body).toBe('OK')
    expect((await subs())[0].categories).toEqual([{ id: 'user/-/label/Pets', label: 'Pets' }])

    expect((await post('/rename-tag', 's=user%2F-%2Flabel%2FPets&dest=user%2F-%2Flabel%2FAnimals')).body).toBe('OK')
    expect((await subs())[0].categories).toEqual([{ id: 'user/-/label/Animals', label: 'Animals' }])

    expect((await post('/disable-tag', 's=user%2F-%2Flabel%2FAnimals')).body).toBe('OK')
    expect((await subs())[0].categories).toEqual([])

    expect((await post('/subscription/edit', `ac=unsubscribe&s=${encodeURIComponent(streamId)}`)).body).toBe('OK')
    expect(await subs()).toEqual([])
  })

  it('protects the subscription management endpoints under the prefix (invalid token)', async () => {
    seedUser()
    for (const [method, path] of [
      ['POST', 'subscription/edit'], ['POST', 'subscription/quickadd'], ['POST', 'subscription/import'],
      ['GET', 'subscription/export'], ['POST', 'rename-tag'], ['POST', 'disable-tag'],
    ] as const) {
      const res = await app.inject({ method, url: `/api/greader.php/reader/api/0/${path}`, headers: { authorization: 'GoogleLogin auth=not-a-token' } })
      expect(res.statusCode).toBe(401)
    }
  })

  it('serves check/compatibility under the prefix without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/greader.php/check/compatibility', headers: { authorization: 'GoogleLogin auth=x' } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('PASS')
  })
})
