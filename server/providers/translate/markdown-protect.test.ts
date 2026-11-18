import { describe, it, expect, vi } from 'vitest'
import { translateWithProtection, type TranslateChunkFn } from './markdown-protect.js'

/** Mock translator that returns the HTML as-is (identity translation). */
const identityTranslate: TranslateChunkFn = async (chunk) => ({
  translated: chunk,
  characters: chunk.length,
})

/** Mock translator that uppercases text content while preserving HTML tags. */
const upperTranslate: TranslateChunkFn = async (chunk) => ({
  translated: chunk.replace(/>([^<]+)</g, (_m, text) => `>${text.toUpperCase()}<`),
  characters: chunk.length,
})

// ---------------------------------------------------------------------------
// splitIntoChunks (tested indirectly via translateWithProtection)
// ---------------------------------------------------------------------------

describe('chunk splitting', () => {
  it('does not split short text', async () => {
    const translate = vi.fn(identityTranslate)
    await translateWithProtection('Short text', 1000, translate)
    expect(translate).toHaveBeenCalledTimes(1)
  })

  it('splits text at paragraph boundaries', async () => {
    const para1 = 'First paragraph. '.repeat(10).trim()
    const para2 = 'Second paragraph. '.repeat(10).trim()
    const text = `${para1}\n\n${para2}`

    const translate = vi.fn(identityTranslate)
    // maxChars smaller than full text but larger than one paragraph
    await translateWithProtection(text, para1.length + 10, translate)
    expect(translate).toHaveBeenCalledTimes(2)
  })

  it('keeps paragraph intact when it exceeds maxChars', async () => {
    const longParagraph = 'word '.repeat(200).trim()
    const translate = vi.fn(identityTranslate)
    // maxChars much smaller than paragraph — can't split within paragraph
    await translateWithProtection(longParagraph, 50, translate)
    // Still one chunk since there's no \n\n to split on
    expect(translate).toHaveBeenCalledTimes(1)
  })

  it('handles empty text', async () => {
    const result = await translateWithProtection('', 1000, identityTranslate)
    expect(result.translated).toBe('')
    expect(result.characters).toBe(0)
  })

  it('accumulates characters across chunks', async () => {
    const text = 'Chunk A\n\nChunk B\n\nChunk C'
    const translate: TranslateChunkFn = async (chunk) => ({
      translated: chunk,
      characters: 100,
    })

    const result = await translateWithProtection(text, 10, translate)
    expect(result.characters).toBe(300)
  })
})

// ---------------------------------------------------------------------------
// Markdown → HTML → translate → HTML → Markdown roundtrip
// ---------------------------------------------------------------------------

describe('roundtrip integrity', () => {
  it('preserves headings', async () => {
    const md = '## Heading Two\n\nSome paragraph text.'
    const result = await translateWithProtection(md, 5000, identityTranslate)
    expect(result.translated).toContain('## Heading Two')
  })

  it('preserves links', async () => {
    const md = 'Check [this link](https://example.com) for details.'
    const result = await translateWithProtection(md, 5000, identityTranslate)
    expect(result.translated).toContain('[this link](https://example.com)')
  })

  it('preserves inline code', async () => {
    const md = 'Use `console.log()` for debugging.'
    const result = await translateWithProtection(md, 5000, identityTranslate)
    expect(result.translated).toContain('`console.log()`')
  })

  it('preserves fenced code blocks', async () => {
    const md = '```js\nconst x = 1;\n```\n\nAfter code.'
    const result = await translateWithProtection(md, 5000, identityTranslate)
    expect(result.translated).toContain('const x = 1;')
    expect(result.translated).toContain('```')
  })

  it('preserves bold text', async () => {
    const md = 'This is **bold** text.'
    const result = await translateWithProtection(md, 5000, identityTranslate)
    expect(result.translated).toContain('**bold**')
  })

  it('preserves italic text', async () => {
    const md = 'This is *italic* text.'
    const result = await translateWithProtection(md, 5000, identityTranslate)
    // Turndown uses _ for emphasis by default
    expect(result.translated).toMatch(/[*_]italic[*_]/)
  })

  it('preserves unordered lists', async () => {
    const md = '- Item one\n- Item two\n- Item three'
    const result = await translateWithProtection(md, 5000, identityTranslate)
    expect(result.translated).toContain('Item one')
    expect(result.translated).toContain('Item two')
  })
})

// ---------------------------------------------------------------------------
// <pre><code> whitespace fix
// ---------------------------------------------------------------------------

describe('pre/code whitespace fix', () => {
  it('removes whitespace between pre and code tags', async () => {
    // Simulate a translator that inserts whitespace
    const translate: TranslateChunkFn = async (chunk) => ({
      translated: chunk.replace(/<pre><code/g, '<pre>  <code'),
      characters: chunk.length,
    })

    const md = '```\ncode here\n```'
    const result = await translateWithProtection(md, 5000, translate)
    // Should still produce a proper code block after turndown
    expect(result.translated).toContain('code here')
  })
})

// ---------------------------------------------------------------------------
// Multi-chunk join
// ---------------------------------------------------------------------------

describe('multi-chunk translation', () => {
  it('joins translated chunks into coherent markdown', async () => {
    const para1 = 'First paragraph with enough text.'
    const para2 = 'Second paragraph with enough text.'
    const text = `${para1}\n\n${para2}`

    const result = await translateWithProtection(text, para1.length + 5, upperTranslate)
    expect(result.translated).toContain('FIRST PARAGRAPH')
    expect(result.translated).toContain('SECOND PARAGRAPH')
  })
})

// ---------------------------------------------------------------------------
// fixBoldBoundaries / fixUnpairedEmphasis integration
// ---------------------------------------------------------------------------

describe('CJK bold boundary fixes', () => {
  it('moves trailing CJK punctuation outside bold', async () => {
    // Simulate translator returning bold with trailing CJK punct
    const translate: TranslateChunkFn = async () => ({
      translated: '<p><strong>テスト。</strong></p>',
      characters: 10,
    })

    const result = await translateWithProtection('test', 5000, translate)
    // Should be **テスト**。 not **テスト。**
    expect(result.translated).toContain('**テスト**。')
  })

  it('removes bold that wraps only punctuation', async () => {
    const translate: TranslateChunkFn = async () => ({
      translated: '<p><strong>。</strong></p>',
      characters: 5,
    })

    const result = await translateWithProtection('test', 5000, translate)
    expect(result.translated).not.toContain('**。**')
    expect(result.translated).toContain('。')
  })

  it('fixes unpaired bold markers', async () => {
    const translate: TranslateChunkFn = async () => ({
      translated: '<p>text <strong>orphan</p>',
      characters: 10,
    })

    const result = await translateWithProtection('test', 5000, translate)
    // Turndown produces **orphan, fixUnpairedEmphasis removes the unpaired **
    const boldCount = (result.translated.match(/\*\*/g) || []).length
    expect(boldCount % 2).toBe(0)
  })
})
