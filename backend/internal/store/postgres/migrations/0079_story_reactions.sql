-- +goose Up
CREATE TABLE story_reactions (
  story_id   BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id)
);
CREATE INDEX idx_story_reactions_story ON story_reactions (story_id);
-- +goose Down
DROP TABLE story_reactions;
