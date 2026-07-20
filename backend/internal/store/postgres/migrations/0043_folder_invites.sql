-- +goose Up
-- Ссылки-приглашения в папку (Telegram chatlist invites): владелец папки шарит
-- набор своих групп/каналов; по ссылке другой юзер вступает в них и получает папку.
CREATE TABLE folder_invites (
    id         BIGSERIAL PRIMARY KEY,
    slug       TEXT NOT NULL UNIQUE,
    folder_id  BIGINT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    owner_id   BIGINT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE folder_invite_chats (
    invite_id BIGINT NOT NULL REFERENCES folder_invites(id) ON DELETE CASCADE,
    chat_id   BIGINT NOT NULL,
    PRIMARY KEY (invite_id, chat_id)
);

-- +goose Down
DROP TABLE folder_invite_chats;
DROP TABLE folder_invites;
