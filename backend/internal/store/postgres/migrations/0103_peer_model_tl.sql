-- +goose Up
-- Пиры и чаты переезжают на модель оригинала (шаг C программы
-- docs/readiness/tl-program.md, разбор — docs/readiness/tl-peers-analysis.md).
-- Здесь три разных дела, которые нельзя разнести по разным миграциям, не
-- оставив базу в промежуточном состоянии:
--
--   1. АВАТАРКА адресуется id медиа, а не строкой «/media/N/content». Прежде
--      id собирали в delivery в строку, писали строку в колонку, а потом
--      выпарсивали то же число обратно `Sscanf`-ом (usecase/auth) и регуляркой
--      (фронт). Колонка становится числом — переходников не остаётся;
--   2. ВИДИМОСТЬ НОМЕРА перестаёт быть колонкой users.phone_visibility: это
--      правило приватности, и механизм privacy_rules с ключом 'phone_number' у
--      нас уже есть. Два независимых механизма на один вопрос (дефект 2
--      разбора) схлопываются в один, а значения колонки переносятся в правила;
--   3. ЗАМОРОЖЕННЫЕ КАДРЫ журналов переписываются под новую форму — как у
--      сущностей (0100) и разметки (0101). Клиент переигрывает их при /sync и
--      channels.getDifference, поэтому оставленная как есть строка дала бы
--      вторую форму на проводе.
--
-- Функции-переводчики временные: созданы, применены и удалены в одной
-- транзакции миграции — постоянного переходника в базе не остаётся.

-- +goose StatementBegin
-- tl_media_id — id медиа из content-пути «/media/N/content». NULL, если путь
-- пуст или не медийный (аватарки ботов ставились произвольным url).
CREATE FUNCTION tl_media_id(u text) RETURNS bigint AS $$
  SELECT NULLIF(substring(COALESCE(u, '') FROM '^/media/([0-9]+)/content$'), '')::bigint;
$$ LANGUAGE sql IMMUTABLE;
-- +goose StatementEnd

-- ── 1. Аватарки: строка пути → id медиа ────────────────────────────────────

ALTER TABLE users ADD COLUMN avatar_media_id BIGINT;
UPDATE users SET avatar_media_id = tl_media_id(avatar_url);
ALTER TABLE users DROP COLUMN avatar_url;

ALTER TABLE profile_photos ADD COLUMN media_id BIGINT;
ALTER TABLE profile_photos ADD COLUMN video_media_id BIGINT;
UPDATE profile_photos SET media_id = tl_media_id(url), video_media_id = tl_media_id(video_url);
-- Строки, у которых путь не разобрался, ссылались бы в никуда: фото галереи
-- без медиа — это не «фото без превью», а мусор, который клиент нарисовать не
-- может. Удаляем, а не оставляем NULL под NOT NULL.
DELETE FROM profile_photos WHERE media_id IS NULL;
ALTER TABLE profile_photos ALTER COLUMN media_id SET NOT NULL;
ALTER TABLE profile_photos DROP COLUMN url;
ALTER TABLE profile_photos DROP COLUMN video_url;

ALTER TABLE contact_custom_photo ADD COLUMN media_id BIGINT;
UPDATE contact_custom_photo SET media_id = tl_media_id(url);
DELETE FROM contact_custom_photo WHERE media_id IS NULL;
ALTER TABLE contact_custom_photo ALTER COLUMN media_id SET NOT NULL;
ALTER TABLE contact_custom_photo DROP COLUMN url;

-- ── 2. phone_visibility → правило приватности phone_number ─────────────────
-- Значения совпадают буквально ('nobody'/'contacts'/'everybody'), поэтому
-- перенос — вставка строки правила. Уже сохранённое правило пользователя
-- перекрывает колонку: оно новее и было единственным, что реально читалось
-- ручкой /me/privacy.
INSERT INTO privacy_rules (user_id, key, value)
SELECT id, 'phone_number', phone_visibility FROM users
 WHERE phone_visibility IS NOT NULL AND phone_visibility <> ''
ON CONFLICT (user_id, key) DO NOTHING;
ALTER TABLE users DROP COLUMN phone_visibility;

-- ── 3. Замороженные кадры журналов ─────────────────────────────────────────

-- +goose StatementBegin
-- tl_fwd_from — плоская атрибуция пересылки → конструктор messageFwdHeader.
-- from_id это ССЫЛКА НА ПИР: у поста канала peerChannel, у пересылки от
-- человека peerUser. Здесь же закрывается долг шага B: прежний
-- fwd_from_peer_id брался как -chat_id БЕЗУСЛОВНО, то есть у источника —
-- приватного чата наружу уезжал внутренний ключ строки chats. Для приватного
-- источника ключа пира не существует вовсе, поэтому saved_from_peer не
-- ставится, а автор берётся из fwd_from_user_id.
CREATE FUNCTION tl_fwd_from(p jsonb) RETURNS jsonb AS $$
DECLARE
  src_chat bigint := NULLIF(p->>'fwd_from_peer_id', '')::bigint;
  src_user bigint := NULLIF(p->>'fwd_from_user_id', '')::bigint;
  src_msg  bigint := NULLIF(p->>'fwd_from_msg_id', '')::bigint;
  src_type text;
  hdr jsonb;
BEGIN
  IF src_chat IS NULL AND src_user IS NULL AND (p->>'fwd_from_name') IS NULL THEN
    RETURN p - 'fwd_from_user_id' - 'fwd_from_peer_id' - 'fwd_from_msg_id'
             - 'fwd_date' - 'fwd_from_name';
  END IF;

  hdr := jsonb_build_object('_', 'messageFwdHeader', 'date',
           COALESCE(EXTRACT(EPOCH FROM (p->>'fwd_date')::timestamptz)::int, 0));

  IF (p->>'fwd_from_name') IS NOT NULL THEN
    -- Скрытая атрибуция (правило forwards): только имя, ссылки на аккаунт нет.
    hdr := hdr || jsonb_build_object('from_name', p->>'fwd_from_name');
  ELSE
    IF src_chat IS NOT NULL THEN
      SELECT c.type INTO src_type FROM chats c WHERE c.id = -src_chat;
    END IF;
    IF src_user IS NOT NULL THEN
      hdr := hdr || jsonb_build_object('from_id',
               jsonb_build_object('_', 'peerUser', 'user_id', src_user));
    ELSIF src_chat IS NOT NULL THEN
      hdr := hdr || jsonb_build_object('from_id',
               jsonb_build_object('_', 'peerChannel', 'channel_id', -src_chat));
    END IF;
    IF src_chat IS NOT NULL AND src_type IN ('group', 'channel') THEN
      hdr := hdr || jsonb_build_object('saved_from_peer',
               jsonb_build_object('_', 'peerChannel', 'channel_id', -src_chat));
      IF src_msg IS NOT NULL THEN
        hdr := hdr || jsonb_build_object('saved_from_msg_id', src_msg);
      END IF;
    END IF;
    IF src_type = 'channel' AND src_msg IS NOT NULL THEN
      hdr := hdr || jsonb_build_object('channel_post', src_msg);
    END IF;
  END IF;

  RETURN (p - 'fwd_from_user_id' - 'fwd_from_peer_id' - 'fwd_from_msg_id'
            - 'fwd_date' - 'fwd_from_name')
         || jsonb_build_object('fwd_from', hdr);
END;
$$ LANGUAGE plpgsql STABLE;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_reply_peer — число reply_to_peer_id → ссылка на пир. Та же болезнь:
-- у приватного источника ключ был внутренним. Восстановить из него пир
-- глазами получателя нельзя (строка журнала знает получателя, но пир
-- приватного чата — это СОБЕСЕДНИК, и для разных получателей он разный),
-- поэтому у приватного источника ссылка снимается вовсе: снимок ответа
-- (reply_snapshot_name/text) на месте, а битого ключа не остаётся.
CREATE FUNCTION tl_reply_peer(p jsonb) RETURNS jsonb AS $$
DECLARE
  peer bigint := NULLIF(p->>'reply_to_peer_id', '')::bigint;
  typ  text;
BEGIN
  IF peer IS NULL THEN
    RETURN p;
  END IF;
  IF peer > 0 THEN
    RETURN jsonb_set(p, '{reply_to_peer_id}',
             jsonb_build_object('_', 'peerUser', 'user_id', peer));
  END IF;
  SELECT c.type INTO typ FROM chats c WHERE c.id = -peer;
  IF typ IN ('group', 'channel') THEN
    RETURN jsonb_set(p, '{reply_to_peer_id}',
             jsonb_build_object('_', 'peerChannel', 'channel_id', -peer));
  END IF;
  RETURN p - 'reply_to_peer_id';
END;
$$ LANGUAGE plpgsql STABLE;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_user_update — кадр user_update: был выборкой плоских полей
-- ({id, username, display_name, avatar_changed}), стал конструктором `user`.
-- display_name на провод не идёт вовсе (имя собирает клиент), а first_name/
-- last_name у кадра нет — берём из таблицы: снимок абсолютный, и свежая
-- строка вернее замороженной.
CREATE FUNCTION tl_user_update(p jsonb) RETURNS jsonb AS $$
DECLARE
  uid bigint := NULLIF(p->>'id', '')::bigint;
  u   record;
  out_ jsonb;
BEGIN
  IF uid IS NULL THEN
    RETURN p;
  END IF;
  SELECT first_name, last_name, username, is_bot, is_verified, is_premium,
         emoji_status, deleted_at
    INTO u FROM users WHERE id = uid;
  out_ := jsonb_build_object('_', 'user', 'id', uid);
  IF u.first_name IS NOT NULL AND u.first_name <> '' THEN
    out_ := out_ || jsonb_build_object('first_name', u.first_name);
  END IF;
  IF u.last_name IS NOT NULL AND u.last_name <> '' THEN
    out_ := out_ || jsonb_build_object('last_name', u.last_name);
  END IF;
  IF COALESCE(u.username, COALESCE(p->>'username', '')) <> '' THEN
    out_ := out_ || jsonb_build_object('username', COALESCE(u.username, p->>'username'));
  END IF;
  IF COALESCE(u.emoji_status, '') <> '' THEN
    out_ := out_ || jsonb_build_object('emoji_status_emoticon', u.emoji_status);
  END IF;
  -- pFlags несёт только выставленные флаги: «выключено» это ОТСУТСТВИЕ ключа.
  out_ := out_ || (SELECT CASE WHEN f = '{}'::jsonb THEN '{}'::jsonb
                               ELSE jsonb_build_object('pFlags', f) END
                     FROM (SELECT (CASE WHEN u.is_bot THEN jsonb_build_object('bot', true) ELSE '{}'::jsonb END
                                || CASE WHEN u.is_verified THEN jsonb_build_object('verified', true) ELSE '{}'::jsonb END
                                || CASE WHEN u.is_premium THEN jsonb_build_object('premium', true) ELSE '{}'::jsonb END
                                || CASE WHEN u.deleted_at IS NOT NULL THEN jsonb_build_object('deleted', true) ELSE '{}'::jsonb END) AS f) q);
  RETURN out_;
END;
$$ LANGUAGE plpgsql STABLE;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_chat_update — кадр chat_update: был плоским снимком ChatCard, стал парой
-- конструкторов messages.chatFull{full_chat, chats}. Абсолютность снимка при
-- этом сохраняется — клиент по-прежнему просто заменяет карточку.
CREATE FUNCTION tl_chat_update(p jsonb) RETURNS jsonb AS $$
DECLARE
  cid bigint := ABS(NULLIF(p->>'peer_id', '')::bigint);
  c   record;
  chat jsonb;
  fullc jsonb;
  pf   jsonb := '{}'::jsonb;
  reactions jsonb;
BEGIN
  IF cid IS NULL THEN
    RETURN p;
  END IF;
  SELECT type, title, COALESCE(username, '') AS username, COALESCE(about, '') AS about,
         photo_media_id, member_count, COALESCE(discussion_chat_id, 0) AS discussion_chat_id,
         signatures, signature_profiles, default_permissions, slowmode_seconds,
         reactions_mode, reactions_allowed, history_for_new, charge_stars,
         COALESCE(auto_delete_period, 0) AS auto_delete_period, is_forum
    INTO c FROM chats WHERE id = cid;
  IF NOT FOUND THEN
    RETURN p;
  END IF;

  -- Вид чата — выбор флагов, а не строка type (решение №2 разбора).
  IF c.type = 'channel' THEN pf := pf || jsonb_build_object('broadcast', true); END IF;
  IF c.type = 'group'   THEN pf := pf || jsonb_build_object('megagroup', true); END IF;
  IF c.signatures       THEN pf := pf || jsonb_build_object('signatures', true); END IF;
  IF c.signature_profiles THEN pf := pf || jsonb_build_object('signature_profiles', true); END IF;
  IF COALESCE(c.slowmode_seconds, 0) > 0 THEN pf := pf || jsonb_build_object('slowmode_enabled', true); END IF;
  IF c.is_forum THEN pf := pf || jsonb_build_object('forum', true); END IF;
  IF COALESCE(c.discussion_chat_id, 0) <> 0 THEN pf := pf || jsonb_build_object('has_link', true); END IF;

  chat := jsonb_build_object('_', 'channel', 'id', cid, 'title', COALESCE(c.title, ''),
            'photo', CASE WHEN c.photo_media_id IS NULL
                          THEN jsonb_build_object('_', 'chatPhotoEmpty')
                          ELSE jsonb_build_object('_', 'chatPhoto', 'photo_id', c.photo_media_id) END,
            'date', 0);
  IF pf <> '{}'::jsonb THEN chat := chat || jsonb_build_object('pFlags', pf); END IF;
  IF c.username <> '' THEN chat := chat || jsonb_build_object('username', c.username); END IF;
  IF COALESCE(c.member_count, 0) <> 0 THEN
    chat := chat || jsonb_build_object('participants_count', c.member_count);
  END IF;
  IF COALESCE(c.charge_stars, 0) <> 0 THEN
    chat := chat || jsonb_build_object('send_paid_messages_stars', c.charge_stars);
  END IF;

  reactions := CASE c.reactions_mode
    WHEN 'none' THEN jsonb_build_object('_', 'chatReactionsNone')
    WHEN 'some' THEN jsonb_build_object('_', 'chatReactionsSome',
                       'reactions', (SELECT COALESCE(jsonb_agg(jsonb_build_object('_', 'reactionEmoji', 'emoticon', e)), '[]'::jsonb)
                                       FROM jsonb_array_elements_text(COALESCE(c.reactions_allowed, '[]'::jsonb)) AS t(e)))
    ELSE jsonb_build_object('_', 'chatReactionsAll') END;

  fullc := jsonb_build_object('_', 'channelFull', 'id', cid, 'about', c.about,
            'read_inbox_max_id', 0, 'read_outbox_max_id', 0, 'unread_count', 0,
            'chat_photo', NULL, 'available_reactions', reactions);
  -- history_for_new и hidden_prehistory — одно свойство с обратным знаком.
  IF NOT COALESCE(c.history_for_new, true) THEN
    fullc := fullc || jsonb_build_object('pFlags', jsonb_build_object('hidden_prehistory', true));
  END IF;
  IF COALESCE(c.member_count, 0) <> 0 THEN
    fullc := fullc || jsonb_build_object('participants_count', c.member_count);
  END IF;
  IF COALESCE(c.discussion_chat_id, 0) <> 0 THEN
    fullc := fullc || jsonb_build_object('linked_chat_id', c.discussion_chat_id);
  END IF;
  IF COALESCE(c.slowmode_seconds, 0) <> 0 THEN
    fullc := fullc || jsonb_build_object('slowmode_seconds', c.slowmode_seconds);
  END IF;
  IF COALESCE(c.auto_delete_period, 0) <> 0 THEN
    fullc := fullc || jsonb_build_object('ttl_period', c.auto_delete_period);
  END IF;
  IF COALESCE(c.charge_stars, 0) <> 0 THEN
    fullc := fullc || jsonb_build_object('send_paid_messages_stars', c.charge_stars);
  END IF;

  RETURN jsonb_build_object('peer_id', p->'peer_id', 'chat_full',
           jsonb_build_object('_', 'messages.chatFull', 'full_chat', fullc,
                              'chats', jsonb_build_array(chat), 'users', '[]'::jsonb));
END;
$$ LANGUAGE plpgsql STABLE;
-- +goose StatementEnd

UPDATE updates SET payload = tl_fwd_from(payload)
 WHERE payload ? 'fwd_from_user_id' OR payload ? 'fwd_from_peer_id'
    OR payload ? 'fwd_from_msg_id' OR payload ? 'fwd_date' OR payload ? 'fwd_from_name';
UPDATE channel_updates SET payload = tl_fwd_from(payload)
 WHERE payload ? 'fwd_from_user_id' OR payload ? 'fwd_from_peer_id'
    OR payload ? 'fwd_from_msg_id' OR payload ? 'fwd_date' OR payload ? 'fwd_from_name';

UPDATE updates SET payload = tl_reply_peer(payload)
 WHERE jsonb_typeof(payload->'reply_to_peer_id') = 'number';
UPDATE channel_updates SET payload = tl_reply_peer(payload)
 WHERE jsonb_typeof(payload->'reply_to_peer_id') = 'number';

-- +goose StatementBegin
-- tl_reaction_recent — «последние реагировавшие» в чипе реакции. Была
-- мини-карточка {id, name, avatar} — то есть ТРЕТЬЯ форма пользователя,
-- вклеенная прямо в jsonb; стала ссылка на пир, а имя с фото клиент берёт из
-- своего кэша (как recent_reactions:Vector<MessagePeerReaction> в схеме).
CREATE FUNCTION tl_reaction_recent(p jsonb) RETURNS jsonb AS $$
  SELECT jsonb_set(p, '{counts}', COALESCE((
    SELECT jsonb_agg(
      CASE WHEN jsonb_typeof(c->'recent') = 'array'
           THEN jsonb_set(c, '{recent}', COALESCE((
                  SELECT jsonb_agg(jsonb_build_object('_', 'peerUser', 'user_id', (e->>'id')::bigint) ORDER BY ord)
                    FROM jsonb_array_elements(c->'recent') WITH ORDINALITY AS t(e, ord)
                   WHERE jsonb_typeof(e) = 'object'), '[]'::jsonb))
           ELSE c END ORDER BY ord)
      FROM jsonb_array_elements(p->'counts') WITH ORDINALITY AS q(c, ord)), '[]'::jsonb));
$$ LANGUAGE sql IMMUTABLE;
-- +goose StatementEnd

UPDATE updates SET payload = tl_reaction_recent(payload)
 WHERE type = 'reaction' AND jsonb_typeof(payload->'counts') = 'array';

UPDATE updates SET payload = tl_user_update(payload) WHERE type = 'user_update';
UPDATE updates SET payload = tl_chat_update(payload) WHERE type = 'chat_update';
UPDATE channel_updates SET payload = tl_chat_update(payload) WHERE type = 'chat_update';

DROP FUNCTION tl_reaction_recent(jsonb);
DROP FUNCTION tl_chat_update(jsonb);
DROP FUNCTION tl_user_update(jsonb);
DROP FUNCTION tl_reply_peer(jsonb);
DROP FUNCTION tl_fwd_from(jsonb);
DROP FUNCTION tl_media_id(text);

-- +goose Down
-- Обратный перевод. Кадры журналов восстанавливаются в плоскую форму из тех же
-- источников: ссылка на пир снова становится числом, конструкторы — выборкой
-- полей. Что при накате потеряло предмет (внутренний ключ приватного чата в
-- reply_to_peer_id), назад не воскресает: восстанавливать нечего, и это
-- единственная невосстановимая часть — ровно та, которая была дефектом.

-- +goose StatementBegin
CREATE FUNCTION flat_media_url(id bigint) RETURNS text AS $$
  SELECT CASE WHEN id IS NULL THEN NULL ELSE '/media/' || id || '/content' END;
$$ LANGUAGE sql IMMUTABLE;
-- +goose StatementEnd

ALTER TABLE users ADD COLUMN phone_visibility TEXT NOT NULL DEFAULT 'contacts';
UPDATE users u SET phone_visibility = r.value
  FROM privacy_rules r WHERE r.user_id = u.id AND r.key = 'phone_number';

ALTER TABLE contact_custom_photo ADD COLUMN url TEXT;
UPDATE contact_custom_photo SET url = flat_media_url(media_id);
ALTER TABLE contact_custom_photo ALTER COLUMN url SET NOT NULL;
ALTER TABLE contact_custom_photo DROP COLUMN media_id;

ALTER TABLE profile_photos ADD COLUMN url TEXT;
ALTER TABLE profile_photos ADD COLUMN video_url TEXT;
UPDATE profile_photos SET url = flat_media_url(media_id), video_url = flat_media_url(video_media_id);
ALTER TABLE profile_photos ALTER COLUMN url SET NOT NULL;
ALTER TABLE profile_photos DROP COLUMN media_id;
ALTER TABLE profile_photos DROP COLUMN video_media_id;

ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT '';
UPDATE users SET avatar_url = COALESCE(flat_media_url(avatar_media_id), '');
ALTER TABLE users DROP COLUMN avatar_media_id;

-- +goose StatementBegin
CREATE FUNCTION flat_fwd_from(p jsonb) RETURNS jsonb AS $$
DECLARE
  hdr jsonb := p->'fwd_from';
  from_id jsonb;
  saved jsonb;
  out_ jsonb;
BEGIN
  IF hdr IS NULL OR jsonb_typeof(hdr) <> 'object' THEN
    RETURN p;
  END IF;
  out_ := p - 'fwd_from';
  IF (hdr->>'date') IS NOT NULL AND (hdr->>'date')::bigint <> 0 THEN
    out_ := out_ || jsonb_build_object('fwd_date',
              to_char(to_timestamp((hdr->>'date')::bigint) AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  END IF;
  IF (hdr->>'from_name') IS NOT NULL THEN
    out_ := out_ || jsonb_build_object('fwd_from_name', hdr->>'from_name');
    RETURN out_;
  END IF;
  from_id := hdr->'from_id';
  IF jsonb_typeof(from_id) = 'object' THEN
    IF from_id->>'_' = 'peerUser' THEN
      out_ := out_ || jsonb_build_object('fwd_from_user_id', (from_id->>'user_id')::bigint);
    ELSE
      out_ := out_ || jsonb_build_object('fwd_from_peer_id', -((from_id->>'channel_id')::bigint));
    END IF;
  END IF;
  saved := hdr->'saved_from_peer';
  IF jsonb_typeof(saved) = 'object' THEN
    out_ := out_ || jsonb_build_object('fwd_from_peer_id', -((saved->>'channel_id')::bigint));
  END IF;
  IF (hdr->>'saved_from_msg_id') IS NOT NULL THEN
    out_ := out_ || jsonb_build_object('fwd_from_msg_id', (hdr->>'saved_from_msg_id')::bigint);
  ELSIF (hdr->>'channel_post') IS NOT NULL THEN
    out_ := out_ || jsonb_build_object('fwd_from_msg_id', (hdr->>'channel_post')::bigint);
  END IF;
  RETURN out_;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION flat_reply_peer(p jsonb) RETURNS jsonb AS $$
DECLARE
  peer jsonb := p->'reply_to_peer_id';
BEGIN
  IF jsonb_typeof(peer) <> 'object' THEN
    RETURN p;
  END IF;
  IF peer->>'_' = 'peerUser' THEN
    RETURN jsonb_set(p, '{reply_to_peer_id}', to_jsonb((peer->>'user_id')::bigint));
  END IF;
  RETURN jsonb_set(p, '{reply_to_peer_id}', to_jsonb(-((peer->>'channel_id')::bigint)));
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION flat_user_update(p jsonb) RETURNS jsonb AS $$
BEGIN
  IF p->>'_' <> 'user' THEN
    RETURN p;
  END IF;
  RETURN jsonb_build_object(
    'id', (p->>'id')::bigint,
    'username', COALESCE(p->>'username', ''),
    'display_name', btrim(COALESCE(p->>'first_name', '') || ' ' || COALESCE(p->>'last_name', '')),
    'avatar_changed', false);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION flat_chat_update(p jsonb) RETURNS jsonb AS $$
DECLARE
  cf   jsonb := p->'chat_full';
  chat jsonb;
  fullc jsonb;
  cid  bigint;
  c    record;
BEGIN
  IF jsonb_typeof(cf) <> 'object' THEN
    RETURN p;
  END IF;
  chat := cf->'chats'->0;
  fullc := cf->'full_chat';
  cid := (chat->>'id')::bigint;
  SELECT type, default_permissions, slowmode_seconds, reactions_mode,
         reactions_allowed, history_for_new, charge_stars, is_public, photo_media_id
    INTO c FROM chats WHERE id = cid;
  RETURN jsonb_build_object(
    'peer_id', p->'peer_id',
    'type', COALESCE(c.type, 'group'),
    'title', COALESCE(chat->>'title', ''),
    'about', COALESCE(fullc->>'about', ''),
    'username', COALESCE(chat->>'username', ''),
    'is_public', COALESCE(c.is_public, false),
    'member_count', COALESCE((chat->>'participants_count')::int, 0),
    'photo_media_id', to_jsonb(c.photo_media_id),
    'settings', jsonb_build_object(
      'default_perms', COALESCE(c.default_permissions, 31),
      'slowmode_seconds', COALESCE(c.slowmode_seconds, 0),
      'reactions_mode', COALESCE(c.reactions_mode, 'all'),
      'reactions_allowed', COALESCE(c.reactions_allowed, '[]'::jsonb),
      'history_for_new', COALESCE(c.history_for_new, true),
      'charge_stars', COALESCE(c.charge_stars, 0)));
END;
$$ LANGUAGE plpgsql STABLE;
-- +goose StatementEnd

-- +goose StatementBegin
-- Обратно: ссылка на пир → мини-карточка. Имя и аватарку добираем из users —
-- в кадре их нет, а замороженный снимок и так был копией строки таблицы.
CREATE FUNCTION flat_reaction_recent(p jsonb) RETURNS jsonb AS $$
  SELECT jsonb_set(p, '{counts}', COALESCE((
    SELECT jsonb_agg(
      CASE WHEN jsonb_typeof(c->'recent') = 'array'
           THEN jsonb_set(c, '{recent}', COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                           'id', u.id, 'name', u.display_name,
                           'avatar', COALESCE(u.avatar_url, '')) ORDER BY ord)
                    FROM jsonb_array_elements(c->'recent') WITH ORDINALITY AS t(e, ord)
                    JOIN users u ON u.id = (e->>'user_id')::bigint), '[]'::jsonb))
           ELSE c END ORDER BY ord)
      FROM jsonb_array_elements(p->'counts') WITH ORDINALITY AS q(c, ord)), '[]'::jsonb));
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

UPDATE updates SET payload = flat_reaction_recent(payload)
 WHERE type = 'reaction' AND jsonb_typeof(payload->'counts') = 'array';

UPDATE updates SET payload = flat_chat_update(payload) WHERE type = 'chat_update';
UPDATE channel_updates SET payload = flat_chat_update(payload) WHERE type = 'chat_update';
UPDATE updates SET payload = flat_user_update(payload) WHERE type = 'user_update';

UPDATE updates SET payload = flat_reply_peer(payload)
 WHERE jsonb_typeof(payload->'reply_to_peer_id') = 'object';
UPDATE channel_updates SET payload = flat_reply_peer(payload)
 WHERE jsonb_typeof(payload->'reply_to_peer_id') = 'object';

UPDATE updates SET payload = flat_fwd_from(payload) WHERE payload ? 'fwd_from';
UPDATE channel_updates SET payload = flat_fwd_from(payload) WHERE payload ? 'fwd_from';

DROP FUNCTION flat_reaction_recent(jsonb);
DROP FUNCTION flat_chat_update(jsonb);
DROP FUNCTION flat_user_update(jsonb);
DROP FUNCTION flat_reply_peer(jsonb);
DROP FUNCTION flat_fwd_from(jsonb);
DROP FUNCTION flat_media_url(bigint);
