-- +goose Up
-- Папки чатов (tweb DialogFilter): title + флаги типов включения
-- (contacts/non_contacts/groups/broadcasts/bots) + флаги исключения
-- (exclude_muted/exclude_read) + точечные include/exclude списки chat_id (jsonb).
-- Сопоставление диалога папке (testDialogForFilter) выполняется на клиенте,
-- бэкенд хранит только определения.
CREATE TABLE folders (
    id            BIGSERIAL PRIMARY KEY,
    owner_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    pos           INT NOT NULL DEFAULT 0,
    contacts      BOOLEAN NOT NULL DEFAULT false,
    non_contacts  BOOLEAN NOT NULL DEFAULT false,
    groups        BOOLEAN NOT NULL DEFAULT false,
    broadcasts    BOOLEAN NOT NULL DEFAULT false,
    bots          BOOLEAN NOT NULL DEFAULT false,
    exclude_muted BOOLEAN NOT NULL DEFAULT false,
    exclude_read  BOOLEAN NOT NULL DEFAULT false,
    include_chats JSONB,
    exclude_chats JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX folders_owner_idx ON folders (owner_id, pos, id);

-- +goose Down
DROP TABLE folders;
