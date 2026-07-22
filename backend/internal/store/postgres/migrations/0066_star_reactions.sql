-- +goose Up
-- Платные ⭐-реакции (Telegram paid/star reactions): на сообщение можно потратить
-- звёзды накопительно. Агрегат сообщения = SUM(stars). Хранится в отдельной
-- таблице (как paid_media), в read-модель подмешивается hydrate'ом — колонки
-- messages не раздуваются. anonymous скрывает отправителя в списке топ-отправителей.
CREATE TABLE star_reactions (
  message_id BIGINT  NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars      BIGINT  NOT NULL CHECK (stars > 0),
  anonymous  BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX idx_star_reactions_message ON star_reactions(message_id);

-- +goose Down
DROP TABLE star_reactions;
