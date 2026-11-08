import { detectAll } from 'tinyld'

const LANGUAGE_ALIASES: Record<string, string> = {
  eng: 'en',
  nld: 'nl',
  dut: 'nl',
  jpn: 'ja',
  zho: 'zh',
  chi: 'zh',
}

export function normalizeLanguageCode(language: string | null | undefined): string | null {
  if (!language) return null
  const code = language.trim().toLowerCase().split(/[-_]/)[0]
  if (!code) return null
  if (/^[a-z]{2}$/.test(code)) return code
  return LANGUAGE_ALIASES[code] ?? null
}

/**
 * Detect article language locally. `und` is deliberately returned for text
 * that is too short or ambiguous, because an uncertain guess must not spend
 * translation tokens automatically. Feed metadata is used as a fallback.
 */
export function detectLanguage(fullText: string, languageHint?: string | null): string {
  const hint = normalizeLanguageCode(languageHint)
  const sample = fullText
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12_000)

  if (sample.length < 20) return hint ?? 'und'

  const results = detectAll(sample)
  const top = results[0]
  if (!top) return hint ?? 'und'
  const runnerUp = results[1]
  const margin = top.accuracy - (runnerUp?.accuracy ?? 0)
  if (top.accuracy < 0.2 && margin < 0.05) return hint ?? 'und'

  return normalizeLanguageCode(top.lang) ?? hint ?? 'und'
}
