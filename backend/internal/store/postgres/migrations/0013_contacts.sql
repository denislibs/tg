-- +goose Up
-- Address book: a directed owner→user relation with a per-owner saved name (the
-- name you give a contact is yours, independent of their profile name) plus an
-- optional note and a "share my phone" flag. Composite PK makes re-adding the same
-- person an upsert (edit), not a duplicate.
CREATE TABLE contacts (
  owner_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_name  TEXT NOT NULL DEFAULT '',
  last_name   TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  share_phone BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, user_id)
);

-- List/lookup a user's address book ordered by saved name.
CREATE INDEX contacts_owner_idx ON contacts (owner_id, first_name, last_name);

-- +goose Down
DROP TABLE contacts;
