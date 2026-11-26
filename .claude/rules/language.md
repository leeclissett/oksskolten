---
paths:
  - "src/**"
  - "server/**"
---

# Language Rules

- Source code, comments, log output, and error messages must all be written in **English**
- User-visible text requiring i18n: register in `src/lib/i18n.ts` dictionary and reference via `t()`.
- Date/time formatting: use `Intl.RelativeTimeFormat` / `Intl.DateTimeFormat` with locale, never hardcode
- Multilingual boilerplate patterns for web scraping (e.g. "Read more"): centralize in `server/lib/cleaner/boilerplate-text.ts`, never inline
- AI prompts: write in English, include response language instruction (`Respond in the user's language` etc.) within the prompt

## Files Allowed to Contain Non-English Text

These files may contain Japanese or other non-English text by nature. Do not hardcode non-English text in source files outside this list.

- `src/lib/i18n.ts` — UI i18n dictionary (`ja` / `en` translation pairs)
- `server/lib/cleaner/boilerplate-text.ts` — Multilingual boilerplate patterns for scraping
- `server/providers/translate/markdown-to-tagged.ts` — CJK punctuation character set definitions
- `src/lib/demo/seed/*.json` — Dev seed data
- `*.test.ts` — Test data and fixtures
