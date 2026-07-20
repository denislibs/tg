-- +goose Up
-- Расширение Bot API: профиль бота (описание/about), inline-настройки,
-- скоуп/язык у команд и облачное хранилище mini-app (CloudStorage).

-- Профиль и inline-настройки бота.
ALTER TABLE bot_accounts ADD COLUMN description        TEXT NOT NULL DEFAULT '';  -- /setdescription — экран пустого чата
ALTER TABLE bot_accounts ADD COLUMN about_text         TEXT NOT NULL DEFAULT '';  -- /setabouttext — профиль бота
ALTER TABLE bot_accounts ADD COLUMN inline_enabled     BOOLEAN NOT NULL DEFAULT false;  -- /setinline
ALTER TABLE bot_accounts ADD COLUMN inline_placeholder TEXT NOT NULL DEFAULT '';

-- Команды бота: скоуп (default|all_private_chats|all_group_chats|all_chat_administrators)
-- и язык (пустой = дефолтный). Меняем PK, чтобы одна команда жила в разных скоупах.
ALTER TABLE bot_commands ADD COLUMN scope         TEXT NOT NULL DEFAULT 'default';
ALTER TABLE bot_commands ADD COLUMN language_code TEXT NOT NULL DEFAULT '';
ALTER TABLE bot_commands DROP CONSTRAINT bot_commands_pkey;
ALTER TABLE bot_commands ADD PRIMARY KEY (bot_id, scope, language_code, command);

-- Новые команды @BotFather (профиль/inline).
INSERT INTO bot_commands (bot_id, command, description, sort, scope, language_code) VALUES
    (424241, 'setdescription', 'Описание бота',        8,  'default', ''),
    (424241, 'setabouttext',   'Текст «О боте»',       9,  'default', ''),
    (424241, 'setuserpic',     'Аватар бота',          10, 'default', ''),
    (424241, 'setinline',      'Inline-режим',         11, 'default', '')
ON CONFLICT DO NOTHING;

-- CloudStorage mini-app: ключ-значение на пару (бот, пользователь).
-- Лимиты как в Telegram: ключ ≤128, значение ≤4096, до 1024 ключей на пару.
CREATE TABLE bot_cloud_storage (
    bot_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key        TEXT   NOT NULL,
    value      TEXT   NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (bot_id, user_id, key)
);

-- +goose Down
DROP TABLE bot_cloud_storage;
ALTER TABLE bot_commands DROP CONSTRAINT bot_commands_pkey;
ALTER TABLE bot_commands DROP COLUMN language_code;
ALTER TABLE bot_commands DROP COLUMN scope;
ALTER TABLE bot_commands ADD PRIMARY KEY (bot_id, command);
ALTER TABLE bot_accounts DROP COLUMN inline_placeholder;
ALTER TABLE bot_accounts DROP COLUMN inline_enabled;
ALTER TABLE bot_accounts DROP COLUMN about_text;
ALTER TABLE bot_accounts DROP COLUMN description;
