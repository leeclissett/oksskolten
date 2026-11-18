/**
 * Markdown-safe translation orchestrator.
 *
 * Pipeline: marked() → translate (format:html) → Turndown → MD
 * Uses mature libraries. Same pattern as RSS fetch pipeline.
 */

import { marked } from 'marked'
import TurndownService from 'turndown'
import { fixBoldBoundaries, fixUnpairedEmphasis } from './markdown-to-tagged.js'

// Turndown instance (same config as RSS fetcher in content.ts)
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
turndown.keep(['table', 'thead', 'tbody', 'tr', 'th', 'td'])

export interface TranslateChunkFn {
  (chunk: string): Promise<{ translated: string; characters: number }>
}

export interface TranslateResult {
  translated: string
  characters: number
}

/**
 * High-level orchestrator.
 * Providers only need to supply a chunk-level translation callback.
 */
export async function translateWithProtection(
  text: string,
  maxCharsPerRequest: number,
  translateChunk: TranslateChunkFn,
): Promise<TranslateResult> {
  // Split at Markdown level first, then convert each chunk to HTML
  const mdChunks = splitIntoChunks(text, maxCharsPerRequest)

  const translatedHtmlParts: string[] = []
  let totalCharacters = 0

  for (const mdChunk of mdChunks) {
    const html = await marked(mdChunk)
    const result = await translateChunk(html)
    translatedHtmlParts.push(result.translated)
    totalCharacters += result.characters
  }

  // Clean up common API artifacts before turndown
  let translatedHtml = translatedHtmlParts.join('\n')
  // APIs may insert whitespace between <pre> and <code>, breaking fenced code detection
  translatedHtml = translatedHtml.replace(/<pre>\s*<code/g, '<pre><code')

  // Convert all translated HTML back to Markdown
  let translated = turndown.turndown(translatedHtml)

  // Fix marked rendering issues with CJK punctuation at ** boundaries
  translated = fixBoldBoundaries(translated)
  translated = fixUnpairedEmphasis(translated)

  return { translated, characters: totalCharacters }
}

// ---------------------------------------------------------------------------
// Chunk splitting
// ---------------------------------------------------------------------------

function splitIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]

  const paragraphs = text.split('\n\n')
  const chunks: string[] = []
  let current = ''

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars && current.length > 0) {
      chunks.push(current)
      current = para
    } else {
      current = current ? current + '\n\n' + para : para
    }
  }
  if (current) chunks.push(current)

  return chunks
}
