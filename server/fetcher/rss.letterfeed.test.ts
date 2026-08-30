import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAndParseRss } from './rss.js'

const mockSafeFetch = vi.fn()
vi.mock('./ssrf.js', () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}))

let feedsmithShouldFail = false
vi.mock('feedsmith', async (importOriginal) => {
  const real = await importOriginal<typeof import('feedsmith')>()
  return {
    ...real,
    parseFeed: (...args: Parameters<typeof real.parseFeed>) => {
      if (feedsmithShouldFail) throw new Error('feedsmith failed')
      return real.parseFeed(...args)
    },
  }
})

const FEED_URL = 'https://letterfeed.example/feeds/newsletter'
const SYNTHETIC_URL = `${FEED_URL}#urn:letterfeed:entry:123`

const LETTERFEED_ATOM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:letterfeed:newsletter:42</id>
  <title>Example Newsletter</title>
  <updated>2026-08-01T09:00:00Z</updated>
  <link href="${FEED_URL}" rel="self" />
  <link href="https://letterfeed.example/" rel="alternate" />
  <entry>
    <id>urn:letterfeed:entry:123</id>
    <title>Weekly update</title>
    <content type="html">&lt;p&gt;Full newsletter body&lt;/p&gt;</content>
    <published>2026-08-01T09:00:00Z</published>
    <updated>2026-08-01T09:00:00Z</updated>
  </entry>
</feed>`

const LINKED_ATOM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:letterfeed:newsletter:42</id>
  <title>Example Newsletter</title>
  <updated>2026-08-01T09:00:00Z</updated>
  <entry>
    <id>urn:letterfeed:entry:123</id>
    <title>Linked update</title>
    <link href="https://publisher.example/issues/123" rel="alternate" />
    <content type="html">&lt;p&gt;Full newsletter body&lt;/p&gt;</content>
    <published>2026-08-01T09:00:00Z</published>
    <updated>2026-08-01T09:00:00Z</updated>
  </entry>
</feed>`

const LINKLESS_ATOM_WITHOUT_CONTENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:letterfeed:newsletter:42</id>
  <title>Example Newsletter</title>
  <updated>2026-08-01T10:00:00Z</updated>
  <entry>
    <id>urn:letterfeed:entry:124</id>
    <title>Empty update</title>
    <published>2026-08-01T10:00:00Z</published>
    <updated>2026-08-01T10:00:00Z</updated>
  </entry>
</feed>`

function mockResponse(body: string) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    headers: new Headers({ 'content-type': 'application/atom+xml' }),
  }
}

async function parse(xml: string, rssUrl = FEED_URL) {
  mockSafeFetch.mockResolvedValue(mockResponse(xml))
  return fetchAndParseRss({
    id: 1,
    name: 'LetterFeed',
    url: 'https://letterfeed.example',
    rss_url: rssUrl,
  } as any)
}

describe('LetterFeed-compatible Atom entries', () => {
  beforeEach(() => {
    mockSafeFetch.mockReset()
    feedsmithShouldFail = false
  })

  it.each([
    ['feedsmith', false],
    ['fast-xml-parser fallback', true],
  ] as const)('creates a stable synthetic URL via %s', async (_parser, useFallback) => {
    feedsmithShouldFail = useFallback

    const { items } = await parse(LETTERFEED_ATOM_XML)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: 'Weekly update',
      url: SYNTHETIC_URL,
    })
    expect(items[0].excerpt).toContain('Full newsletter body')
  })

  it.each([
    ['feedsmith', false],
    ['fast-xml-parser fallback', true],
  ] as const)('preserves a canonical entry link via %s', async (_parser, useFallback) => {
    feedsmithShouldFail = useFallback

    const { items } = await parse(LINKED_ATOM_XML)

    expect(items).toHaveLength(1)
    expect(items[0].url).toBe('https://publisher.example/issues/123')
  })

  it.each([
    ['feedsmith', false],
    ['fast-xml-parser fallback', true],
  ] as const)('rejects a linkless entry without inline content via %s', async (_parser, useFallback) => {
    feedsmithShouldFail = useFallback

    const { items } = await parse(LINKLESS_ATOM_WITHOUT_CONTENT_XML)

    expect(items).toHaveLength(0)
  })

  it('preserves feed query parameters in the synthetic URL', async () => {
    const { items } = await parse(LETTERFEED_ATOM_XML, `${FEED_URL}?token=test`)

    expect(items[0].url).toBe(
      `${FEED_URL}?token=test#urn:letterfeed:entry:123`,
    )
  })
})
