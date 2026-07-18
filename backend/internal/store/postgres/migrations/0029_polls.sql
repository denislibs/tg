-- +goose Up
-- Опросы (Telegram Poll/MediaPoll): опрос — отдельная сущность, сообщение
-- типа 'poll' ссылается на неё через messages.poll_id. Голоса — по строке на
-- (poll, user, option): multiple-опрос пишет несколько строк.
CREATE TABLE polls (
    id             BIGSERIAL PRIMARY KEY,
    chat_id        BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    question       TEXT NOT NULL,
    options        JSONB NOT NULL, -- массив строк-вариантов (2..10)
    anonymous      BOOLEAN NOT NULL DEFAULT true,
    multiple       BOOLEAN NOT NULL DEFAULT false,
    quiz           BOOLEAN NOT NULL DEFAULT false,
    correct_option INT,            -- викторина: индекс правильного варианта
    closed         BOOLEAN NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE poll_votes (
    poll_id    BIGINT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    option_idx INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (poll_id, user_id, option_idx)
);

ALTER TABLE messages ADD COLUMN poll_id BIGINT REFERENCES polls(id);

-- +goose Down
ALTER TABLE messages DROP COLUMN poll_id;
DROP TABLE poll_votes;
DROP TABLE polls;
