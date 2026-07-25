-- +goose Up
-- «Отправить когда онлайн» (Telegram schedule_date sentinel 0x7FFFFFFE): вместо
-- времени сообщение ждёт, пока СОБЕСЕДНИК в приватном чате появится онлайн.
-- Реализуем явным флагом вместо sentinel: send_at при when_online игнорируется.
ALTER TABLE scheduled_messages ADD COLUMN when_online BOOLEAN NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE scheduled_messages DROP COLUMN when_online;
