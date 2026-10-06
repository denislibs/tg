-- +goose Up
-- Платное медиа пересланной копии и зеркала поста продаётся ИСХОДНИКОМ (как у
-- Telegram: копия несёт ту же цену и того же продавца, открыта тем, кто купил
-- оригинал). source_message_id — сообщение-«предложение», по которому живут
-- разблокировки и выплата; NULL — сообщение само своё предложение.
-- Внешнего ключа нет намеренно: снос исходника не должен делать копию
-- бесплатной (каскад) или передавать продажу пересылающему (SET NULL).
ALTER TABLE paid_media ADD COLUMN IF NOT EXISTS source_message_id BIGINT;

-- +goose Down
ALTER TABLE paid_media DROP COLUMN IF EXISTS source_message_id;
