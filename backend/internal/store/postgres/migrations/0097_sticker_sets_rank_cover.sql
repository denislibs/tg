-- +goose Up
-- rank — позиция набора в трендах Telegram (messages.getFeaturedStickers отдаёт
-- их упорядоченными; порядок и есть та выдача, что видит пользователь в панели).
-- 0 — набор вне трендов, такие уходят в конец выдачи.
-- cover_media_id — обложка набора (иконка вкладки панели, tweb stickerSetThumb);
-- NULL — обложки нет, клиент рисует первый стикер набора.
--
-- Номер 0097, а не 0093: изначально файл был 0093, но параллельной веткой в main
-- уже приехал свой 0093_discussion_mirrors — goose падает на дубликате версии и
-- сервис не стартует. Переезжает эта миграция, потому что discussion_mirrors
-- заняла номер раньше.
--
-- Индекса по rank здесь нет намеренно: btree по колонке не обслуживает
-- сортировку FeaturedSets (`ORDER BY (s.rank = 0), s.rank, …` — ведущий ключ
-- ВЫРАЖЕНИЕ), поэтому планировщик его не возьмёт. Подробный разбор — в 0094,
-- которая этот индекс и удаляла, пока он ещё создавался здесь.
ALTER TABLE sticker_sets ADD COLUMN rank INT NOT NULL DEFAULT 0;
ALTER TABLE sticker_sets ADD COLUMN cover_media_id BIGINT REFERENCES media(id);

-- +goose Down
ALTER TABLE sticker_sets DROP COLUMN cover_media_id;
ALTER TABLE sticker_sets DROP COLUMN rank;
