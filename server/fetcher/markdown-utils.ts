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

const FIRST_STYLE_RE = /<style[^>]*>([\s\S]*?)<\/style>/gi
const FINGERPRINT_LENGTH = 80
const MIN_FINGERPRINT_LENGTH = 20

/** Drop whitespace and Markdown escape backslashes so CSS compares equal before and after Turndown. */
function squash(text: string): string {
  return text.replace(/[\s\\]/g, '')
}

/**
 * True when `markdown` contains the stylesheet of the HTML document it was
 * converted from. That is the signature of an article stored by the old
 * inline-content path, which ran whole HTML emails through a bare Turndown
 * and so printed the <style> block into the body.
 */
export function containsStyleSheetDump(markdown: string, html: string): boolean {
  FIRST_STYLE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FIRST_STYLE_RE.exec(html))) {
    const fingerprint = squash(match[1]).slice(0, FINGERPRINT_LENGTH)
    if (fingerprint.length < MIN_FINGERPRINT_LENGTH) continue
    return squash(markdown).includes(fingerprint)
  }
  return false
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
