import {
  claimNextTranslationJob,
  enqueueArticleTranslation,
  failTranslationJob,
  getFeedTranslationCandidates,
  updateArticleContent,
  updateScore,
} from './db.js'
import { detectLanguage, translateArticleFields } from './fetcher/ai.js'
import { markdownToExcerpt } from './fetcher/markdown-utils.js'
import { logger } from './logger.js'

const log = logger.child('translation')

export function queueFeedTranslations(feedId: number, targetLang = 'en'): { queued: number; inspected: number } {
  const candidates = getFeedTranslationCandidates(feedId)
  let queued = 0

  for (const article of candidates) {
    // Re-detect every existing article. This repairs rows created by the old
    // Japanese-vs-English detector without touching read/bookmark state.
    const detected = detectLanguage(article.full_text)
    if (article.lang !== detected) {
      updateArticleContent(article.id, { lang: detected })
    }
    if (detected === targetLang || detected === 'und') continue
    if (enqueueArticleTranslation(article.id, targetLang)) queued++
  }

  return { queued, inspected: candidates.length }
}

export async function runTranslationWorkerOnce(): Promise<boolean> {
  const job = claimNextTranslationJob()
  if (!job) return false

  try {
    const translated = await translateArticleFields(job.title, job.full_text, job.target_lang)
    updateArticleContent(job.article_id, {
      title_translated: translated.titleTranslated,
      full_text_translated: translated.fullTextTranslated,
      excerpt_translated: markdownToExcerpt(translated.fullTextTranslated),
      translated_lang: job.target_lang,
      translation_status: 'completed',
      translation_error: null,
      translation_next_attempt_at: null,
      translation_started_at: null,
      translation_input_tokens: translated.inputTokens,
      translation_output_tokens: translated.outputTokens,
    })
    updateScore(job.article_id)
    log.info({ articleId: job.article_id, feedId: job.feed_id, model: translated.model }, 'automatic translation completed')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    failTranslationJob(job.article_id, job.attempts, message)
    log.warn({ articleId: job.article_id, feedId: job.feed_id, attempt: job.attempts, error: message }, 'automatic translation failed')
  }

  return true
}

/** Drain a bounded batch serially. There is intentionally no parallelism. */
export async function drainTranslationQueue(maxJobs = 10): Promise<number> {
  let processed = 0
  while (processed < maxJobs && await runTranslationWorkerOnce()) processed++
  return processed
}
