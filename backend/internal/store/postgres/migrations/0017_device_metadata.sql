-- +goose Up
-- Session metadata for the Active Sessions screen: where the login came from.
-- Filled at sign-in from the request (User-Agent → name, IP, GeoIP → location).
ALTER TABLE devices ADD COLUMN ip TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN location TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE devices DROP COLUMN location;
ALTER TABLE devices DROP COLUMN ip;
