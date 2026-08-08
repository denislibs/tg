# P0 tweb-parity Implementation Plan

> **СТАТУС (2026-08-08): batch 1 ВЫПОЛНЕН и влит в ветку `feat/p0-tweb-parity`** (волны A/G/H/J + verify-проход — P0 №1, 14–20, 32–35).
> **Batch 2 и 3 ОТМЕНЕНЫ** и заменены планом [«tweb structure-first»](./2026-08-08-tweb-structure-first.md):
> после съёма живого DOM-референса tweb решено сначала перестроить структуру и стили на классы tweb,
> и только потом доделывать поведение. Задачи batch 2/3 перенесены в фазы 2–7 нового плана.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть все 35 находок P0 из аудита `docs/research/2026-08-08-tweb-deep-structural-audit.md` — довести web-client до tweb 1:1 по критичным расхождениям DOM/стилей/анимаций/поведения.

**Architecture:** Спецификация каждой задачи = соответствующий раздел аудита + исходники tweb (`/Users/denisurevic/Documents/tweb`, commit e52b5d931). Правило: портировать 1:1 из tweb, не выдумывать. Работа идёт волнами: сначала фундамент (токены/шрифт, анимационная база), затем независимые домены параллельно, в конце — каркас бабла (самая связная зона).

**Tech Stack:** React 19 + TS strict + SCSS-модули; сборка Vite 8; тесты vitest; `npm run typecheck` — TS7 native; oxlint.

## Global Constraints

- Референс — tweb в `/Users/denisurevic/Documents/tweb` (все `файл:строки` — из аудита, перепроверять по контексту).
- Никакого нового framer-motion; там, где задача касается анимаций, — CSS/WAAPI как в tweb.
- Не рендерить пользовательский контент сырой HTML-строкой; DOM — только React-нодами.
- Цвета/размеры — через токены (`--danger-color`, `--surface-color`, …), не хардкодами.
- После каждой волны: `npm run typecheck && npm run lint && npm test && npm run build` в `web-client/` — всё зелёное.
- Коммиты — на ветке `feat/p0-tweb-parity`, по одному на домен волны.

---

## Волна A — Токены и шрифт (P0 №1)

### Task A1: Забандлить Roboto + Roboto Mono
**Files:** Create `web-client/src/styles/_fonts.scss` (+ woff2-ассеты в `web-client/src/assets/fonts/`), Modify `web-client/src/styles/index.scss`.
**Референс:** tweb `src/scss/fonts/_roboto.scss`, `_robotoMono.scss` (веса 400/500, cyrillic+latin, woff2; скопировать файлы шрифтов из tweb `public/assets/fonts/` или `src/assets`). Стек: `Roboto, -apple-system, apple color emoji, BlinkMacSystemFont, "Segoe UI", …` (base.scss:126), моно `'Roboto Mono', monospace` + глобально `pre,code,kbd`.
**Acceptance:** в собранном бандле есть woff2; computed font-family body = Roboto (реально загруженный).

### Task A2: Порт `:root`-блока tweb base.scss:39-225
**Files:** Modify `web-client/src/styles/_tokens.scss`, `web-client/src/styles/index.scss`.
Добавить недостающие токены (полный список — аудит §1.1): `--transition-*` (standard/layer/tabs/btn-menu/input/popup/btn-corner/chatlist-badge), `--line-height` + шкала `--line-height-11..24`, `--font-*` (regular/monospace/rounded/weight-bold:500/weight-normal), ripple-токены (+медиа ≤925px override), `--scrollbar-color`, `--disabled-opacity:.3`, `--badge-text-color:#fff`, `--avatar-online-color:var(--primary-color)`, `--chatlist-status-color`, `--chatlist-pinned-color`, `--danger-color`-семейство (если не эмитится themeController — добавить в его colorMap/производные), `--input-placeholder-color`, `--spoiler-background-color`, `--old-input-background-color` и пр. `--ripple-color` вернуть к альфе .08.
Плюс глобально: `body { user-select: none }` (инпуты/сообщения — разрешить выделение точечно как tweb `.selectable`), фон body от токена `--body-background-color`, `Text` line-height 1.3125, замена `font-weight: 600` → `var(--font-weight-bold)` (=500) в кит-компонентах (Badge, Avatar, SidebarSection, Tabs, Input-label, ScrollDownFab).
**Acceptance:** grep по перечисленным токенам находит определения; UI не разваливается (смок в сборке).

## Волна B — Анимационный фундамент (P0 №28–31)

### Task B1: animationIntersector (порт tweb)
**Files:** Modify `web-client/src/components/animationIntersector.ts` (сейчас shim), потребители: `StickerMedia.tsx`, `LottieSticker.tsx`, custom-emoji рендер.
**Референс:** tweb `src/components/animationIntersector.ts:43-452` — единый IntersectionObserver, группы (`chat`, `EMOJI`…), visible-Set, `onlyOnePlayableGroup`, lock/unlock, idle-пауза (наш аналог idleController — можно минимально: visibilitychange). Портировать ядро: регистрация анимаций (lottie player / video) с группой, play/pause по пересечению, checkAnimations(paused, group).
**Acceptance:** стикеры/лотти вне вьюпорта ставятся на паузу (юнит на реестр + ручной смок).

### Task B2: heavy-animation событие
**Files:** Create `web-client/src/core/dom/heavyAnimation.ts`; подключить в: переходы экранов (`motion.ts`-обёртки/TabSlide), `smoothScrollToElement`, ladder-появление баблов, theme toggle.
**Референс:** tweb `src/hooks/useHeavyAnimationCheck.ts` + вызовы `dispatchHeavyAnimationEvent` (transition.ts:362-369, fastSmoothScroll.ts:87, bubbles.ts:10442). API: `dispatchHeavyAnimationEvent(promise, timeout)`, `onHeavyAnimation(cb)`; animationIntersector подписывается и глушит анимации на время.
**Acceptance:** во время слайда экрана lottie на паузе (смок).

### Task B3: reduceMotion CSS-гейт
**Files:** Modify `web-client/src/styles/index.scss`.
`html[data-reduce-motion] * { transition-duration: 0s !important; animation-duration: 0s !important; animation-iteration-count: 1 !important; }` (+ исключение для необходимых, если что-то ломается — например RadialProgress оставить).
**Acceptance:** при включённом reduceMotion CSS-ховеры/появления мгновенны.

### Task B4: navigation-параллакс (−25% + brightness 80%)
**Files:** Modify `web-client/src/motion.ts` (новый вариант `navigation`-перехода: пара enter/exit для стека экранов), применить в потребителях `slideInRight`: `SettingsView.tsx`, `SettingsSubScreen.tsx`, `ContactsView.tsx`, `CallsView.tsx`, `settings/kit.tsx`, `SidebarScreens.tsx` и др. (grep slideInRight).
**Референс:** tweb `components/transition.ts:23-43` + `_slider.scss:226-243`: входящий `translateX(100%→0)`, уходящий `translateX(0→-25%)` + `filter: brightness(80%)`; 0.3s in / 0.25s out `cubic-bezier(.4,0,.2,1)`.
**Acceptance:** при открытии подэкрана настроек нижний экран уезжает на −25% и темнеет.

## Волна G — Попапы (P0 №14–16)

### Task G1: ConfirmPopup (порт PopupPeer)
**Files:** Create `web-client/src/shared/ui/ConfirmPopup/ConfirmPopup.tsx` + `.module.scss`; Modify `web-client/src/components/messages/ChatDialogs.tsx` (delete/discard-конфирмы), `web-client/src/components/MutePopup.tsx`.
**Референс:** tweb `popups/peer.ts:36-120`, `popups/index.ts:247-320`, `_peer.scss`: каркас общего `.popup` (скрим .3, translateY 3rem→0 .15s cb(.4,0,.2,1)), контейнер min-width 19.5rem/max 25rem, padding .75rem .5rem, radius 2.5rem; header 2.5rem (опц. avatar 32 + title 1.25rem/500); description; чекбоксы; `.popup-buttons` — **горизонтально row-reverse**, текстовые кнопки 2.5rem UPPERCASE weight 500 danger/primary через токены, вертикально при ≥3; Cancel добавляется автоматически; Esc/Enter.
**Acceptance:** все конфирмы приложения выглядят как tweb-конфирм (горизонтальные капс-кнопки).

### Task G2: Delete-попап с чекбоксом revoke
**Files:** Modify `web-client/src/components/messages/ChatDialogs.tsx` (использовать ConfirmPopup).
**Референс:** tweb `popups/deleteMessages.ts:84-160`: заголовок «Delete N messages», чекбокс «Also delete for <имя (first name)>» (personal) / «Delete for all», ОДНА danger-кнопка Delete + Cancel.
**Acceptance:** удаление своего сообщения в личке показывает чекбокс с именем собеседника.

### Task G3: SchedulePopup = календарь withTime
**Files:** Modify `web-client/src/components/SchedulePopup.tsx`, `web-client/src/components/DatePickerPopup.tsx` (+`.module.scss`) — добавить режим `withTime`.
**Референс:** tweb `popups/datePicker.tsx:214-256, 518-600`, `scheduleSendingPopup.tsx:50-70`: под календарём два InputField 80px (часы/минуты) с разделителем `:`, живой лейбл кнопки «Send Today at HH:MM», минимальное время = сейчас+ шаг, «Send when online» вторичной кнопкой.
**Acceptance:** планирование сообщения открывает календарь tweb с полями времени; нативных input[type=date/time] нет.

## Волна H — Правый сайдбар (P0 №17–20)

### Task H1: transform-анимация панели вместо width
**Files:** Modify `web-client/src/components/UserInfoPanel.tsx`, `UserInfoPanel.module.scss`, `ConversationView.tsx:1184-1195` (монтирование).
**Референс:** tweb `_rightSidebar.scss:3-77`: колонка фикс-ширины **360px**, всегда в DOM, закрыта `transform: translate3d(width+padding,0,0)`, открыта `translate3d(0,0,0)`; transition `--transition-standard-in/out`; `inert` при скрытии; без opacity-фейда. Чат-колонка меняет ширину через grid/flex (у нас — margin-right контейнера), но панель НЕ анимирует width.
**Acceptance:** открытие профиля — чистый transform-слайд, layout чата не «дышит» покадрово.

### Task H2: Кликабельные Phone/Username/Bio (+копирование)
**Files:** Modify `web-client/src/components/UserInfoPanel.tsx`, `web-client/src/components/settings/kit.tsx` (Row clickable+ripple), тост через `useGlobalToast`.
**Референс:** tweb `peerProfile.tsx:655-658, 706-709, 914-921` — клик копирует значение и показывает toast (PhoneCopied/UsernameCopied/BioCopied); bio — `pre-wrap` (многострочный).
**Acceptance:** клик по строке телефона копирует и показывает тост; bio переносится.

### Task H3: Infinite scroll в shared media
**Files:** Modify `web-client/src/components/userInfo/SharedMedia.tsx`, `web-client/src/core/managers/*` (mediaHistory: параметр offset/before), при необходимости бэк-ручка уже поддерживает пагинацию (проверить `backend` handler media history; если нет — добавить `before_id`).
**Референс:** tweb `appSearchSuper.ts` — load по скроллу с loadMutex.
**Acceptance:** прокрутка вкладки «Media» дозагружает старые элементы.

### Task H4: Морф аватар-хедера (один DOM, is-collapsed)
**Files:** Modify `web-client/src/components/UserInfoPanel.tsx:94-434`, `UserInfoPanel.module.scss:114-241`.
**Референс:** tweb `_profile.scss:4-399`, `peerProfileAvatars.ts:243-347`: один контейнер, класс `is-collapsed`; `padding-bottom: 100% ↔ 66%` (transition .3s); активный аватар collapsed: `translateY(-3%) scale(120/400) + border-radius 50%`; `.profile-avatars-info` — одни узлы имени/статуса в обоих состояниях (collapsed: центрирование + translateY(-33%)).
**Acceptance:** скролл-коллапс профиля морфит фото в кружок без размонтирования.

## Волна J — Auth и поиск по чату (P0 №32–35)

### Task J1: Country-picker полный
**Files:** Modify `web-client/src/components/auth/AuthFlow.tsx` (+создать `web-client/src/components/auth/CountryInput.tsx` и данные стран из `web-client/src/countries.ts`-аналога; в проекте уже есть `src/countries.ts`? — проверить; если нет, портировать список из tweb `src/countries.ts`).
**Референс:** tweb `components/countryInputField.ts` — outlined input c floating label «Country», стрелка, дропдаун со всеми странами (эмодзи-флаг + имя + код), живой фильтр по имени/аббревиатуре, выбор подставляет код в поле телефона.
**Acceptance:** в поле страны можно напечатать «Ger» и выбрать Germany; кода из 8 стран больше нет.

### Task J2: Code-input единым полем
**Files:** Create `web-client/src/components/auth/CodeInput.tsx` + `.module.scss`; Modify `AuthFlow.tsx:403-441`.
**Референс:** tweb `components/codeInputField.tsx:187-291`: один невидимый `<input autocomplete="one-time-code">` absolute поверх, отрисованные ячейки `.digit` 48×48 r12 gap10; вставка из буфера работает; цифра влетает `translateY(20px)→0` `cubic-bezier(.175,.885,.32,1.275)`, удаление scale(.5); мигающий caret в активной ячейке.
**Acceptance:** Cmd+V пятизначного кода заполняет все ячейки; автозаполнение из SMS-подсказки работает.

### Task J3: TrackingMonkey на шаге кода
**Files:** Modify `web-client/src/components/PasswordMonkey.tsx` (или создать `TrackingMonkey.tsx` рядом), `AuthFlow.tsx` (codeStep hero).
**Референс:** tweb `components/monkeys/tracking.ts` — lottie `TwoFactorSetupMonkeyTracking`, кадр = f(длина введённого кода): сегмент 0..179, глаза следят (frame ≈ (1+len)/max*45→165). Ассет взять из tweb `assets/tgs` (положить в наш assets).
**Acceptance:** обезьянка на шаге кода следит за вводом.

### Task J4: Стрелки prev/next в поиске по чату
**Files:** Modify `web-client/src/components/conversation/ChatSearchCard.tsx`, `web-client/src/core/hooks/useChatHeaderSearch.ts`, `ChatHeader.module.scss`.
**Референс:** tweb `chat/topbarSearch.tsx:695-721` — кнопки ↑/↓ в tools инпута (скрыты при count=0), навигация activeIdx с прыжком к сообщению и скроллом результата к центру; список результатов max-height 271px с height-transition.
**Acceptance:** стрелки листают совпадения с прыжком по чату; список ограничен 271px.

## Волна E — Каркас чата (P0 №7–12)

### Task E1: floating-plates высота → padding/маска ленты
**Files:** Modify `web-client/src/components/ConversationView.tsx` (paddingTop/fade формулы: учесть высоту пин-бара и плеера как `--pinned-floating-height`).
**Референс:** tweb `_chat.scss:486` (`--chat-padding-top = topbar + page-padding + pinned-floating-height`), topbar.ts:1539-1576 (`setFloating`), `--bubbles-scrollable-fade-top-add`.
**Acceptance:** при пине первый бабл не перекрыт; верхний фейд растёт вместе с плейтами.

### Task E2: Pinned bar — скролл-трекинг + анимация смены
**Files:** Modify `web-client/src/core/hooks/usePinnedBar.ts`, `web-client/src/components/conversation/PinnedBar.tsx` + `.module.scss`.
**Референс:** tweb `pinnedMessage.tsx:529-589` (setCorrectIndex: показываемый пин = ближайший ≤ нижнему видимому сообщению; по скроллу throttle 100ms), анимация смены — AnimatedSuper-аналог: контейнер overflow hidden, старая строка/медиа уезжает translateY(±20px), новая въезжает, .2s ease-in-out (реализовать маленьким CSS-компонентом, без framer); заголовок «Pinned message #N» с анимированным счётчиком (можно простым кросс-слайдом цифр); медиа-превью 32×40 слева при is-media.
**Acceptance:** при скролле плашка показывает соответствующий пин со слайдом текста.

### Task E3: goto-mention / goto-reaction кнопки
**Files:** Modify `web-client/src/components/conversation/ScrollDownFab.tsx` (или создать `CornerButtons.tsx`), `ConversationView.tsx`; бэк: проверить наличие счётчиков mentions/reactions unread в сторе (есть mention-бейджи в чат-листе — переиспользовать); если реакций-счётчика нет на бэке — реализовать только goto-mention, а goto-reaction пометить блокером бэка в коммит-сообщении.
**Референс:** tweb `input.ts:824-880`, `_chat.scss:1356-1391`: столбик btn-corner кнопок над go-down (mention: иконка @, badge-24), клик = прыжок к следующему упоминанию, по исчерпании — скрытие; появление только opacity/visibility `--layer-transition`.
**Acceptance:** при непрочитанном упоминании над стрелкой вниз появляется кнопка @ с бейджем, клик ведёт к сообщению.

### Task E4: Sticky-date скрывается после остановки скролла
**Files:** Modify `web-client/src/components/messages/ChatFeed.tsx`, `ChatFeed.module.scss`.
**Референс:** tweb `_chatBubble.scss:498-506` + `_chat.scss:1343-1353`: прилипшая дата `opacity ~0`, при скролле класс `.is-scrolling` на контейнере → opacity 1; transition `opacity .3s ease`; детект «прилипла» — IntersectionObserver по sentinel или сравнение offsetTop.
**Acceptance:** дата-пилюля видна при скролле и растворяется через ~0.3s после остановки (кроме момента, когда день начинается на экране).

### Task E5: CommentsBar — реальные аватары
**Files:** Modify `web-client/src/components/CommentsBar.tsx`; бэк: ручка комментариев уже отдаёт recent-авторов? Если нет — расширить DTO треда (`backend`) полем recent_repliers (до 3 карточек id/name/avatar) по образцу ReactionsFor из PR #144.
**Референс:** tweb `chat/replies.ts` — stacked-avatars последних комментаторов; наш `StackedAvatars` уже есть.
**Acceptance:** под постом канала аватары — реальных комментаторов; хардкод-градиентов нет.

### Task E6: Переход между чатами (tabs-слайд)
**Files:** Modify `web-client/src/App.tsx:105-118` (обёртка вокруг ConversationView), новый CSS-переход в `App.module.scss` или `motion.ts`.
**Референс:** tweb `_chat.scss:489-506`: `.chat` как tabs-tab — вход `translate3d(±200px)→0` + opacity, `.2s ease-in-out`; при смене чата старый контент уезжает ∓200px с fade (достаточно одноуровневого кросс-слайда по key, heavy-animation event на время).
**Acceptance:** переключение диалога — слайд ±200px с фейдом, не мгновенный ремаунт.

## Волна F — Левый сайдбар (P0 №13)

### Task F1: Сториз-fold в поисковую строку
**Files:** Modify `web-client/src/components/StoriesRow.tsx` + `.module.scss`, `web-client/src/components/Sidebar.tsx` (скролл-хендлер листа → progress), `ChatList.tsx` (источник scrollTop), задействовать/переписать мёртвый `StoriesStack`.
**Референс:** tweb `stories/list.tsx:124-243`: progress 0..1 от scrollTop (0..92px); контейнер `height: 92*(1-p)`, `translateY(p*−69px)`; каждый item летит к правому краю поля поиска: `translateX` к слоту, scale к 26px, стек первых 3 с офсетом; имена fade `opacity 1−p*1.25`; `--stories-scrolled` поднимает список. Слот в InputSearch `right` уже есть.
**Acceptance:** скролл чат-листа вниз сворачивает ряд историй в стопку аватарок в строке поиска; скролл вверх разворачивает.

## Волна I — Медиавьюер, плеер, сториз (P0 №21–27)

### Task I1: Caption в медиавьюере
**Files:** Modify `web-client/src/components/messages/MediaLightbox.tsx` + `.module.scss`.
**Референс:** tweb `mediaViewer.scss:113-217`, `index.ts:112-143, 304-356`: `.media-viewer-caption` по центру снизу (bottom 0), max-height 6rem scrollable, max-width 50rem, `--link-color:#60a5e9`, opacity .4→1 hover; RichText-рендер подписи сообщения.
**Acceptance:** фото с подписью показывает подпись внизу вьюера.

### Task I2: Слайд листания prev/next
**Files:** Modify `MediaLightbox.tsx` (`nav()`), `.module.scss`.
**Референс:** tweb `base.ts:1928-1956` (`moveTheMover`): текущий мовер уезжает за экран `350ms ease` (класс `.moving`), новый въезжает с противоположной стороны; убрать кольцевое листание — на краях кнопка скрывается (`.hide`).
**Acceptance:** стрелки листают со слайдом; на первом/последнем элементе соответствующая стрелка скрыта.

### Task I3: Большая центральная play-кнопка плеера
**Files:** Modify `web-client/src/components/messages/VideoControls.tsx` + `.module.scss`.
**Референс:** tweb `_ckin.scss:44-79, 169-184`: `button 4rem` по центру (иконка largeplay), видна на паузе, скрыта в `is-playing/is-seeking/is-buffering`.
**Acceptance:** пауза видео показывает большую центральную кнопку; клик запускает.

### Task I4: Сториз — карусель соседей + переход
**Files:** Modify `web-client/src/components/StoryViewer.tsx` + `.module.scss`, `useStoryViewer.ts`.
**Референс:** tweb `viewer.tsx:1742-1754`, `viewer.module.scss:146-209, 470-506`: рендерить соседних авторов рядом (`--scale:.33`, `--translateX` по формуле с MARGIN 40, медиа затемнено opacity .5, большой аватар+имя поверх), активный — scale 1; переключение автора — transition transform контейнеров (слайд карусели), 0.3s; клик по соседу переключает.
**Acceptance:** в десктоп-вьюере видны уменьшенные соседние истории; переход — слайдом.

### Task I5: Сториз — открытие из аватарки
**Files:** Modify `StoryViewer.tsx` (Web Animations API), `StoriesRow.tsx` (rect источника).
**Референс:** tweb `viewer.tsx:3069-3103, 3151-3315`: 250ms `cubic-bezier(.4,0,.6,1)`; клон аватарки летит в шапку (scale rect/32→1); контейнер из rect аватарки `translate3d+scale3d+borderRadius 50%→0`; реверс на закрытие.
**Acceptance:** история открывается «вырастая» из аватарки и закрывается обратно.

### Task I6: Видео-история — длительность и прогресс от видео
**Files:** Modify `StoryViewer.tsx:150-166` + `.module.scss` (убрать CSS 5s-анимацию для видео; прогресс из timeupdate/rAF).
**Референс:** tweb `viewer.tsx:1756-1765`: длительность сегмента = duration видео; фото = 5s.
**Acceptance:** сегмент заканчивается ровно с видео; next не стреляет посреди ролика.

### Task I7: Звук видео-историй + кнопки play/pause и mute в header
**Files:** Modify `StoryViewer.tsx:136, 168-208`.
**Референс:** tweb `viewer.tsx:1792-1813, 2701-2716`: видео не muted; в header кнопки [play/pause][mute] (mute только для видео; tooltip «no sound» если дорожки нет).
**Acceptance:** видео-история играет со звуком; mute переключается кнопкой.

## Волна C — Каркас бабла и медиа (P0 №2–5)

### Task C1: mediaSizes + setAttachmentSize
**Files:** Create `web-client/src/core/dom/mediaSizes.ts`; Modify `web-client/src/components/messages/RealMediaBubble.tsx` (убрать BOX_W/BOX_H), `AlbumGrid.tsx` (maxWidth 420/spacing 1), `SecretMediaBubble.tsx`.
**Референс:** tweb `helpers/mediaSizes.ts:64-101` (regular 420×400 desktop / 340×340 ≤600px; album 420/340), `setAttachmentSize.ts:64-94` (мин-сторона 200 aspectCovered; текст/reply → ширина ≥320 c blur-подложкой-aspecter; мин 120 / видео 368).
**Acceptance:** размеры фото/альбомов совпадают с tweb (спот-чек нескольких соотношений); узкое фото с подписью расширяется до 320 с blur-краями.

### Task C2: Единый каркас бабла + reply/имя/forward у всех типов
**Files:** Modify `web-client/src/components/messages/MessageContent.tsx`, `MessageRow.tsx`, `MessageRow.module.scss`, `MessageBubbles.module.scss`, `bubbleParts/primitives.tsx`.
**Референс:** аудит §4.1; tweb `bubbles.ts:9337-9598` (nameContainer вставляется одинаково), `_chatBubble.scss:1059-1125` (floating-плашка `.name-with-reply` над just-media: фон `--message-time-background`, radius, поверх медиа). Ввести общий wrapper (`bubbleWrap` → у всех типов), в который перед контентом монтируются name/forward/reply; для just-media (фото/альбом/стикер/кружок) — floating-плашка поверх, как tweb.
**Acceptance:** ответ на фото/voice/документ показывает reply-блок; forward-подпись есть у всех типов.

### Task C3: Blockquote по tweb
**Files:** Modify `web-client/src/components/RichText.tsx`, `RichText.module.scss`.
**Референс:** tweb `_quote.scss:57-106, 124-146`: фон `rgba(peer-color,.1)`, radius 4px, полоса 3px peer-цветом (`:before`), иконка цитаты в правом верхнем углу, padding `1px .5625rem 1px .625rem` (+место под иконку), font secondary; коллапс до 3 строк с экспандер-стрелкой (`.can-truncate` + toggle).
**Acceptance:** цитата в сообщении выглядит как tweb (фон+полоса+иконка), длинная — сворачивается.

### Task C4: Инлайн-автоплей видео ≤50 МБ
**Files:** Modify `web-client/src/components/messages/RealMediaBubble.tsx` + `.module.scss`.
**Референс:** tweb `video.ts:50, 129-176, 550-579`: `<video muted loop autoplay playsInline>` для видео ≤ 50 МБ (MAX_VIDEO_AUTOPLAY_SIZE), в бейдже иконка nosound, на timeupdate бейдж показывает остаток `duration−currentTime`; play-кнопка только если автоплей недоступен; зарегистрировать в animationIntersector (группа chat) для паузы вне вьюпорта.
**Acceptance:** короткое видео в чате играет без звука в бабле, бейдж тикает остаток.

## Волна D — Музыкальный бабл (P0 №6)

### Task D1: AudioBubble играет
**Files:** Modify `web-client/src/components/messages/bubbleParts/mediaBubbles.tsx` (AudioBubble), переиспользовать `AudioPlayIcon`, `audioStore`/`mediaPlaybackController`; Create `web-client/src/shared/ui/MediaProgressLine/*` (порт RangeSelector-минимум: filled+seek+thumb).
**Референс:** tweb `audio.ts:342-444`, `_audio.scss:515-557, 612-658`: кнопка 48px c clip-path play-иконкой, title bold + subtitle `время • исполнитель • размер`; при игре subtitle заменяется на progress-line (`--height:2px; --thumb-size:.75rem`); отдельная очередь музыки (не смешивать с voice); регистрация в NowPlayingBar.
**Acceptance:** клик по музыкальному файлу играет его, в бабле прогресс-полоса, плашка сверху показывает трек.

---

## Порядок исполнения и верификация

1. Batch 1 (параллельно, независимые файлы): **A**, **G**, **H**, **J**.
2. Batch 2 (после 1): **B**, **E**, **F**, **I**.
3. Batch 3 (после 2): **C**, затем **D** (D зависит от структуры баблов C).
4. После каждого batch: `npm run typecheck && npm run lint && npm test && npm run build`; коммит на домен.
5. Финал: полный прогон + смок в сборке; сводка в PR.

**Правила для исполнителей:** читать соответствующий раздел аудита + исходники tweb перед правкой; НЕ коммитить самим (коммитит оркестратор после верификации batch'а); не трогать файлы чужих задач своего batch'а; новые анимации — CSS/WAAPI, не framer.
