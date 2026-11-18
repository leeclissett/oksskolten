import { getSetting, upsertSetting } from '../../db.js'
import { translateWithProtection } from './markdown-protect.js'

const FREE_TIER_CHARS = 500_000

const API_URL_FREE = 'https://api-free.deepl.com/v2/translate'
const API_URL_PRO = 'https://api.deepl.com/v2/translate'
const MAX_CHARS_PER_REQUEST = 50_000

export function requireDeeplKey(): string {
  const key = getSetting('api_key.deepl')
  if (!key) {
    const err = new Error('DeepL API key is not configured')
    ;(err as any).code = 'DEEPL_KEY_NOT_SET'
    throw err
  }
  return key
}

function getApiUrl(apiKey: string): string {
  // DeepL Free API keys end with ":fx"
  return apiKey.endsWith(':fx') ? API_URL_FREE : API_URL_PRO
}

export async function deeplTranslate(
  text: string,
  targetLang: string,
): Promise<{ translatedText: string; characters: number; monthlyChars: number }> {
  const apiKey = requireDeeplKey()
  const apiUrl = getApiUrl(apiKey)

  const { translated, characters } = await translateWithProtection(
    text,
    MAX_CHARS_PER_REQUEST,
    async (chunk) => {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: [chunk],
          target_lang: targetLang.toUpperCase(),
          tag_handling: 'xml',
          ignore_tags: ['code', 'pre', 'img'],
        }),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`DeepL API error: ${res.status} ${body.slice(0, 200)}`)
      }

      const json = await res.json() as {
        translations: Array<{ text: string }>
      }

      return { translated: json.translations[0].text, characters: chunk.length }
    },
  )

  const monthlyChars = addMonthlyUsage(characters)

  return { translatedText: translated, characters, monthlyChars }
}

/** Track cumulative monthly character usage. Resets when month changes. */
function addMonthlyUsage(chars: number): number {
  const currentMonth = new Date().toISOString().slice(0, 7)
  const storedMonth = getSetting('deepl.usage_month') || ''
  const storedChars = Number(getSetting('deepl.usage_chars') || '0')

  let total: number
  if (storedMonth === currentMonth) {
    total = storedChars + chars
  } else {
    total = chars
    upsertSetting('deepl.usage_month', currentMonth)
  }
  upsertSetting('deepl.usage_chars', String(total))
  return total
}

/** Get current monthly usage and free tier status */
export function getDeeplMonthlyUsage(): { monthlyChars: number; freeTierRemaining: number } {
  const currentMonth = new Date().toISOString().slice(0, 7)
  const storedMonth = getSetting('deepl.usage_month') || ''
  const monthlyChars = storedMonth === currentMonth
    ? Number(getSetting('deepl.usage_chars') || '0')
    : 0
  return { monthlyChars, freeTierRemaining: Math.max(0, FREE_TIER_CHARS - monthlyChars) }
}
