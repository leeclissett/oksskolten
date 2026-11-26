# Oksskolten Spec — Architecture

> [Back to Overview](./01_overview.md)

## System Overview

```mermaid
graph TD
    subgraph host["Docker Host"]
        subgraph app["oksskolten (Node.js 22, port 3000)"]
            fastify["Fastify API<br/>/api/* + Reader API"]
            spa["SPA static serving<br/>(Vite build)"]
            sqlite["SQLite<br/>(WAL mode)"]
            cron["node-cron<br/>Feed fetch every 5 min"]
            fetcher["Fetcher Pipeline<br/>RSS parse → Readability<br/>→ HTML cleaner → Markdown"]
            ai["Translation providers<br/>LLM / Google Translate / DeepL"]
            tworker["Translation worker<br/>(serial queue)"]

            fastify --> sqlite
            fastify --- spa
            fastify --> fetcher
            fastify --> ai
            cron --> fetcher
            cron --> tworker
            tworker --> ai
            fetcher --> sqlite
        end

        flare["FlareSolverr (optional)<br/>(Docker, port 8191)"]
    end

    client(("Reader app /<br/>browser")) -- "HTTPS via reverse proxy" --> fastify
    cron -- "HTTP fetch" --> rss(("RSS Feeds"))
    fetcher --> flare
    ai -- "API" --> llm_api(("Provider API"))
```

## Data Flow

### Article Ingestion (Cron: every 5 min)

```
1. Fetch enabled RSS feeds from the feeds table (disabled=0, type='rss')
2. Fetch & parse RSS/Atom/RDF (feedsmith → fast-xml-parser fallback)
   └─ Sites requiring bot auth → via FlareSolverr
3. For each new article (semaphore: 5 concurrent):
   a. Fetch HTML → DOM parsing in Worker Thread (pre-clean → Readability → post-clean → Markdown)
   b. Extract OGP image & excerpt
   c. Language detection (CJK character ratio, local processing)
   d. INSERT into SQLite (on failure: record last_error, retry next cycle)
4. 5 consecutive failures → auto-disable feed (disabled=1)
```

### Article Viewing (On-demand)

```
1. User opens article → GET /api/articles/by-url
2. "Translate" → POST /api/articles/:id/translate (SSE streaming)
   └─ LLM, Google Translate or DeepL → cached in full_text_translated
3. Subsequent requests return from cache (no API calls)
```

Reader apps do not use these endpoints: they sync through the Reader API (see `docs/greader-compat.md`), which serves the stored (and, where present, translated) article body.

### Authentication

```
Web UI and /api/*:
├─ Password: bcryptjs + JWT (30-day expiry)
└─ API tokens (ok_ prefix, read or read,write scope)
Reader API: ClientLogin with the same account
```

## Why This Architecture

Oksskolten is designed with the top priority of "just works with `docker compose up`". No external database, no external queue service, no external cron service. Everything fits in a single container.

### Why SQLite

We chose SQLite over PostgreSQL or MySQL.

- **Zero external dependencies**: No database server to start or manage. A single file is the entire database
- **Easy backups**: Just copy `data/rss.db`. No need for tools like `pg_dump`
- **Sufficient performance**: SQLite's WAL mode handles read/write performance without issues for a personal/small-team RSS reader
- **Easy migration**: SQLite files can be moved directly to another machine

### Why a Single Container

API server, SPA serving, and cron jobs coexist in a single process.

- **Single docker compose service**: A multi-container setup like `web` + `db` + `worker` is overkill for a personal tool
- **No IPC needed**: Cron jobs write directly to the DB. No message queues or worker processes in between
- **Low resource consumption**: Runs on low-spec environments like NAS, VPS, or Raspberry Pi
- **Worker Threads protect the event loop**: jsdom + Readability used in cron article fetching are CPU-intensive synchronous operations, but they run in a piscina Worker Thread pool (max 2 threads), so the API event loop is never blocked

### Why React SPA

We chose React SPA (Vite build) over Next.js or Remix.

- **Minimal server dependency**: Just serve pre-built static files. No frontend runtime needed on the server
- **Easy to fork**: Users who want a different frontend can use the API and build their own UI
- **No SSR needed**: A login-required personal tool has no SEO requirements. SPA is sufficient

### Alternatives Considered

| Architecture | Why Not |
|---|---|
| Vercel + Serverless | Can't use SQLite. Adds external DB dependency, losing the simplicity of self-hosting |
| Edge (Cloudflare Workers, etc.) | Can't have persistent processes, so cron won't work. API execution time limits conflict with translation |
| Next.js / Remix | Overkill for a personal tool that doesn't need SSR. Vercel-centric design philosophy doesn't align well with self-hosting |
| htmx | UI complexity (context menus, infinite scroll, streaming display) exceeds htmx's sweet spot |
| Microservices / Queue | Distributed systems are overkill for a personal RSS reader. A single process is simpler to operate and debug |
