-- +goose Up
-- Два долга порта, оба про ЗАМОРОЖЕННЫЕ КАДРЫ журналов updates и
-- channel_updates: клиент переигрывает их при /sync и channels.getDifference,
-- поэтому оставленная как есть старая форма — это вторая форма на проводе,
-- ровно то, ради устранения чего делается переход (урок 0100, 0101, 0106, 0107).
--
--   1) web_page_update нёс карточку ссылки собственным ключом `web_page` со
--      снимком read-модели внутри (site_name/photo_id/photo_w/photo_blur/…).
--      Порт объединения MessageMedia (0107) перевёл превью ВНУТРИ сообщения, но
--      этот кадр не тронул: там ключ лежит на верхнем уровне payload, а не
--      внутри `message`. Теперь карточка едет тем же конструктором
--      messageMediaWebPage под ключом `media`, что и в самом сообщении;
--
--   2) poll_update нёс итоги БЕЗ pollResults.pFlags.min, хотя собраны они для
--      «зрителя 0» — то есть заведомо урезаны (тело кадра одно на всех
--      получателей). Клиент подразумевал урезанность безусловно; теперь он
--      читает флаг, и переигранный старый кадр без флага СТЁР БЫ выбор зрителя.
--
-- Проход в обоих случаях идёт ПО НАЛИЧИЮ ключа, а не перечислением типов кадров
-- (урок 0102, 0105, 0106, 0107): перечисление устарело бы при первом же новом
-- кадре той же формы.
--
-- Функция-переводчик временная: создана, применена и удалена в одной транзакции.

-- +goose StatementBegin
-- tl_webpage_media — карточка ссылки (копия переводчика из 0107: там он был
-- создан и удалён в своей транзакции). Картинка превью перестаёт быть россыпью
-- photo_* и становится обычной лестницей ступеней, как у любого другого фото;
-- display_url — тот же адрес без схемы (его показывают в шапке карточки).
CREATE FUNCTION tl_webpage_media(w jsonb) RETURNS jsonb AS $$
DECLARE sizes jsonb := '[]'::jsonb; url text; disp text; ww int; hh int;
BEGIN
  IF w IS NULL OR jsonb_typeof(w) <> 'object' THEN RETURN NULL; END IF;
  url := COALESCE(w->>'url', '');
  disp := regexp_replace(url, '^https?://', '');
  disp := regexp_replace(disp, '/$', '');

  ww := COALESCE((w->>'photo_w')::int, 0);
  hh := COALESCE((w->>'photo_h')::int, 0);
  IF COALESCE(w->>'photo_blur', '') <> '' THEN
    sizes := sizes || jsonb_build_array(jsonb_build_object(
      '_', 'photoStrippedSize', 'type', 'i', 'bytes', w->>'photo_blur'));
  END IF;
  IF COALESCE((w->>'photo_has_thumb')::boolean, false) AND ww > 0 AND hh > 0 THEN
    -- Ступень 'y' вписана в квадрат 1280 с сохранением пропорции — та же
    -- арифметика, что у генератора превью (domain.fitThumb).
    sizes := sizes || jsonb_build_array(jsonb_build_object(
      '_', 'photoSize', 'type', 'y',
      'w', CASE WHEN ww <= 1280 AND hh <= 1280 THEN ww
                WHEN ww >= hh THEN 1280 ELSE GREATEST(1, (ww * 1280) / hh) END,
      'h', CASE WHEN ww <= 1280 AND hh <= 1280 THEN hh
                WHEN ww >= hh THEN GREATEST(1, (hh * 1280) / ww) ELSE 1280 END,
      'size', 0));
  END IF;
  IF ww > 0 AND hh > 0 THEN
    sizes := sizes || jsonb_build_array(jsonb_build_object(
      '_', 'photoSize', 'type', 'w', 'w', ww, 'h', hh, 'size', 0));
  END IF;

  RETURN jsonb_build_object(
    '_', 'messageMediaWebPage',
    'webpage', jsonb_strip_nulls(jsonb_build_object(
      '_', 'webPage',
      'url', url,
      'display_url', disp,
      'site_name', NULLIF(COALESCE(w->>'site_name', ''), ''),
      'title', NULLIF(COALESCE(w->>'title', ''), ''),
      'description', NULLIF(COALESCE(w->>'description', ''), ''),
      'photo', CASE WHEN COALESCE((w->>'photo_id')::bigint, 0) > 0
                    THEN jsonb_build_object('_', 'photo',
                                            'id', (w->>'photo_id')::bigint,
                                            'sizes', sizes) END,
      'has_iv', CASE WHEN COALESCE((w->>'has_iv')::boolean, false) THEN true END)));
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- ── 1. web_page_update ──────────────────────────────────────────────────────
UPDATE updates
   SET payload = (payload - 'web_page') || jsonb_build_object('media', tl_webpage_media(payload->'web_page'))
 WHERE payload ? 'web_page' AND tl_webpage_media(payload->'web_page') IS NOT NULL;
UPDATE channel_updates
   SET payload = (payload - 'web_page') || jsonb_build_object('media', tl_webpage_media(payload->'web_page'))
 WHERE payload ? 'web_page' AND tl_webpage_media(payload->'web_page') IS NOT NULL;

-- Кадр, чья карточка не разбирается (ключ есть, а объекта нет), УДАЛЯЕТСЯ:
-- оставить его значило бы оставить старый ключ на проводе. Клиент увидит разрыв
-- pts и переспросит историю — деградация, а не подмена (решение 0107).
DELETE FROM updates WHERE payload ? 'web_page';
DELETE FROM channel_updates WHERE payload ? 'web_page';

-- ── 2. poll_update ──────────────────────────────────────────────────────────
-- Итоги ВЕРХНЕГО уровня payload производит ровно один кадр — poll_update, и
-- собраны они для «зрителя 0». Итоги внутри `message` не трогаем: у нового
-- сообщения-опроса голосов нет вовсе, урезать там нечего.
UPDATE updates
   SET payload = jsonb_set(payload, '{media,results,pFlags}',
                           COALESCE(payload->'media'->'results'->'pFlags', '{}'::jsonb)
                             || jsonb_build_object('min', true))
 WHERE payload->'media'->>'_' = 'messageMediaPoll';
UPDATE channel_updates
   SET payload = jsonb_set(payload, '{media,results,pFlags}',
                           COALESCE(payload->'media'->'results'->'pFlags', '{}'::jsonb)
                             || jsonb_build_object('min', true))
 WHERE payload->'media'->>'_' = 'messageMediaPoll';

DROP FUNCTION tl_webpage_media(jsonb);

-- +goose Down
-- +goose StatementBegin
CREATE FUNCTION tl_webpage_legacy(md jsonb) RETURNS jsonb AS $$
DECLARE w jsonb; sz jsonb; ww int := 0; hh int := 0; blur text; has_thumb boolean := false;
BEGIN
  IF md IS NULL OR md->>'_' <> 'messageMediaWebPage' THEN RETURN NULL; END IF;
  w := md->'webpage';
  FOR sz IN SELECT * FROM jsonb_array_elements(COALESCE(w->'photo'->'sizes', '[]'::jsonb)) LOOP
    IF sz->>'_' = 'photoStrippedSize' THEN
      blur := sz->>'bytes';
    ELSIF sz->>'_' = 'photoSize' AND sz->>'type' = 'y' THEN
      has_thumb := true;
    ELSIF sz->>'_' = 'photoSize' AND sz->>'type' = 'w' THEN
      ww := (sz->>'w')::int; hh := (sz->>'h')::int;
    END IF;
  END LOOP;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'url', COALESCE(w->>'url', ''),
    'site_name', w->>'site_name',
    'title', w->>'title',
    'description', w->>'description',
    'photo_id', (w->'photo'->>'id')::bigint,
    'photo_w', NULLIF(ww, 0),
    'photo_h', NULLIF(hh, 0),
    'photo_blur', blur,
    'photo_has_thumb', CASE WHEN has_thumb THEN true END,
    'has_iv', CASE WHEN COALESCE((w->>'has_iv')::boolean, false) THEN true END));
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

UPDATE updates
   SET payload = (payload - 'media') || jsonb_build_object('web_page', tl_webpage_legacy(payload->'media'))
 WHERE tl_webpage_legacy(payload->'media') IS NOT NULL;
UPDATE channel_updates
   SET payload = (payload - 'media') || jsonb_build_object('web_page', tl_webpage_legacy(payload->'media'))
 WHERE tl_webpage_legacy(payload->'media') IS NOT NULL;

-- Флаг min снимается; сами итоги от этого не меняются.
UPDATE updates
   SET payload = jsonb_set(payload, '{media,results,pFlags}',
                           (payload->'media'->'results'->'pFlags') - 'min')
 WHERE payload->'media'->>'_' = 'messageMediaPoll'
   AND payload->'media'->'results'->'pFlags' ? 'min';
UPDATE channel_updates
   SET payload = jsonb_set(payload, '{media,results,pFlags}',
                           (payload->'media'->'results'->'pFlags') - 'min')
 WHERE payload->'media'->>'_' = 'messageMediaPoll'
   AND payload->'media'->'results'->'pFlags' ? 'min';

DROP FUNCTION tl_webpage_legacy(jsonb);
