-- +goose Up
-- Счётчик пересылок поста канала (Telegram message.forwards): сколько раз пост
-- переслали. Инкрементируется при пересылке; отображается под постом, как views.
ALTER TABLE messages ADD COLUMN forwards BIGINT NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE messages DROP COLUMN forwards;
