import { afterEach, describe, expect, it } from 'vitest'
import { sqliteTimeToMs, sqliteTimeToSec } from './sqlite-time.js'

const savedTz = process.env.TZ

afterEach(() => {
  if (savedTz === undefined) delete process.env.TZ
  else process.env.TZ = savedTz
})

describe.each(['UTC', 'Europe/Amsterdam', 'America/Los_Angeles', 'Asia/Tokyo'])('sqliteTimeToMs (TZ=%s)', (tz) => {
  it('reads SQLite datetime() output as UTC', () => {
    process.env.TZ = tz
    expect(sqliteTimeToMs('2026-10-01 10:00:00')).toBe(Date.UTC(2026, 9, 1, 10, 0, 0))
    // Winter time too, where Amsterdam is UTC+1 instead of +2.
    expect(sqliteTimeToMs('2026-01-15 23:59:59')).toBe(Date.UTC(2026, 0, 15, 23, 59, 59))
  })

  it('accepts a T separator and a fraction without a zone as UTC', () => {
    process.env.TZ = tz
    expect(sqliteTimeToMs('2026-10-01T10:00:00')).toBe(Date.UTC(2026, 9, 1, 10, 0, 0))
    expect(sqliteTimeToMs('2026-10-01 10:00:00.5')).toBe(Date.UTC(2026, 9, 1, 10, 0, 0, 500))
    expect(sqliteTimeToMs('2026-10-01 10:00:00.123456')).toBe(Date.UTC(2026, 9, 1, 10, 0, 0, 123))
  })

  it('parses ISO 8601 values with a zone as written', () => {
    process.env.TZ = tz
    expect(sqliteTimeToMs('2020-01-01T00:00:00Z')).toBe(Date.UTC(2020, 0, 1))
    expect(sqliteTimeToMs('2020-01-01T00:00:00.000Z')).toBe(Date.UTC(2020, 0, 1))
    expect(sqliteTimeToMs('2020-01-01T02:00:00+02:00')).toBe(Date.UTC(2020, 0, 1))
  })
})

describe('sqliteTimeToMs edge cases', () => {
  it('returns null for empty or unreadable values', () => {
    expect(sqliteTimeToMs(null)).toBeNull()
    expect(sqliteTimeToMs(undefined)).toBeNull()
    expect(sqliteTimeToMs('')).toBeNull()
    expect(sqliteTimeToMs('not a date')).toBeNull()
  })
})

describe('sqliteTimeToSec', () => {
  it('floors to whole seconds', () => {
    process.env.TZ = 'Europe/Amsterdam'
    expect(sqliteTimeToSec('2026-10-01 10:00:00.999')).toBe(Date.UTC(2026, 9, 1, 10) / 1000)
    expect(sqliteTimeToSec('2020-01-01T00:00:00Z')).toBe(Date.UTC(2020, 0, 1) / 1000)
    expect(sqliteTimeToSec(null)).toBeNull()
  })
})
