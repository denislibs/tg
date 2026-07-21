-- +goose Up
-- Ответ с цитатой фрагмента (Telegram reply quote): выделенный кусок текста
-- отвечаемого сообщения + его offset (UTF-16). NULL — обычный ответ на всё сообщение.
ALTER TABLE messages ADD COLUMN reply_quote_text   TEXT;
ALTER TABLE messages ADD COLUMN reply_quote_offset INT;

-- +goose Down
ALTER TABLE messages DROP COLUMN reply_quote_offset;
ALTER TABLE messages DROP COLUMN reply_quote_text;
