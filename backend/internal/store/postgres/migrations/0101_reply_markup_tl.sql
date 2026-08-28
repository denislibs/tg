-- +goose Up
-- Разметка клавиатур переезжает в форму оригинала: вместо собственной плоской
-- записи {"inline":[[{"text":…,"callback":…}]],"keyboard":[["A"]],"resize":true,
-- "one_time":true} — объединение конструкторов схемы TL
-- {"_":"replyInlineMarkup","rows":[{"_":"keyboardButtonRow","buttons":[…]}]}
-- (см. domain/mtreplymarkup.go, docs/readiness/tl-program.md).
--
-- Строки переписываются ЗДЕСЬ, а не переводятся переходником на чтении:
-- постоянный переходник и есть тот второй источник истины, ради устранения
-- которого делается переход. После этой миграции читающий код знает ровно одну
-- форму.
--
-- Где лежит разметка (в отличие от сущностей — ОДНА колонка, а не четыре:
-- у drafts/scheduled_messages/suggested_posts клавиатуры нет вовсе, её
-- проставляет только бот при отправке/редактировании):
--   messages.reply_markup
--   и замороженные кадры журналов апдейтов: updates.payload->'reply_markup',
--   channel_updates.payload->'reply_markup' (кадры new_message и edit_message
--   несут клавиатуру, клиент переигрывает их при /sync и difference).
--
-- bot_updates не трогаем сознательно: это очередь публичного Bot API, у него
-- свой плоский контракт (см. botapi_handler.go).
--
-- Отдельно про «убрать клавиатуру». В старой форме это было третье состояние
-- поля keyboard — ПУСТОЙ срез; из-за omitempty он не сериализовался вовсе, и в
-- базе такая разметка лежит как «{}». Поэтому объект без непустых inline и
-- keyboard переводится в replyKeyboardHide — отдельный конструктор объединения.
--
-- Функции-переводчики временные: созданы, применены и удалены в той же
-- транзакции миграции — постоянного переходника в базе не остаётся.

-- +goose StatementBegin
CREATE FUNCTION tl_keyboard_button(b jsonb) RETURNS jsonb AS $$
DECLARE
  txt text := COALESCE(b->>'text', '');
BEGIN
  -- «Ровно один из callback/url/webapp» прежней записи становится выбором
  -- конструктора. Порядок тот же, что у конвертера Bot API: webapp важнее url,
  -- callback — последний (кнопка без ссылок в Bot API всегда callback).
  IF COALESCE(b->>'webapp', '') <> '' THEN
    RETURN jsonb_build_object('_', 'keyboardButtonWebView', 'text', txt, 'url', b->>'webapp');
  END IF;
  IF COALESCE(b->>'url', '') <> '' THEN
    RETURN jsonb_build_object('_', 'keyboardButtonUrl', 'text', txt, 'url', b->>'url');
  END IF;
  -- keyboardButtonCallback.data в схеме — bytes; на JSON-проводе байты едут
  -- base64-строкой (как photoStrippedSize.bytes у медиа). encode() в postgres
  -- переносит строки каждые 76 символов — переносы убираем, иначе строка не
  -- разберётся стандартным base64-декодером.
  RETURN jsonb_build_object('_', 'keyboardButtonCallback', 'text', txt,
           'data', replace(encode(convert_to(COALESCE(b->>'callback', ''), 'UTF8'), 'base64'), E'\n', ''));
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION tl_reply_markup(m jsonb) RETURNS jsonb AS $$
DECLARE
  rows_ jsonb;
  out_ jsonb;
  pflags jsonb := '{}'::jsonb;
BEGIN
  IF m IS NULL OR jsonb_typeof(m) <> 'object' THEN
    RETURN m;
  END IF;
  -- Дискриминатор уже есть — разметка в новой форме, не трогаем (миграция
  -- идемпотентна и безопасна к повторному прогону).
  IF m ? '_' THEN
    RETURN m;
  END IF;

  IF jsonb_typeof(m->'inline') = 'array' AND jsonb_array_length(m->'inline') > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('_', 'keyboardButtonRow', 'buttons', COALESCE((
             SELECT jsonb_agg(tl_keyboard_button(btn) ORDER BY bord)
               FROM jsonb_array_elements(r) WITH ORDINALITY AS b(btn, bord)), '[]'::jsonb)) ORDER BY rord)
      INTO rows_
      FROM jsonb_array_elements(m->'inline') WITH ORDINALITY AS t(r, rord);
    RETURN jsonb_build_object('_', 'replyInlineMarkup', 'rows', COALESCE(rows_, '[]'::jsonb));
  END IF;

  IF jsonb_typeof(m->'keyboard') = 'array' AND jsonb_array_length(m->'keyboard') > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('_', 'keyboardButtonRow', 'buttons', COALESCE((
             SELECT jsonb_agg(jsonb_build_object('_', 'keyboardButton', 'text',
                      CASE WHEN jsonb_typeof(cell) = 'string' THEN cell #>> '{}'
                           ELSE COALESCE(cell->>'text', '') END) ORDER BY bord)
               FROM jsonb_array_elements(r) WITH ORDINALITY AS b(cell, bord)), '[]'::jsonb)) ORDER BY rord)
      INTO rows_
      FROM jsonb_array_elements(m->'keyboard') WITH ORDINALITY AS t(r, rord);
    -- Булевы флаги живут в pFlags и всегда несут true; «выключено» — это
    -- ОТСУТСТВИЕ ключа, поэтому false не кладём. one_time прежней формы — это
    -- single_use схемы (имя из схемы, а не наше).
    IF COALESCE((m->>'resize')::boolean, false) THEN
      pflags := pflags || jsonb_build_object('resize', true);
    END IF;
    IF COALESCE((m->>'one_time')::boolean, false) THEN
      pflags := pflags || jsonb_build_object('single_use', true);
    END IF;
    out_ := jsonb_build_object('_', 'replyKeyboardMarkup', 'rows', COALESCE(rows_, '[]'::jsonb));
    IF pflags <> '{}'::jsonb THEN
      out_ := out_ || jsonb_build_object('pFlags', pflags);
    END IF;
    RETURN out_;
  END IF;

  -- Ни inline, ни keyboard — это и есть «убрать клавиатуру» (см. шапку).
  RETURN jsonb_build_object('_', 'replyKeyboardHide');
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- +goose StatementEnd

UPDATE messages SET reply_markup = tl_reply_markup(reply_markup) WHERE reply_markup IS NOT NULL;

UPDATE updates
   SET payload = jsonb_set(payload, '{reply_markup}', tl_reply_markup(payload->'reply_markup'))
 WHERE jsonb_typeof(payload->'reply_markup') = 'object';

UPDATE channel_updates
   SET payload = jsonb_set(payload, '{reply_markup}', tl_reply_markup(payload->'reply_markup'))
 WHERE jsonb_typeof(payload->'reply_markup') = 'object';

DROP FUNCTION tl_reply_markup(jsonb);
DROP FUNCTION tl_keyboard_button(jsonb);

-- +goose Down
-- Обратный перевод в прежнюю плоскую форму. Потери неизбежны, потому что у
-- прежней записи не было ни этих конструкторов, ни этих флагов:
-- replyKeyboardForceReply (аналога нет вовсе → NULL), selective/persistent/
-- placeholder, requires_password у кнопки. replyKeyboardHide сворачивается в
-- «{}» — ровно так его и писал прежний код (пустой keyboard + omitempty).

-- +goose StatementBegin
CREATE FUNCTION flat_keyboard_button(b jsonb) RETURNS jsonb AS $$
  SELECT CASE b->>'_'
    WHEN 'keyboardButtonCallback' THEN jsonb_build_object('text', COALESCE(b->>'text', ''),
           'callback', convert_from(decode(COALESCE(b->>'data', ''), 'base64'), 'UTF8'))
    WHEN 'keyboardButtonUrl'      THEN jsonb_build_object('text', COALESCE(b->>'text', ''),
           'url', COALESCE(b->>'url', ''))
    WHEN 'keyboardButtonWebView'  THEN jsonb_build_object('text', COALESCE(b->>'text', ''),
           'webapp', COALESCE(b->>'url', ''))
    ELSE NULL
  END;
$$ LANGUAGE sql IMMUTABLE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION flat_reply_markup(m jsonb) RETURNS jsonb AS $$
DECLARE
  rows_ jsonb;
  out_ jsonb;
BEGIN
  IF m IS NULL OR jsonb_typeof(m) <> 'object' OR NOT m ? '_' THEN
    RETURN m;
  END IF;

  IF m->>'_' = 'replyInlineMarkup' THEN
    SELECT jsonb_agg(COALESCE((
             SELECT jsonb_agg(v ORDER BY bord)
               FROM (SELECT flat_keyboard_button(btn) AS v, bord
                       FROM jsonb_array_elements(r->'buttons') WITH ORDINALITY AS b(btn, bord)) c
              WHERE c.v IS NOT NULL), '[]'::jsonb) ORDER BY rord)
      INTO rows_
      FROM jsonb_array_elements(m->'rows') WITH ORDINALITY AS t(r, rord);
    RETURN jsonb_build_object('inline', COALESCE(rows_, '[]'::jsonb));
  END IF;

  IF m->>'_' = 'replyKeyboardMarkup' THEN
    SELECT jsonb_agg(COALESCE((
             SELECT jsonb_agg(to_jsonb(COALESCE(btn->>'text', '')) ORDER BY bord)
               FROM jsonb_array_elements(r->'buttons') WITH ORDINALITY AS b(btn, bord)), '[]'::jsonb) ORDER BY rord)
      INTO rows_
      FROM jsonb_array_elements(m->'rows') WITH ORDINALITY AS t(r, rord);
    out_ := jsonb_build_object('keyboard', COALESCE(rows_, '[]'::jsonb));
    IF COALESCE((m->'pFlags'->>'resize')::boolean, false) THEN
      out_ := out_ || jsonb_build_object('resize', true);
    END IF;
    IF COALESCE((m->'pFlags'->>'single_use')::boolean, false) THEN
      out_ := out_ || jsonb_build_object('one_time', true);
    END IF;
    RETURN out_;
  END IF;

  IF m->>'_' = 'replyKeyboardHide' THEN
    RETURN '{}'::jsonb;
  END IF;

  -- replyKeyboardForceReply и всё, чего в прежней форме не было: клавиатуры нет.
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- +goose StatementEnd

UPDATE messages SET reply_markup = flat_reply_markup(reply_markup) WHERE reply_markup IS NOT NULL;

UPDATE updates
   SET payload = jsonb_set(payload, '{reply_markup}', COALESCE(flat_reply_markup(payload->'reply_markup'), 'null'::jsonb))
 WHERE jsonb_typeof(payload->'reply_markup') = 'object';

UPDATE channel_updates
   SET payload = jsonb_set(payload, '{reply_markup}', COALESCE(flat_reply_markup(payload->'reply_markup'), 'null'::jsonb))
 WHERE jsonb_typeof(payload->'reply_markup') = 'object';

DROP FUNCTION flat_reply_markup(jsonb);
DROP FUNCTION flat_keyboard_button(jsonb);
