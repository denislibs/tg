-- +goose Up
-- Удаление и «вложение прослушано» в ЗАМОРОЖЕННЫХ кадрах становятся
-- конструкторами.
--
-- Разбор — docs/readiness/tl-updates-analysis.md. Оба конструктора НАШИ
-- (schema_additional_params.json), и причина одна: схемные
-- `updateDeleteMessages` и `updateReadMessagesContents` пира не несут вовсе —
-- у оригинала номер сообщения уникален в «ящике» получателя, а у нас он
-- пер-чатный (решение порта сообщения). Кадр без пира означал бы «удалить №12
-- везде».
--
-- Признак `for_me` («удалить у себя») исчезает: предмета у него нет ни в схеме,
-- ни у нас — «удалено у меня» это тот же кадр, просто записанный ОДНОМУ
-- получателю. Потребителей у поля не было ни одного (проверено по клиенту).

UPDATE updates SET payload =
  jsonb_build_object(
    '_', CASE type WHEN 'delete_message' THEN 'updateDeletePeerMessages'
                   ELSE 'updateReadPeerMessagesContents' END,
    'peer', CASE WHEN (payload->>'peer_id')::bigint > 0
                 THEN jsonb_build_object('_', 'peerUser', 'user_id', (payload->>'peer_id')::bigint)
                 ELSE jsonb_build_object('_', 'peerChannel', 'channel_id', -(payload->>'peer_id')::bigint) END,
    'messages', jsonb_build_array(COALESCE(payload->'id', '0'::jsonb)),
    'pts_count', 1
  )
 WHERE type IN ('delete_message', 'media_read')
   AND payload IS NOT NULL
   AND payload ? 'id'
   AND payload ? 'peer_id'
   AND NOT (payload ? '_');

-- +goose Down
-- Обратный ход возвращает плоскую форму. `for_me` восстановить нечем и незачем:
-- у кадра его не было в схеме, а у нас не было потребителя — ставится false,
-- ровно как его читали.

UPDATE updates SET payload =
  jsonb_build_object(
    'id', COALESCE(payload->'messages'->0, '0'::jsonb),
    'peer_id', CASE WHEN payload->'peer'->>'_' = 'peerUser'
                    THEN (payload->'peer'->>'user_id')::bigint
                    ELSE -(payload->'peer'->>'channel_id')::bigint END
  )
  || CASE WHEN type = 'delete_message' THEN jsonb_build_object('for_me', false) ELSE '{}'::jsonb END
 WHERE type IN ('delete_message', 'media_read')
   AND payload IS NOT NULL
   AND payload->>'_' IN ('updateDeletePeerMessages', 'updateReadPeerMessagesContents');
