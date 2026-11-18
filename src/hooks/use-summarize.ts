import { useState, useEffect, useMemo, useCallback } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { sanitizeHtml } from '../lib/sanitize'
import { useStreamingAI } from './use-streaming-ai'
import type { useMetrics } from './use-metrics'
import type { Article } from '../../shared/types'

const STREAMING_OPTIONS = {
  endpoint: (id: number) => `/api/articles/${id}/summarize?stream=1`,
  fixUnclosedBold: true,
} as const

export function useSummarize(
  article: Pick<Article, 'id' | 'summary'> | undefined,
  metrics: ReturnType<typeof useMetrics>,
) {
  const [summary, setSummary] = useState<string | null>(null)

  useEffect(() => {
    if (article) setSummary(article.summary)
  }, [article])

  const options = useMemo(() => ({
    ...STREAMING_OPTIONS,
    onComplete: (text: string) => setSummary(text),
  }), [])

  const { processing: summarizing, streamingText, streamingHtml, error, run } =
    useStreamingAI(article?.id, metrics, options)

  const handleSummarize = useCallback(() => run(), [run])

  const summaryHtml = useMemo(() => {
    if (!summary) return ''
    const html = renderMarkdown(summary)
    return sanitizeHtml(html)
  }, [summary])

  return { summary, summarizing, streamingText, handleSummarize, summaryHtml, streamingHtml, error }
}
