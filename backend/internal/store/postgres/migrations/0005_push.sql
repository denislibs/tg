-- +goose Up
CREATE TABLE push_subscriptions (
  id         BIGSERIAL PRIMARY KEY,
  device_id  BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_subs_device ON push_subscriptions(device_id);

-- +goose Down
DROP TABLE push_subscriptions;
