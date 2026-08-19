-- +goose Up
-- Разметка сообщений переезжает в форму оригинала: вместо плоской записи
-- {"type":"bold","offset":0,"length":4} — конструктор схемы TL
-- {"_":"messageEntityBold","offset":0,"length":4} (см. domain/mtentity.go,
-- docs/readiness/tl-program.md).
--
-- Строки переписываются ЗДЕСЬ, а не переводятся переходником на чтении:
-- постоянный переходник и есть тот второй источник истины, ради устранения
-- которого делается переход. После этой миграции читающий код знает ровно одну
-- форму.
--
-- Колонки с разметкой (все jsonb-массивы MessageEntity):
--   messages.entities, drafts.entities, scheduled_messages.entities,
--   suggested_posts.entities, вложенно messages.factcheck->'entities'
--   и замороженные кадры журналов апдейтов: updates.payload,
--   channel_updates.payload (сами и их ->'factcheck').
--
-- Функции-переводчики временные: созданы, применены и удалены в той же
-- транзакции миграции — постоянного переходника в базе не остаётся.

-- +goose StatementBegin
CREATE FUNCTION tl_message_entity(e jsonb) RETURNS jsonb AS $$
DECLARE
  span jsonb := jsonb_build_object(
    'offset', COALESCE((e->>'offset')::int, 0),
    'length', COALESCE((e->>'length')::int, 0));
BEGIN
  -- Дискриминатор уже есть — сущность в новой форме, не трогаем (миграция
  -- идемпотентна и безопасна к повторному прогону).
  IF e ? '_' THEN
    RETURN e;
  END IF;

  RETURN CASE e->>'type'
    WHEN 'bold'          THEN jsonb_build_object('_', 'messageEntityBold') || span
    WHEN 'italic'        THEN jsonb_build_object('_', 'messageEntityItalic') || span
    WHEN 'underline'     THEN jsonb_build_object('_', 'messageEntityUnderline') || span
    WHEN 'strikethrough' THEN jsonb_build_object('_', 'messageEntityStrike') || span
    WHEN 'code'          THEN jsonb_build_object('_', 'messageEntityCode') || span
    WHEN 'spoiler'       THEN jsonb_build_object('_', 'messageEntitySpoiler') || span
    -- blockquote: pFlags.collapsed в старой форме не было вовсе, поэтому
    -- под-объект не создаём — «выключено» это отсутствие ключа.
    WHEN 'blockquote'    THEN jsonb_build_object('_', 'messageEntityBlockquote') || span
    -- pre.language в схеме ОБЯЗАТЕЛЕН: у блока без подсказки языка едет пустая
    -- строка, а не отсутствие ключа.
    WHEN 'pre'           THEN jsonb_build_object('_', 'messageEntityPre',
                                'language', COALESCE(e->>'language', '')) || span
    WHEN 'text_link'     THEN jsonb_build_object('_', 'messageEntityTextUrl',
                                'url', COALESCE(e->>'url', '')) || span
    WHEN 'text_mention'  THEN jsonb_build_object('_', 'messageEntityMentionName',
                                'user_id', COALESCE((e->>'user_id')::bigint, 0)) || span
    WHEN 'custom_emoji'  THEN jsonb_build_object('_', 'messageEntityCustomEmoji',
                                'document_id', COALESCE((e->>'document_id')::bigint, 0)) || span
    -- Тип вне нашего объединения (в БД таких быть не должно — санитайзер
    -- пропускал только перечисленные). NULL = сущность выбрасывается, потому
    -- что перевести её не во что.
    ELSE NULL
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION tl_message_entities(es jsonb) RETURNS jsonb AS $$
  SELECT CASE
    WHEN es IS NULL OR jsonb_typeof(es) <> 'array' THEN es
    ELSE COALESCE(
      (SELECT jsonb_agg(c.v ORDER BY c.ord)
         FROM (SELECT tl_message_entity(e) AS v, ord
                 FROM jsonb_array_elements(es) WITH ORDINALITY AS t(e, ord)) c
        WHERE c.v IS NOT NULL),
      '[]'::jsonb)
  END;
$$ LANGUAGE sql IMMUTABLE;
-- +goose StatementEnd

UPDATE messages SET entities = tl_message_entities(entities) WHERE entities IS NOT NULL;
UPDATE drafts SET entities = tl_message_entities(entities) WHERE entities IS NOT NULL;
UPDATE scheduled_messages SET entities = tl_message_entities(entities) WHERE entities IS NOT NULL;
UPDATE suggested_posts SET entities = tl_message_entities(entities) WHERE entities IS NOT NULL;

UPDATE messages
   SET factcheck = jsonb_set(factcheck, '{entities}', tl_message_entities(factcheck->'entities'))
 WHERE factcheck IS NOT NULL
   AND jsonb_typeof(factcheck->'entities') = 'array';

-- Журналы апдейтов (updates, channel_updates) хранят ЗАМОРОЖЕННЫЕ кадры
-- new_message/edit_message/factcheck_update/draft_update — их клиент
-- переигрывает при /sync и difference. Не переписать их — значит отдать
-- догоняющему клиенту разметку в старой форме, которую он уже не понимает:
-- эти несколько сообщений приедут голым текстом. Записи короткоживущие (их
-- подрезает PruneUpdates), но «короткоживущие» не значит «пустые» в момент
-- наката.
--
-- bot_updates не трогаем сознательно: это очередь публичного Bot API, у него
-- свой плоский контракт (см. botapi_handler.go), да и разметки в тех кадрах нет.
UPDATE updates
   SET payload = jsonb_set(payload, '{entities}', tl_message_entities(payload->'entities'))
 WHERE jsonb_typeof(payload->'entities') = 'array';
UPDATE updates
   SET payload = jsonb_set(payload, '{factcheck,entities}', tl_message_entities(payload->'factcheck'->'entities'))
 WHERE jsonb_typeof(payload->'factcheck'->'entities') = 'array';

UPDATE channel_updates
   SET payload = jsonb_set(payload, '{entities}', tl_message_entities(payload->'entities'))
 WHERE jsonb_typeof(payload->'entities') = 'array';
UPDATE channel_updates
   SET payload = jsonb_set(payload, '{factcheck,entities}', tl_message_entities(payload->'factcheck'->'entities'))
 WHERE jsonb_typeof(payload->'factcheck'->'entities') = 'array';

DROP FUNCTION tl_message_entities(jsonb);
DROP FUNCTION tl_message_entity(jsonb);

-- +goose Down
-- Обратный перевод в плоскую форму. Потери: pFlags.collapsed у цитаты (в старой
-- форме такого поля не было) и пустой pre.language (в старой форме он опускался).

-- +goose StatementBegin
CREATE FUNCTION flat_message_entity(e jsonb) RETURNS jsonb AS $$
DECLARE
  span jsonb := jsonb_build_object(
    'offset', COALESCE((e->>'offset')::int, 0),
    'length', COALESCE((e->>'length')::int, 0));
BEGIN
  IF NOT e ? '_' THEN
    RETURN e;
  END IF;

  RETURN CASE e->>'_'
    WHEN 'messageEntityBold'        THEN jsonb_build_object('type', 'bold') || span
    WHEN 'messageEntityItalic'      THEN jsonb_build_object('type', 'italic') || span
    WHEN 'messageEntityUnderline'   THEN jsonb_build_object('type', 'underline') || span
    WHEN 'messageEntityStrike'      THEN jsonb_build_object('type', 'strikethrough') || span
    WHEN 'messageEntityCode'        THEN jsonb_build_object('type', 'code') || span
    WHEN 'messageEntitySpoiler'     THEN jsonb_build_object('type', 'spoiler') || span
    WHEN 'messageEntityBlockquote'  THEN jsonb_build_object('type', 'blockquote') || span
    WHEN 'messageEntityPre'         THEN jsonb_strip_nulls(jsonb_build_object('type', 'pre',
                                          'language', NULLIF(e->>'language', ''))) || span
    WHEN 'messageEntityTextUrl'     THEN jsonb_build_object('type', 'text_link',
                                          'url', COALESCE(e->>'url', '')) || span
    WHEN 'messageEntityMentionName' THEN jsonb_build_object('type', 'text_mention',
                                          'user_id', COALESCE((e->>'user_id')::bigint, 0)) || span
    WHEN 'messageEntityCustomEmoji' THEN jsonb_build_object('type', 'custom_emoji',
                                          'document_id', COALESCE((e->>'document_id')::bigint, 0)) || span
    ELSE NULL
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION flat_message_entities(es jsonb) RETURNS jsonb AS $$
  SELECT CASE
    WHEN es IS NULL OR jsonb_typeof(es) <> 'array' THEN es
    ELSE COALESCE(
      (SELECT jsonb_agg(c.v ORDER BY c.ord)
         FROM (SELECT flat_message_entity(e) AS v, ord
                 FROM jsonb_array_elements(es) WITH ORDINALITY AS t(e, ord)) c
        WHERE c.v IS NOT NULL),
      '[]'::jsonb)
  END;
$$ LANGUAGE sql IMMUTABLE;
-- +goose StatementEnd

UPDATE messages SET entities = flat_message_entities(entities) WHERE entities IS NOT NULL;
UPDATE drafts SET entities = flat_message_entities(entities) WHERE entities IS NOT NULL;
UPDATE scheduled_messages SET entities = flat_message_entities(entities) WHERE entities IS NOT NULL;
UPDATE suggested_posts SET entities = flat_message_entities(entities) WHERE entities IS NOT NULL;

UPDATE messages
   SET factcheck = jsonb_set(factcheck, '{entities}', flat_message_entities(factcheck->'entities'))
 WHERE factcheck IS NOT NULL
   AND jsonb_typeof(factcheck->'entities') = 'array';

UPDATE updates
   SET payload = jsonb_set(payload, '{entities}', flat_message_entities(payload->'entities'))
 WHERE jsonb_typeof(payload->'entities') = 'array';
UPDATE updates
   SET payload = jsonb_set(payload, '{factcheck,entities}', flat_message_entities(payload->'factcheck'->'entities'))
 WHERE jsonb_typeof(payload->'factcheck'->'entities') = 'array';

UPDATE channel_updates
   SET payload = jsonb_set(payload, '{entities}', flat_message_entities(payload->'entities'))
 WHERE jsonb_typeof(payload->'entities') = 'array';
UPDATE channel_updates
   SET payload = jsonb_set(payload, '{factcheck,entities}', flat_message_entities(payload->'factcheck'->'entities'))
 WHERE jsonb_typeof(payload->'factcheck'->'entities') = 'array';

DROP FUNCTION flat_message_entities(jsonb);
DROP FUNCTION flat_message_entity(jsonb);
