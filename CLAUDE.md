# Oksskolten

See `README.md` for project overview and `docs/spec/` for detailed specs.

This is a hard fork of `babarot/oksskolten`, reduced to a FreshRSS-dialect Reader API backend with full-text extraction, translation and a small management UI. Chat, MCP, summaries, search, similarity, RSS-Bridge, OAuth/passkeys, the demo build, the PWA, themes and keyboard navigation have been removed — do not reintroduce them.

- The Reader API contract suite (`server/routes/greader.contract.test.ts`) must keep passing unchanged unless a Reader behaviour is changed on purpose.
- Translation (manual and automatic per feed) stays.

## Database

SQLite (libsql, WAL mode) at `./data/rss.db` in development and `/data/rss.db` in the container. The runtime image has no `sqlite3` binary — copy the file out and open the copy.

- **Reads:** `sqlite3 ./data/rss.db` works fine while the server is running (WAL allows concurrent readers).
- **Writes:** Direct sqlite3 CLI writes do not work while the server is running. WAL mode causes the server process to hold the DB connection, so external writes are silently lost. Use API endpoints instead, or add a temporary admin endpoint in `server/routes/admin.ts` for one-off data injection.
- **API keys:** Create from Settings → Security → API Tokens. Use `read,write` scope for mutation endpoints. Example: `curl -H "Authorization: Bearer ok_..." http://localhost:3000/api/...`

## Language

- **Chat:** Respond in the same language the user speaks.
- **Issues, PRs, and commit messages:** Always use English.
