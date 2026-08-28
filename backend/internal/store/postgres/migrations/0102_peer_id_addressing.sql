-- +goose Up
-- Адресация переезжает на знаковый PeerId оригинала: пользователь ≥ 0, чат < 0
-- (tweb utils/peers/isUser.ts, isAnyChat.ts, helpers/peerIdPolyfill.ts).
-- Приватного чата как сущности в оригинале нет вовсе — ключ приватного диалога
-- это id СОБЕСЕДНИКА. Строка в chats для него остаётся внутренней деталью
-- сервера и наружу — в URL, тела, кадры и ЭТИ ЖУРНАЛЫ — больше не выходит.
--
-- Здесь переписываются ЗАМОРОЖЕННЫЕ кадры журналов апдейтов: клиент
-- переигрывает их при /sync и channels.getDifference, поэтому старая запись,
-- оставленная как есть, дала бы вторую форму на проводе — ровно тот второй
-- источник истины, ради устранения которого делается переход.
--
-- ⚠ Асимметрия, из-за которой это не обычный rename поля. У приватного диалога
-- ключ РАЗНЫЙ у двух сторон одного разговора: строка журнала пользователя A
-- получает id B, строка B — id A. Симметричная замена (один chat_id → один
-- peer_id) перепутала бы диалоги: каждая сторона открыла бы чат «сама с собой».
-- Поэтому updates переписываются с оглядкой на updates.user_id, а не только на
-- payload.
--
-- Типы кадров, найденные грепом по usecase (не только три из разбора):
--   updates:          new_message, edit_message, delete_message, read,
--                     media_read, reaction, star_reaction, pin_message,
--                     factcheck_update, chat_update, chat_theme_update,
--                     checklist_update, poll_update, giveaway_update,
--                     web_page_update, draft_update, dialog_pin,
--                     dialog_archive, dialog_mute, chat_removed,
--                     paid_media_unlock, folder_update;
--   channel_updates:  new_message, chat_update, boost_update.
-- Все они, кроме folder_update и user_update, несут ключ чата верхним полем
-- chat_id — поэтому верхний уровень переписывается ОДНИМ проходом по наличию
-- ключа, а не перечислением типов: перечисление устарело бы при первом же
-- новом кадре.
--
-- user_update и balance_update ключа чата не несут вовсе: user_update
-- адресует пользователя полем id, а id пользователя И ЕСТЬ его peerId (≥ 0) —
-- переводить нечего.
--
-- Вложенные ссылки на чат внутри кадра:
--   send_as.chat_id        → send_as.peer_id     (send-as бывает только каналом/супергруппой)
--   fwd_from_chat_id       → fwd_from_peer_id    (источник пересылки)
--   reply_to_peer_id       → знак меняется       (имя уже верное, значение было chats.id)
--   giveaway.chat_id       → giveaway.peer_id    (розыгрыши только в каналах)
--   draft.chat_id          → удаляется           (ключ несёт сам кадр)
--   folder.include_chats/exclude_chats → include_peers/exclude_peers (пер-юзерно!)
-- Вложенный снимок contact несёт user_id — это уже валидный ключ пира
-- (у пользователя peerId совпадает с id), переводить нечего.
--
-- bot_updates не трогаем сознательно: очередь публичного Bot API со своим
-- контрактом, где chat_id — чужая документация (см. botapi_handler.go).
--
-- Функции-переводчики временные: созданы, применены и удалены в одной
-- транзакции миграции — постоянного переходника в базе не остаётся.

-- +goose StatementBegin
-- tl_peer_id — ключ пира чата ГЛАЗАМИ зрителя. SQL-двойник
-- chatAddress.forViewer (usecase/chat/peeraddr.go).
CREATE FUNCTION tl_peer_id(chat bigint, viewer bigint) RETURNS bigint AS $$
  SELECT CASE
    WHEN c.type IN ('private', 'saved') THEN
      -- Приватный диалог: пир это собеседник; «Избранное» (единственный
      -- участник) — сам зритель.
      COALESCE((SELECT m.user_id FROM chat_members m
                 WHERE m.chat_id = c.id AND m.user_id <> viewer LIMIT 1), viewer)
    ELSE -c.id
  END
  FROM chats c WHERE c.id = chat;
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_peer_nested — вложенные ссылки на чат внутри кадра. Зрителя они не знают
-- и знать не должны: это ссылки на группу/канал, одинаковые для всех.
CREATE FUNCTION tl_peer_nested(p jsonb) RETURNS jsonb AS $$
DECLARE
  out_ jsonb := p;
  sa jsonb;
  gw jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN p;
  END IF;

  IF jsonb_typeof(p->'send_as') = 'object' AND (p->'send_as') ? 'chat_id' THEN
    sa := (p->'send_as') - 'chat_id'
          || jsonb_build_object('peer_id', -((p->'send_as'->>'chat_id')::bigint));
    out_ := out_ || jsonb_build_object('send_as', sa);
  END IF;

  IF out_ ? 'fwd_from_chat_id' THEN
    out_ := (out_ - 'fwd_from_chat_id') || jsonb_build_object('fwd_from_peer_id',
              CASE WHEN jsonb_typeof(out_->'fwd_from_chat_id') = 'number'
                   THEN to_jsonb(-((out_->>'fwd_from_chat_id')::bigint))
                   ELSE 'null'::jsonb END);
  END IF;

  -- reply_to_peer_id: имя уже верное, менялось только значение (был chats.id).
  IF jsonb_typeof(out_->'reply_to_peer_id') = 'number' AND (out_->>'reply_to_peer_id')::bigint > 0 THEN
    out_ := jsonb_set(out_, '{reply_to_peer_id}', to_jsonb(-((out_->>'reply_to_peer_id')::bigint)));
  END IF;

  IF jsonb_typeof(out_->'giveaway') = 'object' AND (out_->'giveaway') ? 'chat_id' THEN
    gw := (out_->'giveaway') - 'chat_id'
          || jsonb_build_object('peer_id', -((out_->'giveaway'->>'chat_id')::bigint));
    out_ := out_ || jsonb_build_object('giveaway', gw);
  END IF;

  -- Черновик: ключ чата несёт сам кадр draft_update, дублировать нечего.
  IF jsonb_typeof(out_->'draft') = 'object' AND (out_->'draft') ? 'chat_id' THEN
    out_ := out_ || jsonb_build_object('draft', (out_->'draft') - 'chat_id');
  END IF;

  RETURN out_;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_folder_peers — правила папки: списки chat_id → списки ключей пиров глазами
-- владельца папки (тот же viewer, что у строки журнала).
CREATE FUNCTION tl_folder_peers(f jsonb, viewer bigint) RETURNS jsonb AS $$
DECLARE
  out_ jsonb := f;
  inc jsonb;
  exc jsonb;
BEGIN
  IF f IS NULL OR jsonb_typeof(f) <> 'object' THEN
    RETURN f;
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(COALESCE(tl_peer_id(v::bigint, viewer), -v::bigint)) ORDER BY ord), '[]'::jsonb)
    INTO inc
    FROM jsonb_array_elements_text(COALESCE(f->'include_chats', '[]'::jsonb)) WITH ORDINALITY AS t(v, ord);
  SELECT COALESCE(jsonb_agg(to_jsonb(COALESCE(tl_peer_id(v::bigint, viewer), -v::bigint)) ORDER BY ord), '[]'::jsonb)
    INTO exc
    FROM jsonb_array_elements_text(COALESCE(f->'exclude_chats', '[]'::jsonb)) WITH ORDINALITY AS t(v, ord);
  out_ := (out_ - 'include_chats' - 'exclude_chats')
          || jsonb_build_object('include_peers', inc, 'exclude_peers', exc);
  RETURN out_;
END;
$$ LANGUAGE plpgsql STABLE;
-- +goose StatementEnd

-- Верхний уровень персональных журналов: chat_id → peer_id ГЛАЗАМИ user_id.
-- Чата уже нет (кадр chat_removed после удаления группы) — падаем на -chat_id:
-- группа/канал, приватный диалог не удаляется.
UPDATE updates
   SET payload = (payload - 'chat_id')
                 || jsonb_build_object('peer_id',
                      COALESCE(tl_peer_id((payload->>'chat_id')::bigint, user_id),
                               -((payload->>'chat_id')::bigint)))
 WHERE jsonb_typeof(payload->'chat_id') = 'number';

UPDATE updates SET payload = tl_peer_nested(payload)
 WHERE payload ? 'send_as' OR payload ? 'fwd_from_chat_id'
    OR payload ? 'reply_to_peer_id' OR payload ? 'giveaway' OR payload ? 'draft';

UPDATE updates
   SET payload = jsonb_set(payload, '{folder}', tl_folder_peers(payload->'folder', user_id))
 WHERE type = 'folder_update' AND jsonb_typeof(payload->'folder') = 'object';

-- Журнал канала: ключ пира один на всех подписчиков (-channel_id), зрителя нет.
UPDATE channel_updates
   SET payload = (payload - 'chat_id') || jsonb_build_object('peer_id', -channel_id)
 WHERE jsonb_typeof(payload->'chat_id') = 'number';

UPDATE channel_updates SET payload = tl_peer_nested(payload)
 WHERE payload ? 'send_as' OR payload ? 'fwd_from_chat_id'
    OR payload ? 'reply_to_peer_id' OR payload ? 'giveaway' OR payload ? 'draft';

DROP FUNCTION tl_folder_peers(jsonb, bigint);
DROP FUNCTION tl_peer_nested(jsonb);
DROP FUNCTION tl_peer_id(bigint, bigint);

-- +goose Down
-- Обратный перевод в прежнюю форму. Ключ пира однозначно возвращается в
-- chats.id: отрицательный — это -chat_id, положительный — id собеседника, из
-- которого приватный чат ищется по chat_members вместе с владельцем строки
-- журнала (то же место, откуда он брался при накате).

-- +goose StatementBegin
-- flat_chat_id — ключ пира обратно во внутренний chats.id глазами зрителя.
CREATE FUNCTION flat_chat_id(peer bigint, viewer bigint) RETURNS bigint AS $$
  SELECT CASE
    WHEN peer < 0 THEN -peer
    WHEN peer = viewer THEN (SELECT c.id FROM chats c WHERE c.type = 'saved'
                              AND EXISTS (SELECT 1 FROM chat_members m
                                           WHERE m.chat_id = c.id AND m.user_id = viewer) LIMIT 1)
    ELSE (SELECT c.id FROM chats c
            JOIN chat_members a ON a.chat_id = c.id AND a.user_id = viewer
            JOIN chat_members b ON b.chat_id = c.id AND b.user_id = peer
           WHERE c.type = 'private' LIMIT 1)
  END;
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION flat_peer_nested(p jsonb) RETURNS jsonb AS $$
DECLARE
  out_ jsonb := p;
  sa jsonb;
  gw jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN p;
  END IF;

  IF jsonb_typeof(p->'send_as') = 'object' AND (p->'send_as') ? 'peer_id' THEN
    sa := (p->'send_as') - 'peer_id'
          || jsonb_build_object('chat_id', -((p->'send_as'->>'peer_id')::bigint));
    out_ := out_ || jsonb_build_object('send_as', sa);
  END IF;

  IF out_ ? 'fwd_from_peer_id' THEN
    out_ := (out_ - 'fwd_from_peer_id') || jsonb_build_object('fwd_from_chat_id',
              CASE WHEN jsonb_typeof(out_->'fwd_from_peer_id') = 'number'
                   THEN to_jsonb(-((out_->>'fwd_from_peer_id')::bigint))
                   ELSE 'null'::jsonb END);
  END IF;

  IF jsonb_typeof(out_->'reply_to_peer_id') = 'number' AND (out_->>'reply_to_peer_id')::bigint < 0 THEN
    out_ := jsonb_set(out_, '{reply_to_peer_id}', to_jsonb(-((out_->>'reply_to_peer_id')::bigint)));
  END IF;

  IF jsonb_typeof(out_->'giveaway') = 'object' AND (out_->'giveaway') ? 'peer_id' THEN
    gw := (out_->'giveaway') - 'peer_id'
          || jsonb_build_object('chat_id', -((out_->'giveaway'->>'peer_id')::bigint));
    out_ := out_ || jsonb_build_object('giveaway', gw);
  END IF;

  RETURN out_;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION flat_folder_chats(f jsonb, viewer bigint) RETURNS jsonb AS $$
DECLARE
  out_ jsonb := f;
  inc jsonb;
  exc jsonb;
BEGIN
  IF f IS NULL OR jsonb_typeof(f) <> 'object' THEN
    RETURN f;
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY ord), '[]'::jsonb) INTO inc
    FROM (SELECT flat_chat_id(v::bigint, viewer) AS c, ord
            FROM jsonb_array_elements_text(COALESCE(f->'include_peers', '[]'::jsonb)) WITH ORDINALITY AS t(v, ord)) q
   WHERE c IS NOT NULL;
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY ord), '[]'::jsonb) INTO exc
    FROM (SELECT flat_chat_id(v::bigint, viewer) AS c, ord
            FROM jsonb_array_elements_text(COALESCE(f->'exclude_peers', '[]'::jsonb)) WITH ORDINALITY AS t(v, ord)) q
   WHERE c IS NOT NULL;
  out_ := (out_ - 'include_peers' - 'exclude_peers')
          || jsonb_build_object('include_chats', inc, 'exclude_chats', exc);
  RETURN out_;
END;
$$ LANGUAGE plpgsql STABLE;
-- +goose StatementEnd

UPDATE updates
   SET payload = jsonb_set(payload, '{folder}', flat_folder_chats(payload->'folder', user_id))
 WHERE type = 'folder_update' AND jsonb_typeof(payload->'folder') = 'object';

UPDATE updates SET payload = flat_peer_nested(payload)
 WHERE payload ? 'send_as' OR payload ? 'fwd_from_peer_id'
    OR payload ? 'reply_to_peer_id' OR payload ? 'giveaway';

UPDATE updates
   SET payload = (payload - 'peer_id')
                 || jsonb_build_object('chat_id',
                      COALESCE(flat_chat_id((payload->>'peer_id')::bigint, user_id),
                               -((payload->>'peer_id')::bigint)))
 WHERE jsonb_typeof(payload->'peer_id') = 'number';

UPDATE channel_updates SET payload = flat_peer_nested(payload)
 WHERE payload ? 'send_as' OR payload ? 'fwd_from_peer_id'
    OR payload ? 'reply_to_peer_id' OR payload ? 'giveaway';

UPDATE channel_updates
   SET payload = (payload - 'peer_id') || jsonb_build_object('chat_id', channel_id)
 WHERE jsonb_typeof(payload->'peer_id') = 'number';

DROP FUNCTION flat_folder_chats(jsonb, bigint);
DROP FUNCTION flat_peer_nested(jsonb);
DROP FUNCTION flat_chat_id(bigint, bigint);
