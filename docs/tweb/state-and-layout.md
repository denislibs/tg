# Состояние, события и каркас приложения tweb: как всё взаимодействует + layout

Снято 2026-08-16. Источники:

- исходники tweb `/Users/denisurevic/Documents/tweb` (форк, часть UI переписана на Solid.js —
  это отражено честно, см. пометки «форк»);
- наш код `web-client/` на `main`.

Смежные доки (не дублируются здесь):

- [`2026-06-23-tweb-architecture-findings.md`](../research/2026-06-23-tweb-architecture-findings.md) — взгляд со стороны бэкенда (MTProto, схема данных);
- [`2026-08-10-architecture-divergence-tweb.md`](../research/2026-08-10-architecture-divergence-tweb.md) — карта расхождений нашего клиента с tweb;
- [`right-sidebar.md`](right-sidebar.md) — слайдер/табы правой колонки (инфраструктура `SidebarSlider`, `TransitionSlider` описана там, здесь не повторяется).

Этот док — фронтовый разрез: **кто с кем как взаимодействует** (потоки, события, состояние,
апдейты, навигация) и **глобальный layout каркаса**.

---

# 1. Каркас потоков: main thread ↔ mtproto worker ↔ service worker

## 1.0 Общая картина

```
вкладка A (main thread)                вкладка B (main thread)
  apiManagerProxy (master SMP)           apiManagerProxy
  rootScope + UI                         rootScope + UI
        │  MessagePort                        │  MessagePort
        └──────────────┬──────────────────────┘
                       ▼
        SharedWorker: mainWorker/index.worker.ts
          MTProtoMessagePort<false> (non-master)
          appManagersManager → managers × 4 аккаунта
          (appMessagesManager, dialogsStorage, apiManager, …)
          свой rootScope на каждый аккаунт (эмитит 'event' во все вкладки)
                       │
                       │ 'serviceWorkerPort' (MessageChannel)
                       ▼
        Service Worker (sw.ts) — стриминг/скачивание медиа,
          просит части файлов у mtproto-воркера
```

Плюс отдельный **crypto worker** (`src/lib/crypto/crypto.worker.ts`, регистрируется в
`apiManagerProxy.registerCryptoWorker`, `src/lib/apiManagerProxy.ts:869-889`).

## 1.1 SuperMessagePort — транспорт (`src/lib/superMessagePort.ts`)

Универсальный типизированный RPC поверх `MessagePort`/Worker/SW. Ключевое:

| Что | Где | Суть |
|---|---|---|
| Типы кадров | `superMessagePort.ts:16-65` | `invoke` / `result` / `ack` / `ping` / `pong` / `batch` / `close` / lock |
| `attachPort` | `:199-202` | = `attachListenPort` + `attachSendPort` |
| `attachListenPort` / `attachSendPort` | `:204, :209` | слушающая и отправляющая стороны раздельно (SW — только send-порт со стороны main) |
| `close` при выгрузке | `:232` | вкладка шлёт `close` на `pagehide` — воркер узнаёт об отключении вкладки |
| ack/кэшируемые результаты | `:456-467, :524-534` | `invoke(..., ack)` возвращает `AckedResult` — «кэшированный» ответ может прийти синхронно |
| батчинг | `:372-387` | несколько задач склеиваются в кадр `batch` |
| `invokeExceptSource` | `:687-696` | разослать всем портам, кроме исходного — основа броадкаста между вкладками |

`MTProtoMessagePort` (`src/lib/mainWorker/mainMessagePort.ts:36-115`) — конкретизация
SuperMessagePort с типизированной картой сообщений в обе стороны:

- **main → worker** (`:36-70`): `manager` (RPC к менеджеру: `{name, method, args, accountNumber}`, `:14`), `state` (передача загруженного state), `event` (броадкаст), `crypto`, `serviceWorkerPort`, `toggleStorages`, passcode-семейство (`toggleUsingPasscode`, `changePasscode`, `isLocked`…), `createObjectURL`, `setInterval`/`clearInterval` (таймеры живут в воркере — не троттлятся фоновой вкладкой), `terminate`, `getLogs`;
- **worker → main** (`:70-85`): `mirror` (реплика данных, §3.5), `event`, `notificationBuild` (воркер просит вкладку показать нотификацию), `tabsUpdated`, `convertWebp`/`convertOpus` (перекодирование на main — в воркере нет нужных API), `localStorageProxy` (доступ к `localStorage` из воркера через вкладку), `intervalCallback`, `toggleLock`/`saveEncryptionKey` (passcode).

Синглтоны: master (на вкладке — это сам `ApiManagerProxy extends MTProtoMessagePort`) и
non-master (в воркере), `mainMessagePort.ts:86-114`; в `Modes.noWorker` оба живут в одном
realm (dev-режим).

## 1.2 Main thread: `ApiManagerProxy` (`src/lib/apiManagerProxy.ts`)

Единая точка входа вкладки:

| Обязанность | Где |
|---|---|
| Запуск mtproto-воркера: `SharedWorker` если поддерживается, иначе `Worker`; `Modes.noWorker` — `MessageChannel` в тот же realm | `apiManagerProxy.ts:891-929` |
| Регистрация service worker + `ServiceMessagePort<true>` (send-порт к активному SW: `hello`/`environment`) | `:651-658, :723-749` |
| Пересылка порта SW → mtproto-воркер (`serviceWorkerPort` c transfer `MessagePort`) | `:765-781`, приём в воркере `index.worker.ts:124-127` |
| Crypto-воркер | `:869-889` |
| Приём `event` от воркера → `rootScope.dispatchEventSingle` (§2.3) | `:347-352` |
| Приём `mirror` → локальные зеркала/solid-сторы (§3.5) | `:358, :186-304` |
| `tabState` вкладки: `{chatPeerIds, idleStartTime, accountNumber, id}` — воркер знает, какие чаты открыты и кто idle (для нотификаций) | `:126-131, :306-311, :1235-1242` |
| Загрузка state всех аккаунтов при старте и отправка в воркер | `loadAllStates :955-968`, `sendAllStates :989-1002` |
| `mainBroadcastChannel` (`BroadcastChannel`) — `reload` всех вкладок (например при локе passcode) | `:432-436` |

## 1.3 Воркер: `mainWorker/index.worker.ts` + `appManagersManager`

- Точка входа создаёт non-master порт (`index.worker.ts:39`) и вешает обработчики: `state`
  (`:66-110` — резолвит `resetStoragesPromise` стейт-менеджера аккаунта и заливает state в
  него), `event` (`:117-120` — **редирект события во все вкладки, кроме источника**,
  `invokeExceptSource`), passcode/локи, `manager`.
- `appManagersManager` (`src/lib/appManagers/appManagersManager.ts`): держит
  `stateManagersByAccount` (`:72`) и лениво создаёт **полный набор менеджеров на каждый из 4
  аккаунтов** (`createManagers`, `:189-195`). RPC-обработчик `manager` (`:94-110`) находит
  менеджер по `accountNumber` + `name` и зовёт метод.
- `createManagers` (`src/lib/appManagers/createManagers.ts:64-188`) — фактический список того,
  **что живёт в воркере**: `appPeersManager, appChatsManager, appUsersManager, appMessagesManager,
  appDraftsManager, appProfileManager, appNotificationsManager, apiUpdatesManager, appReactionsManager,
  appStickersManager, appEmojiManager, dialogsStorage, filtersStorage, referencesStorage, peersStorage,
  thumbsStorage, monoforumDialogsStorage, apiManager, apiFileManager, networkerFactory, authorizer,
  dcConfigurator, timeManager, appStoragesManager, appStateManager, appStoriesManager, appBoostsManager,
  appPaymentsManager, appGiftsManager, …` (всего ~55). У каждого аккаунта — **свой `RootScope`**
  (`:103`) с прокинутым `managers` (`:153`). После создания у менеджеров вызываются `after()`-хуки
  (инициализация, подписки на апдейты; `appUsersManager`/`appChatsManager`/`dialogsStorage` — первыми,
  `:155-178`), затем `managers_ready` (`:185`).
- Учёт вкладок: `appTabsManager` + `listenMessagePort(port, onTabConnect, onTabDisconnect)`
  (`index.worker.ts:313`); при подключении **не первой** вкладки ей зеркалируют всё:
  `thumbsStorage.mirrorAll(source)`, `appPeersManager.mirrorAllPeers(source)`,
  `appMessagesManager.mirrorAllMessages(source)` (`:289-303`). Автолок passcode: если все
  вкладки idle — воркер эмитит `reload` в BroadcastChannel и самозавершается (`:268-287, useAutoLock.ts`).

**На main thread менеджеров-владельцев данных нет** — там живут контроллеры UI: `appImManager`
(`src/lib/appImManager.ts`, чат/колонки), `appDialogsManager` (список чатов), `appSidebarLeft/Right`,
`appMediaPlaybackController`, `uiNotificationsManager` и т.п. Все они ходят в воркер через прокси.

## 1.4 Прокси-менеджеры: `getProxiedManagers` (`src/lib/getProxiedManagers.ts`)

- Двухуровневый `Proxy`: `managers.<name>` лениво создаёт прокси менеджера (`:142-149`),
  `managers.<name>.<method>(...args)` превращается в
  `apiManagerProxy.invoke('manager', {name, method, args, accountNumber})` (`:74-114`, вызов `:90`).
- Три варианта (`:158-167`): `proxied` (обычный, `Promise<result>`), `proxied.acknowledged`
  (с ack — воркер может ответить кэшем мгновенно), `proxied.all` (`accountNumber: undefined` —
  метод выполняется **на всех аккаунтах**, `appManagersManager.ts:98-106`).
- Типы выводятся из `ReturnType<typeof createManagers>` → UI получает полную типизацию методов
  воркера без импорта реализаций (`:124-135`).
- `createProxiedManagersForAccount(n)` — для кросс-аккаунтных сценариев (нотификация о звонке
  другого аккаунта, `apiManagerProxy.ts:369-393`).

## 1.5 Service worker

- Роль: перехват fetch для **стриминга медиа** и download-ссылок; сами байты SW просит у
  mtproto-воркера через проброшенный порт: обработчик `requestDocPart` →
  `appDocsManager.requestDocPart(docId, dcId, offset, limit)` (`appManagersManager.ts:216-221`).
- `ServiceMessagePort` — тот же SuperMessagePort; main держит send-порт на активный SW
  (`apiManagerProxy.ts:651-655`), listen-порт — на `navigator.serviceWorker` (`:765-768`).
- Safari-специфика: `pingServiceWorkerWithIframe` (`:610-625`) — будит SW.

## 1.6 Порядок старта main thread (`src/index.ts`)

1. `apiManagerProxy` создаётся импортом → регистрирует воркеры (`apiManagerProxy.ts:317-322`).
2. `apiManagerProxy.loadAllStates()` (`index.ts:455`) — state всех аккаунтов из IndexedDB,
   попутно `rootScope.dispatchEvent('user_auth')` если залогинен (`apiManagerProxy.ts:970-979`).
3. `singleInstance.start()` (`index.ts:464-470`) — контроль «одна активная вкладка на аккаунт»
   (`src/lib/singleInstance.ts`; деактивированная вкладка получает `deactivated`-оверлей).
4. `apiManagerProxy.sendAllStates(...)` (`index.ts:468,500`) → воркер строит менеджеры.
5. Язык (`I18n.getCacheLangPackAndApply`, `:487`), тема (`themeController.setThemeListener`, `:511`),
   затем страница авторизации или `bootstrapIm` → `appImManager`.

---

# 2. rootScope — событийная шина

## 2.1 Класс (`src/lib/rootScope.ts:252-311`)

- `RootScope extends EventListenerBase<BroadcastEventsListeners>` — обычный typed event emitter
  (`src/helpers/eventListenerBase.ts`: `addEventListener(name, cb, {once?})`, `dispatchEvent`,
  поддержка «кэшированного» повторного диспатча для поздних подписчиков).
- Поля-кэши: `myId` (обновляется по `user_auth`, `:265-267`), `premium`
  (по `premium_toggle_private`, `:269-274`), `connectionStatus` (`:276-278`), `managers`
  (на main — прокси из `getProxiedManagers`, в воркере — реальные менеджеры аккаунта).
- **Переопределённый `dispatchEvent`** (`:280-290`): локальный dispatch + пересылка
  `MTProtoMessagePort.invokeVoid('event', {name, args, accountNumber})`.
- `dispatchEventSingle` (`:305-310`) — только локально, без пересылки (им пользуется приёмник,
  чтобы не зациклить броадкаст).

## 2.2 Экземпляры

`rootScope` — модульный синглтон (`:313-315`), **но** в воркере `createManagers` создаёт свой
`new RootScope` на аккаунт (`createManagers.ts:103`). Итого: 1 на вкладку (UI) + 1 на аккаунт
(воркер). Менеджеры эмитят в свой воркерный `this.rootScope`.

## 2.3 Механика броадкаста (важнейшее)

1. **Воркер → все вкладки**: менеджер зовёт `this.rootScope.dispatchEvent('x', payload)` →
   переопределение (`rootScope.ts:280-290`) шлёт `event` через порт воркера **всем вкладкам**;
   вкладка принимает (`apiManagerProxy.ts:347-352`) и делает `rootScope.dispatchEventSingle`.
2. **Вкладка → остальные вкладки**: UI зовёт `rootScope.dispatchEvent` → кадр `event` уходит в
   воркер; воркер **редиректит** его `invokeExceptSource('event', payload, source)`
   (`index.worker.ts:117-120`) — получают все, кроме отправителя.
3. **Фильтр мульти-аккаунта**: вкладка отбрасывает события чужого `accountNumber`, кроме
   общесистемных `commonEventNames`: `language_change, settings_updated, theme_changed,
   theme_change, background_change, logging_out, notification_count_update, account_logged_in,
   notification_cancel, toggle_using_passcode` (`apiManagerProxy.ts:324-335, :347-352`).

Следствие: **любое** `rootScope.dispatchEvent` — мульти-вкладочное по умолчанию; события «только
для этой вкладки» диспатчат через `dispatchEventSingle` либо через локальные эмиттеры
(`appImManager` сам является `EventListenerBase` со своими `chat_changing / peer_changed /
tab_changing`, `appImManager.ts:197-203` — они в rootScope не попадают).

## 2.4 Карта событий `BroadcastEvents` (`rootScope.ts:29-246`)

Полный тип — по указанным строкам; ниже группировка с основными эмитентами (эмитент = менеджер
в воркере, если не сказано иное).

### Диалоги / фильтры / папки

| Событие | Payload | Эмитит | Слушают (примеры) |
|---|---|---|---|
| `dialogs_multiupdate` | `Map<PeerId, {dialog?, topics?, saved?}>` (`:74`) | `dialogsStorage` (`storages/dialogs.ts:1284`), `appMessagesManager` (`:3404, :6239`) | списки чатов: `autonomousDialogList/dialogs.ts:105`, forum/saved-варианты |
| `dialog_draft` | `{peerId, dialog, drop, draft}` (`:66`) | `appDraftsManager` | строка диалога |
| `dialog_unread` / `dialog_flush` / `dialog_drop` / `dialog_migrate` / `dialog_notify_settings` | `:67-72` | `dialogsStorage`/`appMessagesManager` | список чатов, топбар |
| `folder_unread` | `Folder` без dialogs (`:64`) | `dialogsStorage` | счётчики папок |
| `filter_new/update/delete/order/joined` | `MyDialogFilter` / `number[]` (`:58-62`) | `filtersStorage` | меню папок |

### Сообщения / история

| Событие | Payload | Эмитит | Слушают |
|---|---|---|---|
| `history_append` | `{storageKey, message}` (`:77`) | `appMessagesManager.ts:2792, :7310` (новое сообщение в открытой истории) | `chat/bubbles.ts:1860` |
| `history_multiappend` | `MyMessage` (`:80`) | `appMessagesManager.ts:6176` (из `onUpdateNewMessage`) | bubbles, диалог-лист |
| `history_update` | `{storageKey, message, tempId?, sequential?}` (`:78`) | appMessagesManager | bubbles (перестановка) |
| `history_delete` | `{peerId, msgs: Set<number>}` (`:82`) | appMessagesManager | bubbles, список |
| `history_reload` / `history_forbidden` | `PeerId` (`:83-84`) | appMessagesManager | chat |
| `message_sent` | `{storageKey, tempId, tempMessage, mid, message}` (`:89`) | appMessagesManager (ack отправки) | bubbles (замена temp→real) |
| `message_edit` / `message_error` / `message_transcribed` | `:88-91` | appMessagesManager | bubbles |
| `messages_views` / `messages_reactions` / `messages_read` / `messages_media_read` / `messages_pending` / `messages_downloaded` | `:92-97` | appMessagesManager / appReactionsManager | bubbles, топбар |
| `scheduled_new` / `scheduled_delete` | `:115-116` | appMessagesManager | вкладка запланированных |
| `grouped_edit`, `replies_updated`, `replies_short_update` | `:112-118` | appMessagesManager | альбомы, кнопка комментариев |

### Пиры / пользователи / чаты

| Событие | Payload | Эмитит | Слушают |
|---|---|---|---|
| `user_update` | `UserId` (`:39`) | `appUsersManager.ts:86-99` (updateUserStatus) | топбар (`chat/topbar.ts`), профиль (`peerProfile.tsx`), диалог-лист |
| `user_auth` | `UserAuth` (`:40`) | `apiManager` / `apiManagerProxy.ts:970-979` | rootScope сам (`myId`), страницы авторизации |
| `user_full_update` / `peer_full_update` | `UserId`/`PeerId` (`:41, :53`) | `appProfileManager` | профиль, топбар |
| `chat_update` / `chat_full_update` / `channel_update` | `ChatId` (`:30-37`) | `appChatsManager`/`appProfileManager` | топбар, профиль |
| `chat_toggle_forum`, `chat_participant`, `chat_participation`, `chat_requests` | `:32-35` | appChatsManager | форум-таб, списки участников |
| `peer_typings` | `{peerId, threadId?, typings}` (`:49`) | `appProfileManager` | топбар/строка диалога |
| `peer_pinned_messages` / `peer_pinned_hidden` | `:47-48` | appMessagesManager | pinned-плашка |
| `peer_block`, `peer_title_edit`, `peer_deleted`, `peer_settings`, `peer_stories*` | `:50-56` | appProfileManager/appUsersManager/appStoriesManager | профиль, actions-бар |
| `contacts_update` | `UserId` (`:134`) | appUsersManager | список контактов |
| `avatar_update` | `{peerId, threadId?}` (`:135`) | `appAvatarsManager` | все аватарки |
| `premium_toggle` / `premium_toggle_private` | `boolean` (`:197-198`) | appUsersManager → rootScope (`:269-274`) | лимиты, эмодзи-статусы |

### Стикеры / эмодзи / gif

| Событие | Payload (`rootScope.ts`) | Эмитит |
|---|---|---|
| `stickers_installed` / `stickers_deleted` | `StickerSet.stickerSet` (`:120-121`) | appStickersManager |
| `stickers_updated` / `sticker_updated` | recent/faved (`:122, :125`) | appStickersManager |
| `stickers_top`, `stickers_order` | `:123-124` | appStickersManager |
| `emoji_recent` | `{emoji, deleted?}` (`:169`) | appEmojiManager |
| `gifs_updated` / `gif_updated` | `:127-128` | appGifsManager |

### Состояние / настройки / тема / язык

| Событие | Payload | Эмитит | Заметка |
|---|---|---|---|
| `settings_updated` | `{key, value, settings}` (`:143`) | `appStateManager.setByKey` (`appStateManager.ts:46`) | common-событие (все аккаунты) |
| `theme_change` / `theme_changed` | `{x,y}?` / void (`:164-165`) | UI (переключатель) / `themeController` | common |
| `background_change`, `chat_background_set` | `:146, :216` | UI настроек | common |
| `language_change` / `language_apply` / `langpack_update*` | `:159-162` | `appLangPackManager` | change — common, apply — одна вкладка |
| `state_cleared` / `state_synchronized` / `state_synchronizing` | void (`:130-132`) | appStateManager / apiUpdatesManager | прогресс синка |
| `config` / `app_config` | `Config` / `MTAppConfig` (`:207-208`) | `apiManager` | лимиты, фичефлаги |
| `account_logged_in`, `logging_out`, `unconfirmed_authorizations_update` | `:191, :211, :243` | appAccountManager | мульти-аккаунт |
| `toggle_using_passcode` | `boolean` (`:218`) | passcode-подсистема | common |

### Медиа / загрузки / звонки / прочее

| Событие | Payload | Эмитит |
|---|---|---|
| `download_progress` / `document_downloading` / `document_downloaded` | `:171-173` | `appDownloadManager` (main) / apiFileManager |
| `media_play` | void (`:167`) | `appMediaPlaybackController` (main) |
| `group_call_update`, `group_call_participant`, `call_update`, `call_signaling`, `rtmp_call_update` | `:177-185` | appGroupCallsManager / appCallsManager |
| `story_*`, `stories_*` | `:99-110` | appStoriesManager |
| `notify_settings`, `notify_peer_type_settings` | `:151-152` | appNotificationsManager |
| `notification_reset` / `notification_cancel` / `notification_count_update` | `:154-157` | uiNotificationsManager / воркер (`tabsUpdated` → `apiManagerProxy.ts:364-367`) |
| `connection_status_change` | `ConnectionStatusChange` (`:142`) | networker (воркер) → индикатор `components/connectionStatus.ts` |
| `poll_update`, `webpage_updated`, `privacy_update`, `draft_updated`, `quick_reaction`, `payment_sent`, `stars_balance`, `star_gift_*`, `monoforum_*` | `:136-245` | соответствующие менеджеры |
| `resizing_left_sidebar` / `right_sidebar_toggle` | void / boolean (`:213-214`) | ресайз-хэндлы колонок (main; слушает `updateColumnWidths.ts:386`) |
| `managers_ready` | void (`:209`) | `createManagers.ts:185` (внутреннее) |

---

# 3. Хранение состояния

## 3.1 Схема `State` (`src/config/state.ts`)

`STATE_VERSION = App.version`, `BUILD = App.build` (`state.ts:22-23`). Персистится в IndexedDB
по ключам (каждый ключ `State` — отдельная запись стора `session`):

| Ключ `State` (`state.ts:186-238`) | Что |
|---|---|
| `allDialogsLoaded`, `pinnedOrders` | прогресс подгрузки диалогов, порядок пинов (из `dialogsStorage`) |
| `filtersArr` | папки-фильтры |
| `updates {seq, pts, date}` | позиция апдейтов для `updates.getDifference` |
| `maxSeenMsgId`, `contactsListCachedTime`, `topPeersCache`, `recentSearch`, `recentEmoji`, `recentCustomEmoji` | кэши |
| `authState` | текущий шаг авторизации (`:212, :571-573`) |
| `hiddenPinnedMessages`, `hideChatJoinRequests`, `hiddenSimilarChannels`, `notifySettings`, `botCommands`, `confirmedWebViews`, `dontShowPaidMessageWarningFor`, `ageVerification`, `accountContentSettings`, `unconfirmedAuthorizations` | пользовательские отметки/кэши |
| `appConfig`, `accountThemes` | серверный конфиг |
| `version`, `build`, `stateCreatedTime` | для миграций |
| `settings?` | DEPRECATED — переехали в `CommonState` |

`StateSettings` (`:52-176`) — **общие для всех аккаунтов** настройки (`CommonState = {settings}`,
`:240-242`): тема (`themes`, `theme`, `lastThemeNames`), `liteMode` (все ключи, `:103`),
нотификации, `sendShortcut`, `timeFormat`, `autoDownload`, `stickers/emoji`, `playbackParams`,
`translations`, `passcode`, `tabsInSidebar`, `seenTooltips` и др. Дефолты — `SETTINGS_INIT`
(`:409-553`), `STATE_INIT` (`:555-586`).

## 3.2 Загрузка и миграции: `loadState.ts` (`src/lib/appManagers/utils/state/loadState.ts`)

- Читает все `ALL_KEYS` из `stateStorage` (`:43, :268`), заполняет отсутствующее из `STATE_INIT`.
- **REFRESH**: если `stateCreatedTime + 24h < now` — сбрасываются `REFRESH_KEYS =
  [contactsListCachedTime, stateCreatedTime, maxSeenMsgId, filtersArr]` (`:36, :46-51, :156-165`).
- **Версия/билд**: при несовпадении `version`/`build` (`:200-217`) сбрасываются
  `RESET_WITH_BUILD = [appConfig, version, build]` (`:53-57`); `newVersion/oldVersion`
  прокидываются в воркер (баннер changelog).
- **Миграция настроек**: одноразовый перенос старых ключей `State` (playbackParams,
  seenTooltips, translations…) в `CommonState.settings` (`:307-327`).
- Результат (`LoadStateResult`): `state`, `common`, `resetStorages`
  (Map сторов, требующих очистки), `pushedKeys` — уезжает в воркер кадром `state`
  (`apiManagerProxy.sendAllStates :989-1002` → `index.worker.ts:66-110`, где резолвится
  `appStateManager.resetStoragesPromise`, `appStateManager.ts:30`; при сбросе стора `users`
  сохраняется свой userId, `index.worker.ts:79-82`).

## 3.3 Слои хранения

| Хранилище | Файл | Что лежит |
|---|---|---|
| IndexedDB `tweb-account-N` (v9), сторы: `session`, `stickerSets`, `users`, `chats`, `messages`, `dialogs`, `webapp` (+ `__encrypted`-варианты) | `src/config/databases/state.ts` (`getDatabaseState`) | state по ключам (`session`), кэши сущностей менеджеров |
| IndexedDB `tweb-common` (v8): `session`, `localStorage` | там же, `getCommonDatabaseState` | `CommonStateStorage`: `settings`, `langPack`, `notificationsCount`, `passcode` (`commonStateStorage.ts:30-40`) |
| IndexedDB `tweb` (v7) | `getOldDatabaseState` | легаси-миграция со старой single-account базы |
| `localStorage` (через `sessionStorage.ts`) | `src/lib/sessionStorage.ts` | auth-ключи DC (`dc1_auth_key`…), `user_auth`, `state_id`; воркер ходит сюда через кадр `localStorageProxy` (`apiManagerProxy.ts:354-356`) |
| `localStorage` (напрямую) | `updateColumnWidths.ts:103-104` | ширины колонок `sidebar-left-width` / `sidebar-right-width` |
| CacheStorage | `src/lib/files/cacheStorage.ts` | скачанные медиа (SW + main) |

`AppStorage` (`src/lib/storage.ts`) — обёртка над IndexedDB: кэш значений в памяти + отложенная
запись; `StateStorage` (`src/lib/stateStorage.ts:14-17`) — `AppStorage` на базе аккаунта.
`appStateManager.pushToState/setKeyValueToStorage` (`appStateManager.ts:52-85`): записывает в
storage **и** зеркалирует ключ на все вкладки кадром `mirror {name:'state', key, value}`;
ключ `settings` уходит в `commonStateStorage` (`:75-80`), плюс событие `settings_updated`
(`:41-50`).

## 3.4 Passcode / шифрование

При включённом пасскоде IndexedDB-сторы переключаются на `*__encrypted`
(`encryptedStorageLayer.ts`, ключ — в `EncryptionKeyStore`, деривация из пасскода;
`toggleUsingPasscode`-кадр перешифровывает всё: `index.worker.ts:148-165`). Лок — глобальный на
все вкладки (`toggleLockOthers`/`toggleLock`, `isLocked`), автолок по idle всех вкладок
(`useAutoLock`, §1.3).

## 3.5 Кэши воркера и mirrors на main

Владелец данных — воркер (Map/объекты в `appUsersManager.users`, `appChatsManager.chats`,
`appMessagesManager` storages, `dialogsStorage`…). На main вкладка держит **реплики** (mirror),
чтобы синхронно рендерить без RPC:

| Mirror (`apiManagerProxy.ts:76-94`) | Что | Обработка на main |
|---|---|---|
| `peers` | `User.user \| Chat` по peerId | `reconcilePeer(s)` → solid-стор `@stores/peers` (`:243-249`) *(форк; в апстриме — плоский объект)* |
| `messages` + `groupedMessages` | сообщения по storage key/mid | `:187-233` |
| `state` | ключи State | `setAppStateSilent` → `@stores/appState` (`:235-241`) |
| `historyStorage` | `SlicedArray` истории (сериализованные слайсы) | `@stores/historyStorages` (`:251-303`) *(форк)* |
| `thumbs` / `stickerThumbs` / `avatars` | превью/URL аватаров | `getCacheContext :1031-1043` |
| `availableReactions` | список реакций | `:1045-1053` |

Пуш зеркал: менеджер меняет данные → `MTProtoMessagePort.invokeVoid('mirror', {name, key, value,
accountNumber})`; новой вкладке при коннекте зеркалируют всё скопом (§1.3).

## 3.6 Мульти-аккаунт

- До 4 аккаунтов (`ActiveAccountNumber = 1..4`); номер текущего — из URL
  (`getCurrentAccountFromURL`/`getCurrentAccount`, `src/lib/accounts/*`).
- `AccountController` — реестр аккаунтов (userId, dcId, даты) в общем хранилище.
- Воркер один на все вкладки/аккаунты; вкладка привязана к одному аккаунту (`tabState.accountNumber`),
  RPC всегда несёт `accountNumber`. События фильтруются на вкладке (§2.3).
- `notifyAllAccounts` (настройка) + `notificationBuild`-кадры: воркер сам решает, какая вкладка
  покажет нотификацию чужого аккаунта.

---

# 4. Применение апдейтов MTProto (концептуально)

Цепочка: **networker → apiUpdatesManager → менеджеры-подписчики → rootScope-события → UI**.
Всё до «→ UI» происходит в воркере.

1. `apiManager.setUpdatesProcessor(processUpdateMessage)` (`apiUpdatesManager.ts:756`) — сырые
   `updates`-контейнеры от сети попадают в `processUpdateMessage` (`:179`).
2. Контроль целостности: `updatesState {seq, pts, date}` (`:43`) на аккаунт + `channelStates`
   по каналам (`:50, :472-491`). Пропуск/дырка в pts/seq → `getDifference` (`:276`) /
   `getChannelDifference` (`:378`); отложенные апдейты копятся и доигрываются
   (`popPendingPtsUpdate :114`, `popPendingSeqUpdate :82`). `updatesState` персистится в
   `State.updates` (`saveUpdatesState :73`). Для просматриваемых каналов — форс-подписка с
   опросом difference раз в 3 c (`subscribeToChannelUpdates :671-684`).
3. `saveUpdate(update)` → `this.dispatchEvent(update._, update)` (`:666-669`) —
   `apiUpdatesManager` сам является typed-эмиттером по именам конструкторов апдейтов.
4. Менеджеры подписываются пачками: `this.apiUpdatesManager.addMultipleEventsListeners({updateX: cb})`
   в своих `after()` — таких подписчиков ~27 (пример списка: `appMessagesManager.ts:636`,
   `appUsersManager.ts:85`, `storages/dialogs.ts:184`, `storages/filters.ts:47`,
   `appChatsManager.ts:67`, `appDraftsManager.ts:42`, `appPollsManager.ts:82`, …).
5. Менеджер мутирует свои кэши/storage, пушит `mirror` и эмитит доменные rootScope-события.

Сквозные примеры:

| Update | Менеджер | rootScope-событие | UI |
|---|---|---|---|
| `updateUserStatus` | `appUsersManager.ts:86-99`: мутирует `user.status`, сохраняет | `user_update` (`:97`) | `chat/topbar.ts` (подзаголовок online), `peerProfile.tsx` |
| `updateNewMessage` / `updateNewChannelMessage` | `appMessagesManager.onUpdateNewMessage` (`:640, :7428`): сохранить сообщение, обновить unread/top-message диалога | `history_multiappend` (`:6176`), `history_append` (`:2792`), `dialogs_multiupdate` (`:6239`) | `chat/bubbles.ts:1860` (дорисовать пузырь), `autonomousDialogList/dialogs.ts:105` (поднять диалог) |
| `updateDeleteMessages` | appMessagesManager: вычистить storages, пересчитать диалог | `history_delete` (`rootScope.ts:82`), `dialog_unread` | bubbles (удаление пузырей), список чатов |

Локальные (не с сервера) изменения гоняются тем же путём: `processLocalUpdate` (`:169-177`) —
например, после `sendMessage` менеджер сам порождает `updateNewMessage`
(`appMessagesManager.ts:1457, :8497`), поэтому UI-путь един для своих и чужих сообщений.

---

# 5. Навигация

## 5.1 `appNavigationController` (`src/components/appNavigationController.ts`)

Единый стек «что закроет Back/Esc». `NavigationItem` (`:10-22`):

```ts
type: 'left' | 'right' | 'im' | 'chat' | 'popup' | 'media' | 'menu' |
  'esg' | 'multiselect' | 'input-helper' | 'autocomplete-helper' | 'markup' |
  'global-search' | 'voice' | 'mobile-search' | 'filters' | 'global-search-focus' |
  'toast' | 'dropdown' | 'forum' | 'stories' | 'stories-focus' | 'topbar-search' |
  'settings-popup' | 'monoforum' | 'inline-message-input'
onPop(canAnimate) => boolean | void   // false = «не закрылся», вернуть в стек
onEscape?() => boolean                // право закрыться по Esc
noHistory?: boolean                   // не двигать history браузера
```

| Механика | Где | Суть |
|---|---|---|
| `pushItem` | `:381-384` | push в стек + `history.pushState(tabId)` (или Navigation API, `:24, :401-410`) — каждый открытый слой = запись истории → системный Back закрывает слой, а не уходит с сайта |
| popstate/navigate | `:87-214` | pop верхнего item → `handleItem` → `item.onPop(canAnimate)`; `false` — вернуть на место (`:290-304`) |
| `back(type?)` | `:343-353` | закрыть верхний item данного типа (ищет с конца, `findItemByType :334`) |
| `removeByType` | `:436-447` | снять items без вызова onPop (когда слой закрыли программно) |
| Esc | `:216-223` | закрывает **верхний** item стека, если все `escapeHandlers` разрешают (`canCloseOnEscape :449-451`, регистрация `:453-459`) и `item.onEscape()` не запретил. Иерархия Esc = порядок стека: popup поверх сайдбара поверх чата |
| iOS Safari swipe-back | `:225-237` | `isPossibleSwipe` — жест не должен запускать анимации закрытия повторно |
| hash | `:274-288, :412-425` | `overrideHash` — «виртуальный» URL `#/im?p=…` без создания записей; `onHashChange` → appImManager |
| `reload()` | `:499-511` | очистить стек и перезагрузить (используется BroadcastChannel-локом) |

Пользователи стека: `SidebarSlider.pushNavigationItem` (`type:'right'/'left'`, см. док по правой
колонке), попапы (`type:'popup'`), меню (`'menu'`), медиавьювер (`'media'`), выбор эмодзи
(`'esg'`), мультиселект, поиск и т.д.

## 5.2 Мобильный стек экранов: `APP_TABS` + `'im'`

- `APP_TABS { CHATLIST, CHAT, PROFILE }` (`appImManager.ts:192-196`); `appImManager.selectTab(id)`
  (`:2588-2652`): ставит `body.is-left-column-shown` при CHATLIST (`:2593`,
  константа `sidebarLeft/index.ts:103`), диспатчит `tab_changing`, оборачивает переход в
  `dispatchHeavyAnimationEvent` (`:2645-2647`), на mobile при уходе из PROFILE прячет правую
  колонку (`:2657-2659`).
- При движении «вперёд» (CHATLIST→CHAT) пушится NavigationItem `type:'im'`
  (`:2662-2669`), чей `onPop` делает `setPeer({})` — системный Back с открытого чата возвращает
  к списку. `overrideHash(peerId)` — URL отражает открытый чат (`:2597`).

## 5.3 Deep links: `internalLinkProcessor` (`src/lib/internalLinkProcessor.ts`)

- `construct(managers)` (`:59`) навешивает через `addAnchorListener` перехват кликов по
  `t.me/...` и `tg://`-ссылкам (по шаблонам pathname/uri-параметров, `:62-530`) — каждая
  превращается в typed-объект `InternalLink` и уходит в `processInternalLink` (`:1333`),
  где карта `INTERNAL_LINK_TYPE → this.processXxxLink` (`:1334-1362`).
- Хэш при старте: `appImManager.onHashChange` (`appImManager.ts:317, :1600-1625`) разбирает
  `#?p=…` (peer), `#?tgaddr=…` (внутренняя ссылка → `openUrl`).

Типы ссылок (`src/lib/internalLink.ts:5-33`):

| INTERNAL_LINK_TYPE | Что открывает |
|---|---|
| `MESSAGE` | t.me/username[/topic]/mid — чат/пост (`processMessageLink`) |
| `PRIVATE_POST` | t.me/c/channelId/mid |
| `STICKER_SET` / `EMOJI_SET` | попап стикерпака (`addstickers`/`addemoji`, `:136-137`) |
| `JOIN_CHAT` | инвайт `+hash` / `joinchat` |
| `VOICE_CHAT` | видеочат в чате |
| `USER_PHONE_NUMBER` | t.me/+79… |
| `INVOICE` | оплата `$slug` |
| `ATTACH_MENU_BOT` / `WEB_APP` | вебапп-боты |
| `ADD_LIST` | шаренная папка `addlist` |
| `STORY` / `STORY_ALBUM` | сторис |
| `BOOST` / `PREMIUM_FEATURES` / `GIFT_CODE` / `STARS_TOPUP` / `UNIQUE_STAR_GIFT` / `STAR_GIFT_COLLECTION` | буст/премиум/подарки/звёзды |
| `BUSINESS_CHAT` | t.me/m/… |
| `SHARE` | шаринг url в выбранный чат |
| `INSTANT_VIEW` | IV-страница |
| `NEW`, `SETTINGS`, `CONTACTS`, `CONFERENCE_CALL`, `ADD_AI_STYLE` | служебные (форк добавил AI-стили) |

---

# 6. Глобальный layout

## 6.1 Каркас DOM (`/index.html:88-113`)

```
body
├ svg defs (иконки-симболы)
├ .sidebar-left-overlay                      ← затемнение под плавающий левый сайдбар
├ .whole.page-chats#page-chats (display:none до логина)
│ └ #main-columns.tabs-container[data-animation="navigation"]
│   ├ #column-left.tabs-tab.chatlist-container.sidebar.sidebar-left.main-column
│   │ └ .sidebar-slider.tabs-container        ← стек табов левого сайдбара
│   │   └ .tabs-tab.item-main.active
│   │     ├ .sidebar-header (бургер + поиск)
│   │     └ .sidebar-content.transition.zoom-fade
│   │       ├ #chatlist-container > #folders-container (папки)
│   │       └ #search-container (глобальный поиск)
│   ├ #column-center.tabs-tab.main-column     ← сюда appImManager вставляет чаты
│   └ #column-right.tabs-tab.sidebar.sidebar-right.main-column
│     └ .sidebar-content.sidebar-slider.tabs-container
└ #stories-viewer
```

- `#main-columns` — тот же `tabs-container`, что и слайдеры (см. right-sidebar-док §1.3): на
  мобильном колонки переключаются как «tabs» чистым CSS (`data-animation="navigation"`), без
  JS-параллакса.
- `appImManager.columnEl = #column-center` (`appImManager.ts:205`), туда добавляются
  `chatsContainer` (`:312`), плашки звонка/аудио (`:719-723`).

## 6.2 Брейкпоинты: `mediaSizes` (`src/helpers/mediaSizes.ts`)

| Константа | Значение | Смысл |
|---|---|---|
| `MOBILE_SIZE` | 600 (`:34`) | ≤600 — `ScreenSize.mobile`: один экран, колонки-стек |
| `FLOATING_LEFT_SIDEBAR_SIZE` | 925 (`:39`) | 601–925 — `medium`: левый сайдбар — плавающий drawer поверх чата |
| `LARGE_SIZE` | 1680 (`:40`) | >925 — `large`: всё в док-раскладке |

- `ScreenSize {mobile, medium, large}` (`:28-32`); `handleResize` на rAF (`:112-134, :136-189`),
  события `changeScreen(from, to)` и `resize` (`:54-57`); флаги `isMobile`,
  `isFloatingLeftSidebar`, `isLessThanFloatingLeftSidebar`; solid-store `useMediaSizes()`
  (`:46-52, :196-198`, форк).
- `active: MediaTypeSizes` — размеры медиа в сообщениях: два пресета `handhelds`/`desktop`
  (`:64-101`, `regular` 340×340 vs 420×400 и т.д.) — переключаются вместе со скрином.

## 6.3 Ширины колонок: `updateColumnWidths` (`src/helpers/updateColumnWidths.ts`)

JS — единственный владелец ширин; SCSS только читает переменные (шапка-контракт `:1-61`):

| CSS-переменная | Что | Строка записи |
|---|---|---|
| `--default-column-width` | `min(vw, 360)` | `:325-328` |
| `--left-column-visual-width` | фактическая ширина `#column-left` (drawer/collapsed/предпочтение юзера) | `:329-332`, расчёт `:205-221` |
| `--left-column-width` | ширина, которую левая колонка занимает в потоке (в collapsed+таб — остаётся 80) | `:333-336`, расчёт `:227-237` |
| `--right-column-width` | ширина правой (100vw на mobile) | `:337-340`, расчёт `:239-243` |
| `--middle-column-width` (+`-value`) | ширина центра | `:341-345` |
| `--chat-width` | max-ширина контента чата (≤696, `CHAT_WIDTH_MAX :97`) | `:354-357` |
| `--folders-sidebar-width/offset` | вертикальная панель папок (72+8) | `:346-353` |
| `--page-chats-padding` | внешние отступы: `:root` 16/0, `#column-center` 16/8 (desktop/mobile) | `:362-375` |
| `--right-sidebar-fits` | порог docked-раскладки правой колонки | `:358-361` |
| класс `body.right-column-floats` | правая колонка не влезает → оверлей поверх чата | `:376-379`, математика `:290-296` |

Константы: `DEFAULT_COLUMN_WIDTH=360`, `MIN/MAX_SIDEBAR_WIDTH=320/480`,
`SIDEBAR_COLLAPSED_WIDTH=80` (`:70-76`). Предпочтения юзера — `localStorage`
`sidebar-left-width`/`sidebar-right-width` (`:103-149`); ресайз-хэндлы зовут
`setUserPreferredLeft/Right` (`:156-176`). Подписки: `mediaSizes 'resize'` +
`rootScope 'resizing_left_sidebar'` (`installColumnWidthsUpdater :382-388`), первый вызов — на
импорте модуля (`:394`).

## 6.4 Классы состояния (body / html)

| Класс | Кто ставит | Эффект |
|---|---|---|
| `body.is-left-column-shown` | `appImManager.selectTab` (`appImManager.ts:2593`) | mobile: показана колонка списка; `#column-center` уезжает `translate3d(100vw)` (`scss/partials/_chat.scss:453-465`), `#column-left` возвращается из `-25vw` |
| `body.is-right-column-shown` | `AppSidebarRight` (константа `sidebarRight/index.ts:14`) | чат сжимается/сдвигается (`_chat.scss:438-465`), правая колонка выезжает (`_rightSidebar.scss:16-52`) |
| `body.right-column-floats` | `updateColumnWidths.ts:376-379` | правая колонка — оверлей, чат не сжимается |
| `body.has-folders-sidebar` | стор folders sidebar (форк) | вертикальная панель папок; учитывается в ширинах (`updateColumnWidths.ts:199-203`) |
| `body.has-chat` | appImManager при открытом чате | фон/поведение центра |
| `body.is-keyboard-opened` | детект клавиатуры на mobile | пересчёт высот |
| `body.is-forward-active`, `.is-pinned-audio-shown`, `.is-fullscreen`, `.is-premium`, `.deactivated`, `.has-auth-pages`, `.animation-level-0/1/2`, `.no-select`, `.disable-hover` | соответствующие подсистемы (grep по `body.classList`) | точечные режимы |
| `html.night` | `themeController.ts:327` | тёмная тема |
| `html.is-rtl` + `--reflect: -1` | `index.ts:393`, `scss/base.scss:32-50` | RTL: все направленные `translateX` в SCSS пишутся как `calc(X * var(--reflect))` (пример `_rightSidebar.scss:52`, `_checkbox.scss:416`) |

## 6.5 Responsive-поведение

- **>925 (large)**: три колонки в потоке; `#column-center` центрируется translateX с учётом
  `--left-column-width` (`_chat.scss:409-465, :1110-1130`); правая колонка либо в потоке
  (если влезает), либо floats.
- **601–925 (medium)**: левый сайдбар — drawer поверх чата (`isFloatingLeftSidebar`,
  `mediaSizes.ts:154`), ширина фиксированная 360, оверлей `.sidebar-left-overlay`.
- **≤600 (mobile)**: колонки — полноэкранный стек (`.main-column` 100vw), переключение через
  `body.is-left-column-shown` + CSS-transition на `.main-column`; `selectTab` +
  NavigationItem `'im'` дают системный Back (§5.2); `--page-chats-padding` root = 0.
- Safe-area (iOS): `html` получает горизонтальные паддинги
  `min(16px, env(safe-area-inset-left/right))` (`scss/base.scss:407-422`), переменная
  `--safe-area-inset-inline-end` учитывает RTL; `updateColumnWidths` вычитает эти паддинги из
  доступной ширины (`updateColumnWidths.ts:263-279`).

---

# 7. Системы «качества жизни»

## 7.1 liteMode (`src/helpers/liteMode.ts`)

- Ключи (`:4-8`): `all`, `animations`, `blur`, `gif`, `video`, `emoji(+_panel,_messages,_appear)`,
  `effects(+_reactions,_premiumstickers,_emoji)`, `stickers(+_panel,_chat)`, `chat(+_background,_spoilers)`.
  Дефолты — все `false` (`config/state.ts:475-495`), хранятся в `settings.liteMode`.
- API: `liteMode.isAvailable(key)` — «анимация разрешена» = `!all && !liteMode[key]` (`:16-19`);
  читает настройки из solid-стора `appSettings` (форк). Пример потребителя —
  `appImManager.selectTab` (`appImManager.ts:2636`), `fastSmoothScroll`.
- Легаси-классы `body.animation-level-0/1/2` остались для CSS.

## 7.2 idleController (`src/helpers/idleController.ts`)

- `EventListenerBase<{change: (idle) => void}>` (`:9`); idle = blur окна, active = focus
  (`:19-22, :53-60`); `focusPromise` — «дождаться фокуса» (`:39-45`) — им пользуются отметка
  прочитанности (не читать в фоне) и нотификации.
- `apiManagerProxy` транслирует idle в `tabState.idleStartTime` (`apiManagerProxy.ts:535-537,
  :1240-1242`) — воркер по нему решает, какой вкладке слать нотификации, и считает «все idle»
  для автолока (`index.worker.ts:280-287`).
- Онлайн-статус: `appImManager.updateStatus/goOffline` (`appImManager.ts:2683-2691`) →
  `appUsersManager.updateMyOnlineStatus`.

## 7.3 Heavy animations (`src/hooks/useHeavyAnimationCheck.ts`)

- `dispatchHeavyAnimationEvent(promise, timeout?)` (`:25-56`): на время promise (или таймаута)
  глобально «идёт тяжёлая анимация» — событие `start`, по завершении всех очередей — `end`.
- Диспатчат: `TransitionSlider` (переходы табов), `appImManager.selectTab`
  (`appImManager.ts:2645-2647`), fastSmoothScroll, открытие медиавьювера.
- Слушают: lazy-load-очереди (пауза загрузок), `animationIntersector` (пауза стикеров/gif),
  рендер списков — чтобы не жанковать переход.

## 7.4 Планировщики и скролл

- `fastRaf(cb)` (`src/helpers/schedulers.ts:21-34`) — все rAF-колбэки кадра сливаются в один
  `requestAnimationFrame`; `fastRafConventional`, `onTickEnd` — аналогично для микротасков.
- `fastSmoothScroll` (`src/helpers/fastSmoothScroll.ts`) — программный анимированный скролл
  (600px форс-обрезка дистанции, `FocusDirection`), уважает `liteMode.isAvailable('animations')`
  и оборачивается в heavy-animation (`:3-7`).
- `animationIntersector` (`src/components/animationIntersector.ts:43-135`) — единый
  IntersectionObserver для всех анимаций (стикеры/gif/спойлеры) с группами
  (`byGroups`, lock групп `:49-58`): вне вьюпорта — pause, «только одна играющая группа»
  (эмодзи-панель vs чат).

---

# 8. Тач и хоткеи

## 8.1 SwipeHandler (`src/components/swipeHandler.ts`)

- Опции (`:56-66`): `element`, `onSwipe(xDiff, yDiff, e, cancelDrag)` (`:94` — вернуть `true` =
  жест завершён), `verifyTouchTarget` (`:95` — фильтр цели, может быть async),
  `onFirstSwipe`/`onReset`, `cursor` (grabbing/resize-варианты, `:102`), сброс поведения
  мыши/тача единообразно (mouse + touch события).
- Потребители: свайп-открытие/закрытие сайдберов на mobile, медиавьювер (свайп-закрытие),
  сторис, `useCollapsable` (шапка профиля), ресайз-хэндлы колонок.

## 8.2 Глобальные хоткеи

| Хоткей | Где | Поведение |
|---|---|---|
| `Escape` | `appNavigationController.ts:216-223` | закрыть верхний слой стека (иерархию задаёт сам стек: popup → menu → сайдбар-таб → мультиселект → чат); `escapeHandlers` могут заблокировать (`:449-459`); пустой стек в левом сайдбаре — фокус в поиск (`sidebarLeft/index.ts:445`) |
| глобальный keydown | `appImManager.attachKeydownListener` (`appImManager.ts:1390-1538`) | вешается на `document.body` активного окна (`:1538`), игнорирует оверлеи и синтетические события (`:1395-1400`) |
| `Alt+↑/↓` | `:1434-1445` | следующий/предыдущий диалог (`dialogsStorage.getNextDialog`) |
| `↑` (пустой инпут) | `:1446-1516` | редактирование последнего своего сообщения (`getFirstMessageToEdit`) |
| `Ctrl/Cmd+↑/↓` | там же (`forReply`) | выбрать сообщение для reply |
| `PageUp/PageDown` | `:1427-1433` | фокус в скролл-контейнер bubbles (нативный скролл) |
| «печатать в никуда» | `:1519-1535` | любой ввод вне инпутов пробрасывается в композер (`passEventToInput`), кроме touch-устройств и не-CHAT таба на mobile |
| `Ctrl/Cmd+C` без инпута | `:1424-1425` | не перехватывается (копирование выделения) |

---

# 9. У нас (`web-client/`): главные структурные расхождения

Подробная карта расхождений — в [`2026-08-10-architecture-divergence-tweb.md`](../research/2026-08-10-architecture-divergence-tweb.md); здесь — только каркасный срез.

## 9.1 Что совпадает по форме

- **Воркер + SuperMessagePort**: `client/bootstrap.ts:23-45` — `SharedWorker` (фоллбэк
  dedicated + `?noSharedWorker=1`), наш порт `rpc/superMessagePort.ts` — прямой порт tweb'овского.
- **Прокси-менеджеры**: `rpc/managersProxy.ts:11-40` — `registerManagers` в воркере
  (`smp.handle('manager', …)`) + `createManagers<T>` на UI (двойной Proxy с мемоизацией) —
  аналог `getProxiedManagers` (без `acknowledged`/`all` и без мульти-аккаунта).
- **Менеджеры в воркере**: `core/workerCore.ts` регистрирует ~20 менеджеров
  (`authManager, chatsManager, messagesManager, dialogsManager, peersManager, foldersManager,
  storiesManager, …`) — но это RPC-фасады над HTTP/WS к нашему бэкенду, а не MTProto-репликация.
- **Layout**: `App.tsx:74-187` собирает тот же скелет
  (`#main-columns[data-animation=navigation]` + `#column-left/center/right`, порталы для
  `#folders-sidebar` и правой колонки), использует портированные `--left-column-width`,
  `--page-chats-padding`, `body.right-column-floats`, `body.is-left-column-shown`
  (ставит хук `useLeftColumnShown` — аналог `appImManager.ts:2593`); мобильный стек — те же
  CSS-переходы `.main-column` без JS-слайда.

## 9.2 Ключевые расхождения

| Аспект | tweb | у нас |
|---|---|---|
| Шина состояния UI | `rootScope`-события + императивный DOM (+ solid-сторы в форке) | **Zustand-сторы** (`stores/*`: `chatsStore, messagesStore, peersStore, foldersStore, draftsStore, navigationStore, appState, …` — ~29 шт.) + React; событий-шины нет, компоненты подписаны на срезы сторов |
| Доставка realtime | воркер применяет update → mirror + rootScope-событие во все вкладки | воркер применяет WS-кадр к окну сообщений **один раз**, UI переигрывает типизированные операции: `client/realtimeBridge.ts` → `realtime/storeProjection` (проекция в сторы), звук/нотификации — отдельные подписчики |
| Владение данными | воркер владеет всем, вкладка — только mirrors | воркер владеет сетью+окном сообщений; часть данных живёт прямо в Zustand-сторах вкладки |
| Мульти-аккаунт | 4 аккаунта в одном воркере, `accountNumber` в каждом RPC | один аккаунт |
| Персист | IndexedDB на аккаунт + `tweb-common`, версия/миграции state | значительно меньше: локальные кэши + настройки (`settings.migration.test.ts` — свои миграции настроек), без полного офлайн-стейта |
| Навигация | стек `appNavigationController` + history/Navigation API + deep links | `stores/navigationStore.ts` + `chatStackStore` (стек чатов), esc/back-иерархия упрощена; internal-link процессора нет |
| Апдейты | pts/seq/difference (`apiUpdatesManager`) | последовательности `seq` per-chat от нашего бэкенда, `message_ack`; gap-логика на бэке |
| liteMode/idle/heavy | полный набор | точечно (lazyLoadQueue, `core/hotkeys.ts`); heavy-animation-шины нет |

---

## Приложение: быстрые якоря

| Тема | Файл |
|---|---|
| Транспорт | `src/lib/superMessagePort.ts`, `src/lib/mainWorker/mainMessagePort.ts` |
| Вкладка | `src/lib/apiManagerProxy.ts`, `src/lib/getProxiedManagers.ts`, `src/index.ts` |
| Воркер | `src/lib/mainWorker/index.worker.ts`, `src/lib/appManagers/appManagersManager.ts`, `createManagers.ts` |
| События | `src/lib/rootScope.ts`, `src/helpers/eventListenerBase.ts` |
| Состояние | `src/config/state.ts`, `src/lib/appManagers/utils/state/loadState.ts`, `src/lib/appManagers/appStateManager.ts`, `src/config/databases/state.ts`, `src/lib/commonStateStorage.ts` |
| Апдейты | `src/lib/appManagers/apiUpdatesManager.ts` |
| Навигация | `src/components/appNavigationController.ts`, `src/lib/internalLink.ts`, `src/lib/internalLinkProcessor.ts`, `src/lib/appImManager.ts` |
| Layout | `/index.html`, `src/helpers/mediaSizes.ts`, `src/helpers/updateColumnWidths.ts`, `src/scss/base.scss`, `src/scss/partials/_chat.scss` |
| QoL | `src/helpers/liteMode.ts`, `src/helpers/idleController.ts`, `src/hooks/useHeavyAnimationCheck.ts`, `src/helpers/schedulers.ts`, `src/helpers/fastSmoothScroll.ts`, `src/components/animationIntersector.ts`, `src/components/swipeHandler.ts` |

---

## Проверка после порта

Прощёлкать на стенде, прежде чем говорить «готово».

- [ ] Ресайз окна через все брейкпоинты: колонки перестраиваются, мобильный режим включается.
- [ ] Тема светлая / тёмная / системная и смена обоев — без перезагрузки и мигания.
- [ ] Deep link открывает нужный экран; back и forward браузера ходят по стеку.
- [ ] Неактивная вкладка: тяжёлые анимации на паузе (idleController).
- [ ] liteMode и режим энергосбережения отключают то же, что в tweb.
- [ ] Перезагрузка страницы восстанавливает открытый чат и позицию.
- [ ] Классы состояния на `body` / `html` совпадают с дампом скелета.

Машинная сверка разметки: снять DOM через `tools/tweb-parity/snapshot-dom.js` и
сравнить с эталоном — `node tools/tweb-parity/dom-parity.mjs <дамп> ours.txt`.
Подходящие дампы: 01-skeleton, 12-theme-toggle, 11-load-anims.
