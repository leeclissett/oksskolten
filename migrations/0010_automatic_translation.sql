ALTER TABLE feeds ADD COLUMN auto_translate_target TEXT;

ALTER TABLE articles ADD COLUMN title_translated TEXT;
ALTER TABLE articles ADD COLUMN excerpt_translated TEXT;
ALTER TABLE articles ADD COLUMN translation_target_lang TEXT;
ALTER TABLE articles ADD COLUMN translation_status TEXT;
ALTER TABLE articles ADD COLUMN translation_error TEXT;
ALTER TABLE articles ADD COLUMN translation_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN translation_next_attempt_at TEXT;
ALTER TABLE articles ADD COLUMN translation_started_at TEXT;
ALTER TABLE articles ADD COLUMN translation_input_tokens INTEGER;
ALTER TABLE articles ADD COLUMN translation_output_tokens INTEGER;

CREATE INDEX IF NOT EXISTS idx_articles_translation_queue
  ON articles(translation_status, translation_next_attempt_at, translation_attempts);
