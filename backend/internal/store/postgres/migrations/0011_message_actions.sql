-- +goose Up
-- Message actions: forward attribution, per-user "delete for me", and pins.
-- (edited_at / deleted_at already exist on messages — see 0002.)

-- Forward origin so a forwarded message can render "Переслано от X".
ALTER TABLE messages
  ADD COLUMN fwd_from_user_id BIGINT,
  ADD COLUMN fwd_from_chat_id BIGINT,
  ADD COLUMN fwd_from_msg_id  BIGINT,
  ADD COLUMN fwd_date         TIMESTAMPTZ;

-- "Delete for me": rows hidden only for the given user. History filters these
-- out for the requesting user; the message stays visible for everyone else.
CREATE TABLE message_hides (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  msg_id  BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, msg_id)
);

-- Pinned messages (multiple per chat; newest pin shown first).
CREATE TABLE pinned_messages (
  chat_id   BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  msg_id    BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_by BIGINT NOT NULL REFERENCES users(id),
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, msg_id)
);
CREATE INDEX idx_pinned_messages_chat ON pinned_messages(chat_id, pinned_at DESC);

-- +goose Down
DROP TABLE pinned_messages;
DROP TABLE message_hides;
ALTER TABLE messages
  DROP COLUMN fwd_date,
  DROP COLUMN fwd_from_msg_id,
  DROP COLUMN fwd_from_chat_id,
  DROP COLUMN fwd_from_user_id;
