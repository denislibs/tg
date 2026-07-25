-- +goose Up
ALTER TABLE stories ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stories ADD COLUMN edited BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX idx_stories_pinned ON stories (author_id) WHERE pinned;
-- +goose Down
DROP INDEX idx_stories_pinned;
ALTER TABLE stories DROP COLUMN edited;
ALTER TABLE stories DROP COLUMN pinned;
