import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// --- Mocks ---

const mockStreamPost = vi.fn()

vi.mock('../lib/fetcher', () => ({
  streamPost: (...args: unknown[]) => mockStreamPost(...args),
}))

vi.mock('../lib/markdown', () => ({
  renderMarkdown: (text: string) => `<p>${text}</p>`,
}))

vi.mock('../lib/sanitize', () => ({
  sanitizeHtml: (html: string) => html,
}))

function mockMetrics() {
  return {
    metrics: null as { time: number; inputTokens: number; outputTokens: number } | null,
    report: vi.fn(),
    reset: vi.fn(),
    formatMetrics: vi.fn(() => null),
  }
}

import { useSummarize } from './use-summarize'

describe('useSummarize', () => {
  beforeEach(() => {
    mockStreamPost.mockReset()
  })

  it('initializes summary from article.summary', () => {
    const metrics = mockMetrics()
    const { result } = renderHook(() =>
      useSummarize({ id: 1, summary: 'Existing summary' }, metrics),
    )
    expect(result.current.summary).toBe('Existing summary')
  })

  it('renders summaryHtml from summary via markdown + sanitize', () => {
    const metrics = mockMetrics()
    const { result } = renderHook(() =>
      useSummarize({ id: 1, summary: 'Hello **world**' }, metrics),
    )
    expect(result.current.summaryHtml).toBe('<p>Hello **world**</p>')
  })

  it('returns empty summaryHtml when summary is null', () => {
    const metrics = mockMetrics()
    const { result } = renderHook(() =>
      useSummarize({ id: 1, summary: null }, metrics),
    )
    expect(result.current.summaryHtml).toBe('')
  })

  it('uses streamPost for SSE streaming', async () => {
    mockStreamPost.mockImplementation((_url: string, onDelta: (text: string) => void) => {
      onDelta('stream chunk 1')
      onDelta(' chunk 2')
      return Promise.resolve({ usage: { input_tokens: 200, output_tokens: 100 } })
    })

    const metrics = mockMetrics()
    const article = { id: 5, summary: null }
    const { result } = renderHook(() => useSummarize(article, metrics))

    await act(async () => {
      await result.current.handleSummarize()
    })

    expect(mockStreamPost).toHaveBeenCalledWith(
      '/api/articles/5/summarize?stream=1',
      expect.any(Function),
    )
  })

  it('sets final summary on completion', async () => {
    mockStreamPost.mockImplementation((_url: string, onDelta: (text: string) => void) => {
      onDelta('final text')
      return Promise.resolve({ usage: { input_tokens: 10, output_tokens: 5 } })
    })

    const metrics = mockMetrics()
    const article = { id: 1, summary: null }
    const { result } = renderHook(() => useSummarize(article, metrics))

    await act(async () => {
      await result.current.handleSummarize()
    })

    expect(result.current.summary).toBe('final text')
  })

  it('reports metrics when input_tokens > 0', async () => {
    mockStreamPost.mockResolvedValue({ usage: { input_tokens: 300, output_tokens: 150 } })

    const metrics = mockMetrics()
    const article = { id: 1, summary: null }
    const { result } = renderHook(() => useSummarize(article, metrics))

    await act(async () => {
      await result.current.handleSummarize()
    })

    expect(metrics.report).toHaveBeenCalled()
  })

  it('error is handled silently without crashing', async () => {
    mockStreamPost.mockRejectedValue(new Error('Network error'))

    const metrics = mockMetrics()
    const article = { id: 1, summary: null }
    const { result } = renderHook(() => useSummarize(article, metrics))

    await act(async () => {
      await result.current.handleSummarize()
    })

    expect(result.current.summarizing).toBe(false)
  })

  it('streamingHtml closes unclosed bold markers', async () => {
    mockStreamPost.mockImplementation((_url: string, onDelta: (text: string) => void) => {
      onDelta('**bold start')
      return new Promise(() => {}) // never resolves — we check streamingHtml during streaming
    })

    const metrics = mockMetrics()
    const article = { id: 1, summary: null }
    const { result } = renderHook(() => useSummarize(article, metrics))

    act(() => {
      result.current.handleSummarize()
    })

    // Wait for streaming text to be set
    await waitFor(() => {
      expect(result.current.streamingText).toBe('**bold start')
    })

    // streamingHtml should have the unclosed bold marker closed
    // marked.parse will receive '**bold start**' and produce '<p>**bold start**</p>'
    expect(result.current.streamingHtml).toBe('<p>**bold start**</p>')
  })
})
