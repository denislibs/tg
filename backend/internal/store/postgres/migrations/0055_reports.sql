-- +goose Up
-- Жалобы (tweb reportMessages / reportPeer): пользователь жалуется на чат или на
-- конкретное сообщение. Модерации нет — просто складируем обращения.
--  * reporter_id — кто пожаловался.
--  * chat_id     — чат, на который жалоба.
--  * msg_id      — конкретное сообщение (NULL = жалоба на чат целиком).
--  * reason      — причина из белого списка (spam/violence/porn/child_abuse/other).
--  * comment     — необязательный текстовый комментарий.
CREATE TABLE reports (
    id          BIGSERIAL PRIMARY KEY,
    reporter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id     BIGINT NOT NULL,
    msg_id      BIGINT,
    reason      TEXT NOT NULL,
    comment     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reports_chat_idx ON reports (chat_id);

-- +goose Down
DROP TABLE reports;
