-- +goose Up
-- Мягкое удаление аккаунта (анонимизация как в Telegram: «Deleted Account»).
-- deleted_at помечает удалённого пользователя; phone освобождается (NULL), поэтому
-- снимаем NOT NULL. UNIQUE сохраняется — Postgres допускает несколько NULL.
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

-- +goose Down
ALTER TABLE users ALTER COLUMN phone SET NOT NULL;
ALTER TABLE users DROP COLUMN deleted_at;
