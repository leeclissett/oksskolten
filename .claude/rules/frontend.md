---
paths:
  - "src/**"
---

# Frontend: Colors

There is one palette with a light and a dark variant, defined as CSS custom properties in `src/index.css` (`:root` and `.dark`). The `.dark` class follows the system color scheme. The theme system was removed from this fork.

- Never use raw colors (`text-gray-500`, `bg-white`, `#ccc`, etc.) — use the color tokens (`text-text`, `text-muted`, `bg-bg-card`, `border-border`, `text-accent`, etc.)
- Do not change color values or add new tokens without user approval

# Frontend: Z-Index Scale

Floating UI elements use Portal to `<body>` and are layered by z-index. Follow this scale:

```
z-30   header
z-40   sidebar overlay
z-50   tooltip, dropdown, sidebar, popover
z-60   context-menu
z-70   dialog / modal (overlay & content)
z-80   floating UI inside dialogs (select, popover, etc.)
z-100  image lightbox
```

- When adding a new floating element, pick from this scale — do not invent arbitrary values
- To fix stacking issues between portaled elements (e.g. Select inside Dialog), adjust z-index in the base UI component (`src/components/ui/`), not at each call site
- Do NOT portal floating elements into dialog containers to fix stacking — keep all portals targeting `<body>` and control layering via z-index. Portaling into dialogs causes overflow clipping issues and requires ref plumbing that silently breaks when forgotten
