-- +goose NO TRANSACTION
-- +goose Up
-- Ф-5, БЭК-1 (ревью п. 3). Последнее сообщение темы — `thread_root_id = корень
-- ORDER BY seq DESC LIMIT 1` (список тем, TopicsRepo.ListByChat), лента треда —
-- то же с курсором по seq. Индекс (chat_id, thread_root_id) порядка по seq не
-- даёт, и планировщик шёл обратным проходом по (chat_id, seq) всего чата,
-- отбрасывая чужие треды: у пустой темы — весь чат (EXPLAIN на чате в 200 тыс.
-- сообщений — ~8 мс на тему). Новый индекс с seq заменяет старый: его префикс
-- (chat_id, thread_root_id) отвечает на всё, на что отвечал тот.
-- CONCURRENTLY — без SHARE-замка на messages (прецедент — 0085, 0162).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_thread_seq
    ON messages (chat_id, thread_root_id, seq) WHERE thread_root_id IS NOT NULL;
DROP INDEX CONCURRENTLY IF EXISTS idx_messages_thread;

-- +goose Down
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_thread
    ON messages (chat_id, thread_root_id) WHERE thread_root_id IS NOT NULL;
DROP INDEX CONCURRENTLY IF EXISTS idx_messages_thread_seq;
