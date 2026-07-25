-- +goose Up
-- Ответ на сообщение из ДРУГОГО чата (Telegram reply_to_peer_id). Получатель
-- может не иметь доступа к исходному чату, поэтому превью ответа сохраняется
-- СНИМКОМ прямо на сообщении-ответе: имя автора оригинала + текстовый превью
-- (для медиа — короткий лейбл). reply_to_peer_id NULL — обычный ответ в том же
-- чате (снимки пустые).
ALTER TABLE messages
    ADD COLUMN reply_to_peer_id    BIGINT,
    ADD COLUMN reply_snapshot_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN reply_snapshot_text TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE messages
    DROP COLUMN reply_to_peer_id,
    DROP COLUMN reply_snapshot_name,
    DROP COLUMN reply_snapshot_text;
