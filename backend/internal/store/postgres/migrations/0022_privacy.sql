-- +goose Up
-- Конфиденциальность (tweb Privacy and Security):
--  * privacy_rules — правило видимости/доступа на пользователя и ключ
--    (phone_number/last_seen/profile_photo/about/calls/forwards/chat_invite/
--    messages/birthday/voice_messages/added_by_phone) со значением
--    everybody|contacts|nobody и точечными исключениями (allow/deny, jsonb-списки
--    user_id). Отсутствие строки = дефолт ключа (domain.DefaultPrivacyValue).
--  * user_blocks — глобальный чёрный список: заблокированный не может писать,
--    звонить и приглашать блокировщика, не видит его фото/last seen.
CREATE TABLE privacy_rules (
    user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key            TEXT NOT NULL,
    value          TEXT NOT NULL,
    allow_user_ids JSONB NOT NULL DEFAULT '[]',
    deny_user_ids  JSONB NOT NULL DEFAULT '[]',
    PRIMARY KEY (user_id, key)
);

CREATE TABLE user_blocks (
    blocker_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX user_blocks_blocked_idx ON user_blocks (blocked_id);

-- Скрытая атрибуция пересылки (privacy forwards = nobody/contacts): вместо
-- ссылки на аккаунт (fwd_from_user_id) сохраняется только имя автора текстом.
ALTER TABLE messages ADD COLUMN fwd_from_name TEXT;

-- +goose Down
ALTER TABLE messages DROP COLUMN fwd_from_name;
DROP TABLE user_blocks;
DROP TABLE privacy_rules;
