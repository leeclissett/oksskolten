/**
 * Locale code → English language name mapping.
 * Used in AI prompts to specify the target language dynamically.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt: 'Portuguese',
  it: 'Italian',
  nl: 'Dutch',
  ru: 'Russian',
}

/** Default locale when no user preference is set. */
export const DEFAULT_LANGUAGE = 'en'

/**
 * Resolve the English language name for a locale code.
 * Falls back to the code itself if not in the map (e.g. 'ar' → 'ar').
 */
export function languageName(locale: string): string {
  return LANGUAGE_NAMES[locale] ?? locale
}
