-- +goose Up
-- Адресация СООБЩЕНИЯ сводится к паре «пир + номер в чате» (решение Р1 разбора,
-- docs/readiness/tl-message-analysis.md). В схеме идентификатор сообщения один —
-- message.id, и он по-пирный; наш `seq` (счётчик chats.last_seq) является ровно
-- им: плотный, уникальный в пределах чата, от зрителя не зависит.
--
-- Что НЕ меняется: `messages.id BIGSERIAL PRIMARY KEY` остаётся и остаётся
-- ВНУТРЕННИМ — ровно как строка `chats` приватного диалога после порта пиров.
-- Внешние ключи на него (message_reactions.msg_id, message_mentions.msg_id,
-- pinned_messages.msg_id, message_hides.msg_id) не трогаются: переводить
-- целостность на (chat_id, seq) значило бы переделывать её ради косметики.
--
-- Здесь меняются ТРИ вещи:
--   1) колонки, которые ХРАНЯТ адрес чужого сообщения (reply_to_id у messages,
--      drafts, scheduled_messages) — они уезжают на провод как есть;
--   2) grouped_id: наша строка против `long` схемы (долг, найденный шагом A);
--   3) ЗАМОРОЖЕННЫЕ кадры журналов updates/channel_updates — клиент
--      переигрывает их при /sync и channels.getDifference, поэтому старая
--      запись, оставленная как есть, дала бы вторую форму на проводе: ровно тот
--      второй источник истины, ради устранения которого делается переход.
--
-- Функции-переводчики временные: созданы, применены и удалены в одной
-- транзакции миграции — постоянного переходника в базе не остаётся.

-- +goose StatementBegin
-- tl_msg_seq — ключ строки во внешний номер. SQL-двойник
-- MessageRepo.SeqsByIDs (usecase/chat/msgaddr.go). NULL — строки нет вовсе
-- (чат удалён каскадом): у такого кадра адреса не существует, и подставлять
-- вместо него ноль нельзя — ноль в этом пространстве значит «самое новое».
CREATE FUNCTION tl_msg_seq(msg bigint) RETURNS bigint AS $$
  SELECT seq FROM messages WHERE id = msg;
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_grouped — ключ медиагруппы из нашей строки (`g<base36-время><random>`,
-- генерирует клиент) в схемный long. Детерминированный: одинаковая строка даёт
-- одно и то же число, поэтому альбомы остаются собранными. 60 бит от md5 —
-- всегда положительное значение, коллизия практически невозможна, а между
-- РАЗНЫМИ чатами она и не имеет значения (альбом ищется в пределах chat_id).
CREATE FUNCTION tl_grouped(g text) RETURNS bigint AS $$
  SELECT CASE WHEN g IS NULL THEN NULL
              ELSE ('x' || substr(md5(g), 1, 15))::bit(60)::bigint END;
$$ LANGUAGE sql IMMUTABLE;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_pin_action — служебное сообщение о закреплении несёт JSON-экшен прямо в
-- тексте, и в нём была ПАРА чисел на одну цель: msg_id (ключ строки) и msg_seq
-- (номер). Остаётся одно — msg_id со значением номера, как reply_to_msg_id в
-- схеме. Не-JSON тексты (создание темы форума — готовая фраза) возвращаются
-- нетронутыми.
CREATE FUNCTION tl_pin_action(t text) RETURNS text AS $$
DECLARE j jsonb;
BEGIN
  BEGIN
    j := t::jsonb;
  EXCEPTION WHEN others THEN
    RETURN t;
  END;
  IF j IS NULL OR jsonb_typeof(j) <> 'object' OR NOT (j ? 'msg_seq') THEN
    RETURN t;
  END IF;
  RETURN ((j - 'msg_seq') || jsonb_build_object('msg_id', j->'msg_seq'))::text;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- +goose StatementEnd

-- ── 1. reply_to_id: ключ строки → номер ─────────────────────────────────────
-- В схеме reply_to_msg_id осмыслен ТОЛЬКО вместе с reply_to_peer_id, отсутствие
-- которого значит «тот же пир». Поэтому сначала достраиваем пир там, где ответ
-- фактически кросс-чатный, а колонка не заполнена (такие строки остались от
-- версий до появления reply_to_peer_id): без пира номер после перевода указывал
-- бы на ЧУЖОЕ сообщение с тем же номером в своём чате.
UPDATE messages m
   SET reply_to_peer_id = o.chat_id
  FROM messages o
 WHERE m.reply_to_id = o.id
   AND m.reply_to_peer_id IS NULL
   AND o.chat_id <> m.chat_id;

-- Висячие ссылки (оригинала в базе нет вовсе) — NULL: номера у него не
-- существует. Поведение то же, что и было: превью такого ответа не строилось.
UPDATE messages
   SET reply_to_id = NULL, reply_to_peer_id = NULL
 WHERE reply_to_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM messages o WHERE o.id = messages.reply_to_id);

UPDATE messages m
   SET reply_to_id = o.seq
  FROM messages o
 WHERE m.reply_to_id = o.id;

-- Черновик отвечает только в СВОЁМ чате (в схеме у draftMessage
-- reply_to_peer_id нет вовсе), поэтому перевод ограничен тем же чатом.
UPDATE drafts d
   SET reply_to_id = o.seq
  FROM messages o
 WHERE d.reply_to_id = o.id AND o.chat_id = d.chat_id;
UPDATE drafts
   SET reply_to_id = NULL
 WHERE reply_to_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM messages o
                    WHERE o.chat_id = drafts.chat_id AND o.seq = drafts.reply_to_id);

-- Отложенное сообщение живёт в СВОЁМ пространстве id (seq назначается при
-- отправке), но его reply_to_id — адрес обычного сообщения и уезжает на провод.
-- Пира у отложенного нет, поэтому кросс-чатный ответ здесь неадресуем: NULL.
UPDATE scheduled_messages s
   SET reply_to_id = o.seq
  FROM messages o
 WHERE s.reply_to_id = o.id AND o.chat_id = s.chat_id;
UPDATE scheduled_messages
   SET reply_to_id = NULL
 WHERE reply_to_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM messages o
                    WHERE o.chat_id = scheduled_messages.chat_id
                      AND o.seq = scheduled_messages.reply_to_id);

-- Индекс по одному reply_to_id (0085) после перевода бессмысленен: номер
-- уникален лишь в пределах чата. Пересобираем парой (chat_id, reply_to_id).
DROP INDEX IF EXISTS idx_messages_reply_to_id;
CREATE INDEX idx_messages_reply_to ON messages (chat_id, reply_to_id) WHERE reply_to_id IS NOT NULL;

-- ── 2. grouped_id: строка → long ────────────────────────────────────────────
ALTER TABLE messages
  ALTER COLUMN grouped_id TYPE BIGINT USING tl_grouped(grouped_id);

-- ── 3. Служебный текст закрепления: два числа на цель → одно ────────────────
UPDATE messages
   SET text = tl_pin_action(text)
 WHERE type = 'service' AND text LIKE '{%' AND text LIKE '%msg_seq%';

-- ── 4. Замороженные кадры журналов ──────────────────────────────────────────
-- Идентичность сообщения в кадре: было {msg_id: ключ строки, seq: номер} (а у
-- reaction/star_reaction/media_read/pin_message — ОДИН msg_id, без номера),
-- стало {id: номер}. Имя ключа взято из схемы, где идентификатор сообщения
-- называется id. Проход идёт ПО НАЛИЧИЮ ключа msg_id, а не перечислением типов
-- кадров: перечисление устарело бы при первом же новом кадре (урок 0102).
--
-- Номер берём из самого кадра, если он там был, иначе резолвим по ключу строки.
-- Если не резолвится (чат удалён каскадом) — кадр остаётся БЕЗ адреса вовсе:
-- клиент такой кадр пропустит, а подставленный ноль отправил бы его к «самому
-- новому» сообщению.
UPDATE updates
   SET payload = (payload - 'msg_id' - 'seq')
                 || CASE WHEN COALESCE((payload->>'seq')::bigint,
                                       tl_msg_seq((payload->>'msg_id')::bigint)) IS NULL
                         THEN '{}'::jsonb
                         ELSE jsonb_build_object('id',
                                COALESCE((payload->>'seq')::bigint,
                                         tl_msg_seq((payload->>'msg_id')::bigint)))
                    END
 WHERE jsonb_typeof(payload->'msg_id') = 'number';

UPDATE channel_updates
   SET payload = (payload - 'msg_id' - 'seq')
                 || CASE WHEN COALESCE((payload->>'seq')::bigint,
                                       tl_msg_seq((payload->>'msg_id')::bigint)) IS NULL
                         THEN '{}'::jsonb
                         ELSE jsonb_build_object('id',
                                COALESCE((payload->>'seq')::bigint,
                                         tl_msg_seq((payload->>'msg_id')::bigint)))
                    END
 WHERE jsonb_typeof(payload->'msg_id') = 'number';

-- Ссылки на ДРУГИЕ сообщения внутри кадра — те же три, что и в колонках.
-- reply_to_id: номер отвечаемого; не резолвится — ключ уходит совсем.
UPDATE updates
   SET payload = (payload - 'reply_to_id')
                 || CASE WHEN tl_msg_seq((payload->>'reply_to_id')::bigint) IS NULL THEN '{}'::jsonb
                         ELSE jsonb_build_object('reply_to_id', tl_msg_seq((payload->>'reply_to_id')::bigint)) END
 WHERE jsonb_typeof(payload->'reply_to_id') = 'number';
UPDATE channel_updates
   SET payload = (payload - 'reply_to_id')
                 || CASE WHEN tl_msg_seq((payload->>'reply_to_id')::bigint) IS NULL THEN '{}'::jsonb
                         ELSE jsonb_build_object('reply_to_id', tl_msg_seq((payload->>'reply_to_id')::bigint)) END
 WHERE jsonb_typeof(payload->'reply_to_id') = 'number';

-- thread_root_id: корень треда (id поста канала либо id зеркала — на записи
-- кадра встречались оба, см. externalThreadRoot) переводится в номер той же
-- функцией: она не различает, в каком чате лежит строка.
UPDATE updates
   SET payload = (payload - 'thread_root_id')
                 || CASE WHEN tl_msg_seq((payload->>'thread_root_id')::bigint) IS NULL THEN '{}'::jsonb
                         ELSE jsonb_build_object('thread_root_id', tl_msg_seq((payload->>'thread_root_id')::bigint)) END
 WHERE jsonb_typeof(payload->'thread_root_id') = 'number';
UPDATE channel_updates
   SET payload = (payload - 'thread_root_id')
                 || CASE WHEN tl_msg_seq((payload->>'thread_root_id')::bigint) IS NULL THEN '{}'::jsonb
                         ELSE jsonb_build_object('thread_root_id', tl_msg_seq((payload->>'thread_root_id')::bigint)) END
 WHERE jsonb_typeof(payload->'thread_root_id') = 'number';

-- grouped_id в кадре — той же функцией, что и колонка: иначе один альбом
-- приехал бы из истории числом, а из реплея строкой.
UPDATE updates
   SET payload = jsonb_set(payload, '{grouped_id}', to_jsonb(tl_grouped(payload->>'grouped_id')))
 WHERE jsonb_typeof(payload->'grouped_id') = 'string';
UPDATE channel_updates
   SET payload = jsonb_set(payload, '{grouped_id}', to_jsonb(tl_grouped(payload->>'grouped_id')))
 WHERE jsonb_typeof(payload->'grouped_id') = 'string';

-- Текст служебного сообщения о закреплении внутри кадра new_message.
UPDATE updates
   SET payload = jsonb_set(payload, '{text}', to_jsonb(tl_pin_action(payload->>'text')))
 WHERE jsonb_typeof(payload->'text') = 'string' AND payload->>'text' LIKE '{%msg_seq%';

DROP FUNCTION tl_pin_action(text);
DROP FUNCTION tl_grouped(text);
DROP FUNCTION tl_msg_seq(bigint);

-- +goose Down
-- Обратный перевод. Номер однозначно возвращается в ключ строки: пара
-- (chat_id, seq) уникальна с миграции 0002.
--
-- ⚠ grouped_id обратно становится TEXT, но НЕ исходной строкой клиента: та не
-- восстановима из хэша. Возвращается десятичная запись числа — тип и, главное,
-- ГРУППИРОВКА (у элементов одного альбома значение общее) сохраняются, а
-- побайтовое совпадение с прежним `g<base36>` — нет. Названо здесь, а не
-- скрыто: откат этой миграции безопасен для показа альбомов и небезопасен для
-- сравнения grouped_id со значением, сохранённым клиентом до наката.

-- +goose StatementBegin
-- tl_msg_id — номер обратно в ключ строки (в контексте известного чата).
CREATE FUNCTION tl_msg_id(chat bigint, s bigint) RETURNS bigint AS $$
  SELECT id FROM messages WHERE chat_id = chat AND seq = s;
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION tl_unpin_action(t text) RETURNS text AS $$
DECLARE j jsonb;
BEGIN
  BEGIN
    j := t::jsonb;
  EXCEPTION WHEN others THEN
    RETURN t;
  END;
  IF j IS NULL OR jsonb_typeof(j) <> 'object'
     OR j->>'action' <> 'pin_message' OR NOT (j ? 'msg_id') THEN
    RETURN t;
  END IF;
  RETURN (j || jsonb_build_object('msg_seq', j->'msg_id'))::text;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- +goose StatementEnd

UPDATE updates
   SET payload = jsonb_set(payload, '{text}', to_jsonb(tl_unpin_action(payload->>'text')))
 WHERE jsonb_typeof(payload->'text') = 'string' AND payload->>'text' LIKE '{%pin_message%';

UPDATE messages
   SET text = tl_unpin_action(text)
 WHERE type = 'service' AND text LIKE '{%pin_message%';

UPDATE updates
   SET payload = jsonb_set(payload, '{grouped_id}', to_jsonb(payload->>'grouped_id'))
 WHERE jsonb_typeof(payload->'grouped_id') = 'number';
UPDATE channel_updates
   SET payload = jsonb_set(payload, '{grouped_id}', to_jsonb(payload->>'grouped_id'))
 WHERE jsonb_typeof(payload->'grouped_id') = 'number';

-- Кадры персонального журнала: чат кадра известен по peer_id глазами user_id
-- (шаг B пиров), но для обратного перевода достаточно самого сообщения —
-- номер + чат берём из строки messages по (chat_id, seq) через peer.
-- Чтобы не воспроизводить здесь разрешение пира, ключ строки ищем по номеру
-- среди сообщений тех чатов, где состоит владелец журнала.
-- +goose StatementBegin
CREATE FUNCTION tl_msg_id_for_user(viewer bigint, s bigint) RETURNS bigint AS $$
  SELECT m.id FROM messages m
    JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = viewer
   WHERE m.seq = s
   ORDER BY m.id DESC LIMIT 1;
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

UPDATE updates
   SET payload = (payload - 'id')
                 || jsonb_build_object('seq', (payload->>'id')::bigint)
                 || CASE WHEN tl_msg_id_for_user(user_id, (payload->>'id')::bigint) IS NULL THEN '{}'::jsonb
                         ELSE jsonb_build_object('msg_id', tl_msg_id_for_user(user_id, (payload->>'id')::bigint)) END
 WHERE jsonb_typeof(payload->'id') = 'number';

UPDATE channel_updates
   SET payload = (payload - 'id')
                 || jsonb_build_object('seq', (payload->>'id')::bigint)
                 || CASE WHEN tl_msg_id(channel_id, (payload->>'id')::bigint) IS NULL THEN '{}'::jsonb
                         ELSE jsonb_build_object('msg_id', tl_msg_id(channel_id, (payload->>'id')::bigint)) END
 WHERE jsonb_typeof(payload->'id') = 'number';

UPDATE updates
   SET payload = jsonb_set(payload, '{reply_to_id}',
                   COALESCE(to_jsonb(tl_msg_id_for_user(user_id, (payload->>'reply_to_id')::bigint)), 'null'::jsonb))
 WHERE jsonb_typeof(payload->'reply_to_id') = 'number';
UPDATE updates
   SET payload = jsonb_set(payload, '{thread_root_id}',
                   COALESCE(to_jsonb(tl_msg_id_for_user(user_id, (payload->>'thread_root_id')::bigint)), 'null'::jsonb))
 WHERE jsonb_typeof(payload->'thread_root_id') = 'number';

ALTER TABLE messages
  ALTER COLUMN grouped_id TYPE TEXT USING grouped_id::text;

UPDATE scheduled_messages s
   SET reply_to_id = tl_msg_id(s.chat_id, s.reply_to_id)
 WHERE s.reply_to_id IS NOT NULL;
UPDATE drafts d
   SET reply_to_id = tl_msg_id(d.chat_id, d.reply_to_id)
 WHERE d.reply_to_id IS NOT NULL;
UPDATE messages m
   SET reply_to_id = tl_msg_id(COALESCE(m.reply_to_peer_id, m.chat_id), m.reply_to_id)
 WHERE m.reply_to_id IS NOT NULL;

DROP INDEX IF EXISTS idx_messages_reply_to;
CREATE INDEX idx_messages_reply_to_id ON messages (reply_to_id) WHERE reply_to_id IS NOT NULL;

DROP FUNCTION tl_msg_id_for_user(bigint, bigint);
DROP FUNCTION tl_unpin_action(text);
DROP FUNCTION tl_msg_id(bigint, bigint);
