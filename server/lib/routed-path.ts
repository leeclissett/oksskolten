import type { FastifyRequest } from 'fastify'

/**
 * The path pattern of the route Fastify matched (e.g. "/reader/api/0/user-info",
 * including any plugin prefix), or the raw URL when no route matched.
 *
 * Use this, not `request.url`, for any security decision based on the path.
 * `request.url` is the raw URL with its percent-encoding intact, while the
 * router decodes it: "/%72eader/api/0/user-info" reaches the
 * "/reader/api/0/user-info" handler but fails `request.url.startsWith('/reader/')`.
 */
export function routedPath(request: FastifyRequest): string {
  return request.routeOptions.url ?? request.url
}

const RATE_LIMITED_PREFIXES = ['/api', '/reader', '/accounts']

/**
 * Google Reader API routes, under the root and the FreshRSS-style prefix.
 * They need a valid auth token, and one reader app syncing thousands of
 * articles (batched fetches plus per-item edit-tag calls) can legitimately
 * exceed the global per-minute limit, so they are exempt from it.
 * ClientLogin (`/accounts/…`) is not under these prefixes and stays limited.
 */
const READER_API_PREFIXES = ['/reader/api/', '/api/greader.php/reader/api/']

/** `allowList` for @fastify/rate-limit: only API, Google Reader and login routes are limited. */
export function isRateLimitExempt(request: FastifyRequest): boolean {
  const path = routedPath(request)
  if (READER_API_PREFIXES.some((prefix) => path.startsWith(prefix))) return true
  return !RATE_LIMITED_PREFIXES.some((prefix) => path.startsWith(prefix))
}
