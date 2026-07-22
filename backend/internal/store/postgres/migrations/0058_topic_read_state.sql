-- +goose Up
-- Пер-юзерное состояние прочтения/уведомлений форум-темы (Telegram forumTopic:
-- read_inbox_max_id + notify_settings). Тема идентифицируется парой
-- (chat_id, root_msg_id) — так же, как треды через thread_root_id.
-- last_read_seq — последний прочитанный seq темы (аналог chat_members.read_seq).
-- muted/muted_until — mute темы (bool достаточно сейчас; until — на будущее).
CREATE TABLE topic_user_state (
    chat_id       BIGINT      NOT NULL,
    root_msg_id   BIGINT      NOT NULL,
    user_id       BIGINT      NOT NULL,
    last_read_seq BIGINT      NOT NULL DEFAULT 0,
    muted         BOOLEAN     NOT NULL DEFAULT false,
    muted_until   TIMESTAMPTZ,
    PRIMARY KEY (chat_id, root_msg_id, user_id)
);

-- +goose Down
DROP TABLE topic_user_state;
