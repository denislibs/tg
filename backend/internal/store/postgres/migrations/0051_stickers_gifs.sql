-- +goose Up
-- Стикеры и GIF: наборы (обычные и emoji-наборы для больших анимированных
-- эмодзи), содержимое наборов, установленные пользователем наборы, недавние и
-- избранные стикеры, сохранённые GIF. Файл стикера — обычная запись media.
CREATE TABLE sticker_sets (
  id         BIGSERIAL PRIMARY KEY,
  slug       TEXT UNIQUE NOT NULL,
  title      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'sticker' CHECK (kind IN ('sticker','emoji')),
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stickers (
  id       BIGSERIAL PRIMARY KEY,
  set_id   BIGINT NOT NULL REFERENCES sticker_sets(id) ON DELETE CASCADE,
  media_id BIGINT NOT NULL REFERENCES media(id),
  emoji    TEXT NOT NULL DEFAULT '',
  position INT NOT NULL DEFAULT 0
);
CREATE INDEX stickers_set_id_idx ON stickers(set_id);

CREATE TABLE user_sticker_sets (
  user_id  BIGINT REFERENCES users(id),
  set_id   BIGINT REFERENCES sticker_sets(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, set_id)
);

CREATE TABLE recent_stickers (
  user_id    BIGINT NOT NULL,
  sticker_id BIGINT REFERENCES stickers(id) ON DELETE CASCADE,
  used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sticker_id)
);

CREATE TABLE faved_stickers (
  user_id    BIGINT NOT NULL,
  sticker_id BIGINT REFERENCES stickers(id) ON DELETE CASCADE,
  faved_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sticker_id)
);

CREATE TABLE saved_gifs (
  user_id  BIGINT NOT NULL,
  media_id BIGINT REFERENCES media(id),
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, media_id)
);

-- +goose Down
DROP TABLE saved_gifs;
DROP TABLE faved_stickers;
DROP TABLE recent_stickers;
DROP TABLE user_sticker_sets;
DROP TABLE stickers;
DROP TABLE sticker_sets;
