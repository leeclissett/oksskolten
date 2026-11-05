import { isIP, isIPv4, isIPv6 } from 'node:net'
import type { FastifyRequest } from 'fastify'

/**
 * The client's IP address, for rate limiting and request logs.
 *
 * Behind Cloudflare, `request.ip` cannot be trusted: with `trustProxy: true`
 * Fastify takes the leftmost X-Forwarded-For entry, and Cloudflare appends to a
 * client-supplied X-Forwarded-For instead of replacing it, so a client can pick
 * its own "IP" and get a fresh rate-limit bucket on every request. Cloudflare
 * sets CF-Connecting-IP itself to the single address that connected to it, so
 * prefer that when it holds a valid IP.
 *
 * Requests that bypass Cloudflare (LAN, Tailscale) could send their own
 * CF-Connecting-IP, but they can already send X-Forwarded-For, so this is
 * never weaker than `request.ip`.
 */
export function clientIp(request: FastifyRequest): string {
  const header = request.headers['cf-connecting-ip']
  const value = (Array.isArray(header) ? header[0] : header)?.trim()
  return value && isIP(value) ? value : request.ip
}

/**
 * IPv6 prefix length treated as one client for rate limiting. A single user
 * (or attacker) normally controls at least a /64 and often a /56, so keying on
 * full IPv6 addresses would let them rotate through billions of buckets.
 * Matches express-rate-limit's default.
 */
export const IPV6_RATE_LIMIT_PREFIX = 56

/**
 * `keyGenerator` for @fastify/rate-limit: the client IP, with IPv6 addresses
 * collapsed to their /56 and IPv4-mapped IPv6 reduced to plain IPv4.
 */
export function rateLimitKey(request: FastifyRequest): string {
  const ip = clientIp(request)
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mapped && isIPv4(mapped[1])) return mapped[1]
  return isIPv6(ip) ? ipv6Prefix(ip, IPV6_RATE_LIMIT_PREFIX) : ip
}

/** `2001:db8:abcd:12ff::1` with prefix 56 → `2001:db8:abcd:1200::/56`. Expects a valid IPv6 address. */
export function ipv6Prefix(ip: string, prefix: number): string {
  const groups = ipv6Groups(ip)
  const masked = groups.map((group, i) => {
    const bits = Math.max(0, Math.min(16, prefix - i * 16))
    return bits === 0 ? 0 : group & ((0xffff << (16 - bits)) & 0xffff)
  })
  const kept = masked.slice(0, Math.ceil(prefix / 16)).map((g) => g.toString(16))
  return `${kept.join(':')}${kept.length < 8 ? '::' : ''}/${prefix}`
}

/** The eight 16-bit groups of a valid IPv6 address (handles `::`, zone IDs and an embedded IPv4 tail). */
function ipv6Groups(ip: string): number[] {
  let addr = ip.split('%')[0].toLowerCase()
  const lastColon = addr.lastIndexOf(':')
  const tail = addr.slice(lastColon + 1)
  if (tail.includes('.')) {
    const [a, b, c, d] = tail.split('.').map(Number)
    addr = `${addr.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head, rest] = addr.split('::')
  const left = head ? head.split(':') : []
  const right = rest === undefined ? [] : rest ? rest.split(':') : []
  const zeros = rest === undefined ? [] : Array<string>(8 - left.length - right.length).fill('0')
  return [...left, ...zeros, ...right].map((g) => parseInt(g, 16))
}
