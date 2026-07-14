-- +goose Up
-- media_unread — «содержимое не прослушано/не просмотрено» для голосовых и
-- видео-кружков (телеграмный pFlags.media_unread). Ставится при отправке,
-- снимается, когда получатель воспроизвёл сообщение.
ALTER TABLE messages ADD COLUMN media_unread boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE messages DROP COLUMN media_unread;
