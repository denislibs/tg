-- +goose Up
-- Теги аудиофайла (ID3/Vorbis), вычитанные ffprobe при фоновой обработке:
-- title — название трека, performer — исполнитель (1:1 tweb
-- documentAttributeAudio.title/.performer). Nullable без дефолта: NULL — тега в
-- файле нет, и клиент показывает вместо подписи размер файла (tweb audio.ts).
ALTER TABLE media ADD COLUMN title     TEXT;
ALTER TABLE media ADD COLUMN performer TEXT;

-- +goose Down
ALTER TABLE media DROP COLUMN title;
ALTER TABLE media DROP COLUMN performer;
