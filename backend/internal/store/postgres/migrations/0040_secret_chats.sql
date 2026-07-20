-- +goose Up
-- Секретные чаты (E2E, device-local). Чат — обычная строка chats(type='secret')
-- между двумя юзерами; здесь хранится handshake (только публичные ключи) и
-- состояние. Сервер НИКОГДА не видит приватные ключи и plaintext.
CREATE TABLE secret_chats (
    chat_id       BIGINT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
    initiator_id  BIGINT NOT NULL,
    responder_id  BIGINT NOT NULL,
    initiator_pub BYTEA NOT NULL,
    responder_pub BYTEA,
    state         TEXT NOT NULL DEFAULT 'requested', -- requested|accepted|rejected|discarded
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Шифртекст сообщения секретного чата (тип 'encrypted'): iv||ciphertext, blob.
-- text/entities у таких сообщений пустые. TTL self-destruct: ttl_seconds задаётся
-- отправителем, destruct_at выставляется на сервере при прочтении получателем.
ALTER TABLE messages ADD COLUMN enc_body    BYTEA;
ALTER TABLE messages ADD COLUMN ttl_seconds INT;
ALTER TABLE messages ADD COLUMN destruct_at TIMESTAMPTZ;
CREATE INDEX messages_destruct_idx ON messages (destruct_at) WHERE destruct_at IS NOT NULL;

-- +goose Down
DROP INDEX messages_destruct_idx;
ALTER TABLE messages DROP COLUMN destruct_at;
ALTER TABLE messages DROP COLUMN ttl_seconds;
ALTER TABLE messages DROP COLUMN enc_body;
DROP TABLE secret_chats;
