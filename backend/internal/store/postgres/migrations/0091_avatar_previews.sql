-- +goose Up
-- Stripped-превью аватарок (крошечный JPEG ~40px, генерирует бэкенд при
-- установке/смене аватарки — см. usecase/auth SetAvatar/AddProfilePhoto).
-- Поля nullable НАМЕРЕННО: существующие аватарки не бэкфиллим (пересчёт всех
-- медиа дорог и не нужен) — у старых аватарок превью NULL, клиент фолбэкает на
-- градиент, как и раньше. Превью фото групп/каналов отдельной колонки не требует:
-- chats.photo_media_id ссылается на media, blur_preview берётся оттуда джойном.
ALTER TABLE users ADD COLUMN avatar_preview BYTEA;
-- Превью на строке галереи: при удалении текущей аватарки users.avatar_preview
-- откатывается к превью следующего по свежести фото вместе с avatar_url.
ALTER TABLE profile_photos ADD COLUMN preview BYTEA;

-- +goose Down
ALTER TABLE profile_photos DROP COLUMN preview;
ALTER TABLE users DROP COLUMN avatar_preview;
