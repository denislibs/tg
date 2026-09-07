-- +goose NO TRANSACTION
-- +goose Up
-- Индексы под шаред-медиа профиля: постраничную выборку вкладки
-- (adapter/repo/postgres/messagesrepo.go::MediaHistory) и батч-счётчики вкладок
-- (::SearchCounters, аналог MTProto messages.getSearchCounters).
--
-- Было: на выборку «сообщения чата такого-то вида» работал только
-- UNIQUE(chat_id, seq) из 0002 — он даёт порядок, но не отбор по типу, поэтому
-- точный count(*) по вкладке уходил в Seq Scan по ВСЕЙ таблице messages.
-- Замер на эфемерном контейнере (postgres:16-alpine, два чата по 50 000
-- сообщений, EXPLAIN ANALYZE):
--
--   count(*) вкладки «Голосовые»      7.93 мс (Seq Scan 100k)  →  0.46 мс (Index Only Scan)
--   count(*) вкладки «Ссылки»        35.2  мс (Seq Scan 100k)  →  1.62 мс
--   счётчики всех пяти вкладок сразу 30.9  мс                  → 10.8  мс
--   счётчики четырёх без «Ссылок»    14.6  мс                  →  2.34 мс
--   первая страница пустой вкладки    0.061 мс                 →  0.059 мс (и так по seq-индексу)
--
-- Размер на 100 000 сообщений: idx_messages_shared_media 4 МБ,
-- idx_messages_shared_links 408 КБ.
--
-- Порядок колонок (chat_id, type, seq DESC) — ровно порядок запроса: равенство
-- по чату, отбор по типу, затем курсор `seq < offset_id` и `ORDER BY seq DESC`
-- без сортировки. Partial по deleted_at IS NULL: удалённые в выдачу не входят
-- никогда, и предикат совпадает с WHERE запроса дословно (иначе планировщик
-- индекс не возьмёт).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_shared_media
  ON messages (chat_id, type, seq DESC) WHERE deleted_at IS NULL;

-- Вкладка «Ссылки» отбирается не типом, а регекспом по тексту, поэтому в
-- индекс выше она не попадает и оставалась единственным Seq Scan'ом. Отдельный
-- partial-индекс держит только сообщения со ссылкой — их в чате единицы
-- процентов.
--
-- ВНИМАНИЕ: предикат ДОСЛОВНО повторяет условие фильтра `links` в
-- adapter/repo/postgres/messagesrepo.go::mediaFilterCond. Разойдутся — ошибки не
-- будет, планировщик просто перестанет брать индекс и вкладка тихо вернётся к
-- Seq Scan. Меняя фильтр, менять и индекс (новой миграцией).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_shared_links
  ON messages (chat_id, seq DESC)
  WHERE deleted_at IS NULL AND type = 'text' AND text ~* 'https?://';

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS idx_messages_shared_links;
DROP INDEX CONCURRENTLY IF EXISTS idx_messages_shared_media;
