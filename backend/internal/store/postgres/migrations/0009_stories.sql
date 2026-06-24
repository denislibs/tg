-- +goose Up
CREATE TABLE stories (
  id         BIGSERIAL PRIMARY KEY,
  author_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id   BIGINT NOT NULL,
  caption    TEXT NOT NULL DEFAULT '',
  privacy    TEXT NOT NULL DEFAULT 'contacts',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_stories_author_exp ON stories (author_id, expires_at);
CREATE TABLE story_views (
  story_id  BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, viewer_id)
);
CREATE TABLE story_allow (
  story_id BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (story_id, user_id)
);
-- +goose Down
DROP TABLE story_allow; DROP TABLE story_views; DROP TABLE stories;
