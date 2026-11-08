import { demoStore } from './demo-store'
import { dt, getLocale } from './i18n'

// ---------------------------------------------------------------------------
// Intercept global fetch for endpoints that use raw fetch (SSE streams, etc.)
// ---------------------------------------------------------------------------
const originalFetch = window.fetch.bind(window)

function sseResponse(events: Array<Record<string, unknown>>, delayMs = 200): Response {
  const encoder = new TextEncoder()
  let index = 0
  const stream = new ReadableStream({
    async pull(controller) {
      if (index < events.length) {
        await new Promise(r => setTimeout(r, delayMs))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(events[index])}\n\n`))
        index++
      } else {
        controller.close()
      }
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const parsed = new URL(url, location.origin)
  const path = parsed.pathname
  const method = (init?.method ?? 'GET').toUpperCase()

  // POST /api/feeds — SSE step-based feed addition
  if (method === 'POST' && path === '/api/feeds') {
    const body = JSON.parse((init?.body as string) || '{}')
    const result = demoStore.addFeed(body)
    const feed = result.feed as { id: number; rss_url: string | null; rss_bridge_url: string | null }
    return sseResponse([
      { type: 'step', step: 'rss-discovery', status: 'running' },
      { type: 'step', step: 'rss-discovery', status: 'done', found: true },
      { type: 'step', step: 'rss-bridge', status: 'skipped' },
      { type: 'done', feed: { id: feed.id, rss_url: feed.rss_url, rss_bridge_url: feed.rss_bridge_url } },
    ], 300)
  }

  // GET /api/discover-title — return hostname as title
  if (method === 'GET' && path === '/api/discover-title') {
    const targetUrl = parsed.searchParams.get('url') || ''
    let title = 'Demo Feed'
    try { title = new URL(targetUrl).hostname } catch { /* */ }
    return new Response(JSON.stringify({ title }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return originalFetch(input, init)
}

let demoProfileCustomName: string | null = null
let demoProfileAvatarSeed: string | null = null

/** Narrow unknown body to a typed object. No runtime validation (demo-only). */
function asBody<T>(body: unknown): T {
  return (body ?? {}) as T
}

function parsePath(url: string) {
  const parsed = new URL(url, 'http://localhost')
  return { path: parsed.pathname, params: parsed.searchParams }
}

function extractId(path: string, pattern: RegExp): number | null {
  const m = path.match(pattern)
  return m ? Number(m[1]) : null
}

// --- GET (SWR fetcher signature) ---
export async function demoFetcher(url: string): Promise<unknown> {
  const { path, params } = parsePath(url)

  if (path === '/api/feeds') {
    return demoStore.getFeeds()
  }

  if (path === '/api/articles') {
    return demoStore.getArticles({
      feedId: params.get('feed_id') ? Number(params.get('feed_id')) : undefined,
      categoryId: params.get('category_id') ? Number(params.get('category_id')) : undefined,
      unread: params.get('unread') === '1',
      bookmarked: params.get('bookmarked') === '1',
      liked: params.get('liked') === '1',
      read: params.get('read') === '1',
      limit: Number(params.get('limit')) || 20,
      offset: Number(params.get('offset')) || 0,
    })
  }

  if (path === '/api/articles/by-url') {
    const article = demoStore.getArticleByUrl(params.get('url')!)
    if (!article) throw new Error('Article not found')
    return article
  }

  if (path === '/api/categories') {
    return demoStore.getCategories()
  }

  if (path === '/api/me') {
    return { email: 'demo@example.com' }
  }

  if (path === '/api/settings/profile') {
    return { language: getLocale(), account_name: demoProfileCustomName ?? dt('demo.defaultUser'), avatar_seed: demoProfileAvatarSeed }
  }

  if (path === '/api/settings/preferences') {
    return {
      'reading.auto_mark_read': 'on',
    }
  }

  // /api/feeds/:id/metrics
  const metricsId = extractId(path, /^\/api\/feeds\/(\d+)\/metrics$/)
  if (metricsId != null) {
    return { avg_content_length: demoStore.getFeedAvgContentLength(metricsId) }
  }

  if (path.startsWith('/api/search')) {
    return { results: [] }
  }

  if (path === '/api/settings/auth-methods') {
    return { password: true, passkey: false, github: false }
  }

  if (path.startsWith('/api/settings')) {
    return {}
  }

  // Fallback: return empty object for unknown GETs
  return {}
}

// --- POST ---
export async function demoApiPost(url: string, body?: unknown): Promise<unknown> {
  const { path } = parsePath(url)

  // POST /api/feeds is handled by the fetch interceptor (SSE response)

  // /api/articles/from-url (web clip)
  if (path === '/api/articles/from-url') {
    const { url: articleUrl, force } = asBody<{ url: string; force?: boolean }>(body)
    const result = demoStore.addArticleFromUrl({ url: articleUrl, force })
    if (result.status === 409) {
      const { ApiError } = await import('../api-base')
      throw new ApiError('Conflict', 409, result.data as Record<string, unknown>)
    }
    return result.data
  }

  // /api/feeds/:id/mark-all-seen
  const markAllSeenFeed = extractId(path, /^\/api\/feeds\/(\d+)\/mark-all-seen$/)
  if (markAllSeenFeed != null) {
    return demoStore.markAllSeenByFeed(markAllSeenFeed)
  }

  // /api/categories/:id/mark-all-seen
  const markAllSeenCat = extractId(path, /^\/api\/categories\/(\d+)\/mark-all-seen$/)
  if (markAllSeenCat != null) {
    return demoStore.markAllSeenByCategory(markAllSeenCat)
  }

  // /api/articles/:id/read
  const readId = extractId(path, /^\/api\/articles\/(\d+)\/read$/)
  if (readId != null) {
    return demoStore.markArticleRead(readId)
  }

  // /api/articles/batch-seen
  if (path === '/api/articles/batch-seen') {
    const { ids } = asBody<{ ids: number[] }>(body)
    return demoStore.batchSeen(ids)
  }

  // Feed fetch — no-op in demo
  if (path.match(/^\/api\/feeds\/\d+\/fetch$/)) {
    return { success: true }
  }

  // GET /api/discover-title is handled by the fetch interceptor

  return {}
}

// --- PATCH ---
export async function demoApiPatch(url: string, body: unknown): Promise<unknown> {
  const { path } = parsePath(url)

  // /api/feeds/:id
  const feedId = extractId(path, /^\/api\/feeds\/(\d+)$/)
  if (feedId != null) {
    return demoStore.updateFeed(feedId, asBody<Record<string, unknown>>(body))
  }

  // /api/articles/:id/bookmark
  const bookmarkId = extractId(path, /^\/api\/articles\/(\d+)\/bookmark$/)
  if (bookmarkId != null) {
    const { bookmarked } = asBody<{ bookmarked: boolean }>(body)
    return demoStore.toggleBookmark(bookmarkId, bookmarked)
  }

  // /api/articles/:id/like
  const likeId = extractId(path, /^\/api\/articles\/(\d+)\/like$/)
  if (likeId != null) {
    const { liked } = asBody<{ liked: boolean }>(body)
    return demoStore.toggleLike(likeId, liked)
  }

  // /api/categories/:id
  const catId = extractId(path, /^\/api\/categories\/(\d+)$/)
  if (catId != null) {
    return demoStore.updateCategory(catId, asBody<Record<string, unknown>>(body))
  }

  // /api/settings/profile
  if (path === '/api/settings/profile') {
    const patch = asBody<Record<string, unknown>>(body)
    if (patch.account_name != null) demoProfileCustomName = patch.account_name as string
    if (patch.avatar_seed !== undefined) demoProfileAvatarSeed = patch.avatar_seed as string | null
    return { account_name: demoProfileCustomName ?? dt('demo.defaultUser'), avatar_seed: demoProfileAvatarSeed }
  }

  // /api/settings/preferences
  if (path === '/api/settings/preferences') {
    return {} // no-op, settings are localStorage-based
  }

  return {}
}

// --- DELETE ---
export async function demoApiDelete(url: string): Promise<unknown> {
  const { path } = parsePath(url)

  // /api/feeds/:id
  const feedId = extractId(path, /^\/api\/feeds\/(\d+)$/)
  if (feedId != null) {
    return demoStore.deleteFeed(feedId)
  }

  // /api/categories/:id
  const catId = extractId(path, /^\/api\/categories\/(\d+)$/)
  if (catId != null) {
    return demoStore.deleteCategory(catId)
  }

  return {}
}
