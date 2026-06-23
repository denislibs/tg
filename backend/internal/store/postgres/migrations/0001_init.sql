-- +goose Up
CREATE TABLE users (
  id           BIGSERIAL PRIMARY KEY,
  phone        TEXT UNIQUE NOT NULL,
  username     TEXT UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  bio          TEXT NOT NULL DEFAULT '',
  avatar_url   TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  platform    TEXT NOT NULL DEFAULT '',
  token_hash  TEXT UNIQUE NOT NULL,
  last_active TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_codes (
  phone      TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- +goose Down
DROP TABLE auth_codes;
DROP TABLE devices;
DROP TABLE users;
