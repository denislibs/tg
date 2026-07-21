-- +goose Up
-- Chunked/resumable uploads: large files are sent as fixed-size parts and
-- assembled with a MinIO server-side multipart upload. media.upload_id holds the
-- in-flight multipart id (empty when none / after finalize); upload_total is the
-- declared part count (for the resume query). media_upload_parts tracks each
-- received part's S3 ETag so finalize can complete the multipart from the DB
-- without a ListParts round-trip.
ALTER TABLE media ADD COLUMN upload_id    TEXT NOT NULL DEFAULT '';
ALTER TABLE media ADD COLUMN upload_total INT  NOT NULL DEFAULT 0;

CREATE TABLE media_upload_parts (
    media_id   BIGINT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    part_index INT    NOT NULL,
    etag       TEXT   NOT NULL,
    size       BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (media_id, part_index)
);

-- +goose Down
DROP TABLE media_upload_parts;
ALTER TABLE media DROP COLUMN upload_total;
ALTER TABLE media DROP COLUMN upload_id;
