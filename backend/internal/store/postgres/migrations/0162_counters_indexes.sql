-- +goose NO TRANSACTION
-- +goose Up
-- Индексы Ф-4, строятся CONCURRENTLY — без SHARE-замка на таблицы, по которым
-- идут реакции и отправка (прецедент — 0085, 0131).
--
-- reactions_unread_idx — частичный по непрочитанным реакциям: пересчёт ❤
-- (ChatsRepo.RecountUnreadReactions) и прочтение реакций (ReadReactions)
-- ходят только по ним. На стендах, где 0160 уже создала его в транзакции,
-- IF NOT EXISTS делает шаг пустым.
CREATE INDEX CONCURRENTLY IF NOT EXISTS reactions_unread_idx ON reactions (message_id) WHERE unread;

-- pinned_messages_msg_idx — флаг pFlags.pinned пачкой на страницу истории
-- (ChatsRepo.PinnedIDs: msg_id = ANY): первичный ключ (chat_id, msg_id) для
-- отбора по msg_id не годится, без индекса это полный проход по таблице.
CREATE INDEX CONCURRENTLY IF NOT EXISTS pinned_messages_msg_idx ON pinned_messages (msg_id);

-- dialog_hidden_idx — частичный: «удалить чат» в личке (dialog_hidden) редок,
-- и возврат строки новым сообщением (ChatsRepo.ShowDialogs) по нему не
-- проходит участников чата.
CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_members_dialog_hidden_idx ON chat_members (chat_id) WHERE dialog_hidden;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS chat_members_dialog_hidden_idx;
DROP INDEX CONCURRENTLY IF EXISTS pinned_messages_msg_idx;
DROP INDEX CONCURRENTLY IF EXISTS reactions_unread_idx;
