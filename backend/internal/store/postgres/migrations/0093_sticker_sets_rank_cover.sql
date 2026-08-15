-- +goose Up
-- rank — позиция набора в трендах Telegram (messages.getFeaturedStickers отдаёт
-- их упорядоченными; порядок и есть та выдача, что видит пользователь в панели).
-- 0 — набор вне трендов, такие уходят в конец выдачи.
-- cover_media_id — обложка набора (иконка вкладки панели, tweb stickerSetThumb);
-- NULL — обложки нет, клиент рисует первый стикер набора.
ALTER TABLE sticker_sets ADD COLUMN rank INT NOT NULL DEFAULT 0;
ALTER TABLE sticker_sets ADD COLUMN cover_media_id BIGINT REFERENCES media(id);
CREATE INDEX sticker_sets_rank_idx ON sticker_sets(rank) WHERE rank > 0;

-- +goose Down
DROP INDEX sticker_sets_rank_idx;
ALTER TABLE sticker_sets DROP COLUMN cover_media_id;
ALTER TABLE sticker_sets DROP COLUMN rank;
