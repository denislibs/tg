-- +goose Up
-- Облачный пароль (Telegram Two-Step Verification): bcrypt-хеш + подсказка +
-- почта для восстановления на пользователе; password_login_tokens — короткие
-- одноразовые токены между шагом OTP и шагом пароля при входе.
ALTER TABLE users
    ADD COLUMN password_hash TEXT,
    ADD COLUMN password_hint TEXT NOT NULL DEFAULT '',
    ADD COLUMN recovery_email TEXT NOT NULL DEFAULT '';

CREATE TABLE password_login_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);

-- +goose Down
DROP TABLE password_login_tokens;
ALTER TABLE users
    DROP COLUMN password_hash,
    DROP COLUMN password_hint,
    DROP COLUMN recovery_email;
