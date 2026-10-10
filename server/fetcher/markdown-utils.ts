import TurndownService from 'turndown'

// Lightweight Turndown instance for converting RSS HTML excerpts to Markdown.
// Unlike the worker-thread instance in contentWorker.ts, this skips custom rules
// (barePreBlock, table keep) because RSS descriptions are simple HTML fragments.
const fallbackTurndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
// Turndown emits the text of unknown elements, so a full HTML document (e.g. a
// newsletter email relayed through a feed) would otherwise leak its <title>
// and the entire <style> sheet into the article body.
fallbackTurndown.remove(['style', 'script', 'title', 'noscript'])

/** Check if a string contains HTML tags (not just plain text or Markdown). */
const HTML_TAG_RE = /<[a-zA-Z][^>]*>/

/**
 * Convert RSS feed content to Markdown for use as article full_text.
 * Detects whether the input is HTML, Markdown/plain text, and only applies
 * Turndown conversion for HTML. Plain text and Markdown are returned as-is
 * because Turndown would mangle them (escaping Markdown syntax, collapsing newlines).
 */
export function convertHtmlToMarkdown(content: string): string {
  if (!HTML_TAG_RE.test(content)) return content
  // Removed elements leave their surrounding whitespace behind.
  return fallbackTurndown.turndown(content).trim()
}

/**
 * Generate a plain-text excerpt from Markdown by stripping images and links.
 * Used by both contentWorker (page extraction) and fetcher (RSS fallback).
 */
export function markdownToExcerpt(md: string, maxLen = 200): string | null {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')        // strip ![alt](url)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')     // [text](url) → text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
    .trim() || null
}
