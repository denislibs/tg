# Сверка инициализации: tweb vs наш клиент (DOM + покадрово)

Дата: 2026-08-09. Источники: исходники tweb (`/Users/denisurevic/Documents/tweb`), живой DOM-референс
`2026-08-08-tweb-live-dom-reference.md` (§1, §11), живой прогон нашего клиента на стенде msgrverify
(https://localhost:38443, Playwright: CDP-скринкаст холодного старта с Fast-3G-троттлингом и чисткой
SW/IDB-кэша диалогов, залогиненный пользователь id 61).

План устранения расхождений: `../superpowers/plans/2026-08-09-tweb-init-sequence-port.md`.

## Покадровая последовательность

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
