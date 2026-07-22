-- +goose Up
-- Эффекты сообщений (наш аналог Telegram message effects): вид полноэкранного
-- canvas-эффекта, проигрываемого при появлении сообщения (fireworks/confetti/…).
ALTER TABLE messages ADD COLUMN effect TEXT;

-- Платные сообщения на Stars (Telegram paid messages): плата за одно сообщение в
-- звёздах для группы. 0 — выключено; списывается с не-админов, начисляется владельцу.
ALTER TABLE chats ADD COLUMN charge_stars INT NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE chats DROP COLUMN charge_stars;
ALTER TABLE messages DROP COLUMN effect;
