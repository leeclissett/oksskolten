import { createHmac } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import { validateJwtSecret, RECOMMENDED_JWT_SECRET_MIN_LENGTH } from './jwt-secret.js'

describe('validateJwtSecret', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['whitespace only', '   \t\n'],
  ])('rejects a %s secret', (_label, secret) => {
    expect(() => validateJwtSecret(secret, 'test')).toThrow(/empty or blank/)
  })

  it('accepts a short secret but warns', () => {
    const result = validateJwtSecret('short-secret', 'JWT_SECRET')
    expect(result.secret).toBe('short-secret')
    expect(result.warning).toMatch(/only 12 characters/)
  })

  it('accepts a long secret without a warning', () => {
    const secret = 'x'.repeat(RECOMMENDED_JWT_SECRET_MIN_LENGTH)
    expect(validateJwtSecret(secret, 'db')).toEqual({ secret, warning: null })
  })
})

// Regression tests for the fast-jwt advisories fixed by the Nov 2026 dependency
// bump. Each forged token below must be rejected by @fastify/jwt as configured
// in server/index.ts (string HMAC secret, default verifier options).
describe('JWT verification rejects forged tokens', () => {
  const SECRET = 'a'.repeat(64)
  let app: FastifyInstance

  const b64url = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')
  const sign = (header: object, payload: unknown, key: string) => {
    const input = `${b64url(header)}.${b64url(payload)}`
    return `${input}.${createHmac('sha256', key).update(input).digest('base64url')}`
  }
  const now = () => Math.floor(Date.now() / 1000)
  const claims = () => ({ email: 'user@example.com', token_version: 0, iat: now(), exp: now() + 3600 })

  const verify = (token: string) =>
    app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer ${token}` } })

  beforeAll(async () => {
    app = Fastify()
    await app.register(jwt, { secret: SECRET, sign: { expiresIn: '30d' } })
    app.get('/protected', async (request, reply) => {
      try {
        await request.jwtVerify()
        return { ok: true }
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' })
      }
    })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('accepts a token the app signed itself', async () => {
    const token = app.jwt.sign({ email: 'user@example.com', token_version: 0 })
    expect((await verify(token)).statusCode).toBe(200)
  })

  it('rejects an unsigned (alg: none) token', async () => {
    const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims())}.`
    expect((await verify(token)).statusCode).toBe(401)
  })

  it('rejects a token signed with an empty HMAC key (GHSA-gmvf-9v4p-v8jc, GHSA-8wpc-h4q6-8fxv)', async () => {
    const token = sign({ alg: 'HS256', typ: 'JWT' }, claims(), '')
    expect((await verify(token)).statusCode).toBe(401)
  })

  it('rejects a validly signed token with an unknown crit extension (GHSA-hm7r-c7qw-ghp6)', async () => {
    const token = sign({ alg: 'HS256', typ: 'JWT', crit: ['x-custom-policy'], 'x-custom-policy': 'deny' }, claims(), SECRET)
    expect((await verify(token)).statusCode).toBe(401)
  })

  it('rejects a validly signed token whose payload is a JSON array (GHSA-5hjw-83fp-phq9)', async () => {
    const token = sign({ alg: 'HS256', typ: 'JWT' }, [claims()], SECRET)
    expect((await verify(token)).statusCode).toBe(401)
  })

  it('rejects an expired token', async () => {
    const token = sign({ alg: 'HS256', typ: 'JWT' }, { ...claims(), iat: now() - 7200, exp: now() - 3600 }, SECRET)
    expect((await verify(token)).statusCode).toBe(401)
  })
})
