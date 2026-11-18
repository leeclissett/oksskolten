import { JSDOM } from 'jsdom'
import { XMLParser } from 'fast-xml-parser'
import { fetchHtml } from './fetcher/http.js'
import { fetchViaFlareSolverr } from './fetcher/flaresolverr.js'
import { getSetting } from './db.js'
import { getProvider } from './providers/llm/index.js'
import { DEFAULT_MODELS } from '../shared/models.js'
import type { LLMProvider } from './providers/llm/provider.js'
import { logger } from './logger.js'

const log = logger.child('rss-bridge')

const RSS_BRIDGE_URL = process.env.RSS_BRIDGE_URL

export async function queryRssBridge(url: string): Promise<string | null> {
  if (!RSS_BRIDGE_URL) return null

  const endpoint = `${RSS_BRIDGE_URL}/?action=findfeed&url=${encodeURIComponent(url)}&format=Atom`

  try {
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) return null

    const feeds: unknown = await res.json()
    if (!Array.isArray(feeds) || feeds.length === 0) return null

    const firstUrl = (feeds[0] as Record<string, unknown>)?.url
    return typeof firstUrl === 'string' ? firstUrl : null
  } catch (err) {
    log.warn({ err, url }, 'RSS-Bridge query failed')
    return null
  }
}

const API_KEY_SETTINGS: Record<string, string> = {
  anthropic: 'api_key.anthropic',
  gemini: 'api_key.gemini',
  openai: 'api_key.openai',
}

const PROVIDER_PRIORITY = ['anthropic', 'gemini', 'openai'] as const

export function getAvailableProvider(): { provider: LLMProvider; model: string } | null {
  for (const name of PROVIDER_PRIORITY) {
    const settingKey = API_KEY_SETTINGS[name]
    if (getSetting(settingKey)) {
      return { provider: getProvider(name), model: DEFAULT_MODELS[name] }
    }
  }
  return null
}

export function buildCssSelectorBridgeUrl(
  homePage: string,
  urlSelector: string,
  opts?: { titleSelector?: string; contentSelector?: string },
): string {
  const params = new URLSearchParams({
    action: 'display',
    bridge: 'CssSelectorBridge',
    home_page: homePage,
    url_selector: urlSelector,
    format: 'Atom',
  })
  if (opts?.titleSelector) params.set('title_selector', opts.titleSelector)
  if (opts?.contentSelector) params.set('content_selector', opts.contentSelector)
  return `${RSS_BRIDGE_URL}/?${params.toString()}`
}

const CSS_SELECTOR_SYSTEM = `You extract CSS selectors from HTML to build an RSS feed. Respond with ONLY a JSON object. No markdown, no explanation.`

function buildSelectorUserPrompt(url: string, anchorData: string): string {
  return `Find CSS selectors to extract articles from this page. I need up to 3 selectors:

1. **url_selector** (required): CSS selector for <a> elements linking to individual blog posts/articles.
2. **title_selector** (optional): CSS selector for elements whose text content is the article title. Use this when the url_selector <a> text is NOT the title (e.g. "Read more"). The title_selector elements will be matched to articles by finding the nearest <a> with the same href.
3. **content_selector** (optional): CSS selector for elements containing the article summary/description text on the listing page. These will be matched to articles by finding the nearest <a> with the same href in the surrounding DOM.

Each line below shows: ancestor elements > a element href="..." "link text"

Rules:
- For url_selector: select <a> elements that link to individual article pages
- For title_selector: only needed if url_selector links have generic text like "Read more", "Learn more", etc. Target the element (e.g. h2, h3, span) that contains the actual article title
- For content_selector: target the element (e.g. p, span, div) that contains the article summary/excerpt on the listing page. Skip if no summaries are visible
- Do NOT select navigation, footer, social media, or category listing links
- Look for patterns: repeated similar structures with href paths like /blog/*, /posts/*, /articles/*, etc.
- For href attribute selectors, use *= (contains) NOT ^= (starts-with), because relative paths may be resolved to absolute URLs

URL: ${url}

Links on page:
${anchorData}

Respond with ONLY JSON: {"url_selector": "...", "title_selector": "..." or null, "content_selector": "..." or null}`
}

function extractAnchorSnippets(html: string): string[] {
  const dom = new JSDOM(html)
  const doc = dom.window.document

  // Remove noise elements
  for (const tag of ['script', 'style', 'svg', 'noscript']) {
    doc.querySelectorAll(tag).forEach(el => el.remove())
  }

  const anchors = doc.querySelectorAll('a[href]')
  const snippets: string[] = []
  for (const a of anchors) {
    const href = a.getAttribute('href') ?? ''
    if (!href || href === '#' || href.startsWith('javascript:') || href.startsWith('mailto:')) continue
    const ancestry: string[] = []
    let el: Element | null = a.parentElement
    for (let i = 0; i < 5 && el && el !== doc.body; i++) {
      let desc = el.tagName.toLowerCase()
      if (el.id) desc += `#${el.id}`
      if (el.className && typeof el.className === 'string') {
        desc += '.' + el.className.trim().split(/\s+/).join('.')
      }
      ancestry.unshift(desc)
      el = el.parentElement
    }
    let aDesc = 'a'
    if (a.className && typeof a.className === 'string') {
      aDesc += '.' + a.className.trim().split(/\s+/).join('.')
    }
    const text = (a.textContent ?? '').trim().slice(0, 80)
    snippets.push(`${ancestry.join(' > ')} > ${aDesc} href="${href}" "${text}"`)
  }
  return snippets
}

export async function inferCssSelectorBridge(url: string): Promise<string | null> {
  if (!RSS_BRIDGE_URL) return null

  const available = getAvailableProvider()
  if (!available) return null

  try {
    // Fetch and parse the page HTML (fetchHtml handles safeFetch + FlareSolverr fallback)
    const result = await fetchHtml(url)
    let anchorSnippets = extractAnchorSnippets(result.html)

    // If too few article-like links found (likely JS-rendered page), retry with FlareSolverr
    if (anchorSnippets.length < 3 && !result.usedFlareSolverr) {
      const flare = await fetchViaFlareSolverr(url)
      if (flare) {
        const flareSnippets = extractAnchorSnippets(flare.body)
        if (flareSnippets.length > anchorSnippets.length) {
          anchorSnippets = flareSnippets
        }
      }
    }

    if (anchorSnippets.length === 0) return null

    const MAX_ANCHOR_SNIPPETS = 200
    const anchorData = anchorSnippets.slice(0, MAX_ANCHOR_SNIPPETS).join('\n')

    // Ask LLM for CSS selectors (assistant prefill forces JSON output)
    const { provider, model } = available
    const llmResult = await provider.createMessage({
      model,
      maxTokens: 512,
      systemInstruction: CSS_SELECTOR_SYSTEM,
      messages: [
        { role: 'user', content: buildSelectorUserPrompt(url, anchorData) },
        { role: 'assistant', content: '{"url_selector":' },
      ],
    })

    // Reconstruct full JSON (prefill + completion)
    const fullResponse = '{"url_selector":' + llmResult.text

    // Parse LLM response
    const jsonMatch = fullResponse.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0]) as {
      url_selector?: string | null
      title_selector?: string | null
      content_selector?: string | null
    }
    if (!parsed.url_selector || typeof parsed.url_selector !== 'string') return null

    // CssSelectorBridge resolves relative URLs to absolute, so ^= on paths won't work — use *=
    const fixSelector = (s: string) => s.replace(/\^=/g, '*=')
    const selector = fixSelector(parsed.url_selector)
    const titleSelector = typeof parsed.title_selector === 'string' ? fixSelector(parsed.title_selector) : undefined
    const contentSelector = typeof parsed.content_selector === 'string' ? fixSelector(parsed.content_selector) : undefined

    // Build CssSelectorBridge URL (includes custom params for our own code)
    const bridgeUrl = buildCssSelectorBridgeUrl(url, selector, { titleSelector, contentSelector })
    // Validate with RSS-Bridge using only the params it understands
    const { stripCustomBridgeParams } = await import('./fetcher/css-bridge.js')
    const validation = await validateBridgeFeed(stripCustomBridgeParams(bridgeUrl), url)
    if (validation === 'invalid') {
      log.info(`CssSelectorBridge validation failed for ${url} (selector="${selector}")`)
      return null
    }

    log.info(`CssSelectorBridge inferred for ${url}: url="${selector}" title="${titleSelector ?? 'none'}" content="${contentSelector ?? 'none'}"`)
    return bridgeUrl
  } catch (err) {
    log.error('inferCssSelectorBridge failed:', err)
    return null
  }
}

async function validateBridgeFeed(bridgeUrl: string, originalUrl: string): Promise<'valid' | 'invalid' | 'unreachable'> {
  try {
    const res = await fetch(bridgeUrl, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      return 'invalid'
    }

    const feedXml = await res.text()
    const originHost = new URL(originalUrl).hostname

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
    const parsed = parser.parse(feedXml)

    // Collect entries from Atom (<feed><entry>) or RSS (<rss><channel><item>)
    const entries: unknown[] = []
    const feedNode = parsed.feed || parsed.rss?.channel
    if (feedNode) {
      const items = feedNode.entry || feedNode.item || []
      const itemList = Array.isArray(items) ? items : [items]
      entries.push(...itemList)
    }

    let matchCount = 0
    let domainMatchCount = 0

    for (const entry of entries as Record<string, unknown>[]) {
      // Collect URLs from <link href="...">, <link>text</link>, <url>text</url>
      const urls: string[] = []
      const links = entry.link
      if (links) {
        const linkList = Array.isArray(links) ? links : [links]
        for (const link of linkList) {
          if (typeof link === 'string') urls.push(link)
          else if (typeof link === 'object' && link !== null && '@_href' in link) urls.push(String((link as Record<string, unknown>)['@_href']))
        }
      }
      if (typeof entry.url === 'string') urls.push(entry.url)

      for (const foundUrl of urls) {
        try {
          const host = new URL(foundUrl).hostname
          matchCount++
          if (host === originHost || host.endsWith(`.${originHost}`)) {
            domainMatchCount++
          }
        } catch {
          // invalid URL, skip
        }
      }
    }

    // Need at least 1 article URL matching the origin domain
    return matchCount >= 1 && domainMatchCount >= 1 ? 'valid' : 'invalid'
  } catch (err) {
    // Connection refused / timeout — Bridge is unreachable, trust LLM output
    log.info('Bridge unreachable during validation, trusting LLM output')
    return 'unreachable'
  }
}
