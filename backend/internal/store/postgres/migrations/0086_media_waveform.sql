-- +goose Up
-- Пики waveform голосового сообщения (5-битная упаковка, ~63 байта), посчитанные
-- клиентом при записи (1:1 tweb documentAttributeAudio.waveform). Получатель рисует
-- бары из них, а не пересчитывает из аудиофайла.
ALTER TABLE media ADD COLUMN waveform BYTEA;

-- +goose Down
ALTER TABLE media DROP COLUMN waveform;
