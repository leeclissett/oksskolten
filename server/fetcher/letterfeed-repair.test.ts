import fs from 'node:fs'
import TurndownService from 'turndown'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { createFeed, getDb, markArticleBookmarked, markArticleSeen, updateArticleContent } from '../db.js'
import type { Feed } from '../db.js'
import { fetchSingleFeed } from '../fetcher.js'

// Piscina mock is provided globally by server/__tests__/setup.ts.

const EMAIL_HTML = fs.readFileSync(new URL('./fixtures/substack-email.html', import.meta.url), 'utf8')

// What the inline-content path stored before HTML email had its own
// extraction: the whole document through an unconfigured Turndown.
const RAW_DOCUMENT_DUMP = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).turndown(EMAIL_HTML)

const FEED_URL = 'https://letterfeed.example/api/feeds/newsletter'

function atomXml(entries: { id: string; title: string; html: string }[]): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:letterfeed:newsletter:42</id>
  <title>Newsletter</title>
  <updated>2026-09-29T13:15:57+00:00</updated>
  ${entries.map(e => `<entry>
    <id>${e.id}</id>
    <title>${e.title}</title>
    <updated>2026-09-29T13:15:57+00:00</updated>
    <content type="html">${escape(e.html)}</content>
  </entry>`).join('\n')}
</feed>`
}

const mockFetch = vi.fn()

function serveFeed(xml: string): void {
  mockFetch.mockImplementation((url: string | URL) => {
    if (url.toString() === FEED_URL) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/atom+xml' }),
        text: () => Promise.resolve(xml),
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode(xml).buffer),
      } as Response)
    }
    return Promise.reject(new Error(`unexpected fetch: ${url.toString()}`))
  })
}

interface Row {
  id: number
  url: string
  full_text: string
  excerpt: string | null
  summary: string | null
  full_text_translated: string | null
  translated_lang: string | null
  seen_at: string | null
  bookmarked_at: string | null
}

function rows(): Row[] {
  return getDb().prepare(
    'SELECT id, url, full_text, excerpt, summary, full_text_translated, translated_lang, seen_at, bookmarked_at FROM articles ORDER BY id',
  ).all() as Row[]
}

let feed: Feed

/** Ingest the entry, then put the article back into its pre-fix state. */
async function seedDumpedArticle(): Promise<Row> {
  serveFeed(atomXml([{ id: 'urn:letterfeed:entry:123', title: 'Issue', html: EMAIL_HTML }]))
  await fetchSingleFeed(feed, undefined, { skipCache: true })
  const [article] = rows()
  updateArticleContent(article.id, {
    full_text: RAW_DOCUMENT_DUMP,
    excerpt: RAW_DOCUMENT_DUMP.slice(0, 200),
    summary: 'Summary generated from the dump',
    full_text_translated: 'Translation generated from the dump',
    translated_lang: 'nl',
  })
  markArticleSeen(article.id, true)
  markArticleBookmarked(article.id, true)
  return rows()[0]
}

beforeEach(() => {
  setupTestDb()
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
  feed = createFeed({ name: 'Newsletter', url: 'https://letterfeed.example', rss_url: FEED_URL })
})

describe('repair of articles stored as a raw HTML document dump', () => {
  it('the seeded state reproduces the bug', async () => {
    const before = await seedDumpedArticle()
    expect(before.url).toBe(`${FEED_URL}#urn:letterfeed:entry:123`)
    expect(before.full_text).toContain('@media')
    expect(before.full_text).toContain('PREHEADER-MARKER')
  })

  it('rebuilds the article from the feed on the next fetch and keeps its state', async () => {
    const before = await seedDumpedArticle()

    await fetchSingleFeed(feed, undefined, { skipCache: true })

    const after = rows()
    expect(after).toHaveLength(1)
    const [article] = after
    expect(article.id).toBe(before.id)
    expect(article.url).toBe(before.url)

    expect(article.full_text).not.toContain('@media')
    expect(article.full_text).not.toContain('PREHEADER-MARKER')
    expect(article.full_text).not.toMatch(/<\/?(?:table|tbody|tr|td)\b/)
    expect(article.full_text).toContain('BODY-START-MARKER')
    expect(article.full_text).toContain('BODY-END-MARKER')
    expect(article.excerpt).not.toContain('@media')

    // Derived from the dump, so regenerated on demand.
    expect(article.summary).toBeNull()
    expect(article.full_text_translated).toBeNull()
    expect(article.translated_lang).toBeNull()

    // Reader state is preserved.
    expect(article.seen_at).toBe(before.seen_at)
    expect(article.bookmarked_at).toBe(before.bookmarked_at)
    expect(article.seen_at).not.toBeNull()
    expect(article.bookmarked_at).not.toBeNull()
  })

  it('is idempotent: a repaired article is not rewritten again', async () => {
    await seedDumpedArticle()
    await fetchSingleFeed(feed, undefined, { skipCache: true })
    const repaired = rows()[0]
    updateArticleContent(repaired.id, { summary: 'Fresh summary of the repaired text' })

    await fetchSingleFeed(feed, undefined, { skipCache: true })

    const again = rows()[0]
    expect(again.full_text).toBe(repaired.full_text)
    expect(again.summary).toBe('Fresh summary of the repaired text')
  })

  it('leaves an inline article alone when its braces are not a stylesheet dump', async () => {
    const before = await seedDumpedArticle()
    // Longer than MIN_EXTRACTED_LENGTH, so the unrelated stale-article refresh ignores it.
    const ownText = 'Notes on templating: write {name} and the renderer fills it in. '.repeat(5).trim()
    updateArticleContent(before.id, { full_text: ownText, summary: 'Kept' })

    await fetchSingleFeed(feed, undefined, { skipCache: true })

    const [article] = rows()
    expect(article.full_text).toBe(ownText)
    expect(article.summary).toBe('Kept')
  })

  it('cannot repair an article whose entry has rolled off the feed, and does not damage it', async () => {
    const before = await seedDumpedArticle()
    serveFeed(atomXml([{ id: 'urn:letterfeed:entry:999', title: 'A later issue', html: EMAIL_HTML }]))

    await fetchSingleFeed(feed, undefined, { skipCache: true })

    const old = rows().find(r => r.id === before.id)!
    expect(old.full_text).toBe(before.full_text)
    expect(old.summary).toBe('Summary generated from the dump')
  })
})
