-- +goose Up
-- Непрочитанное broadcast-канала теперь считается на чтении: посты выше
-- горизонта last_read_seq, не свои и не удалённые (Ф-2, A1-03/A3-01). Новый
-- подписчик вступает с горизонтом на последнем посте (GroupRepo.AddMember), а
-- у уже вступивших горизонт мог остаться нулевым — им бейджем стала бы вся
-- история канала до вступления. Поднимаем горизонт до последнего поста,
-- написанного раньше вступления. Повторный прогон безопасен: GREATEST.
UPDATE chat_members cm
   SET last_read_seq = GREATEST(cm.last_read_seq, COALESCE((
         SELECT max(m.seq) FROM messages m
          WHERE m.chat_id = cm.chat_id AND m.created_at <= cm.joined_at), 0))
  FROM chats c
 WHERE c.id = cm.chat_id AND c.type = 'channel';

-- +goose Down
SELECT 1;
