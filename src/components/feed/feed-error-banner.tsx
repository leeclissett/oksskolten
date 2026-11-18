import { useState } from 'react'
import { CheckCircle2, XCircle, Circle, ChevronRight, Search, RefreshCw, Loader2 } from 'lucide-react'
import { useI18n } from '../../lib/i18n'
import { authHeaders } from '../../lib/fetcher'

type Stage = 'discovery' | 'bridge' | 'fetch' | 'parse'

const STAGES: Stage[] = ['discovery', 'bridge', 'fetch', 'parse']

/**
 * Processing phase — drives the animated pipeline visualization.
 * detecting-0/1 correspond to discovery/bridge stages being active.
 */
type Phase = 'idle' | 'detecting-0' | 'detecting-1' | 'fetching' | 'processing'

interface Classification {
  failedStage: Stage
  i18nKey: string
  i18nParams?: Record<string, string>
  actions: Array<'reDetect' | 'fetch'>
}

function classifyError(lastError: string): Classification {
  if (lastError === 'No RSS URL') {
    return { failedStage: 'discovery', i18nKey: 'feedError.noRssUrl', actions: ['reDetect'] }
  }

  if (lastError.includes('CssSelectorBridge')) {
    return { failedStage: 'bridge', i18nKey: 'feedError.cssBridgeFailed', actions: ['reDetect', 'fetch'] }
  }

  if (lastError === 'FlareSolverr failed') {
    return { failedStage: 'fetch', i18nKey: 'feedError.flareSolverrFailed', actions: ['fetch', 'reDetect'] }
  }

  const httpMatch = lastError.match(/HTTP (\d{3})/)
  if (httpMatch) {
    return { failedStage: 'fetch', i18nKey: 'feedError.httpError', i18nParams: { code: httpMatch[1] }, actions: ['fetch'] }
  }

  if (lastError.includes('Could not parse')) {
    return { failedStage: 'parse', i18nKey: 'feedError.parseFailed', actions: ['reDetect'] }
  }

  return { failedStage: 'fetch', i18nKey: 'feedError.unknown', actions: ['fetch'] }
}

type StageStatus = 'passed' | 'failed' | 'active' | 'pending'

function getStageStatus(stageIndex: number, failedIndex: number, phase: Phase): StageStatus {
  if (phase === 'detecting-0') {
    if (stageIndex === 0) return 'active'
    return 'pending'
  }
  if (phase === 'detecting-1') {
    if (stageIndex === 0) return 'passed'
    if (stageIndex === 1) return 'active'
    return 'pending'
  }
  if (phase === 'fetching') {
    if (stageIndex <= 1) return 'passed'
    if (stageIndex === 2) return 'active'
    return 'pending'
  }
  if (phase === 'processing') {
    // All pipeline stages passed; articles are being processed
    if (stageIndex <= 2) return 'passed'
    if (stageIndex === 3) return 'active'
    return 'pending'
  }
  // idle — show error state
  if (stageIndex < failedIndex) return 'passed'
  if (stageIndex === failedIndex) return 'failed'
  return 'pending'
}

/**
 * Call POST /api/feeds/:id/re-detect as SSE stream.
 * Invokes `onStage` when the server reports each detection stage.
 */
function reDetectSSE(
  feedId: number,
  onStage: (stage: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const headers = authHeaders()
    fetch(`/api/feeds/${feedId}/re-detect`, {
      method: 'POST',
      headers: { ...headers },
      signal: AbortSignal.timeout(60_000),
    })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          reject(new Error(`HTTP ${res.status}`))
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          // Parse SSE lines
          const lines = buf.split('\n')
          buf = lines.pop()! // keep incomplete line
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'stage') onStage(data.stage)
            } catch { /* skip malformed SSE JSON lines — non-critical progress updates */ }
          }
        }
        resolve()
      })
      .catch(reject)
  })
}

interface FeedErrorBannerProps {
  lastError: string
  feedId: number
  /** Called after re-detect completes to refresh feed data. */
  onMutate?: () => Promise<void>
  /** Call the fetch API (SSE /api/feeds/:id/fetch). */
  onFetch?: () => Promise<void>
  /** Override phase externally (e.g. to show processing while articles load). */
  overridePhase?: Phase
}

export function FeedErrorBanner({ lastError, feedId, onMutate, onFetch, overridePhase }: FeedErrorBannerProps) {
  const { t } = useI18n()
  const { failedStage, i18nKey, i18nParams, actions } = classifyError(lastError)
  const failedIndex = STAGES.indexOf(failedStage)
  const [internalPhase, setPhase] = useState<Phase>('idle')

  const phase = overridePhase ?? internalPhase
  const busy = phase !== 'idle'

  async function handleReDetect() {
    if (busy) return
    try {
      setPhase('detecting-0')
      await reDetectSSE(feedId, (stage) => {
        if (stage === 'discovery') setPhase('detecting-0')
        else if (stage === 'bridge' || stage === 'bridge-llm') setPhase('detecting-1')
      })
      await onMutate?.()
      if (onFetch) {
        setPhase('fetching')
        await onFetch()
      }
    } catch (err) {
      void err
    } finally {
      setPhase('idle')
    }
  }

  async function handleFetch() {
    if (busy || !onFetch) return
    try {
      setPhase('fetching')
      await onFetch()
    } catch (err) {
      void err
    } finally {
      setPhase('idle')
    }
  }

  return (
    <div className="px-4 md:px-6 py-10 max-w-md mx-auto">
      {/* Pipeline diagram */}
      <div className="border border-border rounded-lg px-4 py-4 mb-6">
        <div className="flex items-center justify-center gap-1">
          {STAGES.map((stage, i) => {
            const status = getStageStatus(i, failedIndex, phase)

            return (
              <div key={stage} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} className="text-muted shrink-0" />}
                <div className="flex flex-col items-center gap-1">
                  {status === 'passed' && <CheckCircle2 size={18} className="text-accent" />}
                  {status === 'failed' && <XCircle size={18} className="text-error" />}
                  {status === 'active' && <Loader2 size={18} className="text-accent animate-spin" />}
                  {status === 'pending' && <Circle size={18} className="text-muted/40" />}
                  <span className={`text-[10px] leading-tight ${
                    status === 'failed' ? 'text-error font-medium'
                      : status === 'active' ? 'text-accent font-medium'
                      : 'text-muted'
                  }`}>
                    {t(`feedError.stage.${stage}` as Parameters<typeof t>[0])}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Explanation text */}
      {phase === 'processing' && (
        <p className="text-muted text-sm leading-relaxed text-center mb-6">
          {t('feedError.processing')}
        </p>
      )}
      {!busy && (
        <p className="text-muted text-sm leading-relaxed text-center mb-6">
          {t(i18nKey as Parameters<typeof t>[0], i18nParams)}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-3">
        {actions.includes('reDetect') && (
          <button
            onClick={handleReDetect}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-accent text-sm hover:underline disabled:opacity-50 disabled:pointer-events-none"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            {t('feedError.reDetect')}
          </button>
        )}
        {actions.includes('fetch') && onFetch && (
          <button
            onClick={handleFetch}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-accent text-sm hover:underline disabled:opacity-50 disabled:pointer-events-none"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {t('feedError.retry')}
          </button>
        )}
      </div>
    </div>
  )
}
