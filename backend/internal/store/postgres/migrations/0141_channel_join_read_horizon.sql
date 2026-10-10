-- +goose NO TRANSACTION
-- +goose Up
-- Непрочитанное broadcast-канала теперь считается на чтении: посты выше
-- горизонта last_read_seq, не свои и не удалённые (Ф-2, A1-03/A3-01). Новый
-- подписчик вступает с горизонтом на последнем посте (GroupRepo.AddMember), а
-- у уже вступивших горизонт мог остаться нулевым — им бейджем стала бы вся
-- история канала до вступления. Поднимаем горизонт до последнего поста,
-- написанного раньше вступления.
--
-- Пачками по каналу, каждая своей транзакцией (процедура с COMMIT): один
-- UPDATE на все каналы держал бы блокировки всех строк членства каналов на
-- время всей миграции. Посты канала перебираются один раз окном по дате
-- (последний seq на каждый момент), а не подзапросом на подписчика.
-- Повторный прогон безопасен: горизонт только растёт.
--
-- Посты ПОСЛЕ вступления у старых подписчиков, не открывавших канал, после
-- деплоя станут непрочитанными — это и есть исправленное поведение.

-- +goose StatementBegin
CREATE OR REPLACE PROCEDURE f2_channel_join_read_horizon()
LANGUAGE plpgsql AS $$
DECLARE
  ch bigint;
BEGIN
  FOR ch IN SELECT id FROM chats WHERE type = 'channel' ORDER BY id LOOP
    UPDATE chat_members cm
       SET last_read_seq = h.seq
      FROM (
        -- Посты и вступления канала одной лентой по времени: нарастающий
        -- максимум seq на строке вступления — последний пост до него.
        -- Посты при равном времени идут раньше вступления (created_at <=
        -- joined_at). O((посты + подписчики) · log) на канал.
        SELECT e.user_id, e.seq_before AS seq
          FROM (
            SELECT ev.user_id,
                   max(ev.seq) OVER (ORDER BY ev.t, ev.kind
                                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS seq_before
              FROM (
                SELECT NULL::bigint AS user_id, p.created_at AS t, 0 AS kind, p.seq
                  FROM messages p WHERE p.chat_id = ch
                UNION ALL
                SELECT m.user_id, m.joined_at, 1, NULL::bigint
                  FROM chat_members m WHERE m.chat_id = ch
              ) ev
          ) e
         WHERE e.user_id IS NOT NULL
      ) h
     WHERE cm.chat_id = ch AND cm.user_id = h.user_id
       AND h.seq IS NOT NULL AND h.seq > cm.last_read_seq;
    COMMIT;
  END LOOP;
END;
$$;
-- +goose StatementEnd

CALL f2_channel_join_read_horizon();

DROP PROCEDURE f2_channel_join_read_horizon();

-- +goose Down
SELECT 1;
