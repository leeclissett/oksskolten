-- Web address of the original post for articles ingested from inline feed
-- content (e.g. an email newsletter relayed by LetterFeed). Such entries have
-- no link of their own, so articles.url holds a synthetic fragment URL that
-- only serves as the dedup key. NULL for ordinary articles, whose url is
-- already the page.
ALTER TABLE articles ADD COLUMN source_url TEXT;
