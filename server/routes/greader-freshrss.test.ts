import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashSync } from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createFeed, getDb, insertArticle } from '../db.js'

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

  it('serves authenticated reader endpoints under the FreshRSS base URL', async () => {
    seedUser()
    createFeed({ name: 'My Feed', url: 'https://example.com', rss_url: 'https://example.com/rss' })
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
    expect(subscriptions.json().subscriptions[0].id).toBe('feed/https://example.com/rss')
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
      origin: { streamId: 'feed/https://example.com/rss' },
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
