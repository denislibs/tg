-- +goose Up
-- Stories 4d: интерактивные media-areas (tweb MediaArea) как jsonb-массив и
-- ссылка на исходную историю при репосте (tweb fwd_from).
ALTER TABLE stories ADD COLUMN media_areas jsonb NOT NULL DEFAULT '[]';
ALTER TABLE stories ADD COLUMN fwd_from_author_id BIGINT;
ALTER TABLE stories ADD COLUMN fwd_from_story_id BIGINT;
-- +goose Down
ALTER TABLE stories DROP COLUMN fwd_from_story_id;
ALTER TABLE stories DROP COLUMN fwd_from_author_id;
ALTER TABLE stories DROP COLUMN media_areas;
