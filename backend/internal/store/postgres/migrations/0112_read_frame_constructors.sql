-- +goose Up
-- Прочтение в ЗАМОРОЖЕННЫХ кадрах журнала раздваивается на два конструктора.
--
-- Разбор — docs/readiness/tl-updates-analysis.md (Р3). Кадр был один
-- (`{user_id, up_to_seq, unread}`), и «прочитал я» от «прочитали меня» каждый
-- получатель отличал сам, сравнивая `user_id` с собой. В схеме это два РАЗНЫХ
-- конструктора: updateReadHistoryInbox несёт мой горизонт и мой счётчик
-- оставшегося непрочитанного, updateReadHistoryOutbox — только горизонт
-- собеседника (чужой непрочитанный меня не касается, поэтому счётчика у него
-- нет вовсе).
--
-- Чей это кадр, решается ПО ВЛАДЕЛЬЦУ СТРОКИ: журнал пер-юзерный, и запись
-- лежит у каждого получателя своя, поэтому `payload->>'user_id' = user_id`
-- отвечает ровно на вопрос «прочитал ли это сам владелец строки». Ничего
-- достраивать не нужно — ответ уже лежит в данных.
--
-- Ключ пира тоже меняет форму: в схеме у прочтения параметр `peer:Peer`, то
-- есть конструктор, а не знаковое число. Перевод — то же правило, что у
-- domain.NewPeer: положительный ключ это пользователь, отрицательный — чат.

UPDATE updates SET payload =
  jsonb_build_object(
    '_', CASE WHEN (payload->>'user_id')::bigint = user_id
              THEN 'updateReadHistoryInbox' ELSE 'updateReadHistoryOutbox' END,
    'peer', CASE WHEN (payload->>'peer_id')::bigint > 0
                 THEN jsonb_build_object('_', 'peerUser', 'user_id', (payload->>'peer_id')::bigint)
                 ELSE jsonb_build_object('_', 'peerChannel', 'channel_id', -(payload->>'peer_id')::bigint) END,
    'max_id', COALESCE(payload->'up_to_seq', '0'::jsonb),
    'pts_count', 1
  )
  || CASE WHEN (payload->>'user_id')::bigint = user_id
          THEN jsonb_build_object('still_unread_count', COALESCE(payload->'unread', '0'::jsonb))
          ELSE '{}'::jsonb END
 WHERE type = 'read'
   AND payload IS NOT NULL
   AND payload ? 'user_id'
   AND payload ? 'peer_id'
   AND NOT (payload ? '_');

-- +goose Down
-- Обратный ход возвращает единый кадр. `user_id` у «прочитали меня»
-- восстановить нечем — кто именно прочитал, конструктор не несёт и нести не
-- должен; ставится 0, и это ровно то, чем это поле было для читателя: «не я».
-- Другого потребителя у него не было.

UPDATE updates SET payload =
  jsonb_build_object(
    'user_id', CASE WHEN payload->>'_' = 'updateReadHistoryInbox' THEN user_id ELSE 0 END,
    'peer_id', CASE WHEN payload->'peer'->>'_' = 'peerUser'
                    THEN (payload->'peer'->>'user_id')::bigint
                    ELSE -(payload->'peer'->>'channel_id')::bigint END,
    'up_to_seq', COALESCE(payload->'max_id', '0'::jsonb)
  )
  || CASE WHEN payload ? 'still_unread_count'
          THEN jsonb_build_object('unread', payload->'still_unread_count')
          ELSE '{}'::jsonb END
 WHERE type = 'read'
   AND payload IS NOT NULL
   AND payload->>'_' IN ('updateReadHistoryInbox', 'updateReadHistoryOutbox');
