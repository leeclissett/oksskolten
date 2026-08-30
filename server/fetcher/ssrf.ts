import { lookup } from 'node:dns/promises'

function isPrivateIP(ip: string): boolean {
  // IPv4 private/loopback/link-local ranges
  if (/^127\./.test(ip)) return true
  if (/^10\./.test(ip)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  if (/^169\.254\./.test(ip)) return true
  if (ip === '0.0.0.0') return true
  // IPv6 loopback / private
  if (ip === '::1' || ip === '::' || /^f[cd]/i.test(ip) || /^fe80:/i.test(ip)) return true
  return false
}

function isPrivateNetworkIP(ip: string): boolean {
  if (/^10\./.test(ip)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  if (/^f[cd]/i.test(ip)) return true
  return false
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

async function isPrivateNetworkUrl(url: string): Promise<boolean> {
  const { hostname, protocol } = new URL(url)
  if (protocol !== 'http:' && protocol !== 'https:') return false

  const normalizedHostname = normalizeHostname(hostname)
  if (/^[\d.]+$/.test(normalizedHostname) || hostname.startsWith('[')) {
    return isPrivateNetworkIP(normalizedHostname)
  }

  try {
    const { address } = await lookup(normalizedHostname)
    return isPrivateNetworkIP(address)
  } catch {
    return false
  }
}

interface SafeUrlOptions {
  allowedPrivateHostname?: string
}

async function assertSafeUrlWithOptions(url: string, options?: SafeUrlOptions): Promise<void> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL: disallowed protocol ${parsed.protocol}`)
  }
  const hostname = parsed.hostname
  const normalizedHostname = normalizeHostname(hostname)
  const isAllowedPrivateHostname = normalizedHostname === options?.allowedPrivateHostname
  if (
    (normalizedHostname === 'localhost' || normalizedHostname.endsWith('.local') || normalizedHostname.endsWith('.internal')) &&
    (!isAllowedPrivateHostname || normalizedHostname === 'localhost')
  ) {
    throw new Error(`Blocked URL: private hostname ${hostname}`)
  }
  // If hostname is already an IP literal, check directly
  if (/^[\d.]+$/.test(hostname) || hostname.startsWith('[')) {
    const ip = normalizedHostname
    if (isPrivateIP(ip) && (!isAllowedPrivateHostname || !isPrivateNetworkIP(ip))) {
      throw new Error(`Blocked URL: private IP ${ip}`)
    }
    return
  }
  // Resolve DNS and check the resulting IP
  try {
    const { address } = await lookup(normalizedHostname)
    if (isPrivateIP(address) && (!isAllowedPrivateHostname || !isPrivateNetworkIP(address))) {
      throw new Error(`Blocked URL: ${hostname} resolves to private IP ${address}`)
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Blocked URL:')) throw err
    // DNS resolution failed — let the subsequent fetch handle it
  }
}

export async function assertSafeUrl(url: string): Promise<void> {
  await assertSafeUrlWithOptions(url)
}

const MAX_REDIRECTS = 5
// Only actual redirect statuses per RFC 7231/7538.
// Excludes 300 (Multiple Choices) and 304 (Not Modified).
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export interface SafeFetchOptions {
  /** Allow an explicitly requested RFC 1918/ULA host, but not other private redirect targets. */
  allowPrivateNetwork?: boolean
}

export async function safeFetch(url: string, init?: RequestInit, options?: SafeFetchOptions): Promise<Response> {
  let allowedPrivateHostname: string | undefined
  if (options?.allowPrivateNetwork && await isPrivateNetworkUrl(url)) {
    allowedPrivateHostname = normalizeHostname(new URL(url).hostname)
  }

  const safeUrlOptions = { allowedPrivateHostname }
  await assertSafeUrlWithOptions(url, safeUrlOptions)
  let currentUrl = url
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const res = await fetch(currentUrl, { ...init, redirect: 'manual' })
    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get('location')
      if (!location) throw new Error(`Redirect without Location header from ${currentUrl}`)
      currentUrl = new URL(location, currentUrl).href
      await assertSafeUrlWithOptions(currentUrl, safeUrlOptions)
      continue
    }
    return res
  }
  throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`)
}
