-- +goose Up
-- Кадр черновика стал конструктором updateDraftMessage, а сам черновик —
-- объединением DraftMessage.
--
-- Разбор — docs/readiness/tl-updates-analysis.md (Р4, группа 1). Главное здесь
-- ВТОРОЙ конструктор: «черновик снят» у оригинала выражает draftMessageEmpty, а
-- у нас на этом месте ехал `null` под ключом `draft` — отсутствие, выраженное
-- ЗНАЧЕНИЕМ. Из-за этого у каждого читателя была своя ветка `if (draft)`.
--
-- Переименования не косметические: текст лежит в `message` (то же имя, что у
-- самого сообщения — у нас он звался `text`, то есть был вторым именем одного
-- поля), дата — `date` в СЕКУНДАХ эпохи вместо ISO-строки своей ручки, а ссылка
-- на ответ — конструктор входного объединения inputReplyToMessage вместо числа
-- reply_to_id рядом.

UPDATE updates SET payload =
  jsonb_strip_nulls(jsonb_build_object(
    '_', 'updateDraftMessage',
    'peer', CASE WHEN (payload->>'peer_id')::bigint > 0
                 THEN jsonb_build_object('_', 'peerUser', 'user_id', (payload->>'peer_id')::bigint)
                 ELSE jsonb_build_object('_', 'peerChannel', 'channel_id', -(payload->>'peer_id')::bigint) END,
    'draft', CASE
      WHEN payload->'draft' IS NULL OR payload->'draft' = 'null'::jsonb
        THEN jsonb_build_object('_', 'draftMessageEmpty')
      ELSE jsonb_build_object(
        '_', 'draftMessage',
        'message', COALESCE(payload->'draft'->>'text', ''),
        'entities', payload->'draft'->'entities',
        'reply_to', CASE WHEN payload->'draft'->'reply_to_id' IS NOT NULL
                          AND payload->'draft'->'reply_to_id' <> 'null'::jsonb
                         THEN jsonb_build_object('_', 'inputReplyToMessage',
                                'reply_to_msg_id', (payload->'draft'->>'reply_to_id')::bigint)
                         ELSE NULL END,
        'date', COALESCE(extract(epoch from (payload->'draft'->>'updated_at')::timestamptz)::bigint, 0))
    END))
 WHERE type = 'draft_update'
   AND payload IS NOT NULL
   AND payload ? 'peer_id'
   AND NOT (payload ? '_');

-- +goose Down
-- Обратный ход возвращает плоскую форму: снятый черновик снова становится null.

UPDATE updates SET payload =
  jsonb_build_object(
    'peer_id', CASE WHEN payload->'peer'->>'_' = 'peerUser'
                    THEN (payload->'peer'->>'user_id')::bigint
                    ELSE -(payload->'peer'->>'channel_id')::bigint END,
    'draft', CASE WHEN payload->'draft'->>'_' = 'draftMessageEmpty' THEN NULL
                  ELSE jsonb_build_object(
                    'text', payload->'draft'->>'message',
                    'entities', payload->'draft'->'entities',
                    'reply_to_id', (payload->'draft'->'reply_to'->>'reply_to_msg_id')::bigint,
                    'updated_at', to_char(to_timestamp((payload->'draft'->>'date')::bigint)
                                          AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
             END)
 WHERE type = 'draft_update' AND payload->>'_' = 'updateDraftMessage';
