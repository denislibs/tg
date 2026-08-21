-- +goose Up
-- Объединение MessageMedia доведено до конца: гео, место, контакт, опрос,
-- чек-лист, розыгрыш, превью ссылки и платное медиа перестали быть
-- СОБСТВЕННЫМИ ключами сообщения и стали конструкторами того же объединения
-- (подарок — служебным действием messageActionStarGift: конструктора
-- messageMediaStarGift в схеме нет вовсе).
--
-- Колонок этот шаг не меняет: гео/контакт живут плоскими полями строки
-- messages, а опрос, чек-лист, розыгрыш, подарок и цена платного медиа — своими
-- таблицами; вложение собирается на чтении (Message.ToWire), как собиралось и
-- медиа после порта. Менять надо ЗАМОРОЖЕННЫЕ КАДРЫ журналов updates и
-- channel_updates: клиент переигрывает их при /sync и channels.getDifference,
-- поэтому старая форма, оставленная как есть, дала бы вторую форму вложения на
-- проводе — ровно то, ради устранения чего делается переход (урок 0100, 0101 и
-- 0106).
--
-- Меняются пять видов кадров:
--   1) кадры с сообщением (new_message, paid_media_unlock и прочие, где тело
--      лежит под ключом `message`) — восемь собственных ключей вложения;
--   2) geo_live_update — точка ехала плоским ключом `geo`;
--   3) poll_update      — опрос ехал записью PollInfo под ключом `poll`;
--   4) checklist_update — чек-лист ехал записью ChecklistInfo;
--   5) giveaway_update  — розыгрыш ехал записью GiveawayInfo.
--
-- Функции-переводчики временные: созданы, применены и удалены в одной
-- транзакции миграции.

-- +goose StatementBegin
-- tl_geo_media — три конструктора гео, которые плоский ключ смешивал в один.
--
-- «Остановлена» в схеме выражается ИСТЁКШИМ сроком: клиент считает
-- date + period <= now. Поэтому у остановленной трансляции period укорачивается
-- до момента остановки; если даты сообщения или правки в кадре нет, период
-- нулевой — подделать «идёт» нечем.
CREATE FUNCTION tl_geo_media(g jsonb, msg_date int, edit_date int) RETURNS jsonb AS $$
DECLARE period int; lat double precision; lng double precision;
BEGIN
  IF g IS NULL OR jsonb_typeof(g) <> 'object' THEN RETURN NULL; END IF;
  lat := (g->>'lat')::double precision;
  lng := (g->>'lng')::double precision;
  IF lat IS NULL OR lng IS NULL THEN RETURN NULL; END IF;

  IF jsonb_typeof(g->'live_period') = 'number' THEN
    period := (g->>'live_period')::int;
    IF COALESCE((g->>'live_stopped')::boolean, false) THEN
      period := 0;
      IF msg_date IS NOT NULL AND edit_date IS NOT NULL
         AND edit_date - msg_date > 0 AND edit_date - msg_date < (g->>'live_period')::int THEN
        period := edit_date - msg_date;
      END IF;
    END IF;
    RETURN jsonb_strip_nulls(jsonb_build_object(
      '_', 'messageMediaGeoLive',
      'geo', jsonb_build_object('_', 'geoPoint', 'long', lng, 'lat', lat),
      'heading', CASE WHEN COALESCE((g->>'heading')::int, 0) <> 0 THEN (g->>'heading')::int END,
      'period', period));
  END IF;

  IF COALESCE(g->>'title', '') <> '' OR COALESCE(g->>'address', '') <> '' THEN
    RETURN jsonb_build_object(
      '_', 'messageMediaVenue',
      'geo', jsonb_build_object('_', 'geoPoint', 'long', lng, 'lat', lat),
      'title', COALESCE(g->>'title', ''),
      'address', COALESCE(g->>'address', ''));
  END IF;

  RETURN jsonb_build_object(
    '_', 'messageMediaGeo',
    'geo', jsonb_build_object('_', 'geoPoint', 'long', lng, 'lat', lat));
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_contact_media — визитка. Все пять параметров обязательные и едут всегда, в
-- том числе пустыми: имя визитки мы храним ОДНОЙ строкой, поэтому last_name
-- пуст, а vCard мы не принимаем вовсе.
CREATE FUNCTION tl_contact_media(c jsonb) RETURNS jsonb AS $$
BEGIN
  IF c IS NULL OR jsonb_typeof(c) <> 'object' THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    '_', 'messageMediaContact',
    'phone_number', COALESCE(c->>'phone', ''),
    'first_name', COALESCE(c->>'name', ''),
    'last_name', '',
    'vcard', '',
    'user_id', COALESCE((c->>'user_id')::bigint, 0));
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_poll_option — ключ варианта (option:bytes) из его НОМЕРА, тем же правилом,
-- что и в модели: один байт, base64 на JSON-проводе фазы 0.
CREATE FUNCTION tl_poll_option(idx int) RETURNS text AS $$
  SELECT encode(set_byte('\x00'::bytea, 0, idx), 'base64');
$$ LANGUAGE sql IMMUTABLE;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_poll_media — опрос: сам опрос и ИТОГИ раздельно, как в схеме.
--
-- Наш `anonymous` — ОТРИЦАНИЕ public_voters, а `my_votes`/`correct_option` —
-- флаги chosen/correct у конкретного варианта, а не массивы рядом с counts.
CREATE FUNCTION tl_poll_media(p jsonb) RETURNS jsonb AS $$
DECLARE answers jsonb := '[]'::jsonb; results jsonb := '[]'::jsonb;
        flags jsonb := '{}'::jsonb; vflags jsonb;
        i int; n int; opt text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN NULL; END IF;
  n := COALESCE(jsonb_array_length(p->'options'), 0);
  FOR i IN 0..GREATEST(n - 1, 0) LOOP
    EXIT WHEN n = 0;
    opt := tl_poll_option(i);
    answers := answers || jsonb_build_array(jsonb_build_object(
      '_', 'pollAnswer',
      'text', jsonb_build_object('_', 'textWithEntities',
                                 'text', COALESCE(p->'options'->>i, ''),
                                 'entities', '[]'::jsonb),
      'option', opt));
    vflags := '{}'::jsonb;
    IF p->'my_votes' @> to_jsonb(i) THEN
      vflags := vflags || jsonb_build_object('chosen', true);
    END IF;
    IF jsonb_typeof(p->'correct_option') = 'number' AND (p->>'correct_option')::int = i THEN
      vflags := vflags || jsonb_build_object('correct', true);
    END IF;
    results := results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      '_', 'pollAnswerVoters',
      'pFlags', CASE WHEN vflags = '{}'::jsonb THEN NULL ELSE vflags END,
      'option', opt,
      'voters', CASE WHEN COALESCE((p->'counts'->>i)::int, 0) <> 0
                     THEN (p->'counts'->>i)::int END)));
  END LOOP;

  IF COALESCE((p->>'closed')::boolean, false)   THEN flags := flags || jsonb_build_object('closed', true); END IF;
  IF NOT COALESCE((p->>'anonymous')::boolean, false) THEN flags := flags || jsonb_build_object('public_voters', true); END IF;
  IF COALESCE((p->>'multiple')::boolean, false) THEN flags := flags || jsonb_build_object('multiple_choice', true); END IF;
  IF COALESCE((p->>'quiz')::boolean, false)     THEN flags := flags || jsonb_build_object('quiz', true); END IF;

  RETURN jsonb_build_object(
    '_', 'messageMediaPoll',
    'poll', jsonb_strip_nulls(jsonb_build_object(
      '_', 'poll',
      'id', COALESCE((p->>'id')::bigint, 0),
      'pFlags', CASE WHEN flags = '{}'::jsonb THEN NULL ELSE flags END,
      'question', jsonb_build_object('_', 'textWithEntities',
                                     'text', COALESCE(p->>'question', ''),
                                     'entities', '[]'::jsonb),
      'answers', answers)),
    'results', jsonb_strip_nulls(jsonb_build_object(
      '_', 'pollResults',
      'results', CASE WHEN results = '[]'::jsonb THEN NULL ELSE results END,
      'total_voters', CASE WHEN COALESCE((p->>'total_voters')::int, 0) <> 0
                           THEN (p->>'total_voters')::int END)));
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_todo_media — чек-лист: пункты и ОТМЕТКИ раздельно.
--
-- Времени отметки в старом кадре нет вовсе (плоскому marked_by его некуда было
-- положить), а todoCompletion.date обязателен — поэтому оно поднимается из
-- checklist_marks, где хранится с самого начала. Строки нет (пункт с тех пор
-- сняли) — едет ноль: это «время неизвестно», а не «отметки нет».
CREATE FUNCTION tl_todo_media(c jsonb) RETURNS jsonb AS $$
DECLARE items jsonb := '[]'::jsonb; done jsonb := '[]'::jsonb;
        flags jsonb := '{}'::jsonb; it jsonb; uid jsonb; marked timestamptz;
BEGIN
  IF c IS NULL OR jsonb_typeof(c) <> 'object' THEN RETURN NULL; END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(c->'items', '[]'::jsonb)) LOOP
    items := items || jsonb_build_array(jsonb_build_object(
      '_', 'todoItem',
      'id', COALESCE((it->>'id')::int, 0),
      'title', jsonb_build_object('_', 'textWithEntities',
                                  'text', COALESCE(it->>'text', ''),
                                  'entities', '[]'::jsonb)));
    FOR uid IN SELECT * FROM jsonb_array_elements(COALESCE(it->'marked_by', '[]'::jsonb)) LOOP
      SELECT m.marked_at INTO marked FROM checklist_marks m
       WHERE m.checklist_id = COALESCE((c->>'id')::bigint, 0)
         AND m.item_id = COALESCE((it->>'id')::int, 0)
         AND m.user_id = uid::text::bigint;
      done := done || jsonb_build_array(jsonb_build_object(
        '_', 'todoCompletion',
        'id', COALESCE((it->>'id')::int, 0),
        'completed_by', jsonb_build_object('_', 'peerUser', 'user_id', uid::text::bigint),
        'date', COALESCE(extract(epoch FROM marked)::int, 0)));
    END LOOP;
  END LOOP;

  IF COALESCE((c->>'others_can_add')::boolean, false)  THEN flags := flags || jsonb_build_object('others_can_append', true); END IF;
  IF COALESCE((c->>'others_can_mark')::boolean, false) THEN flags := flags || jsonb_build_object('others_can_complete', true); END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    '_', 'messageMediaToDo',
    'todo', jsonb_strip_nulls(jsonb_build_object(
      '_', 'todoList',
      'id', COALESCE((c->>'id')::bigint, 0),
      'pFlags', CASE WHEN flags = '{}'::jsonb THEN NULL ELSE flags END,
      'title', jsonb_build_object('_', 'textWithEntities',
                                  'text', COALESCE(c->>'title', ''),
                                  'entities', '[]'::jsonb),
      'list', items)),
    'completions', CASE WHEN done = '[]'::jsonb THEN NULL ELSE done END));
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_giveaway_media — розыгрыш. Статус «активен/завершён» это ВЫБОР
-- конструктора, вид приза — то, какой из параметров months/stars присутствует,
-- а `participating`/`i_won`/`participants` уходят из кадра вовсе: личное
-- состояние зрителя отдаёт отдельная ручка (payments.giveawayInfo), а тело
-- кадра одно на всех получателей.
--
-- launch — номер сообщения-запуска; у кадра giveaway_update он поднимается из
-- messages по giveaway_id, у кадра с сообщением это номер самого сообщения.
CREATE FUNCTION tl_giveaway_media(g jsonb, launch bigint) RETURNS jsonb AS $$
DECLARE months int; stars bigint; channel bigint; until int;
BEGIN
  IF g IS NULL OR jsonb_typeof(g) <> 'object' THEN RETURN NULL; END IF;
  -- peer_id в старой записи — ЗНАКОВЫЙ ключ пира; channels/channel_id схемы
  -- несут то же число, что peerChannel.channel_id, то есть без знака.
  channel := abs(COALESCE((g->>'peer_id')::bigint, 0));
  until := (COALESCE((g->>'until_date')::bigint, 0) / 1000)::int;
  IF g->>'prize_kind' = 'stars' THEN
    months := NULL; stars := COALESCE((g->>'stars')::bigint, 0);
  ELSE
    months := COALESCE((g->>'months')::int, 0); stars := NULL;
  END IF;

  IF g->>'status' = 'finished' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      '_', 'messageMediaGiveawayResults',
      'id', COALESCE((g->>'id')::bigint, 0),
      'channel_id', channel,
      'launch_msg_id', COALESCE(launch, 0),
      'winners_count', COALESCE((g->>'winners_count')::int, 0),
      'unclaimed_count', 0,
      'winners', COALESCE(g->'winner_ids', '[]'::jsonb),
      'months', CASE WHEN months IS NOT NULL AND months <> 0 THEN months END,
      'stars', CASE WHEN stars IS NOT NULL AND stars <> 0 THEN stars END,
      'until_date', until));
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    '_', 'messageMediaGiveaway',
    'id', COALESCE((g->>'id')::bigint, 0),
    'pFlags', jsonb_build_object('winners_are_visible', true),
    'channels', jsonb_build_array(channel),
    'quantity', COALESCE((g->>'winners_count')::int, 0),
    'months', CASE WHEN months IS NOT NULL AND months <> 0 THEN months END,
    'stars', CASE WHEN stars IS NOT NULL AND stars <> 0 THEN stars END,
    'until_date', until));
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_webpage_media — карточка ссылки. Картинка превью перестаёт быть россыпью
-- photo_* и становится обычной лестницей ступеней, как у любого другого фото.
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

-- +goose StatementBegin
-- tl_paid_media — платное вложение это ОБЁРТКА, а не приписка: настоящее медиа
-- лежит внутри вектора extended_media, а неоплатившему туда кладётся заглушка
-- messageExtendedMediaPreview (коробка кадра + подложка, и больше ничего).
CREATE FUNCTION tl_paid_media(md jsonb, p jsonb) RETURNS jsonb AS $$
DECLARE item jsonb; sz jsonb; ww int := 0; hh int := 0; thumb jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN md; END IF;

  IF COALESCE((p->>'locked')::boolean, false) THEN
    IF md IS NOT NULL THEN
      FOR sz IN SELECT * FROM jsonb_array_elements(COALESCE(md->'photo'->'sizes', '[]'::jsonb)) LOOP
        IF sz->>'_' = 'photoStrippedSize' THEN
          thumb := sz;
        ELSIF sz->>'_' = 'photoSize' AND sz->>'type' = 'w' THEN
          ww := COALESCE((sz->>'w')::int, 0);
          hh := COALESCE((sz->>'h')::int, 0);
        END IF;
      END LOOP;
    END IF;
    item := jsonb_strip_nulls(jsonb_build_object(
      '_', 'messageExtendedMediaPreview',
      'w', CASE WHEN ww <> 0 THEN ww END,
      'h', CASE WHEN hh <> 0 THEN hh END,
      'thumb', thumb));
  ELSIF md IS NOT NULL THEN
    item := jsonb_build_object('_', 'messageExtendedMedia', 'media', md);
  END IF;

  RETURN jsonb_build_object(
    '_', 'messageMediaPaidMedia',
    'stars_amount', COALESCE((p->>'price')::bigint, 0),
    'extended_media', CASE WHEN item IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(item) END);
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_gift_action — подарок: СЛУЖЕБНОЕ действие, а не вложение. Конструктора
-- messageMediaStarGift в схеме нет вовсе, поэтому кадр с подарком меняет и
-- конструктор самого сообщения (см. tl_media_message).
--
-- Уходит `from_name` — имя дарителя строкой рядом с его id: последняя серверная
-- склейка имени в этой подсистеме. Внешность подарка (emoji) остаётся нашим
-- объявленным параметром: в схеме на её месте анимированный стикер-документ,
-- которого у нас нет.
CREATE FUNCTION tl_gift_action(g jsonb, owner bigint) RETURNS jsonb AS $$
DECLARE flags jsonb := '{}'::jsonb; gift jsonb; gflags jsonb := '{}'::jsonb;
BEGIN
  IF g IS NULL OR jsonb_typeof(g) <> 'object' THEN RETURN NULL; END IF;

  IF COALESCE((g->'gift'->>'sold_out')::boolean, false) THEN
    gflags := gflags || jsonb_build_object('sold_out', true);
  END IF;
  IF jsonb_typeof(g->'gift'->'total') = 'number' THEN
    gflags := gflags || jsonb_build_object('limited', true);
  END IF;
  gift := jsonb_strip_nulls(jsonb_build_object(
    '_', 'starGift',
    'pFlags', CASE WHEN gflags = '{}'::jsonb THEN NULL ELSE gflags END,
    'id', COALESCE((g->'gift'->>'id')::bigint, 0),
    'emoji', NULLIF(COALESCE(g->'gift'->>'emoji', ''), ''),
    'stars', COALESCE((g->'gift'->>'price_stars')::bigint, 0),
    'availability_total', CASE WHEN jsonb_typeof(g->'gift'->'total') = 'number'
                               THEN (g->'gift'->>'total')::int END,
    'availability_remains', CASE WHEN jsonb_typeof(g->'gift'->'total') = 'number'
                                  AND jsonb_typeof(g->'gift'->'remains') = 'number'
                                  AND (g->'gift'->>'remains')::int <> 0
                                 THEN (g->'gift'->>'remains')::int END,
    'convert_stars', COALESCE((g->'gift'->>'convert_stars')::bigint, 0),
    'title', NULLIF(COALESCE(g->'gift'->>'title', ''), '')));

  IF COALESCE((g->>'anonymous')::boolean, false) THEN flags := flags || jsonb_build_object('name_hidden', true); END IF;
  IF NOT COALESCE((g->>'hidden')::boolean, false) THEN flags := flags || jsonb_build_object('saved', true); END IF;
  IF COALESCE((g->>'converted')::boolean, false) THEN flags := flags || jsonb_build_object('converted', true); END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    '_', 'messageActionStarGift',
    'pFlags', CASE WHEN flags = '{}'::jsonb THEN NULL ELSE flags END,
    'gift', gift,
    'message', CASE WHEN COALESCE(g->>'message', '') <> ''
                    THEN jsonb_build_object('_', 'textWithEntities',
                                            'text', g->>'message',
                                            'entities', '[]'::jsonb) END,
    'convert_stars', CASE WHEN COALESCE((g->>'convert_stars')::bigint, 0) <> 0
                          THEN (g->>'convert_stars')::bigint END,
    'from_id', CASE WHEN jsonb_typeof(g->'from_id') = 'number'
                    THEN jsonb_build_object('_', 'peerUser', 'user_id', (g->>'from_id')::bigint) END,
    'peer', CASE WHEN owner IS NOT NULL AND owner <> 0
                 THEN jsonb_build_object('_', 'peerUser', 'user_id', owner) END,
    'saved_id', CASE WHEN owner IS NOT NULL AND owner <> 0
                     THEN COALESCE((g->>'id')::bigint, 0) END));
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
-- tl_media_message — сообщение кадра: восемь собственных ключей вложения
-- сводятся к ОДНОМУ конструктору под ключом media.
--
-- Порядок ветвей — взаимоисключительность схемы: вложение ровно одно. Платное
-- медиа первым, потому что оно обёртка; превью ссылки последним и только у
-- сообщения без файла — у оригинала карточка ссылки и есть само вложение.
CREATE FUNCTION tl_media_message(m jsonb) RETURNS jsonb AS $$
DECLARE out jsonb; media jsonb; act jsonb; owner bigint;
BEGIN
  IF m IS NULL OR jsonb_typeof(m) <> 'object' THEN RETURN m; END IF;

  -- Подарок: сообщение становится СЛУЖЕБНЫМ, и всё, чего у messageService нет,
  -- уходит вместе с ним.
  IF m ? 'gift' THEN
    -- Владелец подарка — собеседник в приватном чате; в кадре его нет, а
    -- saved_id без peer в схеме не собирается (они делят один бит). Поэтому
    -- владелец поднимается из saved_star_gifts по номеру подарка.
    SELECT sg.owner_id INTO owner FROM saved_star_gifts sg
     WHERE sg.id = COALESCE((m->'gift'->>'id')::bigint, 0);
    act := tl_gift_action(m->'gift', owner);
    IF act IS NULL THEN RETURN NULL; END IF;
    out := m - 'gift' - 'message' - 'media' - 'entities' - 'reply_markup'
             - 'grouped_id' - 'effect_name' - 'factcheck' - 'views' - 'forwards'
             - 'replies' - 'edit_date' - 'enc_body' - 'destruct_at'
             - 'send_at' - 'when_online' - 'geo' - 'contact' - 'poll'
             - 'checklist' - 'giveaway' - 'web_page' - 'paid_media';
    RETURN out || jsonb_build_object('_', 'messageService', 'action', act);
  END IF;

  media := m->'media';
  IF m ? 'geo' THEN
    media := tl_geo_media(m->'geo',
                          CASE WHEN jsonb_typeof(m->'date') = 'number' THEN (m->>'date')::int END,
                          CASE WHEN jsonb_typeof(m->'edit_date') = 'number' THEN (m->>'edit_date')::int END);
  ELSIF m ? 'contact' THEN
    media := tl_contact_media(m->'contact');
  ELSIF m ? 'poll' THEN
    media := tl_poll_media(m->'poll');
  ELSIF m ? 'checklist' THEN
    media := tl_todo_media(m->'checklist');
  ELSIF m ? 'giveaway' THEN
    media := tl_giveaway_media(m->'giveaway',
                               CASE WHEN jsonb_typeof(m->'id') = 'number' THEN (m->>'id')::bigint END);
  ELSIF media IS NULL AND m ? 'web_page' THEN
    media := tl_webpage_media(m->'web_page');
  END IF;
  IF m ? 'paid_media' THEN
    media := tl_paid_media(media, m->'paid_media');
  END IF;

  out := m - 'geo' - 'contact' - 'poll' - 'checklist' - 'giveaway'
           - 'web_page' - 'paid_media' - 'media';
  IF media IS NOT NULL THEN
    out := out || jsonb_build_object('media', media);
  END IF;
  RETURN out;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- ── 1. Кадры с сообщением ───────────────────────────────────────────────────
-- Проход идёт ПО НАЛИЧИЮ ключа `message`-объекта, а не перечислением типов
-- кадров (урок 0102, 0105 и 0106): перечисление устарело бы при первом же новом
-- кадре с сообщением.
--
-- Кадр, чей подарок не опознан, УДАЛЯЕТСЯ: оставить его в старой форме значило
-- бы вторую форму подарка на проводе, а подделать конструктор нечем. Клиент,
-- чей курсор указывает в удалённый кадр, увидит разрыв pts и переспросит
-- историю — это деградация, а не подмена.
DELETE FROM updates
 WHERE jsonb_typeof(payload->'message') = 'object' AND tl_media_message(payload->'message') IS NULL;
DELETE FROM channel_updates
 WHERE jsonb_typeof(payload->'message') = 'object' AND tl_media_message(payload->'message') IS NULL;

UPDATE updates
   SET payload = jsonb_set(payload, '{message}', tl_media_message(payload->'message'))
 WHERE jsonb_typeof(payload->'message') = 'object';
UPDATE channel_updates
   SET payload = jsonb_set(payload, '{message}', tl_media_message(payload->'message'))
 WHERE jsonb_typeof(payload->'message') = 'object';

-- ── 2. geo_live_update ──────────────────────────────────────────────────────
-- Точка едет ТЕМ ЖЕ конструктором, что и в самом сообщении. Даты сообщения в
-- этом кадре нет, поэтому у остановленной трансляции период нулевой — то есть
-- «истекла», что и означает остановку.
UPDATE updates
   SET payload = (payload - 'geo')
                 || jsonb_build_object('media', tl_geo_media(payload->'geo', NULL, NULL))
 WHERE payload ? 'geo' AND tl_geo_media(payload->'geo', NULL, NULL) IS NOT NULL;
UPDATE channel_updates
   SET payload = (payload - 'geo')
                 || jsonb_build_object('media', tl_geo_media(payload->'geo', NULL, NULL))
 WHERE payload ? 'geo' AND tl_geo_media(payload->'geo', NULL, NULL) IS NOT NULL;

-- ── 3-5. poll_update / checklist_update / giveaway_update ───────────────────
UPDATE updates
   SET payload = (payload - 'poll') || jsonb_build_object('media', tl_poll_media(payload->'poll'))
 WHERE payload ? 'poll' AND tl_poll_media(payload->'poll') IS NOT NULL;
UPDATE channel_updates
   SET payload = (payload - 'poll') || jsonb_build_object('media', tl_poll_media(payload->'poll'))
 WHERE payload ? 'poll' AND tl_poll_media(payload->'poll') IS NOT NULL;

UPDATE updates
   SET payload = (payload - 'checklist') || jsonb_build_object('media', tl_todo_media(payload->'checklist'))
 WHERE payload ? 'checklist' AND tl_todo_media(payload->'checklist') IS NOT NULL;
UPDATE channel_updates
   SET payload = (payload - 'checklist') || jsonb_build_object('media', tl_todo_media(payload->'checklist'))
 WHERE payload ? 'checklist' AND tl_todo_media(payload->'checklist') IS NOT NULL;

-- Номер сообщения-запуска поднимается из messages: у messageMediaGiveawayResults
-- launch_msg_id обязателен, а сам кадр номера не несёт.
UPDATE updates u
   SET payload = (u.payload - 'giveaway')
                 || jsonb_build_object('media', tl_giveaway_media(u.payload->'giveaway',
                      (SELECT m.seq FROM messages m
                        WHERE m.giveaway_id = COALESCE((u.payload->'giveaway'->>'id')::bigint, 0)
                          AND m.deleted_at IS NULL LIMIT 1)))
 WHERE u.payload ? 'giveaway' AND tl_giveaway_media(u.payload->'giveaway', NULL) IS NOT NULL;
UPDATE channel_updates u
   SET payload = (u.payload - 'giveaway')
                 || jsonb_build_object('media', tl_giveaway_media(u.payload->'giveaway',
                      (SELECT m.seq FROM messages m
                        WHERE m.giveaway_id = COALESCE((u.payload->'giveaway'->>'id')::bigint, 0)
                          AND m.deleted_at IS NULL LIMIT 1)))
 WHERE u.payload ? 'giveaway' AND tl_giveaway_media(u.payload->'giveaway', NULL) IS NOT NULL;

DROP FUNCTION tl_media_message(jsonb);
DROP FUNCTION tl_gift_action(jsonb, bigint);
DROP FUNCTION tl_paid_media(jsonb, jsonb);
DROP FUNCTION tl_webpage_media(jsonb);
DROP FUNCTION tl_giveaway_media(jsonb, bigint);
DROP FUNCTION tl_todo_media(jsonb);
DROP FUNCTION tl_poll_media(jsonb);
DROP FUNCTION tl_poll_option(int);
DROP FUNCTION tl_contact_media(jsonb);
DROP FUNCTION tl_geo_media(jsonb, int, int);

-- +goose Down
-- Обратный перевод. ⚠ Восстанавливается ФОРМА, но не всё содержимое, и это
-- названо, а не скрыто:
--   • имя дарителя (from_name) и per-viewer поля розыгрыша (participating,
--     i_won, participants) невосстановимы — их не существует ни в одной другой
--     строке, они и были той склейкой, которую шаг снял;
--   • время отметки чек-листа в плоскую форму не помещается вовсе.
--
-- Кадры, чью старую форму собрать нельзя (подарок сменил конструктор самого
-- сообщения), УДАЛЯЮТСЯ: восстановленный наполовину кадр был бы третьей формой.
-- Клиент переспросит историю.

-- +goose StatementBegin
-- tl_geo_legacy — точка обратно плоским ключом.
--
-- live_stopped выводится из ИСТЁКШЕГО срока — ровно тем же признаком, каким его
-- читает клиент: трансляция остановлена, если date + period уже наступил (у
-- кадра обновления координат даты нет, и признаком служит нулевой период).
--
-- ⚠ ИСХОДНАЯ длительность трансляции при этом не восстанавливается: наверх её
-- заменил укороченный период, и другой строки с ней не существует. Названо
-- здесь, а не скрыто.
CREATE FUNCTION tl_geo_legacy(md jsonb, msg_date int, edit_date int) RETURNS jsonb AS $$
DECLARE period int; stopped boolean;
BEGIN
  IF md IS NULL OR md->>'_' NOT IN ('messageMediaGeo', 'messageMediaGeoLive', 'messageMediaVenue') THEN
    RETURN NULL;
  END IF;
  IF md->>'_' = 'messageMediaGeoLive' THEN
    period := COALESCE((md->>'period')::int, 0);
    stopped := period = 0
               OR (msg_date IS NOT NULL AND edit_date IS NOT NULL AND msg_date + period <= edit_date);
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'lat', (md->'geo'->>'lat')::double precision,
    'lng', (md->'geo'->>'long')::double precision,
    'title', md->>'title',
    'address', md->>'address',
    'live_period', period,
    'live_stopped', stopped,
    'heading', CASE WHEN md ? 'heading' THEN (md->>'heading')::int END));
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION tl_contact_legacy(md jsonb) RETURNS jsonb AS $$
BEGIN
  IF md IS NULL OR md->>'_' <> 'messageMediaContact' THEN RETURN NULL; END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'user_id', (md->>'user_id')::bigint,
    'name', NULLIF(COALESCE(md->>'first_name', ''), ''),
    'phone', NULLIF(COALESCE(md->>'phone_number', ''), '')));
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

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

-- Подарок сменил конструктор сообщения — обратно не разворачивается.
DELETE FROM updates WHERE payload->'message'->'action'->>'_' = 'messageActionStarGift';
DELETE FROM channel_updates WHERE payload->'message'->'action'->>'_' = 'messageActionStarGift';

-- Опрос, чек-лист и розыгрыш обратно не разворачиваются: у плоской формы были
-- поля, которых в конструкторе нет вовсе (participating, i_won, participants).
DELETE FROM updates
 WHERE payload->'media'->>'_' IN ('messageMediaPoll', 'messageMediaToDo',
                                  'messageMediaGiveaway', 'messageMediaGiveawayResults');
DELETE FROM channel_updates
 WHERE payload->'media'->>'_' IN ('messageMediaPoll', 'messageMediaToDo',
                                  'messageMediaGiveaway', 'messageMediaGiveawayResults');
DELETE FROM updates
 WHERE payload->'message'->'media'->>'_' IN ('messageMediaPoll', 'messageMediaToDo',
                                             'messageMediaGiveaway', 'messageMediaGiveawayResults',
                                             'messageMediaPaidMedia');
DELETE FROM channel_updates
 WHERE payload->'message'->'media'->>'_' IN ('messageMediaPoll', 'messageMediaToDo',
                                             'messageMediaGiveaway', 'messageMediaGiveawayResults',
                                             'messageMediaPaidMedia');

-- Гео, визитка и превью ссылки разворачиваются механически.
UPDATE updates
   SET payload = jsonb_set(payload, '{message}',
         ((payload->'message') - 'media'::text) || jsonb_build_object('geo', tl_geo_legacy(payload->'message'->'media',
                       CASE WHEN jsonb_typeof(payload->'message'->'date') = 'number'
                            THEN (payload->'message'->>'date')::int END,
                       CASE WHEN jsonb_typeof(payload->'message'->'edit_date') = 'number'
                            THEN (payload->'message'->>'edit_date')::int END)))
 WHERE tl_geo_legacy(payload->'message'->'media',
                       CASE WHEN jsonb_typeof(payload->'message'->'date') = 'number'
                            THEN (payload->'message'->>'date')::int END,
                       CASE WHEN jsonb_typeof(payload->'message'->'edit_date') = 'number'
                            THEN (payload->'message'->>'edit_date')::int END) IS NOT NULL;
UPDATE channel_updates
   SET payload = jsonb_set(payload, '{message}',
         ((payload->'message') - 'media'::text) || jsonb_build_object('geo', tl_geo_legacy(payload->'message'->'media',
                       CASE WHEN jsonb_typeof(payload->'message'->'date') = 'number'
                            THEN (payload->'message'->>'date')::int END,
                       CASE WHEN jsonb_typeof(payload->'message'->'edit_date') = 'number'
                            THEN (payload->'message'->>'edit_date')::int END)))
 WHERE tl_geo_legacy(payload->'message'->'media',
                       CASE WHEN jsonb_typeof(payload->'message'->'date') = 'number'
                            THEN (payload->'message'->>'date')::int END,
                       CASE WHEN jsonb_typeof(payload->'message'->'edit_date') = 'number'
                            THEN (payload->'message'->>'edit_date')::int END) IS NOT NULL;

UPDATE updates
   SET payload = jsonb_set(payload, '{message}',
         ((payload->'message') - 'media'::text) || jsonb_build_object('contact', tl_contact_legacy(payload->'message'->'media')))
 WHERE tl_contact_legacy(payload->'message'->'media') IS NOT NULL;
UPDATE channel_updates
   SET payload = jsonb_set(payload, '{message}',
         ((payload->'message') - 'media'::text) || jsonb_build_object('contact', tl_contact_legacy(payload->'message'->'media')))
 WHERE tl_contact_legacy(payload->'message'->'media') IS NOT NULL;

UPDATE updates
   SET payload = jsonb_set(payload, '{message}',
         ((payload->'message') - 'media'::text) || jsonb_build_object('web_page', tl_webpage_legacy(payload->'message'->'media')))
 WHERE tl_webpage_legacy(payload->'message'->'media') IS NOT NULL;
UPDATE channel_updates
   SET payload = jsonb_set(payload, '{message}',
         ((payload->'message') - 'media'::text) || jsonb_build_object('web_page', tl_webpage_legacy(payload->'message'->'media')))
 WHERE tl_webpage_legacy(payload->'message'->'media') IS NOT NULL;

UPDATE updates
   SET payload = (payload - 'media') || jsonb_build_object('geo', tl_geo_legacy(payload->'media', NULL, NULL))
 WHERE tl_geo_legacy(payload->'media', NULL, NULL) IS NOT NULL;
UPDATE channel_updates
   SET payload = (payload - 'media') || jsonb_build_object('geo', tl_geo_legacy(payload->'media', NULL, NULL))
 WHERE tl_geo_legacy(payload->'media', NULL, NULL) IS NOT NULL;

DROP FUNCTION tl_webpage_legacy(jsonb);
DROP FUNCTION tl_contact_legacy(jsonb);
DROP FUNCTION tl_geo_legacy(jsonb, int, int);
