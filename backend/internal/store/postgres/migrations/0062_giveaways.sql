-- +goose Up
-- Розыгрыши (Telegram giveaways): giveaway — отдельная сущность, создаётся в
-- канале и публикуется как сообщение типа 'giveaway' (messages.giveaway_id).
-- Приз: N premium-подписок на срок (prize_kind='premium', months) ИЛИ звёзды
-- (prize_kind='stars', stars). Участники — подписчики канала. По наступлении
-- until_date разыгрываются winners_count победителей (winner_ids заполняется).
CREATE TABLE giveaways (
    id            BIGSERIAL   PRIMARY KEY,
    chat_id       BIGINT      NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prize_kind    TEXT        NOT NULL,             -- 'premium' | 'stars'
    months        INT         NOT NULL DEFAULT 0,   -- срок premium-подписки (prize_kind='premium')
    stars         BIGINT      NOT NULL DEFAULT 0,   -- звёзд каждому победителю (prize_kind='stars')
    winners_count INT         NOT NULL,
    until_date    TIMESTAMPTZ NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'active', -- 'active' | 'finished'
    winner_ids    JSONB,                            -- массив id победителей (после розыгрыша)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE giveaway_participants (
    giveaway_id BIGINT      NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
    user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (giveaway_id, user_id)
);

ALTER TABLE messages ADD COLUMN giveaway_id BIGINT REFERENCES giveaways(id);

-- +goose Down
ALTER TABLE messages DROP COLUMN giveaway_id;
DROP TABLE giveaway_participants;
DROP TABLE giveaways;
