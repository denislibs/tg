-- +goose Up
-- path_thumb — векторный контур стикера (Telegram photoPathSize, 142-195 байт).
-- Приходит вместе с документом и разворачивается клиентом в SVG-силуэт, который
-- виден мгновенно, пока грузится сам файл (tweb wrappers/sticker.ts:268).
-- Лежит у стикера, а не в media: это метаданные набора, а не отдельный файл.
ALTER TABLE stickers ADD COLUMN path_thumb BYTEA;

-- +goose Down
ALTER TABLE stickers DROP COLUMN path_thumb;
