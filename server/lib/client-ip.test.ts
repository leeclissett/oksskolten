import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { clientIp, ipv6Prefix, rateLimitKey } from './client-ip.js'

function fakeRequest(headers: Record<string, string | string[]>, ip = '10.0.0.5'): FastifyRequest {
  return { headers, ip } as unknown as FastifyRequest
}

describe('clientIp', () => {
  it('prefers CF-Connecting-IP over request.ip', () => {
    expect(clientIp(fakeRequest({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(clientIp(fakeRequest({ 'cf-connecting-ip': ' 2001:db8::1 ' }))).toBe('2001:db8::1')
  })

  it.each([
    ['absent', {}],
    ['empty', { 'cf-connecting-ip': '' }],
    ['not an IP', { 'cf-connecting-ip': 'evil' }],
    ['a list', { 'cf-connecting-ip': '203.0.113.7, 198.51.100.1' }],
  ])('falls back to request.ip when the header is %s', (_label, headers) => {
    expect(clientIp(fakeRequest(headers as Record<string, string>))).toBe('10.0.0.5')
  })
})

describe('rateLimitKey', () => {
  it('keys IPv4 clients by address', () => {
    expect(rateLimitKey(fakeRequest({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('reduces IPv4-mapped IPv6 to plain IPv4', () => {
    expect(rateLimitKey(fakeRequest({}, '::ffff:127.0.0.1'))).toBe('127.0.0.1')
  })

  it('keys IPv6 clients by /56, so rotating within a /64 or /56 shares one bucket', () => {
    const key = (ip: string) => rateLimitKey(fakeRequest({ 'cf-connecting-ip': ip }))
    expect(key('2001:db8:abcd:1201::1')).toBe('2001:db8:abcd:1200::/56')
    expect(key('2001:db8:abcd:12ff:ffff:ffff:ffff:ffff')).toBe('2001:db8:abcd:1200::/56')
    expect(key('2001:db8:abcd:1300::1')).toBe('2001:db8:abcd:1300::/56')
  })
})

describe('ipv6Prefix', () => {
  it.each([
    ['2001:db8:abcd:12ff::1', 56, '2001:db8:abcd:1200::/56'],
    ['2001:DB8:ABCD:12FF:1:2:3:4', 64, '2001:db8:abcd:12ff::/64'],
    ['::1', 56, '0:0:0:0::/56'],
    ['fe80::1%eth0', 64, 'fe80:0:0:0::/64'],
    ['64:ff9b::192.0.2.33', 128, '64:ff9b:0:0:0:0:c000:221/128'],
    ['2001:db8::', 48, '2001:db8:0::/48'],
  ])('%s /%i → %s', (ip, prefix, expected) => {
    expect(ipv6Prefix(ip, prefix)).toBe(expected)
  })
})

// Mirrors server/index.ts: trustProxy on, rate limiter keyed on rateLimitKey.
describe('rate limiting behind Cloudflare', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = Fastify({ trustProxy: true })
    await app.register(rateLimit, { max: 100, timeWindow: '1 minute', keyGenerator: rateLimitKey })
    app.post('/accounts/ClientLogin', { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } }, async () => 'ok')
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  async function attempts(headers: (i: number) => Record<string, string>, n = 4) {
    const codes: number[] = []
    for (let i = 0; i < n; i++) {
      codes.push((await app.inject({ method: 'POST', url: '/accounts/ClientLogin', headers: headers(i) })).statusCode)
    }
    return codes
  }

  it('cannot be dodged by rotating X-Forwarded-For (Cloudflare appends, so the leftmost entry is client-chosen)', async () => {
    const codes = await attempts((i) => ({
      'x-forwarded-for': `198.51.100.${i}, 203.0.113.7`,
      'cf-connecting-ip': '203.0.113.7',
    }))
    expect(codes).toEqual([200, 200, 429, 429])
  })

  it('cannot be dodged by rotating IPv6 addresses inside one /56', async () => {
    const codes = await attempts((i) => ({ 'cf-connecting-ip': `2001:db8:abcd:12${i}0::${i + 1}` }))
    expect(codes).toEqual([200, 200, 429, 429])
  })

  it('still gives distinct clients their own buckets', async () => {
    const codes = await attempts((i) => ({ 'cf-connecting-ip': `203.0.113.${i + 10}` }))
    expect(codes).toEqual([200, 200, 200, 200])
  })
})
