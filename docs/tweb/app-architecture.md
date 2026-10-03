# Как устроено веб-приложение tweb: классы + Solid, и как к этому приходит наш клиент

Снято 2026-10-01. Источники:

- исходники tweb `/Users/denisurevic/Documents/tweb`, коммит **`812502980`** (2026-09-25). Все
  адреса `файл:строка` ниже — по нему. В соседних доках часть адресов ещё по старой базе
  `e52b5d931`, поэтому номера строк могут не совпасть: сверяйте по имени функции;
- наш код `web-client/` на `origin/main` = `b024f542` (после PR #356, задача 1-1 волны 7);
- план программы — [`../superpowers/plans/2026-09-30-wave-7-shell-sidebars.md`](../superpowers/plans/2026-09-30-wave-7-shell-sidebars.md).

**Что это за док.** Обзор для человека: как приложение tweb собрано целиком, кто чем владеет и
что происходит по шагам в типовых сценариях. Читается за 30–40 минут. Это не план и не справочник
по каждому классу. Подробности — в соседних доках, ссылки на разделы стоят по ходу текста:

| Тема | Где подробно |
|---|---|
| воркеры, `SuperMessagePort`, `rootScope`, состояние, навигация, колонки, liteMode | [state-and-layout.md](state-and-layout.md) §1–§9 |
| левая колонка, чатлист, папки, поиск | [left-sidebar.md](left-sidebar.md), [folders-tabs.md](folders-tabs.md) |
| правая колонка, слайдер вкладок, профиль | [right-sidebar.md](right-sidebar.md) |
| `Row`/`RowTsx`, `attachRowController`, вкладки настроек | [settings-rows.md](settings-rows.md) |
| лента чата, `ChatBubbles`, скролл | [chat-feed.md](chat-feed.md) |
| попапы, меню, `overlayCounter` | [popups-solid.md](popups-solid.md), [popups.md](popups.md) |
| `animationIntersector`, стикеры | [media.md](media.md) §9 |

---

## Оглавление

0. [Вся картина за минуту](#0-вся-картина-за-минуту)
1. [Старт приложения](#1-старт-приложения)
2. [Два мира: главный поток и воркер](#2-два-мира-главный-поток-и-воркер)
3. [Синглтоны и кто чем владеет](#3-синглтоны-и-кто-чем-владеет)
4. [Как устроен класс-компонент](#4-как-устроен-класс-компонент)
5. [Где Solid внутри классов](#5-где-solid-внутри-классов)
6. [`appImManager` подробно](#6-appimmanager-подробно)
7. [Сквозные сценарии по шагам](#7-сквозные-сценарии-по-шагам)
8. [Как меняется DOM и анимации](#8-как-меняется-dom-и-анимации)
9. [Как это у нас сейчас и куда идём](#9-как-это-у-нас-сейчас-и-куда-идём)
10. [Глоссарий](#10-глоссарий)

---

## 0. Вся картина за минуту

```
                        ┌──────────────── SharedWorker (один на все вкладки) ────────────────┐
                        │  appManagersManager → по набору менеджеров на аккаунт               │
                        │  appMessagesManager, dialogsStorage, appUsersManager, apiManager…  │
                        │  свой rootScope на аккаунт: менеджер зовёт dispatchEvent(...)       │
                        └───────────────▲──────────────────────────────┬─────────────────────┘
                     RPC 'manager'      │                              │ кадр 'event' / 'mirror'
         managers.appXxx.method(...)    │                              ▼
┌───────────────────────────── вкладка (главный поток) ──────────────────────────────────────┐
│ apiManagerProxy (порт к воркеру)   rootScope (шина событий вкладки)   зеркала пиров/сообщений│
│                                                                                             │
│ index.html: #page-chats > #main-columns > #column-left | #column-center | #column-right     │
│                 ▲                       ▲                       ▲                           │
│          appSidebarLeft          appImManager             appSidebarRight                   │
│          (SidebarSlider)         chats[] → Chat           (SidebarSlider)                   │
│          appDialogsManager         ├ ChatTopbar           вкладки SliderSuperTab            │
│           └ DialogElement          ├ ChatBubbles (лента)   └ содержимое на Solid            │
│              (строка = класс,      └ ChatInput (композер)                                   │
│               внутри Solid Row)                                                             │
│                                                                                             │
│ сквозные: appNavigationController (Back/Esc), mediaSizes, themeController, overlayCounter,  │
│           animationIntersector, contextMenuController, uiNotificationsManager …             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

Три мысли, на которых держится всё остальное:

1. **Данные живут в воркере, интерфейс — во вкладке.** Вкладка не владеет ни сообщениями, ни
   диалогами. Она просит воркер через прокси и слушает его события через `rootScope`.
2. **Интерфейс — долгоживущие объекты-синглтоны, а не дерево компонентов.** Колонки, список
   чатов, стек чатов создаются один раз и живут, пока открыта страница. Они точечно меняют свои
   DOM-узлы. Перерисовки «из состояния» на уровне каркаса нет.
3. **Solid — внутри классов, а не вместо них.** Класс владеет узлом во времени (скролл, анимация,
   отмена загрузок). Solid рисует из данных то, что целиком живёт и умирает вместе с показом:
   строку настроек, вкладку, попап.

---

## 1. Старт приложения

### 1.1 Статичный каркас в `index.html`

Каркас трёх колонок лежит прямо в HTML (`index.html:89-115`). Страница чатов спрятана
(`style="display: none;"`), пока не известно, залогинен ли пользователь:

```
body.animation-level-2.has-auth-pages                      index.html:41
├ a#skip-to-content (hidden)                               :87
├ div.sidebar-left-overlay                                 :88
├ div#page-chats.whole.page-chats  (display:none)          :89
│ └ div#main-columns.tabs-container[data-animation=navigation]   :90
│   ├ div#column-left.tabs-tab.sidebar.sidebar-left.main-column   :91
│   │ └ .sidebar-slider.tabs-container
│   │   └ .tabs-tab.sidebar-slider-item.item-main.active   ← вкладка №0: список чатов
│   │     ├ .sidebar-header (бургер, кнопка «назад»)
│   │     └ .sidebar-content.transition.zoom-fade
│   │       ├ #chatlist-container > #folders-container     ← сюда appDialogsManager кладёт папки
│   │       └ #search-container                            ← глобальный поиск
│   ├ div#column-center.tabs-tab.main-column (пустой)      :109   ← appImManager
│   └ div#column-right.tabs-tab.sidebar.sidebar-right.main-column :110
│     └ .sidebar-content.sidebar-slider.tabs-container (пустой)  ← appSidebarRight
├ div#stories-viewer                                       :115
└ <script src="src/index.ts" type="module">                :116
```

Подробнее про классы узлов и брейкпоинты — [state-and-layout.md](state-and-layout.md) §6.1.

### 1.2 `src/index.ts` по шагам

Вся логика старта — один обработчик `DOMContentLoaded` (`src/index.ts:417`):

| Шаг | Где | Что происходит |
|---|---|---|
| 1 | `index.ts:417-428` | полифилы, ширина левой колонки, высота вьюпорта, классы на `<html>` |
| 2 | `:442` | `rootScope.managers = getProxiedManagers()` — с этого момента любой код может звать воркер |
| 3 | `:453-468` | `PasscodeLockScreenController.waitForUnlock(...)` — если стоит код-пароль, ждём его ввода; внутри — тема (`themeController.setThemeListener`, `:456`), фон чата (`:458-459`), язык (`:461`) |
| 4 | `:478` | `apiManagerProxy.loadAllStates()` — состояние всех аккаунтов из IndexedDB |
| 5 | `:487-489` | `singleInstance.start()` — контроль «одна активная вкладка» и версии |
| 6 | `:491`, `:523` | `apiManagerProxy.sendAllStates(...)` — отдаём состояние воркеру, он строит менеджеры |
| 7 | `:510` | `I18n.getCacheLangPackAndApply()` — языковой пакет из кэша |
| 8 | `:534`, `:567-568` | тема и фон ещё раз — уже по настройкам из состояния |
| 9 | `:613` | **развилка**: `authState._ !== 'authStateSignedIn'` |
| 9а | `:640-641` | не залогинен → `import('./pages/mountAuthFlow')` → `mountAuthFlow(authState)` |
| 9б | `:646-673` | залогинен → шрифты, `import('./pages/bootstrapIm')` → `await bootstrapIm()` |

Обе ветки грузятся динамическим `import()`: экран входа не тянет код мессенджера, и наоборот.

### 1.3 `pages/bootstrapIm.ts` — включение мессенджера

`bootstrapIm` идемпотентна (`bootstrapIm.ts:21-23`): её зовёт и `index.ts`, и экран входа после
успешного логина. Шаги (`:25-67`):

```ts
await rootScope.managers.appStateManager.pushToState('authState', {_: 'authStateSignedIn'}); // :25
pageChatsEl.style.display = '';                                          // :28  каркас виден
const [{default: appDialogsManager}] = await Promise.all([
  import('@lib/appDialogsManager'), /* рекордер, шрифты, полифил */ ]);  // :39-46
appDialogsManager.start();                                               // :51  ← всё UI здесь
await doubleRaf();                                                       // :60
document.body.classList.remove('has-auth-pages');                        // :61
setTimeout(() => disposeActiveAuthFlow(), 1000);                         // :65-67
```

Комментарий в шапке (`:11-12`) называет её «процедурной заменой легаси-страницы `pageIm`».
`doubleRaf` перед снятием `has-auth-pages` нужен, чтобы колонки не «въехали» анимацией из
мобильного положения (`:52-59`).

### 1.4 `appDialogsManager.start()` — кто кого конструирует

Неочевидно, но корнем UI служит менеджер списка чатов. Его `start()` (`appDialogsManager.ts:847`)
сначала собирает свою часть (контекст-меню, папки, сторис, `:848-978`), а в конце включает
всех остальных в строгом порядке (`:980-997`):

```ts
PopupElementTsx.MANAGERS = rootScope.managers = managers;  // :980  попапам — прокси менеджеров
appDownloadManager.construct(managers);                     // :981
appSidebarLeft.construct(managers);                         // :983  левая колонка
appSidebarRight.construct(managers);                        // :984  правая колонка
groupCallsController.construct(managers);                   // :985
callsController.construct(managers);                        // :986
conferenceInvitesController.construct(managers);            // :987
appImManager.construct(managers);                           // :988  центр: стек чатов
new ConnectionStatusComponent().construct(...);             // :990
appSidebarLeft.onCollapsedChange();                         // :996
this.onStateLoaded(appState);                               // :997  первая загрузка диалогов
```

Колонки включаются раньше центра. `appImManager.construct` первым делом зовёт
`selectTab(APP_TABS.CHATLIST)` (`appImManager.ts:347`): тот ставит `is-left-column-shown` на `body`
(`:3142`) и `inert` колонкам (`updateColumnAccessibility`, `:3203-3208`). Узлы колонок к этому
моменту уже есть — их взяли конструкторы при импорте (§1.5).

### 1.5 Почему каркас в HTML: двухфазная жизнь синглтона

У каждого крупного объекта UI две фазы:

```
фаза 1: импорт модуля          new AppXxx()            → constructor берёт узел из DOM
фаза 2: appDialogsManager.start → appXxx.construct(managers) → подписки, вложенные объекты
```

Примеры фазы 1 — синглтон создаётся последней строкой модуля и сразу хватает узел:

| Синглтон | Создание | Какой узел берёт |
|---|---|---|
| `appSidebarRight` | `sidebarRight/index.ts:141` | `document.getElementById('column-right')` (`:22`), ищет в нём `.sidebar-slider` (`slider.ts:40`) |
| `appImManager` | `appImManager.ts:3989` | поле `columnEl = document.getElementById('column-center')` (`:259`) |
| `appSidebarLeft` | `sidebarLeft/index.ts:1798` | `document.getElementById('column-left')` (`:149`) |
| `appDialogsManager` | `appDialogsManager.ts:3064` | поле `chatsContainer = document.getElementById('chatlist-container')` (`:765`), `#folders-container` (`:794`) |

Код мессенджера приходит одним динамическим `import('@lib/appDialogsManager')` из `bootstrapIm`
(`bootstrapIm.ts:40`). Этот модуль тянет за собой `appImManager`, обе колонки и всё остальное, и
синглтоны создаются синхронно, в порядке графа импортов, а не в порядке, удобном для разметки.
Если бы узлы рисовал JS из какого-то из этих модулей, конструктор соседа мог бы выполниться раньше
и получить `null`. Каркас в HTML снимает вопрос: узлы есть до первого импорта. Фаза 2 отделена,
потому что ей нужны прокси менеджеров и состояние (шаги 2–6 из §1.2) и потому что `start()`
задаёт порядок явно (§1.4).

---

## 2. Два мира: главный поток и воркер

Механика транспорта подробно — [state-and-layout.md](state-and-layout.md) §1–§2. Здесь — как это
выглядит из кода UI.

### 2.1 Где что живёт

| Главный поток (вкладка) | Воркер (`SharedWorker`, если есть, иначе `Worker`) |
|---|---|
| DOM, классы UI, Solid-компоненты | менеджеры данных: около 60 на аккаунт (`createManagers.ts:72`) |
| `apiManagerProxy` — порт к воркеру (`apiManagerProxy.ts:176`, синглтон `:1479`) | MTProto-сеть, `apiManager`, файлы |
| `rootScope` — шина событий вкладки (`rootScope.ts:339`) | `rootScope` на каждый аккаунт (`createManagers.ts:106`) |
| зеркала пиров и сообщений для синхронного чтения | источник правды для зеркал |

Воркер запускается в `apiManagerProxy`: `new SharedWorker(workerUrl, {type: 'module'})`, если
браузер умеет, иначе `new Worker(...)` (`apiManagerProxy.ts:1060-1073`). Один `SharedWorker`
обслуживает все вкладки: открыли три вкладки — сеть и кэш всё равно одни.

**История.** Так было не всегда. `appImManager` и `appDialogsManager` появились 2020-02-06
(коммит `c4f58a72d`) в папке `src/lib/appManagers/`, рядом с менеджерами данных. MTProto ушёл в
воркер 2020-04-26 (`cce00257b`). Менеджеры переехали туда же вместе с `createManagers.ts` и
`getProxiedManagers.ts` 2022-06-17 (`560f89226`, «Multitabs»). UI-«менеджеры» остались на
главном потоке со старыми именами, в `src/lib/` их перенесли только 2026-01-18 (`a3799386a`).
Отсюда путаница: `appImManager` не менеджер данных, а контроллер интерфейса.

### 2.2 Как `managers.appXxxManager.method()` доходит до воркера

В коде UI вызов выглядит как обычный асинхронный метод:

```ts
const peer = await this.managers.appPeersManager.getPeer(peerId);
```

`managers` — двухуровневый `Proxy` (`getProxiedManagers.ts`):

```ts
// :142-149 — первый уровень: managers.<имя> лениво создаёт прокси менеджера
get: (target, p) => target[p] ??= createProxy(p as string, accountNumber, ack)

// :89-95 — второй уровень: <менеджер>.<метод>(...args) превращается в RPC
return (...args) => apiManagerProxy.invoke('manager', {name, method: p, args, accountNumber}, ack);
```

Дальше по шагам:

```
UI: managers.appPeersManager.getPeer(42)
 └ apiManagerProxy.invoke('manager', {name:'appPeersManager', method:'getPeer', args:[42]})
     superMessagePort.ts:773  создаёт задачу {type:'invoke', id}, кладёт resolve в awaiting[id]
     └ postMessage → воркер
         appManagersManager.ts:97  port.addEventListener('manager', ...)
         └ managers[accountNumber]['appPeersManager']['getPeer'](42)       :111-114
     ← кадр {type:'result', taskId, result}
     superMessagePort.ts:543  processResultTask → awaiting[taskId].resolve(result)
 └ await вернул значение
```

Варианты прокси (`getProxiedManagers.ts:158-167`): обычный (`Promise<результат>`),
`managers.acknowledged.*` (воркер может ответить из кэша сразу, не дожидаясь сети) и
`managers.all.*` (вызов на всех аккаунтах). Типы методов выводятся из
`ReturnType<typeof createManagers>` (`:124-127`): UI получает полную типизацию, не импортируя
код менеджеров.

**Синхронное чтение.** Ходить в воркер ради каждого имени собеседника дорого. Поэтому воркер
шлёт во вкладку кадры `mirror` (`apiManagerProxy.ts:1413`), и вкладка держит зеркала: например,
`apiManagerProxy.getPeer(peerId)` (`:1277`) отвечает синхронно, из памяти. Так устроены проверки
в `setPeer` (`appImManager.ts:3300`) и клик по чату (`appDialogsManager.ts:2222`).

### 2.3 `rootScope` — шина событий

`rootScope` — типизированный эмиттер (`RootScope extends EventListenerBase`, `rootScope.ts:278`).
Подписка — `rootScope.addEventListener('имя', cb)`, рассылка — `dispatchEvent`. Особенность: его
`dispatchEvent` переопределён так, что событие **уходит ещё и через порт** (`rootScope.ts:306-316`):

```ts
this.dispatchEvent = (e, ...args) => {
  super.dispatchEvent(e, ...args);                         // локальные подписчики
  MTProtoMessagePort.getInstance().invokeVoid('event', {   // и всем по ту сторону порта
    name: e, args, accountNumber
  });
};
```

Путь события из воркера во вкладку:

```
воркер: this.rootScope.dispatchEvent('dialogs_multiupdate', map)
 └ invokeVoid('event', {...})  ── порт ──►  вкладка: apiManagerProxy.ts:446-451
                                            event: ({name, args, accountNumber}) => {
                                              чужой аккаунт и не общее событие → выбросить
                                              rootScope.dispatchEventSingle(name, ...args)
                                            }
```

`dispatchEventSingle` (`rootScope.ts:331-336`) — рассылка только локально, без обратной отправки,
иначе событие зациклилось бы. Если событие отправила вкладка, воркер пересылает его всем вкладкам,
кроме отправителя (`index.worker.ts:200-203`, `invokeExceptSource`).

Отсюда правило: **`rootScope.dispatchEvent` по умолчанию видят все вкладки**. События «только для
себя» шлют через `dispatchEventSingle` — так делает правая колонка с `right_sidebar_toggle`
(`sidebarRight/index.ts:101`, `:135`). Ещё бывают локальные эмиттеры классов: `appImManager` сам
является `EventListenerBase` со своими `chat_changing`, `peer_changed`, `peer_changing`,
`tab_changing` (`appImManager.ts:252-258`), и эти события в `rootScope` не попадают.

Карта всех событий — [state-and-layout.md](state-and-layout.md) §2.4.

### 2.4 Пример: пришло новое сообщение → бейдж в строке чата

| # | Где | Что |
|---|---|---|
| 1 | воркер, `appMessagesManager.ts:767-768` | апдейт `updateNewMessage` попадает в обработчик `onUpdateNewMessage` |
| 2 | `:10243-10253` | сообщение сохраняется в хранилище истории (`saveMessages`) |
| 3 | `:10488` → `:8874-8880` | `handleNewMessage` → `rootScope.dispatchEvent('history_multiappend', message)` (его слушает лента, `bubbles.ts:2261`) |
| 4 | `:10506-10516` | входящее непрочитанное → `++dialog.unread_count` |
| 5 | `:10518-10520` → `:4954` | `setDialogTopMessage` → `scheduleHandleNewDialogs` (вызов `:4972`, тело `:8946`): апдейты диалогов копятся до конца тика (`pause(0)`, `:8973`) |
| 6 | `:8882-8943` | `handleNewDialogs` → `rootScope.dispatchEvent('dialogs_multiupdate', updateMap)` (`:8942`) — один кадр на пачку диалогов |
| 7 | порт → вкладка, `apiManagerProxy.ts:446-451` | `rootScope.dispatchEventSingle('dialogs_multiupdate', map)` |
| 8 | вкладка, `autonomousDialogList/dialogs.ts:211-224` | список папки слушает событие через `listenerSetter` → `this.updateDialog(dialog)` |
| 9 | `autonomousDialogList/base.ts:148-164` | находит `DialogElement` по ключу → `appDialogsManager.setLastMessageN({dialog, dialogElement, setUnread: true})` и `sortedList.update(key)` (строка поднимется вверх) |
| 10 | `appDialogsManager.ts:2485` → `:2525` | `setLastMessage` рисует текст последнего сообщения, затем зовёт `setUnreadMessagesN` |
| 11 | `:2682-2797` | `setUnreadMessages` считает число (`:2733`) и зовёт `dialogElement.setBadgeState({...unreadText})` (`:2793`) |
| 12 | `DialogElement.setBadgeState`, `:586-690` | создаёт узел бейджа один раз (`createUnreadBadge`, `:548-553`) и включает его анимацией `SetTransition` |

Обратите внимание на шаги 5–6 и 9: данные считает воркер, вкладка не пересчитывает список, а
меняет **одну строку** и двигает её на новое место.

### 2.5 У нас

Устройство то же: `rpc/superMessagePort.ts`, `rpc/managersProxy.ts`, `lib/rootScope.ts`, воркер
собирает `core/workerCore.ts`. Расхождение — между `rootScope` и интерфейсом у нас стоят
Zustand-сторы (`stores/chatsStore.ts` и др.), а интерфейс читает их селекторами
(`web-client/CLAUDE.md`, «Архитектура клиента»). У tweb UI подписывается на `rootScope` напрямую.
Сторы уезжают последними, в волне 8 (план, «Мосты чтения»).

---

## 3. Синглтоны и кто чем владеет

Все объекты ниже создаются **один раз на страницу** (последняя строка модуля: `const x = new X()`).

| Синглтон | Что делает | Каким узлом владеет | Создаётся |
|---|---|---|---|
| `appImManager` | стек чатов центра, переключение «экранов» (список/чат/профиль), хэш-роутинг, фон и тема, позиции, хоткеи, drag&drop, статусы «печатает», звонки и боты | `#column-center` и созданный в нём `.chats-container` (`appImManager.ts:367-373`) | `appImManager.ts:3989` |
| `appSidebarLeft` | левая колонка: слайдер вкладок (настройки, контакты, архив…), бургер, поиск, свёрнутый режим | `#column-left` и его `.sidebar-slider` | `sidebarLeft/index.ts:1798` |
| `appSidebarRight` | правая колонка: слайдер вкладок (профиль, поиск, редактирование), класс `is-right-column-shown` | `#column-right` | `sidebarRight/index.ts:141` |
| `appDialogsManager` | список чатов: папки, строки `DialogElement`, клики, активная строка; корень старта UI (§1.4) | `#chatlist-container`, `#folders-container` | `appDialogsManager.ts:3064` |
| `appNavigationController` | единый стек «что закроет Back/Esc», синхронизация с историей браузера и хэшем | ничем; слушает `keydown` (`appNavigationController.ts:79`) и `popstate`/`navigate` | `appNavigationController.ts:539` |
| `AppMediaViewer` | **не синглтон**: новый экземпляр на каждое открытие (`bubbles.ts:4276`, `appSearchSuper.ts:818`) | свой `.media-viewer-whole`, кладётся в корень оверлеев (`mediaViewer/base.ts:2471`) | — |
| `contextMenuController` | открытое меню (кнопочное или контекстное): клик вне, Esc, фокус | открытый `.btn-menu` | `helpers/contextMenuController.ts:329` |
| `overlayCounter` | счётчик открытых оверлеев (попап, вьювер); хоткеи и анимации проверяют `isOverlayActive` | ничем | `helpers/overlayCounter.ts:29` |
| `themeController` | день/ночь, акцент, применение темы к `<html>` | атрибуты и CSS-переменные `<html>` | `helpers/themeController.ts:966` |
| `mediaSizes` | брейкпоинты: `mobile`/`medium`/`large`, события `changeScreen`/`resize` | ничем | `helpers/mediaSizes.ts:192` |
| `animationIntersector` | кто из стикеров/гифок/видео сейчас играет: видимость, пауза под оверлеем и на время тяжёлых анимаций | ничем; держит `IntersectionObserver` | `components/animationIntersector.ts:510` |
| `uiNotificationsManager` | системные уведомления, счётчик в заголовке и на иконке приложения | `document.title`, `<link rel=icon>` (`uiNotificationsManager.ts:262-276`) | `lib/uiNotificationsManager.ts:1135` |
| `appDownloadManager` | загрузки файлов на диск и в память, прогресс | ничем | `lib/appDownloadManager.ts:510` |

Рядом живут ещё `rootScope` (`rootScope.ts:339`), `apiManagerProxy` (`apiManagerProxy.ts:1479`),
`liteMode` (`helpers/liteMode.ts:37`), `internalLinkProcessor` (`lib/internalLinkProcessor.ts:1659`),
`callsController` (`lib/calls/callsController.ts:634`), `appMediaPlaybackController`
(`components/appMediaPlaybackController.ts:1314`), `idleController` (`helpers/idleController.ts:93`),
`appChatBackground` (`chat/bubbles/chatBackground.tsx:560`).

Почти все пишут себя в `MOUNT_CLASS_TO` (например, `sidebarRight/index.ts:142`). Это глобальный
объект (`config/debug.ts:16`, условие `DEBUG || true`), поэтому в консоли доступен `appImManager.chat`.

---

## 4. Как устроен класс-компонент

### 4.1 Идея

Класс tweb — это объект, который **один раз строит свой DOM в конструкторе** и потом **меняет
отдельные узлы методами**. Состояния «на рендер» нет. Есть поля-ссылки на узлы и методы вида
`setMuted`, `setBadgeState`, `setPeer`.

### 4.2 Пример: строка чата `DialogElement`

`export class DialogElement` (`appDialogsManager.ts:290`):

```ts
constructor({peerId, avatarSize = 'bigger', autonomous, wrapOptions, controlled, ...}) {
  this.middlewareHelper = wrapOptions?.middleware ?
    wrapOptions.middleware.create() : (controlled ? getMiddleware() : undefined);   // :319
  attachRowController(this, {clickable: true, title: true, subtitle: true,
    asLink: true, middleware: this.middlewareHelper?.get()});                       // :321-332
  const avatar = avatarNew({middleware: this.middlewareHelper.get(), peerId, ...}); // :350-368
  const peerTitle = this.peerTitle = new PeerTitle();                               // :397
  const li = this.container;
  li.classList.add('chatlist-chat', 'chatlist-chat-' + avatarSize);                 // :427
  li.dataset.peerId = '' + peerId;                                                  // :441
  this.dom = {avatarEl: avatar, titleSpan: peerTitle.element, statusSpan,
    lastTimeSpan, lastMessageSpan: span, listEl: li, subtitleEl: this.subtitleRow, ...}; // :465-477
}
```

Дальше узлы меняются точечно, и каждый метод трогает только своё:

| Метод | Строки | Что меняет |
|---|---|---|
| `setMuted(isMuted)` | `:508-531` | один раз создаёт иконку «без звука» и проигрывает класс `is-muted` через `SetTransition` |
| `createUnreadBadge()` и соседи | `:533-584` | создают узел бейджа, только если его ещё нет (`if(this.dom.unreadBadge) return`) |
| `setBadgeState(options)` | `:586-690` | включает/выключает бейджи; анимацию повторяет, только если состояние сменилось (`:627-634`) |
| `updateTitle(fromName)` | `:499-501` | перерисовывает только заголовок |
| `destroy()` / `remove()` | `:493-506` | гасит Solid-корень строки, рушит `middlewareHelper`, удаляет узел |

Текст последнего сообщения, время и счётчик ставит не сама строка, а `appDialogsManager`
(`setLastMessage :2485`, `setUnreadMessages :2682`): ему нужно знать про черновики, «печатает»,
папки. Строка — «тупой» владелец узлов с API.

### 4.3 Пример: вкладка `SliderSuperTab`

Базовый класс любой вкладки колонки (`sliderTab.ts:21`):

```ts
_constructor(slider, destroyable = true) {                                   // :60
  this.middlewareHelper = slider ? slider.getMiddleware().create() : getMiddleware(); // :62
  this.container = document.createElement('div');                           // :65
  this.container.classList.add('tabs-tab', 'sidebar-slider-item');
  // шапка: .sidebar-header > кнопка закрытия + .sidebar-header__title       // :69-75
  // тело:  .sidebar-content + Scrollable                                    // :78-84
  this.slider?.addTab(this);                                                 // :88  узел сразу в слайдер
  this.listenerSetter = new ListenerSetter();                                // :90
}
async open(...args) { await this.init(...args); this.init = null;            // :97-108
                      this.slider.selectTab(this); }                         // :113
protected onCloseAfterTimeout() {                                            // :124-132
  if(this.destroyable) { this.slider?.deleteTab(this); this.container.remove();
    this.scrollable.destroy(); this.listenerSetter?.removeAll(); this.middlewareHelper?.destroy(); }
}
```

Жизненный цикл: `new` строит каркас → `open()` один раз зовёт `init()` (наследник наполняет
содержимое) → слайдер анимирует появление → по закрытию `onClose()` сразу, а
`onCloseAfterTimeout()` — когда анимация ухода кончилась (`slider.ts:250-256`, через
`TRANSITION_TIME + 30` мс, `TRANSITION_TIME = 250`, `slider.ts:11`). Узел удаляется **после**
анимации, не раньше.

### 4.4 `middlewareHelper` / `middleware` — отмена устаревшей асинхронщины

Проблема: открыли чат A, началась загрузка аватарки, переключились на B, загрузка A закончилась
и записала аватар в чужую шапку. `middleware` (`helpers/middleware.ts`) решает это так:

```ts
const helper = getMiddleware();          // :95
const middleware = helper.get();         // :75   функция () => boolean «я ещё актуален?»
loadSomething().then((x) => {
  if(!middleware()) return;              // устарело — ничего не трогаем
  node.append(x);
});
helper.clean();   // :32  «всё, что было до этого, — устарело»: middleware() станет false,
                  //      сработают onClean-колбэки, вложенные helper'ы будут уничтожены
helper.destroy(); // :41  clean + onDestroy-колбэки: объект умер насовсем
```

Помощники вкладываются: `middleware.create()` (`:57-63`) порождает дочерний helper, и `clean`
родителя рушит детей. Так вкладка берёт helper у слайдера (`sliderTab.ts:62`), строка — у того, кто её создал
(`appDialogsManager.ts:319`), аватар — у строки (`:353`). Закрыли вкладку — отменилось всё, что она
начала.

Пример из открытия чата: `Chat.setPeer` при смене пира зовёт `this.middlewareHelper.clean()`
(`chat.ts:1061`), а лента сверяет номер попытки: `const middleware = () => this.setPeerTempId === tempId`
(`bubbles.ts:5840-5842`) и оборачивает каждый `await` в `middlewarePromise` (`:5844`), который
бросает `PEER_CHANGED_ERROR` (`:356`), если пир успели сменить.

### 4.5 `ListenerSetter` — снятие подписок одной строкой

Каждая подписка, сделанная через `listenerSetter`, запоминается
(`helpers/listenerSetter.ts:32-38`):

```ts
this.listenerSetter.add(rootScope)('dialogs_multiupdate', (dialogs) => {...}); // dialogs.ts:211
this.listenerSetter.add(button)('click', onClick);
this.listenerSetter.addCleanup(() => observer.disconnect());                   // :99-102
// в destroy:
this.listenerSetter.removeAll();                                               // :104-111
```

Без него каждый класс вручную помнил бы пары `add/removeEventListener` для `rootScope`, DOM и
чужих эмиттеров. `removeAll` зовут вкладка (`sliderTab.ts:129`) и лента в `destroy`.

### 4.6 Сравнение с React

| | React | класс tweb |
|---|---|---|
| Что такое компонент | функция «данные → разметка», вызывается при каждом изменении | объект с узлами, конструктор вызывается один раз |
| Как меняется экран | новое дерево, дифф с прошлым, патч DOM | метод сразу пишет в нужный узел |
| Где состояние | хуки, стор, пропы | поля объекта + данные в воркере |
| Анимация ухода | нужен механизм «подержать узел после размонтирования» | узел и так живёт, класс сам решает, когда удалить (`onCloseAfterTimeout`) |
| Отмена асинхронщины | `useEffect` cleanup, флаг `cancelled` | `middleware()` |
| Отписки | cleanup эффекта | `listenerSetter.removeAll()` |
| Цена | лишние рендеры и мемоизация на горячих путях | нужна дисциплина: кто владеет узлом, тот его и меняет |

Почему tweb не перерисовывает: в списке тысячи строк, в ленте сотни баблов, у каждого — свои
анимации, наблюдатели, загрузки и позиция скролла. Дифф ради одного бейджа здесь дороже, чем
`badge.textContent = '3'`, и он не умеет сохранить «полёт» анимации, которая уже идёт.

---

## 5. Где Solid внутри классов

tweb — гибрид: 529 файлов `.tsx` на Solid против 1596 `.ts` (`src/`, без тестов), JSX в
`tsconfig.json:12` настроен на `solid-js`. Правило границы (спека
[`2026-08-28-solid-migration-design.md`](../superpowers/specs/2026-08-28-solid-migration-design.md) §3):

> **Класс** — когда узел живёт дольше одного показа, а владельцу важны позиция скролла, анимация,
> отменяемые загрузки, жесты. **Solid** — когда узел рисуется из данных и умирает целиком.

Короче: **момент изменения диктует время, анимация или скролл — класс; что показать, диктуют
данные — Solid.** Четыре типовых стыка:

### 5.1 Строка: класс снаружи, Solid `Row` внутри — `attachRowController`

`DialogElement` не строит разметку строки сам. Он зовёт `attachRowController(this, options)`
(`appDialogsManager.ts:321`, функция — `rowTsxController.tsx:390-398`). Тот внутри
`createRoot` рендерит Solid-компонент `<Row>` (`rowTsxController.tsx:280-328`) и навешивает на
объект-хозяин геттеры к частям строки: `container`, `title`, `subtitle`, `titleRight`,
`applyMediaElement`… (тип `RowTsxController`, `:65-90`).

```
DialogElement (класс)                  ← владеет временем: бейджи, анимации, middleware
  └ attachRowController(this, {...})
      └ createRoot(() => <Row clickable as="a">…</Row>)   ← разметка .row из одного места
           части строки → this.title, this.subtitle, this.container …
```

Корень Solid снимается вместе с хозяином: если передан `middleware`, — через
`middleware.onDestroy(dispose)` (`:342-346`). Подробно про `Row`/`RowTsx` —
[settings-rows.md](settings-rows.md).

### 5.2 Вкладка: класс-оболочка, Solid-содержимое — `scaffoldSolidJSTab`

Большинство вкладок не пишут класс вручную. `scaffoldSolidJSTab({title, getComponentModule})`
(`solidJsTabs/scaffoldSolidJSTab.tsx:26-77`) **генерирует** класс-наследник `SliderSuperTab`:

```ts
return class extends SliderSuperTab {
  async init(payload) {
    this.setTitle(title);                                        // :39
    const {default: Component} = await getComponentModule();    // :44  ленивый import
    this.dispose = render(() => (
      <PromiseCollector …><SuperTabProvider self={this}><Component /></SuperTabProvider></PromiseCollector>
    ), div);                                                     // :48-56
    this.scrollable.append(div);                                 // :58
    await promiseCollectorHelper.await();                        // :60  ждём данные до анимации
  }
  onCloseAfterTimeout() { this.dispose?.(); super.onCloseAfterTimeout(); }  // :67-71
};
```

Вкладки объявлены списком в `solidJsTabs/tabs.ts`, например «Настройки»:
`AppSettingsTab = scaffoldSolidJSTab({title: 'Settings', getComponentModule: () => import('../sidebarLeft/tabs/settings')})`
(`tabs.ts:188-192`). Шапка, кнопка «назад», скролл, анимация въезда и снятие — у класса,
содержимое — Solid. `PromiseCollector` задерживает въезд, пока компонент не соберёт свои
промисы: вкладка въезжает уже заполненной.

Тот же приём вручную — `AppSharedMediaTab extends SliderSuperTab` (`sidebarRight/tabs/sharedMediaTab.tsx:26`)
с `render(...)` внутри (`:48`).

### 5.3 Список: Solid-ядро с классом-владельцем — `deferredSortedVirtualList` + `SortedDialogList`

Список чатов собран в обратную сторону: ядро на Solid, снаружи класс.

```
SortedDialogList (класс, sortedDialogList.ts:17)        ← API для appDialogsManager: add/update/delete
  └ createDeferredSortedVirtualList({...})              ← Solid, deferredSortedVirtualList.tsx:71
      сигналы items / pinnedItems / totalCount          :87-92
      sortedItems = createMemo(сортировка по index)     :99
      <VerticalVirtualList> — рисует только видимое     :354
      хвост дальше EXTRA_ITEMS_TO_KEEP = 50 отрезается  :48, :294-301
      getItemElement(item) → dialogElement.dom.listEl   ← узел строки даёт класс DialogElement
```

Solid здесь решает «какие строки в каком порядке и что видно» — это данные. Сама строка остаётся
классом `DialogElement`, потому что у неё своя жизнь во времени (бейджи, анимации, загрузки).
Класс `SortedDialogList` переводит команды менеджера («обнови диалог X», `:371`) в изменения
сигналов. Колбэки ядра (`sortedDialogList.ts:64-139`) отвечают за жизнь строк: `onItemDiscard`
рушит выкинутую строку (`:109-114`), `onItemUnmount` помечает строку к пересборке эмодзи
(`:123-131`).

### 5.4 Попапы: Solid целиком, класс только открывает

В `812502980` класса `PopupElement` больше нет: `PopupElement` — Solid-компонент
(`popups/indexTsx.tsx:133-465`), а открывают попапы функцией
`createPopup(() => <PopupElement …>)` (`:836-842`) или готовыми `showXxxPopup()` /
`confirmationPopup()` (`components/confirmationPopup.ts:17`). Классы UI лишь зовут эти функции из
обработчиков. С остальным приложением попап связан тремя нитями, и все они видны в `show`/`destroy`:

```ts
appNavigationController.pushItem({type: 'popup', onPop: () => destroy()});  // indexTsx.tsx:185-203
overlayCounter.isOverlayActive = true;                                     // :208
animationIntersector.checkAnimations2(true, props.animationGroup);         // :212  пауза стикеров под попапом
// destroy → через таймер: middlewareHelper.destroy(), overlayCounter = false, removeItem(navItem) // :276-298
```

Подробно — [popups-solid.md](popups-solid.md) §1–§2 (что удалено и что пришло).

### 5.5 И внутри большого класса — точечный Solid

Даже `Chat` использует Solid как «реактивную ячейку» внутри метода: при смене пира он создаёт
`createRoot`, в котором берёт `this.peer = usePeer(peerId)` и `createEffect` для настроек
автозагрузки (`chat.ts:1066-1074`). Корень гасится через `this.middlewareHelper.get().onClean(dispose)`:
сменили пира — старые подписки умерли.

### 5.6 Сводка

| Что | Кто владеет | Почему |
|---|---|---|
| колонка, стек чатов, слайдер | класс | живёт всю сессию, анимирует переходы, держит историю |
| лента сообщений (`ChatBubbles`) | класс | скролл, подгрузка, прюнинг, анимации появления |
| строка диалога (`DialogElement`) | класс + Solid `Row` | разметка из данных, бейджи и анимации во времени |
| порядок и видимость строк | Solid-ядро списка | чистые данные: отсортировать и показать окно |
| вкладка настроек | класс-оболочка + Solid | оболочка анимирует въезд, содержимое — форма из данных |
| попап | Solid | рисуется и умирает целиком |

---

## 6. `appImManager` подробно

Файл `src/lib/appImManager.ts` — 3991 строка. Это центральный контроллер, к которому сходятся
все колонки.

### 6.1 Поля

| Поле | Строка | Смысл |
|---|---|---|
| `columnEl` | `:259` | `#column-center` из `index.html` |
| `chatsContainer` | `:260`, создаётся `:367-373` | `.chats-container.tabs-container[data-animation=navigation]` — контейнер стека чатов |
| `chats: Chat[]` | `:272` | стек открытых чатов (основной + вложенные: тред, комментарии, «открыть из профиля») |
| `get chat` | `:300-302` | верхний чат стека: `this.chats[this.chats.length - 1]` |
| `tabId: APP_TABS` | `:270` | какой «экран» показан: `CHATLIST`, `CHAT`, `PROFILE` (enum `:209-213`) |
| `prevTab` | `:273` | контейнер чата, который сейчас `active` |
| `setPeerPromise` | `:268` | идущая смена пира |
| `chatPositions` | `:292-294` | сохранённые позиции скролла по `peerId_threadId` |
| `appChatBackground` | `:261`, `:364-365` | фон чатов на `body` |
| `topbarCall`, `chatAudio` | `:280-281`, `:849-855` | плашки звонка и плеера над чатом |

`APP_TABS` — это не вкладки слайдера, а **три положения экрана**: на телефоне виден один из трёх,
на десктопе — все сразу, а `tabId` управляет классом `is-left-column-shown` и `inert` колонок
(`:3142`, `:3203-3208`).

### 6.2 Блоки и что из них — своя логика, а что пересылка

| Блок | Строки | Своя логика или делегирует |
|---|---|---|
| `construct` — подписки и включение подсистем | `:324-1018` | сам подписывается на 17 событий `rootScope` и 6 своих (`peer_changed` и др.); включает `internalLinkProcessor.construct` (`:326`), `uiNotificationsManager.constructAndStartAll` (`:328`), `appMediaPlaybackController.construct` (`:330`) |
| стек чатов: `createNewChat`, `spliceChats`, `setPeer`, `setInnerPeer` | `:3219-3435` | **своя** — главное, ради чего класс существует |
| экраны/колонки: `selectTab`, `chatsSelectTab`, `updateColumnAccessibility` | `:3137-3208`, `:2766-2805` | **своя**; пишет `is-left-column-shown`, пушит записи `'im'`/`'chat'` в `appNavigationController` |
| хэш-роутинг: `onHashChange`, `overrideHash` | `:1912-2048`, `:3127-3135` | разбор хэша свой; запись хэша — `appNavigationController.overrideHash`; ссылки `t.me/…` — через `openUrl` (`:1897`), который вызывает обработчики `internalLinkProcessor` (`internalLinkProcessor.ts:84-160`, `addAnchorListener`) |
| открыть пира/тред/комментарий: `open`, `op`, `openUsername`, `openThread`, `openComment` | `:2050-2226` | своя обвязка вокруг `setInnerPeer` и менеджеров |
| фон и тема: `setCurrentBackground`, `setBackground`, `applyCurrentTheme`, `setSettings` | `:2607-2639`, `:2690-2765` | делегирует `appChatBackground` и `themeController` (`:2608`, `:2631`, `:2707`); `setSettings` ставит `animation-level-*` на `body` (`:2738-2740`) |
| позиции чатов: `saveChatPosition`, `getChatSavedPosition` | `:2640-2689` | своя; сохраняется на `peer_changing` (`:479-487`) |
| хоткеи и копирование: `attachKeydownListener`, `attachCopyListener` | `:1703-1896` | своя; молчит при открытом оверлее (`overlayCounter.isOverlayActive`, `:1709`) |
| drag&drop и вставка: `init`, `attachDragAndDropListeners`, `canDrag` | `:2807-3126` | разметку зон делает `ChatDragAndDrop` (`:2887-2915`), логику — сам |
| статусы: `updateStatus`, `getPeerTyping`, `getPeerStatus`, `setPeerStatus` | `:3210-3218`, `:3454-3808` | своя поверх `appUsersManager`/`appProfileManager` |
| звонки: `callUser`, `joinGroupCall`, `joinConference`, `createConference`, `joinLiveStream` | `:2227-2606` | подтверждения и переключения свои, звонок — `callsController`/`groupCallsController` (`:2265`, `:2364`) |
| боты и вебаппы: `confirmBotWebView`, `openWebApp`, `playGame`, `handleUrlAuth` | `:1050-1510` | своя обвязка, окно — компоненты вебаппа |
| прочее: автологин-домены, цвета пиров, сторис, подарки | `:1511-1660`, `:3818-3990` | мелкие обработчики |

### 6.3 Почему один класс делает так много

Исторически `appImManager` и был «страницей мессенджера». Он появился в феврале 2020-го рядом с
менеджерами данных (`c4f58a72d`, путь `src/lib/appManagers/appImManager.ts`), и всё, что нужно
было «на уровне приложения», дописывалось в него: хэш, хоткеи, drag&drop, звонки, боты. Рядом
выросли отдельные модули, но точкой входа для них остался `appImManager`: включает
`internalLinkProcessor` (`:326`), отдаёт `appNavigationController` свой `onHashChange` (`:382`),
подключает `appChatBackground` и `themeController` (`:364-365`, `:444-445`), слушает
`callsController` (`:881`), создаёт зоны `ChatDragAndDrop` (`:2887`). Файл вырос на 608 строк между
`e52b5d931` и `812502980` (3383 → 3991, план волны 7, шапка).

Для порта это значит: ядро (стек, экраны, хэш) переносится отдельно от подсистем — так и
разбиты этапы 4 и 5 плана.

---

## 7. Сквозные сценарии по шагам

### 7а. Клик по чату в списке

```
mousedown на li.chatlist-chat
 │ appDialogsManager.setListClickListener → onPress            appDialogsManager.ts:2072, :2131
 │   findDialogListElement(target) → elem, peerId = elem.dataset.peerId   :2141-2147
 │   (архив, форум, ctrl+клик, shift+клик — свои ветки)         :2135-2282
 │   openChat() = setPeerFunc({peerId, lastMsgId, threadId})    :2153-2159
 │   setPeerFunc = openInner ? setInnerPeer : setPeer           :2094
 ▼
appImManager.setPeer(options)                                   appImManager.ts:3292
 │   стек длиннее одного и пир другой → срезать стек             :3336-3352
 │   chat.setPeer(options)                                      :3366
 ▼
Chat.setPeer                                                    chat.ts:1035
 │   первый показ → this.init(): new ChatTopbar / ChatBubbles / ChatInput /
 │                 ChatContextMenu / ChatSelection               :1039-1044 → :613-620
 │   пир сменился → dispatchEvent('peer_changing'), middlewareHelper.clean() :1050, :1061
 │   this.bubbles.setPeer(...)                                  :1145
 ▼
ChatBubbles.setPeer                                             bubbles.ts:5823
 │   await chat.onChangePeer(...)                               :5848
 │     → права, флаги, sharedMediaTab = appSidebarRight.createSharedMediaTab()  chat.ts:893, :1004
 │   история из кэша или сети, затем chat.finishPeerChange(...)  bubbles.ts:6182-6183
 ▼
Chat.finishPeerChange                                           chat.ts:1198
 │   параллельно: topbar / bubbles / input .finishPeerChange, профиль, фон   :1220-1226
 │   проверка middleware() — не устарело ли                     :1231
 │   appSidebarRight.replaceSharedMediaTab(sharedMediaTab)      :1240
 │   appImManager.dispatchEvent('peer_changed', this)           :1252
 ▼
appImManager (подписчики peer_changed)
 │   body.has-chat, overrideHash(peerId) → #@username или #peerId    appImManager.ts:835-843
 │   apiManagerProxy.updateTabState('chatPeerIds', ...)          :842
 │ и по готовности фона:
 │   chatsSelectTab(this.chat) — контейнер чата получает .active :3378 → :2766-2805
 │   selectTab(APP_TABS.CHAT) — на телефоне уезжает список      :3380 → :3137
```

Нюанс про `setInnerPeer`. Основной список зовёт **`setPeer`**: чат открывается в текущем
экземпляре `Chat`. `setInnerPeer` (`:3392`) зовут списки с `openInner: true` — профиль
(`peerProfile.tsx:582`), поиск (`appSearchSuper.ts:1569`), статистика. Тогда чат кладётся
**поверх** стека новым экземпляром (`createNewChat`, `:3421-3422`), и «назад» вернёт к предыдущему
чату, а не к списку. Вызовов `appImManager.setInnerPeer` вне тестов — 94.

Подробнее про открытие чата и подгрузку истории — [chat-feed.md](chat-feed.md) §1.4.

### 7б. Открыть «Настройки» и вернуться

```
клик «Settings» в бургере                                       sidebarLeft/index.ts:758-767
 │ closeTabsBefore → appSidebarLeft.createTab(AppSettingsTab).open()   :674-678, :765
 │   createTab: колонка свёрнута → вкладка откроется в попапе   :1730-1740
 │   SidebarSlider.createTab → new ctor(slider)                 slider.ts:274-289
 │     конструктор SliderSuperTab строит шапку/скролл, addTab кладёт узел в .sidebar-slider  sliderTab.ts:60-90
 │   tab.open() → init() из scaffold: import компонента, render Solid, ждём PromiseCollector  scaffoldSolidJSTab.tsx:38-61
 │   slider.selectTab(tab)                                      sliderTab.ts:113 → slider.ts:117
 │     pushNavigationItem → appNavigationController.pushItem({type:'left', onPop})  slider.ts:87-113
 │       → history.pushState / navigation.navigate              appNavigationController.ts:381-410
 │     _selectTab(tab.container) — TransitionSlider 'navigation' slider.ts:41-45, :143
 ▼
«назад» — три пути, один финал:
 (1) кнопка в шапке → slider.onCloseBtnClick → appNavigationController.back('left')  slider.ts:61-69
 (2) Esc → onKeyDown: верхний элемент стека, если можно закрыть → back(item.type)    appNavigationController.ts:216-223
 (3) системный Back → popstate/navigate → handleItem(item)                           :174, :290
 ▼
item.onPop(canAnimate) → slider.closeTab()                      slider.ts:89-108, :72-85
 │   onCloseTab → tab.onClose() сразу, onCloseAfterTimeout через 280 мс    :233-258
 │     scaffold: dispose Solid → SliderSuperTab: container.remove(),
 │     listenerSetter.removeAll(), middlewareHelper.destroy()   scaffoldSolidJSTab.tsx:67-71, sliderTab.ts:124-132
```

Главное: «назад» в tweb **одно на всё приложение**. Попап, вкладка, чат, меню пушат запись в
один стек `appNavigationController`, и Esc/Back всегда закрывает верхнюю. Что закроется
первым, решает порядок открытия, а не z-index. Подробно — [state-and-layout.md](state-and-layout.md) §5.1.

### 7в. Отправка сообщения: от композера до бабла

| # | Где | Что |
|---|---|---|
| 1 | `chat/input.ts:4656` | `ChatInput.sendMessage()` собирает параметры: `this.chat.getMessageSendingParams()` (`:4674`) |
| 2 | `:4682-4703` → `:4536` | `ChatInput.sendMessageWithForward(...)` достаёт текст и сущности из поля (`getRichValueWithCaret`, `:4559-4563`), учитывает пересылку, slow mode и платные сообщения |
| 3 | `:4608-4613` | `rootScope.managers.appMessagesManager.sendText({...sendingParams, text, entities})` — RPC в воркер |
| 4 | `:4710-4720` | композер сразу очищается: `onMessageSent(...)` (`:4499`) — не дожидаясь сервера |
| 5 | воркер, `appMessagesManager.ts:2583` | `sendText` строит временное сообщение с `tempId` и зовёт `beforeMessageSending` (`:2842`) |
| 6 | `:4357-4420` | сохраняет его (`isOutgoing: true`, `:4402`), ставит верхним сообщением диалога (`:4404-4411`), шлёт `history_append` (`:4420`) |
| 7 | вкладка, `chat/bubbles.ts:2224-2259` | `ChatBubbles` проверяет, что событие про его хранилище, и зовёт `renderNewMessage(message, true)` (`:2255`) → бабл со статусом «отправляется» |
| 8 | воркер, `:2759` | сетевой вызов `messages.sendMessage` |
| 9 | `:12072-12148` | ответ сервера → `finalizePendingMessageCallbacks` → `rootScope.dispatchEvent('message_sent', {tempId, mid, message})` |
| 10 | `bubbles.ts:1151-1175` | лента меняет `tempId` на настоящий `mid` у того же бабла (`changedMids`, `getBubble(fullTempMid)`) — бабл не пересоздаётся |
| 11 | `appImManager.ts:861-875` | тот же `message_sent` → звук отправки, если вкладка активна |

Список чатов обновляется параллельно — через `dialogs_multiupdate`, как в §2.4.

### 7г. Открыть профиль справа

```
клик по шапке чата                                              chat/topbar.ts:259-286
 │ medium-экран и открыт список → это «назад»                   :274-275
 │ клик по аватару → toggleSidebar(!открыта)                    :281
 │ иначе → appSidebarRight.toggleSidebar(true)                  :283
 ▼
AppSidebarRight.toggleSidebar(true)                             sidebarRight/index.ts:104-138
 │ уже в нужном состоянии → ничего                              :105-119
 │ история пуста → sharedMediaTab.open()                        :121-123  (вкладку подставил Chat, §7а)
 │ appImManager.selectTab(APP_TABS.PROFILE, animate)            :125
 │   └ heavy animation на время перехода, запись 'im' в навигацию   appImManager.ts:3153-3169, :3178-3188
 │ body.classList.add('is-right-column-shown'); sidebarEl.inert = false   :128-129
 │ pushNavigationItem(sharedMediaTab) — запись 'right' для Back/Esc        :130-132
 │ animationIntersector.toggleVideosUnder(sidebarEl, false)     :134
 │ rootScope.dispatchEventSingle('right_sidebar_toggle', true)  :135
 ▼
CSS делает остальное: `body.is-right-column-shown #column-right { transform: translate3d(0,0,0) }`
(_rightSidebar.scss:21-33), центр сжимается (_chat.scss:472, :492)
```

Закрытие — `hide()` (`sidebarRight/index.ts:94-102`): снимает класс, делает колонку `inert`,
удаляет записи `'right'` из навигации, ставит видео на паузу (колонка уезжает трансформом и
остаётся в DOM — `IntersectionObserver` этого не заметит). При смене чата
`replaceSharedMediaTab` (`:50-84`) меняет узел вкладки профиля на месте, не трогая остальную
историю слайдера. Подробно — [right-sidebar.md](right-sidebar.md) §1–§2, §8.

---

## 8. Как меняется DOM и анимации

### 8.1 Анимация = класс + таймер

В tweb нет библиотеки анимаций. JS переключает классы, CSS анимирует, таймер убирает
служебные классы. Два кирпича:

**`SetTransition`** (`components/singleTransition.ts:15-77`) — одиночный элемент «показать/скрыть»:

```
forwards: true                          forwards: false
  + className, + forwards, + animating    − forwards, + animating, + backwards
  через duration: − animating             через duration: − className, − backwards, − animating
                                          затем onTransitionEnd (например, удалить иконку)
```

Если анимации выключены (`liteMode`) или `duration` = 0, конечное состояние ставится сразу
(`:67-71`). Повторный вызов отменяет прошлый таймер (`:18-32`). Опция `useRafs` откладывает
старт на N кадров (`:38-48`). Так анимируются `is-muted` у строки (`appDialogsManager.ts:521-530`)
и бейджи.

**`TransitionSlider`** (`components/transition.ts:169-381`) — контейнер, в котором активен один
ребёнок из многих (вкладки слайдера, стек чатов, папки):

```
контейнер[data-animation=navigation|tabs|zoom-fade|…]           :186
selectTab(id):
  старый ребёнок: + from        новый ребёнок: + to, + active
  контейнер: + animating, ± backwards (назад или вперёд)        :300-307
  для navigation/tabs — JS-функция ставит transform              :141-145, :313-315
  по transitionend (или таймеру transitionTime + 100):
    старый: − active, − from;  новый: − to;  контейнер: − animating, − backwards   :200-232, :340-347
  isHeavy → dispatchHeavyAnimationEvent на время перехода        :362-369
```

`SidebarSlider` создаёт его с `type: 'navigation'` и `TRANSITION_TIME = 250` (`slider.ts:41-45`).

### 8.2 Планировщики кадров

| Что | Где | Зачем |
|---|---|---|
| `fastRaf(cb)` | `helpers/schedulers.ts:36-49` | все колбэки одного кадра собираются в один `requestAnimationFrame`; ошибка одного не роняет остальные (`:27-33`) |
| `fastRafPromise()` | `:74-83` | промис на ближайший такой кадр (один на всех) |
| `doubleRaf()` | `:85-91` | два кадра подряд: стиль точно применился, можно включать переход (так `bootstrapIm.ts:60`) |
| `sequentialDom.measure` / `mutate` | `helpers/sequentialDom.ts:28-34` | в одном кадре сначала все чтения размеров, потом все записи — без лишних пересчётов раскладки; `mutateElement` для узла вне DOM выполняется сразу (`:41-54`) |

### 8.3 Тяжёлые анимации

Пока едет колонка или слайдер, браузеру нельзя мешать: проигрывание стикеров, декодирование
и тяжёлая отрисовка ждут. Механика в `hooks/useHeavyAnimationCheck.ts`:

```ts
dispatchHeavyAnimationEvent(promise, timeout)  // :25  «началась тяжёлая анимация до promise/timeout»
getHeavyAnimationPromise()                     // :77  «дождаться, пока все кончатся»
useHeavyAnimationCheck(onStart, onEnd, listenerSetter?)  // :81  подписка на начало и конец
```

Несколько анимаций сливаются в одну (счётчик `promisesInQueue`, `:19`, `:33`, `:48-52`).
Кто объявляет: `selectTab` при смене экрана (`appImManager.ts:3162`), `chatsSelectTab`
(`:2782`), `TransitionSlider` (`transition.ts:368`). Кто слушает: `appImManager.construct`
замораживает анимации на это время (`appImManager.ts:436-442`):

```ts
useHeavyAnimationCheck(() => {
  animationIntersector.setOnlyOnePlayableGroup('lock');
  animationIntersector.checkAnimations2(true);   // всё на паузу
}, () => {
  animationIntersector.setOnlyOnePlayableGroup();
  animationIntersector.checkAnimations2(false);  // можно играть
});
```

### 8.4 `animationIntersector`, `liteMode`

`animationIntersector` (`components/animationIntersector.ts:52`) — реестр всего, что
проигрывается: lottie, гифки, видео. Каждый плеер регистрируется через `addAnimation({animation,
group, observeElement, ...})` (`:256`), видимость узнаёт через `IntersectionObserver` (`:157-161`),
на простое вкладки ставит паузу (`:152-154`), группы можно заблокировать (`lockGroup`, `:424`).
Подробно — [media.md](media.md) §9.3.

`liteMode` (`helpers/liteMode.ts`) — «энергосбережение»: `liteMode.isAvailable('animations')`
(`:24-34`) спрашивают перед каждой анимацией. Системное «уменьшить движение» тоже выключает
анимации (`:28-30`). Глобальный выключатель для CSS — классы `body.animation-level-0/2`, их
ставит `appImManager.setSettings` (`appImManager.ts:2738-2740`).

### 8.5 Брейкпоинты и классы на `body`

`mediaSizes` (`helpers/mediaSizes.ts`) делит ширину на три экрана (`:28-31`, пороги `:34-40`,
разбор — `handleResize`, `:136-155`). Граница medium↔large и есть граница «плавает/стоит рядом»
(комментарий `:35-38`):

| Экран | Ширина | Что видно |
|---|---|---|
| `mobile` | ≤ 600 | одна колонка из трёх, переключение `APP_TABS` |
| `medium` | 601–925 | левая колонка плавает поверх чата выдвижной панелью (`isFloatingLeftSidebar`, `:154`) |
| `large` | > 925 | левая колонка и чат рядом; встаёт ли рядом правая или плывёт поверх, решает `updateColumnWidths` (класс `right-column-floats`) |

Смена экрана — событие `changeScreen` (`:170-175`). Например, правая колонка закрывается при
сужении с `large` до `medium` (`sidebarRight/index.ts:33-37`).

Кто какой класс `body` пишет:

| Класс | Писатель | Строка |
|---|---|---|
| `is-left-column-shown` | `appImManager.selectTab` | `appImManager.ts:3142` (имя — `sidebarLeft/index.ts:110`) |
| `is-right-column-shown` | `appSidebarRight.toggleSidebar` / `hide` | `sidebarRight/index.ts:128`, `:96` |
| `has-chat` | `appImManager`, на `peer_changed` | `appImManager.ts:836` |
| `is-premium` | `appImManager`, на `premium_toggle` | `:393` |
| `animation-level-0/1/2` | `appImManager.setSettings` | `:2738-2740` |
| `right-column-floats` | `updateColumnWidths` | `helpers/updateColumnWidths.ts:377` |
| `has-auth-pages` | снимает `bootstrapIm` | `pages/bootstrapIm.ts:61` |

Один писатель на класс — правило, которое tweb соблюдает. Остальное делает CSS. Полный список
классов и ширины колонок — [state-and-layout.md](state-and-layout.md) §6.2–§6.5.

---

## 9. Как это у нас сейчас и куда идём

Срез `origin/main` = `b024f542`. Этапы — по плану
[`2026-09-30-wave-7-shell-sidebars.md`](../superpowers/plans/2026-09-30-wave-7-shell-sidebars.md)
(«Ключевой шов» и «Порядок этапов»).

### 9.1 Узел за узлом

| Узел / роль | У tweb | У нас сейчас | Этап волны 7 |
|---|---|---|---|
| точка входа | `index.html` + `src/index.ts` → `bootstrapIm` (§1) | как у tweb с К-2 волны 7: статика колонок в `index.html`, `src/index.ts` (развилка `mountAuthFlow`/`bootstrapIm`), `pages/bootstrapIm.ts`; React — только острова (`#react-overlays`, центр `reactChatInstance.ts`) | — (сделано, К-2) |
| `#column-left` | класс `AppSidebarLeft extends SidebarSlider` | React `components/Sidebar.tsx` (645 строк); слайдер вкладок уже класс `SidebarSlider` на узле колонки — `sidebarLeft/columnSlider.ts` (**2D-28**, в main) | **2-1** класс `AppSidebarLeft`, **2-9** снос `Sidebar.tsx` |
| вкладки левой колонки | `scaffoldSolidJSTab` / `SliderSuperTab` | настройки — Solid-вкладки (`components/solidJsTabs/tabs.ts`, `components/sidebarLeft/tabs/*.solid.tsx`, волна 2D); «Контакты» (**0а-1**) и «Новый канал» (**0а-3**) в main | 0а-2 (новая группа) и 0а-4 (звонки) — в ветках `feat/w7-0a-2-…`, `feat/w7-0a-4-…`; **0а-5** снос `SidebarScreens.tsx` |
| список чатов | `appDialogsManager` + `SortedDialogList` + `DialogElement` | владелец папок — класс `lib/appDialogsManager.ts` (волна 3); `DialogElement` 1:1 (**1-1**, в main, пока строит строки пикеров — `sortedUserList.ts`, `appSelectPeers.solid.tsx`); Solid-ядро `deferredSortedVirtualList.solid.tsx` (**1-3**, в main, ещё не подключено); сам список — React `ChatList.tsx` + `ChatListItem.tsx` поверх React-ядра `virtual/DeferredSortedVirtualList.tsx` | **1-2** контекст-меню, **1-4** `SortedDialogList` вместо React-списка, 1-5…1-8 |
| `#column-right` | синглтон `AppSidebarRight` | класс `components/sidebarRight/index.ts` (**0б-0**), вечный синглтон при импорте над статичным узлом `index.html` (К-2); вкладка №0 — `AppReactProfileTab` с React-панелью `UserInfoPanel.tsx` через портал; `AppChatTypeTab` — Solid (**0б-2**, в main) | 0б-1, 0б-3…0б-11 (0б-10, 0б-11 — в ветках); **3-1** `AppSharedMediaTab` вместо `UserInfoPanel`; **3-2** API для центра |
| центр, стек чатов | `appImManager.chats[]`, `chatsContainer` | React `components/chat/ChatsContainer.tsx` + `stores/chatStackStore.ts`, `stores/navigationStore.ts`; срез `selectTab` — `core/navigation/chatHistory.ts:504` (`selectProfileTab`) | **4-2** каркас `AppImManager`, **4-3** стек + временный `ChatFacade` |
| хэш, фон, тема, хоткеи, звонки, боты | блоки `appImManager` (§6.2) | разнесено по React-хукам и `core/*` | **4-4…4-6**, **5-1…5-7** |
| чат (`Chat` + `ChatTopbar`) | классы `chat.ts`, `topbar.ts` | React `components/Chat.tsx` (1592 строки) | **6** |
| лента | класс `ChatBubbles` | **класс** `components/chat/bubbles.ts` (порт tweb) внутри класса `Chat` (`components/chat/chat.ts`, К-3) | — |
| композер | класс `ChatInput` | React `components/Composer.tsx` + `composer/*` | **7** (на этапе 6 — React-остров за `ChatInputFacade`) |
| навигация Back/Esc | `appNavigationController` | порт `core/navigation/appNavigationController.ts` | — (уже есть) |
| анимации | `SetTransition`, `TransitionSlider`, heavy animation | `core/dom/setTransition.ts` + хук `useSetTransition`, `components/transition.ts`, `core/dom/heavyAnimation.ts` | — (уже есть) |
| попапы | Solid `PopupElement` | своя оболочка + часть React-попапов | волна 2C ([popups-solid.md](popups-solid.md) §9) |

### 9.2 Итог одной схемой

```
уже как у tweb (классы/Solid)            ещё React
──────────────────────────────            ─────────
ChatBubbles (лента)                       main.tsx → App.tsx (корень, каркас колонок)
SidebarSlider левой колонки (2D-28)       Sidebar.tsx (оболочка левой колонки)
вкладки настроек на scaffoldSolidJSTab    ChatList.tsx / ChatListItem.tsx (основной список)
AppSidebarRight (0б-0), AppChatTypeTab    UserInfoPanel.tsx (профиль справа)
DialogElement (1-1), Solid-ядро списка    ChatsContainer.tsx + Chat.tsx (центр)
  (1-3) — готовы, ждут 1-4                Composer.tsx (композер)
appDialogsManager — владелец папок
appNavigationController, transition, heavyAnimation
```

Порядок «от листьев к корню» (план, «Ключевой шов»): Solid-вкладка не может открыть React-экран,
обратного моста нет. Поэтому сначала экраны колонок становятся вкладками (0а, 0б), потом строки и
списки (1), потом оболочки колонок (2, 3), и только когда ни одна колонка не рисуется React,
меняется точка входа (4). `Chat` переезжает раньше композера (6 → 7), потому что у tweb
`Chat` сам создаёт `ChatInput` (`chat.ts:618`), а временный фасад композера в два с половиной раза
уже фасада чата (план, «Почему `Chat` раньше композера»).

---

## 10. Глоссарий

| Термин | Что значит |
|---|---|
| **синглтон** | объект UI, созданный один раз при импорте модуля (`const appX = new AppX()`) и живущий, пока открыта страница; включается вторым шагом — `construct(managers)` |
| **менеджер** | объект в воркере, который владеет данными одного вида и ходит в сеть: `appMessagesManager`, `appUsersManager`, `dialogsStorage`… (`createManagers.ts`). Не путать с `appImManager`/`appDialogsManager` — это контроллеры UI |
| **прокси (`managers`)** | двухуровневый `Proxy` во вкладке: `managers.appXxx.method(args)` превращается в RPC `'manager'` к воркеру и возвращает промис (`getProxiedManagers.ts`) |
| **`SuperMessagePort`** | типизированный RPC поверх `postMessage`: задачи `invoke`/`result`/`ack`, батчинг, рассылка всем портам (`superMessagePort.ts`) |
| **`rootScope`** | шина событий. Во вкладке одна, в воркере — по одной на аккаунт; `dispatchEvent` уходит и в порт, `dispatchEventSingle` — только локально |
| **зеркало** | копия пиров/сообщений во вкладке, которую воркер обновляет кадрами `mirror`; позволяет читать синхронно (`apiManagerProxy.getPeer`) |
| **`middleware`** | функция «я ещё актуален?»; `MiddlewareHelper.clean()` делает все выданные ранее `middleware()` ложными, `destroy()` ещё и зовёт деструкторы (`helpers/middleware.ts`) |
| **`ListenerSetter`** | копилка подписок: `listenerSetter.add(target)(event, cb)`, снимаются все разом `removeAll()` (`helpers/listenerSetter.ts`) |
| **слайдер** | `SidebarSlider` — контейнер колонки с историей вкладок; новая вкладка въезжает поверх, «назад» снимает верхнюю (`slider.ts`) |
| **вкладка** | `SliderSuperTab` — экран внутри слайдера: шапка, скролл, `init`/`open`/`close`; чаще всего сгенерирована `scaffoldSolidJSTab` с Solid-содержимым |
| **`APP_TABS`** | три положения экрана `appImManager`: список, чат, профиль; влияет на классы `body`, на телефоне виден один |
| **навигационный стек** | `appNavigationController`: каждое открытое окно (попап, вкладка, чат, меню) кладёт запись с `onPop`; Esc и системный Back закрывают верхнюю |
| **`SetTransition`** | анимация одного элемента классами `forwards`/`backwards`/`animating` с таймером (`singleTransition.ts`) |
| **`TransitionSlider`** | переключение «один активный ребёнок» классами `from`/`to`/`active` на детях и `animating`/`backwards` на контейнере (`transition.ts`) |
| **heavy animation** | объявленный период тяжёлого перехода (`dispatchHeavyAnimationEvent`); на это время `animationIntersector` ставит проигрывание на паузу, а код может дождаться конца через `getHeavyAnimationPromise()` |
| **`animationIntersector`** | реестр проигрываемого (стикеры, гифки, видео): играет только видимое и только когда можно |
| **`liteMode`** | «энергосбережение»: `liteMode.isAvailable('animations')`, `isAvailable('stickers_chat')` и т.п. спрашивают перед анимацией |
| **`overlayCounter`** | счётчик открытых оверлеев; хоткеи и анимации проверяют `isOverlayActive` |
| **остров** (у нас) | временный React- или Solid-корень внутри узла, которым владеет класс; живёт до конца переезда (план, «React-острова, которые переживают этап 4») |
