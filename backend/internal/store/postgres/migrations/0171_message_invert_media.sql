-- +goose Up
-- «Медиа над текстом» — флаг сообщения message.pFlags.invert_media (TL
-- message#… invert_media:flags.27?true). Его ставит отправитель: tweb шлёт
-- invert_media в messages.sendMessage/sendMedia и в messages.editMessage
-- (appMessagesManager.ts:2746, :2220), меню плашки превью «Выше/ниже»
-- (components/chat/input.ts:830). Хранится на строке, потому что это свойство
-- сообщения, а не превью: им же tweb переворачивает подпись у фото.
--
-- ADD COLUMN с константным DEFAULT в Postgres 11+ — только каталог, без
-- переписывания таблицы. IF NOT EXISTS — миграция идемпотентна (goose
-- доприменяет пропущенные номера).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS invert_media BOOLEAN NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE messages DROP COLUMN IF EXISTS invert_media;
