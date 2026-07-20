-- +goose Up
-- Расширение гео-сообщений: venue (место — title/address) и live location
-- (трансляция геопозиции). Всё в одной jsonb-колонке geo_meta, чтобы не плодить
-- узкие колонки: {title, address, live_period, heading, stopped}. Координаты
-- по-прежнему в geo_lat/geo_lng; live-обновление правит их + edited_at.
ALTER TABLE messages ADD COLUMN geo_meta jsonb;

-- +goose Down
ALTER TABLE messages DROP COLUMN geo_meta;
