-- +goose Up
-- Набор стикера в ЗАМОРОЖЕННЫХ КАДРАХ журналов updates и channel_updates.
--
-- Разбор — docs/readiness/tl-stickers-analysis.md, Р3. Порт объявил
-- `documentAttributeSticker.stickerset` производимым: вопрос «какому набору
-- принадлежит стикер» предмет имеет (наш `set_id`), а транспортным в этом
-- конструкторе был только `access_hash`. Ради того же ответа раньше жила целая
-- ручка обратного поиска (`GET /stickers/by-media/{mediaID}`), которой у
-- оригинала нет вовсе; она удалена.
--
-- Отсюда долг: у кадров, записанных ДО порта, параметра нет. Клиент
-- переигрывает их при /sync и channels.getDifference, и переигранный стикер
-- оказался бы без набора — кликнуть по нему и открыть набор стало бы нельзя,
-- потому что спрашивать больше некого. Та же дисциплина, что у 0100, 0101,
-- 0106, 0107, 0108: постоянный переходник и есть тот второй источник истины,
-- ради устранения которого делается переход.
--
-- Проставляется набор ТЕМ ЖЕ джойном, каким отвечала удалённая ручка
-- (stickers.media_id → stickers.set_id). То есть эта миграция — её последнее
-- применение.
--
-- Проход идёт ПО НАЛИЧИЮ атрибута, а не перечислением типов кадров (урок 0102,
-- 0105, 0106, 0107, 0108): перечисление устарело бы при первом же новом кадре,
-- несущем документ.

-- +goose StatementBegin
-- tl_attrs_with_stickerset — атрибуты документа, где у documentAttributeSticker
-- проставлен `stickerset`. Уже проставленный не трогаем: миграция обязана быть
-- идемпотентной (кадры новой формы уже пишутся с набором).
--
-- Стикер, набора которого в таблице нет (набор удалён), получает
-- `inputStickerSetEmpty` — честное «набора нет», а не подставленный ноль,
-- который выглядел бы как настоящий адрес.
CREATE FUNCTION tl_attrs_with_stickerset(attrs jsonb, media_id bigint) RETURNS jsonb AS $$
DECLARE out jsonb := '[]'::jsonb; a jsonb; set_id bigint;
BEGIN
  IF attrs IS NULL OR jsonb_typeof(attrs) <> 'array' THEN RETURN attrs; END IF;
  SELECT st.set_id INTO set_id FROM stickers st WHERE st.media_id = tl_attrs_with_stickerset.media_id
   ORDER BY st.id LIMIT 1;
  FOR a IN SELECT * FROM jsonb_array_elements(attrs) LOOP
    IF a->>'_' = 'documentAttributeSticker' AND NOT (a ? 'stickerset') THEN
      a := a || jsonb_build_object('stickerset',
        CASE WHEN set_id IS NULL THEN jsonb_build_object('_', 'inputStickerSetEmpty')
             ELSE jsonb_build_object('_', 'inputStickerSetID', 'id', set_id) END);
    END IF;
    out := out || jsonb_build_array(a);
  END LOOP;
  RETURN out;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_frame_with_stickerset — тот же проход по кадру целиком: документ живёт
-- внутри сообщения (`message.media.document`) у обычной отправки и на верхнем
-- уровне (`media.document`) у кадров-обновлений вложения. Оба места — один и
-- тот же конструктор messageMediaDocument, поэтому и обрабатываются одинаково.
CREATE FUNCTION tl_frame_with_stickerset(p jsonb) RETURNS jsonb AS $$
DECLARE doc jsonb; fixed jsonb;
BEGIN
  IF p IS NULL THEN RETURN p; END IF;

  doc := p->'message'->'media'->'document';
  IF doc IS NOT NULL AND doc ? 'attributes' THEN
    fixed := tl_attrs_with_stickerset(doc->'attributes', (doc->>'id')::bigint);
    IF fixed IS DISTINCT FROM doc->'attributes' THEN
      p := jsonb_set(p, '{message,media,document,attributes}', fixed);
    END IF;
  END IF;

  doc := p->'media'->'document';
  IF doc IS NOT NULL AND doc ? 'attributes' THEN
    fixed := tl_attrs_with_stickerset(doc->'attributes', (doc->>'id')::bigint);
    IF fixed IS DISTINCT FROM doc->'attributes' THEN
      p := jsonb_set(p, '{media,document,attributes}', fixed);
    END IF;
  END IF;

  RETURN p;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

UPDATE updates SET payload = tl_frame_with_stickerset(payload)
 WHERE payload::text LIKE '%documentAttributeSticker%';
UPDATE channel_updates SET payload = tl_frame_with_stickerset(payload)
 WHERE payload::text LIKE '%documentAttributeSticker%';

DROP FUNCTION tl_frame_with_stickerset(jsonb);
DROP FUNCTION tl_attrs_with_stickerset(jsonb, bigint);

-- +goose Down
-- Обратный ход снимает параметр — форма кадра возвращается к той, что была до
-- порта. Информация при этом не теряется: набор восстановим тем же джойном,
-- пока таблица стикеров цела.

-- +goose StatementBegin
CREATE FUNCTION tl_attrs_without_stickerset(attrs jsonb) RETURNS jsonb AS $$
DECLARE out jsonb := '[]'::jsonb; a jsonb;
BEGIN
  IF attrs IS NULL OR jsonb_typeof(attrs) <> 'array' THEN RETURN attrs; END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(attrs) LOOP
    IF a->>'_' = 'documentAttributeSticker' THEN
      a := a - 'stickerset';
    END IF;
    out := out || jsonb_build_array(a);
  END LOOP;
  RETURN out;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION tl_frame_without_stickerset(p jsonb) RETURNS jsonb AS $$
DECLARE doc jsonb; fixed jsonb;
BEGIN
  IF p IS NULL THEN RETURN p; END IF;

  doc := p->'message'->'media'->'document';
  IF doc IS NOT NULL AND doc ? 'attributes' THEN
    fixed := tl_attrs_without_stickerset(doc->'attributes');
    IF fixed IS DISTINCT FROM doc->'attributes' THEN
      p := jsonb_set(p, '{message,media,document,attributes}', fixed);
    END IF;
  END IF;

  doc := p->'media'->'document';
  IF doc IS NOT NULL AND doc ? 'attributes' THEN
    fixed := tl_attrs_without_stickerset(doc->'attributes');
    IF fixed IS DISTINCT FROM doc->'attributes' THEN
      p := jsonb_set(p, '{media,document,attributes}', fixed);
    END IF;
  END IF;

  RETURN p;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

UPDATE updates SET payload = tl_frame_without_stickerset(payload)
 WHERE payload::text LIKE '%documentAttributeSticker%';
UPDATE channel_updates SET payload = tl_frame_without_stickerset(payload)
 WHERE payload::text LIKE '%documentAttributeSticker%';

DROP FUNCTION tl_frame_without_stickerset(jsonb);
DROP FUNCTION tl_attrs_without_stickerset(jsonb);
