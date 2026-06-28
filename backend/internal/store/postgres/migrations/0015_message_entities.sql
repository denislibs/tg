-- +goose Up
-- Rich-text formatting spans (Telegram MessageEntity[]). NULL = plain text.
ALTER TABLE messages ADD COLUMN entities JSONB;

-- +goose Down
ALTER TABLE messages DROP COLUMN entities;
