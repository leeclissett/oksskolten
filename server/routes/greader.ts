/**
 * Google Reader API (GReader) — compatible with NetNewsWire FreshRSS account type.
 *
 * Auth:   POST (or GET) /accounts/ClientLogin  →  plain-text `Auth=<jwt>`
 * Header: Authorization: GoogleLogin auth=<jwt>
 *
 * Endpoints used by NetNewsWire:
 *   GET  /reader/api/0/user-info
 *   GET  /reader/api/0/token
 *   GET  /reader/api/0/subscription/list
 *   GET  /reader/api/0/unread-count
 *   GET  /reader/api/0/tag/list
 *   GET  /reader/api/0/stream/items/ids
 *   POST /reader/api/0/stream/items/contents
 *   GET  /reader/api/0/stream/contents?s=:stream
 *   GET  /reader/api/0/stream/contents/:stream
 *   POST /reader/api/0/edit-tag
 *   POST /reader/api/0/mark-all-as-read
 *
 * Subscription management (FreshRSS greader.php):
 *   POST /reader/api/0/subscription/edit
 *   POST /reader/api/0/subscription/quickadd
 *   POST /reader/api/0/subscription/import
 *   GET  /reader/api/0/subscription/export
 *   POST /reader/api/0/rename-tag
 *   POST /reader/api/0/disable-tag
 *   GET  /check/compatibility          (no auth)
 *
 * Feed stream IDs are `feed/<feed id>` on output; `feed/<url>` is still
 * accepted on input (see findFeedByStream).
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { compareSync } from 'bcryptjs'
import { marked } from 'marked'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { allNamed, getDb, getSetting } from '../db.js'
import { deleteFeed, getFeeds, updateFeed } from '../db/feeds.js'
import { createCategory, deleteCategory, getCategories, updateCategory } from '../db/categories.js'
import type { Category, Feed } from '../db/types.js'
import { generateOpml, parseOpml } from '../opml.js'
import { AlreadySubscribedError, importOpmlEntries, subscribeToFeedUrl } from './feeds.js'
import { markArticleSeen, markArticleLiked, markStreamSeen, recordArticleRead, resolveArticleSourceUrl } from '../db/articles.js'
import { articleUrlToPath, isInlineEntryUrl } from '../../shared/url.js'
import { publicationSiteOf } from '../lib/cleaner/email.js'
import { routedPath } from '../lib/routed-path.js'
import { sqliteTimeToMs } from '../lib/sqlite-time.js'
import { clientLoginAttempts, loginAttemptKey } from '../lib/login-attempts.js'
import { logger } from '../logger.js'

declare module 'fastify' {
  interface FastifyRequest {
    greaderEmail: string
  }
}

const log = logger.child('greader')

/**
 * Lifetime of tokens issued by ClientLogin. FreshRSS issues auth tokens that
 * never expire, so Google Reader clients store the token and treat a later 401
 * as "signed out" instead of logging in again. The web session default (30d)
 * therefore signs reader apps out once a month. Tokens stay revocable: changing
 * the account password or email bumps token_version and rejects them.
 */
const GREADER_TOKEN_EXPIRY = '3650d'

/**
 * Bound parameters per `IN (...)` chunk. libsql (SQLite 3.45) allows 32766;
 * staying under the historical 999 keeps each statement and its CASE small.
 */
const MAX_SQL_PARAMS = 900

/** Extract the origin (scheme + host) from a feed URL, falling back to the raw URL. */
function feedOriginUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return url
  }
}

/** Convert an ISO or SQLite UTC datetime to a Google Reader microsecond timestamp (0 when absent). */
function dateToTimestampUsec(value: string | null): number {
  return (sqliteTimeToMs(value) ?? 0) * 1000
}

// --- Zod schemas for GReader request bodies ---
// Form-encoded bodies may send a key multiple times, so scalar fields use a
// union that normalises to a single string via transform.

const scalar = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v[0] : v))

/** A field that may be repeated (`i`, `a`, `r`): always a list, empty when absent. */
const list = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]))

const ClientLoginBody = z.object({
  Email: scalar.pipe(z.string().min(1, 'Email required')),
  Passwd: scalar.pipe(z.string().min(1, 'Passwd required')),
})

/** The ClientLogin fields present in a query string or form body (other keys dropped). */
function pickCredentials(source: unknown): { Email?: unknown; Passwd?: unknown } {
  if (!source || typeof source !== 'object') return {}
  const { Email, Passwd } = source as Record<string, unknown>
  return {
    ...(Email !== undefined ? { Email } : {}),
    ...(Passwd !== undefined ? { Passwd } : {}),
  }
}

const StreamItemsContentsBody = z.object({ i: list, r: scalar.optional() })

const EditTagBody = z.object({
  i: list,
  a: list,
  r: list,
})

const MarkAllAsReadBody = z.object({
  s: scalar.optional().default(''),
  ts: scalar.optional(),
})

// subscription/edit: `s` and `t` repeat (paired by position, as in FreshRSS);
// `ac`, `a` and `r` are single-valued, so a repeated key keeps the first.
const SubscriptionEditBody = z.object({
  s: list,
  t: list,
  ac: scalar.optional(),
  a: scalar.optional(),
  r: scalar.optional(),
})

const QuickaddBody = z.object({ quickadd: scalar.optional() })

const RenameTagBody = z.object({ s: scalar.optional(), dest: scalar.optional() })

const DisableTagBody = z.object({ s: list })

/**
 * The parameters of a request that FreshRSS reads from `$_REQUEST`: the query
 * string, overridden field by field by the form body.
 */
function requestFields(request: FastifyRequest): Record<string, unknown> {
  const query = request.query && typeof request.query === 'object' ? request.query as Record<string, unknown> : {}
  const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {}
  return { ...query, ...body }
}

// --- ID helpers ---

/** Encode integer article id to 16-char hex GReader item id */
function encodeItemId(id: number): string {
  return id.toString(16).padStart(16, '0')
}

/** Full GReader item tag URI */
function itemTagId(id: number): string {
  return `tag:google.com,2005:reader/item/${encodeItemId(id)}`
}

const ITEM_TAG_PREFIX = 'tag:google.com,2005:reader/item/'

/**
 * Decode a GReader item id back to an article id, with FreshRSS's rule
 * (greader.php `editTag`/`streamContentsItems`): after stripping the tag
 * prefix, a value that is not all digits, or that starts with `0`, is hex;
 * anything else is decimal. So the zero-padded 16-digit form `0000000000001000`
 * is 4096, while the bare `1000` that stream/items/ids emits is 1000.
 *
 * Returns null for anything that is not a positive safe integer: FreshRSS's
 * own IDs are µs timestamps above 2^53 and match nothing here, as do values
 * that are not hex at all.
 */
export function decodeItemId(raw: string): number | null {
  const value = raw.trim()
  const body = value.startsWith(ITEM_TAG_PREFIX) ? value.slice(ITEM_TAG_PREFIX.length) : value
  let n: bigint
  if (/^[1-9]\d{0,19}$/.test(body)) {
    n = BigInt(body)
  } else if (/^[0-9a-f]{1,16}$/i.test(body)) {
    n = BigInt(`0x${body}`)
  } else {
    return null
  }
  return n > 0n && n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : null
}

// --- Auth helper ---

function extractGReaderToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization ?? ''
  const match = auth.match(/^GoogleLogin\s+auth=(.+)$/i)
  return match ? match[1] : null
}

/**
 * Verify the `Authorization: GoogleLogin auth=<jwt>` header of a reader
 * request. Every failure (no header, a bad or expired token, a token whose
 * token_version was bumped) answers FreshRSS's `unauthorized()`.
 * Returns the account's email, or null once the 401 has been sent.
 */
export async function verifyGReaderAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  app: FastifyInstance,
): Promise<string | null> {
  const token = extractGReaderToken(request)
  if (!token) {
    unauthorized(reply)
    return null
  }
  try {
    const payload = app.jwt.verify<{ email: string; token_version: number }>(token)
    const user = getDb()
      .prepare('SELECT token_version FROM users WHERE email = ?')
      .get(payload.email) as { token_version: number } | undefined
    if (!user || user.token_version !== payload.token_version) {
      log.warn('GReader token rejected (version mismatch) for', payload.email)
      unauthorized(reply)
      return null
    }
    return payload.email
  } catch {
    unauthorized(reply)
    return null
  }
}

// --- Plain-text responses (FreshRSS greader.php) ---

/** A plain-text response, `text/plain; charset=UTF-8`, the body sent as given. */
function sendText(reply: FastifyReply, status: number, body: string): FastifyReply {
  reply.status(status)
  reply.header('Content-Type', 'text/plain; charset=UTF-8')
  return reply.send(body)
}

/** FreshRSS's `badRequest()`: 400, `Bad Request!`. */
export function badRequest(reply: FastifyReply): FastifyReply {
  return sendText(reply, 400, 'Bad Request!')
}

/** FreshRSS's `unauthorized()`: 401, `Unauthorized!`, `Google-Bad-Token: true`. */
export function unauthorized(reply: FastifyReply): FastifyReply {
  reply.header('Google-Bad-Token', 'true')
  return sendText(reply, 401, 'Unauthorized!')
}

/**
 * FreshRSS's `exit('OK')` of every write endpoint: 200, exactly `OK`, no
 * newline. Read You parses the body as a bare scalar.
 */
export function sendOk(reply: FastifyReply): FastifyReply {
  return sendText(reply, 200, 'OK')
}

/** Parse with a zod schema, or answer `400 Bad Request!` and return null. */
function parseOr400<T>(schema: z.ZodType<T>, data: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  badRequest(reply)
  return null
}

// --- Article → GReader item shape ---

interface ArticleRow {
  id: number
  feed_id: number
  feed_name: string
  title: string
  feed_url: string
  article_url: string
  source_url: string | null
  created_at: string | null
  published_at: string | null
  lang: string | null
  excerpt: string | null
  og_image: string | null
  seen_at: string | null
  read_at: string | null
  bookmarked_at: string | null
  liked_at: string | null
  score?: number
  full_text?: string | null
  rss_url?: string | null
  category_name?: string | null
}

function markdownToHtml(text: string): string {
  if (!text) return ''
  // If content already looks like HTML, return as-is
  if (text.trimStart().startsWith('<')) return text
  return marked.parse(text, { async: false }) as string
}

/** Scheme and host the client reached this server on (the public address when behind a proxy). */
function requestOrigin(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}`
}

/**
 * Website address for each feed made of inline entries (email newsletters
 * relayed by a mail-to-feed bridge), keyed by feed ID.
 *
 * Every such feed lives on the bridge's host, so the default website (the
 * feed's origin) is identical for all of them, and a reader app that tells
 * sources apart by website folds them into one. Report the publication the
 * feed's articles come from instead: the site most of their source URLs
 * belong to. A feed with no known source URL gets its page on this server.
 * The feed ID goes into the fragment, because several feeds can belong to one
 * publication and each still has to be distinct; a fragment never reaches
 * the site, so the address opens the same page.
 *
 * Feeds that are not inline are absent from the map and keep their origin.
 */
function inlineFeedSites(origin: string): Map<number, string> {
  const rows = getDb().prepare(`
    SELECT a.feed_id, a.url, a.source_url, f.rss_url
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    WHERE instr(a.url, '#') > 0 AND f.rss_url IS NOT NULL
  `).all() as { feed_id: number; url: string; source_url: string | null; rss_url: string }[]

  const siteCounts = new Map<number, Map<string, number>>()
  for (const row of rows) {
    if (!isInlineEntryUrl(row.url, row.rss_url)) continue
    let counts = siteCounts.get(row.feed_id)
    if (!counts) siteCounts.set(row.feed_id, counts = new Map())
    const site = row.source_url ? publicationSiteOf(row.source_url) : null
    if (site) counts.set(site, (counts.get(site) ?? 0) + 1)
  }

  const sites = new Map<number, string>()
  for (const [feedId, counts] of siteCounts) {
    // Most common site; ties broken alphabetically so the answer is stable.
    const [publication] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? []
    sites.set(feedId, publication ? `${publication}/#feed-${feedId}` : `${origin}/feeds/${feedId}`)
  }
  return sites
}

/**
 * The link a reader app opens for an article. Inline feed entries (email
 * newsletters) have no page at their own URL, which is the feed address plus
 * a fragment and usually sits on a private network: use the original post
 * when it is known, otherwise this server's own page for the article.
 */
function articleLink(a: ArticleRow, origin: string): string {
  const sourceUrl = resolveArticleSourceUrl({ url: a.article_url, source_url: a.source_url, feed_rss_url: a.rss_url })
  return sourceUrl ?? `${origin}${articleUrlToPath(a.article_url)}`
}

function articleToGReaderItem(a: ArticleRow, origin: string, feedSites: Map<number, string>): Record<string, unknown> {
  // published is when the article was published; crawlTimeMsec and
  // timestampUsec are when it reached this server (created_at, UTC), as in
  // FreshRSS, whose entry IDs are arrival times. Both arrival values are the
  // same instant, so timestampUsec === crawlTimeMsec * 1000.
  const publishedMs = sqliteTimeToMs(a.published_at)
  const publishedSec = publishedMs === null ? 0 : Math.floor(publishedMs / 1000)
  const arrivalMs = sqliteTimeToMs(a.created_at) ?? publishedSec * 1000

  const categories: string[] = ['user/-/state/com.google/reading-list']
  if (a.seen_at || a.read_at) categories.push('user/-/state/com.google/read')
  if (a.liked_at) categories.push('user/-/state/com.google/starred')
  if (a.category_name) categories.push(`user/-/label/${a.category_name}`)

  const feedUrl = a.rss_url ?? a.feed_url
  const content = a.full_text ?? a.excerpt ?? ''
  const link = articleLink(a, origin)

  // No `author`: Oksskolten does not store an article's author, and FreshRSS
  // omits the key when there is none (never the feed's name).
  return {
    id: itemTagId(a.id),
    crawlTimeMsec: String(arrivalMs),
    timestampUsec: String(arrivalMs * 1000),
    published: publishedSec,
    updated: publishedSec,
    title: a.title ?? '(no title)',
    canonical: [{ href: link }],
    alternate: [{ href: link, type: 'text/html' }],
    summary: { direction: 'ltr', content: markdownToHtml(content) },
    origin: {
      streamId: feedStreamId(a.feed_id),
      title: a.feed_name ?? '',
      htmlUrl: feedSites.get(a.feed_id) ?? feedOriginUrl(feedUrl),
    },
    categories,
  }
}

/** Fetch articles enriched with feed rss_url and category_name for GReader responses */
function getEnrichedArticles(ids: number[]): ArticleRow[] {
  if (ids.length === 0) return []
  const results: ArticleRow[] = []
  for (let i = 0; i < ids.length; i += MAX_SQL_PARAMS) {
    const batchIds = ids.slice(i, i + MAX_SQL_PARAMS)
    const placeholders = batchIds.map(() => '?').join(',')
    const orderCase = batchIds.map((id, j) => `WHEN ${id} THEN ${i + j}`).join(' ')
    const rows = getDb().prepare(`
      SELECT a.id, a.feed_id, f.name AS feed_name, f.rss_url, f.url AS feed_url,
             a.title, a.url AS article_url, a.source_url,
             a.created_at, a.published_at, a.lang,
             a.excerpt, a.og_image,
             a.full_text,
             a.seen_at, a.read_at, a.bookmarked_at, a.liked_at,
             c.name AS category_name
      FROM active_articles a
      JOIN feeds f ON a.feed_id = f.id
      LEFT JOIN categories c ON f.category_id = c.id
      WHERE a.id IN (${placeholders})
      ORDER BY CASE a.id ${orderCase} END
    `).all(...batchIds) as ArticleRow[]
    results.push(...rows)
  }
  return results
}

// --- Stream listing ---

interface StreamArticleRef {
  id: number
  created_at: string
}

/** Default page size of stream/items/ids and stream/contents when `n` is absent (FreshRSS and Google). */
const DEFAULT_PAGE_SIZE = 20
/** Largest `n` on stream/items/ids, as in FreshRSS; reader apps ask for up to 10000. */
const MAX_ITEM_IDS_PAGE_SIZE = 10000
/**
 * Largest `n` on stream/contents. FreshRSS has no cap; this is a deliberate
 * one, because each item carries its full body. 1000 is the largest page any
 * audited client asks for, so no client is cut short by it.
 */
const MAX_CONTENTS_PAGE_SIZE = 1000

/** Read a positive integer query parameter (first value if repeated). */
function positiveIntParam(value: string | string[] | undefined): number | null {
  if (value === undefined) return null
  const n = Number(Array.isArray(value) ? value[0] : value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

/** The page size `n`: DEFAULT_PAGE_SIZE when absent or invalid, at most `max`. */
function pageSizeParam(value: string | string[] | undefined, max: number): number {
  const n = positiveIntParam(value)
  return n === null || n < 1 ? DEFAULT_PAGE_SIZE : Math.min(n, max)
}

/**
 * Position in a stream: the (arrival time, id) of the last item already sent.
 * Streams are ordered on that pair, so the next page starts strictly after it
 * whatever arrived in the meantime — no repeats and no gaps, unlike an offset.
 */
interface StreamCursor {
  createdAt: string
  id: number
}

/** Opaque continuation token for the page that follows `ref`. base64url, so clients that do not percent-encode `c=` still send it back intact. */
function encodeContinuation(ref: StreamArticleRef): string {
  return Buffer.from(`${ref.id}:${ref.created_at}`).toString('base64url')
}

/**
 * Decode a continuation token. Anything else (including the base64 offsets
 * issued before cursors existed) yields null, i.e. the first page, as an
 * unreadable offset did before.
 */
function decodeContinuation(value: string | string[] | undefined): StreamCursor | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return null
  const match = /^(\d{1,16}):(.+)$/.exec(Buffer.from(raw, 'base64url').toString('utf8'))
  if (!match) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) ? { id, createdAt: match[2] } : null
}

/** Continuation for a page: present whenever the page is full (FreshRSS), never an empty string. */
function continuationFor(refs: StreamArticleRef[], limit: number): string | undefined {
  return refs.length > 0 && refs.length >= limit ? encodeContinuation(refs[refs.length - 1]) : undefined
}

/**
 * List the articles of a stream the way FreshRSS does: by the time they
 * reached the server, newest first, with `ot` / `nt` bounding that same
 * arrival time.
 *
 * Reader apps sync incrementally by reading the head of the reading list (or
 * asking for everything since their last sync). A feed subscribed today
 * arrives with a backlog whose publication dates can be weeks old, so ordering
 * or filtering by publication date hides those articles from every such sync
 * and the new feed never shows up in the app.
 *
 * Pages are keyed on (created_at, id) — the sort key — so `cursor` resumes
 * strictly after the last item of the previous page, in either direction.
 */
function listStreamArticles(
  filter: ReturnType<typeof buildArticleOpts>,
  page: { limit: number; cursor?: StreamCursor | null; startSec?: number | null; stopSec?: number | null; ascending?: boolean },
): StreamArticleRef[] {
  if (filter.matchesNothing) return []

  const conditions: string[] = []
  const params: Record<string, number | string> = {}

  if (filter.feedId) {
    conditions.push('a.feed_id = @feedId')
    params.feedId = filter.feedId
  }
  if (filter.categoryId) {
    conditions.push('a.category_id = @categoryId')
    params.categoryId = filter.categoryId
  }
  for (const state of filter.states) conditions.push(STATE_CONDITIONS[state])
  if (page.startSec) {
    conditions.push("a.created_at >= datetime(@startSec, 'unixepoch')")
    params.startSec = page.startSec
  }
  if (page.stopSec) {
    conditions.push("a.created_at <= datetime(@stopSec, 'unixepoch')")
    params.stopSec = page.stopSec
  }
  if (page.cursor) {
    conditions.push(`(a.created_at, a.id) ${page.ascending ? '>' : '<'} (@cursorCreatedAt, @cursorId)`)
    params.cursorCreatedAt = page.cursor.createdAt
    params.cursorId = page.cursor.id
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const direction = page.ascending ? 'ASC' : 'DESC'

  return allNamed<StreamArticleRef>(`
    SELECT a.id, a.created_at
    FROM active_articles a
    ${where}
    ORDER BY a.created_at ${direction}, a.id ${direction}
    LIMIT @limit
  `, { ...params, limit: page.limit })
}

/** Order article rows by arrival (created_at, then id), newest first unless `ascending`. */
function byArrival(ascending: boolean): (a: ArticleRow, b: ArticleRow) => number {
  return (a, b) => {
    const at = a.created_at ?? ''
    const bt = b.created_at ?? ''
    const order = at < bt ? -1 : at > bt ? 1 : a.id - b.id
    return ascending ? order : -order
  }
}

// --- Route registration ---

export async function greaderRoutes(app: FastifyInstance): Promise<void> {
  // Register greaderEmail on the request object so it can be set in the auth
  // preHandler hook and read type-safely in route handlers.
  app.decorateRequest('greaderEmail', '')

  // Parse application/x-www-form-urlencoded bodies (scoped to this plugin)
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req: FastifyRequest, body: string, done: (err: Error | null, body?: unknown) => void) => {
      const params = new URLSearchParams(body)
      const parsed: Record<string, string | string[]> = {}
      // Linear in the number of fields: stream/items/contents bodies repeat `i`
      // thousands of times, and this parser runs before the auth hook, so
      // copying the array on every repeat would let any client spend minutes
      // of CPU on one 1 MiB body.
      for (const [k, v] of params.entries()) {
        if (Object.hasOwn(parsed, k)) {
          const existing = parsed[k]
          if (Array.isArray(existing)) existing.push(v)
          else parsed[k] = [existing, v]
        } else {
          parsed[k] = v
        }
      }
      done(null, parsed)
    },
  )
  // ── Authentication ──────────────────────────────────────────────────────────

  // GET is accepted as well as POST because FreshRSS accepts it (some clients
  // still log in that way); a POST body field wins over the same query field.
  // Login is not limited per request, only per failure: reader apps such as
  // Read You re-run ClientLogin on every retry. The global limiter still
  // covers /accounts/*.
  app.route({
    method: ['GET', 'POST'],
    url: '/accounts/ClientLogin',
    handler: clientLogin,
  })

  // FreshRSS's clientLogin(): missing fields → 400 Bad Request!; unknown
  // account or wrong password → 401 Unauthorized! (+ Google-Bad-Token).
  async function clientLogin(request: FastifyRequest, reply: FastifyReply) {
    if (getSetting('auth.password_enabled') === '0') {
      // Passkey-only account: FreshRSS has no equivalent, so the client sees
      // an ordinary bad login; the log says why.
      log.warn('GReader ClientLogin refused: password authentication is disabled (passkey-only account)')
      return unauthorized(reply)
    }

    const query = pickCredentials(request.query)
    if (query.Email !== undefined || query.Passwd !== undefined) {
      log.warn(
        'ClientLogin using GET method is deprecated: password may appear in logs. Use POST instead. User-Agent:',
        request.headers['user-agent'] ?? '',
      )
    }
    const body = parseOr400(ClientLoginBody, { ...query, ...pickCredentials(request.body) }, reply)
    if (!body) return

    // Checked before the password, so a blocked client cannot keep guessing.
    const attemptKey = loginAttemptKey(request, body.Email)
    const limit = clientLoginAttempts.check(attemptKey)
    if (limit.blocked) {
      log.warn('GReader ClientLogin blocked after repeated failures for', body.Email)
      reply.header('Retry-After', String(limit.retryAfterSeconds))
      return sendText(reply, 429, 'Too Many Requests\n')
    }

    const user = getDb()
      .prepare('SELECT email, password_hash, token_version FROM users WHERE LOWER(email) = ?')
      .get(body.Email.toLowerCase()) as { email: string; password_hash: string; token_version: number } | undefined

    if (!user || !compareSync(body.Passwd, user.password_hash)) {
      clientLoginAttempts.recordFailure(attemptKey)
      log.warn('GReader ClientLogin failed for', body.Email)
      return unauthorized(reply)
    }

    clientLoginAttempts.reset(attemptKey)
    const token = app.jwt.sign(
      { email: user.email, token_version: user.token_version },
      { expiresIn: GREADER_TOKEN_EXPIRY },
    )
    // `LSID=null` literally, as FreshRSS (for Vienna RSS). A JWT has no `=`
    // or whitespace, which clients that split the lines on `=` rely on.
    return sendText(reply, 200, `SID=${token}\nLSID=null\nAuth=${token}\n`)
  }

  // ── All /reader/api/0/* routes require GReader auth ─────────────────────────

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Match on the routed path: request.url is still percent-encoded.
    if (!routedPath(request).startsWith('/reader/api/')) return
    const email = await verifyGReaderAuth(request, reply, app)
    if (!email) return // reply already sent
    request.greaderEmail = email
  })

  // ── User info ────────────────────────────────────────────────────────────────

  // FreshRSS emits exactly these four keys, the first three being the
  // username. Oksskolten's username is the account's email.
  app.get('/reader/api/0/user-info', async (request, reply) => {
    const email = request.greaderEmail
    reply.header('Content-Type', 'application/json')
    return reply.send({
      userId: email,
      userName: email,
      userProfileId: email,
      userEmail: email,
    })
  })

  // ── Edit token (required by some clients before write ops) ──────────────────

  // FreshRSS: `str_pad(sha1(...), 57, 'Z')` plus a newline ("Must have 57
  // characters"). Derived from the session's auth token, so it is stable for
  // a login. `T` is never checked (see docs/greader-compat.md §1).
  app.get('/reader/api/0/token', async (request, reply) => {
    const auth = extractGReaderToken(request) ?? ''
    const token = createHash('sha1').update(auth).digest('hex').padEnd(57, 'Z')
    return sendText(reply, 200, `${token}\n`)
  })

  // ── Subscription list ────────────────────────────────────────────────────────

  app.get('/reader/api/0/subscription/list', async (request, reply) => {
    const feeds = getFeeds().filter((f) => f.type !== 'clip')
    const feedSites = inlineFeedSites(requestOrigin(request))
    const subscriptions = feeds.map((f) => {
      const feedUrl = f.rss_url ?? f.url
      const categories: { id: string; label: string }[] = f.category_id && f.category_name
        ? [{ id: `user/-/label/${f.category_name}`, label: f.category_name }]
        : []
      // iconUrl is always present, as in FreshRSS. Oksskolten serves no feed
      // icons of its own (the web app asks a third-party favicon service), so
      // there is no icon URL on this server to report.
      return {
        id: feedStreamId(f.id),
        title: f.name,
        categories,
        url: feedUrl,
        htmlUrl: feedSites.get(f.id) ?? feedOriginUrl(feedUrl),
        iconUrl: '',
        firstitemmsec: '0',
      }
    })
    reply.header('Content-Type', 'application/json')
    return reply.send({ subscriptions })
  })

  // ── Unread counts ───────────────────────────────────────────────────────────

  app.get('/reader/api/0/unread-count', async (_request, reply) => {
    const feeds = getFeeds().filter((f) => f.type !== 'clip')

    // FreshRSS reports when a stream's newest item reached the server (its
    // entry IDs are arrival timestamps), read or not, not when that item was
    // published. Clients compare this value with their last sync to decide
    // which feeds changed, so a publication date would make a newly added feed
    // whose latest post predates that sync look unchanged, and its articles
    // would never load.
    const newestArrivalByFeed = new Map(
      (getDb().prepare(`
        SELECT feed_id, MAX(created_at) AS newest_created_at
        FROM active_articles
        GROUP BY feed_id
      `).all() as { feed_id: number; newest_created_at: string | null }[])
        .map((row) => [row.feed_id, row.newest_created_at]),
    )

    interface UnreadCountRow { id: string; count: number; newestItemTimestampUsec: string }
    const unreadcounts: UnreadCountRow[] = []
    let totalUnreads = 0
    let totalNewest = 0

    /** Append one row per feed and return the group's unread count and newest arrival. */
    const addFeedRows = (group: typeof feeds): { count: number; newest: number } => {
      let count = 0
      let newest = 0
      for (const feed of group) {
        const feedCount = Number(feed.unread_count)
        const feedNewest = dateToTimestampUsec(newestArrivalByFeed.get(feed.id) ?? null)
        unreadcounts.push({ id: feedStreamId(feed.id), count: feedCount, newestItemTimestampUsec: String(feedNewest) })
        count += feedCount
        newest = Math.max(newest, feedNewest)
      }
      totalUnreads += count
      totalNewest = Math.max(totalNewest, newest)
      return { count, newest }
    }

    // FreshRSS's order: each category's feed rows, then that category's row;
    // then (the fork only — FreshRSS has no feed without a category) the
    // uncategorised feeds; the reading list last.
    for (const category of getCategories()) {
      const totals = addFeedRows(feeds.filter((f) => f.category_id === category.id))
      unreadcounts.push({
        id: labelStreamId(category.name),
        count: totals.count,
        newestItemTimestampUsec: String(totals.newest),
      })
    }
    addFeedRows(feeds.filter((f) => f.category_id === null))

    unreadcounts.push({
      id: 'user/-/state/com.google/reading-list',
      count: totalUnreads,
      newestItemTimestampUsec: String(totalNewest),
    })

    reply.header('Content-Type', 'application/json')
    return reply.send({ max: totalUnreads, unreadcounts })
  })

  // ── Tag / label list ─────────────────────────────────────────────────────────

  app.get('/reader/api/0/tag/list', async (_request, reply) => {
    const cats = getCategories()
    const tags = [
      // No `type` on starred, as in FreshRSS; every category is a folder,
      // including those that hold no feed.
      { id: 'user/-/state/com.google/starred' },
      { id: 'user/-/state/com.google/reading-list' },
      ...cats.map((c) => ({ id: labelStreamId(c.name), type: 'folder' })),
    ]
    reply.header('Content-Type', 'application/json')
    return reply.send({ tags })
  })

  // ── Stream item IDs ──────────────────────────────────────────────────────────

  app.get('/reader/api/0/stream/items/ids', async (request, reply) => {
    const q = request.query as Record<string, string | string[]>
    const stream = firstParam(q.s) ?? 'user/-/state/com.google/reading-list'
    const limit = pageSizeParam(q.n, MAX_ITEM_IDS_PAGE_SIZE)
    const refs = listStreamArticles(buildArticleOpts(stream, firstParam(q.it), firstParam(q.xt)), {
      limit,
      cursor: decodeContinuation(q.c),
      startSec: positiveIntParam(q.ot),
      stopSec: positiveIntParam(q.nt),
      ascending: (Array.isArray(q.r) ? q.r[0] : q.r) === 'o',
    })

    const itemRefs = refs.map((ref) => ({
      id: String(ref.id),   // bare decimal — NNW expects this for FreshRSS variant
      directStreamIds: [],
      timestampUsec: String(dateToTimestampUsec(ref.created_at)),
    }))
    const continuation = continuationFor(refs, limit)
    reply.header('Content-Type', 'application/json')
    return reply.send({ itemRefs, ...(continuation ? { continuation } : {}) })
  })

  // ── Fetch specific items ─────────────────────────────────────────────────────

  app.post('/reader/api/0/stream/items/contents', async (request, reply) => {
    const body = parseOr400(StreamItemsContentsBody, request.body, reply)
    if (!body) return

    // No cap on the number of IDs, as in FreshRSS: Fastify's 1 MiB bodyLimit
    // bounds the request. Items come back in stream order (newest arrival
    // first, oldest first with r=o), not request order, as in FreshRSS.
    const q = request.query as Record<string, string | string[] | undefined>
    const order = (Array.isArray(q.r) ? q.r[0] : q.r) ?? body.r
    const ids = [...new Set(body.i.map(decodeItemId).filter((id): id is number => id !== null))]
    const rows = getEnrichedArticles(ids).sort(byArrival(order === 'o'))
    const origin = requestOrigin(request)
    const feedSites = inlineFeedSites(origin)
    const items = rows.map((row) => articleToGReaderItem(row, origin, feedSites))

    reply.header('Content-Type', 'application/json')
    return reply.send({ id: 'user/-/state/com.google/reading-list', updated: Math.floor(Date.now() / 1000), items })
  })

  // ── Stream contents ──────────────────────────────────────────────────────────

  async function sendStreamContents(
    request: FastifyRequest,
    reply: FastifyReply,
    stream: string,
  ): Promise<FastifyReply> {
    const q = request.query as Record<string, string | string[]>
    const limit = pageSizeParam(q.n, MAX_CONTENTS_PAGE_SIZE)

    const refs = listStreamArticles(buildArticleOpts(stream, firstParam(q.it), firstParam(q.xt)), {
      limit,
      cursor: decodeContinuation(q.c),
      startSec: positiveIntParam(q.ot),
      stopSec: positiveIntParam(q.nt),
      ascending: (Array.isArray(q.r) ? q.r[0] : q.r) === 'o',
    })
    const rows = getEnrichedArticles(refs.map((ref) => ref.id))

    const origin = requestOrigin(request)
    const feedSites = inlineFeedSites(origin)
    const items = rows.map((row) => articleToGReaderItem(row, origin, feedSites))
    const continuation = continuationFor(refs, limit)

    // The wrapper id is always the reading list, whatever stream was asked
    // for, as in FreshRSS.
    reply.header('Content-Type', 'application/json')
    return reply.send({
      id: 'user/-/state/com.google/reading-list',
      updated: Math.floor(Date.now() / 1000),
      items,
      ...(continuation ? { continuation } : {}),
    })
  }

  // FreshRSS supports both the original path form and the BazQux-style query
  // form, and different clients use different variants during article sync.
  app.get('/reader/api/0/stream/contents', async (request, reply) => {
    const q = request.query as Record<string, string | string[]>
    const streamParam = Array.isArray(q.s) ? q.s[0] : q.s
    const stream = streamParam ?? 'user/-/state/com.google/reading-list'
    return sendStreamContents(request, reply, stream)
  })

  // The router has already percent-decoded the wildcard. A client that
  // encoded the stream twice is still served: the feed and label lookups also
  // try the decoded form (findFeedByStream, findCategoryByName).
  app.get('/reader/api/0/stream/contents/*', async (request, reply) => {
    const stream = (request.params as Record<string, string>)['*'] ?? ''
    return sendStreamContents(request, reply, stream)
  })

  // ── Edit tag (mark read/unread/starred) ──────────────────────────────────────

  app.post('/reader/api/0/edit-tag', async (request, reply) => {
    const body = parseOr400(EditTagBody, request.body, reply)
    if (!body) return

    const articleIds = [...new Set(body.i.map(decodeItemId).filter((id): id is number => id !== null))]

    // As in FreshRSS, every `a` is applied, then every `r`. Labels
    // (user/-/label/<x>) and unknown states are ignored: Oksskolten has no
    // per-article labels. `a=kept-unread` marks unread (Google-era clients
    // send it; FreshRSS ignores it), `r=kept-unread` marks read.
    for (const tag of body.a) {
      const state = stateOf(tag)
      for (const id of articleIds) {
        if (state === 'read') recordArticleRead(id)
        else if (state === 'kept-unread') markArticleSeen(id, false)
        else if (state === 'starred') markArticleLiked(id, true)
      }
    }
    for (const tag of body.r) {
      const state = stateOf(tag)
      for (const id of articleIds) {
        if (state === 'read') markArticleSeen(id, false)
        else if (state === 'kept-unread') recordArticleRead(id)
        else if (state === 'starred') markArticleLiked(id, false)
      }
    }

    return sendOk(reply)
  })

  // ── Mark all as read ─────────────────────────────────────────────────────────

  app.post('/reader/api/0/mark-all-as-read', async (request, reply) => {
    const body = parseOr400(MarkAllAsReadBody, request.body, reply)
    if (!body) return

    // ts: arrival time in microseconds (FreshRSS compares it with entry IDs,
    // which are arrival µs). Absent or 0 means now; anything but digits is 400.
    const ts = (body.ts ?? '0').trim()
    if (!/^\d+$/.test(ts)) return badRequest(reply)
    const nowSec = Math.floor(Date.now() / 1000)
    const tsSec = BigInt(ts) / 1_000_000n
    const arrivedAtOrBeforeSec = tsSec === 0n ? nowSec : Number(tsSec > MAX_UNIX_SECONDS ? MAX_UNIX_SECONDS : tsSec)

    const stream = body.s.trim()
    const state = stateOf(stream)
    if (stream.startsWith('feed/')) {
      // An unknown feed marks nothing, as an unknown feed/<int> does in FreshRSS.
      const feed = findFeedByStream(stream)
      if (feed) markStreamSeen({ feedId: feed.id, arrivedAtOrBeforeSec })
    } else if (stream.startsWith('user/-/label/')) {
      const cat = findCategoryByName(stream.slice('user/-/label/'.length))
      if (!cat) return badRequest(reply)
      markStreamSeen({ categoryId: cat.id, arrivedAtOrBeforeSec })
    } else if (state === 'reading-list' || state === 'unread') {
      markStreamSeen({ arrivedAtOrBeforeSec })
    } else if (state === 'starred') {
      markStreamSeen({ liked: true, arrivedAtOrBeforeSec })
    } else if (state !== 'read') {
      // `read` is accepted and has nothing to mark; anything else, including
      // an empty stream, is 400 as in FreshRSS.
      return badRequest(reply)
    }

    return sendOk(reply)
  })

  // ── Subscription management ──────────────────────────────────────────────────

  // OPML bodies for subscription/import (NetNewsWire sends text/xml). Scoped
  // to this plugin; Fastify already reads text/plain as a string.
  app.addContentTypeParser(
    ['text/xml', 'application/xml', 'text/x-opml'],
    { parseAs: 'string' },
    (_req: FastifyRequest, body: string, done: (err: Error | null, body?: unknown) => void) => done(null, body),
  )

  /**
   * The category a subscription/edit `a=` names, created when missing
   * (FreshRSS). Undefined when `a` is absent or not a label; null when it is
   * the empty label, which FreshRSS maps to its default category and the fork
   * to "no category".
   */
  function categoryForLabel(stream: string | undefined): number | null | undefined {
    const name = labelNameOf(stream)
    if (name === null) return undefined
    if (name.trim() === '') return null
    return (findCategoryByName(name) ?? createCategory(name)).id
  }

  app.route({
    method: ['GET', 'POST'],
    url: '/reader/api/0/subscription/edit',
    handler: async (request, reply) => {
      const parsed = SubscriptionEditBody.safeParse(requestFields(request))
      if (!parsed.success) return badRequest(reply)
      const { s: streams, t: titles, ac, a, r } = parsed.data
      if (streams.length === 0 || (ac !== 'edit' && ac !== 'subscribe' && ac !== 'unsubscribe')) {
        return badRequest(reply)
      }
      // As in greader.php, streams that are not feed/… are skipped.
      const targets = streams
        .map((stream, i) => ({ stream: stream.trim(), title: (titles[i] ?? '').trim() }))
        .filter(({ stream }) => stream.startsWith('feed/'))

      if (ac === 'subscribe') {
        for (const { stream, title } of targets) {
          const url = stream.replace(/^(feed\/)+/, '')
          // A numeric ID names a feed that already exists: skipped (FreshRSS).
          if (/^\d+$/.test(url)) continue
          if (findFeedByStream(stream)) return badRequest(reply)
          try {
            await subscribeToFeedUrl(url, { title, categoryId: categoryForLabel(a) ?? null })
          } catch (err) {
            log.warn('GReader subscription/edit subscribe failed for', url, err instanceof Error ? err.message : err)
            return badRequest(reply)
          }
        }
        return sendOk(reply)
      }

      // edit / unsubscribe: every named feed must exist before anything changes.
      const feeds = targets.map(({ stream, title }) => ({ feed: findFeedByStream(stream), title }))
      if (feeds.some(({ feed }) => !feed)) return badRequest(reply)

      if (ac === 'unsubscribe') {
        for (const { feed } of feeds) deleteFeed(feed!.id)
        return sendOk(reply)
      }

      // ac=edit: `a=` sets the category (creating it), replacing the current
      // one, so a move needs no `r=` (Capy Reader sends `a=` alone). `r=` of a
      // label without a usable `a=` clears the category, whichever it was
      // (greader.php moves the feed to its default category unconditionally).
      let categoryId = categoryForLabel(a)
      if (categoryId === undefined && labelNameOf(r) !== null) categoryId = null
      for (const { feed, title } of feeds) {
        updateFeed(feed!.id, {
          ...(title ? { name: title } : {}),
          ...(categoryId !== undefined ? { category_id: categoryId } : {}),
        })
      }
      return sendOk(reply)
    },
  })

  // quickadd answers 200 whatever happens (FreshRSS); the outcome is in the body.
  app.route({
    method: ['GET', 'POST'],
    url: '/reader/api/0/subscription/quickadd',
    handler: async (request, reply) => {
      const parsed = QuickaddBody.safeParse(requestFields(request))
      const raw = parsed.success ? parsed.data.quickadd?.trim() : undefined
      if (!raw) return badRequest(reply)
      // A single leading feed/ is stripped, as in FreshRSS.
      const url = raw.startsWith('feed/') ? raw.slice('feed/'.length) : raw
      reply.header('Content-Type', 'application/json')
      try {
        const feed = await subscribeToFeedUrl(url)
        return reply.send({
          numResults: 1,
          query: feed.rss_url ?? feed.url,
          streamId: feedStreamId(feed.id),
          streamName: feed.name,
        })
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error'
        if (!(err instanceof AlreadySubscribedError)) log.warn('GReader quickadd failed for', url, error)
        return reply.send({ numResults: 0, error })
      }
    },
  })

  app.post('/reader/api/0/rename-tag', async (request, reply) => {
    const parsed = RenameTagBody.safeParse(requestFields(request))
    if (!parsed.success) return badRequest(reply)
    const from = labelNameOf(parsed.data.s)
    const to = labelNameOf(parsed.data.dest)?.trim()
    if (from === null || !to) return badRequest(reply)
    const cat = findCategoryByName(from)
    if (!cat) return badRequest(reply)
    updateCategory(cat.id, { name: to })
    return sendOk(reply)
  })

  // Only the first `s` is processed, as in FreshRSS. The category's feeds stay
  // subscribed, without a category (the foreign key sets theirs to NULL).
  app.post('/reader/api/0/disable-tag', async (request, reply) => {
    const parsed = DisableTagBody.safeParse(requestFields(request))
    if (!parsed.success) return badRequest(reply)
    const name = labelNameOf(parsed.data.s[0])
    const cat = name === null ? undefined : findCategoryByName(name)
    if (!cat) return badRequest(reply)
    deleteCategory(cat.id)
    return sendOk(reply)
  })

  // Raw OPML in the body, imported like the web app's OPML import; `OK` on
  // success, as in FreshRSS, 400 for an empty or unreadable body.
  app.post('/reader/api/0/subscription/import', async (request, reply) => {
    const xml = typeof request.body === 'string' ? request.body : Buffer.isBuffer(request.body) ? request.body.toString('utf8') : ''
    if (!xml.trim()) return badRequest(reply)
    let entries
    try {
      entries = parseOpml(xml)
    } catch {
      return badRequest(reply)
    }
    const result = importOpmlEntries(entries)
    log.info(`GReader subscription/import: ${result.imported} imported, ${result.skipped} skipped, ${result.errors.length} failed`)
    return sendOk(reply)
  })

  app.get('/reader/api/0/subscription/export', async (_request, reply) => {
    const xml = generateOpml(getFeeds(), getCategories())
    reply.header('Content-Type', 'application/xml; charset=UTF-8')
    reply.header('Content-Disposition', 'attachment; filename="oksskolten.opml"')
    return reply.send(xml)
  })

  // ── Server check (no auth) ─────────────────────────────────────────────────

  // FreshRSS's API check: does the Authorization header survive the reverse
  // proxy? Outside /reader/api/, so the auth hooks skip it; the header's value
  // is not checked.
  app.route({
    method: ['GET', 'POST'],
    url: '/check/compatibility',
    handler: async (request, reply) => {
      return sendText(reply, 200, extractGReaderToken(request)
        ? 'PASS'
        : 'FAIL get HTTP Authorization header! Wrong Web server configuration.')
    },
  })

  // ── Unknown reader paths ───────────────────────────────────────────────────

  // Anything under /reader/api/0/ that no route above serves, with any method,
  // is FreshRSS's fall-through `400 Bad Request!` — never the SPA's
  // index.html or the JSON 404. The router prefers every static or more
  // specific route over this wildcard, and the auth hook runs first (the
  // routed path is /reader/api/0/*), so without a valid token it is 401, as
  // greader.php checks the token before dispatching.
  app.all('/reader/api/0/*', async (_request, reply) => badRequest(reply))
}

/** Latest second SQLite's datetime(…, 'unixepoch') renders (9999-12-31 23:59:59 UTC). */
const MAX_UNIX_SECONDS = 253402300799n

/** First value of a query parameter that may be repeated. */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * The state named by a `user/<id>/state/com.google/<state>` tag (`read`,
 * `starred`, `reading-list`, `kept-unread`, …), or null for anything else.
 * FreshRSS only matches `user/-/`; Google-era clients may send their numeric
 * user ID instead of `-`, so any user segment is accepted.
 */
function stateOf(tag: string | undefined): string | null {
  const match = /^user\/[^/]*\/state\/com\.google\/([a-z-]+)$/.exec(tag?.trim() ?? '')
  return match ? match[1] : null
}

/** Article state constraints a stream request can carry; all of them must hold. */
type StateFilter = 'read' | 'unread' | 'starred' | 'unstarred'

const STATE_CONDITIONS: Record<StateFilter, string> = {
  read: 'a.seen_at IS NOT NULL',
  unread: 'a.seen_at IS NULL',
  starred: 'a.liked_at IS NOT NULL',
  unstarred: 'a.liked_at IS NULL',
}

/** Stream ID of a feed: `feed/<feed id>`, as FreshRSS emits it. */
function feedStreamId(feedId: number): string {
  return `feed/${feedId}`
}

/** Stream ID of a category: `user/-/label/<name>`. */
function labelStreamId(name: string): string {
  return `user/-/label/${name}`
}

/** decodeURIComponent, or null when the value is not valid percent-encoding. */
function tryDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/** The value as given, then its percent-decoded form when that differs. */
function asGivenThenDecoded(value: string): string[] {
  const decoded = tryDecode(value)
  return decoded !== null && decoded !== value ? [value, decoded] : [value]
}

/**
 * The feed a `feed/<…>` stream names. Both forms are accepted: `feed/<id>`
 * (what this server emits) and `feed/<url>` (what it emitted before, what
 * Fluent Reader and FreshRSS's own add-feed calls send). Repeated `feed/`
 * prefixes are stripped, as in FreshRSS. Lookup order: numeric ID, then the
 * RSS URL, then the site URL — first for the value as given, then for its
 * percent-decoded form (clients that encode `s=` twice). The clip feed is not
 * a subscription and is never matched. Unknown → undefined.
 */
function findFeedByStream(stream: string): Feed | undefined {
  const value = stream.trim().replace(/^(feed\/)+/, '')
  if (!value) return undefined
  const db = getDb()
  for (const candidate of asGivenThenDecoded(value)) {
    const feed = (/^\d{1,15}$/.test(candidate)
      ? db.prepare("SELECT * FROM feeds WHERE id = ? AND type != 'clip'").get(Number(candidate))
      : undefined)
      ?? db.prepare("SELECT * FROM feeds WHERE rss_url = ? AND type != 'clip' ORDER BY id LIMIT 1").get(candidate)
      ?? db.prepare("SELECT * FROM feeds WHERE url = ? AND type != 'clip' LIMIT 1").get(candidate)
    if (feed) return feed as Feed
  }
  return undefined
}

/** The category with this exact name (else the one matching its percent-decoded form). */
function findCategoryByName(name: string, categories: Category[] = getCategories()): Category | undefined {
  for (const candidate of asGivenThenDecoded(name)) {
    const cat = categories.find((c) => c.name === candidate)
    if (cat) return cat
  }
  return undefined
}

/**
 * The category name in a `user/<user>/label/<name>` stream (any user
 * segment, like stateOf), or null when the stream is not a label.
 */
function labelNameOf(stream: string | undefined): string | null {
  const match = /^user\/[^/]*\/label\/(.*)$/s.exec(stream?.trim() ?? '')
  return match ? match[1] : null
}

// --- Helper: map GReader stream → article filter ---

/**
 * The filter for a stream request: the stream `s`, the include target `it`
 * and the exclude target `xt` (FreshRSS's `streamContentsFilters`).
 *
 * `it` and `xt` accept exactly the three states read, unread and starred;
 * any other value is ignored. `it` restricts to that state; `xt=read` means
 * unread only, `xt=unread` read only, `xt=starred` not starred. The `read`
 * and `unread` states as the stream itself are the reading list restricted to
 * that state (overriding `it`, as in FreshRSS), on stream/items/ids and on
 * stream/contents alike.
 */
function buildArticleOpts(stream: string, include?: string, exclude?: string): {
  feedId?: number
  categoryId?: number
  /** The stream names a feed or label that does not exist: the stream is empty. */
  matchesNothing?: boolean
  states: StateFilter[]
} {
  const opts: { feedId?: number; categoryId?: number; matchesNothing?: boolean; states: StateFilter[] } = { states: [] }

  const streamState = stateOf(stream)
  let includeState = stateOf(include)
  if (streamState === 'read' || streamState === 'unread') includeState = streamState
  if (includeState === 'read' || includeState === 'unread' || includeState === 'starred') {
    opts.states.push(includeState)
  }

  const excludeState = stateOf(exclude)
  if (excludeState === 'read') opts.states.push('unread')
  else if (excludeState === 'unread') opts.states.push('read')
  else if (excludeState === 'starred') opts.states.push('unstarred')

  if (streamState === 'starred') {
    opts.states.push('starred')
    return opts
  }

  if (stream.startsWith('feed/')) {
    // An unknown feed is an empty stream, never the whole reading list.
    const feed = findFeedByStream(stream)
    if (feed) opts.feedId = feed.id
    else opts.matchesNothing = true
    return opts
  }

  if (stream.startsWith('user/-/label/')) {
    // Likewise an unknown label is an empty stream.
    const cat = findCategoryByName(stream.slice('user/-/label/'.length))
    if (cat) opts.categoryId = cat.id
    else opts.matchesNothing = true
    return opts
  }

  // Default: reading-list (all articles, no extra filter)
  return opts
}
