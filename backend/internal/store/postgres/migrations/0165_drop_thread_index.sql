-- +goose NO TRANSACTION
-- +goose Up
-- Ф-5, БЭК-1b. idx_messages_thread (chat_id, thread_root_id) из 0008 —
-- префикс idx_messages_thread_seq (0164) и только удорожает вставку в
-- messages. Снимается отдельным шагом: если CREATE INDEX CONCURRENTLY в 0164
-- прервался, новый индекс невалиден, и снять старый — остаться без индекса
-- тредов вовсе. Поэтому сначала проверка валидности: нет её — миграция
-- падает громко, старый индекс цел (лечение — REINDEX INDEX CONCURRENTLY
-- idx_messages_thread_seq и повтор).
-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_index i
                     JOIN pg_class c ON c.oid = i.indexrelid
                     JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.relname = 'idx_messages_thread_seq'
                      AND n.nspname = current_schema() AND i.indisvalid) THEN
        RAISE EXCEPTION 'idx_messages_thread_seq отсутствует или невалиден: idx_messages_thread не снимается';
    END IF;
END $$;
-- +goose StatementEnd
DROP INDEX CONCURRENTLY IF EXISTS idx_messages_thread;

-- +goose Down
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_thread
    ON messages (chat_id, thread_root_id) WHERE thread_root_id IS NOT NULL;
