-- +goose Up
-- «Очистить историю» у себя: персональный горизонт — сообщения с seq <= cleared_max_seq
-- скрыты для этого участника (не удаляются у других). Аналог deleteHistory just_clear.
ALTER TABLE chat_members ADD COLUMN cleared_max_seq BIGINT NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE chat_members DROP COLUMN cleared_max_seq;
