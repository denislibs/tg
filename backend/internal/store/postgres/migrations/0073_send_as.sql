-- +goose Up
-- Send-as (Telegram send_as): сообщение может отображаться от имени привязанного
-- канала-обсуждения (админ канала) или самой супергруппы (анонимный админ), а не
-- от реального автора. Реальный sender_id сохраняется, отображаемый автор —
-- send_as_chat_id (ссылка на chats.id канала/группы; NULL — обычная отправка).
ALTER TABLE messages ADD COLUMN send_as_chat_id BIGINT;

-- +goose Down
ALTER TABLE messages DROP COLUMN send_as_chat_id;
