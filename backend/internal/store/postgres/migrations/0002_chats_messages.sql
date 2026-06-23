-- +goose Up
CREATE TABLE chats (
  id         BIGSERIAL PRIMARY KEY,
  type       TEXT NOT NULL,            -- 'private' | 'group' | 'channel' | 'saved'
  last_seq   BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_members (
  chat_id       BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member',
  last_read_seq BIGINT NOT NULL DEFAULT 0,
  unread_count  INT NOT NULL DEFAULT 0,
  muted         BOOLEAN NOT NULL DEFAULT false,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX idx_chat_members_user ON chat_members(user_id);

CREATE TABLE messages (
  id            BIGSERIAL PRIMARY KEY,
  chat_id       BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  seq           BIGINT NOT NULL,
  sender_id     BIGINT NOT NULL REFERENCES users(id),
  type          TEXT NOT NULL DEFAULT 'text',
  text          TEXT NOT NULL DEFAULT '',
  reply_to_id   BIGINT,
  client_msg_id TEXT,
  edited_at     TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chat_id, seq)
);
CREATE UNIQUE INDEX idx_messages_client ON messages(chat_id, sender_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;

CREATE TABLE user_state (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pts     BIGINT NOT NULL DEFAULT 0,
  date    BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE updates (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pts        BIGINT NOT NULL,
  pts_count  INT NOT NULL DEFAULT 1,
  type       TEXT NOT NULL,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pts)
);

-- +goose Down
DROP TABLE updates;
DROP TABLE user_state;
DROP TABLE messages;
DROP TABLE chat_members;
DROP TABLE chats;
