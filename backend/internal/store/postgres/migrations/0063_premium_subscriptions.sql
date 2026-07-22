-- +goose Up
-- Telegram Premium subscription (clone: mock checkout, no real billing). One row
-- per subscriber; the users.is_premium flag mirrors "has an active row".
CREATE TABLE premium_subscriptions (
    user_id     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    plan        TEXT        NOT NULL,
    price_cents INT         NOT NULL,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    auto_renew  BOOLEAN     NOT NULL DEFAULT true
);

-- +goose Down
DROP TABLE premium_subscriptions;
