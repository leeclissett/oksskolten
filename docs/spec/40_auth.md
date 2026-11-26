# Oksskolten Spec — Authentication

> [Back to Overview](./01_overview.md)

## Authentication

### Approach

Two methods: password authentication with JWT + bcryptjs for the web UI, and API key authentication for external tool access. The Reader API has its own ClientLogin auth (see `docs/greader-compat.md`). Passkeys and GitHub OAuth were removed from this fork.

### DB Schema

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE api_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  key_hash     TEXT    NOT NULL UNIQUE,
  key_prefix   TEXT    NOT NULL,
  scopes       TEXT    NOT NULL DEFAULT 'read',
  last_used_at TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### Initial Setup (User Creation)

When the `users` table is empty, accessing the app in a browser displays the initial setup screen (`SetupPage`) instead of the login screen.

**Flow:**

1. Frontend: detects `setup_required: true` via `GET /api/auth/methods` → displays `SetupPage`
2. User enters email, password, and password confirmation, then submits
3. `POST /api/auth/setup` creates the account (atomic INSERT: `WHERE NOT EXISTS (SELECT 1 FROM users)`)
4. On success → issues a JWT and auto-logs in
5. If a user already exists, returns 403 (creating a second user is not allowed)

**Notes:**

- `account_name` is automatically saved to the `settings` table using the registered email as the initial value on the first `GET /api/settings/profile` call (can be changed from the settings screen)

### Password Authentication Flow

```
1. Frontend: checks auth status via GET /api/me (with Authorization header)
   - 401 → displays LoginPage (AuthGate component)
2. Sends email/password to POST /api/login
3. Server: checks auth_password_enabled setting ('0' → 403)
4. Server: looks up email in users table, compares with bcryptjs
5. On success → generates JWT (includes email + token_version in payload)
6. Frontend: saves token to localStorage → revalidates /api/me via SWR mutate → displays app
7. Logout → removes token from localStorage → navigates to login screen
```

### JWT Token

- Algorithm: HS256
- Expiration: 30 days
- Payload: `{ email, token_version }`
- Transport: `Authorization: Bearer <token>` header
- Frontend storage: `localStorage` (`auth_token` key)
- Signing secret: persisted in DB (`settings` table). Can be overridden with the `JWT_SECRET` environment variable
- On 401 response: frontend automatically discards the token and redirects to the login screen
- Invalidation via `token_version`: incrementing `token_version` on password change invalidates all existing sessions

### Startup Guard

```typescript
// AUTH_DISABLED is only allowed in development
if (process.env.AUTH_DISABLED === '1' && process.env.NODE_ENV !== 'development') {
  process.exit(1)
}

// JWT_SECRET: env var > DB-stored value > auto-generate new one
const jwtSecret = process.env.JWT_SECRET || getOrCreateJwtSecret()
```

### Password Reset (CLI)

If the password is forgotten, it can be reset via a CLI script with direct server access. In a self-hosted environment, server access implies identity, so no additional authentication such as email verification is required.

```bash
npx tsx scripts/reset-password.ts
```

- Interactively enter a new password
- If there is only one user, they are auto-selected; if multiple, select by number
- Increments `token_version` to invalidate all existing sessions

### API Key Authentication

API keys provide programmatic access for external scripts, bots, and monitoring tools. Unlike JWT (which is for interactive user sessions), API keys are long-lived bearer tokens with scoped permissions.

**Key format:** `ok_` prefix + 40 hex characters (e.g., `ok_6ed6d44c17a82e3af429d384ef7baa04d6268917`)

**Storage:** Only the SHA-256 hash of the key is stored in the `api_keys` table. The plaintext key is shown once at creation and never again (same pattern as GitHub personal access tokens).

**Authentication flow:**

```
1. External script sends request with Authorization: Bearer ok_<key>
2. Server detects ok_ prefix → hashes the key with SHA-256
3. Looks up hash in api_keys table
4. If found: sets authUser = 'apikey:<id>', records last_used_at
5. Checks scope: read-only keys can only make GET requests
6. Non-GET with read scope → 403
```

**Scopes:**

| Scope | Allowed methods |
|---|---|
| `read` | GET only |
| `read,write` | GET, POST, PATCH, DELETE |

Scope enforcement is applied at the plugin level via `requireWriteScope` preHandler hook, so no individual route changes are needed.

**Management:** API keys are managed from Settings → Security → API Tokens section, or via the `/api/settings/tokens` endpoints.

### Local Development

Skip authentication checks with `AUTH_DISABLED=1`. Only effective when `NODE_ENV=development`.

### Rate Limiting

| Endpoint | Limit |
|---|---|
| `POST /api/login` | 5 req/min |
| `POST /api/auth/setup` | 3 req/min |
| `POST /api/auth/password/change` | 5 req/min |
| `POST /api/auth/email/change` | 5 req/min |
| All other APIs | 100 req/min (global) |

### Security

- No CSRF risk since cookies are not used (tokens are explicitly sent as Authorization headers)
- Write APIs (POST / PATCH / DELETE) require `Content-Type: application/json`; otherwise return `415 Unsupported Media Type`
- XSS protection: React's automatic escaping + Markdown sanitization with DOMPurify
- bcryptjs cost 12 (sufficient computational cost)
- API keys: `ok_` prefix enables secret scanning tools (e.g., GitHub) to detect leaked keys
- API keys: only SHA-256 hashes are stored; plaintext is shown once at creation
- API keys: scope enforcement via HTTP method check at plugin level (read-only keys cannot mutate data)
- API keys: `last_used_at` tracking for audit purposes
