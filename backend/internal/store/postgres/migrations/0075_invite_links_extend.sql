-- +goose Up
-- Расширение инвайт-ссылок (Telegram exportedChatInvite): человекочитаемое имя
-- ссылки (title) + трекинг вступивших по конкретной ссылке (invite_link_joins,
-- источник для «Members joined by this link»). Запись добавляется в момент
-- фактического добавления пользователя в участники (прямое вступление или
-- одобрение заявки), уникальна на пару (token, user_id).
ALTER TABLE invite_links ADD COLUMN title TEXT NOT NULL DEFAULT '';

CREATE TABLE invite_link_joins (
  id        BIGSERIAL PRIMARY KEY,
  chat_id   BIGINT NOT NULL,
  token     TEXT NOT NULL,
  user_id   BIGINT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token, user_id)
);
CREATE INDEX idx_invite_link_joins_token ON invite_link_joins (token);

-- +goose Down
DROP TABLE invite_link_joins;
ALTER TABLE invite_links DROP COLUMN title;
