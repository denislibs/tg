-- +goose Up
CREATE TABLE close_friends (
  owner_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, user_id)
);
CREATE INDEX idx_close_friends_owner ON close_friends (owner_id);
-- +goose Down
DROP TABLE close_friends;
