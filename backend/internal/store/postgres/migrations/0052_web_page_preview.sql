-- +goose Up
-- Серверное превью ссылки (Telegram webPage): снимок og-тегов первой
-- http/https-ссылки текстового сообщения. Заполняется асинхронно после
-- коммита отправки отдельным UPDATE (кадр web_page_update догоняет клиентов).
ALTER TABLE messages ADD COLUMN web_page JSONB;

-- +goose Down
ALTER TABLE messages DROP COLUMN web_page;
