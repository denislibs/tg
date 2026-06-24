-- +goose Up
ALTER TABLE invite_links ADD COLUMN requires_approval BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE join_requests (
  id           BIGSERIAL PRIMARY KEY,
  chat_id      BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_token TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chat_id, user_id)
);
CREATE INDEX idx_join_requests_chat ON join_requests (chat_id);
-- +goose Down
DROP TABLE join_requests;
ALTER TABLE invite_links DROP COLUMN requires_approval;
