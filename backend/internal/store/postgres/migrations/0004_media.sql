-- +goose Up
CREATE TABLE media (
  id           BIGSERIAL PRIMARY KEY,
  owner_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bucket       TEXT NOT NULL,
  object_key   TEXT NOT NULL,
  mime         TEXT NOT NULL DEFAULT '',
  size         BIGINT NOT NULL DEFAULT 0,
  width        INT NOT NULL DEFAULT 0,
  height       INT NOT NULL DEFAULT 0,
  duration     INT NOT NULL DEFAULT 0,
  blur_preview BYTEA,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE messages ADD COLUMN media_id BIGINT REFERENCES media(id);

-- +goose Down
ALTER TABLE messages DROP COLUMN media_id;
DROP TABLE media;
