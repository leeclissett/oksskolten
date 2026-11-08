import { describe, it, expect } from 'vitest'
import { detectLanguage } from './language.js'

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------
describe('detectLanguage', () => {
  it('returns "ja" for Japanese text', () => {
    expect(detectLanguage('これは日本語のテキストです。テストのために書いています。')).toBe('ja')
  })

  it('returns "en" for English text', () => {
    expect(detectLanguage('This is an English text written for testing purposes.')).toBe('en')
  })

  it('returns "und" for empty text rather than guessing English', () => {
    expect(detectLanguage('')).toBe('und')
  })

  it('detects Dutch text', () => {
    const text = 'Dit is een Nederlands nieuwsartikel over technologie en wetenschap. De regering heeft vandaag nieuwe maatregelen aangekondigd.'
    expect(detectLanguage(text)).toBe('nl')
  })

  it('uses a normalized feed-language hint for short text', () => {
    expect(detectLanguage('Kort bericht', 'nl-NL')).toBe('nl')
  })

  it('does not let a hint override confident local detection', () => {
    const text = 'This is a complete English article with enough words for reliable local language detection and classification.'
    expect(detectLanguage(text, 'nl')).toBe('en')
  })

  it('detects kanji-heavy text as Japanese', () => {
    expect(detectLanguage('東京都渋谷区で開催されたイベントに参加しました')).toBe('ja')
  })

  it('detects katakana-heavy text as Japanese', () => {
    expect(detectLanguage('プログラミングのテストケースをチェックする')).toBe('ja')
  })
})
