import { getSetting, upsertSetting } from '../../db.js'
import { translateWithProtection } from './markdown-protect.js'

const FREE_TIER_CHARS = 500_000

const API_URL = 'https://translation.googleapis.com/language/translate/v2'
const MAX_CHARS_PER_REQUEST = 30_000

export function requireGoogleTranslateKey(): string {
  const key = getSetting('api_key.google_translate')
  if (!key) {
    const err = new Error('Google Translate API key is not configured')
    ;(err as any).code = 'GOOGLE_TRANSLATE_KEY_NOT_SET'
    throw err
  }
  return key
}

export async function googleTranslate(
  text: string,
  targetLang: string,
): Promise<{ translatedText: string; characters: number; monthlyChars: number }> {
  const apiKey = requireGoogleTranslateKey()

  const { translated, characters } = await translateWithProtection(
    text,
    MAX_CHARS_PER_REQUEST,
    async (chunk) => {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          q: chunk,
          target: targetLang,
          format: 'html',
        }),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Google Translate API error: ${res.status} ${body.slice(0, 200)}`)
      }

      const json = await res.json() as {
        data: { translations: Array<{ translatedText: string }> }
      }

      return { translated: json.data.translations[0].translatedText, characters: chunk.length }
    },
  )

  const monthlyChars = addMonthlyUsage(characters)

  return { translatedText: translated, characters, monthlyChars }
}

/** Track cumulative monthly character usage. Resets when month changes. */
function addMonthlyUsage(chars: number): number {
  const currentMonth = new Date().toISOString().slice(0, 7)
  const storedMonth = getSetting('google_translate.usage_month') || ''
  const storedChars = Number(getSetting('google_translate.usage_chars') || '0')

  let total: number
  if (storedMonth === currentMonth) {
    total = storedChars + chars
  } else {
    total = chars
    upsertSetting('google_translate.usage_month', currentMonth)
  }
  upsertSetting('google_translate.usage_chars', String(total))
  return total
}

/** Get current monthly usage and free tier status */
export function getMonthlyUsage(): { monthlyChars: number; freeTierRemaining: number } {
  const currentMonth = new Date().toISOString().slice(0, 7)
  const storedMonth = getSetting('google_translate.usage_month') || ''
  const monthlyChars = storedMonth === currentMonth
    ? Number(getSetting('google_translate.usage_chars') || '0')
    : 0
  return { monthlyChars, freeTierRemaining: Math.max(0, FREE_TIER_CHARS - monthlyChars) }
}
