-- PR #1 percent-encoded the LetterFeed entry URN before putting it in the
-- synthetic URL fragment. The browser route decodes those colons before the
-- article lookup, so existing rows cannot be opened. Normalize them in place
-- while preserving article IDs and read/bookmark state.
UPDATE articles
SET url = replace(
  url,
  '#urn%3Aletterfeed%3Aentry%3A',
  '#urn:letterfeed:entry:'
)
WHERE instr(url, '#urn%3Aletterfeed%3Aentry%3A') > 0;
