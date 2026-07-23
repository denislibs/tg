-- +goose Up
-- Транскрипция голосового/видео-кружка (Telegram messages.transcribeAudio):
-- расшифрованный текст кэшируется одной колонкой на строке сообщения. NULL —
-- расшифровки ещё не запрашивали. Пишется отдельным UPDATE (см.
-- messages_repo.SetTranscription), в INSERT не участвует. Реального движка
-- speech-to-text у нас нет — сервер кладёт детерминированный демо-стаб.
ALTER TABLE messages ADD COLUMN transcription TEXT;

-- +goose Down
ALTER TABLE messages DROP COLUMN transcription;
