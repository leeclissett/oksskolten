import { useState, useCallback } from 'react'
import { useI18n } from '../lib/i18n'
import { getModelLabel, getModelPricing } from '../../shared/models'

export interface Metrics {
  time: number
  inputTokens: number
  outputTokens: number
  billingMode?: 'anthropic' | 'gemini' | 'openai' | 'claude-code' | 'google-translate' | 'deepl'
  model?: string
  monthlyChars?: number
}

export function useMetrics() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const { t } = useI18n()

  const report = useCallback((m: Metrics) => {
    setMetrics(m)
  }, [])

  const reset = useCallback(() => {
    setMetrics(null)
  }, [])

  const formatMetrics = useCallback(() => {
    if (!metrics) return null
    const modelId = metrics.model ?? ''
    const modelLabel = getModelLabel(modelId) ?? modelId
    const base = `${modelLabel} · ${metrics.time.toFixed(1)}s · ${metrics.inputTokens.toLocaleString()} input · ${metrics.outputTokens.toLocaleString()} output`
    if (metrics.billingMode === 'claude-code') {
      return `${base} · ${t('article.claudeCodeUsage')}`
    }
    if (metrics.billingMode === 'google-translate') {
      const monthly = metrics.monthlyChars ?? 0
      const freeTier = 500_000
      const gtBase = `Google Translate · ${metrics.time.toFixed(1)}s · ${metrics.inputTokens.toLocaleString()} chars`
      if (monthly <= freeTier) {
        return `${gtBase} · ${t('article.freeTier')} (${(monthly / 1000).toFixed(0)}K / 500K)`
      }
      const cost = metrics.inputTokens * 20 / 1_000_000
      return `${gtBase} · ~$${cost.toFixed(4)}`
    }
    if (metrics.billingMode === 'deepl') {
      const monthly = metrics.monthlyChars ?? 0
      const freeTier = 500_000
      const dlBase = `DeepL · ${metrics.time.toFixed(1)}s · ${metrics.inputTokens.toLocaleString()} chars`
      if (monthly <= freeTier) {
        return `${dlBase} · ${t('article.freeTier')} (${(monthly / 1000).toFixed(0)}K / 500K)`
      }
      const cost = metrics.inputTokens * 2500 / 1_000_000
      return `${dlBase} · ~¥${cost.toFixed(1)}`
    }
    const [inputRate, outputRate] = getModelPricing(modelId) ?? [1, 5]
    const cost = (metrics.inputTokens * inputRate + metrics.outputTokens * outputRate) / 1_000_000
    return `${base} · ~$${cost.toFixed(4)}`
  }, [metrics, t])

  return { metrics, report, reset, formatMetrics }
}
