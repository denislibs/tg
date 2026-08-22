-- +goose Up
-- Последние кадры шага B стали конструкторами:
--
--   chat_removed      {peer_id, removed:true} → наш updateChatRemoved{peer}
--   chat_theme_update {theme_id}              → наш updateChatTheme{peer, theme_id}
--   balance_update    {balance:int}           → updateStarsBalance{balance:starsAmount}
--   chat_update       {chat_full}             → наш updateChatFullSnapshot{peer, chat_full, pts}
--   boost_update      {status}                → наш updateChannelBoostStatus{peer, status, pts}
--
-- Три места стоит назвать:
--   • `removed: true` было КОНСТАНТОЙ — «кадр удаления сообщает об удалении»;
--     вид кадра теперь несёт дискриминатор, и поле ушло;
--   • баланс едет конструктором starsAmount: у оригинала звёзды дробные
--     (nanos), и «целое число звёзд» — частный случай, а не форма;
--   • у кадров КАНАЛА (chat_update, boost_update) курсор жил в колонке журнала
--     и дописывался в тело ключом `channel_pts` — вторым именем того же поля.
--     Теперь это параметр `pts` самого конструктора, как у поста канала.
--
-- Курсор в замороженные тела не подставляется: в журнале он колонка, и кадру
-- его дописывает выход. Здесь переписывается только ФОРМА тела.

UPDATE updates SET payload =
  jsonb_build_object(
    '_', 'updateChatRemoved',
    'peer', CASE WHEN (payload->>'peer_id')::bigint > 0
                 THEN jsonb_build_object('_', 'peerUser', 'user_id', (payload->>'peer_id')::bigint)
                 ELSE jsonb_build_object('_', 'peerChannel', 'channel_id', -(payload->>'peer_id')::bigint) END)
 WHERE type = 'chat_removed' AND payload ? 'peer_id' AND NOT (payload ? '_');

UPDATE updates SET payload =
  jsonb_build_object(
    '_', 'updateChatTheme',
    'peer', CASE WHEN (payload->>'peer_id')::bigint > 0
                 THEN jsonb_build_object('_', 'peerUser', 'user_id', (payload->>'peer_id')::bigint)
                 ELSE jsonb_build_object('_', 'peerChannel', 'channel_id', -(payload->>'peer_id')::bigint) END,
    'theme_id', COALESCE(payload->>'theme_id', ''))
 WHERE type = 'chat_theme_update' AND payload ? 'peer_id' AND NOT (payload ? '_');

UPDATE updates SET payload =
  jsonb_build_object(
    '_', 'updateStarsBalance',
    'balance', jsonb_build_object('_', 'starsAmount', 'amount', (payload->>'balance')::bigint, 'nanos', 0))
 WHERE type = 'balance_update' AND payload ? 'balance' AND NOT (payload ? '_');

-- Групповой chat_update лежит в персональных журналах (ключ пира у всех общий,
-- -chatID), канальный — в журнале канала.
UPDATE updates SET payload =
  jsonb_build_object(
    '_', 'updateChatFullSnapshot',
    'peer', CASE WHEN (payload->>'peer_id')::bigint > 0
                 THEN jsonb_build_object('_', 'peerUser', 'user_id', (payload->>'peer_id')::bigint)
                 ELSE jsonb_build_object('_', 'peerChannel', 'channel_id', -(payload->>'peer_id')::bigint) END,
    'chat_full', payload->'chat_full',
    'pts_count', 1)
 WHERE type = 'chat_update' AND payload ? 'chat_full' AND payload ? 'peer_id' AND NOT (payload ? '_');

UPDATE channel_updates SET payload =
  jsonb_build_object(
    '_', 'updateChatFullSnapshot',
    'peer', jsonb_build_object('_', 'peerChannel', 'channel_id', channel_id),
    'chat_full', payload->'chat_full',
    'pts_count', 1)
 WHERE type = 'chat_update' AND payload ? 'chat_full' AND NOT (payload ? '_');

UPDATE channel_updates SET payload =
  jsonb_build_object(
    '_', 'updateChannelBoostStatus',
    'peer', jsonb_build_object('_', 'peerChannel', 'channel_id', channel_id),
    'status', jsonb_strip_nulls(jsonb_build_object(
      '_', 'premium.boostsStatus',
      'level', COALESCE((payload->'status'->>'level')::int, 0),
      'current_level_boosts', COALESCE((payload->'status'->>'current_level_boosts')::int, 0),
      'boosts', COALESCE((payload->'status'->>'boosts_count')::int, 0),
      'next_level_boosts', CASE WHEN COALESCE((payload->'status'->>'next_level_boosts')::int, 0)
                                    > COALESCE((payload->'status'->>'current_level_boosts')::int, 0)
                                THEN (payload->'status'->>'next_level_boosts')::int END)),
    'pts_count', 1)
 WHERE type = 'boost_update' AND payload ? 'status' AND NOT (payload ? '_');

-- +goose Down
-- Обратный ход возвращает прежние тела. Пер-зрительская часть статуса бустов
-- (мой буст, мои слоты) не восстанавливается: её в кадре не было и до порта —
-- он собирался для «зрителя 0».

UPDATE updates SET payload =
  jsonb_build_object(
    'peer_id', CASE WHEN payload->'peer'->>'_' = 'peerUser'
                    THEN (payload->'peer'->>'user_id')::bigint
                    ELSE -(payload->'peer'->>'channel_id')::bigint END,
    'removed', true)
 WHERE type = 'chat_removed' AND payload->>'_' = 'updateChatRemoved';

UPDATE updates SET payload =
  jsonb_build_object(
    'peer_id', CASE WHEN payload->'peer'->>'_' = 'peerUser'
                    THEN (payload->'peer'->>'user_id')::bigint
                    ELSE -(payload->'peer'->>'channel_id')::bigint END,
    'theme_id', payload->>'theme_id')
 WHERE type = 'chat_theme_update' AND payload->>'_' = 'updateChatTheme';

UPDATE updates SET payload = jsonb_build_object('balance', (payload->'balance'->>'amount')::bigint)
 WHERE type = 'balance_update' AND payload->>'_' = 'updateStarsBalance';

UPDATE updates SET payload =
  jsonb_build_object(
    'peer_id', CASE WHEN payload->'peer'->>'_' = 'peerUser'
                    THEN (payload->'peer'->>'user_id')::bigint
                    ELSE -(payload->'peer'->>'channel_id')::bigint END,
    'chat_full', payload->'chat_full')
 WHERE type = 'chat_update' AND payload->>'_' = 'updateChatFullSnapshot';

UPDATE channel_updates SET payload = jsonb_build_object('chat_full', payload->'chat_full')
 WHERE type = 'chat_update' AND payload->>'_' = 'updateChatFullSnapshot';

UPDATE channel_updates SET payload =
  jsonb_build_object('status', jsonb_build_object(
    'level', (payload->'status'->>'level')::int,
    'boosts_count', (payload->'status'->>'boosts')::int,
    'current_level_boosts', (payload->'status'->>'current_level_boosts')::int,
    'next_level_boosts', COALESCE((payload->'status'->>'next_level_boosts')::int, 0)))
 WHERE type = 'boost_update' AND payload->>'_' = 'updateChannelBoostStatus';
