-- Fork strip: drop tables whose features were removed
-- (similarity detection, chat, passkeys). No column drops.
DROP TABLE IF EXISTS article_similarities;
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS credentials;
