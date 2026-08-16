# Правая колонка (userinfo / shared media / group info): tweb vs наш клиент

Снято 2026-08-16. Источники:

- исходники tweb `/Users/denisurevic/Documents/tweb`;
- наш код `web-client/` на `main`.

> Важно: локальный tweb — форк оригинала, часть табов уже переписана на Solid.js через
> «скаффолды» (`scaffoldSolidJSTab`), классы `SliderSuperTab` остались только как тонкие
> оболочки. Ниже отражено фактическое состояние репозитория.

Документ из трёх частей:

1. Архитектура правой колонки tweb (слайдер, табы, профиль, shared media, скролл).
2. Поведение group info в tweb (отличия user/group/channel, участники, клики, тосты).
3. Аудит нашей реализации (карта, потоки данных, костыли и недоделки).

---

# Часть 1. Архитектура правой колонки в tweb

## 0. Карта файлов (верхний уровень)

| Путь | Роль |
|---|---|
| `src/components/slider.ts` | `SidebarSlider` — стек табов, навигация, история |
| `src/components/sliderTab.ts` | `SliderSuperTab`, `SliderSuperTabEventable` — базовый таб (header/content/scrollable) |
| `src/components/transition.ts` | `TransitionSlider` — все анимации переходов (navigation / tabs / slide-fade / premiumTabs) |
| `src/components/horizontalMenu.ts` | горизонтальное меню табов + «летающий» индикатор |
| `src/components/sidebarRight/index.ts` | `AppSidebarRight` (singleton) — правая колонка |
| `src/components/sidebarRight/tabs/*` | все табы правой колонки |
| `src/components/sidebarRight/tabs/sharedMediaTab.tsx` | `AppSharedMediaTab` — фасад-контроллер (класс) |
| `src/components/sidebarRight/tabs/sharedMedia.tsx` | реальная реализация профиля+медиа (Solid-компонент) |
| `src/components/peerProfile.tsx` | `PeerProfile` — Solid-компонент профиля (секции) |
| `src/components/peerProfileAvatars.ts` | `PeerProfileAvatars` — карусель аватаров + collapse-хедер |
| `src/hooks/useCollapsable.ts` | wheel/swipe-механика сворачивания шапки |
| `src/components/appSearchSuper.ts` | `AppSearchSuper` — контент-табы (Media/Files/…) |
| `src/components/scrollable.ts` | `Scrollable` / `ScrollableX`, `onAdditionalScroll`, `scrollIntoViewNew` |
| `src/components/solidJsTabs/*` | scaffold-механика Solid-табов |

## 1. Инфраструктура слайдера

### 1.1 `SliderSuperTab` — `src/components/sliderTab.ts`

`_constructor()` (стр. 45–74) строит DOM каждого таба:

```
div.tabs-tab.sidebar-slider-item          → this.container
  ├ div.sidebar-header                    → this.header
  │   ├ ButtonIcon('left sidebar-close-button')  → this.closeBtn
  │   └ div.sidebar-header__title               → this.title
  └ div.sidebar-content                   → this.content
        └ Scrollable(content, …, true)    → this.scrollable
```

Ключевые моменты:

- `this.middlewareHelper = slider.getMiddleware().create()` (стр. 47) — иерархия «middleware» (аналог AbortController) для отмены асинхронщины.
- `this.scrollable.attachBorderListeners(this.container)` (стр. 67) — вешает на контейнер классы `scrolled-start` / `scrolled-end` / `scrollable-y-bordered` → на этом строятся тени хедера.
- `slider.addTab(this)` (стр. 71) — таб сразу вставляется в DOM-контейнер `.sidebar-slider`.
- `listenerSetter` — свой «сборщик» слушателей, снимается в `onCloseAfterTimeout`.

Жизненный цикл (для React — прямые аналоги эффектов):

- `open(...args)` (стр. 80–95): один раз вызывает `init(...)` (может быть async), обнуляет `this.init`, затем `slider.selectTab(this)`.
- Хуки: `onOpen()` (стр. 101), `onOpenAfterTimeout()` (102, вызывается через `TRANSITION_TIME=250` мс), `onClose()` (103), `onCloseAfterTimeout()` (105–113 — вызывается через `TRANSITION_TIME + 30` мс и уничтожает таб: `slider.deleteTab`, `container.remove()`, `scrollable.destroy()`, `listenerSetter.removeAll()`, `middlewareHelper.destroy()`).
- `isConfirmationNeededOnClose` (стр. 39) — таб может «попросить» подтверждение перед закрытием.
- Статики: `static getInitArgs?()` — префетч данных до открытия; `static noSame?: boolean` — запрет двух одинаковых табов подряд.

`SliderSuperTabEventable` (стр. 120–145): добавляет `eventListener` с событиями `close` / `destroy` / `destroyAfter`. Используется там, где внешний код должен «сохранить настройки при закрытии» (privacy, chatType, chatReactions и т.д.).

### 1.2 `SidebarSlider` — `src/components/slider.ts`

```ts
TRANSITION_TIME = 250;                              // стр. 11
protected historyTabIds: (number | SliderSuperTab)[]; // стр. 24 — стек
protected tabsContainer = sidebarEl.querySelector('.sidebar-slider'); // стр. 40
this._selectTab = TransitionSlider({content: tabsContainer, type: 'navigation', transitionTime: 250}); // стр. 41-45
```

Методы:

| Метод | Стр. | Поведение |
|---|---|---|
| `selectTab(id)` | 117–147 | если верх стека === id → `false`. Иначе: `onOpenTab()` → `tab.onOpen()` → `setTimeout(onOpenAfterTimeout, 250)` → `pushNavigationItem(tab)` → `historyTabIds.push(id)` → `_selectTab(tab.container)` |
| `closeTab(id?, animate?, isNavigation?)` | 72–85 | если id не верх стека — просто `removeTabFromHistory`. Иначе `pop()` + `onCloseTab` + `_selectTab(предыдущий или -1/0)` |
| `pushNavigationItem(tab)` | 87–115 | регистрирует запись в `appNavigationController` с `type: 'right'`; в `onPop` учитывает `isConfirmationNeededOnClose` (если промис отклонён — возврат `false`, таб не закрывается) |
| `onCloseBtnClick` | 61–70 | сначала пробует `appNavigationController.back('right')`, иначе `closeTab(верх стека)` |
| `onCloseTab` | 218–241 | `appNavigationController.removeByType`, `tab.onClose()`, `setTimeout(onCloseAfterTimeout, 280)` |
| `closeAllTabs()` | 154–162 | форс-закрытие всех |
| `closeAllTabsNaturally()` | 169–191 | закрывает сверху вниз, уважая подтверждения (форк-специфика) |
| `sliceTabsUntilTab(ctor, preserve)` | 193–204 | срезает стек до таба нужного класса |
| `getTab(ctor)` / `isTabExists(ctor)` | 206–216 | поиск по стеку через `instanceof` |
| `createTab(ctor, destroyable=true, doNotAppend?)` | 257–272 | `new ctor(slider, destroyable)`, прокидывает `managers`; уважает `ctor.noSame` |
| `addTab(tab)` | 243–251 | append в `.sidebar-slider`, вешает `click` на `closeBtn` |

### 1.3 `TransitionSlider` — `src/components/transition.ts`

Ядро анимации: работает с **прямыми детьми** контейнера `content`, переключая классы `active` / `to` / `from`, а на контейнере — `animating` / `backwards` / `disable-hover` (стр. 271–335).

Три «функции анимации» (объявлены с `animateFirst: false`):

- `slideNavigation` (стр. 23–43) — **используется правой колонкой**. Уходящий таб уезжает на `width` вправо, входящий приходит с `-width*0.25` и `brightness(80%)` → эффект «parallax» iOS-навигации.
- `slideTabs` (стр. 45–95) — для горизонтальных табов (`horizontalMenu`), симметричный сдвиг на ±width.
- `slidePremium` (стр. 97–122) — + классы `slide-right`/`slide-left`.
- Типы без функции (`'slide-fade'`, `'zoom-fade'`, `'fade'`, `'none'`) анимируются **чистым CSS** через `content.dataset.animation = type` и `animationend` (стр. 186, 198).

Прочие детали:

- `selectTab(id | HTMLElement, animate = true, overrideFrom?)` (стр. 240).
- `selectTab.prevId()`, `.getFrom()`, `.setFrom()` (стр. 376–378) — используются `AppSidebarRight.replaceSharedMediaTab`.
- `isHeavy` → `dispatchHeavyAnimationEvent` (стр. 362–369): на время анимации замораживаются lazy-load-очереди, стикеры и т.п.
- Страховочный `setTimeout(callback, transitionTime + 100)` (стр. 350) на случай не пришедшего `transitionend`.

### 1.4 Solid-скаффолды табов

`src/components/solidJsTabs/scaffoldSolidJSTab.tsx`:

- `scaffoldSolidJSTab<Payload>({title, getComponentModule, onOpenAfterTimeout, onClose, onCloseAfterTimeout})` возвращает **класс** `extends SliderSuperTab`, у которого `init(payload, overrideTitle?)` (стр. 38–61):
  1. `setTitle(...)`;
  2. `this.payload = payload`;
  3. `await getComponentModule()` (динамический import → code-splitting);
  4. `render(<HotReloadGuardProvider><PromiseCollector><SuperTabProvider self={this}><Component/></…>, div)`;
  5. `this.scrollable.append(div)`;
  6. `await promiseCollectorHelper.await()` — **таб не откроется, пока не разрешатся собранные промисы** (данные загружены до анимации).
- `scaffoldSolidJSTabEventable` (стр. 98–142) — то же поверх `SliderSuperTabEventable`.
- `SuperTabProvider` / `useSuperTab()` — `src/components/solidJsTabs/superTabProvider.tsx` (стр. 13–26): даёт компоненту доступ к самому инстансу таба (`tab.container`, `tab.header`, `tab.scrollable`, `tab.payload`, `tab.listenerSetter`, `tab.managers`).
- `PromiseCollector` / `usePromiseCollector()` — `promiseCollector.tsx` (стр. 15–39).

**Для React-порта:** `SliderSuperTab` ≈ «шелл» (header + scroll-контейнер + lifecycle), а Solid-компонент ≈ содержимое. В React это будет `<SliderTab title=...>{children}</SliderTab>` + контекст `useSliderTab()`, а `promiseCollector` ≈ Suspense/подготовка данных до анимации входа.

## 2. `AppSidebarRight` и полный список табов

### 2.1 `src/components/sidebarRight/index.ts`

```ts
export const RIGHT_COLUMN_ACTIVE_CLASSNAME = 'is-right-column-shown';  // стр. 14
class AppSidebarRight extends SidebarSlider {
  super({sidebarEl: #column-right, canHideFirst: true, navigationType: 'right'})  // стр. 21-25
}
export default new AppSidebarRight();  // singleton, стр. 139
```

| Метод | Стр. | Поведение |
|---|---|---|
| `construct(managers)` | 30–41 | слушает `mediaSizes 'changeScreen'` (на `medium` закрывает колонку), `installColumnWidthsUpdater()`, `installColumnResize({side:'right'})` (ресайз мышью) |
| `createSharedMediaTab()` | 43–48 | `createTab(AppSharedMediaTab, destroyable=false, doNotAppend=true)` — таб создаётся **вне DOM**, для каждого чата свой |
| `replaceSharedMediaTab(tab?)` | 50–82 | «горячая» подмена таба профиля при смене чата: подменяет элемент в `historyTabIds`, переносит класс `active`, чинит `_selectTab.setFrom()`, `previousTab.container.replaceWith(tab.container)` |
| `onCloseTab` | 84–90 | если стек опустел — `toggleSidebar(false)` |
| `hide()` | 92–100 | `inert = true`, снимает body-класс, `appNavigationController.removeByType('right')`, `animationIntersector.toggleVideosUnder(sidebarEl, true)` (пауза видео-аватаров, т.к. колонка скрыта transform'ом), событие `right_sidebar_toggle: false` |
| `toggleSidebar(enable?, animate?)` | 102–136 | если колонка открывается и стек пуст → `sharedMediaTab.open()`; далее `appImManager.selectTab(active ? CHAT : PROFILE, animate)`; при открытии — body-класс, `inert=false`, `pushNavigationItem(sharedMediaTab)`, возобновление видео |

Открытие колонки завязано на `appImManager.selectTab(APP_TABS.PROFILE)` — `src/lib/appImManager.ts:192-196` (`CHATLIST=0, CHAT=1, PROFILE=2`), реализация `selectTab` — стр. 2588–2647 (на мобильном при уходе с PROFILE вызывает `appSidebarRight.hide()`, стр. 2624).

### 2.2 Полный перечень табов `src/components/sidebarRight/tabs/`

**Главный:**

| Файл | Класс/компонент | Назначение |
|---|---|---|
| `sharedMediaTab.tsx` (135) | `AppSharedMediaTab extends SliderSuperTab` | фасад: `setPeer`, `fillProfileElements`, `loadSidebarMedia`, `setSearchTab`, `setLoadMutex`; ленивый `import('./sharedMedia')` |
| `sharedMedia.tsx` (711) | Solid `SharedMedia` | вся реальная логика: хедер с двойным transition, профиль, `AppSearchSuper`, кнопки edit / btnMenu / addMembers |

**Редактирование чата/контакта (через `scaffoldSolidJSTab`, объявления в `src/components/solidJsTabs/tabs.ts:371-598`):**

| Константа | Файл | title | payload |
|---|---|---|---|
| `AppEditChatTab` | `editChat.tsx` (752) | `Edit` | `{chatId}` |
| `AppEditContactTab` | `editContact.tsx` (369) | `Edit` | `PeerId` |
| `AppEditBotTab` | `editBot.tsx` (192) | `EditBot.Title` | `PeerId` |
| `AppEditTopicTab` | `editTopic.tsx` (313) | `ForumTopic.Title.Edit` / `NewTopic` | `{peerId, threadId?}` |
| `AppChatTypeTab` | `chatType.tsx` (361) | `ChannelType` | `{chatId, chatFull}` (eventable) |
| `AppGroupPermissionsTab` | `groupPermissions/groupPermissions.tsx` (426) | `ChannelPermissions` | `{chatId}`; в `onOpenAfterTimeout` дергает `scrollable.onScroll()` |
| `AppUserPermissionsTab` | `userPermissions.tsx` (455) | `AddBot` / `EditAdmin` / `UserRestrictions` | участник + права; helper `openUserPermissionsTab()` (`tabs.ts:466-480`) |
| `AppChatMembersTab` | `chatMembers.tsx` (111) | `GroupMembers` | `ChatId` |
| `AppChatAdministratorsTab` | `chatAdministrators.tsx` (149) | `PeerInfo.Administrators` | `{chatId}` |
| `AppRemovedUsersTab` | `removedUsers.tsx` (86) | `ChannelBlacklist` | `ChatId` |
| `AppChatRequestsTab` | `chatRequests.tsx` (95) | `MemberRequests` | `ChatId`, событие `finish(changedLength)` |
| `AppChatReactionsTab` | `chatReactions.tsx` (219) | `Reactions` | `{chatId}` |
| `AppChatDiscussionTab` | `chatDiscussion.tsx` (313) | `DiscussionController.Channel.Title` | `{chatId, linkedChatId}` |
| `AppChatInviteLinksTab` | `chatInviteLinks.tsx` (578) | `InviteLinks` | `{chatId, adminId?}`, есть `getInitArgs` |
| `AppChatInviteLinkTab` | `chatInviteLink.tsx` (264) | `InviteLink` | конкретная ссылка + меню |
| `AppEditChatInviteLinkTab` | `editChatInviteLink.tsx` (370) | `NewLink` / `InviteLinks.Edit` | событие `finish(chatInvite)` |
| `AppDirectMessagesTab` | `channelDirectMessages.tsx` (90) | `ChannelDirectMessages.Settings.Title` | `{chat}` |
| `AppAdminRecentActionsTab` | `adminRecentActions/index.tsx` (295) | `RecentActions` | `{channelId, isBroadcast}` |
| `AppPrivateSearchTab` | `search.tsx` (73) | — | поиск внутри чата (`AppSearch` + `InputSearch` вместо `title`) |
| `AppStickersTab` | `stickers.tsx` (219) | `StickersName` | поиск стикеров |
| `AppGifsTab` | `gifs.tsx` (128) | `SearchGifsTitle` | поиск GIF |

**Оставшиеся классическими классами (`SliderSuperTab(-Eventable)`):**

| Файл | Класс | Стр. | Назначение |
|---|---|---|---|
| `statistics.tsx` (1153) | `AppStatisticsTab extends SliderSuperTabEventable` | 248 | статистика канала/группы/поста/истории/опроса, графики |
| `boosts.tsx` (454) | `AppBoostsTab extends SliderSuperTabEventable` | 74 | бусты: `LimitLine`, `InviteLink`, табы Boosters/Gifts |
| `pollResults.tsx` (160) | `AppPollResultsTab extends SliderSuperTab` | 18 | результаты опроса |
| `savedMusic.tsx` (725) | `AppSavedMusicTab extends SliderSuperTab` | 705 | «сохранённая музыка» профиля; открывается из `PeerProfile.PinnedMusic` |

**Вспомогательные (не табы):**

- `chatInviteLinkShared.ts` (153) — общие типы `ChatInvite`, `ChatInviteActions`, `getChatInviteLinksInitArgs`.
- `participantsSelector.ts` (22) — `createSelectorForParticipants` (общий `AppSelectPeers` для members/admins/removed).
- `groupPermissions/sharedPermissions.ts` (427), `chargeForMessasgesSection.tsx`, `doNotRestrictBoostersSection.tsx`.
- `adminRecentActions/*` — целый подмодуль (logEntry, logDiff, keyValuePair, filters, …).
- `forward.ts` — полностью закомментирован (мёртвый код).

**Форум-топики** живут не в sidebarRight, а в `src/components/forumTab/`: `forumTab.ts` (`ForumTab extends SliderSuperTabEventable`, стр. 22), `groupForumTab.ts`, `monoforumTab.ts`, `botforumTab.ts`, `register.ts`. Открываются в **левом** слайдере; пункт «Info» вызывает `AppSharedMediaTab.open(appSidebarLeft, this.peerId)` (`groupForumTab.ts:60`).

### 2.3 Кто и откуда открывает табы

- `src/components/chat/topbar.ts:276-279` — клик по topbar → `toggleSidebar(...)` (по аватару — toggle, по остальному — открыть).
- `topbar.ts:451` — `createTab(AppBoostsTab).open(peerId)` + `toggleSidebar(true)`.
- `topbar.ts:664` — `createTab(AppStatisticsTab).open(chatId)`.
- `topbar.ts:813` — `createTab(AppAdminRecentActionsTab).open(...)`.
- `topbar.ts:855-859` — `addContact()` → `AppEditContactTab`.
- `sharedMedia.tsx:554-582` — кнопка «карандаш» выбирает один из `AppEditTopicTab / AppEditChatTab / AppEditBotTab / AppEditContactTab`.
- `editChat.tsx` — переходы вглубь: `AppChatTypeTab` (177), `AppChatInviteLinksTab` (201), `AppChatRequestsTab` (227), `AppChatReactionsTab` (253), `AppDirectMessagesTab` (292), `AppGroupPermissionsTab` (342), `AppChatDiscussionTab` (362), `AppAdminRecentActionsTab` (406), `AppChatAdministratorsTab` (501), `AppChatMembersTab` (539), `AppRemovedUsersTab` (569).
- `internalLinkProcessor.ts:1296-1322` — deep-link'и: открыть колонку и переключить на `gifts`/`stories` таб.

## 3. Профиль — `src/components/peerProfile.tsx`

### 3.1 Контекст и корень

`PeerProfileContextValue` (стр. 62–82) — единый контекст для всех подкомпонентов:
`peerId, threadId, scrollable, setCollapsedOn, isDialog, onPinnedGiftsChange, onAvatarReady, needWhite/setNeedWhite, peer (usePeer), fullPeer (useFullPeer), canBeDetailed(), isSavedDialog, isTopic, isBotforum, hasSavedMusic, getDetailsForUse(), verifyContext()`.

Компонент `PeerProfile` (стр. 115–215):

- `props.setCollapsedOn.classList.add('profile-container')` (стр. 178) — контейнер таба получает класс, на котором дальше живут `is-collapsed` / `need-white` / `header-filled`.
- для не-своего юзера подписывается на `premium_toggle` и `privacy_update` и рефрешит статус (стр. 180–192).

Дерево (стр. 194–214):

```jsx
<div class="profile-content [has-music] [is-me]">
  <PeerProfile.AutoAvatar />            {/* карусель + имя + статус */}
  <div class="profile-content-delimiter" />
  <PeerProfile.UnofficialWarning />
  <PeerProfile.PersonalChannel />
  <PeerProfile.MainSection />
  <PeerProfile.BotMainApp />
  <PeerProfile.BotVerification />
  <PeerProfile.BotPermissions />
  {props.searchSuperContainer}          {/* ← контейнер AppSearchSuper ВНУТРИ profile-content! */}
</div>
```

`MainSection` (стр. 1510–1533) — единая `<Section noDelimiter>`, скрывается целиком для botforum-топика:
`Phone → Username → Location → Bio → Link → Birthday → ContactNote → BusinessHours → BusinessLocation → Notifications → BotAddToChat → BotPrivacyPolicy`.

`renderPeerProfile(props, HotReloadGuardProvider)` (стр. 1535–1544) — императивная обёртка, возвращает готовый `HTMLElement` (её и вызывает `sharedMedia.tsx`).

### 3.2 Секции и условия показа (user / group / channel / bot)

| Компонент | Стр. | Показывается когда |
|---|---|---|
| `Name` | 273–295 | всегда; `wrapPeerTitle` c `textColor: needWhite ? 'white' : 'primary-color'`, `withIcons: !threadId`, `meAsNotes` для Saved |
| `Subtitle` → `SubtitleRating` + `SubtitleStatus` | 297–421 | Rating — если `fullPeer.stars_rating`; Status — не для «себя в диалоге» и не для `HIDDEN_PEER_ID`; для топика — `wrapTopicNameButton`; иначе `appImManager.setPeerStatus` + рефреш по `peer_typings`/`user_update` + `setInterval(60_000)` |
| `PinnedGifts` | 423–475 | user + `fullPeer.stargifts_count`; до 3 стикеров поверх шапки, клик → `PopupStarGiftInfo` |
| `PinnedMusic` | 596–631 | `fullPeer.saved_music`; клик → `AppSavedMusicTab` + `toggleSidebar(true)` |
| `StoryPreviews` | 1355–1474 | не «я»; до 3 кружков сторис с сегментами (`StoriesSegments`), пишет `info.dataset.storiesCount` |
| `PersonalChannel` | 477–595 | `userFull.personal_channel_id` — карточка канала + превью последнего поста со `Skeleton` |
| `Phone` | 633–691 | `peerId.isUser() && canBeDetailed()` и есть `phone`; определяет «анонимный» номер по `appConfig.fragment_prefixes` |
| `Username` | 693–732 | user; `getPeerActiveUsernames`, «также @…» через `getUsernamesAlso` (стр. 86–94) + `QrButton` |
| `QrButton` | 734–747 | `peerId !== myId` |
| `Birthday` | 749–832 | `userFull.birthday`; «сегодня» → предложение подарка |
| `ContactNote` | 833–872 | заметка о контакте |
| `Location` | 873–894 | гео (бизнес-локация чата) |
| `Bio` | 895–967 | `fullPeer.about`; заголовок `UserBio` для юзера, `Info` для чата; контекст-меню copy + `TranslateMessage` |
| `Link` | 969–1036 | **НЕ user** (группа/канал/топик): `t.me/username`, для топика `t.me/username/{threadId}` или `t.me/c/{chatId}/{threadId}`, fallback — `exported_invite` |
| `BotPrivacyPolicy` | 1038–1057 | бот |
| `BotAddToChat` | 1059–1081 | бот |
| `BusinessHours` / `BusinessLocation` | 1082–1174 | бизнес-аккаунт |
| `Notifications` | 1175–1218 | `isDialog && canBeDetailed()` — toggle mute |
| `BotVerification` | 1220–1259 | `userFull.bot_verification` |
| `UnofficialWarning` | 1260–1283 | неофициальные клиенты |
| `BotPermissions` | 1284–1353 | биометрия/гео разрешения мини-аппа |
| `BotMainApp` | 1480–1508 | `bot_has_main_app` — кнопка «Open App» + caption |

Отличия по типу пира — **не через ветвление, а через `<Show>` в каждой секции**. Заголовок таба выбирается в `sharedMedia.tsx:90-102`:
`Profile.Info.Topic` → `Profile.Info.Bot` → `Profile.Info.Channel` → `Profile.Info.User` → `Profile.Info.Group`.

### 3.3 Карусель аватаров — `src/components/peerProfileAvatars.ts`

DOM (конструктор, стр. 81–109):

```
div.profile-avatars-container
  ├ div.profile-avatars-avatars       (флекс-лента, transform: translate(x))
  ├ div.profile-avatars-gradient      (нижний градиент)
  ├ div.profile-avatars-gradient-top  (верхний, scaleY(-1))
  ├ div.profile-avatars-tabs          (полоски-индикаторы, как в stories)
  ├ div.profile-avatars-arrow (prev)
  ├ div.profile-avatars-arrow-next
  └ div.profile-avatars-info          → сюда добавляются <Name/> и <Subtitle/>
  (+ canvas.profile-avatars-pattern    — emoji-паттерн фона)
  (+ .profile-avatars-avatar-fake      — «настоящий» аватар-120, вставляется ПЕРЕД лентой)
```

Ключевые механики:

| Что | Стр. | Как |
|---|---|---|
| Клик по контейнеру | 142–233 | зоны: `SWITCH_ZONE = 1/3` слева/справа → перелистывание (`goWithoutTransition(±1)`, с закольцовыванием); центр → `openAvatarViewer(...)` с prev/next targets. Если свёрнуто (`isCollapsed`) → `unfold()`. Если есть stories и клик по аватару → `simulateClickEvent(fakeAvatar.node)` (открыть stories) |
| `checkScrollTop()` | 127–137 | если скролл ≠ 0, сначала скроллит к началу и гасит клик |
| Свайп | 243–298 | `SwipeHandler` на `.profile-avatars-avatars`: `onFirstSwipe` фиксирует `width`, `minX`, ставит `no-transition`; `onSwipe` двигает `translate(x)`; `onReset` считает `addIndex` и вызывает `listLoader.go(addIndex)` |
| Пагинация | 433–521 | `ListLoader({loadCount: 50, loadMore, processItem, onJump})`. Для user — `appPhotosManager.getUserPhotos`; для чата — `appProfileManager.getChatFull` + `getHistory({inputFilter: inputMessagesFilterChatPhotos})` |
| `onJump` | 500–520 | `avatars.style.transform = translate(-{100*index}%)`, переключает `.active` на tabs+avatars, `loadNearestToTarget`, будит rAF-цикл прогресса |
| Ленивая загрузка | 898–927 | первые `LOAD_NEAREST = 3` грузятся сразу, остальные — через `IntersectionObserver` + `loadCallbacks` |
| Fallback-фото | 422–431, 443–451 | «публичное» фото добавляется **в конец** карусели только для своего профиля |
| Тема профиля | 652–793 | `usePeerProfileAppearance` → `bgColors` (linear-gradient) + `backgroundEmojiId` → `wrapEmojiPattern` на canvas 393×258 с 19 фиксированными позициями эмодзи и радиальным «гало» |
| Прогресс видео-аватара | 591–650 | rAF-цикл заполняет `--progress` активного `.profile-avatars-tab` из `video.currentTime/duration`; самоприостанавливается, когда видео на паузе; будится capture-слушателем `play` (стр. 121–125) |
| Загрузка аватара | 545–586 | `avatarUploads` store → форс-`fold()`, класс `is-avatar-uploading`, `ProgressivePreloader` |
| Топик | 396–400 | `container.classList.add('is-topic')`, один `avatarNew({size: 120})`, без карусели и `listLoader` |
| `cleanup()` | 957–973 | останавливает rAF, разрегистрирует видео в `animationIntersector`, снимает слушатели/свайп/IO/middleware |

## 4. Shared media: `AppSharedMediaTab` + `AppSearchSuper`

### 4.1 Фасад `sharedMediaTab.tsx`

`AppSharedMediaTab extends SliderSuperTab` — намеренно тонкий, потому что `chat.ts` вызывает его методы **синхронно, до открытия таба**:

- `_render()` (стр. 38–62) — один раз: `import('./sharedMedia')` → `render(<HotReloadGuard><PromiseCollector><SuperTabProvider self={this}><SharedMedia/>…, div)` → `scrollable.append(div)` → `await promiseCollector`.
- `init()` = `_render()` (стр. 64).
- `setPeer(peerId, threadId)` (стр. 68–83): если пир тот же — `false`; иначе выставляет `peerId/threadId`, `noProfile ??= peerId === myId`, `peerChanged = true`, и вызывает `_impl.setQuery()` (сразу или после рендера).
- `fillProfileElements()` / `loadSidebarMedia()` / `setSearchTab()` / `setLoadMutex()` — прокси на `_impl` (стр. 85–103).
- `onOpenAfterTimeout()` (105–109) — `scrollable.onScroll()` (пересчёт после анимации).
- `onCloseAfterTimeout()` (111–119) — `searchSuper.destroy()` + `_dispose()`.
- `static open(slider, peerId, noProfile?)` (126–134) — сценарий «открыть профиль в ЛЕВОМ слайдере»: create → setPeer → `(await fillProfileElements())()` → `loadSidebarMedia(true)` → `open()`.

### 4.2 `sharedMedia.tsx` — сборка экрана

**Хедер (стр. 354–477).** Двухуровневые transition'ы:

```
sidebar-header
 ├ closeBtn (Button, .animated-close-icon, класс state-back)
 ├ div.transition.slide-fade                 ← transitionContainer
 │   ├ [0] transitionFirstItem: title(titleI18n = «Информация о …») + editBtn
 │   └ [1] transitionSharedMedia: sidebar-header__rows
 │          ├ title «PeerInfo.SharedMedia»
 │          └ subtitle → div.transition.slide-fade  ← sharedMediaTransitionContainer
 │                        [12 элементов-счётчиков: savedDialogs, stories, members,
 │                         media, gifts, saved, files, links, music, voice, groups, similar]
 └ btnMenu (ButtonMenuToggle)
```

- `transition = TransitionSlider({content: transitionContainer, type: 'slide-fade', transitionTime: 400, isHeavy: false})` (стр. 519–524).
- `transitionSubtitle` — то же для счётчиков (стр. 528–535). При смене контент-таба: `transitionSubtitle(c.findIndex(...))` (стр. 650).
- Счётчики обновляются через `onLengthChange` → `item[2].compareAndUpdate({key, args:[length]})` (стр. 669–676); ключи: `SavedDialogsTabCount`, `StoriesCount`, `Members`, `MediaFiles`, `StarGiftsCount`, `SavedMessagesCount`, `Files`, `Links`, `MusicFiles`, `Voice`, `CommonGroups`, `SimilarChannelsCount` (стр. 449–462).

**btnMenu** (стр. 402–434): «Смотреть как сообщения» (для Saved), меню Stories (`profileStoriesButtonMenu`), меню подарков (`profileStarGiftsButtonMenu`). Видимость пересчитывается в `onChangeTab` (стр. 657–666).

**Кнопка edit** (стр. 399, 554–582) — видимость через `toggleEditBtn()` (стр. 113–145): для юзера `appUsersManager.canEdit`; для топика `dialogsStorage.canManageTopic`; для канала — `!monoforum && (hasRights('just_admin') || hasRights('change_info'))`; для группы — `change_info || change_permissions`; при «заморозке» аккаунта — скрыта.

**`btnAddMembers`** (стр. 690–698) — `ButtonCorner('addmember_filled')`, показывается только на табе `members` (с задержкой 250 мс при анимациях, стр. 653–656), контейнер получает класс `can-add-members` (см. `cleanupHTML`, стр. 69).

**Пайплайн смены пира:**

```
chat.setPeer → chat.ts:987  appSidebarRight.createSharedMediaTab()
             → chat.ts:990  tab.setPeer(peerId, threadId)   → _impl.setQuery() → searchSuper.setQuery() → searchSuper.cleanup()
chat.finishPeerChange (chat.ts:1179-1223)
             → tab.fillProfileElements()  (возвращает callback-«коммит»)
             → tab.loadSidebarMedia(true)
             → callbacks.forEach(cb => cb())
             → appSidebarRight.replaceSharedMediaTab(tab)   (chat.ts:1221)
             → destroy остальных табов
```

`fillProfileElements()` (`sharedMedia.tsx:147-193`) параллельно готовит 4 куска и возвращает **единый коммит-callback**, чтобы весь UI менялся одним кадром:

1. `cleanupHTML()` (стр. 59–71) — `searchSuper.cleanupHTML()`, класс `can-add-members`;
2. `toggleEditBtn(true)`;
3. `changeTitleKey()` (стр. 73–111);
4. `renderPeerProfile({peerId, threadId, isDialog: true, scrollable, setCollapsedOn: tab.container, searchSuperContainer: tab.searchSuper.container, onPinnedGiftsChange})` + `scrollable.append(...)`.

Если `noProfile` (Saved Messages) — профиль не рендерится, но создаётся пустой `.profile-content`, в который кладётся `searchSuper.container`, чтобы разметка совпадала (стр. 173–182).

### 4.3 `AppSearchSuper` — `src/components/appSearchSuper.ts`

**Конфиг табов в правой колонке** (`sharedMedia.tsx:604-647`, порядок важен — он же порядок в DOM и в свайпе):

| # | type | inputFilter | lang key |
|---|---|---|---|
| 0 | `savedDialogs` | — | `SharedMedia.SavedDialogs` |
| 1 | `stories` | — | `Stories` / `ProfileStories` |
| 2 | `members` | — | `PeerMedia.Members` |
| 3 | `media` | `inputMessagesFilterPhotoVideo` | `SharedMediaTab2` |
| 4 | `gifts` | — | `SharedMedia.Gifts` |
| 5 | `saved` | `inputMessagesFilterEmpty` | `SharedMedia.Saved` |
| 6 | `files` | `inputMessagesFilterDocument` | `SharedFilesTab2` |
| 7 | `links` | `inputMessagesFilterUrl` | `SharedLinksTab2` |
| 8 | `music` | `inputMessagesFilterMusic` | `SharedMusicTab2` |
| 9 | `voice` | `inputMessagesFilterRoundVoice` | `SharedVoiceTab2` |
| 10 | `groups` | — | `ChatList.Filter.Groups` |
| 11 | `similar` | — | `SimilarChannels` |

(в поиске левой колонки используются ещё `chats`, `channels`, `apps`, `posts` — см. тип на стр. 126–128.)

**DOM (конструктор, стр. 455–603):**

```
div.search-super
  ├ Tabs.MenuGradient  .search-super-tabs-gradient        (растушёвка под sticky-меню)
  ├ div.search-super-tabs-scrollable.menu-horizontal-scrollable.sticky   ← navScrollableContainer
  │    └ ScrollableX → nav.search-super-tabs.menu-horizontal-div
  │           └ .menu-horizontal-div-item × N (i.background + span + ripple)
  └ div.search-super-tabs-container.tabs-container        ← tabsContainer
       └ div.search-super-tab-container.search-super-container-{type}.tabs-tab × N
             └ div.search-super-content-container.search-super-content-{type}
                   ├ media → div.search-super-content-media-grid          (grid 3 колонки, gap 1px)
                   └ прочие → <Section noDelimiter class="hide"> (mediaTab.hideOn) → itemsTab
```

`noSectionTypes = {stories, media, gifts, chats, channels, apps, posts}` (стр. 545–553).

**Переключение табов** — `this.selectTab = horizontalMenu(tabsMenu, tabsContainer, onClick, onTransitionEnd, undefined, navScrollable, listenerSetter)` (стр. 624–707). В `onClick`:

- повторный клик по активному → `scrollToStart()` (стр. 625–628);
- `onChangeTab?.(newMediaTab)`;
- **сохранение скролла между табами** (стр. 641–677): `fromMediaTab.scroll = {scrollTop, scrollHeight}`; для нового таба, если позиции нет — вычисляется `diff = rect.y - parentRect.y`; затем `newMediaTab.contentTab.style.transform = translateY(diff)` — это визуально «удерживает» контент на месте на время анимации;
- в `onTransitionEnd` (стр. 692–707): `transform=''`, `scrollable.scrollPosition = mediaTab.scroll.scrollTop`, `unlockScroll()`, снятие класса `sliding`.

**Свайп между табами** (только touch, стр. 498–543): `handleTabSwipe` на `tabsContainer`; сначала даёт шанс перехватить свайп внутренним табам (`stargiftsActions.handleSwipe` для коллекций подарков, `storiesActions.handleSwipe` для альбомов сторис), затем ищет **следующий не скрытый (`.hide`)** пункт меню и вызывает `selectTab(idx)`; на время свайпа `lockTouchScroll(tabsContainer)`.

**Какие табы показывать — `loadFirstTime()` (стр. 2380–2513):**

1. Параллельно: `getSearchCounters(filters)` + `canViewSavedDialogs()` + `canViewSaved()` + `canViewMembers()` + `canViewGroups()` + `canViewStories()` + `canViewSimilar()` + `canViewGifts()` + `getGiftsCount()` + pinned gifts.
2. Табы с `inputFilter` скрываются, если `counter.count === 0` (стр. 2431).
3. Не-фильтровые табы скрываются по соответствующим `canView*` (стр. 2456–2476).
4. Выбор «первого» таба по приоритету (стр. 2480–2497): `stories` → `members` → `savedDialogs` → (`gifts`, если больше нечего). По умолчанию — первый непустой фильтровый.
5. Если видимых табов ≤ 1 → `navScrollableContainer.classList.add('is-single')` + скрытие градиента (строка меню визуально исчезает; см. CSS ниже).
6. `toggleContainerHidden(!firstMediaTab)` → класс `hide` + `search-empty` на родителе.

Правила `canView*` (стр. 2611–2712):

- `savedDialogs` — только `peerId === myId && !threadId`;
- `saved` — есть история в Saved с `threadId = peerId` (Saved-диалог этого пира), не для себя;
- `members` — чат, не broadcast, `hasRights('view_participants')`, и не (топик в форуме);
- `groups` (общие группы) — только user, `userFull.common_chats_count`;
- `stories` — не свой профиль, не тред; user → `getPinnedStories(peerId,1).count`; чат → `channelFull.pFlags.stories_pinned_available`;
- `similar` — только чат, `getChannelRecommendations().chats.length`;
- `gifts` — `!threadId` и таб существует; количество из `full.stargifts_count`.

**Загрузка — `load(single, justLoad, side)` (стр. 2531–2576):** первый раз ждёт `loadFirstTime()`; фильтрует табы через `canLoadMediaTab()`; для user выкидывает `members`, для чата — `groups`; `loadCount = justLoad ? 50 : round((window.height/130)*3*1.25)`.

`loadType()` (стр. 2181–2360) — диспетчер:

- `members`/`groups` → `loadMembers()` (1525) — `SortedUserList` + `getChannelParticipants` (limit 50 → далее 200) / `getChatFull().participants` / `getCommonChats`;
- `stories` → `loadStories()` (1762) — Solid `StoriesProfileList` с альбомами и мультивыбором;
- `similar` → `loadSimilarChannels()` (1804);
- `savedDialogs` → `loadSavedDialogs()` (1890) + `AutonomousSavedDialogList`;
- `gifts` → `loadGifts()` (2130) — Solid `StarGiftsProfileTab` с коллекциями;
- остальные → общий путь: сначала **из кэша** `historyStorage[inputFilter]` (стр. 2245–2276), потом `appMessagesManager.getHistory({...searchContext, offsetId, limit, nextRate})`; по окончании — авто-предзагрузка следующей страницы (стр. 2329–2348).

**Рендер элементов — `performSearchResult()` (стр. 1096–1257):**

- `await getHeavyAnimationPromise()` — не рендерить во время тяжёлых анимаций;
- выбор процессора по `inputFilter` (стр. 1143–1170): `processEmptyFilter` (826), `processPhotoVideoFilter` (874), `processDocumentFilter` (940, для files/music/voice/round), `processUrlFilter` (964);
- каждому элементу проставляется `search-super-item` + `data-mid` + `data-peer-id` (+ `data-thread-id` для saved), `append`/`prepend` (стр. 1210–1229);
- `afterPerforming()` (1259–1283) — снимает `hide` с секции, чистит прелоадер, показывает `Chat.Search.NothingFound`.

`processPhotoVideoFilter` (874–938): `div.grid-item`, `choosePhotoSize(media, 200, 200)`, `wrapVideo({onlyPreview:true, noPlayButton:true})` или `wrapPhoto({noBlur:true})`, спойлер/sensitive через `wrapMediaSpoiler(140×140, multiply 0.3)`, классы `grid-item-media`, промис `thumb` кладётся в общий `promises` (чтобы всё появилось одновременно).

**Клик по медиа** (стр. 716–777): собирает все `.grid-item` таба как `prevTargets`/`nextTargets` и открывает `AppMediaViewer` с `setSearchContext(copySearchContext(...))` — просмотрщик умеет догружать историю дальше.

**Выделение / контекстное меню:** `SearchContextMenu` (стр. 156–344) и `SearchSelection` (`this.selection`, стр. 414, 460) — «Перейти к сообщению», «Переслать», «Выделить», «Удалить».

**Инкрементальные апдейты** (в `sharedMedia.tsx`): `history_multiappend` → `renderNewMessage` (стр. 254–263 → `_renderNewMessage`, 209–252), `history_delete` → `deleteDeletedMessages` (338–348). Оба работают с общим модульным кэшем `historiesStorage[peerId][threadId]` (стр. 33–37) — он переживает переоткрытие профиля.

## 5. Поведение скролла (самая нетривиальная часть)

Всё держится на **одном** `Scrollable` таба; профиль и медиатабы — просто его дети.

### 5.1 Три состояния/класса на `tab.container` (`.profile-container`)

| Класс | Кто ставит | Смысл |
|---|---|---|
| `is-collapsed` | `PeerProfileAvatars.setCollapsed()` — `peerProfileAvatars.ts:935` | шапка свёрнута: аватар → круг 120px по центру, имя/статус по центру |
| `need-white` | там же, стр. 936–941 | текст поверх шапки белый (когда фон цветной или шапка развёрнута); дополнительно `changeTitleEmojiColor(info, …)` |
| `header-filled` | `updateHeaderFilled()` — стр. 949–955, и `sharedMedia.tsx:513` | `sidebar-header` получает непрозрачный фон |

```ts
// peerProfileAvatars.ts:949-955
updateHeaderFilled = () => {
  this.setCollapsedOn.classList.toggle('header-filled',
    (!this.hasBackgroundColor && this.isCollapsed() && this.scrollable.scrollPosition >= 5) ||
     this.scrollable.scrollPosition >= 200);
}
```

### 5.2 Цепочка `onAdditionalScroll`

Оборачивается несколько раз (паттерн «декоратор колбэка»):

1. `Scrollable.attachBorderListeners` (`scrollable.ts:417-426`) → `scrolled-start` / `scrolled-end`.
2. `PeerProfileAvatars` конструктор (`peerProfileAvatars.ts:312-320`) → `fastRaf(this.updateHeaderFilled)`; при `middlewareHelper.onDestroy` возвращает предыдущий колбэк.
3. `sharedMedia.tsx:485-494`:

```ts
const HEADER_HEIGHT = 56, ADDITIONAL_OFFSET = 16;
const OFFSET = 72, BODY_PADDING = 16;
tab.scrollable.onAdditionalScroll = () => {
  cb?.();
  const isSingle = searchSuper.navScrollableContainer.classList.contains('is-single');
  const rect = (isSingle ? searchSuper.container : searchSuper.nav).getBoundingClientRect();
  if(!rect.width) return;
  setIsSharedMedia(rect.top - 1 <= (OFFSET + BODY_PADDING));  // 88px
};
```

`setIsSharedMedia(isSharedMedia)` (`sharedMedia.tsx:505-517`):

- `animatedCloseIcon.classList.toggle('state-back', tab.isFirst || isSharedMedia)` — «крестик» ↔ «стрелка назад»;
- `searchSuper.container.classList.toggle('is-full-viewport', isSharedMedia)`;
- `tab.header.classList.toggle('hide-border', isSharedMedia)`;
- `transition(getTitleIndex(isSharedMedia))` — заголовок «Информация о …» ⇄ «Общие медиа + счётчик»;
- при `true` → `container.classList.add('header-filled')`; при `false` → `searchSuper.cleanScrollPositions()`.

### 5.3 Кнопка «назад» ведёт себя как двухуровневая

`sharedMedia.tsx:537-552`:

```ts
attachClickEvent(tab.closeBtn, () => {
  if(transition.prevId() && !tab.noProfile) {
    tab.scrollable.scrollIntoViewNew({element: '.profile-content', position: 'start'});
    transition(TitleIndex.Profile);
    if(!tab.isFirst) { animatedCloseIcon.classList.remove('state-back'); container.classList.remove('header-filled'); }
  } else if(!tab.scrollable.isHeavyAnimationInProgress) {
    tab.slider.onCloseBtnClick();
  }
});
```

То есть: если мы «внизу» на медиатабах — назад = проскроллить обратно к профилю; ещё раз назад = закрыть таб.

### 5.4 «Прилипание» (sticky) шапки медиатабов

- `searchSuper.container` — `position: absolute; top: 100% !important` внутри `.profile-content` (`_rightSidebar.scss:89-92`), с `--super-offset: 56px + $section-rounded-padding` (стр. 87–90) и `min-height: var(--super-height) = 100vh - offset` (`_searchSuper.scss:5,13`).
- `.search-super-tabs-scrollable` — `position: sticky; top: var(--super-offset); z-index: 2` (`_searchSuper.scss:19-25`).
- `.search-super-tabs-gradient-container` — тоже sticky, чуть выше (`_searchSuper.scss:93-99`).
- `is-single` (один таб): `order: 1; top: auto; bottom: 0; transform: translateY(-scrollable-size); height: 0; opacity: 0` (`_searchSuper.scss:27-57`) — строка меню исчезает, но остаётся местом для панели выделения.
- `.search-super-content-container { min-height: calc(var(--super-height) - $menu-offset) }` (стр. 66–72) — гарантирует, что при переключении на «короткий» таб скролл не «прыгает».

### 5.5 Pull / wheel-механика сворачивания шапки — `src/hooks/useCollapsable.ts`

```ts
const {folded, unfold, fold} = useCollapsable({
  container: () => this.container,          // .profile-avatars-container
  listenWheelOn: this.setCollapsedOn,       // весь .profile-container
  scrollable: () => scrollable.container,
  disableHoverWhenFolded: false,
  shouldIgnore: () => this.uploadInProgress
});                                         // peerProfileAvatars.ts:328-335
```

Внутри (текущая, упрощённая ветка `if(isWheel || true)`, стр. 76–106):

- если `scrollTop > 0` и не свёрнуто → мгновенно `STATE_FOLDED`;
- `WheelClassifier` (стр. 74, 87–91) отсекает «инерцию» трекпада;
- иначе бинарно: `delta < 0` (скролл вверх / потянули вниз) → `STATE_UNFOLDED`, `delta > 0` → `STATE_FOLDED`, с `debounce(75ms)`;
- touch: свой `SwipeHandler` на `listenWheelOn` (стр. 155–172), исключая `.folders-tabs-scrollable`;
- `unfold(e)` / `fold()` (стр. 174–186); `fold()` анимирует через `animateSingle` за 125 мс (`scrollTo`, стр. 34–55);
- есть закомментированная/отключённая «плавная» ветка с дробным `progress = delta/600` (стр. 108–141) — в текущем состоянии код бинарный.

Реакция: `createEffect` в `peerProfileAvatars.ts:340-347` → `this.setCollapsed(folded())`; при `hasNoPhoto` шапку насильно держат свёрнутой.

`setCollapsed()` (стр. 929–943) дополнительно: если сворачиваем и `listLoader.index !== 0` — `goWithoutTransition(-index)` (возврат к первому аватару без анимации).

### 5.6 CSS-геометрия шапки (`_profile.scss`)

- Развёрнуто: `.profile-avatars-container { width:100%; padding-bottom:100%; min-height:276px }` (стр. 5–14) — квадрат.
- Свёрнуто: `.profile-container.is-collapsed .profile-avatars-container { padding-bottom: 66% }` (стр. 472–475), а активный аватар — `transform: translateY(-3%) scale(120/400); border-radius: 50%` (стр. 477–480).
- `info` уезжает `translateY(-33%)`, имя/статус центрируются `inset-inline-start: 50%; transform: translateX(-50%)` (стр. 502–514).
- Табы/градиенты/стрелки → `opacity: 0` (стр. 491–500).
- `need-white` — белый текст, `--secondary-opacity-max: .7`, белые verified/premium иконки (стр. 555–596).
- `:not(.header-filled) .sidebar-header` — прозрачный фон, `pointer-events: none` (кроме `.btn-icon`) (стр. 598–623); хедер `position: absolute; inset-inline: 0; z-index: 3` (стр. 625–663).
- Все переходы под `@include animation-level(2)` — при `animation-level-0` отключаются.

## 6. Group / channel info — отличия

**Открытие идентично** (тот же `AppSharedMediaTab`), различия декларативные:

1. **Заголовок** — `changeTitleKey()` (`sharedMedia.tsx:73-111`): `Profile.Info.Group` / `.Channel` / `.Bot` / `.User` / `.Topic`.
2. **Секции профиля:** для чатов исчезают `Phone`/`Username`/`Birthday`/`ContactNote`, появляется `Link` (`t.me/username` или `exported_invite`), `Bio` меняет подпись на `Info`, добавляется `Location`.
3. **Контент-табы:** `members` (только не-broadcast с `view_participants`), `similar` (только каналы), `saved`/`groups` только для user, `savedDialogs` только для «себя».
4. **Inline-actions:** `btnAddMembers` (`ButtonCorner`) появляется на табе `members` и только если `canViewMembers && hasRights('invite_users')` (класс `can-add-members`, `sharedMedia.tsx:69`); клик → `addChatUsers({peerId, slider})` (стр. 693–698).
5. **Кнопка edit** ведёт в `AppEditChatTab` (или `AppEditTopicTab` для топика), откуда доступны все «управляющие» табы (см. §2.3).
6. **Список участников** в shared media — `SortedUserList` c контекстным меню участника; отдельный полноценный экран — `AppChatMembersTab` (`chatMembers.tsx`): заголовок `PeerInfo.Subscribers` для канала vs `GroupMembers` для группы (стр. 31), `ButtonCorner('addmember_filled')` (стр. 34), опция «Скрыть участников» при `participants_count >= appConfig.hidden_members_group_size_min` (стр. 44–47), `createSelectorForParticipants` (стр. 49–55).
7. **Админы / забаненные:** `AppChatAdministratorsTab`, `AppRemovedUsersTab`, `AppUserPermissionsTab` (права конкретного участника), `AppGroupPermissionsTab` (общие права + «не ограничивать бустеров» + «плата за сообщения»).
8. **Топбар** для каналов/групп добавляет `Statistics`, `BoostChannel/BoostGroup`, `RecentActions`, `ChannelDirectMessages.Manage` (см. `topbar.ts:655-680`).

## 7. Ключевые SCSS

| Файл | Что содержит |
|---|---|
| `src/scss/partials/_profile.scss` (1094) | `.profile-avatars-*` (карусель, tabs-прогресс, стрелки, градиенты, emoji-паттерн), `.profile-container.is-collapsed / .need-white / :not(.header-filled)`, `.profile-name`, `.profile-subtitle`, `.profile-content`, `.profile-music`, `.profile-story-previews` |
| `src/scss/partials/_rightSidebar.scss` (570) | `#column-right` (позиционирование/скрытие через `translate3d`, `--right-column-width`, safe-area), `.shared-media-container` (`--super-offset: 56px + padding`, `.search-super { top: 100% !important }`, `.btn-corner`), а также стили `#stickers-container`, `#poll-results-container`, `.edit-peer-container`, `.chat-requests-container`, `.edit-contact-container`, `.group-type-container`, `.chat-discussion-container`, `.statistics-*`, `.boosts-*` |
| `src/scss/partials/_searchSuper.scss` (428) | `.search-super`, sticky-меню `.search-super-tabs-scrollable` (+`is-single`), `.search-super-tabs-gradient`, `.search-super-content-media-grid` (grid 3×, gap 1px, стр. 185–190), стили для stories/saved/music/voice/links |
| `src/scss/partials/_slider.scss` (267) | `.menu-horizontal-scrollable`, `.menu-horizontal-div-item` + `-background` («летающий» индикатор, `transform-origin: left`), `.tabs-container` / `.tabs-tab` (grid-наложение, `display:none` → `.active { display: flex }`), `[data-animation="navigation"].animating` |
| `src/scss/partials/_sidebar.scss` (128) | `.sidebar-header` (min-height 3.5rem, `__title`, `__subtitle`, `__rows`, `:after`-бордер + `.scrolled-start`), `.sidebar-close-button`, `.sidebar-content`, `.sidebar-slider-item` |
| `src/scss/partials/_transition.scss` (303) | `.transition.slide-fade` / `.slide-fade.backwards` (стр. 99–148) — анимации заголовка shared media (`±1.5rem` + opacity, 0.4 s), а также `zoom-fade`, `fade` |
| `src/scss/partials/_section.scss` (107) | `.sidebar-left-section` — карточки-секции внутри табов |
| `src/scss/partials/_searchGroup.scss`, `_row.scss`, `_chatlist.scss`, `_document.scss`, `_audio.scss`, `_similarChannels.scss`, `_starGift.scss` | элементы списков внутри контент-табов |
| CSS-модули отдельных табов | `sidebarRight/tabs/savedMusic.module.scss`, `adminRecentActions/*.module.scss` |

## 8. Сводные последовательности вызовов (шпаргалка для порта)

**Открытие профиля из чата:**

```
topbar click (topbar.ts:276)
→ appSidebarRight.toggleSidebar(true)                       (sidebarRight/index.ts:102)
   ├ if(!historyTabIds.length) sharedMediaTab.open()         (стр. 119-121)
   │    └ SliderSuperTab.open() → init() → _render() → <SharedMedia/> → slider.selectTab(this)
   │         └ SidebarSlider.selectTab (slider.ts:117) → pushNavigationItem → _selectTab(container)
   │              └ TransitionSlider slideNavigation (transition.ts:23)
   ├ appImManager.selectTab(APP_TABS.PROFILE)                (appImManager.ts:2588)
   └ document.body.classList.add('is-right-column-shown')
```

**Переключение контент-таба (Media → Files):**

```
click .menu-horizontal-div-item
→ horizontalMenu attachClickEvent (horizontalMenu.ts:196) → _selectTarget → selectTarget (стр. 42)
   ├ onClick = AppSearchSuper коллбэк (appSearchSuper.ts:624): сохранение scroll, transform, load(true)
   ├ fastSmoothScroll по оси X (центрирование пункта меню)
   ├ анимация индикатора .menu-horizontal-div-item-background (стр. 106-127)
   └ selectTab(id) → TransitionSlider slideTabs
→ onTransitionEnd (appSearchSuper.ts:692) → восстановление scrollPosition, снятие 'sliding'
```

**Скролл вниз до медиа:**

```
scroll → Scrollable.onScroll (scrollable.ts:210) → onAdditionalScroll цепочка
   ├ scrolled-start/end
   ├ PeerProfileAvatars.updateHeaderFilled (fastRaf)
   └ sharedMedia: setIsSharedMedia(rect.top <= 88)
        ├ animatedCloseIcon 'state-back'
        ├ header 'hide-border' + container 'header-filled'
        └ transition(TitleIndex.Media) → заголовок «Общие медиа» + счётчик текущего таба
```

**Смена чата (замена профиля без анимации):**

```
chat.setPeer → createSharedMediaTab() (новый, вне DOM) → setPeer() → setQuery() → searchSuper.cleanup()
chat.finishPeerChange → fillProfileElements() (готовит коммит) → loadSidebarMedia(true)
   → callbacks() → replaceSharedMediaTab(newTab) (sidebarRight/index.ts:50)
        ├ historyTabIds[idx] = newTab
        ├ _selectTab.setFrom(newTab.container)
        ├ перенос класса 'active'
        └ previousTab.container.replaceWith(newTab.container)
```

---

# Часть 2. Поведение group info в tweb (детали)

## 0. Архитектура экрана (общая для user/group/channel)

Правая колонка — один слайдер `AppSidebarRight` (`sidebarRight/index.ts:16`), первый таб — `AppSharedMediaTab` (`sidebarRight/tabs/sharedMediaTab.tsx:26`).

- `AppSharedMediaTab` — тонкий stateful-контроллер (`setPeer`, `fillProfileElements`, `loadSidebarMedia`, `setSearchTab`, `setLoadMutex`), реальный UI строит динамически импортируемый Solid-компонент `sharedMedia.tsx` и вешает его на `tab._impl` (`sharedMediaTab.tsx:38-62`, `sharedMedia.tsx:700-706`).
- Внутри скроллабла лежит **один общий скролл**: сверху `renderPeerProfile(...)` (шапка + секции профиля), снизу — контейнер `searchSuper` (табы медиа/участников), который передаётся в профиль как `searchSuperContainer` и рендерится последним ребёнком `.profile-content` (`sharedMedia.tsx:160-170`, `peerProfile.tsx:211`).
- Т.е. **отдельного таба «участники» нет** — список участников это один из табов `AppSearchSuper` внутри того же скролла профиля.

## 1. Секции и табы: группа vs user vs channel

### 1.1 Заголовок таба (шапка сайдбара)

`sharedMedia.tsx:73-111` — `changeTitleKey()`:

- topic/botforum + threadId → `Profile.Info.Topic`
- бот → `Profile.Info.Bot`
- broadcast → `Profile.Info.Channel`
- user → `Profile.Info.User`
- **иначе (megagroup/legacy chat) → `Profile.Info.Group`**

Кнопка «⋮» (btnMenu) в шапке скрывается для всех, кроме Saved Messages первого таба: `btnMenu.classList.toggle('hide', !tab.isFirst || isSavedDialog || peerId !== rootScope.myId)` (`sharedMedia.tsx:109`), плюс появляется на табах `gifts`/`stories` (`sharedMedia.tsx:658-666`).

### 1.2 Секции профиля (`peerProfile.tsx`)

Корневой состав (`peerProfile.tsx:194-214`):
`AutoAvatar` → delimiter → `UnofficialWarning` → `PersonalChannel` → `MainSection` → `BotMainApp` → `BotVerification` → `BotPermissions` → `searchSuperContainer`.

`MainSection` (`peerProfile.tsx:1510-1533`) — все строки условные:

| Строка | Файл:строка | user | group (megagroup/chat) | channel |
|---|---|---|---|---|
| `Phone` | `peerProfile.tsx:633-691` | да (`peerId.isUser()` + `canBeDetailed`) | нет | нет |
| `Username` | `peerProfile.tsx:693-732` | да (только user!) | нет | нет |
| `Location` (channelFull.location) | `peerProfile.tsx:873-893` | нет | да, для гео-групп | да |
| `Bio` / about | `peerProfile.tsx:895-967` | сабтайтл `UserBio` | сабтайтл `Info` (описание группы) | сабтайтл `Info` |
| `Link` (t.me/… или invite-link) | `peerProfile.tsx:969-1036` | **нет** (ранний return на `isUser()`) | **да** — username, либо `exported_invite` | да |
| `Birthday` | `peerProfile.tsx:749-831` | да | нет | нет |
| `ContactNote` | `peerProfile.tsx:833-871` | да | нет | нет |
| `BusinessHours` / `BusinessLocation` | `peerProfile.tsx:1082-1173` | да | нет | нет |
| `Notifications` (toggle) | `peerProfile.tsx:1175-1218` | да | да | да (условие только `isDialog && canBeDetailed()`) |
| `BotAddToChat`, `BotPrivacyPolicy` | `peerProfile.tsx:1038-1080` | только бот | нет | нет |

Прочее, характерное не для группы:

- `PersonalChannel` (карточка личного канала юзера) — `peerProfile.tsx:477-594`, только `UserFull.personal_channel_id`.
- `PinnedGifts` / `PinnedMusic` / `StoryPreviews` — вешаются в шапку аватара (`peerProfile.tsx:243-249`); `PinnedGifts` только для `peerId.isUser()` (`peerProfile.tsx:428-434`), `StoryPreviews` — не для myId.
- `UnofficialWarning` — только user, не-бот (`peerProfile.tsx:1260-1282`).
- `BotVerification` — bot_verification, либо официальная галочка; текст различается `Verified.Channel` / `Verified.Group` / `Verified.Bot` (`peerProfile.tsx:1239-1245`).
- `BotMainApp`, `BotPermissions` — только боты.
- `SubtitleRating` (stars rating) — только `UserFull` (`peerProfile.tsx:306-326`).

### 1.3 Табы searchSuper

Определение и порядок (`sharedMedia.tsx:604-647`): `savedDialogs, stories, members, media, gifts, saved, files, links, music, voice, groups, similar`. Ключи счётчиков в сабтайтле шапки — `sharedMedia.tsx:449-462`.

Видимость (`appSearchSuper.ts:2380-2513`):

- `members` — `canViewMembers()` (`appSearchSuper.ts:2644-2656`): `peerId.isAnyChat() && !isBroadcast && hasRights(chatId,'view_participants') && (!threadId || !isForum)`. **Это ровно «группа»**: для канала и юзера таба нет.
- `groups` (общие группы) — только для user (`canViewGroups`, `appSearchSuper.ts:2658-2663`).
- `similar` (похожие каналы) — только не-user (`appSearchSuper.ts:2686-2698`).
- `savedDialogs`/`saved` — Saved Messages / переписка в избранном.
- `stories` — не для myId; для чата — `channelFull.pFlags.stories_pinned_available` (`appSearchSuper.ts:2665-2684`).

Приоритет первого открытого таба (`appSearchSuper.ts:2480-2497`): stories → **members (перебивает stories)** → savedDialogs → gifts. То есть у группы по умолчанию открыт список участников.

Также при загрузке `members` исключается для user, а `groups` — для чатов (`appSearchSuper.ts:2551-2555`).

## 2. Список участников группы

**Где живёт:** таб `members` внутри `AppSearchSuper`, метод `loadMembers` — `appSearchSuper.ts:1525-1760`. Тот же метод обслуживает и таб `groups` (общие чаты юзера) — различие по `chatId` vs `userId` (`:1526-1527`).

**Контейнер списка:** `SortedUserList` (`appSearchSuper.ts:1546-1551`), создаётся лениво один раз, вставляется в `mediaTab.itemsTab` (`:1572`).

**Сортировка:** `SortedUserList` (`src/components/sortedUserList.ts:48`) сортирует по `getIndex = appUsersManager.getUserStatusForSort(id)`, у чатов индекс 0. `getUserStatusForSort` (`src/lib/appManagers/appUsersManager.ts:707-739`) возвращает `expires`/`was_online` (большие числа = онлайн/недавно), либо 3/2/1 для recently/lastWeek/lastMonth, 0 иначе. Сортировка убывающая → **онлайн первыми**. Пересортировка по таймеру каждые 30 с (`sortedUserList.ts:23 SORT_INTERVAL = 30e3`, цикл `:118-129`), с ожиданием heavy-animation и проверкой `isInDOM` (`:99-113`).

Строка участника: `appDialogsManager.addDialogNew` c `avatarSize:'abitbigger'`, `withStories:true`, сабтайтл = `getUserStatusString` (для юзера) / `getChatMembersString` (для чата), справа — ранг участника через `wrapParticipantRank` (`sortedUserList.ts:52-91`).

**Подгрузка:**

- супергруппа: `appProfileManager.getChannelParticipants({id, limit, offset})`, `LOAD_COUNT = 50` для первой пачки и `200` дальше (`appSearchSuper.ts:1718-1739`); `nextRates` = число уже отрендеренных.
- legacy chat: `getChatFull` целиком, `loaded = true` сразу (`appSearchSuper.ts:1740-1756`).
- Фильтрация: удалённые/несоответствующие типу peer'ы выбрасываются (`appSearchSuper.ts:1650-1678`).
- Live-обновления: для `chat` — `chat_full_update` с диффом (`:1597-1625`), для канала — `chat_participant` (`:1626-1646`), с инкрементом/декрементом счётчика таба.

**Клик по участнику:** `appSearchSuper.ts:1552-1571` — игнор при `has-stories`, на мобиле сначала `toggleSidebar(false)`, потом `appImManager.setInnerPeer({peerId})`.

**Контекстное меню:** `createParticipantContextMenu` (`appSearchSuper.ts:1577-1583`) → `src/helpers/dom/createParticipantContextMenu.ts`. Пункты (`:40-116`): SendMessage; AddToGroup/AddToChannel (если забанен); SetAsAdmin (`canManageAdmins && !isParticipantAdmin`); EditAdminRights; KickFromSupergroup (→ `openUserPermissionsTab`); Delete (снять бан); KickFromGroup. Права читаются в `onOpen` (`:124-138`): `change_permissions` используется и как `canChangePermissions`, и как `canManageAdmins`. Таргет — `.chatlist-chat`, ему добавляется класс `menu-open`.

**Кнопка Add Members:** `ButtonCorner({icon:'addmember_filled'})` создаётся в `sharedMedia.tsx:690-698`, кладётся в `tab.content`, клик → `addChatUsers({peerId, slider})` (`src/components/addChatUsers.ts`). Показ:

- класс контейнера `can-add-members` = `canViewMembers && hasRights(chatId,'invite_users')` (`sharedMedia.tsx:61-69`), CSS `_rightSidebar.scss:126-130`;
- плюс `is-hidden` снимается только когда активен таб `members`, с задержкой 250 мс при включённых анимациях (`sharedMedia.tsx:653-656`).

Отдельный полноэкранный таб участников (из «редактировать группу» → GroupMembers) — `sidebarRight/tabs/chatMembers.tsx` (там свой ButtonCorner `:34-42`, тумблер «Скрыть участников» `:48-95`, то же контекстное меню `:97-103`).

## 3. Шапка профиля

`PeerProfileAvatars` — `peerProfileAvatars.ts:41`. Инстанцируется в `PeerProfile.Avatar` (`peerProfile.tsx:217-256`), туда же вкладываются `Name` + `Subtitle` в `avatars.info`, а в контейнер — PinnedGifts / PinnedMusic / StoryPreviews.

**Карусель аватаров** (`peerProfileAvatars.ts:433-498`, `setPeer`):

- user: `appPhotosManager.getUserPhotos(peerId, maxId, 50)`; для своего профиля в конец дописывается публичное `fallback_photo` (`:422-431`, `:443-451`).
- **группа/канал**: `getChatFull` (для текущего `chat_photo`) + `getHistory` c `inputMessagesFilterChatPhotos` (`:455-497`) — т.е. история смен аватара чата.
- topic (threadId): карусели нет, один «avatar-120» с иконкой топика, класс `is-topic`, шапка залочена свёрнутой (`:381-400`).
- Навигация: клик в левую/правую треть → `goWithoutTransition(±1)` с закольцовыванием, клик в центр → `openAvatarViewer` (`:185-232`); свайп через `SwipeHandler` (`:243-...`); табы-полоски `.profile-avatars-tabs`, прогресс видео-аватара `startVideoProgressLoop` (`:591`).
- Свёрнуто/развёрнуто: `useCollapsable` (`:322-348`), класс `is-collapsed` / `need-white` / `header-filled` на `setCollapsedOn` (= `tab.container`), см. `setCollapsed` `:929-943`, `updateHeaderFilled` `:949-955`. Стили — `_profile.scss:472`, `:540`, `:845`.

**Кнопки действий (call / video chat / search / more) в tweb живут не в профиле, а в топбаре чата** — `src/components/chat/topbar.ts:212-226`:

- `btnCall` (звонок) — `verifyCallButton` `:401-407`: **только `peerId.isUser()`** и `userFull.pFlags.phone_calls_available`.
- `btnGroupCall` (видеочат) — `verifyVideoChatButton` `:359-399`: **только чаты** (`!peerId.isUser()`, без threadId); для broadcast с правом `manage_call` верхняя кнопка прячется (лайв-стрим), т.е. фактически это кнопка группы.
- `btnGroupCallMenu` (RTMP) — `verifyRtmpButton` `:335-357`: только broadcast с `manage_call`.
- `btnSearch` `:843-847`, `btnMore` `:185-210` (пункты меню с `verify`, напр. `BoostChannel` для broadcast `:668-672` и `BoostGroup` для megagroup `:673-677`).
- Mute/Join переехали в плашку над инпутом (комментарий `topbar.ts:215`).
- Клик по `chat-info` в топбаре открывает правую колонку: `topbar.ts:262-281` (по аватару — toggle, по остальному — `toggleSidebar(true)`).

**Карандаш (edit)** — `editBtn = ButtonIcon('edit')` в шапке правой колонки (`sharedMedia.tsx:399`, добавляется в `transitionFirstItem` `:436`). Видимость — `toggleEditBtn` (`sharedMedia.tsx:113-145`):

- заморожен аккаунт → скрыт;
- user → `peerId !== myId && appUsersManager.canEdit(...)`;
- topic → `dialogsStorage.canManageTopic(...)`;
- **channel/megagroup** → `!monoforum && (hasRights(chat,'just_admin') || hasRights(chat,'change_info'))`;
- legacy chat → `hasRights('change_info') || hasRights('change_permissions')`.

Какой таб открывается по клику (`sharedMedia.tsx:554-582`):

- topic → `AppEditTopicTab.open({peerId, threadId})`
- **любой чат (группа/канал) → `AppEditChatTab.open({chatId})`** (`sidebarRight/tabs/editChat.tsx`)
- бот → `AppEditBotTab`, иначе user → `AppEditContactTab`.

В `editChat.tsx` разделение group/channel: тип чата `ChannelType`/`GroupType` (`:175-177`), «Разрешения» только для не-broadcast и не-broadcastGroup (`:322-342`), «Обсуждение»/«Связанный канал» (`:364`), «Администраторы» (`:506`), «Участники»/«Подписчики» (`:536-539`), «Удалённые пользователи» (`:569`), Recent Actions (`:406`), кнопка удаления `PeerInfo.DeleteChannel` vs `DeleteAndExitButton` (`:718`).

## 4. Онлайн-статус группы в сабтайтле («N members, M online»)

`PeerProfile.SubtitleStatus` (`peerProfile.tsx:328-421`) вызывает `appImManager.setPeerStatus({peerId, element, useWhitespace:true, ignoreSelf: !isDialog, ...})` (`peerProfile.tsx:376-384`) с рефетчем по `peer_typings` / `user_update` и **интервалом 60 с** (`peerProfile.tsx:401`).

Цепочка:

- `appImManager.setPeerStatus` — `src/lib/appImManager.ts:3164-3212`
- `getPeerStatus` — `:3152-3162` → чат → `getChatStatus`, юзер → `getUserStatus` (`:3121-3150`, класс `.online` при `userStatusOnline`).
- `getChatStatus` — `:3086-3119`: `getChatMembersString(...)` + `appProfileManager.getOnlines(chatId)`; если `onlines > 1`, склеивает через `join`: «N участников» + `i18n('OnlineCount',[M])` (`:3101-3110`).
- `getChatMembersString` — `src/components/wrappers/getChatMembersString.ts:9-22`: ключ `Peer.Status.Subscribers` для broadcast, **`Peer.Status.Member` для группы**; count из `getParticipantsCount(chatFull)`; `chatForbidden` → `YouWereKicked`.
- `getOnlines` — `src/lib/appManagers/appProfileManager.ts:1015-1055`: broadcast → всегда 1; участников < 2 → 1; **megagroup ≤ 100 участников** → считает локально по `getChannelParticipants(recent, 100)` через `reduceParticipantsForOnlineCount` (`:1004-1013`, статус строго `userStatusOnline`); **megagroup > 100** → API `messages.getOnlines` с кешем 60 с (`:1038-1045`); legacy chat → счёт по `chatFull.participants`.

Тот же сабтайтл используется в топбаре чата и в строках `SortedUserList` (для чатов — `getChatMembersString`, `sortedUserList.ts:56-58`).

## 5. Клики по строкам и тосты

Все строки профиля — компонент `Row` (`@components/rowTsx`) с пропсами `clickable` и `contextMenu.buttons`.

| Строка | Клик | Тост | Контекстное меню |
|---|---|---|---|
| Phone (`peerProfile.tsx:655-688`) | copy номера без пробелов | `I18n.format('PhoneCopied', true)` | `Text.CopyLabel_PhoneNumber`; + `PeerInfo.Phone.AnonymousInfo` → fragment.com/numbers (только для fragment-префиксов, `:650`) |
| Username (`:706-729`) | copy `'@'+username` | `UsernameCopied` | `Text.CopyLabel_Username` |
| «also @x, @y» (`:86-94` + `anchorCopy`) | copy ссылки/юзернейма | `UsernameCopied` / `LinkCopied` (`src/helpers/dom/anchorCopy.ts:29-33`) | — |
| **Link (главная строка группы)** (`:1007-1015`) | copy `https://t.me/...` | `LinkCopiedPrivateInfo` если ссылка вида `/c/` (приватная группа), иначе `LinkCopied` | `Text.CopyLabel_ShareLink` |
| Bio/about (`:914-921`) | copy текста; клик по `<a>` внутри игнорируется | `BioCopied` | `Text.CopyLabel_About` (чат) / `Text.CopyLabel_Bio` (юзер), + `TranslateMessage` (иначе `PopupPremium.show({feature:'translations'})`) |
| Birthday (`:786-808`) | myId → попап выбора даты; сегодня ДР → `PopupSendGift`; иначе copy | `TextCopied` | `Copy` |
| ContactNote (`:844-848`) | copy с entities (`prepareTextWithEntitiesForCopying`) | `TextCopied` | `Text.CopyLabel_Note` |
| BusinessLocation (`:1118-1138`) | без geo → copy адреса; с geo → `confirmationPopup('Popup.OpenInGoogleMaps')` → `safeWindowOpen` | `BusinessLocationCopied` | `Copy` |
| Location (channel) (`:884-891`) | **не кликабельна** | — | — |
| Notifications (`:1199-1215`) | toggle → `togglePeerMute` | — | — |
| QR-кнопка в Username/Link (`:734-747`) | `showMyQrCodePopup(peerId)`, скрыта для myId | — | — |
| «Показать, когда был онлайн» (`:96-113`) | `PopupToggleReadDate` | — | — |

Реализация тостов: `src/components/toast.ts:31-56` (`toast`, длительность 3000 мс, singleton-элемент `.toast` в overlay-root) и `toastNew` (`:58+`).

## 6. Анимация открытия/закрытия правой колонки и сжатие чата

**JS:** `AppSidebarRight.toggleSidebar(enable?, animate?)` — `sidebarRight/index.ts:102-136`:

- переключает класс на `document.body`: `RIGHT_COLUMN_ACTIVE_CLASSNAME = 'is-right-column-shown'` (`index.ts:14`, `:94`, `:126`);
- дергает `appImManager.selectTab(APP_TABS.PROFILE | APP_TABS.CHAT, animate)` и возвращает его промис (`:123`);
- `hide()` (`:92-100`) дополнительно: `sidebarEl.inert = true`, снятие navigation item, `animationIntersector.toggleVideosUnder(sidebarEl, true)` (пауза видео-аватаров, т.к. колонка остаётся в DOM), событие `right_sidebar_toggle`.

`appImManager.selectTab` — `src/lib/appImManager.ts:2588-2647`: переключает `LEFT_COLUMN_ACTIVE_CLASSNAME`, отдаёт `pause(transitionTime)` (250/200 + 100 мс) и `dispatchHeavyAnimationEvent`, на мобиле при уходе с `APP_TABS.PROFILE` вызывает `appSidebarRight.hide()`.

**CSS:** сама колонка — `_rightSidebar.scss:3-74`:

- десктоп (`not-handhelds`): `position:absolute`, `width: var(--right-column-width)`, закрытое состояние — `transform: translate3d(calc((var(--right-column-width) + var(--page-chats-padding) + var(--safe-area-inset-inline-end)) * var(--reflect)), 0, 0)` (`:52`), открытое (`body.is-right-column-shown`) — `translate3d(0,0,0)` c `transition: transform var(--transition-standard-in)` (`:22-32`); закрытие — `--transition-standard-out` (`:41`).
- handhelds: колонка уезжает на `translate3d(100vw,0,0)` (`:17`).
- `body.animation-level-0`, `body.resizing-left-sidebar`, `body.resizing-right-sidebar` → `transition: none` (`:61-65`).

**Сжатие чата** — не изменение ширины, а сдвиг трансформом + пересчёт CSS-переменных:

- `#column-center` (`_chat.scss:409-478`): базовый `translateX((--folders-sidebar-offset + --left-column-width + --page-chats-padding)/2 * --reflect)`, а при `body.is-right-column-shown:not(.right-column-floats)` — `translateX((--folders-sidebar-offset + --left-column-width − --right-column-width)/2 * --reflect)` (`:437-442`).
- `.bubbles` скролл-зона: `inset-inline` пересчитывается с учётом `--right-column-width` (`_chat.scss:1129-1137`).
- `.drops-container`: `inset-inline-end: var(--right-column-width)` (`_chat.scss:513-515`).
- Переменные `--right-column-width`, `--page-chats-padding`, `--chat-width` и класс `body.right-column-floats` (колонка накрывает чат, а не сжимает) выставляет `src/helpers/updateColumnWidths.ts` (`:338` установка ширины, `:377` toggle класса); ресайз перетаскиванием — `installColumnResize` (`sidebarRight/index.ts:39-40`).
- На handhelds чат уезжает: `body.is-right-column-shown &` → `translate3d(-25vw,0,0); opacity:0` (`_chat.scss:458-461`).

**Внутренняя анимация шапки самого профиля** (не колонки): переключение заголовка «Инфо ↔ SharedMedia» через `TransitionSlider('slide-fade', 400ms)` (`sharedMedia.tsx:519-535`), триггер по скроллу `setIsSharedMedia` (`sharedMedia.tsx:481-517`), классы `header-filled` / `is-full-viewport` / `hide-border`, а кнопка закрытия превращается в «назад» (`animated-close-icon.state-back`, `sharedMedia.tsx:359-366`, `:537-552`).

---

# Часть 3. Наша реализация: карта, потоки данных, состояние

## 0. Общая модель

В tweb правая колонка — один постоянный `#column-right` со стеком вкладок (`SidebarSlider`). У нас она распалась на **несколько независимых React-порталов в `#main-columns`**:

| Панель | Файл | Портал | Когда |
|---|---|---|---|
| Профиль/группа/канал | `src/components/UserInfoPanel.tsx` | `#main-columns`, `div#column-right` | из `Chat.tsx` (lazy, `infoMounted`) |
| Поиск стикеров/GIF | `src/components/rightSidebar/RightSearchTab.tsx` | `#main-columns`, свой модуль-геометрия | из композера (`popupStore`) |
| Изменить/добавить контакт | `EditContactView.tsx`, `AddContactView.tsx` | док-панель в потоке (не колонка) | из `useChatPopups` |

Класс `body.is-right-column-shown` держится **счётчиком**, а не toggle'ом — `src/core/hooks/useRightColumnShown.ts:17-40` (обе панели могут быть открыты одновременно; обоснование в докблоке файла 1-14).

## 1. Компоненты правой колонки

### 1.1 Корень — `src/components/UserInfoPanel.tsx` (776 строк)

Один компонент на все типы пира: `private / group / channel / saved / secret` (`chat.type`).

| Блок | Строки |
|---|---|
| Портал + `#column-right`, `inert={!open}` | 321-335, 773-775 |
| Ресайз колонки (`installColumnResize({side:'right'})`) | 57-62 |
| `useNavLayer(open, onClose)` — Back закрывает панель | 44 |
| Вкладка-слайдер `.sidebar-content.sidebar-slider.tabs-container` | 341 |
| Вкладка профиля `.tabs-tab…shared-media-container.profile-container` + состояния `is-collapsed / header-filled / need-white / can-add-members` | 342-350 |
| Шапка `.sidebar-header` + `animated-close-icon[.state-back]` + `.transition.slide-fade` (заголовок ⇄ «имя + счётчик») | 355-396 |
| Тело `.sidebar-content > .scrollable.scrollable-y > .profile-content` | 401-403 |
| Карусель аватаров `.profile-avatars-*` (свайп, зоны-трети, пейджер, градиенты, стрелки, info) | 404-479 |
| Info-card (`SidebarSection` + `Row`): канал — Info/Link; группа — Link+QR; юзер — Phone/Username/Bio/Birthday; всем — Notifications; секрет — Encryption Key | 484-592 |
| `PinnedStoriesSection` (истории профиля) | 595 |
| Statistics (канал, `canViewStats`) | 598-606 |
| Discussion (канал, `canManageDiscussion`) | 611-630 |
| Join requests (approve/decline) | 633-664 |
| `<div className="search-super"><SharedMedia …/></div>` | 672-690 |
| FAB `.btn-circle.btn-corner` «добавить участников» | 729-733 |
| Подэкраны-оверлеи: `GroupEditFlow`, `AddMembersScreen`, `ChannelStats`, `RightsEditor` | 738-771 |
| Попапы: `GiftInfoPopup`, `KeyVerificationPopup`, `QrModal` | 693-721 |

Монтирование: `src/components/Chat.tsx:101` (`lazy`), `:332-337` (`infoOpen`/`infoMounted` — после первого открытия панель НЕ размонтируется), `:1584-1596`, тумблер `:1005`, клик по шапке чата `:1326`.

### 1.2 Шаред-медиа — `src/components/userInfo/SharedMedia.tsx` (741)

Таб-ряд + контент табов + виртуальный список «Избранного» (`SavedDialogsList` 632-694, `SavedDialogRow` 701-741).

### 1.3 Подэкраны

- `src/components/userInfo/RightsEditor.tsx` (136) — права админа (`.user-permissions-container`).
- `src/components/ChannelStats.tsx` (152) — статистика (`.statistics-container`, `useChannelStats`).
- `src/components/group/GroupEditFlow.tsx` (256) — «Изменить группу/канал» + 9 подэкранов в `group/screens/*` (`ChatTypeScreen`, `InviteLinkScreens`, `ReactionsScreen`, `DiscussionScreen`, `PermissionsScreen`, `AdminScreens`, `MembersScreen`, `MemberScreens` — banned/restricted).
- `src/components/group/AddMembersScreen.tsx` (118) — селектор участников.
- `src/components/PinnedStoriesSection.tsx` (49).

### 1.4 Хелперы/хуки

`src/components/userInfo/helpers.ts` (склонения, `HEADER_H=56`, `ADDITIONAL_OFFSET=16`, `BODY_PADDING=16`, `TAB_GAP=8`, `sharedMediaChatId`), `src/core/format/sharedMediaFmt.ts` (ext/цвета/размер/длительность/host), `core/hooks/useGroupInfo.ts` (252), `core/hooks/useUserProfileData.ts` (108), `useMuteToggle.ts`, `useChannelStats.ts`, `usePinnedStories.ts`, `useTransitionSlider.ts`, `useRightColumnShown.ts`, `core/dom/installColumnResize.ts`.

## 2. Табы контента

Определения — `SharedMedia.tsx:44-50`:

```
SHARED_TABS = Media | Files | Links | Music | Voice
ALL_TABS    = Chats, Members, Gifts, …SHARED_TABS   // порядок узлов как в tweb
TAB_FILTER  = Media→media, Files→files, Links→links, Music→music, Voice→voice
```

| Таб | Источник данных | Состояние |
|---|---|---|
| **Chats** (только «Избранное») | `managers.chats.savedDialogs()` → `GET /saved/dialogs`, один RPC без пагинации | **Работает.** Виртуальный список (`DeferredSortedVirtualList`, itemSize 72, `extraPaddingBottom 0`), покрыт `SharedMedia.saved.test.tsx` |
| **Members** (группа/канал) | `useGroupInfo` → `managers.groups.members()` + `managers.peers.getUsers()` | **Работает.** Без пагинации и без live-обновления; клик по роли (если `canManageAdmins`) открывает `RightsEditor` |
| **Gifts** (только приватный чат) | `managers.stars.profileGifts(userId)` → `GET /users/{id}/gifts` | **Работает.** Пустое состояние с кнопкой «Send a Gift». Витрина на портированных модулях tweb (`stargiftsGrid.module.scss`, `profileList.module.scss`). Нет tweb-меню «view as» |
| **Media** | `managers.messages.mediaHistory(chatId,'media',offset,30)` → `GET /chats/{id}/media?filter=…` | **Работает** + infinite scroll + просмотрщик (`openMediaViewer`) |
| **Files** | тот же RPC, `filter=files` | **Работает.** Строка `.document` (вендорный `_document.scss`); **клика/скачивания нет** — строка не интерактивна |
| **Links** | `filter=links` | **Работает частично.** URL парсится из текста клиентом (`firstUrl`), превью-квадрат = первая буква хоста (нет web-page превью); клик → `window.open` |
| **Music** | `filter=music` | **Работает.** Очередь в `audioStore.playQueue`, глиф play/pause; прогресса в строке нет |
| **Voice** | `filter=voice` | **Работает.** + `markMediaPlayed` для чужих непрослушанных; **волновой формы нет** |
| Stories / Saved-in-chat / Common groups / Similar channels | — | **Отсутствуют** (есть в tweb `mediaTabs`) |

**Логика видимости и переключения:**

- Тоталы всех 5 медиа-фильтров грузятся одним параллельным пакетом при открытии (`:128-139`, `mediaHistory(…, 0, 1)` ради `count`) — пустые табы прячутся (`:266`).
- `tabOrder` собирается как `[Chats|Members] + [Gifts] + непустые медиа` (`:269-273`); если активный таб выпал — авто-переключение на первый (`:276-279`); пустой `tabOrder` → компонент возвращает `null` (`:282`).
- Скрытые табы **остаются в DOM** с классом `hide` (как в tweb) — `:304-312`.
- Начальный таб выбирается в `UserInfoPanel.tsx:65`: группа → `Members`, saved → `Chats`, иначе `Media`.

**Анимации:** таб-ряд — вендорный `.menu-horizontal-div-item` с `i.menu-horizontal-div-item-background` (подчёркивание/пилюля из CSS tweb) + ripple. Контент — `TabSlide` (`shared/ui/Tabs/TabSlide.tsx`, порт `TransitionSlider type:'tabs'`): оба кадра в DOM, инлайновые `translate3d(∓width)`, reflow, `transitionend` + фолбэк-таймер `200+100 ms`, `backwards` по индексу в `order`. **`keepMounted` НЕ передаётся** → уходящий таб размонтируется (состояние DOM таба, включая позицию, теряется; данные переживают в `byFilter` родителя).

**Загрузка контента (`:154-211`):** `loadPage` — offset-пагинация по 30, мьютекс `loadingRef` (порт `loadMutex`), поколение `genRef` для отбрасывания протухших ответов, `hasMore = messages.length>0 && msgs.length<count`. Догрузка — `IntersectionObserver` на sentinel c `rootMargin: 300px` (порт `Scrollable.onScrollOffset`), root ищется подъёмом по `overflowY` до реального скроллера панели.

## 3. Навигация внутри колонки и анимации переходов

**Стека экранов как в tweb нет.** Вместо `SidebarSlider` — четыре условно отрендеренных узла внутри `.sidebar-content.sidebar-slider.tabs-container` (`UserInfoPanel.tsx:738-771`):

| Экран | Как открывается | Анимация входа |
|---|---|---|
| `GroupEditFlow` (edit chat) | `setEditing(true)` (карандаш в шапке) | **Есть** — `SettingsScreen` сам себе `tabs-container[data-animation="navigation"]`, въезд `translate3d(100%)→0` (`settings/kit.tsx:75-86`, класс `s.entering`) |
| `AddMembersScreen` | FAB / `setAddingMembers` | **Есть** (тот же `SettingsScreen`) |
| `ChannelStats` | строка «Statistics» | **Нет.** Голый `div.tabs-tab…statistics-container.active` — классов `.statistics-container` в SCSS вообще нет, контейнер-родитель без `data-animation` → появляется мгновенно |
| `RightsEditor` | клик по роли участника | **Нет** (то же самое, `.user-permissions-container` без стилей) |

Внутри `GroupEditFlow` — настоящий второй уровень: проп `sub` (`:106-117`), 9 подэкранов (type / links / reactions / discussion / permissions / admins / members / banned / restricted), переход играет `core/dom/navigationTransition.ts` (параллакс уходящего `-25%` + `brightness(80%)`, порт `slideNavigation`).

«Изменить контакт» — **вне колонки**: `onEditContact` сначала закрывает панель (`Chat.tsx:1592`) и открывает отдельную док-панель `EditContactView` (404px, `AddContactView.module.scss`). В tweb это вкладка того же слайдера.

**Шапка:** X ⇄ «назад» — не подмена иконки, а `.animated-close-icon.state-back` (CSS-морф полосок). Заголовок «User Info» ⇄ «имя + счётчик» — `useTransitionSlider` (`core/hooks/useTransitionSlider.ts`, порт `TransitionSlider` с классами `active/from/to` + `animating/backwards`, 400 мс, гейт `liteMode.isAvailable('animations')`).

## 4. Скролл-поведение

- Скроллится **вся панель целиком** одним контейнером `.scrollable.scrollable-y` (`UserInfoPanel.tsx:402`): шапка-аватар, инфо-карточка, секции и шаред-медиа — один поток. Таб-ряд `sticky` внутри него; виртуальный список «Избранного» получает **тот же** скроллер (`SharedMedia.tsx:648-651`, `ul.closest('.scrollable-y')`) — как в tweb.
- `.sidebar-header` — `position: absolute; z-index: 3` поверх контента (`_profile.scss:598-628`); прозрачная с белыми иконками над фото (`need-white`), заливка приходит с `header-filled`.
- `onBodyScroll` (`:123-135`): `scrollTop > 4` сворачивает развёрнутое фото; порог заголовка — `top <= 56+16+16 = 88` 1:1 с tweb; `filled` двусторонний, `headerFilled` **только взводится** (снимает его лишь клик по «назад» — `scrollBackToProfile`, `:137-140`, `scrollTo({top:0,behavior:'smooth'})`).
- `onBodyWheel` (`:144-148`) — порт `useCollapsable.onMove`: колесо вверх при `scrollTop===0` разворачивает шапку, вниз — сворачивает.
- Свой `Scrollable`-инстанс здесь НЕ создаётся (по инварианту проекта единственный владелец — `useChatScroll`); классы `scrollable scrollable-y` — визуальный слепок.

## 5. Стили

**Своих SCSS-модулей у правой колонки практически не осталось** — переведено на глобальные классы tweb (коммиты `a17b63b5`, `153fcf37`, `d1eed1f9`, `dc91b51a`, `095c3f6f`; `UserInfoPanel.module.scss` и `SharedMedia.module.scss` удалены, факт запинен текстовым тестом `UserInfoPanel.shell.test.ts`).

Используемые партиалы: `styles/tweb/_profile.scss` (1094), `_rightSidebar.scss` (570, в т.ч. `.shared-media-container` :86-130 и `--super-offset: 4.5rem`), `_searchSuper.scss` (428), `_sidebar.scss`, `_scrollable.scss`, `_slider.scss`, `_transition.scss`, `_row.scss`, `_section.scss`, `_document.scss`, `_audio.scss`, `_chatlist.scss`, `_chatlistRow.scss`, `_animatedIcon.scss`, `_button.scss`, `_ripple.scss`.

Остаточные CSS-модули в периметре:

- `components/stargifts/stargiftsGrid.module.scss` + `profileList.module.scss` — **это модули самого tweb**, портированы дословно (там подарки тоже модулями);
- `settings/kit.module.scss` — два правила (`screen`, `entering`), обосновано комментарием: у нас экран монтируется слоем поверх колонки, а не вкладкой постоянного слайдера;
- `rightSidebar/RightSearchTab.module.scss` — только геометрия панели;
- `AddContactView.module.scss` — док-панели контактов.

Инлайн-стили (отсебятина, не по tweb): `PinnedStoriesSection.tsx:16-45` (грид историй целиком на инлайне), `ChannelStats.tsx:73,138-141` (топ-посты, лоадер), `SharedMedia.tsx:258` (пустое состояние).

## 6. Состояние: что где

**Zustand (глобально):**

- `chatsStore` — `meId`, `me`, `presence[peerId]` (онлайн-статус в подзаголовке, `UserInfoPanel.tsx:161-169`), `dialogs[].muted` (через `useMuteToggle`).
- `messagesStore` — только длина окна чата (`SharedMedia.tsx:146`) как сигнал инвалидации кэша табов.
- `peersStore` — карточки пиров для имён авторов во вьювере (`SharedMedia.tsx:245`).
- `audioStore` — очередь/трек/играет для Music/Voice.
- `popupStore` — GiftInfo/QR/KeyVerification/EditContact.

**Локальный `useState` (панель):** `tab`, `expanded`, `filled`, `headerFilled`, `photoIndex`, `dragDx/dragging`, `tabCounts`, `editing`, `addingMembers`, `showStats`, `qrOpen`, `keyPopupOpen`, `selectedGift`.

**ViewModel-хуки (эфемерные серверные данные, не в сторах):** `useGroupInfo` (card/members/invites/joinRequests/права), `useUserProfile`, `useSavedDialogs`, `useProfileGifts`, `useProfilePhotos`, `usePinnedStories`, `useChannelStats`, локальный `byFilter`/`totals` в `SharedMedia`.

**Воркер (managers через `useManagers` → SuperMessagePort RPC):**

| Вызов | REST |
|---|---|
| `messages.mediaHistory(chatId, filter, offset, limit)` | `GET /chats/{id}/media?filter&offset&limit` (`messagesManager.ts:411-414`) |
| `groups.card / members / listInvites / createInvite / listJoinRequests / approveRequest / declineRequest / promoteAdmin / demoteAdmin / setMute / setForum` | `groupsManager.ts:177,263,267,270,279,303,…` |
| `channels.enableDiscussion` | `POST /channels/{id}/discussion` |
| `chats.savedDialogs()` | `GET /saved/dialogs` |
| `privacy.profile(userId)` | `GET /users/{id}` (конфиденциальность применена на сервере) |
| `stars.profileGifts(userId)` | `GET /users/{id}/gifts` |
| `profile.listPhotos(userId)` | `GET /users/{id}/photos` |
| `media.downloadMediaURL(id)` / `media.contentUrl(id)` | воркерный конвейер картинок / токен-URL для видео-аватара |
| `stories.pinnedStories(peerId)`, `stats.getChannelStats(chatId)`, `peers.getUsers(ids)` | — |

Реалтайма у панели почти нет: единственный live-канал — рост окна сообщений (`winLen`) как триггер инвалидации; счётчики участников/подарков/медиа сами не обновляются.

## 7. Костыли, TODO, недоделки

**Найденные в коде расхождения/подозрения (по убыванию значимости):**

1. **`stickyTop={TAB_GAP}` = 8px перебивает портированный CSS.** `SharedMedia.tsx:300` ставит инлайновый `style={{ top: 8 }}` на `.search-super-tabs-scrollable`, у которого CSS уже даёт правильный `top: var(--super-offset)` = `3.5rem + 1rem = 72px` (`_rightSidebar.scss:87-91`, `_searchSuper.scss:19-24`). Инлайн выигрывает → липкий таб-ряд прилипает на 8px от верха скроллера, то есть **под absolute-шапку** (`z-index` 2 против 3). `TAB_GAP` и его комментарий в `helpers.ts:43-45` («TabsBar gap») — остаток от снесённой самописной `TabsBar`. Ровно этот пункт был помечен P1 в `docs/research/2026-08-08-tweb-deep-structural-audit.md` и не закрыт.
2. **Устаревший комментарий-ложь:** `UserInfoPanel.tsx:666-667` — «Контент пока моковый — реального API истории по типам ещё нет», хотя `mediaHistory` реализован и работает.
3. **Инвалидация кэша шаред-медиа слишком широкая:** `SharedMedia.tsx:146-151` сбрасывает **весь** `byFilter` на любое изменение длины окна сообщений — включая подгрузку старых сообщений при скролле чата. Все накопленные страницы infinite scroll теряются и таб перезагружается с offset 0.
4. **Нет сброса состояния панели при смене чата.** Панель не размонтируется (`infoMounted`), `key` не задан (`Chat.tsx:1586`), а при смене `chat` не сбрасываются: `scrollTop` тела, `tabCounts` (`:151`), `filled/headerFilled`, `expanded`. Сбрасывается только `photoIndex` (`:185`). Итог: открыв профиль другого пира, можно увидеть чужой счётчик в шапке и старую позицию скролла.
5. **`ChannelStats` и `RightsEditor` появляются без анимации** — комментарий `UserInfoPanel.tsx:736-737` («въезд справа играет CSS самого экрана») для них неверен: классов `.statistics-container` / `.user-permissions-container` в `styles/` нет вообще, а родительский `.tabs-container` без `data-animation`.
6. **`RightsEditor` восстанавливает битовую маску эвристикой:** `RightsEditor.tsx:37-39` — если роль admin/creator, ставит **все** биты (реальные права участника с сервера не приходят). Сохранение перетрёт фактические права.
7. **Ручные `alive`-флаги** вместо `@helpers/middleware`, что запрещено CLAUDE.md для нового кода: `useGroupInfo.ts:116,159,171`, `useUserProfileData.ts:28,76-104`, `usePinnedStories.ts:10`, `useChannelStats.ts:18`, `SharedMedia.tsx:130-138`. Плюс `useProfileGifts` (`useUserProfileData.ts:48-56`) вообще без защиты от гонки + `eslint-disable exhaustive-deps`.
8. **`refreshMembers` (`useGroupInfo.ts:177-189`) теряет поля** `username`/`avatarUrl`, которые заполняет первичная загрузка (`:160-169`) — после одобрения заявки у строк участников пропадают аватарки.
9. **Хардкод русских строк мимо i18n:** `helpers.ts:14-35` (`countLabel`, `membersLabel`, `chatsLabel`), `useGroupInfo.ts:11-20` (`RIGHTS[].label`), `:46-50` (`roleLabel`), `GroupEditFlow.tsx:209` («Обсуждения»).
10. **`getComputedStyle` в цикле по предкам** на каждый пересчёт sentinel-обсервера (`SharedMedia.tsx:199-201`) — вместо явного рефа на скроллер.
11. **Незавершённость относительно tweb (см. `2026-08-07-frontend-tweb-parity-audit.md` §5.1-5.2):** нет табов Stories / Saved / Common groups / Similar channels; нет ⋮-меню шапки; нет вложенного `slide-fade` у счётчика в подзаголовке (у нас просто текст, `UserInfoPanel.tsx:390-392`); нет `profile-avatars-avatar-fake` / `has-stories` / progress-fill сегмента у видео-аватара; нет Location/Business/PersonalChannel/ContactNote/доп. usernames; нет контекст-меню строк; нет selection-режима шаред-медиа; строки Files не кликабельны; у Links нет реального превью web-page.
12. **Дыры в тестах:** покрыты только каркас разметки (`UserInfoPanel.shell.test.ts` — текстовый пин классов) и «Избранное» (`SharedMedia.saved.test.tsx`). Пагинация медиа-табов, порог `header-filled`, карусель аватаров, `useGroupInfo`, `RightsEditor`, `ChannelStats`, `GroupEditFlow` — без тестов.
13. Единственный `костыль`-комментарий в SCSS — вендорный, унаследован от tweb: `_profile.scss:778`.

**Что, наоборот, уже закрыто** (старые P0 из аудита `2026-08-08` неактуальны): панель на `transform` и постоянно смонтирована; морф аватара одним DOM через `is-collapsed`; infinite scroll в шаред-медиа; кликабельные Phone/Username/Bio с тостом; `animated-close-icon` морф; порог `header-filled` = 88; framer-motion и CSS-модули колонки убраны.

---

# Выводы (сводка для выбора стратегии)

1. **У tweb правая колонка — платформа** (`SidebarSlider` + `SliderSuperTab`: стек из ~25 экранов с общим шеллом, lifecycle и анимациями), **у нас — один компонент** с условными оверлеями; `ChannelStats`/`RightsEditor` без стилей и анимаций, `EditContact` вне колонки.
2. **Различия user/group/channel в tweb декларативные** — секции `PeerProfile` и предикаты `canView*` в `SearchSuper`; у нас — форки по `chat.type`, размазанные по панели.
3. **Точечные фиксы конфликтуют**, потому что нет каркаса-эталона: инлайновый `stickyTop=8` перебивает верный портированный CSS; кэш табов сбрасывается на любое изменение окна сообщений; состояние панели не сбрасывается при смене чата; `TabSlide` без `keepMounted` теряет скролл-позиции (tweb сохраняет/восстанавливает их в `onTransitionEnd`).
4. **Стили уже портированы глобально** (`styles/tweb/`), т.е. недостающее — поведенческий каркас, а не CSS.
