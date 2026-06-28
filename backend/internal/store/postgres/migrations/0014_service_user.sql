-- +goose Up
-- Verified/service flags + the reserved official "Telegram" service account that
-- delivers system notifications (login alerts, etc.). The id is fixed (777000,
-- like real Telegram) so the app can address it without a lookup; afterwards the
-- BIGSERIAL sequence is bumped past it so future users never collide.
ALTER TABLE users
  ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN is_service  BOOLEAN NOT NULL DEFAULT false;

INSERT INTO users (id, phone, username, first_name, display_name, is_verified, is_service)
VALUES (777000, '+0000000777000', 'telegram', 'Telegram', 'Telegram', true, true)
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT max(id) FROM users), 777000));

-- +goose Down
DELETE FROM users WHERE id = 777000;
ALTER TABLE users
  DROP COLUMN is_service,
  DROP COLUMN is_verified;
