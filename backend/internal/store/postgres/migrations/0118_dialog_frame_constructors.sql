-- +goose Up
-- Кадры диалогов стали конструкторами схемы: закрепление, папка, уведомления.
--
-- Разбор — docs/readiness/tl-updates-analysis.md (Р4, группа 1). Три кадра
-- везли ПРИЗНАКИ там, где у оригинала значения:
--
--   dialog_pin     {peer_id, pinned}          → updateDialogPinned{peer:dialogPeer}
--                  «открепили» это опущенный бит pFlags.pinned, а не false;
--   dialog_archive {peer_id, archived}        → updateFolderPeers{folder_peers}
--                  архив — ПАПКА: пир едет рядом с её номером, «вернуть» это
--                  folder_id = 0, тем же кадром;
--   dialog_mute    {peer_id, notify_settings} → updateNotifySettings{peer:notifyPeer}
--                  настройки уже были конструктором, ключ пира — нет.
--
-- Ключ пира у всех трёх обёрнут в СВОЁ пространство (dialogPeer / notifyPeer /
-- folderPeer): это не украшение, у folderPeer рядом с пиром лежит номер папки,
-- и общей обёртки на все кадры не существует.

UPDATE updates SET payload =
  jsonb_strip_nulls(jsonb_build_object(
    '_', 'updateDialogPinned',
    'peer', jsonb_build_object('_', 'dialogPeer', 'peer',
      CASE WHEN (payload->>'peer_id')::bigint > 0
           THEN jsonb_build_object('_', 'peerUser', 'user_id', (payload->>'peer_id')::bigint)
           ELSE jsonb_build_object('_', 'peerChannel', 'channel_id', -(payload->>'peer_id')::bigint) END),
    'pFlags', CASE WHEN (payload->>'pinned')::boolean
                   THEN jsonb_build_object('pinned', true) ELSE NULL END))
 WHERE type = 'dialog_pin'
   AND payload IS NOT NULL
   AND payload ? 'peer_id'
   AND NOT (payload ? '_');

UPDATE updates SET payload =
  jsonb_build_object(
    '_', 'updateFolderPeers',
    'pts_count', 1,
    'folder_peers', jsonb_build_array(jsonb_build_object(
      '_', 'folderPeer',
      'peer', CASE WHEN (payload->>'peer_id')::bigint > 0
                   THEN jsonb_build_object('_', 'peerUser', 'user_id', (payload->>'peer_id')::bigint)
                   ELSE jsonb_build_object('_', 'peerChannel', 'channel_id', -(payload->>'peer_id')::bigint) END,
      'folder_id', CASE WHEN (payload->>'archived')::boolean THEN 1 ELSE 0 END)))
 WHERE type = 'dialog_archive'
   AND payload IS NOT NULL
   AND payload ? 'peer_id'
   AND NOT (payload ? '_');

UPDATE updates SET payload =
  jsonb_build_object(
    '_', 'updateNotifySettings',
    'peer', jsonb_build_object('_', 'notifyPeer', 'peer',
      CASE WHEN (payload->>'peer_id')::bigint > 0
           THEN jsonb_build_object('_', 'peerUser', 'user_id', (payload->>'peer_id')::bigint)
           ELSE jsonb_build_object('_', 'peerChannel', 'channel_id', -(payload->>'peer_id')::bigint) END),
    'notify_settings', COALESCE(payload->'notify_settings', '{}'::jsonb))
 WHERE type = 'dialog_mute'
   AND payload IS NOT NULL
   AND payload ? 'peer_id'
   AND NOT (payload ? '_');

-- +goose Down
-- Обратный ход возвращает признаки: pinned/archived булевыми, ключ пира числом.

UPDATE updates SET payload =
  jsonb_build_object(
    'peer_id', CASE WHEN payload->'peer'->'peer'->>'_' = 'peerUser'
                    THEN (payload->'peer'->'peer'->>'user_id')::bigint
                    ELSE -(payload->'peer'->'peer'->>'channel_id')::bigint END,
    'pinned', COALESCE((payload->'pFlags'->>'pinned')::boolean, false))
 WHERE type = 'dialog_pin' AND payload->>'_' = 'updateDialogPinned';

UPDATE updates SET payload =
  jsonb_build_object(
    'peer_id', CASE WHEN payload->'folder_peers'->0->'peer'->>'_' = 'peerUser'
                    THEN (payload->'folder_peers'->0->'peer'->>'user_id')::bigint
                    ELSE -(payload->'folder_peers'->0->'peer'->>'channel_id')::bigint END,
    'archived', COALESCE((payload->'folder_peers'->0->>'folder_id')::int, 0) <> 0)
 WHERE type = 'dialog_archive' AND payload->>'_' = 'updateFolderPeers';

UPDATE updates SET payload =
  jsonb_build_object(
    'peer_id', CASE WHEN payload->'peer'->'peer'->>'_' = 'peerUser'
                    THEN (payload->'peer'->'peer'->>'user_id')::bigint
                    ELSE -(payload->'peer'->'peer'->>'channel_id')::bigint END,
    'notify_settings', payload->'notify_settings')
 WHERE type = 'dialog_mute' AND payload->>'_' = 'updateNotifySettings';
