-- +goose Up
-- Форум-топики (Telegram forum topics): темы в группе. Топик — тред поверх
-- существующей механики thread_root_id: корень — сервисное сообщение о
-- создании темы, сообщения темы несут thread_root_id = root_msg_id.
ALTER TABLE chats ADD COLUMN is_forum BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE forum_topics (
    id          BIGSERIAL PRIMARY KEY,
    chat_id     BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    root_msg_id BIGINT NOT NULL,
    title       TEXT NOT NULL,
    icon_color  INT NOT NULL DEFAULT 0,
    closed      BOOLEAN NOT NULL DEFAULT false,
    created_by  BIGINT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX forum_topics_chat_idx ON forum_topics (chat_id);

-- +goose Down
DROP TABLE forum_topics;
ALTER TABLE chats DROP COLUMN is_forum;
