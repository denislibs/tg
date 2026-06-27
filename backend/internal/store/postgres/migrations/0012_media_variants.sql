-- +goose Up
-- Server-side media processing: store the original filename (for documents/music)
-- and a generated thumbnail/poster object key. Dimensions/duration are (re)filled
-- by ffprobe on the server after upload.
ALTER TABLE media
  ADD COLUMN file_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN thumb_key TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE media
  DROP COLUMN file_name,
  DROP COLUMN thumb_key;
