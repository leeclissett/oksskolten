---
paths:
  - "src/lib/demo/seed/**"
  - "server/seed.ts"
---

# Dev Seed Data

Seed JSON (`src/lib/demo/seed/*.json`) is the source of the dev database's sample data (the demo SPA that shared it has been removed). No generation step needed — `seedDevData()` reads the JSON directly at startup.

- `seedDevData()` runs when `NODE_ENV=development`, `NO_SEED` is not `1`, and no RSS feeds exist in DB
- Idempotent: skips if feeds already exist, and uses `INSERT OR IGNORE`
- Relative dates in seed JSON (e.g. `-3d`, `-2d23h`) are resolved to absolute ISO 8601 at load time
- Fields in seed JSON not in DB schema (`summary_ja`, `category_name`, `lang` on feeds) are ignored
- To start without seed data: `NO_SEED=1 docker compose up`
