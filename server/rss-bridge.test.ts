import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from './__tests__/helpers/testDb.js'
import { upsertSetting } from './db.js'

// --- LLM provider mock ---

const mockCreateMessage = vi.fn()

vi.mock('./providers/llm/index.js', () => ({
  getProvider: () => ({
    name: 'anthropic',
    requireKey: vi.fn(),
    createMessage: mockCreateMessage,
    streamMessage: vi.fn(),
  }),
}))

// --- fetchHtml mock (replaces safeFetch for inferCssSelectorBridge) ---

const mockFetchHtml = vi.fn()

vi.mock('./fetcher/http.js', () => ({
  fetchHtml: (...args: unknown[]) => mockFetchHtml(...args),
  USER_AGENT: 'Mozilla/5.0 (compatible; RSSReader/1.0)',
  DEFAULT_TIMEOUT: 15_000,
  DISCOVERY_TIMEOUT: 10_000,
  PROBE_TIMEOUT: 5_000,
}))

// --- global.fetch mock (used by queryRssBridge and validateBridgeFeed) ---

const mockFetch = vi.fn()

// --- env setup (must be set BEFORE import so module-level const captures it) ---

const BRIDGE_URL = 'http://rss-bridge.local'
process.env.RSS_BRIDGE_URL = BRIDGE_URL

// --- import after mocks and env ---

const { queryRssBridge, getAvailableProvider, buildCssSelectorBridgeUrl, inferCssSelectorBridge } = await import(
  './rss-bridge.js'
)

beforeEach(() => {
  setupTestDb()
  mockCreateMessage.mockReset()
  mockFetchHtml.mockReset()
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

// ============================================================
// getAvailableProvider
// ============================================================

describe('getAvailableProvider', () => {
  it('returns anthropic provider when anthropic key is set', () => {
    upsertSetting('api_key.anthropic', 'sk-test')

    const result = getAvailableProvider()
    expect(result).not.toBeNull()
    expect(result!.provider.name).toBe('anthropic')
    expect(result!.model).toBe('claude-haiku-4-5-20251001')
  })

  it('returns gemini provider when only gemini key is set', () => {
    upsertSetting('api_key.gemini', 'gemini-key')

    const result = getAvailableProvider()
    expect(result).not.toBeNull()
    expect(result!.provider.name).toBe('anthropic') // mock always returns 'anthropic' name
    expect(result!.model).toBeDefined()
  })

  it('returns null when no API keys are set', () => {
    const result = getAvailableProvider()
    expect(result).toBeNull()
  })

  it('prefers anthropic over gemini when both are set', () => {
    upsertSetting('api_key.anthropic', 'sk-test')
    upsertSetting('api_key.gemini', 'gemini-key')

    const result = getAvailableProvider()
    expect(result).not.toBeNull()
    // model should be the anthropic default since anthropic has priority
    expect(result!.model).toBe('claude-haiku-4-5-20251001')
  })
})

// ============================================================
// buildCssSelectorBridgeUrl
// ============================================================

describe('buildCssSelectorBridgeUrl', () => {
  it('builds correct URL with all parameters', () => {
    const url = buildCssSelectorBridgeUrl('https://example.com', 'a.post-link')

    expect(url).toContain(BRIDGE_URL)
    expect(url).toContain('action=display')
    expect(url).toContain('bridge=CssSelectorBridge')
    expect(url).toContain('home_page=https%3A%2F%2Fexample.com')
    expect(url).toContain('url_selector=a.post-link')
    expect(url).toContain('format=Atom')
  })

  it('encodes special characters in selectors', () => {
    const url = buildCssSelectorBridgeUrl('https://example.com', 'a[href*="/blog/"]')
    expect(url).toContain('url_selector=a%5Bhref*%3D%22%2Fblog%2F%22%5D')
  })
})

// ============================================================
// inferCssSelectorBridge
// ============================================================

describe('inferCssSelectorBridge', () => {
  const blogHtml = `
    <html><body>
      <nav><a href="/">Home</a></nav>
      <div class="posts">
        <article><a class="post-link" href="/blog/post-1">First Post</a></article>
        <article><a class="post-link" href="/blog/post-2">Second Post</a></article>
        <article><a class="post-link" href="/blog/post-3">Third Post</a></article>
      </div>
    </body></html>
  `

  const validFeedXml = `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>First Post</title>
        <link href="https://example.com/blog/post-1"/>
      </entry>
      <entry>
        <title>Second Post</title>
        <link href="https://example.com/blog/post-2"/>
      </entry>
    </feed>`

  function setupHappyPath() {
    upsertSetting('api_key.anthropic', 'sk-test')

    // fetchHtml returns blog HTML
    mockFetchHtml.mockResolvedValueOnce({
      html: blogHtml,
      contentType: 'text/html',
      usedFlareSolverr: false,
    })

    // LLM returns a selector
    mockCreateMessage.mockResolvedValueOnce({
      text: ' "a.post-link"}',
      inputTokens: 100,
      outputTokens: 10,
    })

    // validateBridgeFeed fetch returns valid Atom feed
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => validFeedXml,
    })
  }

  it('returns bridge URL on successful inference and validation', async () => {
    setupHappyPath()

    const result = await inferCssSelectorBridge('https://example.com')
    expect(result).not.toBeNull()
    expect(result).toContain(BRIDGE_URL)
    expect(result).toContain('CssSelectorBridge')
    expect(result).toContain('url_selector=a.post-link')
  })

  it('passes page anchors to LLM prompt', async () => {
    setupHappyPath()

    await inferCssSelectorBridge('https://example.com')

    expect(mockCreateMessage).toHaveBeenCalledOnce()
    const callArgs = mockCreateMessage.mock.calls[0][0]
    expect(callArgs.systemInstruction).toContain('CSS selector')
    // user message should contain anchor data
    const userMsg = callArgs.messages.find((m: { role: string }) => m.role === 'user')
    expect(userMsg.content).toContain('/blog/post-1')
    expect(userMsg.content).toContain('First Post')
    // assistant prefill
    const assistantMsg = callArgs.messages.find((m: { role: string }) => m.role === 'assistant')
    expect(assistantMsg.content).toBe('{"url_selector":')
  })

  it('replaces ^= with *= in selectors', async () => {
    upsertSetting('api_key.anthropic', 'sk-test')

    mockFetchHtml.mockResolvedValueOnce({
      html: blogHtml,
      contentType: 'text/html',
      usedFlareSolverr: false,
    })

    mockCreateMessage.mockResolvedValueOnce({
      text: ' "a[href^=\\"/blog/\\"]"}',
      inputTokens: 100,
      outputTokens: 10,
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => validFeedXml,
    })

    const result = await inferCssSelectorBridge('https://example.com')
    expect(result).not.toBeNull()
    expect(result).toContain('*%3D') // *= URL-encoded
    expect(result).not.toContain('%5E%3D') // ^= should not appear
  })

  it('returns null when no provider is available', async () => {
    // no API keys set
    const result = await inferCssSelectorBridge('https://example.com')
    expect(result).toBeNull()
    expect(mockFetchHtml).not.toHaveBeenCalled()
  })

  it('returns null when page fetch fails', async () => {
    upsertSetting('api_key.anthropic', 'sk-test')
    mockFetchHtml.mockRejectedValueOnce(new Error('HTTP 403'))

    const result = await inferCssSelectorBridge('https://example.com')
    expect(result).toBeNull()
  })

  it('returns null when page has no anchor elements', async () => {
    upsertSetting('api_key.anthropic', 'sk-test')
    mockFetchHtml.mockResolvedValueOnce({
      html: '<html><body><p>No links here</p></body></html>',
      contentType: 'text/html',
      usedFlareSolverr: false,
    })

    const result = await inferCssSelectorBridge('https://example.com')
    expect(result).toBeNull()
    expect(mockCreateMessage).not.toHaveBeenCalled()
  })

  it('returns null when LLM returns null selector', async () => {
    upsertSetting('api_key.anthropic', 'sk-test')

    mockFetchHtml.mockResolvedValueOnce({
      html: blogHtml,
      contentType: 'text/html',
      usedFlareSolverr: false,
    })

    mockCreateMessage.mockResolvedValueOnce({
      text: ' null}',
      inputTokens: 100,
      outputTokens: 10,
    })

    const result = await inferCssSelectorBridge('https://example.com')
    expect(result).toBeNull()
  })

  it('returns null when LLM returns invalid JSON', async () => {
    upsertSetting('api_key.anthropic', 'sk-test')

    mockFetchHtml.mockResolvedValueOnce({
      html: blogHtml,
      contentType: 'text/html',
      usedFlareSolverr: false,
    })

    mockCreateMessage.mockResolvedValueOnce({
      text: ' this is not json at all',
      inputTokens: 100,
      outputTokens: 10,
    })

    const result = await inferCssSelectorBridge('https://example.com')
    expect(result).toBeNull()
  })

  it('returns null when bridge validation fails', async () => {
    upsertSetting('api_key.anthropic', 'sk-test')

    mockFetchHtml.mockResolvedValueOnce({
      html: blogHtml,
      contentType: 'text/html',
      usedFlareSolverr: false,
    })

    mockCreateMessage.mockResolvedValueOnce({
      text: ' "a.post-link"}',
      inputTokens: 100,
      outputTokens: 10,
    })

    // validation fetch returns non-ok
    mockFetch.mockResolvedValueOnce({ ok: false })

    const result = await inferCssSelectorBridge('https://example.com')
    expect(result).toBeNull()
  })

  it('returns bridge URL when validation is unreachable (trusts LLM)', async () => {
    upsertSetting('api_key.anthropic', 'sk-test')

    mockFetchHtml.mockResolvedValueOnce({
      html: blogHtml,
      contentType: 'text/html',
      usedFlareSolverr: false,
    })

    mockCreateMessage.mockResolvedValueOnce({
      text: ' "a.post-link"}',
      inputTokens: 100,
      outputTokens: 10,
    })

    // validation fetch throws (bridge unreachable)
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const result = await inferCssSelectorBridge('https://example.com')
    expect(result).not.toBeNull()
    expect(result).toContain('CssSelectorBridge')
  })

  it('returns null when validation feed has no matching domain entries', async () => {
    upsertSetting('api_key.anthropic', 'sk-test')

    mockFetchHtml.mockResolvedValueOnce({
      html: blogHtml,
      contentType: 'text/html',
      usedFlareSolverr: false,
    })

    mockCreateMessage.mockResolvedValueOnce({
      text: ' "a.post-link"}',
      inputTokens: 100,
      outputTokens: 10,
    })

    // Feed with entries pointing to a different domain
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?>
        <feed><entry>
          <link href="https://other-domain.com/post"/>
        </entry></feed>`,
    })

    const result = await inferCssSelectorBridge('https://example.com')
    expect(result).toBeNull()
  })

  it('filters out trivial links (javascript:, mailto:, #)', async () => {
    upsertSetting('api_key.anthropic', 'sk-test')

    const htmlWithTrivial = `
      <html><body>
        <a href="#">Skip</a>
        <a href="javascript:void(0)">Click</a>
        <a href="mailto:test@example.com">Email</a>
        <a href="/blog/real-post">Real Post</a>
      </body></html>
    `

    mockFetchHtml.mockResolvedValueOnce({
      html: htmlWithTrivial,
      contentType: 'text/html',
      usedFlareSolverr: false,
    })

    mockCreateMessage.mockResolvedValueOnce({
      text: ' "a[href*=\\"/blog/\\"]"}',
      inputTokens: 100,
      outputTokens: 10,
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => validFeedXml,
    })

    await inferCssSelectorBridge('https://example.com')

    const userMsg = mockCreateMessage.mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === 'user'
    )
    expect(userMsg.content).toContain('/blog/real-post')
    expect(userMsg.content).not.toContain('javascript:')
    expect(userMsg.content).not.toContain('mailto:')
    expect(userMsg.content).not.toContain('href="#"')
  })

  it('strips script/style/svg/noscript from parsed HTML', async () => {
    upsertSetting('api_key.anthropic', 'sk-test')

    const htmlWithNoise = `
      <html><body>
        <script><a href="/script-link">Script Link</a></script>
        <style>a { color: red; }</style>
        <svg><a href="/svg-link">SVG Link</a></svg>
        <noscript><a href="/noscript-link">NoScript</a></noscript>
        <a href="/real-link">Real Link</a>
      </body></html>
    `

    mockFetchHtml.mockResolvedValueOnce({
      html: htmlWithNoise,
      contentType: 'text/html',
      usedFlareSolverr: false,
    })

    mockCreateMessage.mockResolvedValueOnce({
      text: ' "a[href*=\\"/real-link\\"]"}',
      inputTokens: 100,
      outputTokens: 10,
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => validFeedXml,
    })

    await inferCssSelectorBridge('https://example.com')

    const userMsg = mockCreateMessage.mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === 'user'
    )
    expect(userMsg.content).toContain('/real-link')
    expect(userMsg.content).not.toContain('/script-link')
    expect(userMsg.content).not.toContain('/noscript-link')
  })
})
