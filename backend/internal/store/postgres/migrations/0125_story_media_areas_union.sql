-- +goose Up
-- Интерактивные области историй переписаны на ОБЪЕДИНЕНИЕ конструкторов.
--
-- Хранились они плоской записью с полем `type` и восемью необязательными
-- половинами, из которых заполнялась своя; в схеме это семь РАЗНЫХ
-- конструкторов `MediaArea` (мы производим четыре). Плоская запись была третьей
-- формой одного предмета — вход, колонка и витрина, — и постоянный переходник
-- на чтении и есть тот второй источник истины, ради устранения которого
-- программа существует. Поэтому строки переписываются, а не транслируются.
--
-- Что во что переходит:
--   type=geo      → mediaAreaGeoPoint{coordinates, geo}
--   type=venue    → mediaAreaVenue{coordinates, geo, title, address}
--   type=reaction → mediaAreaSuggestedReaction{pFlags, coordinates, reaction}
--   type=url      → mediaAreaUrl{coordinates, url}
--
-- `lat`/`long` становятся ступенью `geoPoint`, эмодзи — объединением `Reaction`,
-- оформление (`dark`/`flipped`) уезжает в `pFlags`, где «выключено» это
-- ОТСУТСТВИЕ ключа. Область неизвестного вида отбрасывается: полупустая запись
-- на проводе хуже её отсутствия, и разбор объединения поступает так же.

UPDATE stories SET media_areas = COALESCE((
  SELECT jsonb_agg(conv ORDER BY ord)
    FROM jsonb_array_elements(media_areas) WITH ORDINALITY AS t(area, ord)
    CROSS JOIN LATERAL (
      SELECT CASE area->>'type'
        WHEN 'geo' THEN jsonb_build_object(
          '_', 'mediaAreaGeoPoint',
          'coordinates', jsonb_build_object(
            '_', 'mediaAreaCoordinates',
            'x', COALESCE(area#>'{coordinates,x}', '0'::jsonb),
            'y', COALESCE(area#>'{coordinates,y}', '0'::jsonb),
            'w', COALESCE(area#>'{coordinates,w}', '0'::jsonb),
            'h', COALESCE(area#>'{coordinates,h}', '0'::jsonb),
            'rotation', COALESCE(area#>'{coordinates,rotation}', '0'::jsonb)),
          'geo', jsonb_build_object(
            '_', 'geoPoint',
            'lat', COALESCE(area->'lat', '0'::jsonb),
            'long', COALESCE(area->'long', '0'::jsonb)))
        WHEN 'venue' THEN jsonb_build_object(
          '_', 'mediaAreaVenue',
          'coordinates', jsonb_build_object(
            '_', 'mediaAreaCoordinates',
            'x', COALESCE(area#>'{coordinates,x}', '0'::jsonb),
            'y', COALESCE(area#>'{coordinates,y}', '0'::jsonb),
            'w', COALESCE(area#>'{coordinates,w}', '0'::jsonb),
            'h', COALESCE(area#>'{coordinates,h}', '0'::jsonb),
            'rotation', COALESCE(area#>'{coordinates,rotation}', '0'::jsonb)),
          'geo', jsonb_build_object(
            '_', 'geoPoint',
            'lat', COALESCE(area->'lat', '0'::jsonb),
            'long', COALESCE(area->'long', '0'::jsonb)),
          'title', COALESCE(area->>'title', ''),
          'address', COALESCE(area->>'address', ''))
        WHEN 'reaction' THEN
          jsonb_strip_nulls(jsonb_build_object(
            '_', 'mediaAreaSuggestedReaction',
            'pFlags', NULLIF(
              (CASE WHEN area->>'dark' = 'true' THEN jsonb_build_object('dark', true) ELSE '{}'::jsonb END
               || CASE WHEN area->>'flipped' = 'true' THEN jsonb_build_object('flipped', true) ELSE '{}'::jsonb END),
              '{}'::jsonb),
            'coordinates', jsonb_build_object(
              '_', 'mediaAreaCoordinates',
              'x', COALESCE(area#>'{coordinates,x}', '0'::jsonb),
              'y', COALESCE(area#>'{coordinates,y}', '0'::jsonb),
              'w', COALESCE(area#>'{coordinates,w}', '0'::jsonb),
              'h', COALESCE(area#>'{coordinates,h}', '0'::jsonb),
              'rotation', COALESCE(area#>'{coordinates,rotation}', '0'::jsonb)),
            'reaction', jsonb_build_object('_', 'reactionEmoji', 'emoticon', COALESCE(area->>'reaction', ''))))
        WHEN 'url' THEN jsonb_build_object(
          '_', 'mediaAreaUrl',
          'coordinates', jsonb_build_object(
            '_', 'mediaAreaCoordinates',
            'x', COALESCE(area#>'{coordinates,x}', '0'::jsonb),
            'y', COALESCE(area#>'{coordinates,y}', '0'::jsonb),
            'w', COALESCE(area#>'{coordinates,w}', '0'::jsonb),
            'h', COALESCE(area#>'{coordinates,h}', '0'::jsonb),
            'rotation', COALESCE(area#>'{coordinates,rotation}', '0'::jsonb)),
          'url', COALESCE(area->>'url', ''))
        ELSE NULL
      END AS conv
    ) c
   WHERE conv IS NOT NULL
), '[]'::jsonb)
 WHERE jsonb_typeof(media_areas) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(media_areas) e WHERE e ? 'type');

-- +goose Down
-- Обратный ход возвращает плоскую запись. Реквизиты, которых у плоской формы не
-- было (`address` у гео, `pFlags` у наклейки), схлопываются обратно в свои
-- прежние ключи.

UPDATE stories SET media_areas = COALESCE((
  SELECT jsonb_agg(conv ORDER BY ord)
    FROM jsonb_array_elements(media_areas) WITH ORDINALITY AS t(area, ord)
    CROSS JOIN LATERAL (
      SELECT CASE area->>'_'
        WHEN 'mediaAreaGeoPoint' THEN jsonb_build_object(
          'type', 'geo',
          'coordinates', (area->'coordinates') - '_',
          'lat', COALESCE(area#>'{geo,lat}', '0'::jsonb),
          'long', COALESCE(area#>'{geo,long}', '0'::jsonb))
        WHEN 'mediaAreaVenue' THEN jsonb_build_object(
          'type', 'venue',
          'coordinates', (area->'coordinates') - '_',
          'lat', COALESCE(area#>'{geo,lat}', '0'::jsonb),
          'long', COALESCE(area#>'{geo,long}', '0'::jsonb),
          'title', COALESCE(area->>'title', ''),
          'address', COALESCE(area->>'address', ''))
        WHEN 'mediaAreaSuggestedReaction' THEN jsonb_strip_nulls(jsonb_build_object(
          'type', 'reaction',
          'coordinates', (area->'coordinates') - '_',
          'reaction', COALESCE(area#>>'{reaction,emoticon}', ''),
          'dark', NULLIF(area#>'{pFlags,dark}' = 'true'::jsonb, false),
          'flipped', NULLIF(area#>'{pFlags,flipped}' = 'true'::jsonb, false)))
        WHEN 'mediaAreaUrl' THEN jsonb_build_object(
          'type', 'url',
          'coordinates', (area->'coordinates') - '_',
          'url', COALESCE(area->>'url', ''))
        ELSE NULL
      END AS conv
    ) c
   WHERE conv IS NOT NULL
), '[]'::jsonb)
 WHERE jsonb_typeof(media_areas) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(media_areas) e WHERE e ? '_');
