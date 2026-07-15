-- +goose Up
-- Групповые настройки (экран «Изменить» / tweb editChat):
--   default_permissions — битовая маска возможностей обычных участников
--     (1 отправка сообщений, 2 медиа, 4 добавление участников, 8 закрепление,
--      16 изменение профиля группы); 31 = всё разрешено (как в Telegram по умолчанию)
--   slowmode_seconds — медленный режим (0 = выключен)
--   reactions_mode  — 'all' | 'some' | 'none'; reactions_allowed — список эмодзи для 'some'
--   history_for_new — история чата видна новым участникам
ALTER TABLE chats ADD COLUMN default_permissions INT NOT NULL DEFAULT 31;
ALTER TABLE chats ADD COLUMN slowmode_seconds INT NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN reactions_mode TEXT NOT NULL DEFAULT 'all';
ALTER TABLE chats ADD COLUMN reactions_allowed JSONB;
ALTER TABLE chats ADD COLUMN history_for_new BOOLEAN NOT NULL DEFAULT true;

-- Чёрный список: кикнутые админом не могут вернуться по ссылке/добавлением.
CREATE TABLE chat_bans (
    chat_id    BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    banned_by  BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chat_id, user_id)
);

-- +goose Down
DROP TABLE chat_bans;
ALTER TABLE chats DROP COLUMN default_permissions;
ALTER TABLE chats DROP COLUMN slowmode_seconds;
ALTER TABLE chats DROP COLUMN reactions_mode;
ALTER TABLE chats DROP COLUMN reactions_allowed;
ALTER TABLE chats DROP COLUMN history_for_new;
