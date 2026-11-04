import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { getSetting, upsertSetting, deleteSetting, getOrCreateJwtSecret } from '../db.js'

beforeEach(() => {
  setupTestDb()
})

describe('getSetting', () => {
  it('returns undefined for non-existent key', () => {
    expect(getSetting('nonexistent')).toBeUndefined()
  })

  it('returns value for existing key', () => {
    upsertSetting('foo', 'bar')
    expect(getSetting('foo')).toBe('bar')
  })
})

describe('upsertSetting', () => {
  it('inserts a new setting', () => {
    upsertSetting('key1', 'value1')
    expect(getSetting('key1')).toBe('value1')
  })

  it('updates an existing setting on conflict', () => {
    upsertSetting('key1', 'value1')
    upsertSetting('key1', 'value2')
    expect(getSetting('key1')).toBe('value2')
  })

  it('handles empty string value', () => {
    upsertSetting('key1', '')
    expect(getSetting('key1')).toBe('')
  })

  it('handles very long values', () => {
    const long = 'x'.repeat(10_000)
    upsertSetting('key1', long)
    expect(getSetting('key1')).toBe(long)
  })
})

describe('deleteSetting', () => {
  it('deletes an existing setting', () => {
    upsertSetting('key1', 'value1')
    deleteSetting('key1')
    expect(getSetting('key1')).toBeUndefined()
  })

  it('does nothing for non-existent key', () => {
    expect(() => deleteSetting('nonexistent')).not.toThrow()
  })
})

describe('getOrCreateJwtSecret', () => {
  it('generates and persists a new secret on first call', () => {
    const secret = getOrCreateJwtSecret()
    expect(secret).toBeTruthy()
    expect(typeof secret).toBe('string')
    expect(secret.length).toBeGreaterThan(0)
    // Verify it was persisted
    expect(getSetting('system.jwt_secret')).toBe(secret)
  })

  it('returns the same secret on subsequent calls', () => {
    const first = getOrCreateJwtSecret()
    const second = getOrCreateJwtSecret()
    expect(first).toBe(second)
  })

  it('returns pre-existing secret without overwriting', () => {
    upsertSetting('system.jwt_secret', 'my-preset-secret')
    const secret = getOrCreateJwtSecret()
    expect(secret).toBe('my-preset-secret')
  })

  it.each(['', '   ', '\t\n'])('replaces a blank stored secret (%j) instead of returning it', (blank) => {
    upsertSetting('system.jwt_secret', blank)
    const secret = getOrCreateJwtSecret()
    expect(secret.trim()).not.toBe('')
    expect(secret.length).toBeGreaterThanOrEqual(32)
    expect(getSetting('system.jwt_secret')).toBe(secret)
  })

  it('generates a base64url-encoded secret', () => {
    const secret = getOrCreateJwtSecret()
    // base64url uses only [A-Za-z0-9_-]
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
