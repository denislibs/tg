-- +goose Up
-- Закрепление в ЗАМОРОЖЕННЫХ кадрах журнала становится конструктором
-- updatePinnedMessages.
--
-- Разбор — docs/readiness/tl-updates-analysis.md (Р4). Кадр вёз `{id, pinned}`
-- плюс знаковый `peer_id` числом. В схеме это updatePinnedMessages{pFlags,
-- peer:Peer, messages:Vector<int>, pts, pts_count}, где «открепили» — ТОТ ЖЕ
-- конструктор с ОПУЩЕННЫМ битом, а не поле `pinned: false`.
--
-- Разница между «нет ключа» и «false» на JSON-проводе косметическая, на проводе
-- TL — принципиальная: голый флаг там не занимает ничего, и записанное значение
-- сдвинуло бы всё, что идёт следом.

UPDATE updates SET payload =
  jsonb_build_object(
    '_', 'updatePinnedMessages',
    'peer', CASE WHEN (payload->>'peer_id')::bigint > 0
                 THEN jsonb_build_object('_', 'peerUser', 'user_id', (payload->>'peer_id')::bigint)
                 ELSE jsonb_build_object('_', 'peerChannel', 'channel_id', -(payload->>'peer_id')::bigint) END,
    'messages', jsonb_build_array(COALESCE(payload->'id', '0'::jsonb)),
    'pts_count', 1
  )
  || CASE WHEN (payload->>'pinned')::boolean
          THEN jsonb_build_object('pFlags', jsonb_build_object('pinned', true))
          ELSE '{}'::jsonb END
 WHERE type = 'pin_message'
   AND payload IS NOT NULL
   AND payload ? 'id'
   AND payload ? 'peer_id'
   AND NOT (payload ? '_');

-- +goose Down
-- Обратный ход возвращает плоскую форму: бит снова становится полем, вектор —
-- одним числом (пачками мы пока не закрепляем, поэтому потери нет).

UPDATE updates SET payload =
  jsonb_build_object(
    'id', COALESCE(payload->'messages'->0, '0'::jsonb),
    'peer_id', CASE WHEN payload->'peer'->>'_' = 'peerUser'
                    THEN (payload->'peer'->>'user_id')::bigint
                    ELSE -(payload->'peer'->>'channel_id')::bigint END,
    'pinned', COALESCE((payload->'pFlags'->>'pinned')::boolean, false)
  )
 WHERE type = 'pin_message'
   AND payload IS NOT NULL
   AND payload->>'_' = 'updatePinnedMessages';
