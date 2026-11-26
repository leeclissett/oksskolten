# Oksskolten (leeclissett fork)

A self-hosted feed backend: it fetches feeds, extracts the full text of every article, optionally translates it, and serves the result to native reader apps over a FreshRSS-compatible Google Reader API. A small web UI is kept for managing feeds and settings.

This is a hard fork of [babarot/oksskolten](https://github.com/babarot/oksskolten) that diverged in July 2026. It is not kept in sync with upstream and does not aim to be a full web reader.

## What it does

- **Full-text extraction** — every article is fetched from its source URL and run through Readability plus a noise-removal cleaner, then stored as Markdown
- **Reader API** — FreshRSS-dialect Google Reader API for apps such as Reeder and NetNewsWire, serving the extracted (and translated) article bodies. See [docs/greader-compat.md](docs/greader-compat.md) and [docs/guides/using-google-reader-api.md](docs/guides/using-google-reader-api.md)
- **Translation** — manual per article, or automatic per feed through a serial background queue. Providers: Anthropic, Gemini, OpenAI, Claude Code, Ollama, vLLM, Google Translate, DeepL
- **Smart fetching** — adaptive per-feed scheduling, conditional requests (ETag / Last-Modified), content-hash change detection, exponential backoff, tracking-parameter removal
- **Bot bypass** — optional FlareSolverr fallback for sites behind a JavaScript challenge
- **Clipping and image archiving** — save any URL as an article; optionally archive article images
- **Retention** — optional purge of old read and unread articles
- **Management UI** — add, edit and delete feeds and categories, OPML import and export, read articles, translation and image-storage settings, API tokens

## What was removed from upstream

Chat and the MCP server, article summaries, LLM-inferred CSS selectors, RSS-Bridge, Meilisearch search, similarity detection and scoring, GitHub OAuth and passkeys, the demo build, the PWA and service worker, themes, fonts and custom theme import, the mascot, keyboard navigation and swipe gestures.

Auth is a single password account plus API tokens. The UI follows the system light or dark setting.

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js 22 + Fastify |
| Frontend | React 19 + Vite + Tailwind CSS + shadcn/ui |
| Database | SQLite via libsql (WAL mode) at `/data/rss.db` |
| Extraction | @mozilla/readability + jsdom + turndown, in piscina worker threads |
| Auth | JWT + bcryptjs, API tokens, Reader API ClientLogin |
| Deployment | One container: API, SPA and cron in a single process |

## Development

```bash
docker compose up --build   # HMR enabled
# Frontend: http://localhost:5173
# Backend:  http://localhost:3000

npm run typecheck
npm run lint
npm test                    # needs mise; or: npx vitest run
npm run build
```

On first start in development with an empty database, sample feeds and articles are loaded from `src/lib/demo/seed/*.json`. Set `NO_SEED=1` to skip this.

See [`.env.example`](.env.example) for environment variables. Provider API keys are configured in the settings UI and stored in the database.

## Deployment

Images are built on every push to `main` and published to GHCR, tagged with the short commit SHA:

```bash
docker pull ghcr.io/leeclissett/oksskolten:sha-<commit>
```

The container needs one volume mounted at `/data` and listens on port 3000. Minimal compose service:

```yaml
services:
  oksskolten:
    image: ghcr.io/leeclissett/oksskolten:sha-<commit>
    restart: unless-stopped
    environment:
      NODE_ENV: production
      DATABASE_URL: file:/data/rss.db
    volumes:
      - ./data:/data
    ports:
      - "3000:3000"
```

`compose.yaml` and `compose.prod.yaml` in this repository are the upstream development and Cloudflare Tunnel setups.

## Documentation

Specs live in [docs/spec/](docs/spec/01_overview.md).

## License

[AGPL-3.0](LICENSE)
