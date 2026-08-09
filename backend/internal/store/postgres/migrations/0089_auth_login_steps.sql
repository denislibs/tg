-- +goose Up
-- Одноразовые артефакты трёх недостающих веток входа. Везде хранится только
-- ХЕШ токена (как в password_login_tokens) + срок жизни; сырое значение живёт
-- лишь у клиента.

-- Шаг регистрации (Telegram auth.authorizationSignUpRequired → auth.signUp):
-- номер уже подтверждён кодом, пользователя ещё нет — поэтому не FK на users,
-- а сам номер.
CREATE TABLE signup_tokens (
    token_hash TEXT PRIMARY KEY,
    phone      TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX signup_tokens_expires_idx ON signup_tokens (expires_at);

-- Восстановление облачного пароля по почте (auth.requestPasswordRecovery →
-- auth.recoverPassword). Ключ — хеш того же password_token, что выдал вход:
-- сброс привязан к уже пройденному шагу OTP. next_send_at — серверный таймер
-- повторной отправки (30 с), чтобы частота не зависела от клиента.
CREATE TABLE password_recovery_codes (
    token_hash   TEXT PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash    TEXT NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    next_send_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX password_recovery_codes_expires_idx ON password_recovery_codes (expires_at);

-- Вход по веб-токену (#?tgWebAuthToken=… → auth.importWebTokenAuthorization).
CREATE TABLE web_auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX web_auth_tokens_expires_idx ON web_auth_tokens (expires_at);

-- +goose Down
DROP TABLE web_auth_tokens;
DROP TABLE password_recovery_codes;
DROP TABLE signup_tokens;
