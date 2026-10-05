# Обои и облачные темы (tweb `812502980`): референс для порта 1:1

Снято 2026-09-27. Источники:

- tweb `/Users/denisurevic/Documents/tweb`, коммит **`812502980`** — все адреса ниже по нему;
- схема TL — `src/scripts/in/schema.json` tweb (слой 229), у нас та же — `schema/schema.json`;
- наш код — `origin/main` = `6b974798` и ветка PR #324 `origin/feat/solid-chat-background` = `3936b593`
  (фон чата на Solid; на момент снятия не влита — адреса её файлов помечены «#324»).

План переноса — [`../superpowers/plans/2026-09-27-wallpapers-themes.md`](../superpowers/plans/2026-09-27-wallpapers-themes.md).
Соседние доки: тема-подсистема и переменные — [`state-and-layout.md`](state-and-layout.md); строки и
вкладки настроек — [`settings-rows.md`](settings-rows.md); медиа-конвейер — [`media.md`](media.md).

Коротко, как устроено у оригинала: **сервер отдаёт только каталоги** (обои — `account.getWallPapers`,
облачные темы — `account.getThemes`), **выбор хранит клиент** — в `settings.themes[]`, по одной записи
`AppTheme` на имя темы (`day`/`night`/`light`/`tinted`), и в каждой записи — массив `ThemeSettings` по
базовым темам со своими акцентом, цветами исходящих и обоями. Сохранения выбора на сервер нет.

---

## 0. Поправки к постановке (проверены в исходниках)

1. **Ссылок `t.me/bg/…` tweb не разбирает.** В `lib/internalLink.ts:5-32` типа ссылки на обои нет, в
   `lib/internalLinkProcessor.ts` — ни `bg`, ни `wallpaper`. `account.getWallPaper` зовут двое:
   `chatBackgroundStore.getBackground` на промахе кэша (`lib/chatBackgroundStore.ts:125` →
   `getWallPaperBySlug`) и **обновление file reference** документа обоев
   (`lib/storages/references.ts:284-285` → `getWallPaperById`, контекст `referenceContextWallPaper`
   `:82-85`, заводит его `appThemesManager.ts:40`). Второе — транспорт MTProto (file reference у нас не
   производится, `docs/readiness/tl-program.md` «Чего НЕ копируем»).
2. **Своей темы одному чату tweb не ставит.** `messages.setChatTheme` и `messages.setChatWallPaper` есть
   только в `lib/mtproto/schema.ts`; UI выбора темы чата у оригинала нет. Тема чата лишь **показывается**:
   эмодзи из полной карточки (`channelFull.theme_emoticon`, `userFull.theme.emoticon`,
   `wallPaper.settings.emoticon`) ищется среди облачных тем (`components/chat/chat.ts:517-540`).
   Наш попап выбора темы чата (`components/ChatThemesPicker.tsx`) пары в tweb не имеет.
3. **Карусель тем — отдельный компонент** `components/chatThemesPicker.tsx` (356), у него три
   потребителя: «Общие» (`sidebarLeft/tabs/generalSettings.tsx:158-163`), «Мой QR»
   (`popups/myQrCode.tsx:139`, `:162-163`) и карточка подсказки пустой колонки
   (`chatTips/appearanceCard.tsx:13`). План 2C (задача 17) считает его портом задачи 13 плана 2D —
   но 2D-13 карусель не портировала (О-38 там же).

---

## 1. Модель TL (слой 229)

| Конструктор | id | Поля | Кто читает у клиента |
|---|---|---|---|
| `wallPaper` | `-1539849235` | `id:long` `flags:#` `creator:flags.0?true` `default:flags.1?true` `pattern:flags.3?true` `dark:flags.4?true` `access_hash:long` `slug:string` `document:Document` `settings:flags.2?WallPaperSettings` | сетка «Обоев», фон чата, темы |
| `wallPaperNoFile` | `-528465642` | `id:long` `flags:#` `default:flags.1?true` `dark:flags.4?true` `settings:flags.2?WallPaperSettings` | цвет/градиент без файла |
| `wallPaperSettings` | `925826256` | `blur:flags.1?true` `motion:flags.2?true` `background_color:flags.0?int` `second_background_color:flags.4?int` `third_background_color:flags.5?int` `fourth_background_color:flags.6?int` `intensity:flags.3?int` `rotation:flags.4?int` `emoticon:flags.7?string` | градиент (до 4 цветов), интенсивность узора (знак — тёмный узор), размытие фото |
| `inputWallPaper` / `inputWallPaperSlug` / `inputWallPaperNoFile` | `-433014407` / `1913199744` / `-1770371538` | `id access_hash` / `slug` / `id` | `appThemesManager.getInputWallPaper` (`:66-74`) |
| `account.wallPapers` / `account.wallPapersNotModified` | `-842824308` / `471437699` | `hash:long wallpapers:Vector<WallPaper>` / — | `getWallPapers` (`:120-129`) |
| `theme` | `-1609668650` | `creator:flags.0?true` `default:flags.1?true` `for_chat:flags.5?true` `id:long` `access_hash:long` `slug:string` `title:string` `document:flags.2?Document` `settings:flags.3?Vector<ThemeSettings>` `emoticon:flags.6?string` `installs_count:flags.4?int` | карусель, тема чата по эмодзи |
| `themeSettings` | `-94849324` | `message_colors_animated:flags.2?true` `base_theme:BaseTheme` `accent_color:int` `outbox_accent_color:flags.3?int` `message_colors:flags.0?Vector<int>` `wallpaper:flags.1?WallPaper` | `themeController.applyTheme` (`:778-937`) |
| `baseThemeClassic`/`Day`/`Night`/`Tinted`/`Arctic` | — | — | имя ↔ база (§ 4.1); `Arctic` клиент не использует |
| `account.themes` / `account.themesNotModified` | `-1707242387` / `-199313886` | `hash:long themes:Vector<Theme>` / — | `getThemes` (`:102-118`) |

Методы, которые клиент **зовёт** (все четыре — через `appThemesManager` и `appDocsManager`):

| Метод | id | Параметры → результат | Где |
|---|---|---|---|
| `account.getWallPapers` | `127302966` | `hash:long` → `account.WallPapers` | `appThemesManager.ts:120-129` (`invokeApiHashable`) |
| `account.getWallPaper` | `-57811990` | `wallpaper:InputWallPaper` → `WallPaper` | `appThemesManager.ts:56-64` |
| `account.uploadWallPaper` | `-476410109` | `for_chat:flags.0?true file:InputFile mime_type:string settings:WallPaperSettings` → `WallPaper` | `appDocsManager.ts:400-424` |
| `account.getThemes` | `1913054296` | `format:string hash:long` → `account.Themes` | `appThemesManager.ts:102-118` (`format: 'macos'`) |

**Только в схеме, клиент не зовёт:** `account.saveWallPaper`, `account.installWallPaper`,
`account.resetWallPapers`, `account.getMultiWallPapers`, `account.getChatThemes`, `account.getTheme`,
`account.installTheme`, `account.uploadTheme`, `account.createTheme`/`updateTheme`/`saveTheme`,
`messages.setChatWallPaper`, `messages.setChatTheme`. Выбор обоев на сервер не уходит — «Сбросить» во
вкладке «Обои» тоже локальный (`resetActiveTheme`, § 6.3).

Полные карточки несут обои и тему **для показа**: `userFull.wallpaper:flags.24?WallPaper`,
`userFull.theme:flags.15?ChatTheme` (`chatTheme{emoticon}`), `channelFull.wallpaper:flags2.7?WallPaper`,
`channelFull.theme_emoticon:flags.27?string`; служебное `messageActionSetChatWallPaper{same, for_both,
wallpaper}` — только текст (`wrappers/messageActionTextNewUnsafe.ts:732-760`).

Файл узора — документ `application/x-tgwallpattern` (`.tgv`, gzip-SVG,
`environment/mimeTypeMap.ts:3`). На скачивании его распаковывают в `image/svg+xml`
(`apiFileManager.ts:686-689` → `uncompressTGV` `:543-557`, лимит `TGV_MAX_DECOMPRESSED_SIZE = 8 МиБ`
`:95`; на Firefox — ещё `fixFirefoxSvg`).

---

## 2. Где живёт выбор: `settings.themes[]` и `state.accountThemes`

### 2.1 Типы (`config/state.ts`)

| Тип | Адрес | Смысл |
|---|---|---|
| `AppThemeSettings = Modify<ThemeSettings, {highlightingColor: string}>` | `:43-45` | запись одной базы + цвет подсветки сообщения, посчитанный из обоев |
| `AppTheme = Modify<Theme, {name: 'day'\|'night'\|'light'\|'tinted'\|'system', settings?: AppThemeSettings[]}>` | `:47-50` | тема приложения: облачная `Theme` (или синтетическая) с именем |
| `StateSettings.themes: AppTheme[]` | `:98` | по записи на имя |
| `StateSettings.theme: AppTheme['name']` | `:99` | выбранное имя (радио «Общих»), `system` — по ОС |
| `StateSettings.lastThemeNames: {dark, light}` | `:105-108` | последний явный выбор по сторонам — для тумблера ночи в бургере |
| `background?: Background` | `:33-41`, `:97` | **устаревшее** (`! DEPRECATED`), не читается |
| `State.accountThemes: AccountThemes.accountThemes` | `:261`, умолчание `{}` `:639` | последний ответ `account.getThemes` вместе с `hash`; персистится |

### 2.2 Умолчания

- `DEFAULT_THEME: Theme` (`:305-429`) — синтетическая тема `id: ''`, `emoticon: '🏠'`, `pFlags.default`,
  четыре `themeSettings`: Classic (`accent 0x3390ec`, исходящие `[0x5CA853]`, обои `:315-334`),
  Night (`0x8774E1`, `:341-361`, интенсивность `-50`), Tinted (акцент и исходящие — первый пресет базы
  Tinted `TINTED_DEFAULT_PRESET` `:22`, `:372-373`; обои `:374-397`, интенсивность `-40`), Day
  (`0x2D7ED5`, `:404-423`). Все обои — `wallPaper` с `id: ''`, `slug: 'pattern'`, `document: undefined`,
  `pFlags {default, pattern[, dark]}` — это **встроенный** узор `assets/img/pattern.svg` (§ 8).
- `DEFAULT_HIGHLIGHTING_COLORS` (`:434-439`) — подсветка по базе, пока не посчитана из обоев.
- `makeDefaultAppTheme(name)` (`:441-450`) — `DEFAULT_THEME` с именем и `highlightingColor` на каждой
  записи. Одна и та же тема с ЧЕТЫРЬМЯ базами кладётся под каждое имя: какая база активна, решает имя
  (§ 4.1).
- `SETTINGS_INIT.themes` (`:500-505`) — четыре таких записи; `theme: 'system'` (`:506`),
  `lastThemeNames: {dark: 'night', light: 'day'}` (`:508-511`).

### 2.3 Миграции (`lib/appManagers/utils/state/loadState.ts`)

- `VALIDATE` (`:167-179`) дополняет недостающие ключи из `SETTINGS_INIT`, но путь `settings.themes`
  **пропускает** (`SKIP_VALIDATING_PATHS` `:169-171`): иначе пользовательский массив тем
  перезаписался бы дефолтным при расхождении формы.
- `MIGRATE_THEMES` (`:180-197`) — идемпотентно оборачивает старое `AppTheme.settings` (один объект) в
  массив из одного элемента; зовётся для общего состояния (`:286`, `:349`). `getThemeSettings`
  (`themeController.ts:738`) и `setWallpaperForCurrentTheme` (`:769-773`) продолжают понимать старую
  форму до первой записи.

---

## 3. Воркер: `lib/appManagers/appThemesManager.ts` (130)

| Метод | Адрес | Что делает |
|---|---|---|
| `after()` | `:11-24` | карты `wallPapers` (по id) и `wallPapersBySlug`; на `user_auth` — `getThemes()`; из `state.accountThemes` при старте раскладывает обои тем по картам (`saveAccountThemes`) |
| `saveWallPaper(wp)` | `:26-54` | у `wallPaper` (не `NoFile`) — `appDocsManager.saveDoc(document, {type: 'wallPaper', wallPaperId})`; кладёт в обе карты. Комментарий `:32`: сервер отдаёт один id разным обоям — поэтому **перезаписывает**, а не сливает |
| `getWallPaper(input)` | `:56-64` | `account.getWallPaper` → `saveWallPaper` (`invokeApiSingleProcess` — один запрос на одинаковые параметры) |
| `getInputWallPaper(wp \| slug)` | `:66-74` | строка → `inputWallPaperSlug`; `NoFile` → `inputWallPaperNoFile{id}`; иначе `inputWallPaper{id, access_hash}` |
| `getWallPaperById(id)` / `getWallPaperBySlug(slug)` | `:76-88` | второй сначала смотрит в карту |
| `getThemes()` | `:102-118` | `account.getThemes({format: 'macos', hash: state.accountThemes?.hash ?? 0})`; `themesNotModified` → старые темы; иначе раскладывает обои и `pushToState('accountThemes', …)` |
| `getWallPapers()` | `:120-129` | `invokeApiHashable({method: 'account.getWallPapers'})` → `saveWallPaper` каждого |

`invokeApiHashable` (`lib/appManagers/apiManagerMethods.ts:99-155`): по методу и JSON параметров держит
`{hash, result}` **в памяти**, подставляет `hash` в запрос, на `*NotModified` возвращает сохранённый
результат. Хэш каталога обоев между перезапусками не живёт; хэш тем — живёт (`state.accountThemes`).

Своё фото — в `appDocsManager`:

- `prepareWallPaperUpload(file)` (`:353-398`) — локальный `document` с id `wallpaper-upload-N`, превью
  `photoSize` полного размера из самого файла (`thumbsStorage.setCacheContextBlob`), и `wallPaper` с
  `slug = id`, `pFlags: {}`; файл ждёт в `uploadingWallPapers`;
- `uploadWallPaper(id)` (`:400-424`) — `apiFileManager.upload` → `account.uploadWallPaper({file,
  mime_type: file.type, settings: {pFlags: {}}})` → `saveDoc` ответа, перенос кэша превью со старого
  документа на новый (`moveCacheContext`); на ошибке кэш превью удаляется.

---

## 4. `helpers/themeController.ts` (968): тема, акцент, обои текущей темы

### 4.1 Имя ↔ база

`themeNameToBaseTheme` (`:191-196`): `day → baseThemeClassic`, `night → baseThemeNight`,
`light → baseThemeDay`, `tinted → baseThemeTinted`. Ночные имена — `night`, `tinted` (`:198`).

| Метод | Адрес | Что делает |
|---|---|---|
| `getResolvedThemeName()` | `:497-501` | `settings.theme`, а `system` → `systemTheme` (`setThemeListener` `:271-296`: `night`/`day` по `prefers-color-scheme`) |
| `getTheme(name?)` | `:503-507` | запись `settings.themes` по имени, иначе — из `SETTINGS_INIT` |
| `getBaseThemeForName(name)` | `:515-518` | таблица выше, запасная — Night/Classic по ночности |
| `getThemeSettings(theme, isNight?)` | `:731-743` | запись массива для базы имени темы; запасная — Night/Classic; старая форма (объект) — как есть |
| `switchTheme(name?, coords?)` | `:470-487` | без имени — тумблер бургера: противоположная сторона из `lastThemeNames`; пишет `settings.theme`, `theme_change` |
| слушатель `settings_updated` | `:226-241` | при смене `settings.theme` обновляет `lastThemeNames.dark/light` (для `system` — нет) |

### 4.2 Применение цветов — `applyTheme(theme, element = documentElement)` (`:778-937`)

Одна и та же функция красит и корень документа, и контейнер чата с его темой
(`chat/chat.ts:372-376` `applyContainerTheme`), и плитки карусели (`chatThemesPicker.tsx:117-142`).

1. База цветов — `colorMap[themeName]` (`:104-189`); `appColorMap` (`:44-102`) — у каких переменных
   есть `-rgb`, `light-`, `light-filled-`, `dark-`.
2. **Акцент** (`:784-837`): для не-`tinted` — `changeColorAccent(hsv базового primary, hsv accent_color,
   rgb базового primary, !isNight)`; для `tinted` — «сырой» акцент с яркостью не ниже `0.18` (`:810-813`).
3. **`tinted` выводит поверхности из акцента** множителями iOS (`:814-825`): `surface` `(1.024, 0.585,
   0.25)`, `background`/`body-background` `(1.024, 0.573, 0.18)`, поле поиска `(1.02, 0.609, 0.15)`,
   `border` `(1.033, 0.426, 0.34)`, `secondary` `(1.019, 0.109, 0.59)`, `secondary-text`
   `(0.956, 0.17, 1.0)`; поверхность становится `mixColor` всех `light-filled-*` (`:839-842`), входящий
   бабл = `surface` (`:865`).
4. `primary-color` (`darkenAlpha .04`), `saved-color` (`lightenAlpha .64` к белому) — `:844-855`.
5. **Цвета исходящих** (`:872-930`): нет `message_colors` — выход до них (`:872-874`, `finalize` не
   зовётся — остаются цвета, уже стоящие на элементе). Иначе: среднее всех цветов градиента
   (`getAverageColor`), для градиента — `getAccentColor` к фону исходящего (`:884-897`); фон исходящего
   — смесь с поверхностью (`messageLightenAlpha` = `1` ночью, `0.12` днём), днём насыщенность `+63`
   (`:914-918`); `message-out-primary-color` — белый ночью, иначе `outbox_accent_color` или средний цвет
   (`:926-930`). `finalize()` (`:537-548`) досыпает непокрашенные переменные из `colorMap`.
6. `applyAppColor` (`:552-626`) — производные переменные; ветка `increaseContrast` (`:576-593`,
   `:597-598`) — часть a11y 472e3e76b (у нас О-37 плана 2D). `saveToCache` — только корень
   (`customProperties.setPropertyCache`).
7. `_setTheme` (`:324-352`) — класс `.night`, `high-contrast`, `theme-color`, `applyTheme(getTheme())`,
   зеркальный блок `.night{…}` (`:343-347`), `applyHighlightingColor` (`:298-322`, из
   `themeSettings.highlightingColor`), событие `theme_changed`.

### 4.3 Запись выбора

| Метод | Адрес | Путь |
|---|---|---|
| `applyNewTheme(theme)` | `:664-725` | запись облачной темы в `settings.themes` под ТЕКУЩЕЕ имя: берётся запись для базы имени (запасная Night/Classic, `:671-672`); на `tinted` обои НЕкураторской темы (id не `''` и не `preset:*`, `:685-686`) смешиваются `blendWallpaperForTinted` (`:688-690`); в новой теме сохраняются ВСЕ базы оригинала, обои заменены только у активной, `highlightingColor: ''` (`:696-700`); затем `AppBackgroundTab.setBackgroundDocument(wp, targetSettings)` (`:709`) дописывает подсветку в тот же объект, и `setAppSettings('themes', …)` (`:710-718`). `theme_change` здесь не шлётся — перерисовку делает цепочка `setBackgroundDocument` → `applyCurrentTheme` (`:719-724`) |
| `applyAccentPreset(preset)` | `:632-652` | синтетическая тема `id: 'preset:<id>'` с одной записью `presetToThemeSettings(preset, base)`; нет обоев у пресета — берутся текущие (`:639-641`); дальше `applyNewTheme` |
| `resetActiveTheme()` | `:657-662` | запись `SETTINGS_INIT` для текущего имени → `applyNewTheme` |
| `setWallpaperForCurrentTheme(wp, hsla)` | `:752-776` | выбор из вкладок «Обои»/«Цвет»: копия массива тем, у записи активной базы заменены `wallpaper` и `highlightingColor`; пишется ТОЛЬКО через сеттер стора (прямое присваивание узлу Solid-стора молча теряется — комментарий `:745-751`) |

### 4.4 Пресеты акцента — `config/themePresets.ts` (281)

Порт `ThemeColorPresets.swift` iOS: `AccentPreset {id, accent_color, message_colors (1–2), wallpaper?}`
(`:16-31`). По базе (`getAccentPresetsForBase` `:217-236`): Classic — 7 кураторских (`:33-42`) + 9
базовых цветов; Night — 3 (`:53-62`) + 8 (без серого, `:214`); Day — 4 без обоев (`:44-51`) + 9;
Tinted — только 9 базовых, каждому — свои тёмные обои (`TINTED_BASE_WALLPAPERS` `:91-103`), исходящие
на тёмных базах выводятся из акцента (`darkBubbleColors` `:118-125`, `:196-200`).
`blendWallpaperForTinted(wp, accent)` (`:153-190`) — 85% ближайших к акценту тёмных обоев + 15%
выбранных, `dark: true`, интенсивность от цели. `buildPresetWallpaper` (`:240-266`) — обои пресета
`id: 'preset:wp:<id>'`, `slug: 'pattern'` — чтобы `getWallPaper` их не искал на сервере (`:236-238`).
`presetThemeId` — `'preset:' + id` (`:279-281`).

---

## 5. Жизненный цикл выбора обоев

### 5.1 Вкладка «Обои» — `sidebarLeft/tabs/background.tsx` (615)

Статика `AppBackgroundTab` (нужна `themeController` и карусели; `themeController.AppBackgroundTab`
ставит `appImManager`):

- `addWallPaper(wp, container, forBaseTheme?, size = 72×96, lazyLoadQueue?)` (`:76-147`) — плитка
  `.background-item[data-id]` с `.background-item-media`; скелет — CSS-градиент цветов обоев (`:95-102`);
  внутрь монтируется **сам** `<ChatBackground theme={{name}} wallPaper transition="instant" width height>`
  (`:118-127`), имя темы плитки — по базе (`tinted`/`night`/`day`, `:105-109`) — оно выбирает способ
  смешения (§ 8). Узор без цветов — не плитка (`:83-88`). С очередью — монтаж, когда плитка видна.
- `setBackgroundDocument(wp, themeSettings?)` (`:149-269`) — `tempId`-мидлварь (`:153-154`);
  скачивание документа (`downloadMediaURL`, очередь ленты); без `themeSettings` на `tinted` — смешение
  (`:184-186`); средний цвет (из картинки или из холста градиента, `:187-195`), `saveWallPaperToCache`,
  `highlightingColor(pixel)`; с `themeSettings` (путь `applyNewTheme`) — мутация переданного объекта,
  без — `setWallpaperForCurrentTheme` (`:209-221`); затем `appImManager.applyCurrentTheme({slug,
  backgroundUrl, broadcastEvent: true})` (`:223-227`). Размытое фото — через 200 мс
  `blurWallPaperImage` (`:237-262`).

UI (`:277-613`):

| Элемент | Адрес | Поведение |
|---|---|---|
| сетка | `:292-293` | `.search-super-content-media-grid` (как медиа Shared Media), показывается целиком под `<Show when={loaded()}>` (`:606-610`) |
| «Загрузить обои» | `:575-580`, `onUploadClick` `:388-455` | `requestFile('image/x-png,image/png,image/jpeg')`; PNG перекодируется в JPEG (`:390-402`); `prepareWallPaperUpload` → превью в `ChatBackgroundStore` (`:405-415`) → `uploadWallPaper` + `ProgressivePreloader` (upload, отменяемый) на плитке в начале сетки; по ответу — ключ плитки меняется на id сервера, `setBackgroundDocument` |
| «Цвет» | `:581-586` | `AppBackgroundColorTab` |
| «Сбросить» | `:587-592`, `:457-465` | `themeController.resetActiveTheme()` |
| «Размытие» | `:593-604`, `:467-482` | отключено для узора и `NoFile` (`:296-299`); пишет `settings.pFlags.blur` прямо в объект обоев и `pushToState('settings')` (`:309-313`), через 100 мс — `setBackgroundDocument` активной плитки |
| клик по плитке | `:484-524` | `NoFile` — сразу; иначе один раз на ключ (`clicked`), прелоадер, если файла нет в кэше или нужно размытие |
| активная | `:326-338`, `background_change` `:570` | ключ = `'' + wallPaper.id` (`:46-47`); `markGridCornerItem` |
| список | `:529-554` | сначала синхронно из `ChatBackgroundStore.cachedWallPapers` (прогрев «Общими»), затем всегда `getWallPapers()`; если сетка уже построена из кэша — не перестраивается |

### 5.2 Вкладка «Цвет» — `backgroundColor.tsx` (168)

12 цветов (`:15-28`), `ColorPicker` (`:35`). Выбор → `wallPaperNoFile{id: 0, settings.background_color}`
(`:67-76`), на `tinted` — `blendWallpaperForTinted` (`:80-82`), `setWallpaperForCurrentTheme(wp,
highlightingColor(rgba))` (`:86`), `appImManager.applyCurrentTheme({broadcastEvent: true})` (`:88-90`);
троттл 16 мс (`:105`). Активная — по `background_color` (`:40-57`).

### 5.3 Перерисовка — `lib/appImManager.ts`

`applyCurrentTheme({slug, backgroundUrl, broadcastEvent, noSetTheme})` (`:2690-2713`): засев URL в
`ChatBackgroundStore`, `themeController.setTheme()`, `setCurrentBackground` → `setBackground`
(`:2629-2637`) → `appChatBackground.setBackground(…)` и событие `background_change`.

---

## 6. `lib/chatBackgroundStore.ts` (233)

| Член | Адрес | Что |
|---|---|---|
| кэш | `:42` | `CacheStorageController('cachedBackgrounds')`, ключ `backgrounds/<slug>[?blur]` (`:76-78`) |
| `getBackground({slug, canDownload, blur, managers, appDownloadManager})` | `:89-151` | общий object URL на вкладки (`makeObjectUrlOwner('background', account, key)`); промах кэша → `getWallPaperBySlug` + `downloadMediaURL(document)`, размытие, `saveWallPaperToCache`; сбой не кэшируется (`:143-148`) |
| `blurWallPaperImage(url)` | `:153-158` | `blur(url, 12, 4)` → dataURL |
| `saveWallPaperToCache(slug, url, blur?)` | `:160-180` | не для `pattern` (`DEFAULT_BACKGROUND_SLUG`, `config/app.ts:12`) |
| `setBackgroundUrlToCache` / `deleteBackgroundUrlFromCache` | `:182-199` | превью загружаемого фото |
| `cachedWallPapers` | `:74` | синхронный список для первой отрисовки сетки |
| `preloadWallPapers(managers, adm)` | `:206-230` | «Общие» при монтировании (`generalSettings.tsx:46-51`): список + `downloadMediaVoid` каждого файла (кроме `pattern` и без документа) |

---

## 7. Облачные темы

### 7.1 Карусель — `components/chatThemesPicker.tsx` (356)

Пропы (`:49-72`): `selectedId: () => string` (`''` = `DEFAULT_THEME`), `onSelect(theme)`,
`baseTheme?: () => BaseTheme['_']`, `recenterOnBaseChange?`, `class`, `ref`, `onReady`.
Компонент **чисто UI**: выбор применяет вызывающий.

- `ScrollableX` с классом `themes-container`, `role="toolbar"`, `aria-label` (`:144-148`);
  `attachPickerGrid` (`helpers/dom/attachListNavigation.ts:246`) — один таб-стоп, стрелки (`:151-154`);
  прозрачность 0 → 1 после сборки (`:163-164`, `:269-271`).
- Список — `getThemes()` (`:166`), в карусели только `pFlags.default` + первым `DEFAULT_THEME`
  (`:180-181`); перед сборкой ждёт набор анимированных эмодзи (`:177`).
- На плитку — фон каждой доступной базы через `AppBackgroundTab.addWallPaper(wp, undefined, base)`
  (`:192-205`), для `tinted` у некураторских — смешанные обои; нет `tinted` — синтез из Night (`:209-220`).
- `applyThemeOnItem` (`:117-142`): «виртуальная» тема с именем базы (`BASE_THEME_TO_THEME_NAME`
  `:42-47`) и одной записью → `themeController.applyTheme(virtual, container)` — плитка красится своей
  темой, а не глобальной.
- Разметка плитки: `.theme-container[.active][aria-pressed]` > `.background-item` + `.theme-emoticon`
  (эмодзи-стикер `wrapStickerEmoji`, 49 px, `:229-246`) + `.theme-bubble.is-in` + `.theme-bubble.is-out`
  (`:248-261`).
- Клик (`:305-338`): `onSelect(theme)`, эмодзи — `scale(2)` и проигрывание до последнего кадра (Safari —
  `restart`).
- Смена базы (`:290-302`) перекрашивает плитки; с `recenterOnBaseChange` — активная к центру.

Стили — `scss/partials/_themes.scss` (241): `.themes`, `.theme` (`:39-170`), `.accent-picker-frame`,
`.accent-picker`, `.accent-circle` (`:171-241`). **У нас не портирован** (`inventory/coverage.md:45`).

### 7.2 «Общие» — `sidebarLeft/tabs/generalSettings.tsx` (359)

- `SettingsSection` (`:33-100`): в `onMount` — `preloadWallPapers` (`:46-51`).
- `ThemeSection` (`:114-179`): `themeState = {id, name}` текущей темы по `theme_changed` (`:124-131`);
  карусель `selectedId = id`, `baseTheme = getBaseThemeForName(name)`, `onSelect → applyNewTheme`,
  `recenterOnBaseChange` (`:158-163`); форма пяти радио `settings.theme` с `margin-top: .5rem`
  (`:106-112`, `:164-173`), `settings_updated` → `theme_change` (`:139-143`); ряд акцентов — только на
  `tinted`, под `GrowHeightReveal` (`helpers/solid/animations.tsx:72`) `.accent-picker-frame`
  (`:149-150`, `:174-176`).
- `AccentPickerRow` (`:194-267`): «по умолчанию» (`.accent-circle--default`, не на `tinted`) +
  пресеты базы; активный — `theme.id` (на `tinted` фабричное состояние = синий пресет, `:202-207`);
  круг — `--accent-circle-ring`/`-fill-1`/`-fill-2`; клик — `applyAccentPreset`/`resetActiveTheme`;
  активный к центру `fastSmoothScroll` (`:215-229`).

### 7.3 Другие потребители

- «Мой QR» (`popups/myQrCode.tsx:139`, `:162-163`): свой `getThemes()`, выбор хранится отдельно
  (`state.ts:202-208`, `selectedThemeId`), глобальную тему не трогает.
- Подсказка пустой колонки (`chatTips/appearanceCard.tsx`, 100) — та же карусель.

---

## 8. Что читает `<ChatBackground>` (`components/chat/bubbles/chatBackground.tsx`, 797)

| Шаг | Адрес | Вход |
|---|---|---|
| тема и обои | `resolveBackgroundSync` `:159-176` | `options.theme ?? themeController.getTheme()`, `options.wallPaper ?? getThemeSettings(theme).wallpaper` (под `untrack`) |
| по пиру | `resolveFromPeer` `:141-157` | `getCachedFullUser` → `wallpaper`, иначе `theme.emoticon` → `appState.accountThemes.themes` (превью чата, попапы) |
| файл | `getWallPaperUrl` `:178-205` | только цвета без slug и интенсивности — градиент; `slug === 'pattern'` → `assets/img/pattern.svg`; иначе `ChatBackgroundStore.getBackground({slug, blur: settings.pFlags.blur})` |
| смешение | `buildContent` `:207-…` | `pFlags.pattern`; имя темы `tinted` → overlay-режим с фиксированной интенсивностью `-0.38` и инверсией узора (`:226-233`, `:250-252`); отрицательная интенсивность — тёмный узор маской (`:233`, `:247`) |
| цвета | `helpers/color.ts:289-304` | `getWallPaperColors` — до четырёх `*_background_color` |

Синглтон `appChatBackground` (`:560-797`): `setBackground({theme, wallPaper, transition, …})`
(`:636-731`) сравнивает РАЗРЕШЁННЫЕ тему и обои по ссылке (`:690`) — поэтому смена выбора обязана давать
новый объект; владение фоном чатом (`:589-598`, `:661-663`); перерисовка на `theme_changed` (`:743-…`).

Тема одного чата (`chat/chat.ts:517-545`): `wallPaper = fullPeer.wallpaper`; эмодзи — `theme_emoticon`
канала, `theme.emoticon` пользователя или `wallpaper.settings.emoticon`; тема — первая из
`appState.accountThemes.themes` с тем же эмодзи; найдена — обои карточки отбрасываются. Фон —
`publishBackground` (`:378-…`), цвета — `applyContainerTheme` (`:372-376`, `applyTheme(theme,
container)`).

---

## 9. У нас

### 9.1 Карта файлов

| Файл | Что | Судьба |
|---|---|---|
| `web-client/src/settings.tsx` (350) | zustand `tg-settings` (`KEY` `:183`): `themeChoice` (= `settings.theme`), `wallpaper: Wallpaper` (`default`/`preset`/`color`), `customWallpaperMediaId`, `customWallpaperBlur` (`:15-26`, умолчания `:119-124`), `load()` с ручными миграциями (`:209-243`), `update` пишет весь объект (`:250-300`) | модель выбора → `themes[]` + `lastThemeNames` с миграцией (план, задача 9) |
| `web-client/src/wallpapers.ts` (#324: 229, в `main` — 51) | адаптер нашей настройки к `WallPaper` (О-11/О-38), `WALLPAPER_PRESETS` (`:33-46`), `DEFAULT_WALLPAPERS` = `DEFAULT_THEME` tweb по имени (`:129-134`), slug `media-<id>` своего фото (`:152-162`), тема чата → обои (`:216-229`, О-39) | удаляется |
| `web-client/src/chatThemes.ts` (103) | `CHAT_THEMES` — 8 клиентских тем чата с `light`/`dark` вариантами, id-строки (`sky`, `sunrise`, …) | данные уезжают в засев каталога тем, файл удаляется |
| `web-client/src/core/theme/themeController.ts` (477) | функциональный порт: `setTheme(preset)` из `presetToColorMap` без акцента и исходящих темы; `deriveChatThemeVars`/`applyChatTheme` — деривация только для колонки чата с темой (`:385-477`) | → класс/модуль по tweb с `applyTheme`/`applyNewTheme`/… |
| `web-client/src/config/themePresets.ts` (234) | **не** пресеты акцента tweb: здесь `appColorMap` и `colorMap` из `themeController.ts` tweb (шапка `:1-8`) | содержимое — обратно в `themeController`, имя файла — под порт `config/themePresets.ts` tweb |
| `components/sidebarLeft/tabs/background.solid.tsx` (477; #324 — после правки) | порт вкладки «Обои» (2D-12) поверх адаптера: сетка из `WALLPAPER_PRESETS`, своё фото — `/media/upload` + `customWallpaperMediaId` (шапка `:16-61`) | переписывается на `getWallPapers`/`uploadWallPaper`/`setBackgroundDocument` |
| `components/sidebarLeft/tabs/backgroundColor.solid.tsx` (164) | «Цвет» (2D-12), пишет `wallpaper: {kind: 'color'}` | → `setWallpaperForCurrentTheme` |
| `components/sidebarLeft/tabs/generalSettings.solid.tsx` (234) | «Общие» (2D-13); расхождения 1, 2, 5 шапки — О-38/О-11 | + карусель, ряд акцентов, прогрев |
| `components/chatTips/appearanceCard.solid.tsx` | карточка «Оформление» пустой колонки (Б-13 волны 7): кнопки System/Dark/Light через `switchTheme(name, …)`, **без карусели** — расхождение 1 шапки (О-38); `lastThemeNames` нет — запасная пара night/day | + `<ChatThemesPicker>` и `lastThemeNames` вместе с каруселью |
| `components/ChatThemesPicker.tsx` (86) + `.module.scss` | React-попап выбора темы ОДНОГО чата (`PUT /chats/{peer}/theme`) | пары в tweb нет — решение пользователя (план, О-4) |
| `components/QrModal.tsx` (388) | React-QR, свой ряд тем | → 2C-17 (ждёт карусель) |
| `components/chat/bubbles/chatBackground.solid.tsx` (#324: 697) | порт компонента 1:1; адаптерный кусок `:150-182` (`getResolvedThemeName`, `getWallPaperSettingsState`, `getGlobalTheme`, `resolveBackgroundSync`) и `watchWallPaperSettings` (`:673-691`) | заменяются вызовами `themeController`; сам компонент не меняется |
| `core/chat/chatBackgroundStore.ts` (#324: 87) | О-40: адрес по `media-<id>` из медиа-конвейера, только память вкладки | → порт `lib/chatBackgroundStore.ts` целиком |
| `core/chat/patternRenderer.ts`, `gradientRenderer.ts`, `helpers/blur.ts`, `shared/lib/averageColor.ts` | порты рендеров | без изменений |
| `web-client/src/assets/pattern.svg` | встроенный узор (= tweb `public/assets/img/pattern.svg`) | остаётся для `slug: 'pattern'` |
| `core/managers/chatThemesManager.ts` (20) | `PUT /chats/{peer}/theme {theme_id}` | см. О-4 плана |
| `stores/appState.ts` | порт `stores/appState.ts` (zustand, `setAppState`/`setAppStateSilent`, персист воркером) | + ключ `accountThemes` |
| `stores/appSettings.solid.ts` (269) | мост `useAppSettings` над zustand, таблица путей `APP_SETTINGS_KEYS` | + пути `themes`, `lastThemeNames` |
| `web-client/src/layer.d.ts` | типы из общей схемы — `WallPaper`, `Theme`, `ThemeSettings`, … уже есть | без изменений |

Бэкенд:

| Что | Где | Состояние |
|---|---|---|
| обои, темы | — | **нет ничего**: ни таблиц, ни ручек, ни модели (`grep -ri wallpaper backend/internal` — только сгенерированная таблица схемы `internal/pkg/tl/schema_gen.go` и langpack) |
| тема чата | `migrations/0060_chat_theme.sql` (`chat_theme(chat_id, theme_id TEXT, set_by)`), `PUT /chats/{peerID}/theme` (`router.go:168`), кадр `updateChatTheme` — **свой** конструктор (`domain/mtupdate.go:933-948`), `chatFull/channelFull/userFull.theme_emoticon` несёт id пресета строкой (`domain/mtchat.go:815-817`, `:880-888`, `mtpeer.go:814-823`; `docs/readiness/port-divergences.md:504`) | id — клиентские строки, не эмодзи |
| документы | `media` + MinIO, `domain.BuildDocument` (`mtmedia.go:738`), `Document{_, id, mime_type, size, thumbs, attributes}` (`:237-244`), загрузка `/media/upload` → `PUT /media/{id}/content` (`router.go:386-393`), чтение `/media/{id}/content` (`:81`) | переиспользуется |
| засев | `cmd/seed-stickers` (339): `assets/stickers/<slug>/meta.json`, файлы → `usecasemedia.CreateUpload`+`PutContent` от `domain.ServiceUserID` (`main.go:86-105`), идемпотентно; `cmd/seed-reactions`; запуск руками (`backend/README.md:221-222`) | образец для `seed-wallpapers` |
| хэш каталогов | `domain/mtstickerset.go:15-18` (решение Р7 `docs/readiness/tl-stickers-analysis.md`): `hash` и `*NotModified` не производятся, место «не менялось» у REST — заголовки | для обоев/тем пересматривается (план, решение 3) |

### 9.2 Главные расхождения с `812502980`

1. Выбор — одна настройка на все темы (`wallpaper`), а не запись на базу в `settings.themes[]`; акцент,
   цвета исходящих и обои темы не хранятся вовсе — у приложения нет «темы», есть только имя пресета.
2. Каталога обоев нет: сетка — 12 клиентских градиентов, интенсивность узора подставляется из умолчания
   темы (`wallpapers.ts:140-143`).
3. Своё фото — медиа по id, а не `WallPaper` сервера; в списке обоев не появляется; slug выдуман.
4. Облачных тем нет: ни карусели, ни ряда акцентов, ни `applyNewTheme`; тема чата — клиентский пресет с
   id-строкой, деривация цветов — своя (`deriveChatThemeVars`), а не `applyTheme`.
5. Узор `.tgv` клиент не распаковывает (MIME объявлен в `global.d.ts:59`, ветки конвейера нет).
6. `_themes.scss` не портирован.

---

## Проверка после порта

1. «Общие»: карусель — первой плиткой «🏠» (`DEFAULT_THEME`), дальше облачные темы; клик по плитке
   красит приложение (акцент, исходящие, обои) и выделяет плитку; переключение день/ночь перекрашивает
   плитки и возвращает к выбранной теме СВОЕЙ базы.
2. `tinted`: под радио раскрывается ряд акцентов; «синий» активен после сброса; выбор круга меняет
   поверхности (фон списка, поле поиска) — computed `--surface-color` до/после.
3. «Обои»: сетка из `GET` каталога (сеть: один запрос, повторный заход — с `hash`, ответ
   `account.wallPapersNotModified`); клик — фон чата меняется с переходом `fade`, плитка активна после
   переоткрытия вкладки.
4. Своё фото: плитка первой с прелоадером отгрузки; после ответа — активна, в следующем списке обоев
   есть (`pFlags.creator`); «Размытие» доступно только для него.
5. «Цвет»: выбор свотча — сплошной фон; на `tinted` цвет уходит в тёмно-синюю гамму.
6. «Сбросить» — обои и акцент текущей темы — фабричные; другие темы не тронуты.
7. Перезагрузка: выбор каждой из четырёх тем сохранён; старый выбор (до миграции) — пресет/цвет/своё
   фото — пережил первый запуск новой версии.
8. Чат с темой (эмодзи в карточке): колонка красится этой темой, фон — её обоями для текущей базы.
9. DOM карусели — `.themes-container > .theme-container > .background-item + .theme-emoticon +
   .theme-bubble.is-in + .theme-bubble.is-out`; дампы `docs/tweb/dom/dumps/08-general-settings.json` и
   `14-left-17b-settings-wallpaper.json` — через `dom-parity.mjs`.
10. `node tools/tweb-parity/scss-parity.mjs _themes.scss` → 0 «нет у нас».
