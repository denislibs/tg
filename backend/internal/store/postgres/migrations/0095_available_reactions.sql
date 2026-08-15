-- +goose Up
-- Доступные реакции (Telegram messages.getAvailableReactions). У реакции не один
-- файл, а роли: статичная иконка чипа, анимация появления, выбора, активации,
-- эффект вокруг и «чистый» центральный кадр — поэтому это отдельная таблица, а
-- не набор стикеров. Каждая роль — обычная запись media.
CREATE TABLE available_reactions (
  emoji             TEXT PRIMARY KEY,
  title             TEXT NOT NULL DEFAULT '',
  position          INT  NOT NULL DEFAULT 0,
  premium           BOOLEAN NOT NULL DEFAULT false,
  inactive          BOOLEAN NOT NULL DEFAULT false,
  static_media_id   BIGINT REFERENCES media(id),
  appear_media_id   BIGINT REFERENCES media(id),
  select_media_id   BIGINT REFERENCES media(id),
  activate_media_id BIGINT REFERENCES media(id),
  effect_media_id   BIGINT REFERENCES media(id),
  around_media_id   BIGINT REFERENCES media(id),
  center_media_id   BIGINT REFERENCES media(id)
);

-- +goose Down
DROP TABLE available_reactions;
