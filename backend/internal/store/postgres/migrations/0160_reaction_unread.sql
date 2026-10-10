-- +goose Up
-- Повторяемая: колонка и индекс — IF NOT EXISTS, чистка и пересчёты дают тот
-- же результат при повторе.

-- Непрочитанность реакции — на СТРОКЕ реакции (Telegram
-- messagePeerReaction.pFlags.unread у автора сообщения), а
-- chat_members.unread_reactions — число СООБЩЕНИЙ автора с непрочитанной
-- реакцией (unread_reactions_count). Прежде счётчик рос на каждое событие
-- (повтор, смена, реакция на удалённое) и не уменьшался вовсе. Истории
-- событий нет, из чего восстановить «непрочитано» у старых реакций, —
-- старые строки прочитаны, счётчики пересчитываются по новой формуле
-- (ChatsRepo.RecountUnreadReactions).
-- ADD COLUMN с константным DEFAULT на PG11+ таблицу не переписывает; частичный
-- индекс по непрочитанным строится отдельно, без блокировки записи (0162).
ALTER TABLE reactions ADD COLUMN IF NOT EXISTS unread BOOLEAN NOT NULL DEFAULT false;

UPDATE chat_members cm SET unread_reactions = (
    SELECT count(DISTINCT m.id) FROM messages m
      JOIN reactions r ON r.message_id = m.id AND r.unread
     WHERE m.chat_id = cm.chat_id AND m.sender_id = cm.user_id AND m.deleted_at IS NULL)
 WHERE cm.unread_reactions <> 0;

-- Упоминания удалённых у всех сообщений и упоминания выбывших участников —
-- след прежних путей удаления и выхода, которые строки message_mentions не
-- трогали: «@» висел, «к следующему @» вёл на удалённое, а при повторном
-- вступлении старые упоминания возвращались.
DELETE FROM message_mentions mm USING messages m
 WHERE m.id = mm.message_id AND m.deleted_at IS NOT NULL;
DELETE FROM message_mentions mm
 WHERE NOT EXISTS (SELECT 1 FROM chat_members cm WHERE cm.chat_id = mm.chat_id AND cm.user_id = mm.user_id);
UPDATE chat_members cm SET unread_mentions_count = (
    SELECT count(*) FROM message_mentions mm
     WHERE mm.chat_id = cm.chat_id AND mm.user_id = cm.user_id AND mm.unread)
 WHERE cm.unread_mentions_count <> 0;

-- +goose Down
ALTER TABLE reactions DROP COLUMN IF EXISTS unread;
