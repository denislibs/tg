-- +goose Up
-- Уведомления (по образцу tweb):
--   chat_members.muted_until — mute на время («На 1 час … На 3 дня»); muted остаётся
--     флагом «навсегда» (tweb: mute_until = 0x7FFFFFFF). Эффективный mute чата:
--     muted OR (muted_until > now()).
--   notify_settings — глобальные настройки по типам чатов (tweb: notifyUsers /
--     notifyChats / notifyBroadcasts): выключены ли уведомления и показывать ли
--     текст сообщения (Message Preview). Per-chat mute имеет приоритет, тип — fallback.
ALTER TABLE chat_members ADD COLUMN muted_until TIMESTAMPTZ;

CREATE TABLE notify_settings (
    user_id          BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    private_muted    BOOLEAN NOT NULL DEFAULT false,
    private_preview  BOOLEAN NOT NULL DEFAULT true,
    groups_muted     BOOLEAN NOT NULL DEFAULT false,
    groups_preview   BOOLEAN NOT NULL DEFAULT true,
    channels_muted   BOOLEAN NOT NULL DEFAULT false,
    channels_preview BOOLEAN NOT NULL DEFAULT true
);

-- +goose Down
DROP TABLE notify_settings;
ALTER TABLE chat_members DROP COLUMN muted_until;
