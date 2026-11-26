import { describe, it, expect } from 'vitest'
import { fixBoldBoundaries, fixUnpairedEmphasis } from './markdown-to-tagged.js'

describe('fixBoldBoundaries', () => {
  it('removes bold that wraps only CJK punctuation', () => {
    expect(fixBoldBoundaries('text**。**more')).toBe('text。more')
  })

  it('moves trailing CJK punctuation outside bold', () => {
    expect(fixBoldBoundaries('**スキーマチェック。**')).toBe('**スキーマチェック**。')
  })

  it('moves leading CJK opening punctuation outside bold', () => {
    expect(fixBoldBoundaries('**「おべっか」**')).toBe('「**おべっか**」')
  })

  it('moves bold inside link when ** wraps only a link', () => {
    expect(fixBoldBoundaries('**[GitClear分析](https://example.com)**は')).toBe(
      '[**GitClear分析**](https://example.com)は',
    )
  })

  it('removes empty bold markers', () => {
    expect(fixBoldBoundaries('text****more')).toBe('textmore')
  })

  it('handles multiple CJK punctuation', () => {
    expect(fixBoldBoundaries('**テスト！？**')).toBe('**テスト**！？')
  })
})

describe('fixUnpairedEmphasis', () => {
  it('removes unpaired ** markers', () => {
    expect(fixUnpairedEmphasis('hello ** world')).toBe('hello  world')
  })

  it('preserves paired ** markers', () => {
    expect(fixUnpairedEmphasis('hello **world** end')).toBe('hello **world** end')
  })

  it('works per-line', () => {
    const input = 'line1 **bold**\nline2 ** orphan'
    expect(fixUnpairedEmphasis(input)).toBe('line1 **bold**\nline2  orphan')
  })
})
