-- +goose Up
-- Запланированные сообщения (Telegram scheduled messages): отдельная очередь,
-- в историю сообщение попадает только в момент отправки (фоновым воркером).
-- Каждый видит только СВОИ запланированные в чате.
CREATE TABLE scheduled_messages (
    id          BIGSERIAL PRIMARY KEY,
    chat_id     BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL DEFAULT 'text',
    text        TEXT NOT NULL DEFAULT '',
    entities    JSONB,
    reply_to_id BIGINT,
    media_id    BIGINT REFERENCES media(id),
    send_at     TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX scheduled_messages_due_idx ON scheduled_messages (send_at);
CREATE INDEX scheduled_messages_chat_idx ON scheduled_messages (chat_id, sender_id);

-- +goose Down
DROP TABLE scheduled_messages;
