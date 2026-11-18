import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMetrics } from './use-metrics'

describe('useMetrics', () => {
  it('initializes with null', () => {
    const { result } = renderHook(() => useMetrics())
    expect(result.current.metrics).toBeNull()
  })

  it('report() sets metrics', () => {
    const { result } = renderHook(() => useMetrics())
    const m = { time: 1.5, inputTokens: 100, outputTokens: 50 }

    act(() => result.current.report(m))
    expect(result.current.metrics).toEqual(m)
  })

  it('reset() clears metrics to null', () => {
    const { result } = renderHook(() => useMetrics())

    act(() => result.current.report({ time: 1, inputTokens: 10, outputTokens: 5 }))
    act(() => result.current.reset())
    expect(result.current.metrics).toBeNull()
  })

  it('report() overwrites previous metrics', () => {
    const { result } = renderHook(() => useMetrics())

    act(() => result.current.report({ time: 1, inputTokens: 10, outputTokens: 5 }))
    const updated = { time: 2, inputTokens: 200, outputTokens: 100 }
    act(() => result.current.report(updated))
    expect(result.current.metrics).toEqual(updated)
  })

  describe('formatMetrics', () => {
    it('returns null when no metrics', () => {
      const { result } = renderHook(() => useMetrics())
      expect(result.current.formatMetrics()).toBeNull()
    })

    it('formats Anthropic model with cost', () => {
      const { result } = renderHook(() => useMetrics())
      act(() => result.current.report({
        time: 2.5,
        inputTokens: 1000,
        outputTokens: 500,
        billingMode: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
      }))

      const text = result.current.formatMetrics()!
      expect(text).toContain('Haiku 4.5')
      expect(text).toContain('2.5s')
      expect(text).toContain('1,000 input')
      expect(text).toContain('500 output')
      expect(text).toContain('$')
    })

    it('formats claude-code billing mode', () => {
      const { result } = renderHook(() => useMetrics())
      act(() => result.current.report({
        time: 1.0,
        inputTokens: 100,
        outputTokens: 50,
        billingMode: 'claude-code',
        model: 'claude-haiku-4-5-20251001',
      }))

      const text = result.current.formatMetrics()!
      expect(text).toContain('Haiku 4.5')
      // Should contain the claude-code usage message instead of cost
      expect(text).not.toContain('$')
    })

    it('formats google-translate within free tier', () => {
      const { result } = renderHook(() => useMetrics())
      act(() => result.current.report({
        time: 0.5,
        inputTokens: 200,
        outputTokens: 0,
        billingMode: 'google-translate',
        monthlyChars: 100_000,
      }))

      const text = result.current.formatMetrics()!
      expect(text).toContain('Google Translate')
      expect(text).toContain('0.5s')
      expect(text).toContain('200 chars')
      expect(text).toContain('100K / 500K')
    })

    it('formats google-translate exceeding free tier', () => {
      const { result } = renderHook(() => useMetrics())
      act(() => result.current.report({
        time: 0.8,
        inputTokens: 5000,
        outputTokens: 0,
        billingMode: 'google-translate',
        monthlyChars: 600_000,
      }))

      const text = result.current.formatMetrics()!
      expect(text).toContain('Google Translate')
      expect(text).toContain('$')
      expect(text).not.toContain('500K')
    })

    it('formats deepl within free tier', () => {
      const { result } = renderHook(() => useMetrics())
      act(() => result.current.report({
        time: 0.3,
        inputTokens: 300,
        outputTokens: 0,
        billingMode: 'deepl',
        monthlyChars: 200_000,
      }))

      const text = result.current.formatMetrics()!
      expect(text).toContain('DeepL')
      expect(text).toContain('300 chars')
      expect(text).toContain('200K / 500K')
    })

    it('formats deepl exceeding free tier with yen', () => {
      const { result } = renderHook(() => useMetrics())
      act(() => result.current.report({
        time: 0.4,
        inputTokens: 1000,
        outputTokens: 0,
        billingMode: 'deepl',
        monthlyChars: 600_000,
      }))

      const text = result.current.formatMetrics()!
      expect(text).toContain('DeepL')
      expect(text).toContain('¥')
    })

    it('uses fallback pricing for unknown model', () => {
      const { result } = renderHook(() => useMetrics())
      act(() => result.current.report({
        time: 1.0,
        inputTokens: 1000,
        outputTokens: 200,
        model: 'unknown-model-xyz',
      }))

      const text = result.current.formatMetrics()!
      // Falls back to [1, 5] pricing: (1000*1 + 200*5) / 1_000_000
      expect(text).toContain('unknown-model-xyz')
      expect(text).toContain('$0.0020')
    })

    it('uses empty string model when none provided', () => {
      const { result } = renderHook(() => useMetrics())
      act(() => result.current.report({
        time: 1.0,
        inputTokens: 500,
        outputTokens: 100,
      }))

      const text = result.current.formatMetrics()!
      expect(text).toContain('1.0s')
      expect(text).toContain('$')
    })
  })
})
