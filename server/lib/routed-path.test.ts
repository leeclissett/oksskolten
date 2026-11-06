import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { isRateLimitExempt, routedPath } from './routed-path.js'

describe('routedPath', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = Fastify()
    app.get('/reader/api/0/user-info', async (request) => ({ path: routedPath(request), url: request.url }))
    await app.register(async (child) => {
      child.get('/reader/api/0/user-info', async (request) => ({ path: routedPath(request), url: request.url }))
    }, { prefix: '/api/greader.php' })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns the matched route pattern, not the raw percent-encoded URL', async () => {
    const res = await app.inject({ method: 'GET', url: '/%72eader/api/0/user-info' })
    expect(res.json()).toEqual({ path: '/reader/api/0/user-info', url: '/%72eader/api/0/user-info' })
  })

  it('includes the plugin prefix', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/greader%2Ephp/reader/api/0/user-info' })
    expect(res.json().path).toBe('/api/greader.php/reader/api/0/user-info')
  })
})

describe('isRateLimitExempt', () => {
  // The global limit counts per client across all routes, so each test gets a fresh app.
  let app: FastifyInstance

  beforeEach(async () => {
    app = Fastify()
    await app.register(rateLimit, { max: 2, timeWindow: '1 minute', allowList: isRateLimitExempt })
    app.post('/api/login', async () => ({ ok: true }))
    app.post('/accounts/ClientLogin', async () => ({ ok: true }))
    app.get('/assets/app.js', async () => 'js')
    app.get('/api/feeds', async () => ({ ok: true }))
    app.get('/reader/api/0/tag/list', async () => ({ ok: true }))
    app.get('/reader/api/0/stream/contents/*', async () => ({ ok: true }))
    await app.register(async (child) => {
      child.post('/accounts/ClientLogin', async () => ({ ok: true }))
      child.get('/reader/api/0/tag/list', async () => ({ ok: true }))
    }, { prefix: '/api/greader.php' })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  async function statuses(method: 'GET' | 'POST', url: string, n = 4) {
    const codes: number[] = []
    for (let i = 0; i < n; i++) codes.push((await app.inject({ method, url })).statusCode)
    return codes
  }

  it('rate-limits API routes even when the path is percent-encoded', async () => {
    expect(await statuses('POST', '/%61pi/login')).toEqual([200, 200, 429, 429])
  })

  it('rate-limits ClientLogin even when the path is percent-encoded', async () => {
    expect(await statuses('POST', '/%61ccounts/ClientLogin')).toEqual([200, 200, 429, 429])
  })

  it('does not rate-limit static assets', async () => {
    expect(await statuses('GET', '/assets/app.js')).toEqual([200, 200, 200, 200])
  })

  it('rate-limits ClientLogin under the FreshRSS prefix', async () => {
    expect(await statuses('POST', '/api/greader.php/accounts/ClientLogin')).toEqual([200, 200, 429, 429])
  })

  it('rate-limits web app API routes', async () => {
    expect(await statuses('GET', '/api/feeds')).toEqual([200, 200, 429, 429])
  })

  it.each([
    '/reader/api/0/tag/list',
    '/%72eader/api/0/tag/list',
    '/reader/api/0/stream/contents/user/-/state/com.google/reading-list',
    '/api/greader.php/reader/api/0/tag/list',
    '/api/greader%2Ephp/reader/api/0/tag/list',
  ])('does not rate-limit Google Reader API routes: %s', async (url) => {
    expect(await statuses('GET', url)).toEqual([200, 200, 200, 200])
  })
})
