-- +goose NO TRANSACTION
-- +goose Up
-- Непрочитанное broadcast-канала считается на чтении (dialogUnreadCount,
-- MessagesRepo.CountUnread): посты выше горизонта, не свои и не удалённые.
-- Покрывающий частичный индекс даёт index-only scan — без похода в кучу за
-- sender_id и deleted_at на каждый непрочитанный пост. CONCURRENTLY — чтобы не
-- блокировать запись в messages на старте при rolling-деплое.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_unread_count
  ON messages (chat_id, seq) INCLUDE (sender_id) WHERE deleted_at IS NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS idx_messages_unread_count;
