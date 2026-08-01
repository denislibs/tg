-- +goose NO TRANSACTION
-- +goose Up
-- FK-индексы горячей таблицы messages. 0002 создала колонки sender_id (FK на
-- users) и reply_to_id БЕЗ индексов: удаление пользователя (проверка FK), поиск
-- сообщений по автору и резолв/подсчёт ответов шли seq-scan по всей таблице.
-- CONCURRENTLY — чтобы построение индекса не блокировало запись в чат при
-- rolling-деплое (миграции применяются на старте). reply_to_id — partial: NULL
-- (у большинства сообщений нет reply) в индексе не нужен.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_sender_id ON messages (sender_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_reply_to_id ON messages (reply_to_id) WHERE reply_to_id IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS idx_messages_reply_to_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_messages_sender_id;
