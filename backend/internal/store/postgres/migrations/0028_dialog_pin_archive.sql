-- +goose Up
-- Закрепление и архив диалогов — пер-юзерные флаги членства (tweb: pinned
-- dialogs + folder_id=1). pinned_at хранит момент закрепления: свежезакреплённый
-- диалог встаёт первым (ORDER BY pinned_at DESC).
ALTER TABLE chat_members ADD COLUMN pinned_at TIMESTAMPTZ;
ALTER TABLE chat_members ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE chat_members DROP COLUMN pinned_at;
ALTER TABLE chat_members DROP COLUMN archived;
