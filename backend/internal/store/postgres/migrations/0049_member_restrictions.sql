-- +goose Up
-- Гранулярные ограничения участника (Telegram ChatBannedRights): какие права
-- ЗАПРЕЩЕНЫ конкретному юзеру и до какого времени (until_date NULL — бессрочно).
CREATE TABLE chat_restrictions (
    chat_id       BIGINT NOT NULL,
    user_id       BIGINT NOT NULL,
    denied_rights INT NOT NULL DEFAULT 0,
    until_date    TIMESTAMPTZ,
    restricted_by BIGINT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chat_id, user_id)
);

-- +goose Down
DROP TABLE chat_restrictions;
