-- +goose Up
-- Отложенное — полный снимок отправки (Ф-5, S1). У оригинала отложенное — любая
-- отправка с schedule_date (tweb appMessagesManager.ts:2741, :3230, :3779,
-- :4149, :5652), поэтому строка очереди обязана сохранять ВСЕ её параметры, а
-- не восемь полей: тему, альбом, send-as, тишину, эффект, цитату, гео, контакт,
-- опрос, платное медиа и атрибуцию отложенной пересылки.
--
-- params            — всё, у чего нет своей колонки (domain.ScheduledParams);
-- client_msg_id     — идемпотентность постановки: повтор кадра после
--                     переподключения не плодит вторую строку (НО-8);
-- repeat_period     — повтор (schema schedule_repeat_period), секунды;
-- web_page(+media)  — превью ссылки отложенного (строит P1), при публикации
--                     переносится в сообщение (как messages.web_page, 0052/0092).
ALTER TABLE scheduled_messages
    ADD COLUMN IF NOT EXISTS params            JSONB   NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS client_msg_id     TEXT,
    ADD COLUMN IF NOT EXISTS repeat_period     INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS web_page          JSONB,
    ADD COLUMN IF NOT EXISTS web_page_media_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_messages_client_idx
    ON scheduled_messages (chat_id, sender_id, client_msg_id) WHERE client_msg_id IS NOT NULL;

-- Ожидающие «когда в сети» выбираются по собеседникам, а не окном по
-- created_at (НО-2): частичный индекс держит выборку дешёвой.
CREATE INDEX IF NOT EXISTS scheduled_messages_when_online_idx
    ON scheduled_messages (chat_id, sender_id) WHERE when_online;

-- Опубликованное из очереди отложенных (schema message.pFlags.from_scheduled).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS from_scheduled BOOLEAN NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE messages DROP COLUMN IF EXISTS from_scheduled;
DROP INDEX IF EXISTS scheduled_messages_when_online_idx;
DROP INDEX IF EXISTS scheduled_messages_client_idx;
ALTER TABLE scheduled_messages
    DROP COLUMN IF EXISTS web_page_media_id,
    DROP COLUMN IF EXISTS web_page,
    DROP COLUMN IF EXISTS repeat_period,
    DROP COLUMN IF EXISTS client_msg_id,
    DROP COLUMN IF EXISTS params;
