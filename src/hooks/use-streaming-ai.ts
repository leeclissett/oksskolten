import { useState, useMemo, useCallback } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { sanitizeHtml } from '../lib/sanitize'
import { streamPost } from '../lib/fetcher'
import type { useMetrics } from './use-metrics'

interface StreamingAIOptions {
  /** Build the API endpoint URL from the article id */
  endpoint: (articleId: number) => string
  /** Called with the final streamed text + raw usage on success */
  onComplete?: (text: string, usage: Record<string, unknown>) => void
  /** Close unclosed markdown bold markers in streaming preview */
  fixUnclosedBold?: boolean
}

export function useStreamingAI(
  articleId: number | undefined,
  metrics: ReturnType<typeof useMetrics>,
  options: StreamingAIOptions,
) {
  const [processing, setProcessing] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    if (articleId == null) return
    setProcessing(true)
    setStreamingText('')
    setError(null)
    metrics.reset()
    const startTime = Date.now()

    try {
      const { usage } = await streamPost(
        options.endpoint(articleId),
        (delta) => setStreamingText(prev => prev + delta),
      )

      const elapsed = (Date.now() - startTime) / 1000

      // Capture the final accumulated text
      setStreamingText(prev => {
        options.onComplete?.(prev, { ...usage, time: elapsed })
        return prev
      })

      if (usage.input_tokens > 0) {
        metrics.report({
          time: elapsed,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          billingMode: usage.billing_mode,
          model: usage.model,
          ...(usage.monthly_chars != null ? { monthlyChars: usage.monthly_chars } : {}),
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProcessing(false)
    }
  }, [articleId, metrics, options])

  const streamingHtml = useMemo(() => {
    if (!streamingText) return ''
    let text = streamingText
    if (options.fixUnclosedBold) {
      const boldCount = (text.match(/\*\*/g) || []).length
      if (boldCount % 2 !== 0) text += '**'
    }
    const html = renderMarkdown(text)
    return sanitizeHtml(html)
  }, [streamingText, options.fixUnclosedBold])

  return { processing, streamingText, streamingHtml, error, run }
}
