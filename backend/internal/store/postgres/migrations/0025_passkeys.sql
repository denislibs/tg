-- +goose Up
-- Ключи доступа (passkeys, WebAuthn): discoverable credentials для входа без
-- пароля. credential — сериализованный webauthn.Credential (jsonb), cred_id —
-- base64url id ключа для поиска при входе.
CREATE TABLE passkeys (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL DEFAULT '',
    cred_id      TEXT NOT NULL UNIQUE,
    credential   JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);
CREATE INDEX passkeys_user_idx ON passkeys (user_id);

-- +goose Down
DROP TABLE passkeys;
