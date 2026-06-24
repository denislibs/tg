-- +goose Up
-- Profile fields: split name into first/last (display_name stays as the cached
-- concatenation everyone already reads), bio already exists, plus birthday and a
-- phone-visibility privacy setting. Username becomes CITEXT so uniqueness and
-- @search are case-insensitive (chats.username is already CITEXT, see 0006).
CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE users
  ADD COLUMN first_name       TEXT NOT NULL DEFAULT '',
  ADD COLUMN last_name        TEXT NOT NULL DEFAULT '',
  ADD COLUMN birthday         DATE,
  ADD COLUMN phone_visibility TEXT NOT NULL DEFAULT 'contacts';

ALTER TABLE users ALTER COLUMN username TYPE CITEXT;

-- +goose Down
ALTER TABLE users ALTER COLUMN username TYPE TEXT;
ALTER TABLE users
  DROP COLUMN phone_visibility,
  DROP COLUMN birthday,
  DROP COLUMN last_name,
  DROP COLUMN first_name;
