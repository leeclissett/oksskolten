/**
 * Convert an article's external URL to an in-app path.
 * Query-string characters (?, &, =) are percent-encoded so they stay
 * inside the path segment and are not interpreted as the app's own
 * query parameters by the browser / React Router.
 */
export function articleUrlToPath(url: string): string {
  const isHttp = url.startsWith('http://')
  const raw = url.replace(/^https?:\/\//, '')
  const path = raw.replace(/\?/g, '%3F').replace(/&/g, '%26').replace(/=/g, '%3D').replace(/#/g, '%23')
  // http:// articles get a /http/ prefix so the detail page can reconstruct
  // the original protocol without hardcoding https://.
  return isHttp ? '/http/' + path : '/' + path
}

/**
 * Reconstruct an article's external URL from the wildcard app route.
 * Kept alongside articleUrlToPath so their round-trip behavior can be tested.
 */
export function articlePathToUrl(splat: string): string {
  const rawSplat = splat.endsWith('.md') ? splat.slice(0, -3) : splat
  return rawSplat.startsWith('http/')
    ? `http://${decodeURIComponent(rawSplat.slice(5))}`
    : `https://${decodeURIComponent(rawSplat)}`
}

/**
 * True when an article URL is the synthetic key given to a feed entry that
 * has inline content but no link of its own: the feed's URL with the entry ID
 * as a fragment. It identifies the article inside the app but is not a page
 * anyone can open.
 */
export function isInlineEntryUrl(articleUrl: string, feedUrl: string | null | undefined): boolean {
  if (!feedUrl) return false
  try {
    const article = new URL(articleUrl)
    if (!article.hash) return false
    article.hash = ''
    const feed = new URL(feedUrl)
    feed.hash = ''
    return article.href === feed.href
  } catch {
    return false
  }
}
