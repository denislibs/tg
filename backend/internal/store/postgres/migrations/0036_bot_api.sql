-- +goose Up
-- Полноценный Bot API: боты как отдельные сервисы с токенами. Пользователь-бот
-- живёт в users (is_bot=true), а bot_accounts хранит владельца, токен, webhook и
-- кнопку-меню. Апдейты копятся в bot_updates (long-poll getUpdates по offset).
-- Mini-app'ы бота — bot_apps (BotFather /newapp).

CREATE TABLE bot_accounts (
    bot_id            BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    owner_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token             TEXT NOT NULL UNIQUE,
    webhook_url       TEXT NOT NULL DEFAULT '',
    menu_button_text  TEXT NOT NULL DEFAULT '',
    menu_button_url   TEXT NOT NULL DEFAULT '',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bot_accounts_owner_idx ON bot_accounts(owner_id);

-- Очередь апдейтов бота (getUpdates). update_id — глобальный монотонный bigserial;
-- клиент подтверждает пачку через offset (мы удаляем update_id < offset).
CREATE TABLE bot_updates (
    update_id  BIGSERIAL PRIMARY KEY,
    bot_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payload    JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bot_updates_bot_idx ON bot_updates(bot_id, update_id);

-- Mini-app'ы бота (BotFather /newapp): именованные web-приложения.
CREATE TABLE bot_apps (
    bot_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    short_name TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    url        TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (bot_id, short_name)
);

-- Состояние диалогового мастера BotFather (пошаговый флоу /newbot, /newapp, …).
CREATE TABLE bot_wizard (
    user_id  BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    flow     TEXT NOT NULL DEFAULT '',
    step     TEXT NOT NULL DEFAULT '',
    data     JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Системный бот @BotFather (id 424241): его логика зашита в usecase (не внешний).
INSERT INTO users (id, phone, username, first_name, display_name, is_bot, is_verified)
VALUES (424241, '+0000000424241', 'BotFather', 'BotFather', 'BotFather', true, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO bot_commands (bot_id, command, description, sort) VALUES
    (424241, 'newbot',      'Создать нового бота',        1),
    (424241, 'mybots',      'Мои боты и настройки',       2),
    (424241, 'token',       'Показать/выпустить токен',   3),
    (424241, 'revoke',      'Отозвать и пересоздать токен',4),
    (424241, 'setcommands', 'Задать список команд',       5),
    (424241, 'newapp',      'Создать mini-app',           6),
    (424241, 'setmenubutton','Кнопка-меню mini-app',      7)
ON CONFLICT DO NOTHING;

-- +goose Down
DROP TABLE bot_wizard;
DROP TABLE bot_apps;
DROP TABLE bot_updates;
DROP TABLE bot_accounts;
DELETE FROM bot_commands WHERE bot_id = 424241;
DELETE FROM users WHERE id = 424241;
