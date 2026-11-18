import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

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

import { useStreamingAI } from './use-streaming-ai'

function mockMetrics() {
  return {
    metrics: null as null,
    report: vi.fn(),
    reset: vi.fn(),
    formatMetrics: vi.fn(() => null),
  }
}

const defaultOptions = {
  endpoint: (id: number) => `/api/articles/${id}/test?stream=1`,
}

describe('useStreamingAI', () => {
  beforeEach(() => {
    mockStreamPost.mockReset()
  })

  it('starts in idle state', () => {
    const metrics = mockMetrics()
    const { result } = renderHook(() => useStreamingAI(1, metrics, defaultOptions))
    expect(result.current.processing).toBe(false)
    expect(result.current.streamingText).toBe('')
    expect(result.current.error).toBe(null)
  })

  it('does nothing when articleId is undefined', async () => {
    const metrics = mockMetrics()
    const { result } = renderHook(() => useStreamingAI(undefined, metrics, defaultOptions))
    await act(async () => { await result.current.run() })
    expect(mockStreamPost).not.toHaveBeenCalled()
  })

  it('calls streamPost with correct endpoint', async () => {
    mockStreamPost.mockResolvedValue({ usage: { input_tokens: 0, output_tokens: 0 } })
    const metrics = mockMetrics()
    const { result } = renderHook(() => useStreamingAI(42, metrics, defaultOptions))

    await act(async () => { await result.current.run() })

    expect(mockStreamPost).toHaveBeenCalledWith(
      '/api/articles/42/test?stream=1',
      expect.any(Function),
    )
  })

  it('reports metrics when input_tokens > 0', async () => {
    mockStreamPost.mockResolvedValue({
      usage: { input_tokens: 100, output_tokens: 50, billing_mode: 'api', model: 'haiku' },
    })
    const metrics = mockMetrics()
    const { result } = renderHook(() => useStreamingAI(1, metrics, defaultOptions))

    await act(async () => { await result.current.run() })

    expect(metrics.report).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 100, outputTokens: 50 }),
    )
  })

  it('skips metrics when input_tokens is 0', async () => {
    mockStreamPost.mockResolvedValue({ usage: { input_tokens: 0, output_tokens: 0 } })
    const metrics = mockMetrics()
    const { result } = renderHook(() => useStreamingAI(1, metrics, defaultOptions))

    await act(async () => { await result.current.run() })

    expect(metrics.report).not.toHaveBeenCalled()
  })

  it('handles errors gracefully', async () => {
    mockStreamPost.mockRejectedValue(new Error('fail'))
    const metrics = mockMetrics()
    const { result } = renderHook(() => useStreamingAI(1, metrics, defaultOptions))

    await act(async () => { await result.current.run() })

    expect(result.current.processing).toBe(false)
    expect(result.current.error).toBe('fail')
  })

  it('calls onComplete with final text', async () => {
    mockStreamPost.mockImplementation((_url: string, onDelta: (t: string) => void) => {
      onDelta('hello')
      return Promise.resolve({ usage: { input_tokens: 1, output_tokens: 1, billing_mode: 'api', model: 'h' } })
    })
    const onComplete = vi.fn()
    const metrics = mockMetrics()
    const opts = { ...defaultOptions, onComplete }
    const { result } = renderHook(() => useStreamingAI(1, metrics, opts))

    await act(async () => { await result.current.run() })

    expect(onComplete).toHaveBeenCalledWith('hello', expect.objectContaining({ input_tokens: 1 }))
  })

  it('fixes unclosed bold markers when fixUnclosedBold is true', async () => {
    mockStreamPost.mockImplementation((_url: string, onDelta: (t: string) => void) => {
      onDelta('**bold')
      return new Promise(() => {}) // never resolves
    })
    const metrics = mockMetrics()
    const opts = { ...defaultOptions, fixUnclosedBold: true }
    const { result } = renderHook(() => useStreamingAI(1, metrics, opts))

    act(() => { result.current.run() })

    // Wait for streaming text
    await vi.waitFor(() => {
      expect(result.current.streamingText).toBe('**bold')
    })

    // Bold should be closed: '**bold**'
    expect(result.current.streamingHtml).toBe('<p>**bold**</p>')
  })
})
