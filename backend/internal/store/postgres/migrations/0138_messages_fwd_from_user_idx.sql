-- +goose Up
-- «Известен ли пользователь зрителю» (GroupRepo.KnownUserIDs, ручка /users?ids=)
-- спрашивает, пересылал ли кто-то в чат зрителя сообщение этого автора.
-- Без индекса это полный проход по messages на каждый неизвестный id.
CREATE INDEX IF NOT EXISTS idx_messages_fwd_from_user ON messages (fwd_from_user_id) WHERE fwd_from_user_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS idx_messages_fwd_from_user;
