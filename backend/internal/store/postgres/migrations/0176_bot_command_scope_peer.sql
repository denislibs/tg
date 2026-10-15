-- +goose Up
-- Команды бота по скоупам с адресом (Bot API BotCommandScopeChat,
-- BotCommandScopeChatAdministrators, BotCommandScopeChatMember): пир скоупа —
-- внутренний chats.id и user_id. У скоупов без адреса оба нули.
ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS scope_chat_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS scope_user_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE bot_commands DROP CONSTRAINT IF EXISTS bot_commands_pkey;
ALTER TABLE bot_commands ADD PRIMARY KEY (bot_id, scope, scope_chat_id, scope_user_id, language_code, command);

-- +goose Down
-- Потеря данных при откате: списки с адресом (chat, chat_administrators,
-- chat_member) в старой таблице выразить нечем.
DELETE FROM bot_commands WHERE scope_chat_id <> 0 OR scope_user_id <> 0;
ALTER TABLE bot_commands DROP CONSTRAINT IF EXISTS bot_commands_pkey;
ALTER TABLE bot_commands ADD PRIMARY KEY (bot_id, scope, language_code, command);
ALTER TABLE bot_commands DROP COLUMN IF EXISTS scope_user_id;
ALTER TABLE bot_commands DROP COLUMN IF EXISTS scope_chat_id;
