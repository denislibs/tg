# Сверка инициализации: tweb vs наш клиент (DOM + покадрово)

Дата: 2026-08-09. Источники: исходники tweb (`/Users/denisurevic/Documents/tweb`), живой DOM-референс
`2026-08-08-tweb-live-dom-reference.md` (§1, §11), живой прогон нашего клиента на стенде msgrverify
(https://localhost:38443, Playwright: CDP-скринкаст холодного старта с Fast-3G-троттлингом и чисткой
SW/IDB-кэша диалогов, залогиненный пользователь id 61).

План устранения расхождений: `../superpowers/plans/2026-08-09-tweb-init-sequence-port.md`.
**Статус: расхождения устранены** — ветка `feat/tweb-init-sequence`, 11 коммитов (`0fd58f4`..`279ba09`).
Результат контрольного прогона — в разделе «После порта» в конце файла.

## Покадровая последовательность (ДО порта)

| Фаза | tweb (по коду + live-дампу) | у нас (наблюдение, кадры t≈мс) |
|---|---|---|
| Кадр 0 (до JS) | **Белый экран**: тема ставится только JS (`themeController`), `#page-chats` в HTML с `display:none`, `meta color-scheme=light` | **Сплеш `#initial-loader`** цвета темы (inline-скрипт + inline-CSS в index.html) |
| Тема | `setThemeListener()` → цвета c `transition: background-color .2s` (base.scss:447) | инлайн до первого кадра (`data-theme`), transition не участвует |
| Обои | `appChatBackground.attach()` **первым потомком body до интерфейса** (index.ts:544); первый показ без кэша — fade `.2s ease` (`.SlotFade`); градиент+узор в одном слоте | lazy-чанк внутри `#root`; Suspense-фолбэк = плоский цвет; **резкая подмена без fade**; узор доезжает отдельно после `img.onload` |
| Появление UI | `#main-columns` `opacity 0 → ''` в rAF **после шрифтов** (кап 1 с), CSS `transition: opacity .3s cubic-bezier(.4,0,.2,1)` (_pages.scss:6-9) | WAAPI-fade **200 мс** по `#page-chats` (useShellEnterAnimation), шрифты reveal не гейтят; сплеш кроссфейдится параллельно (t≈470–580) |
| Гейт транзишенов | `body.has-auth-pages` статически в HTML, снимается после `doubleRaf()` в bootstrapIm — `.main-column` не «въезжает» первым кадром | CSS-гейт портирован (`styles/tweb/pages/_chats.scss:52`), но класс на залогиненном старте **никогда не ставится** (только из AuthFlow) |
| Скелетон чатлиста | **canvas** `dialogs-placeholder-canvas`: строки 72px/аватар 54px, дырки `destination-out`, rAF-блик (проход ≈1.1 с, пауза 850 мс), скролл заблокирован; ниже вьюпорта — DOM-скелетон с mask-шиммером 2.25 с (включается через 1.5 с) | DOM `DialogSkeleton`: 9 строк, `skelShimmer 1.4s`, лесенка opacity по строкам (в tweb нет); скролл не блокируется |
| Замена скелетона | **волна стирания** канваса: 150 мс/строка, каскад 15 мс, easeInOutSine — реальные строки уже под канвасом | резкий unmount; на записи **~200 мс пустого белого списка** между скелетоном (t≈579…1515) и строками (t≈1685–1750) |
| Аватарки | `avatar-photo.fade-in` → `fade-in-opacity .2s ease forwards` (класс снимается после) | CSS портирован (_avatar.scss:126), класс **не ставится** — фото появляются резко |
| Статус соединения | «Connecting…/Updating…» в плейсхолдере поиска **не раньше 2000 мс** (connectionStatus.ts:19) | «Обновление…» с первого кадра, пока `!loaded` (Sidebar.tsx:213) |
| Пустой центр | только обои; `#column-center > .chats-container > .chat.tabs-tab.active` создаётся всегда | пилюля «Выберите чат, чтобы начать общение» (`_emptyPill_`) — фича Web A/Z, в tweb K её нет |
| После логина | `main-screen-enter` scale 1.75→1, 200 мс (флаг should_animate_main) | портировано и совпадает (accountTransition) |
| Повторный заход | диалоги из кэша состояний, скелетон гейтится `loadedDialogsAtLeastOnce` | IDB-гидрация до рендера — список в первом кадре (t=427 при тёплом старте всё уже на месте). Эквивалентно |

## DOM-сверка (загруженное состояние)

Эталон: §1 референса. Наш дамп — стенд, day-тема.

Совпадает: каркас `#page-chats.whole.page-chats > #main-columns.tabs-container > #column-left(.tabs-tab.chatlist-container.sidebar.sidebar-left.main-column…) / #column-center.tabs-tab.main-column`, `sidebar-header` с `input-search`, `.sidebar-content.transition.zoom-fade`, `#new-menu.btn-corner`, `.sidebar-left-overlay`, `.stories-list`, `.topics-slider`, resize-handle.

Расхождения:

1. `body`: у нас нет `is-left-column-shown` (tweb ставит в `appImManager.selectTab`); лишний `has-pending-suggestion` (наш баннер уведомлений — вне скоупа инициализации).
2. `#initial-loader.hide` остаётся в DOM зомби-узлом (transitionend-remove не сработал) — уходит вместе со сплешем.
3. Слой обоев: у нас `div[style="position:fixed…"]` внутри `#root` с inline-стилями; в tweb — css-module `.Layer` первым потомком `body`.
4. `#column-center`: у нас `._empty_ > ._emptyPill_`, в tweb — пустой `.chat.tabs-tab.active` (+ `.pinned-container`).
5. svg-спрайт: у нас внутри `#root`, в tweb — статически в body (не влияет на визуал; не трогаем).
6. У нас отсутствует `#folders-sidebar` (вертикальные папки) — вне скоупа этой сверки.

## Вне скоупа порта (зафиксировано отдельно)

- Сдвиги списка от FolderTabs/StoriesRow при догрузке — механика совпадает с tweb (папки и там раскрываются после загрузки фильтров через `--chatlist-overlay-height`), отдельного фикса не требует.
- QR-поллинг (`SignQRCard`, 2 с) выедает nginx-лимит `5r/m` зоны `/api/auth/` → `request_code` получает 429, карточка телефона показывает «Phone Number Invalid». Инфраструктурный конфликт: вынести `/auth/qr/` из зоны `auth` или поднять лимит.

---

# После порта (контрольный прогон 2026-08-09)

Ветка `feat/tweb-init-sequence`, прод-сборка в `client-build`, стенд https://localhost:38443,
чистый browser-контекст (эквивалент «первого в жизни захода»), токен подложен в IDB `msgr/kv`.

## Что подтверждено живьём

| Проверка | Результат |
|---|---|
| `#initial-loader` в DOM | отсутствует (`hasLoader: false`); зомби-узла тоже нет |
| Слой обоев — первый потомок `body` | да: `<div><div class="_Layer_…"><div class="_Slot_… _SlotActive_…"><canvas class="_GradientCanvas_…">` |
| Пустой центр | `#column-center > .chats-container > <div class="chat tabs-tab active"></div>` — пилюли нет |
| Классы `body` | `rounded-sections animation-level-2 has-horizontal-folders right-column-floats is-left-column-shown has-pending-suggestion`; `has-auth-pages` снят кадром позже |
| Список чатов | рендерится, строки на месте, ошибок в консоли нет |
| Порядок появления | сайдбар ≈130 мс → обои ≈260 мс (при кэшированном бандле) |

## Не подтверждено живьём

**Канвас-скелетон и волна стирания в браузере не сняты.** На локальном стенде диалоги приходят
за ~150 мс, и окно показа скелетона короче шага опроса; попытки удлинить его (перехват `/api/chats`
через Playwright route, удаление БД `msgr-store`) стопорят SharedWorker и приводят к пустому `#root` —
это артефакт харнесса, а не поведение приложения: без перехвата приложение монтируется штатно.

Косвенные подтверждения: юнит-тесты `easeInOutSine` и `detachRowProgress` (TDD, red→green);
построчная сверка порта с `TWEB/src/helpers/dialogsPlaceholder.ts` и `canvas/shimmer.ts` в ревью
(геометрия, кэш случайных ширин, `inc/lightSpread/pauseInterval`, DPR, resize);
интеграция в `ChatList.tsx` прочитана — `<ul class="chatlist">` в DOM всегда, плейсхолдер вешается
в `useLayoutEffect` при `!loaded && !hydratedFromCache`, снимается волной в `useEffect` по `loaded`.

**Как посмотреть вручную:** закрыть все вкладки стенда (чтобы отпустить SharedWorker) → DevTools →
Application → IndexedDB → удалить `msgr-store` → Network: Slow 3G → открыть стенд.

## Отклонения от исходного плана (правки в сторону tweb)

1. **`easeInOutSine`** — план дал формулу без ограничителя `t >= d`, который есть в оригинале
   (`TWEB/src/helpers/easing/easeInOutSine.ts:2-3`). Без него волна не завершается и навсегда
   оставляет `overflow-y: hidden` на скролле. Реализован оригинал.
2. **Fade-in аватарок** — план утверждал «анимация отыгрывает всегда, ничего не гейтить». В tweb
   `animate = !cached && liteMode.isAvailable('animations') && !props.noFadeIn` (`avatarNew.tsx:549`),
   а `<img>` вставляется в DOM только после загрузки (`:597`). Реализована механика tweb:
   старт анимации привязан к готовности картинки, кэш и `animation-level-0` анимацию отключают.
3. **Обои** — план описывал готовность только для canvas-ветки; для пользовательских обоев-картинки
   добавлено честное отслеживание загрузки и обработчики ошибок (иначе слой оставался бы `opacity: 0`).

## Остаточные наблюдения

- Сайдбар появляется раньше обоев (~130 мс против ~260 мс), т.к. слот обоев ждёт загрузки узора,
  а `#main-columns` — только шрифтов (при их кэше — сразу). В tweb тот же принцип (`readyPromise`
  ждёт `renderImageFromUrl`), но `attach()` вызывается до построения UI. Расхождение по ощущению,
  а не по механике; при холодном узоре tweb ведёт себя так же.
- Отложенные мелочи (не блокирующие) перечислены в леджере
  `.superpowers/sdd/2026-08-09-tweb-init-sequence-port/progress.md`.

## Проверка раскладок после финальной правки

`is-left-column-shown` в первой редакции ставился навсегда (по плану), тогда как в tweb это
переключатель активной вкладки (`TWEB/src/lib/appImManager.ts:2593`). Портированный CSS уже трактует
класс именно так, поэтому на узких экранах открытый чат уезжал за экран. Исправлено хуком
`useLeftColumnShown` (класс держится, когда чат НЕ открыт). Проверено живьём:

| Ширина | Чат не открыт | Чат открыт |
|---|---|---|
| 480 | список виден, центр не отрисован | центр на весь экран, списка нет |
| 700 | список виден, центр не отрисован | центр на весь экран, списка нет |
| 1000 | обе колонки видны | обе колонки видны |
| 1280 | обе колонки видны | обе колонки видны |

## Осознанно оставленные мелочи

Триаж финального ревью — не блокируют мерж:

- `index.html` — `<meta name="color-scheme">` без self-closing (1:1 с `TWEB/index.html:17`).
- `ChatBackground` — при сбое `pattern.svg` `imgRef` остаётся `null`, повторные попытки на каждой
  смене темы идут из HTTP-кэша; слот при этом уже активирован.
- `useShellEnterAnimation` — флаг `ANIMATE_MAIN` потребляется до early-return (недостижимо: `#page-chats`
  рендерит сам Shell).
- Shell/AuthFlow — неотменяемый `doubleRaf` при мгновенном re-logout может один раз пропустить гейт
  transition; экран не ломается.
- `Avatar` — `useLayoutEffect` даёт второй коммит рендера для кэшированных аватарок (React делает
  bail-out на горячем пути).
- `dialogsPlaceholder` — rAF-цикл не снимается, если анимации выключить посреди волны; это 1:1 с tweb,
  там в исходнике тот же комментарий.
- Предсуществующее (вне скоупа): JS-порог мобильной раскладки 900px не совпадает с CSS-брейкпоинтами
  `handhelds` 600px / `floating-left-sidebar` 925px.
