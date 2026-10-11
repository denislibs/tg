-- +goose NO TRANSACTION
-- +goose Up
-- Ф-5, БЭК-1 (ревью п. 3). Последнее сообщение темы — `thread_root_id = корень
-- ORDER BY seq DESC LIMIT 1` (список тем, TopicsRepo.ListByChat), лента треда —
-- то же с курсором по seq. Индекс (chat_id, thread_root_id) из 0008 порядка по
-- seq не даёт, и планировщик шёл обратным проходом по (chat_id, seq) всего
-- чата, отбрасывая чужие треды: у пустой темы — весь чат (EXPLAIN на форуме в
-- 200 тыс. сообщений: список тем 510 мс → 60 мс с этим индексом).
-- CONCURRENTLY — без SHARE-замка на messages (прецедент — 0085, 0162).
--
-- Старый idx_messages_thread здесь НЕ удаляется, хотя он — префикс нового:
-- прерванный CREATE INDEX CONCURRENTLY оставляет невалидный индекс, повтор с
-- IF NOT EXISTS его пропускает, и DROP в том же шаге снёс бы единственный
-- рабочий. Удаление — отдельной миграцией с проверкой pg_index.indisvalid.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_thread_seq
    ON messages (chat_id, thread_root_id, seq) WHERE thread_root_id IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS idx_messages_thread_seq;
