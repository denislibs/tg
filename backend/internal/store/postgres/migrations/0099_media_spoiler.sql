-- +goose Up
-- media_spoiler — «медиа скрыто спойлером»: аналог telegram-флага
-- messageMedia.pFlags.spoiler (tweb makeMessageMediaInput.ts:13,24). Ставит
-- ОТПРАВИТЕЛЬ на конкретное сообщение при отправке — это не свойство файла
-- (в отличие от media.animated), а свойство вложения в сообщении: одно и то же
-- медиа можно отправить со спойлером и без. Поэтому колонка на messages, а не
-- на media.
--
-- Клиент по этому флагу рисует медиа под анимированной «шумовой» заслонкой,
-- снимаемой кликом, и не автоплеит видео (tweb bubbles.ts:8570 — noAutoplay-
-- Attribute, :8579 — wrapMediaSpoiler поверх attachmentDiv).
--
-- DEFAULT FALSE для уже загруженных строк: старые сообщения спойлера не имели,
-- «показывать как обычно» — единственный верный исход.
ALTER TABLE messages ADD COLUMN media_spoiler BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down
ALTER TABLE messages DROP COLUMN media_spoiler;
