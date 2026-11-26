---
paths:
  - "docs/guides/**"
---

# Guide Naming Rules

Guide filenames must be kebab-case and start with a gerund (verb ending in `-ing`):

```
docs/guides/using-google-reader-api.md ✓
docs/guides/deploying-to-fly-io.md ✓
docs/guides/setup-guide.md         ✗ (no gerund)
docs/guides/using_reader_api.md    ✗ (snake_case)
```

- **Filename**: `{verbing}-{object}.md` (e.g., `using-google-reader-api.md`)
- **H1 first word** must match the filename's first segment (e.g., `using-google-reader-api.md` → `# Using ...`)
