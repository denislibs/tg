-- +goose Up
-- Повторяемая: IF NOT EXISTS.

-- «Удалить чат» в личке (Telegram messages.deleteHistory just_clear=false):
-- диалог пропадает из списка удалившего, но участие остаётся — следующее
-- сообщение (его или собеседника) идёт в ТОТ ЖЕ чат и возвращает строку.
-- Прежде «удалить чат» выполняло выход из лички (RemoveMember): собеседнику
-- уходила служебка «удалил из группы», а следующее сообщение создавало второй
-- приватный чат.
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS dialog_hidden BOOLEAN NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE chat_members DROP COLUMN IF EXISTS dialog_hidden;
