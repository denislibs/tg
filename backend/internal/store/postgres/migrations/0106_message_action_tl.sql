-- +goose Up
-- Служебное действие переезжает из ТЕКСТА в собственную колонку и в форму схемы
-- (решение Р3 разбора, docs/readiness/tl-message-analysis.md), а проводная форма
-- сообщения сводится к одному конструктору (решение Р5).
--
-- Тот же ход, что миграции 0100 (сущности) и 0101 (разметка клавиатур): строки
-- ПЕРЕПИСЫВАЮТСЯ, а не переводятся переходником на чтении. Постоянный
-- переходник и есть тот второй источник истины, ради устранения которого
-- делается переход.
--
-- Здесь меняются четыре вещи:
--   1) messages.action — служебное действие конструктором MessageAction вместо
--      JSON внутри text (который клиент опознавал по `raw.startsWith('{')`);
--   2) лог звонка — такое же служебное сообщение (messageActionPhoneCall), а не
--      «сообщение вида call», чей текст был JSON {video, reason, duration};
--   3) reply_snapshot_text — снимок ЧУЖОГО текста, предмета в схеме не имеющий:
--      недоступный оригинал выражается парой reply_from/reply_media;
--   4) ЗАМОРОЖЕННЫЕ кадры журналов updates/channel_updates: клиент переигрывает
--      их при /sync и channels.getDifference, поэтому старая форма, оставленная
--      как есть, дала бы вторую форму сообщения на проводе.
--
-- Функции-переводчики временные: созданы, применены и удалены в одной
-- транзакции миграции.

ALTER TABLE messages ADD COLUMN action JSONB;

-- +goose StatementBegin
-- tl_banned_rights — битмаск ЗАПРЕТОВ в конструктор chatBannedRights. Срок
-- поднимается из chat_restrictions: он хранился всегда, а наружу не ехал вовсе.
-- until_date обязателен и сериализуется всегда; 0 значит «бессрочно».
CREATE FUNCTION tl_banned_rights(denied int, chat bigint, target bigint) RETURNS jsonb AS $$
DECLARE flags jsonb := '{}'::jsonb; until timestamptz;
BEGIN
  IF denied & 1  <> 0 THEN flags := flags || jsonb_build_object('send_messages', true); END IF;
  IF denied & 2  <> 0 THEN flags := flags || jsonb_build_object('send_media', true);    END IF;
  IF denied & 4  <> 0 THEN flags := flags || jsonb_build_object('invite_users', true);  END IF;
  IF denied & 8  <> 0 THEN flags := flags || jsonb_build_object('pin_messages', true);  END IF;
  IF denied & 16 <> 0 THEN flags := flags || jsonb_build_object('change_info', true);   END IF;
  SELECT until_date INTO until FROM chat_restrictions
   WHERE chat_id = chat AND user_id = target;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    '_', 'chatBannedRights',
    'pFlags', CASE WHEN flags = '{}'::jsonb THEN NULL ELSE flags END,
    'until_date', COALESCE(extract(epoch FROM until)::int, 0)));
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_action — наш JSON-экшен из текста в конструктор схемы. Таблица
-- соответствия задана разбором один раз; здесь её SQL-двойник.
--
-- Именованные потери, которых в старой записи просто НЕТ:
--   • group_create не хранил ни названия, ни списка позванных — берём текущее
--     название чата и пустой вектор (оба параметра обязательны);
--   • edit_title не хранил НОВОГО названия вовсе (долг шага A) — берём текущее:
--     для последней смены оно верно, для более ранних приблизительно, и это
--     лучше, чем пустая строка в обязательном параметре;
--   • joined_by_link хранил ВОШЕДШЕГО, а параметр означает создателя ссылки
--     (долг шага A) — поднимаем его из invite_link_joins → invite_links.
CREATE FUNCTION tl_action(t text, chat bigint, sender bigint) RETURNS jsonb AS $$
DECLARE j jsonb; act text; inviter bigint;
BEGIN
  BEGIN
    j := t::jsonb;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF j IS NULL OR jsonb_typeof(j) <> 'object' THEN
    RETURN NULL;
  END IF;
  act := j->>'action';
  CASE act
    WHEN 'group_create' THEN
      RETURN jsonb_build_object('_', 'messageActionChatCreate',
        'title', COALESCE((SELECT title FROM chats WHERE id = chat), ''),
        'users', '[]'::jsonb);
    WHEN 'add_user' THEN
      RETURN jsonb_build_object('_', 'messageActionChatAddUser',
        'users', jsonb_build_array(COALESCE((j->>'user_id')::bigint, 0)));
    WHEN 'kick_user' THEN
      RETURN jsonb_build_object('_', 'messageActionChatDeleteUser',
        'user_id', COALESCE((j->>'user_id')::bigint, 0));
    -- «Вышел сам» и «выгнали» — ОДИН конструктор: различие выводит клиент по
    -- совпадению from_id с user_id.
    WHEN 'leave' THEN
      RETURN jsonb_build_object('_', 'messageActionChatDeleteUser', 'user_id', sender);
    WHEN 'joined_by_link' THEN
      SELECT l.created_by INTO inviter
        FROM invite_link_joins jn JOIN invite_links l ON l.token = jn.token
       WHERE jn.chat_id = chat AND jn.user_id = sender
       ORDER BY jn.joined_at DESC LIMIT 1;
      RETURN jsonb_build_object('_', 'messageActionChatJoinedByLink',
        'inviter_id', COALESCE(inviter, 0));
    WHEN 'edit_title' THEN
      RETURN jsonb_build_object('_', 'messageActionChatEditTitle',
        'title', COALESCE((SELECT title FROM chats WHERE id = chat), ''));
    WHEN 'edit_photo' THEN
      RETURN jsonb_build_object('_', 'messageActionChatEditPhoto');
    WHEN 'set_ttl' THEN
      RETURN jsonb_build_object('_', 'messageActionSetMessagesTTL',
        'period', COALESCE((j->>'ttl')::int, 0));
    -- Закрепление не несёт НИЧЕГО: цель находится по reply_to самого
    -- служебного сообщения, превью строит клиент. msg_id/msg_type/msg_name/
    -- msg_text уходят целиком.
    WHEN 'pin_message' THEN
      RETURN jsonb_build_object('_', 'messageActionPinMessage');
    WHEN 'suggest_photo' THEN
      RETURN jsonb_strip_nulls(jsonb_build_object('_', 'messageActionSuggestProfilePhoto',
        'accepted', CASE WHEN (j->>'accepted')::boolean THEN true ELSE NULL END));
    WHEN 'suggest_post_approved' THEN
      RETURN jsonb_build_object('_', 'messageActionSuggestedPostApproval');
    WHEN 'suggest_post_rejected' THEN
      RETURN jsonb_build_object('_', 'messageActionSuggestedPostApproval',
        'pFlags', jsonb_build_object('rejected', true));
    WHEN 'restrict' THEN
      RETURN jsonb_build_object('_', 'messageActionRestrict',
        'user_id', COALESCE((j->>'user_id')::bigint, 0),
        'banned_rights', tl_banned_rights(COALESCE((j->>'denied_rights')::int, 0),
                                          chat, COALESCE((j->>'user_id')::bigint, 0)));
    ELSE
      RETURN NULL;
  END CASE;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_call_action — лог звонка из JSON внутри текста в messageActionPhoneCall.
-- Наши четыре причины ложатся тремя конструкторами: `ok` и `cancelled` дают
-- ОДИН phoneCallDiscardReasonHangup, различаемые НАЛИЧИЕМ duration.
CREATE FUNCTION tl_call_action(t text) RETURNS jsonb AS $$
DECLARE j jsonb; reason text; dur int;
BEGIN
  BEGIN
    j := t::jsonb;
  EXCEPTION WHEN others THEN
    j := NULL;
  END;
  IF j IS NULL OR jsonb_typeof(j) <> 'object' THEN
    j := '{}'::jsonb;
  END IF;
  reason := CASE j->>'reason'
              WHEN 'missed' THEN 'phoneCallDiscardReasonMissed'
              WHEN 'busy'   THEN 'phoneCallDiscardReasonBusy'
              ELSE 'phoneCallDiscardReasonHangup'
            END;
  dur := COALESCE((j->>'duration')::int, 0);
  RETURN jsonb_strip_nulls(jsonb_build_object(
    '_', 'messageActionPhoneCall',
    'pFlags', CASE WHEN (j->>'video')::boolean THEN jsonb_build_object('video', true) END,
    'reason', jsonb_build_object('_', reason),
    'duration', CASE WHEN dur > 0 THEN dur END));
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- ── 1. Служебные сообщения: JSON в тексте → колонка action ──────────────────
-- Цель закрепления переезжает в reply_to_id ДО того, как текст будет стёрт:
-- messageActionPinMessage параметров не имеет, и адрес живёт там же, где адрес
-- любого другого ответа.
UPDATE messages
   SET reply_to_id = (text::jsonb->>'msg_id')::bigint
 WHERE type = 'service' AND text LIKE '{%' AND reply_to_id IS NULL
   AND text LIKE '%"pin_message"%'
   AND jsonb_typeof(text::jsonb->'msg_id') = 'number';

UPDATE messages
   SET action = tl_action(text, chat_id, sender_id), text = ''
 WHERE type = 'service' AND text LIKE '{%'
   AND tl_action(text, chat_id, sender_id) IS NOT NULL;

-- Корень темы форума — ЕДИНСТВЕННОЕ служебное сообщение, чей текст был даже не
-- JSON, а готовая русская фраза со вклеенным именем автора. Название и цвет
-- иконки лежат в строке самой темы.
UPDATE messages m
   SET action = jsonb_build_object('_', 'messageActionTopicCreate',
                                   'title', t.title, 'icon_color', t.icon_color),
       text = ''
  FROM forum_topics t
 WHERE t.root_msg_id = m.id AND m.type = 'service' AND m.action IS NULL;

-- Служебное сообщение, чей текст не опознан ни одним правилом (действие из
-- версии, которой уже нет), остаётся БЕЗ действия и становится обычным пустым
-- сообщением: подделывать конструктор нечем, а старый JSON в тексте показал бы
-- клиенту сырой `{"action":…}`.
UPDATE messages SET text = '' WHERE type = 'service' AND action IS NULL AND text LIKE '{%';

-- ── 2. Лог звонка ───────────────────────────────────────────────────────────
UPDATE messages SET action = tl_call_action(text), text = '' WHERE type = 'call';

-- ── 3. Снимок чужого текста ─────────────────────────────────────────────────
ALTER TABLE messages DROP COLUMN reply_snapshot_text;

-- +goose StatementBegin
-- tl_thread_top — корень треда в кадре: было НОМЕРОМ ПОСТА В КАНАЛЕ (наш
-- перевод наружу), стало номером зеркала В ТОМ ЖЕ ПИРЕ, как reply_to_top_id
-- схемы. Форум-топик уже в том же чате и не меняется.
--
-- Не резолвится (канал отвязан, зеркало снесено) — корня нет вовсе: клиент
-- покажет комментарий в общей ленте, а подставленный чужой номер отправил бы
-- его к ДРУГОМУ сообщению этого чата.
CREATE FUNCTION tl_thread_top(chat bigint, root bigint) RETURNS bigint AS $$
DECLARE channel bigint; post bigint; mirror bigint;
BEGIN
  -- Корень в этом же чате (форум-топик) — уже в форме схемы.
  IF EXISTS (SELECT 1 FROM messages WHERE chat_id = chat AND seq = root) THEN
    RETURN root;
  END IF;
  SELECT id INTO channel FROM chats WHERE discussion_chat_id = chat LIMIT 1;
  IF channel IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO post FROM messages WHERE chat_id = channel AND seq = root;
  IF post IS NULL THEN RETURN NULL; END IF;
  SELECT seq INTO mirror FROM messages
   WHERE chat_id = chat AND is_discussion_mirror
     AND fwd_from_chat_id = channel AND fwd_from_msg_id = post;
  RETURN mirror;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_frame_message — замороженный кадр new_message в конструктор схемы.
--
-- Проход идёт ПО НАЛИЧИЮ ключей, а не перечислением типов кадров (урок 0102 и
-- 0105): перечисление устарело бы при первом же новом кадре.
CREATE FUNCTION tl_frame_message(p jsonb) RETURNS jsonb AS $$
DECLARE out jsonb; flags jsonb := '{}'::jsonb; reply jsonb := '{}'::jsonb;
        chat bigint; top bigint; act jsonb;
BEGIN
  out := p - 'sender_id' - 'type' - 'text' - 'created_at' - 'client_msg_id'
           - 'media_id' - 'sender_name' - 'poll_id' - 'checklist_id'
           - 'giveaway_id' - 'gift_id' - 'transcription' - 'send_as'
           - 'media_unread' - 'reply_to_id' - 'thread_root_id'
           - 'reply_quote_text' - 'reply_quote_offset' - 'reply_to_peer_id'
           - 'reply_snapshot_name' - 'reply_snapshot_text' - 'ttl_seconds'
           - 'effect';

  -- Автор ссылкой на пир; send-as ЗАМЕЩАЕТ автора, а не едет снимком рядом.
  IF p->'send_as'->'peer_id' IS NOT NULL THEN
    out := out || jsonb_build_object('from_id', jsonb_build_object(
      '_', 'peerChannel', 'channel_id', -((p->'send_as'->>'peer_id')::bigint)));
  ELSIF jsonb_typeof(p->'sender_id') = 'number' THEN
    out := out || jsonb_build_object('from_id', jsonb_build_object(
      '_', 'peerUser', 'user_id', (p->>'sender_id')::bigint));
  END IF;

  out := out || jsonb_build_object('message', COALESCE(p->>'text', ''));
  IF p->>'created_at' IS NOT NULL THEN
    out := out || jsonb_build_object('date',
      extract(epoch FROM (p->>'created_at')::timestamptz)::int);
  END IF;
  IF p->>'client_msg_id' IS NOT NULL THEN
    out := out || jsonb_build_object('random_id', p->>'client_msg_id');
  END IF;
  IF p->>'effect' IS NOT NULL THEN
    out := out || jsonb_build_object('effect_name', p->>'effect');
  END IF;
  IF jsonb_typeof(p->'ttl_seconds') = 'number' THEN
    out := out || jsonb_build_object('ttl_period', (p->>'ttl_seconds')::int);
  END IF;
  IF (p->>'media_unread')::boolean THEN
    flags := flags || jsonb_build_object('media_unread', true);
  END IF;

  -- Ссылка на отвечаемое: ОДИН конструктор вместо шести плоских ключей.
  chat := CASE WHEN jsonb_typeof(p->'peer_id') = 'number' AND (p->>'peer_id')::bigint < 0
               THEN -((p->>'peer_id')::bigint) END;
  IF jsonb_typeof(p->'reply_to_id') = 'number' THEN
    reply := reply || jsonb_build_object('reply_to_msg_id', (p->>'reply_to_id')::bigint);
  END IF;
  IF jsonb_typeof(p->'thread_root_id') = 'number' AND chat IS NOT NULL THEN
    top := tl_thread_top(chat, (p->>'thread_root_id')::bigint);
    IF top IS NOT NULL THEN
      reply := reply || jsonb_build_object('reply_to_top_id', top);
    END IF;
  END IF;
  IF p->'reply_to_peer_id' IS NOT NULL THEN
    reply := reply || jsonb_build_object('reply_to_peer_id', p->'reply_to_peer_id');
  ELSIF COALESCE(p->>'reply_snapshot_name', '') <> '' THEN
    reply := reply || jsonb_build_object('reply_from', jsonb_build_object(
      '_', 'messageFwdHeader', 'from_name', p->>'reply_snapshot_name', 'date', 0));
  END IF;
  IF COALESCE(p->>'reply_quote_text', '') <> '' THEN
    reply := reply || jsonb_build_object(
      'quote_text', p->>'reply_quote_text',
      'quote_offset', COALESCE((p->>'reply_quote_offset')::int, 0),
      'pFlags', jsonb_build_object('quote', true));
  END IF;
  IF reply <> '{}'::jsonb THEN
    out := out || jsonb_build_object('reply_to',
      jsonb_build_object('_', 'messageReplyHeader') || reply);
  END IF;

  -- Служебное сообщение — ДРУГОЙ конструктор, а не значение поля type.
  IF p->>'type' = 'service' THEN
    act := tl_action(p->>'text', COALESCE(chat, 0), COALESCE((p->>'sender_id')::bigint, 0));
    IF act IS NULL THEN RETURN NULL; END IF;
    out := out - 'message' - 'media' - 'entities' - 'reply_markup' - 'grouped_id'
               - 'effect_name' - 'factcheck' - 'geo' - 'contact' - 'poll'
               - 'checklist' - 'giveaway' - 'gift' - 'paid_media';
    out := out || jsonb_build_object('_', 'messageService', 'action', act);
  ELSIF p->>'type' = 'call' THEN
    out := out - 'message' - 'media' - 'entities';
    out := out || jsonb_build_object('_', 'messageService', 'action', tl_call_action(p->>'text'));
  ELSE
    out := out || jsonb_build_object('_', 'message');
  END IF;

  IF flags <> '{}'::jsonb THEN
    out := out || jsonb_build_object('pFlags', flags);
  END IF;
  RETURN out;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- ── 4. Замороженные кадры журналов ──────────────────────────────────────────
-- Кадр, чьё служебное действие не опознано, УДАЛЯЕТСЯ из журнала: оставить его
-- в старой форме значило бы вторую форму сообщения на проводе, а подделать
-- конструктор нечем. Клиент, чей курсор указывает в удалённый кадр, увидит
-- разрыв pts и переспросит историю — это деградация, а не подмена.
DELETE FROM updates
 WHERE payload ? 'created_at' AND tl_frame_message(payload) IS NULL;
DELETE FROM channel_updates
 WHERE payload ? 'created_at' AND tl_frame_message(payload) IS NULL;

-- Сообщение уезжает ВНУТРИ ключа `message`, а не полями вперемешку с конвертом:
-- форма взята у схемы, где кадр с сообщением это updateNewMessage{message, pts}.
UPDATE updates
   SET payload = jsonb_build_object('message', tl_frame_message(payload))
 WHERE payload ? 'created_at';
UPDATE channel_updates
   SET payload = jsonb_build_object('message', tl_frame_message(payload))
 WHERE payload ? 'created_at';

-- Кадры-ПАТЧИ сообщением не становятся (см. editUpdatePayload), но имена их
-- ключей взяты у схемы: text → message, edited_at → edit_date (секунды, а не
-- RFC3339). Иначе один и тот же смысл ехал бы двумя именами — ровно тот второй
-- источник истины, ради которого делается переход.
UPDATE updates
   SET payload = (payload - 'text' - 'edited_at')
                 || jsonb_build_object('message', COALESCE(payload->>'text', ''))
                 || CASE WHEN payload->>'edited_at' IS NULL THEN '{}'::jsonb
                         ELSE jsonb_build_object('edit_date',
                                extract(epoch FROM (payload->>'edited_at')::timestamptz)::int) END
 WHERE payload ? 'edited_at' AND NOT payload ? 'created_at';

-- Время обновления живой трансляции переезжает ИЗ гео на верхний уровень: одно
-- и то же edited_at значило и «время правки», и «время обновления координат».
UPDATE updates
   SET payload = jsonb_set(payload, '{geo}', (payload->'geo') - 'edited_at')
                 || jsonb_build_object('edit_date',
                      extract(epoch FROM (payload->'geo'->>'edited_at')::timestamptz)::int)
 WHERE payload->'geo' ? 'edited_at';

DROP FUNCTION tl_frame_message(jsonb);
DROP FUNCTION tl_thread_top(bigint, bigint);
DROP FUNCTION tl_call_action(text);
DROP FUNCTION tl_action(text, bigint, bigint);
DROP FUNCTION tl_banned_rights(int, bigint, bigint);

-- +goose Down
-- Обратный перевод. ⚠ Восстанавливается ФОРМА, но не всё содержимое: снимок
-- чужого текста (reply_snapshot_text), превью закреплённого и склеенная фраза
-- корня темы форума невосстановимы — их не существует ни в одной другой
-- строке. Названо здесь, а не скрыто.
ALTER TABLE messages ADD COLUMN reply_snapshot_text TEXT NOT NULL DEFAULT '';

-- +goose StatementBegin
CREATE FUNCTION tl_action_legacy(a jsonb, sender bigint) RETURNS text AS $$
BEGIN
  IF a IS NULL THEN RETURN NULL; END IF;
  CASE a->>'_'
    WHEN 'messageActionChatCreate' THEN
      RETURN jsonb_build_object('action', 'group_create', 'actor_id', sender)::text;
    WHEN 'messageActionChatAddUser' THEN
      RETURN jsonb_build_object('action', 'add_user', 'actor_id', sender,
        'user_id', COALESCE((a->'users'->>0)::bigint, 0))::text;
    -- «Вышел сам» отличается от «выгнали» совпадением автора с целью — ровно
    -- тем же признаком, по которому его выводит клиент.
    WHEN 'messageActionChatDeleteUser' THEN
      IF (a->>'user_id')::bigint = sender THEN
        RETURN jsonb_build_object('action', 'leave', 'actor_id', sender)::text;
      END IF;
      RETURN jsonb_build_object('action', 'kick_user', 'actor_id', sender,
        'user_id', (a->>'user_id')::bigint)::text;
    WHEN 'messageActionChatJoinedByLink' THEN
      RETURN jsonb_build_object('action', 'joined_by_link', 'actor_id', sender)::text;
    WHEN 'messageActionChatEditTitle' THEN
      RETURN jsonb_build_object('action', 'edit_title', 'actor_id', sender)::text;
    WHEN 'messageActionChatEditPhoto' THEN
      RETURN jsonb_build_object('action', 'edit_photo', 'actor_id', sender)::text;
    WHEN 'messageActionSetMessagesTTL' THEN
      RETURN jsonb_build_object('action', 'set_ttl', 'actor_id', sender,
        'ttl', COALESCE((a->>'period')::int, 0))::text;
    WHEN 'messageActionPinMessage' THEN
      RETURN jsonb_build_object('action', 'pin_message', 'actor_id', sender)::text;
    WHEN 'messageActionSuggestProfilePhoto' THEN
      RETURN jsonb_build_object('action', 'suggest_photo', 'actor_id', sender,
        'accepted', COALESCE((a->>'accepted')::boolean, false))::text;
    WHEN 'messageActionSuggestedPostApproval' THEN
      RETURN jsonb_build_object('action',
        CASE WHEN (a->'pFlags'->>'rejected')::boolean
             THEN 'suggest_post_rejected' ELSE 'suggest_post_approved' END,
        'chat', '')::text;
    WHEN 'messageActionRestrict' THEN
      RETURN jsonb_build_object('action', 'restrict', 'actor_id', sender,
        'user_id', COALESCE((a->>'user_id')::bigint, 0),
        'denied_rights',
          (CASE WHEN (a->'banned_rights'->'pFlags'->>'send_messages')::boolean THEN 1 ELSE 0 END)
        + (CASE WHEN (a->'banned_rights'->'pFlags'->>'send_media')::boolean    THEN 2 ELSE 0 END)
        + (CASE WHEN (a->'banned_rights'->'pFlags'->>'invite_users')::boolean  THEN 4 ELSE 0 END)
        + (CASE WHEN (a->'banned_rights'->'pFlags'->>'pin_messages')::boolean  THEN 8 ELSE 0 END)
        + (CASE WHEN (a->'banned_rights'->'pFlags'->>'change_info')::boolean   THEN 16 ELSE 0 END))::text;
    WHEN 'messageActionPhoneCall' THEN
      RETURN jsonb_strip_nulls(jsonb_build_object(
        'video', COALESCE((a->'pFlags'->>'video')::boolean, false),
        'reason', CASE a->'reason'->>'_'
                    WHEN 'phoneCallDiscardReasonMissed' THEN 'missed'
                    WHEN 'phoneCallDiscardReasonBusy'   THEN 'busy'
                    ELSE CASE WHEN (a->>'duration') IS NULL THEN 'cancelled' ELSE 'ok' END
                  END,
        'duration', COALESCE((a->>'duration')::int, 0)))::text;
    -- Корень темы форума собирается фразой без имени автора: имени в строке
    -- сообщения нет, а склеивать его снова тем более незачем.
    WHEN 'messageActionTopicCreate' THEN
      RETURN 'Тема «' || COALESCE(a->>'title', '') || '»';
    ELSE
      RETURN NULL;
  END CASE;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

UPDATE messages
   SET text = COALESCE(tl_action_legacy(action, sender_id), text)
 WHERE action IS NOT NULL;

-- Кадры журналов обратно не разворачиваются: собрать плоский снимок из
-- конструктора можно, но часть ключей (type, media_id, sender_name) в нём не
-- существует вовсе, и восстановленный кадр был бы третьей формой. Удаляем —
-- клиент переспросит историю.
DELETE FROM updates WHERE payload->'message'->>'_' IN ('message', 'messageService');
DELETE FROM channel_updates WHERE payload->'message'->>'_' IN ('message', 'messageService');

UPDATE updates
   SET payload = (payload - 'message' - 'edit_date')
                 || jsonb_build_object('text', COALESCE(payload->>'message', ''))
                 || CASE WHEN payload->>'edit_date' IS NULL THEN '{}'::jsonb
                         ELSE jsonb_build_object('edited_at',
                                to_char(to_timestamp((payload->>'edit_date')::bigint) AT TIME ZONE 'UTC',
                                        'YYYY-MM-DD"T"HH24:MI:SS"Z"')) END
 WHERE payload ? 'message' AND jsonb_typeof(payload->'message') = 'string';

DROP FUNCTION tl_action_legacy(jsonb, bigint);
ALTER TABLE messages DROP COLUMN action;
