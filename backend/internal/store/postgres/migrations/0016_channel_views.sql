-- +goose Up
-- Per-post view counter for channel posts (Telegram "9.2K 👁"). Cumulative,
-- deduplicated per viewer via message_views so re-reads don't inflate the count.
ALTER TABLE messages ADD COLUMN views BIGINT NOT NULL DEFAULT 0;

CREATE TABLE message_views (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- +goose Down
DROP TABLE message_views;
ALTER TABLE messages DROP COLUMN views;
