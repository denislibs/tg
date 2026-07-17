-- +goose Up
-- Автоудаление сообщений (Telegram messages.setDefaultHistoryTTL /
-- setHistoryTTL): глобальный период пользователя применяется к НОВЫМ приватным
-- чатам; период чата штампует messages.auto_delete_at при вставке; фоновый
-- воркер удаляет просроченные для всех.
ALTER TABLE users ADD COLUMN auto_delete_period INT NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN auto_delete_period INT NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN auto_delete_at TIMESTAMPTZ;
CREATE INDEX messages_auto_delete_idx ON messages (auto_delete_at)
    WHERE auto_delete_at IS NOT NULL AND deleted_at IS NULL;

-- +goose Down
DROP INDEX messages_auto_delete_idx;
ALTER TABLE messages DROP COLUMN auto_delete_at;
ALTER TABLE chats DROP COLUMN auto_delete_period;
ALTER TABLE users DROP COLUMN auto_delete_period;
