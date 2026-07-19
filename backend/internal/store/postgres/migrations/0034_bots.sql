-- +goose Up
-- Боты: флаг is_bot у пользователя, список команд бота, inline/reply-клавиатуры
-- на сообщениях (reply_markup jsonb). Реальных ботов нет — сидируется один
-- демо-бот (@demobot), его поведение зашито в usecase (эхо, /start, кнопки).

ALTER TABLE users ADD COLUMN is_bot BOOLEAN NOT NULL DEFAULT false;

-- Команды бота (для popup по «/» и кнопки меню).
CREATE TABLE bot_commands (
    bot_id      INT8 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    command     TEXT NOT NULL,       -- без ведущего «/»
    description TEXT NOT NULL,
    sort        INT8 NOT NULL DEFAULT 0,
    PRIMARY KEY (bot_id, command)
);

-- Клавиатура сообщения (Telegram reply_markup): inline-кнопки под баблом или
-- reply-кнопки над композером. Хранится как JSON, интерпретирует клиент.
ALTER TABLE messages ADD COLUMN reply_markup JSONB;

-- Демо-бот.
INSERT INTO users (id, phone, username, first_name, display_name, is_bot, is_verified)
VALUES (424242, '+0000000424242', 'demobot', 'Демо Бот', 'Демо Бот', true, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO bot_commands (bot_id, command, description, sort) VALUES
    (424242, 'start',    'Запустить бота',            1),
    (424242, 'help',     'Что умеет бот',             2),
    (424242, 'buttons',  'Показать inline-кнопки',    3),
    (424242, 'keyboard', 'Показать клавиатуру',       4),
    (424242, 'hide',     'Скрыть клавиатуру',         5)
ON CONFLICT DO NOTHING;

SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT max(id) FROM users), 777000));

-- +goose Down
ALTER TABLE messages DROP COLUMN reply_markup;
DROP TABLE bot_commands;
DELETE FROM users WHERE id = 424242;
ALTER TABLE users DROP COLUMN is_bot;
