-- +goose Up
-- Подписи постов канала (Telegram channels.toggleSignatures): signatures — под
-- постом показывается имя постящего админа; signature_profiles — имя со ссылкой
-- на профиль автора. signature_profiles имеет смысл только при signatures=true.
ALTER TABLE chats
  ADD COLUMN signatures BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN signature_profiles BOOLEAN NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE chats
  DROP COLUMN signatures,
  DROP COLUMN signature_profiles;
