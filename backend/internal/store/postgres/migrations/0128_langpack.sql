-- +goose Up
-- Языковой пакет: строки интерфейса, их версия и разница по версии
-- (`langpack.getLangPack`, `getDifference`, `getStrings`, `getLanguages`,
-- `getLanguage`). До сих пор переводы жили ТОЛЬКО в файлах клиента и уезжали в
-- браузер чанком; сервер о них не знал ничего.
--
-- ── Откуда берутся строки (и почему их здесь нет) ──────────────────────────
--
-- Миграция заводит СХЕМУ и не заводит ни одной строки. Это главное решение
-- здесь, и оно про источник данных.
--
-- Переводы правятся в файлах веб-клиента (`src/lang.ts`, `src/i18n/dict.*.ts`)
-- — это их единственный источник. Вписать те же пять тысяч строк сюда значило
-- бы завести ВТОРУЮ копию: правка перевода стала бы правкой в двух местах, а
-- уже применённую миграцию править нельзя вовсе — каждая правка текста требовала
-- бы новой миграции.
--
-- Поэтому строки заливает СИД ПРИ СТАРТЕ (`usecase/langpack.Interactor.Sync`,
-- вызов в app/server.go) из снимка, вшитого в бинарь
-- (`internal/langsource/langpack.gen.json`). Снимок снят с тех же файлов
-- клиента генератором `cmd/langpackgen`; что он не разошёлся с ними, проверяет
-- сторожевой тест `internal/langsource`. Взять файлы клиента прямо в рантайме
-- нельзя: в образе бэкенда каталога `web-client/` нет (контекст сборки —
-- `backend/`).
--
-- Сид идемпотентен и версионирует сам себя: строка, чей текст не изменился, не
-- трогается; изменившаяся получает новую версию языка; ИСЧЕЗНУВШАЯ из словаря
-- помечается deleted и уезжает клиенту конструктором `langPackStringDeleted`.
-- Отсюда и форма таблицы ниже.
--
-- ── Почему счётчиков строк нет колонками ───────────────────────────────────
--
-- `langPackLanguage` объявляет `strings_count` и `translated_count`, но
-- колонками они здесь не лежат: это свойства ТАБЛИЦЫ СТРОК, и отдельная колонка
-- была бы вторым утверждением об одном и том же — она разъехалась бы с самими
-- строками при первом же сиде, который что-нибудь не досчитал. Оба числа
-- считаются запросом (см. LangPackRepo.Languages).

-- Языки пакета. Версия — свойство ЯЗЫКА ЦЕЛИКОМ: клиент присылает её обратно в
-- getDifference, и она обязана расти при любом изменении любой его строки.
CREATE TABLE langpack_languages (
    lang_code      TEXT PRIMARY KEY,
    name           TEXT    NOT NULL,
    native_name    TEXT    NOT NULL,
    -- Язык, из которого берётся строка, если в этом её нет. У самой базы
    -- (английского) пусто — иначе клиент пошёл бы за строкой к самому себе.
    base_lang_code TEXT REFERENCES langpack_languages(lang_code),
    -- Код правил числа CLDR: по нему клиент строит Intl.PluralRules. Совпадает
    -- с lang_code у наших языков, но это свойство языка, а не тождество.
    plural_code    TEXT    NOT NULL,
    rtl            BOOLEAN NOT NULL DEFAULT FALSE,
    version        INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT langpack_languages_base_not_self CHECK (base_lang_code IS DISTINCT FROM lang_code)
);

-- Строки языка. Формы числа — ОТДЕЛЬНЫМИ КОЛОНКАМИ, по одной на форму CLDR, с
-- именами параметров схемы. Склеенные в одну строку с разделителем, они стали бы
-- позиционным списком, порядок которого не проверяет никто, — а формы путают
-- именно так (русское «уведомлений» это CLDR-many, а не «всё остальное»).
--
-- Вид строки не хранится отдельной колонкой: его ОДНОЗНАЧНО задаёт то, что
-- заполнено, и CHECK ниже не даёт заполнить два вида сразу.
--   value        не NULL → langPackString
--   other_value  не NULL → langPackStringPluralized
--   deleted               → langPackStringDeleted
--
-- version — версия языка, В КОТОРОЙ строка последний раз изменилась. Разница от
-- версии N это ровно `version > N`, вместе со снятыми ключами.
CREATE TABLE langpack_strings (
    lang_code   TEXT    NOT NULL REFERENCES langpack_languages(lang_code) ON DELETE CASCADE,
    key         TEXT    NOT NULL,
    value       TEXT,
    zero_value  TEXT,
    one_value   TEXT,
    two_value   TEXT,
    few_value   TEXT,
    many_value  TEXT,
    other_value TEXT,
    deleted     BOOLEAN NOT NULL DEFAULT FALSE,
    version     INTEGER NOT NULL,
    PRIMARY KEY (lang_code, key),
    -- Ровно один вид на строку. Без этой проверки строка с заполненными и
    -- `value`, и `other_value` была бы «и то, и другое» — читающий выбрал бы вид
    -- по порядку своих условий, то есть наугад.
    CONSTRAINT langpack_strings_one_shape CHECK (
        CASE
            WHEN deleted THEN value IS NULL AND other_value IS NULL
                AND zero_value IS NULL AND one_value IS NULL AND two_value IS NULL
                AND few_value IS NULL AND many_value IS NULL
            WHEN value IS NOT NULL THEN other_value IS NULL
                AND zero_value IS NULL AND one_value IS NULL AND two_value IS NULL
                AND few_value IS NULL AND many_value IS NULL
            ELSE other_value IS NOT NULL
        END
    )
);

-- Разницу спрашивают ровно так: строки одного языка новее версии клиента.
CREATE INDEX langpack_strings_version_idx ON langpack_strings (lang_code, version);

-- +goose Down
DROP TABLE langpack_strings;
DROP TABLE langpack_languages;
