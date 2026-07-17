-- +goose Up
-- Альбомы (Telegram grouped_id): сообщения одной медиагруппы несут общий
-- идентификатор; клиент рендерит подряд идущие сообщения с одинаковым
-- grouped_id одним грид-баблом.
ALTER TABLE messages ADD COLUMN grouped_id TEXT;

-- +goose Down
ALTER TABLE messages DROP COLUMN grouped_id;
