-- +goose Up
-- Время прочтения приватного чата (tweb outboxReadDate / getOutboxReadDate):
-- когда участник в последний раз продвинул свой read-горизонт. Отправитель
-- показывает по нему «Прочитано в HH:MM» на исходящих прочитанных сообщениях.
-- NULL — участник ещё ничего не прочитал. Обновляется только при реальном
-- продвижении горизонта (SetRead), повторное открытие без новых сообщений время
-- не трогает.
ALTER TABLE chat_members ADD COLUMN last_read_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE chat_members DROP COLUMN last_read_at;
