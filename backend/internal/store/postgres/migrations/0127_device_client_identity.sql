-- +goose Up
-- Реквизиты клиента у строки устройства — как в `initConnection` MTProto,
-- откуда их берёт витрина сессий (конструктор `authorization`):
-- device_model (колонка name) — браузер, system_version — ОС, app_version —
-- версия сборки клиента.
--
-- Раньше браузер и ОС склеивались в name на входе («Chrome · macOS»), и витрина
-- не могла отдать их разными параметрами: экран рисовал «Chrome · macOS, web»
-- вместо «Chrome, macOS». Поэтому у уже существующих строк шов РАСКЛЕИВАЕТСЯ
-- обратно, а не заполняется пустотой: обе половины настоящие, их сюда и писали.
--
-- Даты создания сессии эта миграция не заводит: колонка devices.created_at есть
-- с первой миграции и всегда заполнялась DEFAULT now() — у каждой строки уже
-- лежит настоящий момент входа, подставлять ничего не нужно.
ALTER TABLE devices ADD COLUMN system_version TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN app_version    TEXT NOT NULL DEFAULT '';

UPDATE devices
   SET system_version = split_part(name, ' · ', 2),
       name           = split_part(name, ' · ', 1)
 WHERE name LIKE '% · %';

-- +goose Down
UPDATE devices
   SET name = name || ' · ' || system_version
 WHERE system_version <> '';

ALTER TABLE devices DROP COLUMN app_version;
ALTER TABLE devices DROP COLUMN system_version;
