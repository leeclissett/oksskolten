import type { FastifyRequest } from 'fastify'
import { rateLimitKey } from './client-ip.js'

/**
 * In-memory limiter for failed password logins (Google Reader ClientLogin).
 *
 * Only failures count. Reader apps such as Read You re-run ClientLogin on
 * every retry, so a limit on all logins locks out a client that knows the
 * password; a limit on failures still stops password guessing.
 *
 * Window: fixed, per key. The first failure opens a window of `windowMs`;
 * once `maxFailures` failures fall inside it, the key is blocked until that
 * window ends, whatever the later requests send (a correct password included,
 * so a blocked key costs no password check). When the window ends the key
 * starts from zero. A successful login before the limit clears the key.
 *
 * Memory: expired entries are swept at most once per `sweepIntervalMs`, and
 * the map never holds more than `maxEntries` keys (the oldest is dropped).
 * State is per process and lost on restart, which is acceptable for a
 * single-instance self-hosted server.
 */

export interface LoginAttemptLimiterOptions {
  maxFailures?: number
  windowMs?: number
  maxEntries?: number
  sweepIntervalMs?: number
  now?: () => number
}

interface Entry {
  failures: number
  windowEndsAt: number
}

export type LoginAttemptCheck = { blocked: false } | { blocked: true; retryAfterSeconds: number }

export class LoginAttemptLimiter {
  readonly maxFailures: number
  readonly windowMs: number
  private readonly maxEntries: number
  private readonly sweepIntervalMs: number
  private readonly now: () => number
  private readonly entries = new Map<string, Entry>()
  private lastSweepAt = 0

  constructor(options: LoginAttemptLimiterOptions = {}) {
    this.maxFailures = options.maxFailures ?? 10
    this.windowMs = options.windowMs ?? 15 * 60_000
    this.maxEntries = options.maxEntries ?? 10_000
    this.sweepIntervalMs = options.sweepIntervalMs ?? 60_000
    // Look Date.now up on each call so fake timers in tests take effect.
    this.now = options.now ?? (() => Date.now())
  }

  /** Whether `key` is blocked right now, and for how many whole seconds (rounded up). */
  check(key: string): LoginAttemptCheck {
    const now = this.now()
    this.sweep(now)
    const entry = this.live(key, now)
    if (!entry || entry.failures < this.maxFailures) return { blocked: false }
    return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((entry.windowEndsAt - now) / 1000)) }
  }

  /** Count one failed login for `key`. */
  recordFailure(key: string): void {
    const now = this.now()
    this.sweep(now)
    const entry = this.live(key, now)
    if (entry) {
      entry.failures++
      return
    }
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    this.entries.set(key, { failures: 1, windowEndsAt: now + this.windowMs })
  }

  /** Forget `key` (call after a successful login). */
  reset(key: string): void {
    this.entries.delete(key)
  }

  /** Number of keys currently held (for tests). */
  get size(): number {
    return this.entries.size
  }

  /** Forget every key (for tests). */
  clear(): void {
    this.entries.clear()
    this.lastSweepAt = 0
  }

  private live(key: string, now: number): Entry | undefined {
    const entry = this.entries.get(key)
    if (entry && entry.windowEndsAt <= now) {
      this.entries.delete(key)
      return undefined
    }
    return entry
  }

  private sweep(now: number): void {
    if (now - this.lastSweepAt < this.sweepIntervalMs) return
    this.lastSweepAt = now
    for (const [key, entry] of this.entries) {
      if (entry.windowEndsAt <= now) this.entries.delete(key)
    }
  }
}

/** Process-wide limiter for Google Reader ClientLogin: 10 failures per 15 minutes per IP and email. */
export const clientLoginAttempts = new LoginAttemptLimiter()

/** Limiter key for a login attempt: the rate-limit client key plus the submitted email, case-folded. */
export function loginAttemptKey(request: FastifyRequest, email: string): string {
  return `${rateLimitKey(request)}:${email.toLowerCase()}`
}
