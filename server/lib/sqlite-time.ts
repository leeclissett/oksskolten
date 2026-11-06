/**
 * Timestamps stored by SQLite.
 *
 * `datetime('now')` and `CURRENT_TIMESTAMP` store UTC as `YYYY-MM-DD HH:MM:SS`
 * with no zone designator. `new Date(value)` and `Date.parse(value)` read that
 * form as *local* time, so the result is off by the process's UTC offset
 * whenever `TZ` is not UTC. Always convert such values with these helpers.
 */

const SQLITE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3})\d*)?$/

/**
 * Milliseconds since the epoch for a stored timestamp, or null when the value
 * is empty or unreadable.
 *
 * A value without a zone designator — SQLite's `YYYY-MM-DD HH:MM:SS`, with an
 * optional `T` separator and fraction — is UTC. Any other value (an ISO 8601
 * string with `Z` or an offset, as feeds' publication dates are stored) is
 * parsed as written.
 */
export function sqliteTimeToMs(value: string | null | undefined): number | null {
  if (!value) return null
  const match = SQLITE_DATETIME.exec(value)
  if (match) {
    const [, y, mo, d, h, mi, s, frac] = match
    const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), frac ? Number(frac.padEnd(3, '0')) : 0)
    return Number.isFinite(ms) ? ms : null
  }
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** Whole seconds since the epoch for a stored timestamp, or null (see sqliteTimeToMs). */
export function sqliteTimeToSec(value: string | null | undefined): number | null {
  const ms = sqliteTimeToMs(value)
  return ms === null ? null : Math.floor(ms / 1000)
}
