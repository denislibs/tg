-- +goose Up
ALTER TABLE chats ADD COLUMN discussion_chat_id BIGINT;
ALTER TABLE messages ADD COLUMN thread_root_id BIGINT;
CREATE INDEX idx_messages_thread ON messages (chat_id, thread_root_id) WHERE thread_root_id IS NOT NULL;
-- +goose Down
DROP INDEX IF EXISTS idx_messages_thread;
ALTER TABLE messages DROP COLUMN thread_root_id;
ALTER TABLE chats DROP COLUMN discussion_chat_id;
