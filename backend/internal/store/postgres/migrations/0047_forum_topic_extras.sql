-- +goose Up
-- Расширение форум-топиков: emoji-иконка (unicode вместо цветного значка),
-- скрытие, закрепление, порядок (pos) и признак General-темы.
ALTER TABLE forum_topics ADD COLUMN icon_emoji TEXT NOT NULL DEFAULT '';
ALTER TABLE forum_topics ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE forum_topics ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE forum_topics ADD COLUMN pos INT NOT NULL DEFAULT 0;
ALTER TABLE forum_topics ADD COLUMN is_general BOOLEAN NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE forum_topics DROP COLUMN is_general;
ALTER TABLE forum_topics DROP COLUMN pos;
ALTER TABLE forum_topics DROP COLUMN pinned;
ALTER TABLE forum_topics DROP COLUMN hidden;
ALTER TABLE forum_topics DROP COLUMN icon_emoji;
