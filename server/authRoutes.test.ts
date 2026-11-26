import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb } from './__tests__/helpers/testDb.js'
import { buildApp } from './__tests__/helpers/buildApp.js'
import { getDb } from './db.js'
import { hashSync } from 'bcryptjs'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
let savedAuthDisabled: string | undefined

function seedUser(email = 'test@example.com', password = 'password123') {
  const db = getDb()
  const hash = hashSync(password, 4) // low cost for tests
  db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash)
}

beforeEach(async () => {
  setupTestDb()
  app = await buildApp()
  // Disable AUTH_DISABLED so auth routes actually verify credentials
  savedAuthDisabled = process.env.AUTH_DISABLED
  delete process.env.AUTH_DISABLED
})

afterEach(() => {
  if (savedAuthDisabled !== undefined) {
    process.env.AUTH_DISABLED = savedAuthDisabled
  } else {
    delete process.env.AUTH_DISABLED
  }
})

const json = { 'content-type': 'application/json' }

describe('POST /api/login', () => {
  it('returns 401 for invalid credentials', async () => {
    seedUser()
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: json,
      payload: { email: 'test@example.com', password: 'wrong' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Invalid credentials')
  })

  it('returns 401 for non-existent user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: json,
      payload: { email: 'nobody@example.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Invalid credentials')
  })

  it('returns 400 when email or password missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: json,
      payload: { email: 'test@example.com' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 415 when content-type is not JSON', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=test@example.com&password=password123',
    })
    expect(res.statusCode).toBe(415)
  })

  it('returns ok and token on valid login', async () => {
    seedUser()
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: json,
      payload: { email: 'test@example.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.token).toBeDefined()
    expect(typeof body.token).toBe('string')
  })

  it('includes token_version in JWT payload', async () => {
    seedUser()
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: json,
      payload: { email: 'test@example.com', password: 'password123' },
    })
    const { token } = res.json()
    const decoded = app.jwt.decode(token) as { email: string; token_version: number; exp: number }
    expect(decoded.token_version).toBe(0)
    expect(decoded.exp).toBeDefined()
  })
})

describe('POST /api/logout', () => {
  it('returns ok', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/logout',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })
})

describe('GET /api/me', () => {
  it('returns 401 when no token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns email when valid Bearer token is present', async () => {
    seedUser()

    // Login to get a token
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: json,
      payload: { email: 'test@example.com', password: 'password123' },
    })
    const { token } = loginRes.json()
    expect(token).toBeDefined()

    // Use the token for /api/me
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().email).toBe('test@example.com')
  })

  it('returns 401 after token_version is bumped', async () => {
    seedUser()

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: json,
      payload: { email: 'test@example.com', password: 'password123' },
    })
    const { token } = loginRes.json()

    // Bump token_version (simulates password change)
    const db = getDb()
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE email = ?').run('test@example.com')

    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for expired token', async () => {
    seedUser()

    // Sign a token that already expired (1 second TTL, then wait)
    const token = app.jwt.sign({ email: 'test@example.com', token_version: 0 }, { expiresIn: '1s' })
    await new Promise(resolve => setTimeout(resolve, 1100))

    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(401)
  })
})

function loginAndGetToken(email = 'test@example.com', password = 'password123') {
  return app.inject({
    method: 'POST',
    url: '/api/login',
    headers: json,
    payload: { email, password },
  }).then(res => res.json().token as string)
}

describe('GET /api/auth/methods', () => {
  it('returns setup_required true when no users exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/methods' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ setup_required: true })
  })

  it('returns setup_required false when users exist', async () => {
    seedUser()
    const res = await app.inject({ method: 'GET', url: '/api/auth/methods' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ setup_required: false })
  })
})

describe('POST /api/auth/setup', () => {
  it('creates account when no users exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: json,
      payload: { email: 'admin@example.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.token).toBeDefined()
  })

  it('returns 403 when users already exist', async () => {
    seedUser()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: json,
      payload: { email: 'another@example.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('Setup is not available')
  })

  it('returns 400 when email or password missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: json,
      payload: { email: 'admin@example.com' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when password is too short', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: json,
      payload: { email: 'admin@example.com', password: 'short' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Password must be at least 8 characters')
  })

  it('returns 415 when content-type is not JSON', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=admin@example.com&password=password123',
    })
    expect(res.statusCode).toBe(415)
  })

  it('token from setup works with /api/me', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: json,
      payload: { email: 'admin@example.com', password: 'password123' },
    })
    const { token } = res.json()

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(meRes.statusCode).toBe(200)
    expect(meRes.json().email).toBe('admin@example.com')
  })
})

describe('POST /api/auth/password/change', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/change',
      headers: json,
      payload: { newPassword: 'newpass123' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when newPassword is missing', async () => {
    seedUser()
    const token = await loginAndGetToken()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/change',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { currentPassword: 'password123' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when newPassword is too short', async () => {
    seedUser()
    const token = await loginAndGetToken()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/change',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { currentPassword: 'password123', newPassword: 'short' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 401 when current password is wrong', async () => {
    seedUser()
    const token = await loginAndGetToken()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/change',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { currentPassword: 'wrongpassword', newPassword: 'newpass123' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Current password is incorrect')
  })

  it('changes password successfully with currentPassword', async () => {
    seedUser()
    const token = await loginAndGetToken()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/change',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { currentPassword: 'password123', newPassword: 'newpass123' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.token).toBeDefined()
  })

  it('invalidates old token after password change', async () => {
    seedUser()
    const oldToken = await loginAndGetToken()

    await app.inject({
      method: 'POST',
      url: '/api/auth/password/change',
      headers: { ...json, authorization: `Bearer ${oldToken}` },
      payload: { currentPassword: 'password123', newPassword: 'newpass123' },
    })

    // Old token should now be invalid
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${oldToken}` },
    })
    expect(meRes.statusCode).toBe(401)
  })

  it('allows login with new password after change', async () => {
    seedUser()
    const token = await loginAndGetToken()

    await app.inject({
      method: 'POST',
      url: '/api/auth/password/change',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { currentPassword: 'password123', newPassword: 'newpass123' },
    })

    // Login with new password
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: json,
      payload: { email: 'test@example.com', password: 'newpass123' },
    })
    expect(loginRes.statusCode).toBe(200)
    expect(loginRes.json().ok).toBe(true)
  })

  it('returns 400 without currentPassword when no alternative auth', async () => {
    seedUser()
    const token = await loginAndGetToken()

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/change',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { newPassword: 'newpass123' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Current password is required')
  })
})
