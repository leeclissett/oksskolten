import { getDb } from './connection.js'

export const TRANSLATION_MAX_ATTEMPTS = 5

export interface TranslationCandidate {
  id: number
  title: string
  full_text: string
  lang: string | null
  translated_lang: string | null
  full_text_translated: string | null
}

export interface TranslationJob {
  article_id: number
  feed_id: number
  title: string
  full_text: string
  target_lang: string
  attempts: number
}

export function getFeedTranslationCandidates(feedId: number): TranslationCandidate[] {
  return getDb().prepare(`
    SELECT id, title, full_text, lang, translated_lang, full_text_translated
    FROM active_articles
    WHERE feed_id = ? AND length(trim(COALESCE(full_text, ''))) > 0
    ORDER BY COALESCE(published_at, fetched_at) DESC
  `).all(feedId) as TranslationCandidate[]
}

export function enqueueArticleTranslation(articleId: number, targetLang: string): boolean {
  const result = getDb().prepare(`
    UPDATE articles
    SET translation_target_lang = ?,
        translation_status = 'pending',
        translation_error = NULL,
        translation_attempts = CASE
          WHEN translation_target_lang = ? AND translation_status IS NOT 'failed' THEN translation_attempts
          ELSE 0
        END,
        translation_next_attempt_at = NULL,
        translation_started_at = NULL
    WHERE id = ?
      AND purged_at IS NULL
      AND length(trim(COALESCE(full_text, ''))) > 0
      AND lang IS NOT NULL
      AND lang NOT IN (?, 'und')
      AND NOT (translated_lang = ? AND length(trim(COALESCE(full_text_translated, ''))) > 0)
      AND translation_status IS NOT 'processing'
  `).run(targetLang, targetLang, articleId, targetLang, targetLang)
  return result.changes > 0
}

export function enqueueArticleTranslationFromFeedPolicy(articleId: number): boolean {
  const row = getDb().prepare(`
    SELECT f.auto_translate_target AS target_lang
    FROM articles a
    JOIN feeds f ON f.id = a.feed_id
    WHERE a.id = ? AND f.auto_translate_target IS NOT NULL
  `).get(articleId) as { target_lang: string } | undefined
  return row ? enqueueArticleTranslation(articleId, row.target_lang) : false
}

export function cancelFeedTranslations(feedId: number): number {
  const result = getDb().prepare(`
    UPDATE articles
    SET translation_status = NULL,
        translation_error = NULL,
        translation_next_attempt_at = NULL,
        translation_started_at = NULL
    WHERE feed_id = ? AND translation_status IN ('pending', 'failed')
  `).run(feedId)
  return result.changes
}

/** Recover jobs left in-flight by a restart without duplicating completed work. */
export function recoverStuckTranslationJobs(): number {
  const db = getDb()
  return db.transaction(() => {
    db.prepare(`
      UPDATE articles
      SET translation_status = 'completed', translation_started_at = NULL, translation_error = NULL
      WHERE translation_status = 'processing'
        AND translated_lang = translation_target_lang
        AND length(trim(COALESCE(full_text_translated, ''))) > 0
    `).run()
    const recovered = db.prepare(`
      UPDATE articles
      SET translation_status = 'pending', translation_started_at = NULL
      WHERE translation_status = 'processing'
    `).run()
    return recovered.changes
  })()
}

export function claimNextTranslationJob(): TranslationJob | undefined {
  const db = getDb()
  return db.transaction(() => {
    const row = db.prepare(`
      SELECT a.id AS article_id, a.feed_id, a.title, a.full_text,
             a.translation_target_lang AS target_lang,
             a.translation_attempts AS attempts
      FROM articles a
      JOIN feeds f ON f.id = a.feed_id
      WHERE a.purged_at IS NULL
        AND a.translation_status IN ('pending', 'failed')
        AND a.translation_attempts < ?
        AND (a.translation_next_attempt_at IS NULL OR datetime(a.translation_next_attempt_at) <= datetime('now'))
        AND f.auto_translate_target = a.translation_target_lang
        AND a.lang IS NOT NULL
        AND a.lang NOT IN (a.translation_target_lang, 'und')
        AND length(trim(COALESCE(a.full_text, ''))) > 0
        AND NOT (
          a.translated_lang = a.translation_target_lang
          AND length(trim(COALESCE(a.full_text_translated, ''))) > 0
        )
      ORDER BY COALESCE(a.published_at, a.fetched_at) DESC, a.id DESC
      LIMIT 1
    `).get(TRANSLATION_MAX_ATTEMPTS) as Omit<TranslationJob, 'attempts'> & { attempts: number } | undefined
    if (!row) return undefined

    const claimed = db.prepare(`
      UPDATE articles
      SET translation_status = 'processing',
          translation_attempts = translation_attempts + 1,
          translation_started_at = datetime('now'),
          translation_error = NULL
      WHERE id = ? AND translation_status IN ('pending', 'failed')
    `).run(row.article_id)
    if (claimed.changes === 0) return undefined
    return { ...row, attempts: row.attempts + 1 }
  })()
}

export function failTranslationJob(articleId: number, attempts: number, error: string): void {
  const delayMinutes = Math.min(360, 5 * (2 ** Math.max(0, attempts - 1)))
  const nextAttempt = new Date(Date.now() + delayMinutes * 60_000).toISOString()
  getDb().prepare(`
    UPDATE articles
    SET translation_status = 'failed',
        translation_error = ?,
        translation_next_attempt_at = ?,
        translation_started_at = NULL
    WHERE id = ?
  `).run(error.slice(0, 1000), nextAttempt, articleId)
}
