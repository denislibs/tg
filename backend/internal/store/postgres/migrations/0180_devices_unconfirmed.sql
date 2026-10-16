-- +goose Up
-- «Новый вход» (М1-3, Б-3): devices.unconfirmed — сессия выдана входом, который
-- не одобрила уже вошедшая сессия, при наличии других сессий у аккаунта.
-- Остальные устройства спрашивают «это вы?» (tweb appAccountManager.ts:277-294).
-- Существующие сессии — подтверждённые (DEFAULT false). ADD COLUMN с константным
-- DEFAULT не перезаписывает таблицу.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS unconfirmed BOOLEAN NOT NULL DEFAULT false;

-- password_login_tokens.approved — вход одобрила уже вошедшая сессия (QR, веб-токен):
-- признак переживает шаг облачного пароля и доходит до выпуска сессии.
ALTER TABLE password_login_tokens ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE password_login_tokens DROP COLUMN IF EXISTS approved;
ALTER TABLE devices DROP COLUMN IF EXISTS unconfirmed;
