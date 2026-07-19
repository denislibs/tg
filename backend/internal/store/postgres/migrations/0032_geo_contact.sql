-- +goose Up
-- Сообщения типа 'geo' (точка на карте) и 'contact' (пересланный контакт).
-- Лёгкие инлайн-поля на messages (как media_id), без отдельных таблиц:
-- гео — пара координат, контакт — снимок имени/телефона + ссылка на аккаунт.
ALTER TABLE messages ADD COLUMN geo_lat DOUBLE PRECISION;
ALTER TABLE messages ADD COLUMN geo_lng DOUBLE PRECISION;
ALTER TABLE messages ADD COLUMN contact_user_id BIGINT;
ALTER TABLE messages ADD COLUMN contact_name TEXT;
ALTER TABLE messages ADD COLUMN contact_phone TEXT;

-- +goose Down
ALTER TABLE messages DROP COLUMN geo_lat;
ALTER TABLE messages DROP COLUMN geo_lng;
ALTER TABLE messages DROP COLUMN contact_user_id;
ALTER TABLE messages DROP COLUMN contact_name;
ALTER TABLE messages DROP COLUMN contact_phone;
