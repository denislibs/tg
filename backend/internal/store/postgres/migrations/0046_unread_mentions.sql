-- +goose Up
-- Непрочитанные упоминания: счётчик на участника + отметка сообщений, где юзер
-- упомянут (для точного пересчёта при прочтении/переходе).
ALTER TABLE chat_members ADD COLUMN unread_mentions_count INT NOT NULL DEFAULT 0;
CREATE TABLE message_mentions (
    chat_id    BIGINT NOT NULL,
    message_id BIGINT NOT NULL,
    seq        BIGINT NOT NULL,
    user_id    BIGINT NOT NULL,
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX message_mentions_lookup ON message_mentions (chat_id, user_id, seq);

-- +goose Down
DROP TABLE message_mentions;
ALTER TABLE chat_members DROP COLUMN unread_mentions_count;
