-- +goose Up
CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE chats
  ADD COLUMN title           TEXT NOT NULL DEFAULT '',
  ADD COLUMN username        CITEXT,
  ADD COLUMN about           TEXT NOT NULL DEFAULT '',
  ADD COLUMN photo_media_id  BIGINT,
  ADD COLUMN creator_id      BIGINT,
  ADD COLUMN member_count    INT NOT NULL DEFAULT 0,
  ADD COLUMN is_public       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN channel_pts     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN pinned_msg_id   BIGINT;
CREATE UNIQUE INDEX idx_chats_username ON chats (username) WHERE username IS NOT NULL;

ALTER TABLE chat_members
  ADD COLUMN rights INT NOT NULL DEFAULT 0;

CREATE TABLE channel_updates (
  id         BIGSERIAL PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  pts        BIGINT NOT NULL,
  pts_count  INT NOT NULL DEFAULT 1,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_channel_updates ON channel_updates (channel_id, pts);

CREATE TABLE invite_links (
  id          BIGSERIAL PRIMARY KEY,
  chat_id     BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  created_by  BIGINT NOT NULL,
  expires_at  TIMESTAMPTZ,
  usage_limit INT,
  uses        INT NOT NULL DEFAULT 0,
  revoked     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invite_links_chat ON invite_links (chat_id);

-- +goose Down
DROP TABLE invite_links;
DROP TABLE channel_updates;
ALTER TABLE chat_members DROP COLUMN rights;
DROP INDEX IF EXISTS idx_chats_username;
ALTER TABLE chats
  DROP COLUMN title, DROP COLUMN username, DROP COLUMN about, DROP COLUMN photo_media_id,
  DROP COLUMN creator_id, DROP COLUMN member_count, DROP COLUMN is_public,
  DROP COLUMN channel_pts, DROP COLUMN pinned_msg_id;
