-- +goose Up
-- Галерея фото профиля (Telegram getUserPhotos): у юзера несколько фото, самое
-- свежее — текущий аватар (денормализовано в users.avatar_url для существующих
-- потребителей). video_url — опциональный видео-вариант (видео-аватары).
CREATE TABLE profile_photos (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url        TEXT NOT NULL,
    video_url  TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX profile_photos_user_idx ON profile_photos (user_id, created_at DESC);

-- Бэкфилл: существующие аватары становятся фото #1.
INSERT INTO profile_photos (user_id, url) SELECT id, avatar_url FROM users WHERE avatar_url <> '';

-- +goose Down
DROP TABLE profile_photos;
