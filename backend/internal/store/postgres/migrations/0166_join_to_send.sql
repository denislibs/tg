-- +goose Up
-- Повторяемая: IF NOT EXISTS.

-- channel.pFlags.join_to_send (channels.toggleJoinToSend, tweb
-- appChatsManager.ts:1157): писать в группу можно только участнику. Без флага
-- читатель канала комментирует пост в треде зеркала, не вступая в группу
-- обсуждения (tweb input.ts:2044 — кнопка «Вступить» в треде только при
-- join_to_send).
ALTER TABLE chats ADD COLUMN IF NOT EXISTS join_to_send BOOLEAN NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE chats DROP COLUMN IF EXISTS join_to_send;
