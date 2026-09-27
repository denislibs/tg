# Обои и облачные темы, 1:1 с tweb `812502980` — план реализации (бэкенд + клиент)

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ СУБ-СКИЛЛ: `superpowers:subagent-driven-development`.
> Шаги помечены чекбоксами (`- [ ]`). Перед каждой клиентской задачей — скилл `tweb-parity`.

**Цель:** обои и темы приложения устроены как у tweb. Сервер отдаёт **каталоги** — обои
(`account.getWallPapers`, `account.getWallPaper`), загрузку своего фото (`account.uploadWallPaper`) и
облачные темы (`account.getThemes`); клиент **хранит выбор** в `settings.themes[]` — по записи
`AppTheme` на имя темы, в каждой — `ThemeSettings` на базовую тему (акцент, цвета исходящих, обои).
Цвета приложения выводит `themeController.applyTheme` оригинала (акцент, `message_colors`, tinted-
деривация). Вкладки «Обои», «Цвет», «Общие» (карусель тем и ряд акцентов) — дословные порты. Адаптер
нашей плоской модели обоев к форме tweb (`web-client/src/wallpapers.ts`) и клиентский набор тем чата
(`chatThemes.ts`) **удаляются**.

**Что закрывает:** О-11 («нет серверных обоев») и О-38 («карусель облачных тем») плана 2D
(`2026-09-26-wave-2d-settings-rowtsx.md`, таблица «Отложено»); О-39 (тема чата — клиентская `ChatTheme`)
и О-40 (файл обоев — медиа-конвейер) из шапки `chatBackground.solid.tsx` PR #324.

**Оригинал:** `/Users/denisurevic/Documents/tweb`, коммит **`812502980`** (все адреса — по нему).
**Разбор с адресами — [`docs/tweb/wallpapers-themes.md`](../../tweb/wallpapers-themes.md)** (модель
TL, `settings.themes[]`, `appThemesManager`, `themeController`, вкладки, `chatBackgroundStore`,
карусель, что читает `<ChatBackground>`, «у нас», чеклист). Решение о проводе —
[`docs/readiness/tl-program.md`](../../readiness/tl-program.md) (структуры 1:1 с MTProto, `pFlags`,
«Чего НЕ копируем»).

**Предусловие:** PR #324 (`feat/solid-chat-background`, фон чата на Solid) влит. Компонент
`<ChatBackground>` и синглтон `appChatBackground` программа НЕ меняет: заменяется только адаптерный
кусок того же файла (`chatBackground.solid.tsx:150-182`, `:673-691` в #324) и `core/chat/chatBackgroundStore.ts`.

---

## Поправки к постановке (проверены в исходниках)

1. **Ссылок `t.me/bg/…` у tweb нет** — ни типа в `lib/internalLink.ts:5-32`, ни разбора в
   `internalLinkProcessor.ts`. Задачи на них нет; `account.getWallPaper` зовут только
   `chatBackgroundStore.getBackground` на промахе кэша (`lib/chatBackgroundStore.ts:125`) и обновление
   file reference (`lib/storages/references.ts:284-285`) — второе транспорт MTProto, у нас предмета нет.
   Ручка «обои по slug/id» всё равно нужна — первому вызывающему (задача 5). Ссылки — О-2.
2. **Тему одному чату tweb не ставит** (`messages.setChatTheme` — только схема); он её показывает:
   эмодзи из карточки ищется среди облачных тем (`chat/chat.ts:517-540`). Наш React-попап
   `ChatThemesPicker.tsx` + `PUT /chats/{peer}/theme` пары не имеет — решение пользователя (Р4, О-4).
3. **Карусель тем в 2D не портировалась**, хотя 2C-17 («Мой QR») ссылается на
   «`chatThemesPicker.solid.tsx` 2D-13». Карусель заводит эта программа (задача 18); 2C-17 ждёт её.
4. **Хэш каталогов — в теле, а не в заголовках.** Решение Р7 разбора стикеров
   (`backend/internal/domain/mtstickerset.go:15-18`) отложило `hash`/`*NotModified` до бинарного провода
   и отдало «не менялось» заголовкам REST. Провод REST на TL уже работает (`tl-program.md`, фаза 3 шаг D),
   а портируемый менеджер ждёт хэш в ПАРАМЕТРЕ и `*NotModified` в ОТВЕТЕ (`appThemesManager.ts:107-111`,
   `apiManagerMethods.ts:99-155`). Здесь хэш производится по схеме (решение Р3; подтвердить у
   пользователя, т.к. это первое отступление от Р7).
5. **`access_hash` не производится** (`tl-program.md`, «Чего НЕ копируем»): `wallPaper.access_hash` и
   `theme.access_hash` — заглушки `OmittedWithoutSubject`; `inputWallPaper` адресует по `id`.
6. **Наш `config/themePresets.ts` — не пресеты tweb.** В нём `appColorMap`/`colorMap`, которые у tweb
   живут в `helpers/themeController.ts:44-189`. Задача 10 возвращает их туда, а имя файла отдаёт порту
   пресетов акцента (`config/themePresets.ts` tweb, 281).

## Решения, которые нужны от пользователя (до задачи 6)

| № | Вопрос | Рекомендация | Почему |
|---|---|---|---|
| **Р1** | Откуда узоры каталога обоев | **Один узор — `pattern.svg` из ассетов tweb** (`public/assets/img/pattern.svg`, у нас уже `web-client/src/assets/pattern.svg`), упакованный в `.tgv`; разнообразие — цветами. Цвета — только из кода клиентов: `DEFAULT_THEME` (`config/state.ts:305-429`), обои пресетов акцента (`config/themePresets.ts:33-62`, `:91-103`, порт `ThemeColorPresets.swift` iOS) и наши `WALLPAPER_PRESETS` (`wallpapers.ts:33-46`). Фото-обоев нет (О-8) | каталог сервера Telegram не копируется; узор уже распространяется с клиентом под той же лицензией, что весь порт (GPL-3.0 tweb), новых чужих файлов в репозитории не появляется. Альтернатива — свои узоры (нужен художник, SVG ≤ 8 МиБ после распаковки) — меняет только ассет, не код |
| **Р2** | Откуда облачные темы | **Наши 8 тем из `chatThemes.ts`** переезжают в засев сервера как `theme` с `emoticon`, двумя базами (`baseThemeClassic` ← `light`, `baseThemeNight` ← `dark`) и `pFlags.default`; `tinted` клиент смешивает сам (`chatThemesPicker.tsx:209-220`, `applyNewTheme` `:688-690`) | данные уже наши и уже у пользователей; тема чата продолжит работать тем же эмодзи |
| **Р3** | Хэш каталогов | в теле, по схеме (поправка 4) | порт менеджера без переходника |
| **Р4** | Наш попап темы ОДНОГО чата (`ChatThemesPicker.tsx`, пары в tweb нет) | **оставить** как объявленное отступление, но список — из `getThemes`, запись — эмодзи (задача 20) | функция есть на бэкенде и у пользователей; снос — отдельное решение |

## Что у нас уже есть и переиспользуется

Бэкенд: `media` + MinIO и `usecasemedia.CreateUpload`/`PutContent` (`cmd/seed-stickers/main.go:86-105`),
`domain.BuildDocument` (`mtmedia.go:738`), `/media/upload` + `/media/{id}/content` (`router.go:81`,
`:386-393`), сверка со схемой `schemaChecker` + `OmittedWithoutSubject` (`*_schema_test.go`), кодек TL и
провод `Accept: application/x-tl` (фаза 3 D), `domain.ServiceUserID`, таблица `chat_theme`
(`0060_chat_theme.sql`), кадр `updateChatTheme` (`mtupdate.go:933-948`).

Клиент: `@layer` (`WallPaper`, `Theme`, `ThemeSettings`, `AccountWallPapers`, `AccountThemes` уже
сгенерированы), `<ChatBackground>`/`appChatBackground` (#324), `core/chat/{patternRenderer,gradientRenderer}.ts`,
`helpers/blur.ts`, `shared/lib/averageColor.ts`, `shared/lib/color.ts` (`getColorsFromWallPaper`,
`highlightingColor`), `stores/appState.ts` (порт, персист воркером), `stores/appSettings.solid.ts`
(мост `useAppSettings`), `core/managers/*` + `net/restClient`, `core/media/messageMedia.saveDocument`,
`core/stickers/tgs` (gzip с лимитом, f3733adc2), `components/scrollable.ts::ScrollableX`,
`helpers/dom/markGridCornerItem.ts`, `components/preloader` (`ProgressivePreloader`),
`components/wrappers/stickerEmoji.ts`, `core/lazyLoadQueue.ts`, вкладки 2D-12/13 (Solid, в слайдере).

## Чего нет и что заводится

Бэкенд: `domain/mtwallpaper.go`, `domain/mttheme.go`, `domain/tlhash.go`, таблицы `wallpapers`,
`themes`, `theme_settings`, `usecase/themes/*`, `repo/postgres/themesrepo.go`,
`delivery/http/themes_handler.go`, `cmd/seed-wallpapers`, `assets/wallpapers/{pattern.svg,meta.json}`,
`assets/themes/meta.json`.

Клиент: `config/state.ts`-часть (`DEFAULT_THEME`, `AppTheme`, `makeDefaultAppTheme`), порт
`config/themePresets.ts`, класс-модуль `themeController` в объёме § 4 референса, `core/managers/themesManager.ts`
(порт `appThemesManager`), хэш-кэш запросов (порт `invokeApiHashable`), `uncompressTGV` в конвейере,
порт `lib/chatBackgroundStore.ts` целиком, `components/chatThemesPicker.solid.tsx`,
`styles/tweb/_themes.scss`, `helpers/solid/animations.solid.tsx` (`GrowHeightReveal`),
`helpers/dom/attachListNavigation.ts` (`attachPickerGrid`).

## Global Constraints

- **Источник порта — файл tweb `812502980`, а не наш код** (память «порт якорить на tweb»). Наш
  адаптер и `chatThemes.ts` — только список сценариев миграции, их форма в порт не переносится.
- **Структуры провода — конструкторы схемы** (`tl-program.md`): `_`, `pFlags` с литералом `true`,
  отсутствие = нет ключа; своё — только через `schema_additional_params.json`. Каждая новая структура
  бэкенда — в сверке `*_schema_test.go`; клиент читает `@layer`, мапперов нет.
- **Бэкенд — `domain ← usecase ← adapter`** (`backend/CLAUDE.md`): SQL и chi — не в usecase, порты — в
  `ports.go`, ошибки — `domain/errors.go`; миграции — следующий свободный номер (на 2026-09-27 последний
  `0132`), применённые не правятся; jsonb через `string(json)`.
- **Выбор — на клиенте.** Ни одной ручки «сохранить выбор обоев/темы» не заводится (у tweb их не зовут;
  § 1 референса). Сервер не знает, что выбрал пользователь, кроме темы чата (Р4).
- **Каталог Telegram не копируется** — ни файлы, ни slug, ни цвета серверных обоев (Р1).
- **Врезка — последовательно, порт — параллельно.** Новые файлы пишутся параллельно; правки общих
  (`app/server.go`, `router.go`, `settings.tsx`, `stores/appSettings.solid.ts`, `client/boot.ts`,
  `styles/tweb/_index.scss`, `lang.ts`/`i18n/dict.*`) — последним коммитом задачи, ребейз на свежий `main`.
- **Никакого `git add -A` и `git stash`** — только явные пути: рядом работают другие агенты.
- **Пины — на результат**: CSS-переменные на элементе, объект обоев в `settings.themes[]`, тело ответа
  ручки и `*NotModified`, сетевой вызов по клику, классы плиток — не «функцию позвали». Каждая задача —
  с мутацией, которая краснеет (вывод — в теле коммита).
- **Проверки:** бэкенд — `go vet ./... && gofmt -l . && go test ./...` (интеграционные — Docker);
  клиент — из `web-client/`: `npx vitest run`, `npx tsc --noEmit`, `npx oxlint --type-aware`.
- **Строки langpack — ключами tweb** (`ChatBackground.UploadWallpaper`, `SetColor`, `Appearance.Reset`,
  `ChatBackground.Blur`, `ColorTheme`, `ThemeDay`/`ThemeNight`/`ThemeLight`/`ThemeTinted`, …): нет
  ключа — из tweb `src/lang.ts` дословно.
- **Комментарии и коммиты — по-русски**, объяснять ПОЧЕМУ; шапка порта — `порт tweb/src/…:строки`,
  расхождения — нумерованным списком. Нет предмета на бэкенде — `// О-n обои` у строки.
- **Каждая задача обновляет «у нас»** в `docs/tweb/wallpapers-themes.md` § 9 в том же PR.

---

## Порядок и зависимости

```
ПАКЕТ Б — БЭКЕНД
  1 модель TL: WallPaper*, Theme*, хэш (—)
  2 миграции: wallpapers, themes, theme_settings (1)
  3 usecase+repo обоев: каталог+свои, хэш, по slug/id, загрузка (2)  ─┐ один пакет usecase/themes:
  4 usecase+repo тем: каталог, хэш (2)                                ─┘ порт — параллельно, ports.go — по очереди
  5 HTTP: 4 ручки, провод TL, wiring (3, 4)
  6 cmd/seed-wallpapers + ассеты (3, 4; Р1, Р2)
  7 тема чата — эмодзи облачной темы (4, 6; Р4)
ПАКЕТ К0 — КЛИЕНТ, БАЗА (параллельно между собой и с пакетом Б)
  8 узор .tgv в медиа-конвейере (—)
  9 модель выбора: AppTheme, DEFAULT_THEME, settings.themes[], миграция старых ключей (—)
 10 пресеты акцента → config/themePresets.ts; colorMap → themeController (—)
 11 themeController.applyTheme: акцент, tinted, message_colors (10)
 12 themeController: getTheme/getThemeSettings/applyNewTheme/пресеты/сброс/setWallpaperForCurrentTheme (9, 11)
 13 воркер: themesManager (порт appThemesManager) + хэш-кэш + accountThemes + загрузка фото (1; контракт 5)
 14 chatBackgroundStore — порт целиком (8, 13)
ПАКЕТ К1 — ПЕРЕКЛЮЧЕНИЕ (одна ветка, в main — одним PR)
 15 переключение: миграция включена, старые ключи и адаптер сняты (12, 14, #324)
 16 «Обои» дословно (12, 13, 14)       ─┐ пишутся в ветку 15
 17 «Цвет» дословно (12)               ─┘
ПАКЕТ К2 — ОБЛАЧНЫЕ ТЕМЫ
 18 chatThemesPicker.solid.tsx + _themes.scss + attachPickerGrid (12, 13)   → 2C-17
 19 «Общие»: карусель, ряд акцентов, прогрев (15, 18)
 20 тема чата из облачных тем; снос chatThemes.ts и deriveChatThemeVars (7, 12, 15; Р4)
ФИНАЛ
 21 итог программы: инварианты, доки, «у нас» (все)
```

**Что параллелится (непересекающиеся файлы):**

- Бэкенд 1 — первым; 3 и 4 — параллельно (файлы `wallpapers.go`/`themes.go` пакета `usecase/themes`,
  `ports.go` и `themesrepo.go` — по очереди), 6 — параллельно с 5.
- Клиент 8, 9, 10 — сразу, параллельно с бэкендом (нужны только `@layer` и tweb); 13 — после 1 на
  фикстурах из сверок схемы, врезка — после 5.
- 15, 16, 17 — одна ветка `feat/wallpapers-switch`: 16 и 17 пишутся параллельно, в `main` уходят одним PR
  с 15 (иначе в `main` окажется состояние, где вкладки пишут старые ключи, а фон читает новые).
- 18 — параллельно с 15–17 (новые файлы); 19 и 20 — после 15.

## Что нужно другим программам

| Кому | Что | Задача здесь |
|---|---|---|
| 2C-17 «Мой QR» (`popups/myQrCode.tsx:139`, `:162-163`) | `appThemesManager.getThemes()` и `<ChatThemesPicker selectedId baseTheme onSelect>` | 13, 18 (поправка 3) |
| 2D-13 «Общие» | расхождения 1, 2, 5 шапки `generalSettings.solid.tsx` | 19 |
| 2D О-37 Increase Contrast | ветка `increaseContrast` `applyAppColor` (`themeController.ts:576-599`) ложится на `applyAppColor` задачи 11 | 11 (без ветки — О-3) |
| программа ленты / колонки чата | `applyTheme(theme, container)` для темы чата (`chat.ts:372-376`) | 11, 20 |
| подсказки пустой колонки (`chatTips/appearanceCard.tsx`) — подсистемы у нас нет | карусель | 18 (О-5) |

---

## Пакет Б — бэкенд

### Задача 1: модель TL — обои, темы, хэш

**Порт (модель):** `backend/internal/domain/mtwallpaper.go` — `WallPaper` (объединение: `wallPaper`,
`wallPaperNoFile`), `WallPaperSettings`, `InputWallPaper` (`inputWallPaper`/`inputWallPaperSlug`/
`inputWallPaperNoFile` — разбор входа), `AccountWallPapers` (`account.wallPapers`,
`account.wallPapersNotModified`); `domain/mttheme.go` — `Theme`, `ThemeSettings`, `BaseTheme`
(`baseThemeClassic`/`Day`/`Night`/`Tinted`; `Arctic` не производится), `AccountThemes`
(`account.themes`, `account.themesNotModified`). Поля и флаги — по схеме (референс § 1); `pFlags`:
`creator`, `default`, `pattern`, `dark` у обоев, `blur`, `motion` у настроек, `creator`, `default`,
`for_chat` у темы, `message_colors_animated` у записи. `document` — `*Document` из `mtmedia.go`.
**Заглушки** (`OmittedWithoutSubject`): `wallPaper.access_hash`, `theme.access_hash`,
`theme.installs_count`, `theme.document` (темы-файлов нет). `domain/tlhash.go` — хэш списка по алгоритму
Telegram (`core.telegram.org/api/offsets`, «Hash generation»: для каждого числа
`h ^= h >> 21; h ^= h << 35; h ^= h >> 4; h += n`, int64 с переполнением) — одна функция на оба каталога.

- [ ] **Шаг 1:** прочитать схему (`schema/schema.json`, конструкторы § 1 референса), `mtstickerset.go`
  (образец контейнеров и заглушек), `mtstickerset_schema_test.go`.
- [ ] **Шаг 2: падающие тесты:** `mtwallpaper_schema_test.go`, `mttheme_schema_test.go` — `schemaChecker`
  обходит `account.wallPapers{wallPaper(pattern, settings 4 цвета, document), wallPaperNoFile}` и
  `account.themes{theme{settings: [classic, night]}}`, неожиданных полей нет, заглушки только
  объявленные; `pFlags.pattern=false` — ошибка кодека (круг TL: модель → байты → модель совпадает);
  `tlhash`: хэш `[]` = 0, порядок важен (`[1,2] ≠ [2,1]`), эталон на три числа, посчитанный
  независимо (значение — в тесте с выкладкой).
- [ ] **Шаг 3:** падают. **Мутация:** убрать `h ^= h << 35` — эталон краснеет; выложить `pattern` на
  верхний уровень — сверка краснеет.
- [ ] **Шаг 4:** реализовать; `go vet`, `gofmt`.

**Готово когда:** обе сверки зелёные, круг TL `account.wallPapers`/`account.themes` сходится байт в байт.

### Задача 2: миграции

**Порт:** `NNNN_wallpapers_themes.sql` (goose):

- `wallpapers(id BIGSERIAL PK, slug TEXT UNIQUE NOT NULL, creator_id BIGINT NULL REFERENCES users ON
  DELETE CASCADE /* NULL — каталог */, media_id BIGINT NULL REFERENCES media /* NULL — wallPaperNoFile */,
  is_pattern BOOL, is_dark BOOL, is_default BOOL, in_catalog BOOL /* false — обои темы, в списке не
  видны */, settings JSONB /* WallPaperSettings схемы */, position INT, updated_at TIMESTAMPTZ)`;
  индекс `(creator_id, id)`, частичный по `in_catalog`;
- `themes(id BIGSERIAL PK, slug TEXT UNIQUE, title TEXT, emoticon TEXT UNIQUE NOT NULL, is_default BOOL,
  position INT, updated_at)`;
- `theme_settings(theme_id → themes ON DELETE CASCADE, base_theme TEXT CHECK IN ('baseThemeClassic',
  'baseThemeDay','baseThemeNight','baseThemeTinted'), accent_color INT, outbox_accent_color INT NULL,
  message_colors INT[], message_colors_animated BOOL, wallpaper_id → wallpapers NULL, PK(theme_id, base_theme))`.

- [ ] **Шаг 1:** посмотреть последний номер (`ls internal/store/postgres/migrations | tail`) и образец
  `0060_chat_theme.sql`.
- [ ] **Шаг 2: падающий тест** (testcontainers): `goose up` → вставка каталожных и своих обоев,
  повтор slug — ошибка уникальности; `goose down` чистый.
- [ ] **Шаг 3:** **мутация:** снять `UNIQUE` со `slug` — тест краснеет.

**Готово когда:** миграция применяется на старте, `down` откатывает без следов.

### Задача 3: usecase и репозиторий обоев

**Порт (поведение сервера, которого ждёт клиент):** пакет `usecase/themes` (по образцу tweb — один
менеджер на обои и темы), файл `wallpapers.go`:

- `ListWallPapers(user, hash) → AccountWallPapers`: каталог (`in_catalog`, по `position`) + свои
  загруженные (`creator_id = user`, новые первыми, `pFlags.creator`); хэш — `tlhash` по парам
  `(id, updated_at)`; совпал — `account.wallPapersNotModified`;
- `GetWallPaper(user, InputWallPaper)`: по slug — каталог, обои тем и свои; чужие загруженные — `ErrNotFound`
  (ссылок нет, поправка 1; О-2); по id — то же; `inputWallPaperNoFile` — каталожный `wallPaperNoFile`;
- `UploadWallPaper(user, mediaID, mime, settings)`: медиа — своё (`ErrForbidden`), готовое, mime
  `image/jpeg`|`image/png` (клиент PNG перекодирует сам, `background.tsx:390-402`); настройки
  санитизируются (цвета 0..0xFFFFFF, интенсивность −100..100, `emoticon` ≤ 16 байт, флаги — только
  `blur`/`motion`); slug — случайный base62 ≥ 16 символов; лимит своих обоев на пользователя
  (константа в `domain`, старые сверх лимита удаляются).

Документ обоев — `BuildDocument` медиа с атрибутами `documentAttributeFilename` (+
`documentAttributeImageSize` у фото); узор — mime `application/x-tgwallpattern`.

- [ ] **Шаг 2: падающие тесты** (фейк-порт репо + интеграционный на testcontainers): порядок и состав
  списка; второй вызов с хэшем первого → `NotModified`; правка `settings` каталожных обоев (новый
  `updated_at`) → хэш другой; чужое медиа → `ErrForbidden`; `settings.pFlags.pattern` из запроса
  отброшен; slug по ответу открывается `GetWallPaper(slug)` автором и не открывается другим.
- [ ] **Шаг 3:** **мутации:** хэш без `updated_at` — тест «правка меняет хэш» краснеет; без фильтра
  `creator_id` — тест чужого slug краснеет.

**Готово когда:** все ветки ответа покрыты; usecase не импортирует `pgx`/`chi`.

### Задача 4: usecase и репозиторий тем

**Порт:** `usecase/themes/themes.go` — `ListThemes(user, format, hash) → AccountThemes`: все темы по
`position`, у каждой `settings[]` по базам с развёрнутыми `wallpaper` (обои тем, `in_catalog = false`);
`format` принимается и игнорируется (файлов тем нет; tweb шлёт `'macos'`); хэш — `tlhash` по
`(id, updated_at)` тем и их обоев. `ThemeByEmoticon(emoticon)` — для задачи 7.

- [ ] **Шаг 2: падающие тесты:** тема с двумя базами — две записи с обоями; хэш совпал → `NotModified`;
  правка обоев темы меняет хэш.
- [ ] **Шаг 3:** **мутация:** хэш только по темам — «правка обоев меняет хэш» краснеет.

### Задача 5: HTTP — четыре ручки, провод, сборка

**Порт:** `delivery/http/themes_handler.go`, маршруты в защищённой группе `router.go`:

| Метод tweb | Ручка | Ответ |
|---|---|---|
| `account.getWallPapers{hash}` | `GET /wallpapers?hash=` | `account.wallPapers` \| `account.wallPapersNotModified` |
| `account.getWallPaper{inputWallPaperSlug}` | `GET /wallpapers/slug/{slug}` | `WallPaper` |
| `account.getWallPaper{inputWallPaper \| inputWallPaperNoFile}` | `GET /wallpapers/{id}` | `WallPaper` |
| `account.uploadWallPaper{file, mime_type, settings}` | `POST /wallpapers` `{media_id, mime_type, settings: wallPaperSettings}` (файл — через `/media/upload`, как `/me/photos`; `InputFile` не копируется) | `WallPaper` |
| `account.getThemes{format, hash}` | `GET /themes?format=&hash=` | `account.themes` \| `account.themesNotModified` |

`hash` — строка десятичного int64 (как `long` схемы на JSON-проводе). Ошибки — `domain/errors.go` → HTTP.
Wiring — `app/server.go` (репо → usecase → хендлер), параметр `NewRouter`.

- [ ] **Шаг 2: падающие тесты** (`themes_handler_test.go`, testcontainers): каждая ручка — тело по схеме
  на JSON и на `Accept: application/x-tl` (разбор неизменённым десериализатором из `schema/testdata`,
  как у стикеров); `hash` прошлого ответа → `NotModified`; `POST` чужого медиа → 403; без токена → 401.
- [ ] **Шаг 3:** **мутация:** не передать `hash` из query в usecase — тест `NotModified` краснеет.
- [ ] **Шаг 4:** `backend/README.md` — ручки в таблицу API.

**Готово когда:** ручки живые на стенде (`curl` с токеном — в коммите), провод TL разбирается.

### Задача 6: `cmd/seed-wallpapers` и ассеты (Р1, Р2)

**Порт (образец — `cmd/seed-stickers`):** `backend/cmd/seed-wallpapers/main.go` — идемпотентный засев
каталога обоев и тем из `backend/assets/wallpapers/` и `backend/assets/themes/`:

- `assets/wallpapers/pattern.svg` — копия узора tweb (`public/assets/img/pattern.svg`, Р1); засев
  сжимает его gzip → `.tgv`, заливает ОДИН раз медиа от `domain.ServiceUserID` (`CreateUpload` +
  `PutContent`, `main.go:86-105` стикеров), mime `application/x-tgwallpattern`;
- `assets/wallpapers/meta.json` — список `{slug, pattern: bool, dark: bool, settings: {intensity,
  background_color, second_…, third_…, fourth_…}}` в порядке показа. Состав (Р1): 4 обоев
  `DEFAULT_THEME` (`config/state.ts:315-423`), кураторские пресеты с обоями (`themePresets.ts:33-42`,
  `:53-62`), 9 `TINTED_BASE_WALLPAPERS` (`:91-103`, тёмные, `intensity` со знаком минус), наши 12
  `WALLPAPER_PRESETS` (`wallpapers.ts:33-46`, светлые, `intensity 50`); повторы цветов снимаются;
  slug — наш (`pattern-<имя>`), НЕ `pattern` (это встроенный узор клиента, `config/app.ts:12`);
- `assets/themes/meta.json` — 8 тем из `chatThemes.ts` (Р2): `{emoticon, title, settings: [{base_theme:
  'baseThemeClassic', accent_color, message_colors, wallpaper: {colors, intensity: 50}}, {base_theme:
  'baseThemeNight', …, intensity: -50, dark: true}]}`; обои тем создаются с `in_catalog = false`.

Идемпотентность — по `slug` обоев и `emoticon` темы: существующее обновляется (цвета, порядок,
`updated_at` — хэш меняется), новое добавляется, пропавшее из `meta.json` не удаляется (своих обоев оно
не касается). Запуск — как у стикеров (`backend/README.md:221-222`).

- [ ] **Шаг 2: падающие тесты** (`main_test.go` на фейках, как у стикеров): узор заливается один раз на
  два прогона; второй прогон без изменений не трогает `updated_at`; смена цвета в `meta.json` — трогает;
  темы — по одной записи на базу.
- [ ] **Шаг 3:** **мутация:** заливать узор на каждый slug — тест «один раз» краснеет.

**Готово когда:** на стенде `GET /wallpapers` отдаёт каталог, `GET /themes` — 8 тем; узор скачивается
и распаковывается в SVG (`gunzip` — в коммите).

### Задача 7: тема чата — эмодзи облачной темы (Р4)

**Что делаем.** `chat_theme.theme_id` хранит id клиентского пресета (`sky`, `sunrise`, …,
`0060_chat_theme.sql:3-4`); у tweb тема чата — `emoticon` (`chatFull/channelFull.theme_emoticon`,
`userFull.theme{emoticon}`). Миграция переписывает строки по таблице `chatThemes.ts` (`sky → 🏝`,
`sunrise → 🐥`, `ice → ⛄`, `tulip → 🌷`, `diamond → 💎`, `gold → 🌟`, `forest → 🎄`, `arcade → 🎮`),
неизвестные — удаляет; колонка остаётся `theme_id` (её читает кадр `updateChatTheme`, свой конструктор).
`SetChatTheme` принимает только эмодзи темы из каталога (`ThemeByEmoticon`, `ErrNotFound`).

- [ ] **Шаг 2: падающие тесты:** миграция на живом Postgres (`sky` → `🏝`, мусор — удалён);
  `PUT /chats/{peer}/theme {theme_id: '🏝'}` — 200, `{theme_id: 'nope'}` — 404; карточка несёт эмодзи.
- [ ] **Шаг 3:** **мутация:** снять проверку по каталогу — тест 404 краснеет.
- [ ] **Шаг 4:** `docs/readiness/port-divergences.md:504` — строка про `theme_emoticon`: «id пресета» →
  «эмодзи облачной темы».

**Зависимости:** 4, 6. **Врезка — одновременно с задачей 20** (клиент шлёт эмодзи).

---

## Пакет К0 — клиент, база

### Задача 8: узор `.tgv` в медиа-конвейере

**Порт:** `apiFileManager.getConvertMethod` (`:686-689`) + `uncompressTGV` (`:543-557`): документ
`application/x-tgwallpattern` на скачивании распаковывается в `image/svg+xml`, лимит
`TGV_MAX_DECOMPRESSED_SIZE = 8 МиБ` (`:95`), на Firefox — `fixFirefoxSvg`. Распаковка — тем же
gzip-с-лимитом, что `core/stickers/tgs` (f3733adc2), в том же месте конвейера, где у нас выбирается
преобразование стикера (найти `git grep -n "x-tgsticker" web-client/src/core`). `fixFirefoxSvg` —
порт, если его нет.

- [ ] **Шаг 2: падающие тесты:** gzip-SVG с mime узора → blob `image/svg+xml` с исходным текстом;
  распаковка больше лимита — ошибка, не бесконечная память.
- [ ] **Шаг 3:** **мутация:** убрать ветку mime — тест краснеет.

### Задача 9: модель выбора — `settings.themes[]` и миграция сохранённого

**Порт (`config/state.ts`):** типы `AppThemeSettings` (`:43-45`), `AppTheme` (`:47-50`),
`DEFAULT_THEME` (`:305-429`, `TINTED_DEFAULT_PRESET` `:22` — после задачи 10, до неё — литералом с
пометкой), `DEFAULT_HIGHLIGHTING_COLORS` (`:434-439`), `makeDefaultAppTheme` (`:441-450`), в умолчания
`SETTINGS_INIT.themes`/`lastThemeNames` (`:500-511`). Файл — `web-client/src/config/state.ts` (новый;
наши `DEFAULTS` в `settings.tsx` ссылаются на него). zustand `Settings` получает ключи `themes: AppTheme[]`
и `lastThemeNames`; `themeChoice` остаётся нашим именем `settings.theme` (его читает ~38 мест).
Мост `useAppSettings` — пути `themes`, `lastThemeNames`; `theme` ↔ `themeChoice` (кодек уже есть или
заводится).

**Миграция сохранённого** — функция `migrateWallpaperSettings(stored) → AppTheme[]` (чистая, тестируемая),
которую ВКЛЮЧИТ задача 15. Старая модель — одни обои на все темы, поэтому результат — `SETTINGS_INIT.themes`,
где у каждой из четырёх тем в записи ЕЁ базы обои заменены:

| Было (`settings.tsx:19-26`) | Станет в записи базы |
|---|---|
| `wallpaper: {kind: 'default'}` | не трогается (фабричные обои `DEFAULT_THEME`) |
| `{kind: 'preset', colors}` | `wallPaper{id: '', slug: 'pattern', pFlags: {default, pattern[, dark]}, settings: {colors, intensity умолчания базы}}` — встроенный узор, та же форма, что `DEFAULT_THEME` и пресеты акцента (`themePresets.ts:240-266`) |
| `{kind: 'color', color}` | `wallPaperNoFile{id: 0, settings.background_color}` — как «Цвет» (`backgroundColor.tsx:67-76`) |
| `customWallpaperMediaId` (+`customWallpaperBlur`) | запись не меняется сразу; id медиа уходит в `pendingWallPaperUpload` — одноразовый ключ, который задача 16 превращает в серверные обои (`POST /wallpapers {media_id}`, байты не перезаливаются) и пишет `setWallpaperForCurrentTheme` во ВСЕ четыре темы; сбой — ключ остаётся до следующего старта |

`highlightingColor` — `DEFAULT_HIGHLIGHTING_COLORS` базы (пересчитается при первом показе). Уже есть
`themes` — миграция не зовётся (идемпотентность, как `MIGRATE_THEMES` `loadState.ts:180-197`); форма
«`settings` объектом» оборачивается в массив (там же).

- [ ] **Шаг 2: падающие тесты** (`config/state.test.ts`, `settings.migration.test.ts` — дополнить):
  четыре строки таблицы на все четыре базы; повторный вызов с `themes` — без изменений; объект
  `settings` → массив; `DEFAULT_THEME` — побайтово значения tweb (таблица из `state.ts`).
- [ ] **Шаг 3:** **мутация:** класть обои пресета только в `day` — тест «все базы» краснеет.

**Готово когда:** функция и ключи есть, старые ключи ещё живы (снимет задача 15).

### Задача 10: пресеты акцента и `colorMap`

**Порт:** `config/themePresets.ts` tweb (281) дословно — `AccentPreset`, пресеты баз, `TINTED_BASE_WALLPAPERS`,
`nearestTintedBaseColor`, `blendWallpaperForTinted`, `getAccentPresetsForBase`, `presetToThemeSettings`,
`presetThemeId`. Наш нынешний `config/themePresets.ts` (`appColorMap`, `colorMap`, `presetToColorMap`,
`DEFAULT_HIGHLIGHTING_COLORS`) переезжает в `core/theme/themeController.ts` (у tweb `:44-189`),
`DEFAULT_HIGHLIGHTING_COLORS` — в `config/state.ts` (задача 9). Потребители — переписать импорты
(`git grep -n "config/themePresets" web-client/src`).

- [ ] **Шаг 2: падающие тесты:** число пресетов по базам (Classic 16, Night 11, Day 13, Tinted 9);
  `blendWallpaperForTinted` — эталонный цвет смеси 85/15 и `dark: true`; `presetToThemeSettings` на
  Tinted несёт обои, на Day — нет.
- [ ] **Шаг 3:** **мутация:** `BASE_WEIGHT = 0.5` — эталон краснеет.

### Задача 11: `applyTheme` — акцент, tinted, цвета исходящих

**Порт:** `themeController.ts` `bindColorApplier` (`:521-550`), `applyAppColor` (`:552-626`, без ветки
`increaseContrast` `:576-593`, `:597-598` — О-3), `applyTheme(theme, element, saveToCache)` (`:778-937`)
дословно. Наш `setTheme(preset)` строит CSS из `presetToColorMap` — после задачи он зовёт
`applyTheme(getTheme())` на корне (задача 12), а `deriveChatThemeVars`/`applyChatTheme`
(`core/theme/themeController.ts:385-477`) ещё живут до задачи 20.

- [ ] **Шаг 2: падающие тесты** (на `document.documentElement` happy-dom, значения — посчитанные tweb
  на тех же входах; снять их прогоном оригинальной функции в тесте-эталоне): `DEFAULT_THEME` на `day`
  даёт `--primary-color` и `--message-out-background-color` как у tweb; `tinted` с акцентом `0x00c2ed`
  — `--surface-color` из множителей `(1.024, 0.585, 0.25)`, `--primary-color` = сырой акцент (не
  `changeColorAccent`); без `message_colors` — `message-out-*` не пишутся; `saveToCache` только для корня.
- [ ] **Шаг 3:** **мутации:** `messageLightenAlpha` ночью `0.12` — эталон ночи краснеет; убрать
  `Math.max(…, 0.18)` — эталон тёмного акцента краснеет.

### Задача 12: состояние темы — чтение и запись выбора

**Порт:** `themeNameToBaseTheme` (`:191-196`), `getResolvedThemeName` (`:497-501`), `getTheme` (`:503-507`),
`getThemeName` (`:509-513`), `getBaseThemeForName` (`:515-518`), `getThemeSettings` (`:731-743`),
`isNight*`, `switchTheme` (`:470-487`) и слушатель `lastThemeNames` (`:226-241`), `applyNewTheme`
(`:664-725`), `applyAccentPreset` (`:632-652`), `resetActiveTheme` (`:657-662`),
`setWallpaperForCurrentTheme` (`:752-776`), `_setTheme` → `applyTheme(getTheme())` + зеркальный `.night{}`
(`:324-352`), `applyHighlightingColor` из `themeSettings.highlightingColor` (`:298-322`). Аналог
`appImManager.applyCurrentTheme` (`:2690-2713`) — там, где у нас живёт старт фона (`client/boot.ts`):
засев URL, `setTheme()`, `appChatBackground.setBackground()`, событие `background_change` (`rootScope`).
Статика `AppBackgroundTab.setBackgroundDocument` — в задаче 16; до неё `applyNewTheme` принимает её
инъекцией (как `themeController.AppBackgroundTab` у tweb, `:207`).

- [ ] **Шаг 2: падающие тесты:** `getTheme('light')` — запись `themes`, отсутствует — из `SETTINGS_INIT`;
  `getThemeSettings` на `light` → запись `baseThemeDay`, на теме только с Classic/Night → запасная;
  `applyNewTheme(облачная)` на `tinted` — обои активной базы смешаны, прочие базы темы сохранены, в
  `themes[]` заменена только запись текущего имени; `applyAccentPreset` без обоев — обои текущие;
  `resetActiveTheme` — фабрика только для текущего имени; `setWallpaperForCurrentTheme` — новый объект
  `themes` (стор меняется записью, не мутацией); `switchTheme()` с `night` → `lastThemeNames.light`.
- [ ] **Шаг 3:** **мутации:** в `applyNewTheme` не сохранять неактивные базы — тест краснеет;
  `setWallpaperForCurrentTheme` мутирует объект на месте — тест «новый объект» краснеет.

### Задача 13: воркер — `themesManager` (порт `appThemesManager`)

**Порт:** `lib/appManagers/appThemesManager.ts` (130) → `core/managers/themesManager.ts` дословно по
методам (референс § 3), сеть — наш `restClient` на ручки задачи 5. `invokeApiHashable`
(`apiManagerMethods.ts:99-155`) — порт в `net/` (кэш `{hash, result}` по пути и параметрам в памяти
воркера, `*NotModified` → сохранённый результат); `getThemes` — хэш из `appState.accountThemes`, ответ —
`setAppState('accountThemes', …)` (ключ `AppState`, персист воркером, `stores/appState.ts`); `user_auth` →
`getThemes()`. `saveWallPaper` — `saveDocument` документа (`core/media/messageMedia`), карты по id и slug.
Загрузка фото — `prepareWallPaperUpload`/`uploadWallPaper` (`appDocsManager.ts:353-424`) в владельце
документов воркера: `/media/upload` → `POST /wallpapers {media_id, mime_type, settings: {pFlags: {}}}`,
превью полного размера до ответа, перенос кэша превью на новый документ.

- [ ] **Шаг 2: падающие тесты** (фейковый REST): второй `getWallPapers` шлёт `hash` первого и на
  `NotModified` отдаёт тот же массив; `getThemes` читает хэш из `accountThemes` и пишет ответ туда;
  `getWallPaperBySlug` из карты — без сети; обои тем после `getThemes` лежат в карте по slug;
  `uploadWallPaper` — один `/media/upload` и один `POST /wallpapers`.
- [ ] **Шаг 3:** **мутации:** не подставлять `hash` — тест второго вызова краснеет; не класть обои тем
  в карту — тест slug краснеет.
- [ ] **Шаг 4 (врезка после задачи 5):** регистрация менеджера в воркере и прокси.

### Задача 14: `chatBackgroundStore` — порт целиком (снимает О-40)

**Порт:** `lib/chatBackgroundStore.ts` (233) → `core/chat/chatBackgroundStore.ts` дословно: кэш
`cachedBackgrounds` (`CacheStorageController`, `:42`), общие object URL (`makeObjectUrlOwner`/
`createSharedObjectURL`, `:85-87`), промах → `themesManager.getWallPaperBySlug` + скачивание документа
(`:125-128`), размытие, `saveWallPaperToCache` (не для `pattern`), `cachedWallPapers`,
`preloadWallPapers` (`:206-230`). Наши аналоги `CacheStorageController`/`objectUrl` — найти
(`git grep -n "CacheStorageController\|createSharedObjectURL" web-client/src`); нет — порт в той же задаче.
Ветка `media-<id>` (О-40) удаляется.

- [ ] **Шаг 2: падающие тесты** (есть образец tweb `tests/chatBackgroundStoreObjectUrls.test.ts` —
  перенести): повторный `getBackground` — тот же URL; промах кэша качает документ по slug; сбой не
  кэшируется; `preloadWallPapers` не качает `pattern` и обои без документа.
- [ ] **Шаг 3:** **мутация:** снять `promise.catch` удаления — тест «сбой не кэшируется» краснеет.

---

## Пакет К1 — переключение (ветка `feat/wallpapers-switch`, в `main` — одним PR)

### Задача 15: переключение модели — адаптер снят

**Что делаем.**

1. `settings.tsx::load` зовёт `migrateWallpaperSettings` (задача 9); ключи `wallpaper`,
   `customWallpaperMediaId`, `customWallpaperBlur` удаляются из `Settings`, `DEFAULTS`, `update`, моста.
2. `chatBackground.solid.tsx`: адаптерный кусок (#324 `:150-182`) → `themeController.getTheme`/
   `getThemeSettings`/`getResolvedThemeName`, как `resolveBackgroundSync` оригинала (`:159-176`, с
   `untrack`, если тема — Solid-сигнал); `getWallPaperUrl` — `ChatBackgroundStore.getBackground({slug,
   canDownload, managers, blur})` (`:178-205`); `watchWallPaperSettings` (#324 `:673-691`) удаляется —
   перерисовку делают вкладки через `applyCurrentTheme` (как у tweb). Шапка файла: пункты О-11/О-38/О-40
   сняты, О-39 — до задачи 20. Компонент и синглтон не меняются (`git diff` — только эти куски).
3. `web-client/src/wallpapers.ts` + тест удаляются; `core/chat/chatBackgroundStore.ts` — из задачи 14;
   экран блокировки (`passcodeLock/background.solid.tsx`) и `useShellTheme` читают тему через
   `themeController`.

- [ ] **Шаг 2: падающие тесты:** старт с сохранённым `{wallpaper: {kind: 'preset', …}}` — фон рисует
  узор с этими цветами на всех четырёх темах; `setWallpaperForCurrentTheme` + `applyCurrentTheme` —
  фон перерисован с `fade`; смена `themeChoice` — обои своей базы.
- [ ] **Шаг 3:** **мутация:** не звать миграцию в `load` — тест старого сохранения краснеет.

**Готово когда:** `git grep -n "wallpapers'\|customWallpaper\|WALLPAPER_PRESETS" web-client/src` пуст.

### Задача 16: вкладка «Обои» — дословно

**Порт:** `sidebarLeft/tabs/background.tsx` (615) → `background.solid.tsx` целиком (референс § 5.1):
статика `AppBackgroundTab.addWallPaper`/`setBackgroundDocument` (`:55-270`), сетка из `cachedWallPapers`
+ `getWallPapers()` (`:529-554`), `LazyLoadQueue`, загрузка (`:388-455`, PNG → JPEG, превью,
`ProgressivePreloader` с отменой), «Сбросить» → `resetActiveTheme`, «Размытие» (`:309-313`, `:467-482`),
активная по `background_change`. Одноразовый `pendingWallPaperUpload` (задача 9) — отгрузка на первом
старте, вне вкладки (`client/boot.ts`), тем же `uploadWallPaper`.

- [ ] **Шаг 2: падающие тесты:** сетка из фейкового каталога (плиток столько, сколько обоев с цветами);
  клик по плитке → `themes[]` текущего имени несёт эти обои и `highlightingColor`; загрузка — плитка
  первой с прелоадером, после ответа ключ плитки = id сервера и она активна; «Размытие» отключено для
  узора; `pendingWallPaperUpload` отгружается один раз и пропадает.
- [ ] **Шаг 3:** **мутация:** ключ плитки не переписывается на id сервера — «активна после ответа» краснеет.
- [ ] **Шаг 4: DOM:** `dom-parity.mjs 14-left-17b-settings-wallpaper` — расхождения только объявленные.

### Задача 17: вкладка «Цвет» — дословно

**Порт:** `backgroundColor.tsx` (168) → `backgroundColor.solid.tsx`: `wallPaperNoFile`, смешение на
`tinted` (`:80-82`), `setWallpaperForCurrentTheme` + `applyCurrentTheme` (`:86-90`), троттл 16 мс,
активный свотч по `background_color`.

- [ ] **Шаг 2: падающие тесты:** свотч → `NoFile` с цветом в записи текущей базы; на `tinted` цвет
  смешан; активный — с ведущим нулём (`#008dd0`).
- [ ] **Шаг 3:** **мутация:** убрать `padStart(6, '0')` — тест ведущего нуля краснеет.

---

## Пакет К2 — облачные темы

### Задача 18: карусель `chatThemesPicker.solid.tsx` → 2C-17

**Порт:** `components/chatThemesPicker.tsx` (356) дословно (референс § 7.1), `scss/partials/_themes.scss`
(241) → `styles/tweb/_themes.scss` + `_index.scss`; `helpers/dom/attachListNavigation.ts::attachPickerGrid`
(`:246`, с зависимостями файла в объёме потребителя); `wrapStickerEmoji` — наш
`components/wrappers/stickerEmoji.ts`; ожидание набора анимированных эмодзи (`:177`) — наш
`core/animatedEmoji.ts`.

- [ ] **Шаг 2: падающие тесты:** первой — `DEFAULT_THEME` (`selectedId ''` → `.active`,
  `aria-pressed="true"`), дальше только `pFlags.default`; плитка красится СВОЕЙ темой (`--primary-color`
  на `.theme-container` — акцент темы, не глобальный); смена `baseTheme` меняет `.background-item`
  плитки; клик → `onSelect(theme)`; `role="toolbar"`, один таб-стоп.
- [ ] **Шаг 3:** **мутация:** `applyThemeOnItem` красит глобальной темой — тест акцента плитки краснеет.
- [ ] **Шаг 4:** `node tools/tweb-parity/scss-parity.mjs _themes.scss` → 0 «нет у нас».

### Задача 19: «Общие» — карусель, ряд акцентов, прогрев

**Порт:** `generalSettings.tsx` `ThemeSection` (`:114-179`) и `AccentPickerRow` (`:194-267`),
`GrowHeightReveal` (`helpers/solid/animations.tsx:72-93` → `helpers/solid/animations.solid.tsx`),
`preloadWallPapers` в `onMount` (`:46-51`), `margin-top: .5rem` формы (`:164`). Снимаются расхождения 1,
2, 5 шапки `generalSettings.solid.tsx` и строки О-11/О-38 таблицы «Отложено» 2D («закрыто программой
обоев, PR …»).

- [ ] **Шаг 2: падающие тесты:** клик по плитке → `applyNewTheme` и `.active` на ней после
  `theme_changed`; ряд акцентов виден только на `tinted`, «по умолчанию» на `tinted` скрыт, синий активен
  после сброса; клик по кругу → `applyAccentPreset`, `theme.id = 'preset:<id>'`.
- [ ] **Шаг 3:** **мутация:** показывать ряд на `night` — тест краснеет.
- [ ] **Шаг 4: DOM:** `dom-parity.mjs 08-general-settings`.

### Задача 20: тема чата из облачных тем (снимает О-39; Р4)

**Порт:** `chat/chat.ts:517-545` (`getThemeByEmoticon` по `appState.accountThemes`, отбрасывание обоев
карточки при найденной теме) и `applyContainerTheme` (`:372-376`, `applyTheme(theme, container)`) — в
нашу публикацию фона по активному чату (`core/hooks/useShellTheme.ts`, #324); `appChatBackground.setBackground({theme})`.
`resolveFromPeer` (`chatBackground.tsx:141-157`) — если есть потребитель (превью чата), иначе —
расхождение шапки. Удаляются `chatThemes.ts` (+ тест), `deriveChatThemeVars`/`applyChatTheme`/
`clearChatTheme` (`core/theme/themeController.ts:385-477`) и их вызовы (`Chat.tsx`, `chatsStore.ts`,
`useChatPopups.tsx`). Попап `ChatThemesPicker.tsx` (Р4): список — `themesManager.getThemes()`, значение —
эмодзи; шапка — «пары в tweb нет, объявленное отступление».

- [ ] **Шаг 2: падающие тесты:** карточка с `theme_emoticon: '🏝'` → колонка чата несёт переменные темы
  🏝 текущей базы, фон — её обои; эмодзи вне каталога — глобальная тема; смена дня/ночи — вариант темы
  чата своей базы.
- [ ] **Шаг 3:** **мутация:** не отбрасывать обои карточки при найденной теме — тест краснеет.

**Врезка — вместе с задачей 7** (сервер принимает эмодзи и переписал старые id).

---

## Финал

### Задача 21: итог программы

- [ ] `git grep -n "О-11\|О-38\|О-39\|О-40" web-client/src docs/superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md`
  — только ссылки «закрыто»; строки таблицы «Отложено» 2D помечены.
- [ ] Чеклист «Проверка после порта» референса — на стенде, числа (computed-переменные, сеть,
  `NotModified`) — в коммите.
- [ ] `docs/tweb/wallpapers-themes.md` § 9 переписан по факту; `docs/tweb/inventory` перегенерирован
  (`node tools/tweb-parity/inventory.mjs`).

---

## Отложено — с предметом

| № | Что | Почему отложено | Что разблокирует |
|---|---|---|---|
| О-1 | Обои ОДНОГО чата: `messages.setChatWallPaper`, `userFull/channelFull.wallpaper` (показ — `chat.ts:532`), `messageActionSetChatWallPaper` (`messageActionTextNewUnsafe.ts:732-760`) | у tweb только показ; бэкенд не производит, UI установки у tweb нет | обои чата, пришедшие от других клиентов |
| О-2 | Ссылки на обои (`t.me/bg/<slug>`), доступ к чужим загруженным обоям по slug | у tweb 812502980 разбора нет (поправка 1); сервер отдаёт чужие slug как `ErrNotFound` | обмен обоями ссылкой |
| О-3 | Ветка `increaseContrast` в `applyAppColor` (`themeController.ts:576-599`) | = 2D О-37: нет настройки и `_accessibility.scss` | режим повышенного контраста |
| О-4 | Попап темы одного чата `ChatThemesPicker.tsx` и `PUT /chats/{peer}/theme` | пары в tweb нет (поправка 2); по Р4 остаётся объявленным отступлением | снос или порт, если tweb его заведёт |
| О-5 | Подсказки пустой колонки `chatTips/appearanceCard.tsx` (100) | подсистемы `chatTips` у нас нет | вторая точка входа карусели |
| О-6 | Файлы тем (`Theme.document`, `format`, `account.uploadTheme`/`createTheme`/`installTheme`) | клиент не зовёт; `format` принимается и игнорируется | — |
| О-7 | Параметры темы для мини-приложений (`getThemeParamsForWebView`, `setWorkerThemeParams`, `:244-249`, `:939-964`) | потребитель — программа мини-приложений | тема в WebApp |
| О-8 | Фото-обои в каталоге | Р1: чужих фото не берём; своих нет | фото в сетке «Обоев» |
| О-9 | `wallPaperSettings.motion`/`rotation` на рендере | tweb не читает их в `chatBackground.tsx` | — |
| О-10 | `userFull.theme` объектом `ChatTheme` (`chatThemeUniqueGift` с `theme_settings`) вместо `theme_emoticon` | подарков-тем нет (`port-divergences.md:504`) | темы из подарков |

## Оценка объёма

| Задача | Строк оригинала / объём | Размер |
|---|---|---|
| 1 модель TL + хэш | ~12 конструкторов | M |
| 2 миграции | 3 таблицы | S |
| 3 обои: usecase+repo | — | M |
| 4 темы: usecase+repo | — | S |
| 5 HTTP | 5 маршрутов | M |
| 6 засев + ассеты | ~300 по образцу | M |
| 7 тема чата — эмодзи | миграция + проверка | S |
| 8 `.tgv` | ~30 | S |
| 9 модель выбора + миграция | ~150 из `state.ts` | M |
| 10 пресеты акцента | 281 | S |
| 11 `applyTheme` | ~420 | **L** (риск: эталонные значения) |
| 12 состояние темы | ~250 | M |
| 13 `themesManager` + хэш-кэш + загрузка | 130 + 60 + 75 | M |
| 14 `chatBackgroundStore` | 233 | M |
| 15 переключение | — | M (риск: миграция данных пользователей) |
| 16 «Обои» | 615 | L |
| 17 «Цвет» | 168 | S |
| 18 карусель + стили + навигация | 356 + 241 + ~90 | L |
| 19 «Общие» | ~150 + 93 | M |
| 20 тема чата | ~60 + снос | M |
| 21 итог | — | S |

## DoD программы (перед мержем задачи 21)

- [ ] Бэкенд: `go vet`, `gofmt -l .`, `go test ./...` зелёные; сверки схемы для всех новых конструкторов.
- [ ] Клиент: `vite build`, `vitest run`, `tsc --noEmit`, `oxlint --type-aware` зелёные из `web-client/`.
- [ ] Ручек «сохранить выбор» нет; `GET /wallpapers` и `GET /themes` отвечают `*NotModified` на свой хэш.
- [ ] `web-client/src/wallpapers.ts`, `chatThemes.ts`, `deriveChatThemeVars` удалены; выбор живёт только
  в `settings.themes[]`.
- [ ] Сохранения пользователей старой модели (пресет, цвет, своё фото) пережили обновление — пин 15 и стенд.
- [ ] `diff` `_themes.scss` с tweb — только `@use`; `dom-parity` по `08-general-settings` и
  `14-left-17b-settings-wallpaper` — только объявленные расхождения.
- [ ] «У нас» в `docs/tweb/wallpapers-themes.md` обновлено в каждом PR.
