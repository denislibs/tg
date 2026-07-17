-- +goose Up
-- Облачные черновики (Telegram messages.saveDraft/getAllDrafts): по одному
-- на пару (чат, пользователь); синхронизируются на устройства владельца
-- WS-фреймом draft_update; отправка сообщения удаляет черновик чата.
CREATE TABLE drafts (
    chat_id     BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text        TEXT NOT NULL,
    entities    JSONB,
    reply_to_id BIGINT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX drafts_user_idx ON drafts (user_id);

-- +goose Down
DROP TABLE drafts;
