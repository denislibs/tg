-- +goose NO TRANSACTION
-- +goose Up
-- Команды бота по скоупам с адресом (Bot API BotCommandScopeChat,
-- BotCommandScopeChatAdministrators, BotCommandScopeChatMember): пир скоупа —
-- внутренний chats.id и user_id. У скоупов без адреса оба нули.
-- Замена первичного ключа — один оператор (DO), чтобы сбой посреди не оставил
-- таблицу без ключа: файл идёт вне транзакции ради CONCURRENTLY ниже.
-- +goose StatementBegin
DO $$
BEGIN
    ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS scope_chat_id BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS scope_user_id BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE bot_commands DROP CONSTRAINT IF EXISTS bot_commands_pkey;
    ALTER TABLE bot_commands ADD PRIMARY KEY (bot_id, scope, scope_chat_id, scope_user_id, language_code, command);
END
$$;
-- +goose StatementEnd

-- Боты группы для её карточки (channelFull.bot_info): боты редки, поэтому обход
-- идёт со стороны ботов — частичный индекс по users, затем chat_members_pkey.
-- CONCURRENTLY — не блокировать запись в users при rolling-деплое. Оборванное
-- построение оставляет НЕГОДНЫЙ индекс, который IF NOT EXISTS молча пропустил бы:
-- его сначала убираем.
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                WHERE c.relname = 'idx_users_bots' AND NOT i.indisvalid) THEN
        DROP INDEX idx_users_bots;
    END IF;
END
$$;
-- +goose StatementEnd
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_bots ON users (id) WHERE is_bot;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS idx_users_bots;
-- Потеря данных при откате: списки с адресом (chat, chat_administrators,
-- chat_member) в старой таблице выразить нечем.
-- +goose StatementBegin
DO $$
BEGIN
    DELETE FROM bot_commands WHERE scope_chat_id <> 0 OR scope_user_id <> 0;
    ALTER TABLE bot_commands DROP CONSTRAINT IF EXISTS bot_commands_pkey;
    ALTER TABLE bot_commands ADD PRIMARY KEY (bot_id, scope, language_code, command);
    ALTER TABLE bot_commands DROP COLUMN IF EXISTS scope_user_id;
    ALTER TABLE bot_commands DROP COLUMN IF EXISTS scope_chat_id;
END
$$;
-- +goose StatementEnd
