-- +goose Up
-- Доступ к медиа своего отложенного (MediaAccessRepo.CanAccess, ветка
-- scheduled_messages): поиск по media_id / web_page_media_id. Без индексов
-- каждый запрос файла, не найденного в других источниках, читал бы всю
-- очередь. Частичные — у большинства строк этих колонок нет.
CREATE INDEX IF NOT EXISTS scheduled_messages_media_idx
    ON scheduled_messages (media_id) WHERE media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS scheduled_messages_web_page_media_idx
    ON scheduled_messages (web_page_media_id) WHERE web_page_media_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS scheduled_messages_web_page_media_idx;
DROP INDEX IF EXISTS scheduled_messages_media_idx;
