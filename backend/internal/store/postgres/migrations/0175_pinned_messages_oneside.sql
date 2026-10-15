-- +goose Up
-- Повторяемая (IF NOT EXISTS).
--
-- Ф-6, f6-pin. Закреп «только у себя» в личке (TL messages.updatePinnedMessage
-- pm_oneside, tweb appMessagesManager.ts:6838-6856): у собеседника закрепа и
-- служебки нет, закреплённое видит только закрепивший. Общий закреп остаётся в
-- pinned_messages.
--
-- Выборки «закрепы зрителя в чате» идут по префиксу первичного ключа
-- (user_id, chat_id). Пачка PinnedIDs по номерам сообщений и каскад при
-- физическом удалении сообщения — по индексу msg_id (как pinned_messages_msg_idx,
-- 0162).
CREATE TABLE IF NOT EXISTS pinned_messages_oneside (
  user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id   BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  msg_id    BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chat_id, msg_id)
);
CREATE INDEX IF NOT EXISTS pinned_messages_oneside_msg_idx ON pinned_messages_oneside (msg_id);

-- +goose Down
-- Осознанная потеря данных: закрепы «только у себя» пропадают.
DROP TABLE IF EXISTS pinned_messages_oneside;
