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
