import { describe, it, expect } from 'vitest'
import type { FastifyRequest } from 'fastify'
import { LoginAttemptLimiter, loginAttemptKey } from './login-attempts.js'

function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

function fail(limiter: LoginAttemptLimiter, key: string, times: number) {
  for (let i = 0; i < times; i++) limiter.recordFailure(key)
}

describe('LoginAttemptLimiter', () => {
  it('defaults to 10 failures per 15 minutes', () => {
    const limiter = new LoginAttemptLimiter()
    expect(limiter.maxFailures).toBe(10)
    expect(limiter.windowMs).toBe(15 * 60_000)
  })

  it('blocks after maxFailures failures and reports Retry-After in whole seconds', () => {
    const c = clock()
    const limiter = new LoginAttemptLimiter({ now: c.now })
    fail(limiter, 'k', 9)
    expect(limiter.check('k')).toEqual({ blocked: false })
    limiter.recordFailure('k')
    expect(limiter.check('k')).toEqual({ blocked: true, retryAfterSeconds: 900 })
    c.advance(1_500)
    expect(limiter.check('k')).toEqual({ blocked: true, retryAfterSeconds: 899 }) // 898.5 s rounds up
  })

  it('uses a fixed window from the first failure', () => {
    const c = clock()
    const limiter = new LoginAttemptLimiter({ now: c.now })
    limiter.recordFailure('k')
    c.advance(10 * 60_000)
    fail(limiter, 'k', 9)
    expect(limiter.check('k')).toEqual({ blocked: true, retryAfterSeconds: 300 })
    c.advance(300_000)
    expect(limiter.check('k')).toEqual({ blocked: false })
    // The key starts from zero once the window has ended.
    fail(limiter, 'k', 9)
    expect(limiter.check('k')).toEqual({ blocked: false })
  })

  it('does not count failures from an expired window', () => {
    const c = clock()
    const limiter = new LoginAttemptLimiter({ now: c.now })
    fail(limiter, 'k', 9)
    c.advance(15 * 60_000)
    limiter.recordFailure('k')
    expect(limiter.check('k')).toEqual({ blocked: false })
  })

  it('reset clears the key', () => {
    const limiter = new LoginAttemptLimiter()
    fail(limiter, 'k', 9)
    limiter.reset('k')
    fail(limiter, 'k', 9)
    expect(limiter.check('k')).toEqual({ blocked: false })
  })

  it('keeps keys independent', () => {
    const limiter = new LoginAttemptLimiter()
    fail(limiter, 'a', 10)
    expect(limiter.check('a').blocked).toBe(true)
    expect(limiter.check('b')).toEqual({ blocked: false })
  })

  it('sweeps expired entries', () => {
    const c = clock()
    const limiter = new LoginAttemptLimiter({ now: c.now, sweepIntervalMs: 60_000 })
    for (let i = 0; i < 100; i++) limiter.recordFailure(`k${i}`)
    expect(limiter.size).toBe(100)
    c.advance(15 * 60_000)
    limiter.check('other')
    expect(limiter.size).toBe(0)
  })

  it('never holds more than maxEntries keys, dropping the oldest', () => {
    const limiter = new LoginAttemptLimiter({ maxEntries: 3 })
    fail(limiter, 'a', 10)
    limiter.recordFailure('b')
    limiter.recordFailure('c')
    limiter.recordFailure('d')
    expect(limiter.size).toBe(3)
    expect(limiter.check('a')).toEqual({ blocked: false })
  })
})

describe('loginAttemptKey', () => {
  const request = (headers: Record<string, string>, ip = '127.0.0.1') => ({ headers, ip }) as unknown as FastifyRequest

  it('combines the rate-limit client key with the case-folded email', () => {
    expect(loginAttemptKey(request({ 'cf-connecting-ip': '203.0.113.7' }), 'Test@Example.com'))
      .toBe('203.0.113.7:test@example.com')
  })

  it('collapses IPv6 clients to their /56 like the global limiter', () => {
    expect(loginAttemptKey(request({ 'cf-connecting-ip': '2001:db8:abcd:12ff::1' }), 'a@b.c'))
      .toBe('2001:db8:abcd:1200::/56:a@b.c')
  })
})
