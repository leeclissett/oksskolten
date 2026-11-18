import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Callout } from '../ui/callout'
import { Skeleton } from '../ui/skeleton'
import { SanitizedHTML } from '../ui/sanitized-html'
import { useI18n } from '../../lib/i18n'

interface ArticleSummarySectionProps {
  summary: string | null
  summarizing: boolean
  streamingText: string
  summaryHtml: string
  streamingHtml: string
  summarizeError: string | null
  metricsText: string | null
}

export function ArticleSummarySection({
  summary,
  summarizing,
  streamingText,
  summaryHtml,
  streamingHtml,
  summarizeError,
  metricsText,
}: ArticleSummarySectionProps) {
  const { t, tError, isKeyNotSetError } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const wasSummarizingRef = useRef(false)

  // Auto-expand summary when summarization just completed
  useEffect(() => {
    if (wasSummarizingRef.current && !summarizing && summary !== null) {
      setExpanded(true)
    }
    wasSummarizingRef.current = summarizing
  }, [summarizing, summary])

  return (
    <>
      {/* Streaming */}
      {summarizing && streamingText && (
        <Callout>
          <SanitizedHTML html={streamingHtml} className="prose prose-sm" />
        </Callout>
      )}

      {/* Skeleton while waiting for first token */}
      {summarizing && !streamingText && (
        <Callout>
          <Skeleton className="h-4 w-3/4 mb-2" />
          <Skeleton className="h-4 w-1/2" />
        </Callout>
      )}

      {/* Final summary */}
      {summary !== null && !summarizing && (() => {
        const CLAMP_THRESHOLD = 200
        const needsClamp = summary.length > CLAMP_THRESHOLD
        return (
          <Callout>
            <SanitizedHTML
              html={summaryHtml}
              className={`prose prose-sm ${needsClamp && !expanded ? 'line-clamp-4' : ''}`}
            />
            {needsClamp && (
              <button
                type="button"
                onClick={() => setExpanded(prev => !prev)}
                className="text-xs text-accent hover:underline mt-2 select-none"
              >
                {expanded ? t('article.showLess') : t('article.readMore')}
              </button>
            )}
            {metricsText && (
              <p className="text-xs text-muted mt-3">{metricsText}</p>
            )}
          </Callout>
        )
      })()}

      {/* Error */}
      {summarizeError && !summarizing && (
        <Callout variant="error">
          <p className="text-sm text-error">
            {tError(summarizeError)}
            {isKeyNotSetError(summarizeError) && (
              <>
                <Link to="/settings/integration" className="underline text-accent">{t('error.goToSettings')}</Link>
                {t('error.setApiKeyFromSettings')}
              </>
            )}
          </p>
        </Callout>
      )}
    </>
  )
}
