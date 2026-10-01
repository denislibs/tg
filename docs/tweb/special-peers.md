# Особые пиры: служебный «Telegram» (777000) и «Избранное»

Снято 2026-09-27 по tweb `812502980` (`/Users/denisurevic/Documents/tweb`). Адреса — `файл:строка`
по этому коммиту. Скриншоты живого Telegram, по которым снималась жалоба: шапка и правая панель
«Telegram» (аватар-логотип, галочка, «service notifications», «User Info» с телефоном «+42 777»,
тумблером уведомлений и строкой «This bot is verified as official…»), шапка «Saved Messages / 83
messages» и правая панель «Saved Messages / 4 chats» с вкладками Chats/Media/Links/Music.

Главный вывод: **у оригинала нет «особой вёрстки» ни для одного из двух пиров.** Оба — обычные
пиры, а отличия получаются из ДАННЫХ (флаги и фото с сервера) плюс несколько точечных веток по
`peerId`. Любой клиентский «логотип» или «свой градиент» — отсебятина.

## 1. Служебный аккаунт «Telegram» (777000)

### 1.1 Что приходит с сервера

`SERVICE_PEER_ID = 777000` (`src/lib/appManagers/constants.ts:14`). Карточка — обычный
конструктор `user`:

| Поле | Значение у живого сервера | Кто читает |
|---|---|---|
| `pFlags.verified` | да | галочка у имени (`generateTitleIcons.ts:15-…` через `PeerTitle` `withIcons`), строка «This bot is verified…» (`peerProfile.tsx:1251-1289`) |
| `pFlags.support` | да | подпись `SupportStatus` (`getUserStatusString.ts:34-37`), отказ от typing/«в сети» (`appImManager.ts:3725`), `isRegularUser` (`appUsersManager.ts:903`), принудительный онлайн не ставится (`appUsersManager.ts:1028`), `canReportBot.ts:7`, `getAddBotToChatAction.ts:17`, чекбокс «удалить и у …» в очистке истории (`clearHistory.ts:43`) |
| `pFlags.bot` | нет — это НЕ бот | заголовок панели `Profile.Info.User` («User Info»), а не `Profile.Info.Bot` (`sharedMedia.tsx:107-119`) |
| `photo` | настоящая фотография (синий круг с самолётиком) | `avatarNew.tsx:806-…` — обычный `putAvatar`; веток по `SERVICE_PEER_ID` в `avatarNew.tsx` НЕТ |
| `phone` | `42777` | строка «Phone» профиля — «+42 777» (`peerProfile.tsx:645-…`) |
| `status` | любой (на скриншоте `userStatusRecently` с `by_me` → кнопка «when?») | ветка по id перекрывает его в подписи |

### 1.2 Подпись под именем

`getUserStatusString(user)` (`components/wrappers/getUserStatusString.ts:7-94`) — порядок веток:

1. `switch(user.id)`: `REPLIES_PEER_ID` → `Peer.RepliesNotifications`, `SERVICE_PEER_ID` →
   `Peer.ServiceNotifications` («service notifications», `lang.ts:4386`) — `:15-21`;
2. `pFlags.bot` → `Bot` / `BotUsers` (по `bot_active_users`) — `:23-32`;
3. `pFlags.support` → `SupportStatus` — `:34-37`;
4. `switch(user.status?._)` — «в сети» / «был(а) …» — `:39-89`.

Функция одна на все поверхности: шапка (`appImManager.getUserStatus`, `:3715-3741`), профиль
(`PeerProfile.SubtitleStatus` `:334-…` → `appImManager.setPeerStatus`), выбор получателя
(`appSelectPeers.tsx:1250-1261`), поиск (`appSearchSuper.ts:1805`), списки участников
(`sortedUserList.ts:59`), контакты (`contactsList.tsx:359`) и др. — везде ПЕРЕДАЁТСЯ ПОЛЬЗОВАТЕЛЬ,
а не только статус.

Шапка дополнительно (`appImManager.ts:3715-3741`): typing и обёртка `span.online` — только при
`!user.pFlags.bot && !user.pFlags.support`.

### 1.3 Правая панель

Это обычный профиль пользователя (`peerProfile.tsx`), различия декларативные:

- заголовок `Profile.Info.User` — 777000 не бот (`sharedMedia.tsx:107-119`);
- имя с галочкой (`PeerProfile.Name` `:279-301`, `withIcons`);
- подпись «service notifications» (§1.2);
- строки `MainSection` (`:1655-…`): Phone («+42 777»), Username (у живого нет), Notifications;
- `PeerProfile.BotVerification` (`:1251-1289`): если нет `UserFull.bot_verification`, но
  `pFlags.verified` — серая строка со значком `generateVerifiedIcon()` и текстом
  `Verified.Bot` («This bot is verified as official by the representatives of Telegram.») для
  ЛЮБОГО пользователя, `Verified.Channel`/`Verified.Group` — для чатов. Стоит после
  `MainSection` (`:210-213`). Стили — `_profile.scss:912-927`, значок — спрайт
  `index.html:99-100` + `base.scss:1541-1554`.

### 1.4 Писать/пересылать

Писать можно — у оригинала нет ни одного запрета отправки по `SERVICE_PEER_ID`. Точечные ветки:

| Где | Что | Адрес |
|---|---|---|
| меню сообщения | «Переслать» доступно и для исходящего, если автор — 777000 (changelog) | `chat/contextMenu.ts:1311` |
| композер | нет кнопки подарка | `chat/input.ts:2851-2858` |
| автоудаление | не управляется у спец-чатов (вместе с «Избранным») | `chat/chat.ts:1648-1650` |
| превью | код входа в превью ответа/списка прячется под спойлер | `wrappers/messageForReply.ts:381-392` |
| сторис | changelog-пир по умолчанию | `appStoriesManager.ts:76`, `stories/viewer.tsx:121-125` |

Показывать ли 777000 в выборе получателя, решает фильтр прав (`filterByRights`), а не особая ветка.

## 2. «Избранное» (`peerId === rootScope.myId`)

### 2.1 Аватар и имя

- `avatarNew.tsx:735-751`: `peerId === myId && isDialog` → иконка `saved_filled` (при
  `meAsNotes` — `mynotes`); ни фото, ни инициалов, ни онлайн-точки.
- `PeerTitle` (`peerTitle.ts:139-147`): `peerId === myId && dialog` → `SavedMessages`
  («Saved Messages») / `Saved` (onlyFirstName); при `meAsNotes` — `MyNotes` / `MyNotesShort`.
  **Значков у имени нет** — ветка не зовёт `generateTitleIcons`.
- `isDialog`/`dialog` приходят из `meAsSaved` строки (`appDialogsManager.ts:301` — по умолчанию
  `true`, `:357`, `:401`). `false` передают только списки, где зритель — сам человек
  (участники `sortedUserList.ts:80`, контакты, реакции, звонки…).
- Онлайн-точка в списке чатов — только `peerId !== rootScope.myId` (`appDialogsManager.ts:2945-2951`).

### 2.2 Шапка чата

- Аватар `avatarNew({isDialog: true, meAsNotes: isSaved})` (`topbar.ts:1402-1412`).
- Подпись — `createStatus` (`topbar.ts:1718-…`): для `peerId === myId` — `messagesCounter`
  (`:1685-1716`) с ключом `messages` («%d messages», `lang.ts:1528`) по `historyStorage.count`;
  пока история не загружена (`displayLoading`) — `Loading`. Не «в сети» (`getUserStatus`
  возвращает пусто для `pFlags.self`, `appImManager.ts:3721`).
- `historyStorage.count`: ставит ответ истории (`appMessagesManager.ts:13088`), растит новое
  сообщение (`:10430-10432`), уменьшает удаление (`:11523-11525`).
- Меню: «Мут»/«Звонки» скрыты (`topbar.ts:505/:510/:778/:804`), есть «Reminders» вместо
  «Scheduled» (`:1587`), «Saved as forum» (`:569`).

### 2.3 Правая панель

`AppSharedMediaTab.setPeer` (`sharedMediaTab.tsx:68-83`): `noProfile ??= peerId === myId`.
При `noProfile` (`sharedMedia.tsx`):

- профиль (`renderPeerProfile`) НЕ рендерится; вместо него пустой `.profile-content`, в который
  переносится `searchSuper.container` — «keep same layout» (`:176-200`);
- шапка сразу в режиме shared media: `transition(tab.noProfile ? Media : Profile)` (`:647`) —
  заголовок = `wrapPeerTitle` («Saved Messages»), подзаголовок — счётчик активной вкладки
  (`SavedDialogsTabCount` «%d chats» для вкладки «Chats», `:563-575`); первый
  `onAdditionalScroll` (`:487-493`) ставит `state-back`/`header-filled`/`hide-border`;
- «назад» закрывает панель: `transition.prevId() && !tab.noProfile` ложно → `onCloseBtnClick`
  (`:659-670`);
- вкладки `AppSearchSuper`: первая — `savedDialogs` («Chats», `SharedMedia.SavedDialogs`), есть
  только у `peerId === myId && !threadId` (`appSearchSuper.ts` `canViewSavedDialogs`); строки —
  `AutonomousSavedDialogList` + `DialogElement` с `threadId = saved_peer_id`, у строки самого
  зрителя — «My Notes» с иконкой `mynotes` (`appDialogsManager.ts:344-365`, `:397-411`);
- меню «⋮»: `SavedViewAsMessages` (`:497-505`).

### 2.4 Прочие поверхности

| Поверхность | Поведение | Адрес |
|---|---|---|
| выбор получателя | «Избранное» первой строкой (`renderSaved`), подпись `Presence.YourChat` («chat with yourself») | `appSelectPeers.tsx:725-735`, `:1254-1255` |
| глобальный поиск | строка своего пира — «Saved Messages» (дефолт `meAsSaved`), подпись `Presence.YourChat` | `appSearchSuper.ts:1622-1624`, `:1660-1668` |
| очистка истории | свой текст `AreYouSureClearHistorySavedMessages`, без чекбокса «и у собеседника» | `clearHistory.ts:37-39` |
| пустой чат | плейсхолдер `saved` | `bubbles.ts:10837` |

## 3. У нас

Карта файлов после задачи «особые чаты» (ветки `fix/special-peers-backend`, `fix/special-peers`).

### 3.1 Бэкенд

| Предмет | Где | Состояние |
|---|---|---|
| `pFlags.support` у 777000 | `domain/user.go` (`IsService`), `domain/mtpeer.go` (`UserFlags.Support`, `userFlagNames`), сканы `adapter/repo/postgres/{peerscan,chatsrepo,authrepo,privacyrepo}.go` | **есть** (колонка `users.is_service` была с миграции 0014, но её не читал ни один скан) |
| фото 777000 | `internal/serviceaccount/avatar.jpg` (из tweb `public/assets/img/logo_filled_rounded.png` на `#3390EC`), `usecase/auth/serviceavatar.go::EnsureServiceAvatar`, сид на старте — `app/server.go::seedServiceAvatar` | **есть**, идемпотентно, без MinIO — без фото |
| номер 777000 | миграция `0133_service_user_phone.sql` → `+42777` | **есть** |
| `count` истории | `MessagesRepo.CountMessages(chat, viewer, cleared)` тем же условием, что окно (`historyVisibleN`) | **есть**; раньше считал и удалённое «у себя», и очищенное |
| сохранённые диалоги | `GET /saved/dialogs` — вычисляются группировкой по `fwd_from_*` (`messagesrepo.go::SavedDialogs`) | есть, без пагинации и без `saved_peer_id` на сообщении |
| окно сохранённого диалога | — | **нет** (нет `saved_peer_id` и фильтра истории по нему), см. §3.3 |

### 3.2 Клиент

| Поверхность | Где | Состояние |
|---|---|---|
| подпись пользователя | `core/presence.ts::getUserStatusString(user, status?)` — все ветки `:15-89`, кроме `REPLIES`/`BotUsers` (предметов нет); `userHasPresence` — гейт `:3725` | **порт**; прежний `userStatusLabel(status)` снесён |
| вызывающие | `shared/ui/peerStatus.tsx` (`user` + `status`), `Chat.tsx`, `peerProfile.solid.tsx::UserStatusLine`, `appSelectPeers.solid.tsx::wrapSubtitle`, `appSearchSuper.ts` (Recent), `sortedUserList.ts`, `ChatDialogs.tsx::shareSub`, `NewGroupFlow`, `NewPrivateChat`, `AddMembersScreen`, `RightsEditor`, `ContactsView` | все передают карточку |
| шапка: typing/«в сети» | `Chat.tsx` (`isHumanPeer`) | не показываются боту и 777000 |
| шапка «Избранного» | `Chat.tsx::savedStatus` ← `useMirrorHistoryCount` ← зеркало `messagesMirror.ts::mirrorHistoryCount` ← `rt:history_count` ← `messagesManager.ts::historyCounts` | **порт** `messagesCounter` |
| аватар шапки | `conversation/ChatHeader.tsx` | онлайн-точки нет, как у оригинала |
| аватар 777000 | `core/dialogToChat.ts`, `shared/ui/Avatar/Avatar.tsx` | клиентский глиф `tg-logo` и `SERVICE_GRADIENT` **снесены** — фото с сервера |
| значки у «Избранного» | `core/dialogToChat.ts` | `verified`/`premium`/`emojiStatus` зрителя не наследуются |
| онлайн-точка «Избранного» | `ChatListItem.tsx` | нет |
| строка «This bot is verified…» | `peerProfile.solid.tsx::BotVerification`, `components/generateVerifiedIcon.ts`, спрайт в `index.html`, `styles/tweb/_bridge.scss` (`.verified-icon-*`) | **порт** официальной ветки; ветка `bot_verification` — предмета нет |
| правая панель «Избранного» | `UserInfoPanel.tsx` (`noProfile`) | **порт**: без профиля и карусели, шапка сразу в режиме shared media, «назад» закрывает |
| «My Notes» | `sidebarRight/savedDialogsTab.solid.tsx` + `components/avatar.ts` (`meAsNotes`) | иконка `mynotes` |
| строки поиска | `lib/appDialogsManager.ts` (раздел «СТРОКА ДИАЛОГА»; до задачи 1-1 волны 7 — `components/dialogRow.ts`) — `meAsSaved = true` по умолчанию (как `:301`), `sortedUserList.ts` передаёт `false` | «Saved Messages» в выдаче/Recent |
| «Поделиться» | `shared/ui/PeerSelector/PeerSelector.tsx` (`verified`), `messages/ChatDialogs.tsx` | галочка у имени, подпись по пиру; фильтр — `fix/contacts-share-pickers` (#319) |

### 3.3 Расхождения, которые остались (и почему)

1. **Окно сохранённого диалога** (`ChatType.Saved`, клик по строке «Chats» открывает переписку
   «Избранного» с этим источником): у бэкенда нет `saved_peer_id` у сообщения и фильтра истории
   по нему, у клиента — вида чата `saved`-тред. Отдельная задача (бэкенд: колонка
   `messages.saved_peer_id` + заполнение при пересылке в «Избранное» + миграция старых строк по
   `fwd_from_*` + `GET /chats/{self}/history?saved_peer_id=`; клиент: `ChatType.Saved` в
   `bubbles.ts`/`Chat.tsx`, `meAsNotes` в шапке). Сейчас клик открывает оригинальный чат пира
   (`savedDialogsTab.solid.tsx`, шапка).
2. **`PeerTitle` `withIcons`** в ванильной строке (`chat/peerTitle.ts`) не портирован: в строках
   поиска/`appSelectPeers`/участников галочки у имени нет. React-строки (список чатов, шапка,
   «Поделиться») её рисуют.
3. **Спойлер кода входа** в превью сообщения 777000 (`messageForReply.ts:381-392`) — не
   портирован вместе с `wrapMessageForReply` (шапка `components/wrappers/messageForReply.ts`).
4. **Звонки** 777000 скрыты по id (`ChatHeader.tsx`, `HeaderMenu.tsx`), у оригинала — по
   `userFull.pFlags.phone_calls_available`, которого бэкенд не отдаёт.
5. **Общее правило размера** `.verified-icon, .premium-icon, .emoji-status` (`base.scss:1556-1566`)
   не перенесено — React-значки размеряют себя сами (`_bridge.scss`, комментарий).

## 4. Проверка после порта

1. Список чатов: у «Telegram» — фото-логотип, галочка; у «Избранного» — закладка, без галочки,
   premium и эмодзи-статуса зрителя, без онлайн-точки.
2. Шапка «Telegram»: логотип, галочка, «service notifications», нет «печатает»/«в сети».
3. Шапка «Избранного»: закладка, «N messages» (до загрузки — «Loading»); число меняется при
   отправке и «удалить у себя».
4. Правая панель «Telegram»: «User Info», имя с галочкой, «service notifications», «Phone
   +42 777», тумблер уведомлений, серая строка «This bot is verified as official by the
   representatives of Telegram.» со значком.
5. Правая панель «Избранного»: сразу «Saved Messages / N chats» со стрелкой «назад», вкладки
   Chats/Media/Links/…, без карусели и строк профиля; «назад» закрывает панель.
6. Вкладка «Chats»: строка своих сообщений — «My Notes» с иконкой заметок.
7. «Поделиться»: «Telegram» — фото, галочка, «service notifications».
8. Глобальный поиск по своему имени: строка «Saved Messages» с закладкой.

Дампы для `dom-parity.mjs`: `07-right-sidebar.json` (профиль), `02-chatlist.json` (строка),
`17-popup-01-forward-share.json` («Поделиться»).
