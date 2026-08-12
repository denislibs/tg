-- +goose Up
-- Картинка превью ссылки теперь наша: og:image скачивается на сервер и живёт
-- обычным медиа (usecase/chat/webpreview.go), а в jsonb web_page едет photo_id
-- вместо чужого адреса. Клиент за картинкой на чужой хост больше не ходит.
--
-- Отдельная колонка, а не выражение по jsonb: по ней проверяется доступ к
-- медиа (MediaAccessRepo.CanAccess — «участник чата, в котором есть сообщение
-- с этой картинкой»), а это горячий запрос на каждую отдачу байтов; индекс по
-- обычной колонке дешевле и понятнее функционального по `web_page->>'photo_id'`.
-- Существующие превью не бэкфиллим: у них картинки лежали на чужих хостах и всё
-- равно резались нашим CSP, так что чинить там нечего — новые превью приедут
-- при следующей отправке ссылки.
ALTER TABLE messages ADD COLUMN web_page_media_id BIGINT;
CREATE INDEX idx_messages_web_page_media ON messages (web_page_media_id) WHERE web_page_media_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS idx_messages_web_page_media;
ALTER TABLE messages DROP COLUMN web_page_media_id;
