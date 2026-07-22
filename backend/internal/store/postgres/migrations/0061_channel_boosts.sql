-- +goose Up
-- Бусты каналов (Telegram channel boosts): premium-пользователь тратит слот на
-- буст канала; буст истекает через фиксированный срок. Уровень канала — функция
-- от суммы активных бустов (см. domain.BoostLevelFor). Одна строка на пару
-- (chat, user): повторный буст того же канала запрещён (PK).
CREATE TABLE channel_boosts (
    chat_id    BIGINT      NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slots      INT         NOT NULL DEFAULT 1, -- множитель буста (сколько слотов внесено)
    expires_at TIMESTAMPTZ NOT NULL,           -- буст перестаёт считаться после этого момента
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX channel_boosts_user_idx ON channel_boosts(user_id);

-- +goose Down
DROP TABLE channel_boosts;
