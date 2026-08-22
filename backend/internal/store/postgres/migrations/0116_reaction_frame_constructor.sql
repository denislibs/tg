-- +goose Up
-- Кадр реакций стал конструктором updateMessageReactions с АБСОЛЮТНЫМ агрегатом.
--
-- Разбор — docs/readiness/tl-updates-analysis.md (Р4, группа 2). Кадр вёз ДВЕ
-- формы одного факта сразу: авторитетный агрегат `counts` и дифф (кто, какой
-- эмодзи, добавил или снял) «для анимации». При гонке двух реакций клиент верил
-- разным полям по-разному.
--
-- Замороженные кадры переводятся: `counts` становится вектором `results` с
-- конструкторами reactionCount/reactionEmoji, дифф удаляется вместе с
-- пер-зрительским счётчиком непрочитанных реакций (он приезжает со строкой
-- диалога, а не с телом кадра, одним на всех получателей).
--
-- Агрегат помечается `pFlags.min` — он и правда урезан: моего chosen_order в
-- общем теле нет. Без флага клиент принял бы «сервер не сообщил» за «я не
-- ставил» и стёр бы собственный выбор при первом же переигрывании.

UPDATE updates SET payload =
  jsonb_build_object(
    '_', 'updateMessageReactions',
    'peer', CASE WHEN (payload->>'peer_id')::bigint > 0
                 THEN jsonb_build_object('_', 'peerUser', 'user_id', (payload->>'peer_id')::bigint)
                 ELSE jsonb_build_object('_', 'peerChannel', 'channel_id', -(payload->>'peer_id')::bigint) END,
    'msg_id', COALESCE(payload->'id', '0'::jsonb),
    'pts_count', 1,
    'reactions', jsonb_build_object(
      '_', 'messageReactions',
      'pFlags', jsonb_build_object('min', true),
      'results', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          '_', 'reactionCount',
          'reaction', jsonb_build_object('_', 'reactionEmoji', 'emoticon', c->>'emoji'),
          'count', (c->>'count')::int))
        FROM jsonb_array_elements(COALESCE(payload->'counts', '[]'::jsonb)) c
      ), '[]'::jsonb)
    )
  )
 WHERE type = 'reaction'
   AND payload IS NOT NULL
   AND payload ? 'peer_id'
   AND NOT (payload ? '_');

-- +goose Down
-- Обратный ход возвращает плоский агрегат. Дифф не восстанавливается: он и был
-- второй формой того же факта, а «кто поставил» конструктор не несёт — клиенту
-- старой формы это давало только анимацию.

UPDATE updates SET payload =
  jsonb_build_object(
    'id', COALESCE(payload->'msg_id', '0'::jsonb),
    'peer_id', CASE WHEN payload->'peer'->>'_' = 'peerUser'
                    THEN (payload->'peer'->>'user_id')::bigint
                    ELSE -(payload->'peer'->>'channel_id')::bigint END,
    'counts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'emoji', c->'reaction'->>'emoticon',
        'count', (c->>'count')::int))
      FROM jsonb_array_elements(COALESCE(payload->'reactions'->'results', '[]'::jsonb)) c
    ), '[]'::jsonb)
  )
 WHERE type = 'reaction'
   AND payload IS NOT NULL
   AND payload->>'_' = 'updateMessageReactions';
