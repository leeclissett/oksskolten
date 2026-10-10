import fs from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { fetchArticleContent } from '../fetcher.js'
import { isHtmlDocument } from './content.js'

// Piscina mock is provided globally by server/__tests__/setup.ts, so the
// worker's parseHtml runs in-process against the real cleaner pipeline.

// The markup of a real Substack newsletter email as LetterFeed relays it (the
// whole document, <head> included), with text and URLs replaced by placeholders.
const EMAIL_HTML = fs.readFileSync(new URL('./fixtures/substack-email.html', import.meta.url), 'utf8')

// LetterFeed entries have no link; rss.ts gives them a synthetic fragment URL.
const ENTRY_URL = 'https://letterfeed.example/api/feeds/newsletter#urn:letterfeed:entry:123'

const mockFetch = vi.fn()

beforeEach(() => {
  setupTestDb()
  mockFetch.mockReset()
  mockFetch.mockRejectedValue(new Error('network access is not expected for inline content'))
  vi.stubGlobal('fetch', mockFetch)
})

describe('isHtmlDocument', () => {
  it.each([
    ['<!DOCTYPE html><html><body><p>x</p></body></html>', true],
    ['<html lang="en"><head></head></html>', true],
    ['<body class="email-body"><p>x</p></body>', true],
    ['<p>Just a fragment with a <a href="/x">link</a></p>', false],
    ['<header><h1>Fragment</h1></header>', false],
    ['Plain text', false],
  ])('%s → %s', (content, expected) => {
    expect(isHtmlDocument(content)).toBe(expected)
  })
})

describe('LetterFeed entry carrying a full HTML email', () => {
  it('is extracted as a clean article instead of a dump of the raw document', async () => {
    const result = await fetchArticleContent(ENTRY_URL, { listingExcerpt: EMAIL_HTML })
    const md = result.fullText!

    expect(result.lastError).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()

    // The stylesheet and <title> from <head> must not leak into the body.
    expect(md).not.toContain('@media')
    expect(md).not.toMatch(/\{[^}]*:[^}]*;/)
    expect(md).not.toContain('Fixture Newsletter: the issue title')

    // Email chrome: hidden preheader, open-tracking pixel, footer.
    expect(md).not.toContain('PREHEADER-MARKER')
    expect(md).not.toContain('pixel.gif')
    expect(md).not.toContain('FOOTER-MARKER')

    // Layout tables are unwrapped, not passed through as raw HTML.
    expect(md).not.toMatch(/<\/?(?:table|tbody|tr|td)\b/)

    // The article itself survives from first paragraph to last, with its
    // images and list structure.
    expect(md).toContain('BODY-START-MARKER')
    expect(md).toContain('BODY-END-MARKER')
    expect(md.match(/!\[[^\]]*\]\(https:\/\/example\.com\/image\/\d+\.png\)/g)!.length).toBeGreaterThanOrEqual(4)
    expect(md).toMatch(/^1\. {2}\S/m)
    expect(md).toMatch(/^ {4}\* {3}\S/m)

    // A whitespace-only <span> between a bold and an italic run stays a space.
    expect(md).not.toMatch(/\)\*\*_\(/)
    expect(md).toMatch(/\)\*\* _\(/)

    expect(result.excerpt).toBeTruthy()
    expect(result.excerpt).not.toContain('@media')
  })

  it('falls back to plain conversion, still without <head> content, when extraction yields too little', async () => {
    const html = `<html><head><title>Receipt</title><style>
      @media (max-width: 600px) { .wrap { width: 100%; } }
    </style></head><body><p>Your order has shipped.</p></body></html>`

    const result = await fetchArticleContent(ENTRY_URL, { listingExcerpt: html })

    expect(result.fullText).toBe('Your order has shipped.')
    expect(result.lastError).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('reports the original post address when the email carries one', async () => {
    const withPostLink = EMAIL_HTML.replace(
      /<body[^>]*>/,
      (bodyTag) => `${bodyTag}<a href="https://open.substack.com/pub/example/p/the-issue?utm_source=email&amp;token=SECRET">Read in app</a>`,
    )

    const result = await fetchArticleContent(ENTRY_URL, { listingExcerpt: withPostLink })

    expect(result.sourceUrl).toBe('https://open.substack.com/pub/example/p/the-issue')
    expect(result.fullText).toContain('BODY-START-MARKER')
  })

  it('reports no post address when the email has none', async () => {
    const result = await fetchArticleContent(ENTRY_URL, { listingExcerpt: EMAIL_HTML })
    expect(result.sourceUrl).toBeNull()
  })

  it('keeps converting HTML fragments directly, without article extraction', async () => {
    const fragment = '<h2>2.1.74</h2><p>Fixed a <a href="https://example.com/bug">bug</a>.</p>'

    const result = await fetchArticleContent('https://example.com/changelog#2-1-74', { listingExcerpt: fragment })

    expect(result.fullText).toBe('## 2.1.74\n\nFixed a [bug](https://example.com/bug).')
    expect(result.sourceUrl).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
