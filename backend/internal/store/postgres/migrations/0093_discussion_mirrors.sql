-- +goose Up
-- Зеркало поста канала в связанной группе обсуждения (Telegram-модель): пост
-- дублируется в группу отдельным сообщением, а комментарии — обычный тред на
-- этом зеркале. Флаг отличает зеркало от ОБЫЧНОЙ пересылки: по одним лишь
-- fwd_from_* они неразличимы, а уникальность нужна только зеркалам — иначе
-- индекс запретил бы пользователю переслать один и тот же пост в группу дважды.
ALTER TABLE messages ADD COLUMN is_discussion_mirror BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX uq_messages_discussion_mirror
  ON messages (chat_id, fwd_from_chat_id, fwd_from_msg_id)
  WHERE is_discussion_mirror;

-- +goose Down
DROP INDEX IF EXISTS uq_messages_discussion_mirror;
ALTER TABLE messages DROP COLUMN is_discussion_mirror;
