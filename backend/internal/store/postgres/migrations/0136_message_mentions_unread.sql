-- +goose Up
-- Упоминание у сообщения остаётся и после прочтения (Telegram message.mentioned
-- не снимается), а «непрочитано» — отдельный признак (media_unread у адресата).
-- Прежде прочтение УДАЛЯЛО строку, и сервер терял сам факт упоминания: флаг
-- mentioned отдать было не из чего. Существующие строки — все непрочитанные
-- (прочитанные до этой миграции уже удалены).
ALTER TABLE message_mentions ADD COLUMN unread BOOLEAN NOT NULL DEFAULT true;

-- +goose Down
DELETE FROM message_mentions WHERE NOT unread;
ALTER TABLE message_mentions DROP COLUMN unread;
