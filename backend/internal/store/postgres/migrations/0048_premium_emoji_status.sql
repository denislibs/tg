-- +goose Up
ALTER TABLE users ADD COLUMN is_premium   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN emoji_status TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE users DROP COLUMN emoji_status;
ALTER TABLE users DROP COLUMN is_premium;
