# Google Reader API — FreshRSS dialect (fork spec)

This fork of Oksskolten serves the Google Reader API so that native reader apps
(NetNewsWire, Reeder, Capy Reader, Read You, Fluent Reader, Unread, …) can sync
with it. The apps' "FreshRSS" account type *is* the Google Reader API with
FreshRSS's conventions, and FreshRSS is what app developers test against, so the
target is to be indistinguishable from FreshRSS's `p/api/greader.php`.

This document is the fork's specification of that dialect. It is written for an
agent doing an upstream sync or touching `server/routes/greader*.ts`. The
executable form is `server/routes/greader.contract.test.ts`: tests marked
`it.skip('WP<n>: …')` / `it.todo('WP<n>: …')` describe target behaviour that a
pending work package (WP) implements; everything else must stay green.

- **Oracle:** FreshRSS `p/api/greader.php` (1357 lines) and
  `FreshRSS_Entry::toGReader()` in `app/Models/Entry.php`, edge branch at commit
  `4e8a258` (2 Nov 2026). Line numbers below refer to that commit.
- **Upstream Oksskolten** (`babarot/oksskolten`) has no Reader API; everything
  here is fork-only code.

## 1. Compatibility principle — one API, not two

Nothing is added alongside the existing endpoint. One implementation serves both
base URLs:

| Base URL entered in the app | Paths served |
|---|---|
| `https://host` (generic "Google Reader" option) | `/accounts/ClientLogin`, `/reader/api/0/…` |
| `https://host/api/greader.php` (FreshRSS option) | `/api/greader.php/accounts/ClientLogin`, `/api/greader.php/reader/api/0/…` |

Every change is a **superset** of what a generic Google Reader client needs:

- **Tolerant on input:** both feed-ID forms (`feed/<id>` and `feed/<url>`), `T`
  optional and never validated, `output=json` optional, `s` optional on
  `stream/items/ids` (defaults to the reading list), GET or POST login.
- **Never drop a Google-era response key** just because FreshRSS omits it. The
  fork keeps emitting `itemRefs[].directStreamIds`, `itemRefs[].timestampUsec`,
  per-item `updated`, `subscriptions[].firstitemmsec` and `userInfoUrl`. Every
  decoder audited in §4 ignores unknown keys. The contract tests therefore
  assert required keys and types, never exact key sets.
- **Deliberate client-visible transitions** (each in its WP): feed IDs change
  from `feed/<url>` to `feed/<int>` (WP4, one-time re-sync in every app; per-item
  read/starred state survives); a bad login becomes `401 Unauthorized!` instead
  of `403 Error=BadAuthentication` (WP5); `stream/items/ids` without `n` returns
  20 instead of 10000 (WP2, Google's own default, with a continuation).

### Deliberate deviations from greader.php

| greader.php | Fork | Why |
|---|---|---|
| `tag/list`, `subscription/list`, `unread-count` answer `501 Not Implemented!` without `output=json` (L1257-1258, L1274-1275, L1305-1306) | `output=json` optional | Permissive is safe; no client relies on the 501. |
| `stream/items/ids` without `s` falls through to `400` (L1244) | Defaults to the reading list | Permissive. |
| A non-empty `T` other than `x` or the real token is rejected with `401` (`checkToken`, L247-263) | Any `T`, or none, is accepted | The fork's token is not FreshRSS's; validating it would break clients for no security gain (the `Authorization` header is the credential). |
| `mark-all-as-read` with `feed/<url>` → `400` (`basename()` is not numeric, L1052-1056) | `feed/<url>` accepted | Superset; Fluent Reader and old fork IDs use URLs. |
| `stream/contents?s=feed/<url>` silently matches nothing (the query form only works for `feed/<int>`; L1198-1215) | Accepted | Superset. |
| `stream/contents` has no `n` cap | `n` capped at 1000 (WP2) | Largest value any client sends; each item carries its full body. |
| `ot`/`nt` also match an entry's `lastModified` | Arrival time (`created_at`) only | The fork has no per-item modification time; equivalent for an article whose content never changes. |
| Continuation is the decimal ID of the last item | Opaque base64url of `<id>:<created_at>` of the last item | Same keyset semantics on the fork's `(created_at, id)` sort key; clients treat it as opaque. |
| Several responses carry PHP's default `Content-Type` (see A.2) | Explicit `text/plain; charset=UTF-8` / `application/json; charset=UTF-8` (WP5) | Clients do not check; an explicit type is safer. |
| `edit-tag` `a=user/-/state/com.google/kept-unread` is ignored (no case for it, L924-962) | Marks unread (current behaviour, kept) | Harmless; some Google-era clients send it. |
| `edit-tag` `a=user/-/label/<x>` tags the item (FreshRSS has per-item labels) | Accepted and ignored, still `OK` | Oksskolten has no per-article labels. |

## 2. How to add or change a route

Security invariants from PRs #15/#16 that every change must keep:

1. **Path checks use `routedPath(request)`** (`server/lib/routed-path.ts`), never
   `request.url`. `request.url` keeps percent-encoding while the router decodes
   it, so `/%72eader/api/0/user-info` reaches the `/reader/api/0/user-info`
   handler but fails `request.url.startsWith('/reader/')`.
2. **Both prefixes.** Register the route inside `greaderRoutes`
   (`server/routes/greader.ts`) under `/reader/api/0/…`. That one registration
   serves the root and, via `freshRssGreaderRoutes`
   (`server/routes/greader-freshrss.ts`), `/api/greader.php/…`. Auth is enforced
   by the `preHandler` hooks in both plugins, which match on the routed path —
   a route outside `/reader/api/` is **not** authenticated (correct only for
   `/accounts/ClientLogin` and `/check/compatibility`). Every new route gets a
   test under each prefix; the contract tests are parameterised over
   `PREFIXES` for this reason, and the auth tests iterate over `READER_ROUTES`
   (add new routes there).
3. **Rate limiting keys on `rateLimitKey(request)`** (`server/lib/client-ip.ts`,
   `CF-Connecting-IP`). Any new limiter must use the same key.

Other rules: form bodies are parsed by the plugin-scoped
`application/x-www-form-urlencoded` parser in `greaderRoutes`, which turns a
repeated key into an array — declare such fields scalar-or-array in zod. Do not
alter the LetterFeed inline-entry link logic or translated-article handling.

## 3. The dialect, verified from greader.php

Legend: **Fork** = state of `main` at `0c5fe8f`; **Target** = what the named WP
delivers. "verified L*n*–*m*" cites greader.php unless another file is named.

### A.1 Paths and dispatch

*Verified L1093-1119, L1128-1166, L1353.*

- Every response carries `Access-Control-Allow-Origin: *`,
  `Access-Control-Allow-Headers: Authorization`,
  `Access-Control-Allow-Methods: GET, POST`, `Access-Control-Max-Age: 600`, plus
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; sandbox`
  and `X-Content-Type-Options: nosniff` (L32-33). `OPTIONS` → `204` with no body.
- `PATH_INFO` is `rawurldecode`d, then `^(/api)?(/greader\.php)?` is stripped.
  An empty path with no query string → `200 OK` (body `OK`). Fewer than three
  path segments → `400`.
- `/check/compatibility` is dispatched **before** authentication.
- `/accounts/ClientLogin`; everything else needs `/reader/api/0/<x>` and a valid
  `Authorization` header, else `401`.
- Endpoints: `token`, `user-info`, `tag/list`,
  `subscription/{list,edit,quickadd,import,export}`, `unread-count`,
  `stream/contents[/<stream>]`, `stream/items/{ids,contents}`, `edit-tag`,
  `rename-tag`, `disable-tag`, `mark-all-as-read`.
- **Anything that matches no case falls through to `400 Bad Request!`** — including
  a known endpoint with missing required parameters (e.g. `subscription/edit`
  without `s`/`ac`, `stream/items/contents` without `i`, `quickadd` without
  `quickadd`, `subscription/import` with an empty body).
- Fork: root unknown paths fall to the SPA (`index.html`, 200), prefixed ones to
  `{"error":"Not found"}` (404). Target (WP5): `400 Bad Request!` for unknown
  paths under `/reader/api/0/` and `/api/greader.php/`. CORS/CSP headers and
  `OPTIONS` are not planned (browser clients only; none audited).

### A.2 Errors and content types

*Verified L117-161; content types per handler as cited.*

| Helper | Status | Body | Extra header |
|---|---|---|---|
| `badRequest()` | 400 | `Bad Request!` | |
| `unauthorized()` | 401 | `Unauthorized!` | `Google-Bad-Token: true` |
| `internalServerError()` | 500 | `Internal Server Error!` | |
| `notImplemented()` | 501 | `Not Implemented!` | |
| `serviceUnavailable()` | 503 | `Service Unavailable!` (API disabled) | |

All of these: `Content-Type: text/plain; charset=UTF-8`, no trailing newline.

**Correction to the plan:** greader.php only sets `Content-Type` explicitly in
some handlers. These responses carry PHP's default (`text/html; charset=UTF-8`
with a stock `php.ini`): `user-info`, `token`, `stream/items/ids`, `quickadd`,
and every `exit('OK')` (`edit-tag`, `mark-all-as-read`, `rename-tag`,
`disable-tag`, `subscription/edit`, `subscription/import`). Explicit types:
ClientLogin and `check/compatibility` `text/plain; charset=UTF-8`; `tag/list`,
`subscription/list`, `unread-count`, `stream/contents`, `stream/items/contents`
`application/json; charset=UTF-8`; `subscription/export`
`application/xml; charset=UTF-8`. No client checks the type; the fork's target
(WP5) is the explicit type for every response.

`exit('OK')` emits exactly the two bytes `OK` with status 200 — **no trailing
newline**. JSON bodies from `tag/list`, `subscription/list`, `unread-count` and
`stream/items/ids` end with `\n`; `user-info` and `quickadd` do not. The
streamed `stream/contents`/`stream/items/contents` bodies are pretty-printed
with tabs and end with `}\n`.

Fork: JSON responses already carry `application/json; charset=utf-8` (Fastify
appends the charset; passing tests assert it). Text responses carry bare
`text/plain` (target WP5: `text/plain; charset=UTF-8`). Auth failures are
`401 Error=NeedsBrowser` / `401 Error=TokenExpired` without
`Google-Bad-Token` (target WP5).

### A.3 Login, auth header, tokens

*Verified L178-263, L1147-1159.*

- `ClientLogin`: `Email` and `Passwd` from POST body **or** query string (GET is
  accepted with a deprecation log line). Either missing → falls through to
  `400`. A syntactically invalid username → `400`; unknown user or wrong
  password → `401 Unauthorized!` (+ `Google-Bad-Token`).
- Success: `200`, `text/plain; charset=UTF-8`, body exactly
  `SID=<auth>\nLSID=null\nAuth=<auth>\n` where `<auth>` is
  `<user>/<sha1>`. Fork: `SID=<jwt>\nLSID=<jwt>\nAuth=<jwt>\n` with
  `Content-Type: text/plain` (target WP5: `LSID=null` and the charset). A JWT
  contains no `=` or whitespace, which NNW and Capy need because they split on
  `=`.
- Requests authenticate with `Authorization: GoogleLogin auth=<auth>`. A header
  value without `/` is ignored, so the request is unauthenticated (`401`).
- `token`: `str_pad(sha1(salt . user . apiPasswordHash), 57, 'Z')` followed by
  `\n` — a stable 57-character value. Fork: echoes the JWT, no newline (target
  WP3: a stable 57-character token plus `\n`).
- `checkToken` (`edit-tag`, `rename-tag`, `disable-tag`, `mark-all-as-read`):
  `T` is read from the POST body only; `''` (FeedMe) and `'x'` (Reeder) are
  accepted, as is the real token; anything else → `401`. The fork accepts any
  `T` (see §1).
- `user-info`: exactly `{userId, userName, userProfileId, userEmail}`;
  **`userId`, `userName` and `userProfileId` are all the username**, `userEmail`
  is the account's login mail. Fork: `userId`/`userProfileId` = email,
  `userName` = email local part, plus `userInfoUrl` (kept; Oksskolten has no
  separate username).

### A.4 Item IDs

*Verified L35-51 (hex2dec), L862-870 and L913-918 (decode), Entry.php L1206-1210
(dec2hex), L1232.*

- FreshRSS entry ID = arrival time in microseconds. The fork uses the article's
  INTEGER AUTOINCREMENT id; only the format matters to clients.
- `stream/items/ids` emits the bare decimal ID as a JSON string. Items emit
  `tag:google.com,2005:reader/item/<16 hex digits, zero-padded>`.
- Decode rule, applied to every `i=`:
  `if (!ctype_digit($id) || $id[0] === '0') $id = hex2dec(basename($id));` —
  i.e. anything that is not all digits, **or starts with `0`**, is hex after
  stripping everything up to the last `/`; otherwise decimal.
- Vectors: `1000` → 1000; `0000000000001000` → 4096;
  `tag:google.com,2005:reader/item/000000000000000f` → 15;
  `5d0cfa30041d4348` → 6705009029382226760 (needs BigInt in JS).
- **Correction to the plan:** greader.php has no two's-complement handling.
  On 64-bit PHP `hexdec()` of a value above `0x7fffffffffffffff` (e.g.
  `fb115bd6d34a8e9f`) returns a float, so the ID becomes a string like
  `1.8091…E+19` and matches nothing; a non-hex string decodes to `0`. FreshRSS
  never issues such IDs (they are µs timestamps), so the fork need only reject
  values outside its integer range.
- Fork: an all-digit zero-padded ID such as `0000000000001000` is decoded as
  decimal 1000 — the wrong article (target WP3).

### A.5 Streams and stream parameters

*Verified L625-694 (filters), L699-857 (stream handlers), L1167-1253
(parameter parsing); EntryDAO.php L1004-1027 (time filters).*

- Stream IDs: `feed/<int>`; `user/-/label/<name>` (category, else per-item tag);
  `user/-/state/com.google/{reading-list,starred,read,unread}`; FreshRSS adds
  `user/-/state/org.freshrss/{main,important}` (not needed).
- Parameters (all from the query string): `n` count, default **20**, no upper
  bound; `r=o` ascending, anything else descending; `ot`/`nt` Unix seconds;
  `c` continuation (non-digits ignored); `xt` exclude target; `it` include
  target. Only the first value counts.
- **Time filters:** `ot` → `id >= ot·10⁶` **or** `lastModified >= ot`; `nt` →
  `id <= nt·10⁶` **and** `lastModified <= nt`. So `ot`/`nt` bound arrival time
  (plus FreshRSS's content-modified time). The fork filters on `created_at`
  only, which is equivalent for an article whose content never changes.
- **`it=` and `xt=` accept only the three states** (`read`, `unread`, `starred`
  under `user/-/state/com.google/`). `it` sets the base state filter (read only,
  unread only, starred only); `xt=read` → unread only, `xt=unread` → read only,
  `xt=starred` → not starred; combinations intersect. Any other `xt` value
  (e.g. `xt=feed/…`) is ignored. Fork: `it=` ignored and only `xt=read` honoured
  (target WP3).
- **`read`/`unread` as the stream itself** work on `stream/items/ids` only
  (L799-806: reading list + `it=` of that state, overriding any `it`). On
  `stream/contents` they match no case and fall through to `400`. Fork: both
  streams return everything (target WP3: read-only / unread-only on
  `stream/items/ids`; the fork may also serve them on `stream/contents`).
- **Continuation:** the decimal ID of the last item of the page, as a string.
  The next request with `c=<id>` asks for `n+1` items starting *at* that ID and
  drops the first. Emitted whenever the page is full (`count(ids) >= n`), so a
  stream of exactly `n` items yields a continuation whose next page is empty
  and has none. Never `""`. Same rule on `stream/contents` (L764) and
  `stream/items/ids` (L848-853).
- Fork (WP2): same rules. `n` defaults to 20, up to 10000 on
  `stream/items/ids` and 1000 on `stream/contents`. The continuation is an
  opaque keyset cursor on `(created_at, id)` of the last item (base64url), so
  articles arriving between pages cause neither repeats nor gaps, in both
  directions (`r=o` too). An unreadable `c` (e.g. a pre-WP2 offset) restarts
  at the first page.

### A.6 `stream/contents` and `stream/items/contents`

*Verified L699-776, L862-906, L1197-1252; Entry.php L1225-1325.*

- `stream/contents` forms: `/stream/contents` (no stream → reading list);
  `/stream/contents/feed/<int>` or `/feed/<percent-encoded url>` (the URL is
  re-read from `REQUEST_URI` with `[A-Za-z0-9'!*()%$_.~+-]+`, so it must be
  encoded); `/stream/contents/user/-/state/com.google/{reading-list,starred}`;
  `/stream/contents/user/-/label/<name>`; and the BazQux query form
  `/stream/contents?s=<stream>`, which splits `s` on `/` into the path
  segments (so `s=feed/<url>` does not work there, `s=feed/<int>` does).
- `stream/items/contents`: POST only, `i` repeated in the body (read via
  `multiplePosts`, body capped at 1 MiB), `r=o` in the query string.
  **Ordering (correction): items come back in FreshRSS's order, `ORDER BY id
  DESC` (newest arrival first) or `ASC` with `r=o`, not in request order**
  (`EntryDAO::listByIds`, L1797-1821). Unknown IDs are dropped silently. Fork
  (WP2): same order (`created_at DESC, id DESC`, ascending with `r=o`), no ID
  cap — Fastify's 1 MiB body limit is the only bound, as in FreshRSS; each
  item appears once even if its ID is repeated.
- Wrapper: `{"id": "user/-/state/com.google/reading-list", "updated": <unix
  seconds int>, "items": [...]}` plus `"continuation"` on `stream/contents`.
  The wrapper `id` is **always** the reading list, whatever stream was asked
  for. Fork: echoes the requested stream (see §5).
- Item, compat mode (`toGReader('compat')`):
  - `id` — tag form (A.4);
  - `crawlTimeMsec` — string, arrival ms; `timestampUsec` — string, arrival µs
    (Reeder and EasyRSS read it);
  - `published` — int, publication seconds; **no `updated`** (commented out);
  - `title`;
  - `canonical: [{href}]`, `alternate: [{href}]` — compat mode removes
    `alternate[0].type`;
  - `categories` — `user/-/state/com.google/reading-list`, then
    `user/-/label/<category>`, `org.freshrss/main`/`important` by feed priority,
    `read` when read, `starred` when starred, `user/-/label/<tag>` per item
    label, then the item's own feed-provided tags **as raw strings without a
    prefix** (Entry.php L1321-1323) — clients must tolerate arbitrary strings;
  - `origin: {streamId: "feed/<int>", htmlUrl, title}`;
  - `summary: {content}` — content cut at 500 000 bytes; compat mode has no
    `direction`;
  - `author` — only when the entry has one;
  - `enclosure: [{href, type, length?}]` — when present.
- Fork differences: `timestampUsec` is publication time and `crawlTimeMsec` is
  computed with `new Date(created_at)`, which reads SQLite's UTC
  `YYYY-MM-DD HH:MM:SS` as **local time** — off by the server's UTC offset
  whenever `TZ` is not UTC (found by the contract tests; target WP3 for both);
  `author` is the feed name (target WP3: omit); `origin.streamId` is
  `feed/<url>` (target WP4); `updated`, `summary.direction` and
  `alternate[0].type` are extra keys (allowed).

### A.7 Subscriptions, tags, unread counts

*Verified L279-313 (tag/list), L315-381 (export, import, list), L390-521
(edit, quickadd), L523-583 (unread-count), L996-1045 (rename/disable-tag);
FeedDAO.php L414-426; AlreadySubscribedException.php L7.*

- **`subscription/list`** → `{"subscriptions": [{id: "feed/<int>", title,
  categories: [{id: "user/-/label/<name>", label}], url, htmlUrl, iconUrl,
  "frss:priority"}]}`. In FreshRSS every feed has exactly one category; hidden
  feeds are omitted. **`sortid` and `firstitemmsec` are not emitted** (both
  commented out, L360-361). `iconUrl` is always present (FreshRSS's favicon
  URL). Fork: `feed/<url>` IDs (target WP4), `categories: []` for feeds without
  a category (kept), `iconUrl: ""` (target WP4: omit unless a real icon URL
  exists), extra `firstitemmsec: "0"` (kept).
- **`tag/list`** → `{"tags": [...]}` in this order:
  `{id: "user/-/state/com.google/starred"}` — **no `type` key**;
  `{id: "user/-/state/com.google/reading-list"}`;
  `{id: "user/-/state/org.freshrss/main"}`, `{id: "…/important"}`; one
  `{id: "user/-/label/<category>", type: "folder"}` per category, empty ones
  included; one `{id: "user/-/label/<tag>", type: "tag", unread_count}` per item
  label. Fork: emits `type: "tag"` on the starred entry (extra key, kept) and no
  `org.freshrss` entries; all categories including empty ones appear (passing
  test).
- **`unread-count`** → `{"max": <total unread int>, "unreadcounts": [...]}`.
  For each category: one row per feed `{id: "feed/<int>", count: int,
  newestItemTimestampUsec: string}`, then the category row
  `{id: "user/-/label/<name>", count, newestItemTimestampUsec}`; then one row per
  item label; then `{id: "user/-/state/com.google/reading-list", count: total,
  newestItemTimestampUsec}` **last**. `newestItemTimestampUsec` is
  `MAX(id)` per feed — the newest arrival, **read or unread** — and `"0"` for an
  empty feed; `max` equals the reading-list count. Fork: matches, except feed
  rows come first and category rows after them (order is not significant to any
  audited client) and feed IDs are `feed/<url>` (target WP4).
- **`subscription/edit`** (POST or GET; requires both `s` and `ac`, else `400`):
  - `s` repeatable in the POST body (`multiplePosts`), or a single `s` in the
    query; `t` likewise, paired with `s` by position. `a` and `r` are
    **single-valued** (a repeated key keeps PHP's last value).
  - `ac` ∉ {`subscribe`, `unsubscribe`, `edit`} → `400`.
  - `a=user/-/label/<name>` resolves the category, **creating it** if missing
    (the empty name or the default category's name means the default
    category). **Correction:** `r=user/-/label/<anything>` *without a usable
    `a=`* moves the feed to the default category — greader.php does not check
    that the feed is currently in that category. The fork has no default
    category; WP4 maps this to "no category".
  - Each `s` must start with `feed/` (others are skipped silently); repeated
    `feed/` prefixes are stripped; a numeric remainder is a feed ID, anything
    else is looked up by URL.
  - `subscribe`: a numeric `s` is skipped; a URL not yet subscribed is added
    with title `t` and category `a`; **an already-subscribed URL or a failed
    add → `400`**.
  - `unsubscribe`: unknown feed → `400`.
  - `edit`: unknown feed → `400`; moves if `a`/`r` resolved a category, renames
    if `t` is non-empty.
  - Success → `OK`. Streams are processed last to first.
- **`subscription/quickadd`** (`quickadd` from body or query; a leading `feed/`
  is stripped) → `{"numResults":1,"query":"<feed url>","streamId":
  "feed/<int>","streamName":"<title>"}`, or on any exception
  `{"numResults":0,"error":"<message>"}` — **both with status 200**. Already
  subscribed: the message is `Already subscribed! <url>` (Capy Reader matches
  the prefix).
- **`rename-tag`**: `s` and `dest` must both start with `user/-/label/`, else
  `400`; renames the category, else a label of that name; neither found →
  `400`. Success `OK`.
- **`disable-tag`**: `s` repeatable, but **only the first is processed**
  (`disableTag()` exits on success); the category's feeds move to the default
  category and the category is deleted (or the label is deleted); not found or
  no `user/-/label/` prefix → `400`.
- **`subscription/import`**: POST, raw OPML body (≤ 1 MiB); success `OK`, failure
  or empty body → `400`. **`subscription/export`**: OPML,
  **`application/xml; charset=UTF-8`** (correction: not `text/xml`) with a
  `Content-disposition: attachment` header.
- **`check/compatibility`**: no authentication. `200`,
  `text/plain; charset=UTF-8`. Body `PASS` when an `Authorization` header with a
  non-empty `GoogleLogin auth=` value reached PHP (the value is not checked),
  else `FAIL get HTTP Authorization header! Wrong Web server configuration.`
  (also `200`). Any method.
- Fork: `subscription/edit`, `quickadd`, `rename-tag`, `disable-tag`,
  `subscription/import`, `subscription/export` and `check/compatibility` do not
  exist (target WP4).

### A.8 `edit-tag` and `mark-all-as-read`

*Verified L913-994, L1050-1091, L1309-1343; EntryDAO.php L592-598.*

- **`edit-tag`**: `i`, `a`, `r` all repeatable, read from the POST body. All
  `a` values are applied, then all `r` values. `a`/`r` of
  `user/-/state/com.google/read` mark read/unread; `…/starred`
  star/unstar; `…/broadcast`, `…/like`, `…/tracking-kept-unread` are ignored;
  `user/-/label/<x>` tags/untags the items (creating the label). Anything else
  is ignored. **Correction:** `user/-/state/com.google/kept-unread` is not
  handled (ignored). Response `OK`. Fork: only the first `a` and first `r` are
  honoured (target WP3: all), `kept-unread` marks unread (kept, §1).
- **`mark-all-as-read`**: `s` and `ts` from the POST body. `ts` (comment says
  nanoseconds; it is compared with entry IDs, so **microseconds of arrival**)
  must be all digits, else `400`; absent → `0` → "now". Only entries with
  `id <= ts` are marked. Streams: `feed/<int>` (non-numeric → `400`),
  `user/-/label/<name>` (category, else label, else `400`), `reading-list`,
  **`starred` (supported — marks only starred items)**, `read`, `unread`,
  `org.freshrss/main`/`important`; anything else, including an empty `s`,
  → `400`. Response `OK`. Fork: `ts` ignored, `starred` not supported, unknown
  streams answer `OK` (targets WP3/WP4; the `400` for unknown streams is not
  assigned — see §5).

## 4. What the open-source clients require

Audited from source on 4 Nov 2026: NetNewsWire
(`Modules/Account/Sources/Account/ReaderAPI/`), Capy Reader (`readerclient/`,
`ReaderAccountDelegate.kt`), Read You (`infrastructure/rss/provider/greader/`),
Fluent Reader (`src/scripts/models/services/greader.ts`).

- **All four:** POST `ClientLogin` → `200` plain text with an `Auth=<token>`
  line (NNW and Capy split lines on `=`, so no `=` in the token; Fluent requires
  status exactly 200); `Authorization: GoogleLogin auth=…`;
  `subscription/list` with `id`, `title`, `categories[]` (Capy also requires
  `htmlUrl`); `stream/items/ids` IDs as decimal strings, `n` up to 10000,
  `continuation` omitted on the last page (an empty string makes NNW, Capy and
  Read You loop forever); item `id` in tag form; `origin.streamId` equal to the
  subscription `id`; `edit-tag` with repeated `i=` (tag form from NNW/Capy, bare
  decimal from Read You/Fluent), `a=`/`r=` read/starred, batches up to 1000,
  body `OK` (Read You parses it as a bare scalar — JSON or empty breaks it).
  All four decoders ignore unknown JSON keys.
- **Three of four:** `stream/items/contents` POST with 100–250 IDs (NNW 150,
  Capy 250, Read You 100), wrapper `id` string and `updated` int required by
  NNW; `token`; `subscription/edit`, `quickadd`, `rename-tag`, `disable-tag`.
- **Capy Reader** appends `api/greader.php/` itself and never re-logs in (tokens
  must be long-lived — the fork issues 3650-day tokens revocable by
  `token_version`); requests `s=user/-/state/com.google/read` for "Today".
- **Read You** (FreshRSS mode) requests
  `it=user/-/state/com.google/read&ot=<1 month>` expecting read items only, and
  re-runs `ClientLogin` on every retry (8 parallel requests, 10 s timeout) —
  hence WP1's failures-only login limit.
- **Fluent Reader** uses `stream/contents` with no stream segment and
  `mark-all-as-read` with `s=` but no `ts`/`T`; pages `items/ids` only while a
  page has ≥ 1000 refs, then marks everything missing as read.
- **NetNewsWire** treats `429` as "pause syncing for `Retry-After`, or 1 h", and
  uses the HTTP `Date` header of the `items/ids` response as its sync watermark.
- **Closed-source** (Reeder Classic, lire, ReadKit, Unread, Fiery Feeds,
  Currents): only FreshRSS's source comments (Reeder reads `timestampUsec`,
  sends `T=x`; FeedMe sends `T=`) and a third-party report that Reeder 5 needs
  plain-text `OK` bodies and expects the `read` state stream to return items.
  WP6 records live traces.

## 5. Open questions

- **Wrapper `id` of `stream/contents`.** greader.php always says
  `user/-/state/com.google/reading-list`; Google echoed the requested stream,
  as the fork does. No WP is assigned; the contract only asserts a string.
- **`mark-all-as-read` with an unknown or empty stream.** greader.php answers
  `400`; the fork answers `OK` and does nothing. Not assigned; Fluent Reader
  always sends a valid `s`.
