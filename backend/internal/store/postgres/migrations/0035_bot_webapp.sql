-- +goose Up
-- Демо-бот: команды /app (открыть mini-app) и /inline (подсказка про inline-режим).
INSERT INTO bot_commands (bot_id, command, description, sort) VALUES
    (424242, 'app',    'Открыть mini-app',          6),
    (424242, 'inline', 'Как работает inline-режим', 7)
ON CONFLICT DO NOTHING;

-- +goose Down
DELETE FROM bot_commands WHERE bot_id = 424242 AND command IN ('app', 'inline');
