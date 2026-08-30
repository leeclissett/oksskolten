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
