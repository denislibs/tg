-- +goose Up
-- Кадры вложений, меняющихся после отправки, стали конструкторами:
--
--   poll_update       {media}          → updateMessagePoll{poll_id, poll, results}
--   checklist_update  {media}          → наш updateMessageToDo{media}
--   giveaway_update   {media}          → наш updateMessageGiveaway{media}
--   web_page_update   {id, media}      → наш updateMessageWebPage{peer, msg_id, media}
--   factcheck_update  {id, factcheck}  → наш updateMessageFactCheck{peer, msg_id, factcheck?}
--   paid_media_unlock {message …}      → updateMessageExtendedMedia{peer, msg_id, extended_media}
--
-- Адресация у них разная, и это свойство предмета: опрос, чек-лист и розыгрыш
-- адресуются СВОИМ id внутри объекта (у оригинала updateMessagePoll устроен
-- именно так), а превью ссылки, проверка факта и платное медиа — парой «пир +
-- номер», потому что своего id у них нет вовсе.
--
-- Два места стоит назвать отдельно:
--   • у проверки факта «сняли» — ОТСУТСТВИЕ параметра, а не null под тем же
--     ключом (то же правило, по которому «черновика нет» стало конструктором);
--   • paid_media_unlock вёз сообщение ЦЕЛИКОМ — вторую копию всего сообщения на
--     разблокировку одного вложения. Теперь едет ровно предмет; вектор берётся
--     из того же сообщения, что лежало в кадре.

UPDATE updates SET payload =
  jsonb_build_object(
    '_', 'updateMessagePoll',
    'peer', CASE WHEN (payload->>'peer_id')::bigint > 0
                 THEN jsonb_build_object('_', 'peerUser', 'user_id', (payload->>'peer_id')::bigint)
                 ELSE jsonb_build_object('_', 'peerChannel', 'channel_id', -(payload->>'peer_id')::bigint) END,
    'poll_id', (payload->'media'->'poll'->>'id')::bigint,
    'poll', payload->'media'->'poll',
    'results', payload->'media'->'results')
 WHERE type = 'poll_update' AND payload ? 'media' AND NOT (payload ? '_');

UPDATE updates SET payload = jsonb_build_object(
    '_', 'updateMessageToDo', 'peer', CASE WHEN (payload->>'peer_id')::bigint > 0
                 THEN jsonb_build_object('_', 'peerUser', 'user_id', (payload->>'peer_id')::bigint)
                 ELSE jsonb_build_object('_', 'peerChannel', 'channel_id', -(payload->>'peer_id')::bigint) END, 'media', payload->'media')
 WHERE type = 'checklist_update' AND payload ? 'media' AND NOT (payload ? '_');

UPDATE updates SET payload = jsonb_build_object(
    '_', 'updateMessageGiveaway', 'peer', CASE WHEN (payload->>'peer_id')::bigint > 0
                 THEN jsonb_build_object('_', 'peerUser', 'user_id', (payload->>'peer_id')::bigint)
                 ELSE jsonb_build_object('_', 'peerChannel', 'channel_id', -(payload->>'peer_id')::bigint) END, 'media', payload->'media')
 WHERE type = 'giveaway_update' AND payload ? 'media' AND NOT (payload ? '_');

UPDATE updates SET payload =
  jsonb_build_object(
    '_', 'updateMessageWebPage',
    'peer', CASE WHEN (payload->>'peer_id')::bigint > 0
                 THEN jsonb_build_object('_', 'peerUser', 'user_id', (payload->>'peer_id')::bigint)
                 ELSE jsonb_build_object('_', 'peerChannel', 'channel_id', -(payload->>'peer_id')::bigint) END,
    'msg_id', COALESCE(payload->'id', '0'::jsonb),
    'media', payload->'media')
 WHERE type = 'web_page_update' AND payload ? 'peer_id' AND NOT (payload ? '_');

UPDATE updates SET payload =
  jsonb_strip_nulls(jsonb_build_object(
    '_', 'updateMessageFactCheck',
    'peer', CASE WHEN (payload->>'peer_id')::bigint > 0
                 THEN jsonb_build_object('_', 'peerUser', 'user_id', (payload->>'peer_id')::bigint)
                 ELSE jsonb_build_object('_', 'peerChannel', 'channel_id', -(payload->>'peer_id')::bigint) END,
    'msg_id', COALESCE(payload->'id', '0'::jsonb),
    'factcheck', CASE WHEN payload->'factcheck' = 'null'::jsonb THEN NULL ELSE payload->'factcheck' END))
 WHERE type = 'factcheck_update' AND payload ? 'peer_id' AND NOT (payload ? '_');

-- Платное медиа: адрес берём из самого сообщения, вектор — из его вложения.
-- Сообщения без платного вложения в кадре быть не может (кадр рождается только
-- разблокировкой), но COALESCE держит форму вектора на случай чужой строки.
UPDATE updates SET payload =
  jsonb_build_object(
    '_', 'updateMessageExtendedMedia',
    'peer', payload->'message'->'peer_id',
    'msg_id', COALESCE(payload->'message'->'id', '0'::jsonb),
    'extended_media', COALESCE(payload->'message'->'media'->'extended_media', '[]'::jsonb))
 WHERE type = 'paid_media_unlock' AND payload->>'_' = 'updateNewMessage';

-- +goose Down
-- Обратный ход возвращает наши прежние ключи. Кадр разблокировки НЕ
-- восстанавливается сообщением целиком: сообщения в нём больше нет, а собирать
-- его из вектора позиций — то же «как получится», из-за которого миграция 0115
-- удаляла патчи правки. Он остаётся конструктором.

UPDATE updates SET payload = jsonb_build_object(
    'peer_id', CASE WHEN payload->'peer'->>'_' = 'peerUser'
                    THEN (payload->'peer'->>'user_id')::bigint
                    ELSE -(payload->'peer'->>'channel_id')::bigint END,
    'media', jsonb_build_object('_', 'messageMediaPoll', 'poll', payload->'poll', 'results', payload->'results'))
 WHERE type = 'poll_update' AND payload->>'_' = 'updateMessagePoll';

UPDATE updates SET payload = jsonb_build_object(
    'peer_id', CASE WHEN payload->'peer'->>'_' = 'peerUser'
                    THEN (payload->'peer'->>'user_id')::bigint
                    ELSE -(payload->'peer'->>'channel_id')::bigint END, 'media', payload->'media')
 WHERE type = 'checklist_update' AND payload->>'_' = 'updateMessageToDo';

UPDATE updates SET payload = jsonb_build_object(
    'peer_id', CASE WHEN payload->'peer'->>'_' = 'peerUser'
                    THEN (payload->'peer'->>'user_id')::bigint
                    ELSE -(payload->'peer'->>'channel_id')::bigint END, 'media', payload->'media')
 WHERE type = 'giveaway_update' AND payload->>'_' = 'updateMessageGiveaway';

UPDATE updates SET payload =
  jsonb_build_object(
    'peer_id', CASE WHEN payload->'peer'->>'_' = 'peerUser'
                    THEN (payload->'peer'->>'user_id')::bigint
                    ELSE -(payload->'peer'->>'channel_id')::bigint END,
    'id', payload->'msg_id',
    'media', payload->'media')
 WHERE type = 'web_page_update' AND payload->>'_' = 'updateMessageWebPage';

UPDATE updates SET payload =
  jsonb_build_object(
    'peer_id', CASE WHEN payload->'peer'->>'_' = 'peerUser'
                    THEN (payload->'peer'->>'user_id')::bigint
                    ELSE -(payload->'peer'->>'channel_id')::bigint END,
    'id', payload->'msg_id',
    'factcheck', payload->'factcheck')
 WHERE type = 'factcheck_update' AND payload->>'_' = 'updateMessageFactCheck';
