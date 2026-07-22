-- +goose Up
-- Непрочитанные реакции: счётчик на участника (Telegram unread_reactions_count).
-- Бампится автору сообщения, когда на его сообщение реагирует кто-то другой;
-- обнуляется, когда автор прочитал чат (MarkRead) — отдельный бейдж «реакция»
-- в списке диалогов поверх обычного unread, как «@»-бейдж упоминаний.
ALTER TABLE chat_members ADD COLUMN unread_reactions INT NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE chat_members DROP COLUMN unread_reactions;
