# Левый сайдбар tweb: архитектурный референс по исходникам

Снято 2026-08-16. Источники:

- исходники tweb `/Users/denisurevic/Documents/tweb` (пути ниже — от корня репозитория tweb);
- наш код `web-client/` на `main` (часть 8).

> Это карта **исходников**. Живые DOM-дампы левой колонки (реальные деревья узлов со стенда) —
> в [`dom/left-sidebar.md`](dom/left-sidebar.md), здесь не дублируются.
> Инфраструктура слайдера (`SidebarSlider` / `SliderSuperTab` / `TransitionSlider` / scaffold Solid-табов)
> подробно разобрана в [`right-sidebar.md`](right-sidebar.md) §1 —
> левая колонка использует ровно те же классы, ниже только отличия.

> Важно: локальный tweb — форк. Ключевые отличия от апстрима, влияющие на левую колонку:
> (1) почти все табы переписаны на Solid через `scaffoldSolidJSTab`; (2) чатлист **виртуализован**
> (`deferredSortedVirtualList`), классы `Some/Some1/Some2` апстрима вынесены в `components/autonomousDialogList/*`;
> (3) появилась вертикальная колонка папок `#folders-sidebar` (настройка «папки слева»).

Документ из восьми частей:

1. `AppSidebarLeft` — каркас, первый таб, collapsed/floating, папки.
2. Полный перечень табов `sidebarLeft/tabs/*` + дерево настроек.
3. Бургер-меню.
4. Глобальный поиск.
5. Чатлист (`appDialogsManager` + виртуальный список).
6. Сторис-лента.
7. Анимации.
8. У нас (`web-client/`) — карта и расхождения.

---

# Часть 1. `AppSidebarLeft` — каркас левой колонки

## 0. Карта файлов (верхний уровень)

| Путь | Роль |
|---|---|
| `index.html:89-107` | статический скелет `#column-left` (единственный HTML-объявленный таб `.item-main`) |
| `src/components/sidebarLeft/index.ts` | `AppSidebarLeft extends SidebarSlider` (стр. 111), singleton (стр. 1656-1658) |
| `src/components/slider.ts`, `src/components/sliderTab.ts` | база слайдера/табов — см. right-sidebar §1.1–1.2 |
| `src/components/solidJsTabs/*` | scaffold-фабрики Solid-табов + реестр конструкторов `tabs.ts` |
| `src/components/sidebarLeft/tabs/*` | все табы (часть 2) |
| `src/components/sidebarLeft/foldersSidebarContent/*` | вертикальная колонка папок (форк) |
| `src/stores/folders.ts`, `src/stores/foldersSidebar.ts` | Solid-сторы: список папок + сигналы состояния колонки |
| `src/lib/appDialogsManager.ts` | чатлист (часть 5) |
| `src/components/appSearchSuper.ts`, `src/components/inputSearch.ts`, `src/components/searchGroup.tsx` | глобальный поиск (часть 4) |
| `src/components/sidebarLeft/settingsSliderPopup.ts` | `SettingsSliderPopup` — настройки попапом при свёрнутом сайдбаре |
| `src/components/sidebarLeft/lockButton.tsx`, `emojiStatusPicker.tsx` | кнопки в шапке (замок passcode, emoji-статус) |

## 1. Статический скелет (`index.html:89-107`)

```
div#column-left.tabs-tab.chatlist-container.sidebar.sidebar-left.main-column.sidebar-left-common
└ div.sidebar-slider.tabs-container                      ← tabsContainer слайдера
  └ div.tabs-tab.sidebar-slider-item.item-main.active    ← ПЕРВЫЙ таб (чатлист), единственный из HTML
    ├ div.sidebar-header.main-search-sidebar-header.can-have-forum
    │ └ div.sidebar-header__btn-container.left-sidebar-burger
    │   ├ div.animated-menu-icon                         ← морф бургер↔назад (часть 7)
    │   └ div.btn-icon.sidebar-back-button               ← backBtn
    └ div.sidebar-content.transition.zoom-fade.can-have-forum
      ├ div.transition-item.active#chatlist-container    ← id 0 транзишена
      │ └ div.tabs-container#folders-container           ← сюда appDialogsManager кладёт контейнеры папок
      └ div.transition-item.sidebar-search#search-container ← id 1 (поиск)
```

Все остальные табы (settings, contacts, архив…) создаются в рантайме `SliderSuperTab._constructor()`
и получают маркер `item-secondary` в override `addTab` (`sidebarLeft/index.ts:1606-1611`).

## 2. Конструктор и `construct()`

`constructor()` (стр. 140-145): `super({sidebarEl: #column-left, navigationType: 'left'})` — тот же
`SidebarSlider`, что справа, но записи навигации имеют тип `'left'`.

`construct(managers)` (стр. 147-442), по шагам:

| Шаг | Стр. | Что делает |
|---|---|---|
| `chatListContainer = #chatlist-container` | 150 | |
| `inputSearch = new InputSearch({oldStyle: true})`, placeholder `' '`, append в `.item-main .sidebar-header` | 151-154 | плейсхолдером владеет `ConnectionStatusComponent` (часть 4 §1) |
| `toolsBtn = createToolsMenu()` + класс `sidebar-tools-button`, бейдж `sidebar-tools-button-notifications` (уведомления других аккаунтов) | 158-164 | вставляется перед `backBtn` (стр. 197) |
| `renderFoldersSidebarContent(#main-columns, …)` | 170-175 | создаёт `#folders-sidebar` первым ребёнком `#main-columns` |
| `notification_count_update` → пересчёт бейджа по всем аккаунтам кроме текущего | 183-195 | |
| `newBtnMenu = createNewChatsMenuButton()` → append в `.sidebar-content` | 201-202 | FAB «новый чат» живёт внутри sidebar-content |
| `updateBtn` (`.btn-circle.btn-corner.btn-update.is-hidden`) + клик → `appNavigationController.reload()` | 204-218 | показывается, когда `fetch('version')` раз в 30 мин (`CHECK_UPDATE_INTERVAL = 1800e3`, стр. 341-357) видит новую версию |
| ленивый бутстрап поиска: `inputSearch.input focus {once} → initSearch()` | 220 | |
| `archivedCount` (бейдж 24 gray) + `folder_unread` для `FOLDER_ID_ARCHIVE` | 222-231 | бейдж аппендится в пункт «Archived Chats» при открытии меню (стр. 850) |
| emoji-статус (`statusBtnIcon`, только premium): `wrapStatus`/`fireAroundAnimation`, `emoji_status_change` | 233-316 | клик → `openEmojiStatusPicker` (стр. 239-247) |
| `lockButton = createLockButton()` (замок passcode) | 237 | |
| `toggleRightButtons(isPremium, isUsingPasscode)` — append/remove статус-кнопки и замка, класс `is-input-the-last-child` | 318-326 | триггеры: `premium_toggle` (стр. 328), `toggle_using_passcode` (стр. 329-331) |
| префетч `getTopPeers('correspondents')` | 336 | для группы «people» в поиске |
| `initNavigation()` | 338 | см. ниже |
| `onResize` → `rect = tabsContainer.getBoundingClientRect()` + `updateColumnWidths()` | 359-364 | |
| `searchTriggerWhenCollapsed` (`.sidebar-header-search-trigger` + `ButtonIcon('search')`) | 367-391 | видимость через Solid-эффект: `hasFoldersSidebar && isCollapsed && !hasOpenLeftTabs` |
| Solid-эффект морфа бургера (часть 7 §3) | 408-418 | |
| `.sidebar-left-overlay` click → `closeEverythingInside()` | 420-423 | |
| `initSidebarResize()` + `appDialogsManager.onSomeDrawerToggle` | 425-428 | |
| хоткеи: `ctrl/alt/meta+f` → `initSearch().open()`; `ctrl/meta+0` → Saved Messages | 430-441 | |

`initNavigation()` (стр. 447-462): постоянный navigation-item `'global-search-focus'` с `noHistory: true`,
`onPop` открывает поиск — т.е. **Escape при закрытом поиске фокусирует поле поиска**.

## 3. Collapsed / floating / has-open-tabs

| Метод | Стр. | Поведение |
|---|---|---|
| `isCollapsed()` | 464-470 | в диапазоне `isLessThanFloatingLeftSidebar` (≤925px) всегда `false`; иначе класс `is-collapsed` на `#column-left` (запомненное предпочтение) |
| `hasFoldersSidebar()` | 472-474 | `body.has-folders-sidebar` |
| `onCollapsedChange(canShowCtrlFTip)` | 476-488 | `fade`/`zoom-fade` на родителе чатлиста, `xd.toggleAvatarUnreadBadges` (бейджи переезжают на аватар), подсказка Ctrl+F (`showCtrlFTip`, стр. 602-615, повтор раз в 1 нед–2 мес), `resizeStoriesList` |
| `hasSomethingOpenInside()` | 490-492 | `hasTabsInNavigation() \|\| isSearchActive \|\| appDialogsManager.forumTab` |
| `closeEverythingInside()` | 494-499 | `closeSearch()` + `toggleForumTab()` + `closeAllTabs()` |
| `closeEverythingInsideNaturally()` | 505-516 | то же, но табы закрываются «через стрелку назад», уважая `isConfirmationNeededOnClose`; `false` — если пользователь отказался |
| `onSomethingOpenInsideChange(force)` | 519-600 | классы `has-open-tabs` / `has-real-tabs` / `has-forum-open` на `#column-left`, сигнал `useHasOpenLeftTabs`, `setOpenTabsLeftSidebar`. Свёрнутый сайдбар «всплывает» до полной ширины, пока внутри что-то открыто: ширину анимирует CSS, JS лишь держит вспомогательные классы `force-hide-large-content` / `force-hide-menu` / `force-hide-search` / `force-chatlist-thin` (открытие) и `force-fixed` / `hide-add-folders` (закрытие) на `ANIMATION_TIME 200 + DELAY 150` мс |
| `initSidebarResize()` | 617-637 | `installColumnResize({side:'left', isCollapsed, setCollapsed → useIsSidebarCollapsed, preventCollapse: hasSomethingOpenInside, onSwipeTick: adjustChatPatternBackground})` — ручка-резайзер с drag-to-collapse |

## 4. `createTab` override и попап настроек

`createTab(ctor)` (стр. 1587-1599): если сайдбар свёрнут (и не floating), а `ctor ∈
{AppSettingsTab, AppEditFolderTab, AppChatFoldersTab}` — таб открывается **не в колонке, а в попапе**:
`new SettingsSliderPopup(managers)` (`sidebarLeft/settingsSliderPopup.ts:13-51`) — `PopupElement`,
внутри которого живёт собственный `SettingsSlider extends SidebarSlider` (`navigationType: 'settings-popup'`);
`onTabsCountChange` при пустом стеке закрывает попап (стр. 44-47).

## 5. Табы фолдеров: горизонтальные vs вертикальные

Две реализации, **один источник правды** — Solid-стор `src/stores/folders.ts`:

- `useFoldersStore` (стр. 53-218): `selectedFolderId`, `folderItems: StoredFolder[]` (`{id, notifications:{count,muted}, chatsCount, filter}`), `hydrateFilters` (стр. 156-167), сортировка по `filter.localId` (стр. 47-50);
- счётчик таба: `getNotificationCountForFilter` (стр. 19-30) — для «Все чаты» `unreadUnmutedCount`, для остальных `unreadCount`; `muted`, если все непрочитанные замьючены и без меншенов;
- подписки (стр. 169-207): `dialog_flush`, `folder_unread`, `filter_update`, `filter_delete`, `filter_order`, `filter_joined` (переключение на новую папку), `premium_toggle` (сброс на ALL, если папка стала недоступна);
- `onClick`-сигнал (стр. 58-63): сюда `appDialogsManager` кладёт свой `selectTab` (см. часть 5 §8), и обе панели переключают папку через него.

**Горизонтальные табы** — компонент `src/components/foldersTabs.tsx`, рендерится `appDialogsManager`'ом
в `.chatlist-overlay` над списком (часть 5 §8). **Вертикальная колонка** —
`src/components/sidebarLeft/foldersSidebarContent/index.tsx`:

- `renderFoldersSidebarContent` (стр. 215-242) создаёт `#folders-sidebar.folders-sidebar.sidebar-left-common` и рендерит `<Show when={hasFoldersSidebar()}>`;
- содержимое (стр. 134-212): фон-зеркало градиента чата (canvas, `attachMirror`, стр. 100-110) → верхний `FolderItem` c иконкой `menu` (на него монтируется **то же бургер-меню**: `appSidebarLeft.createToolsMenu(target, {top:8,left:48})`, стр. 75-81) → `Scrollable` со списком `FolderItem` → плавающая кнопка «+ добавить чаты» для пустой папки (стр. 180-194) → нижний `FolderItem` `equalizer` → `AppChatFoldersTab` (стр. 197-210);
- клик по папке (стр. 64-73): `useFolders().onClick()(index)` + `closeEverythingInside()`;
- контекстное меню папки — общий `createFolderContextMenu` (`helpers/dom/createFolderContextMenu.ts`, открывает `AppEditFolderTab:29` / `AppChatFoldersTab:47`).

**Выбор режима** — `src/stores/foldersSidebar.ts`:
`useHasFoldersSidebar` (сырое предпочтение, стр. 11-18), `useFoldersSidebarShown` (гейт по ширине ≤925px,
ведёт `body.has-folders-sidebar`, стр. 25-41), `useIsSidebarCollapsed` (стр. 52-59), `useHasOpenLeftTabs`
(стр. 67-74), `useIsLeftSearchActive` (стр. 81-88). Итоговый эффект (стр. 90-112):
`body.has-horizontal-folders` = есть папки ∧ (не collapsed ∨ узкий экран) ∧ панель не показана;
`body.has-vertical-folders` — инверсия.

## 6. Archived — как открывается

Архив — **не таб фолдера** (ранний выход в `addFilter`, `appDialogsManager.ts:1251-1253`), а:
1) закреплённая строка «Архив» в чатлисте (часть 5 §10) и пункт бургер-меню;
2) отдельный таб слайдера `AppArchivedTab`: `openArchiveTab()` (`sidebarLeft/index.ts:1618-1622`) →
`closeTabsBefore` → `createTab(AppArchivedTab).open()`. Таб (`tabs/archivedTab.tsx`) переиспользует
машинерию чатлиста: `appDialogsManager.l({id: FOLDER_ID_ARCHIVE})` (стр. 85-92), подменяет scrollable на свой
(стр. 102-103), `setFilterIdAndChangeTab(FOLDER_ID_ARCHIVE)` (стр. 107); при закрытии возвращает прежний
`filterId` (стр. 63-67) и уничтожает список (стр. 69-75). Сверху — своя сторис-лента архива (стр. 26-45).

---

# Часть 2. Полный перечень табов `sidebarLeft/tabs/*`

## 0. Модель scaffold (форк)

«Класс таба» не живёт в файле таба. Конструкторы объявлены централизованно в
`src/components/solidJsTabs/tabs.ts` фабриками:

- `scaffoldSolidJSTab<Payload>({title, getComponentModule, onOpen*/onClose*})` → `solidJsTabs/scaffoldSolidJSTab.tsx:26` (внутри `return class extends SliderSuperTab` — стр. 33);
- `scaffoldSolidJSTabEventable<Payload, Events>` → `scaffoldSolidJSTab.tsx:98` (`extends SliderSuperTabEventable` — стр. 103; нужен табам, сохраняющим настройки на `destroy`).

Файл в `tabs/` экспортирует **default Solid-компонент**, скаффолд лениво грузит его через
`getComponentModule: () => import(...)`; доступ к инстансу таба изнутри — `useSuperTab()`
(`solidJsTabs/superTabProvider.tsx`). Реестр «провайдимых» табов (разрыв циклов импортов) —
`solidJsTabs/providedTabs.ts`. **Единственный классический `SliderSuperTab`** в левом сайдбаре —
`changeLoginEmail.tsx` (2 класса).

## 1. Таблица табов

Формат «кто открывает» — file:line вызова `createTab(...).open(...)`.

### Корень и основные

| Файл (`tabs/…`) | Конструктор (`solidJsTabs/tabs.ts`) | Назначение | Кто открывает |
|---|---|---|---|
| `settings.tsx` (комп. :82) | `AppSettingsTab` = `scaffoldSolidJSTab` :169-173 | корневой экран настроек | `sidebarLeft/index.ts:722` (меню), `:797` (клик по своему аккаунту), `lib/internalLinkProcessor.ts:723`; `sliceTabsUntilTab(AppSettingsTab)` из 2fa/email-флоу (`2fa/index.tsx:34`, `2fa/passwordSet.tsx:23`, `2fa/emailConfirmation.tsx:44`, `2fa/forgotPasswordLink.ts:108`, `changeLoginEmail.tsx:30`) |
| `generalSettings.tsx` :359 (812502980) | `AppGeneralSettingsTab` :160-164 (812502980) | размер текста, фон, тема, lite mode | `settings.tsx:255` (812502980); у нас — `sidebarLeft/tabs/generalSettings.solid.tsx` (задача 13 плана 2D) |
| `notifications.tsx` :543 (812502980) | `AppNotificationsTab` :77-81 (812502980) | уведомления | `settings.tsx:252` (812502980) |
| `privacyAndSecurity.tsx` :760 | `AppPrivacyAndSecurityTab` = Eventable :533-537 (+`getInitArgs` :541) | хаб приватности | `settings.tsx:128→137`; `sliceTabsUntilTab` из `2fa/forgotPasswordLink.ts:103`, `tabs.ts:27-30` |
| `dataAndStorage/index.tsx` :52 (812502980) | `AppDataAndStorageTab` = Eventable :439-443 (812502980) | данные и хранилище | `settings.tsx:127→137` |
| `chatFolders.tsx` :356 | `AppChatFoldersTab` :612-621 (+`getInitArgs`) | список папок | `settings.tsx:130→137`; `foldersSidebarContent/index.tsx:204`; `createFolderContextMenu.ts:47` |
| `editFolder.tsx` :715 | `AppEditFolderTab` :630-642 (+`getInitArgs`, `deleteFolder`) | редактор папки | `chatFolders.tsx:110` (edit) / `:334` (new); `appDialogsManager.ts:1426`; `createFolderContextMenu.ts:29` |
| `includedChats.tsx` :274 | `AppIncludedChatsTab` :489-493 (title по `type`) | included/excluded чаты папки | `editFolder.tsx:420` (included), `:424` (excluded) |
| `sharedFolder.tsx` :329 | `AppSharedFolderTab` = Eventable :500-510 | chatlist-инвайт папки | `editFolder.tsx:686` |
| `archivedTab.tsx` :116 | `AppArchivedTab` :666-679 | архив чатов | `sidebarLeft/index.ts:1620` |
| `archiveSettingsTab.tsx` :18 | `AppArchiveSettingsTab` :135-139 | настройки архива | `archiveDialogContextMenu.ts:91,131` |
| `contacts.tsx` :126 | `AppContactsTab` :190-197 (`noSame` :198) | контакты | `sidebarLeft/index.ts:661` (меню), `:1039` (new private chat), `internalLinkProcessor.ts:709,771` |
| `addMembers.tsx` :14 (812502980) | `AppAddMembersTab` :1054-1058 (`noSame` :1059, заголовок из нагрузки :1060-1063; 812502980) | универсальный селектор пиров (`appSelectPeers.tsx`); у нас — `sidebarLeft/tabs/addMembers.solid.tsx` (план 2D, задача 16) | `addChatUsers.ts:215`, `privacySection.tsx:189`, `createNewGroupTab.ts:6`, `privacy/messages/paidSettingsSection.tsx:26`, `chatAutomation.tsx:537` (812502980) |
| `createNewGroupTab.ts` :5 | функция-обёртка (не таб) | флоу «новая группа»: AddMembers → NewGroup | `sidebarLeft/index.ts:1033`, `internalLinkProcessor.ts:707` |
| `newGroup.tsx` :267 | `AppNewGroupTab` :246-250 (`noSame`) | финальный шаг создания группы | `createNewGroupTab.ts:9` (`takeOut`), `sidebarRight/tabs/chatDiscussion.tsx:56` |
| `newChannel.tsx` :101 | `AppNewChannelTab` :222-226 (`noSame`) | создание канала | `sidebarLeft/index.ts:1048`, `internalLinkProcessor.ts:705` |
| `editProfile.tsx` :63 | `AppEditProfileTab` :86-90 (+префетч :78-84, `noSame`) | редактирование профиля | `settings.tsx:115` (кнопка edit), `internalLinkProcessor.ts:730` |
| `myStories.tsx` :161 | `AppMyStoriesTab` :657-663 (+`getInitArgs`; title по `isArchive`) | свои истории / архив историй | `sidebarLeft/index.ts:707` (меню), `stories/list.tsx:356,363`, `stories/profileList.tsx:804`, `internalLinkProcessor.ts:1313`, `myStories.tsx:40` |
| `language.tsx` :176 | `AppLanguageTab` :155-159 | язык | `settings.tsx:252` |
| `keyboardShortcuts.tsx` :279 (812502980) | `AppKeyboardShortcutsTab` :113-117 (812502980) | горячие клавиши | `settings.tsx:413` (812502980) |
| `speakersAndCamera.tsx` :29 | `AppSpeakersAndCameraTab` :162-166 | аудио/видео-устройства | `settings.tsx:132→137` |
| `powerSaving.tsx` :122 | `AppPowerSavingTab` :201-205 | lite mode | `generalSettings.tsx:89`, `sidebarLeft/index.ts:909` (More-подменю) |
| `stickersAndEmoji.tsx` :307 | `AppStickersAndEmojiTab` :183-187 | стикеры и эмодзи | `settings.tsx:131→137` |
| `quickReaction.tsx` :72 | `AppQuickReactionTab` :176-180 | реакция двойного тапа | `stickersAndEmoji.tsx:91` |
| `background.tsx` — таб :561, плюс **статик-класс** `AppBackgroundTab` :52 (утилиты обоев, НЕ таб) | `AppChatBackgroundTab` :148-152 | обои чата | таб: `generalSettings.tsx:70`; статик: `appImManager.ts:344`, `chatThemesPicker.tsx:171,187`, `themeController.ts:207,670` |
| `backgroundColor.tsx` :168 | `AppBackgroundColorTab` :230-234 | цвет/градиент обоев | `background.tsx:540` |
| `activeSessions.tsx` :177 | `AppActiveSessionsTab` = Eventable :331-335 | активные сессии | `settings.tsx:183` («Devices»), `sidebarLeft/newAuthorization.tsx:118` |
| `activeWebSessions.tsx` :124 | `AppActiveWebSessionsTab` = Eventable :337-341 | веб-сессии | `privacyAndSecurity.tsx:280` |
| `blockedUsers.tsx` :169 | `AppBlockedUsersTab` :212-219 | заблокированные | `privacyAndSecurity.tsx:177` |
| `passkeys.tsx` :131 | `AppPasskeysTab` :118-122 | passkey-ключи | `privacyAndSecurity.tsx:209` |
| `changeLoginEmail.tsx` | **классические** `ChangeLoginEmailTab` :43 и `ChangeLoginEmailCodeTab` :10 (`extends SliderSuperTab`) | смена login-email + код | `privacyAndSecurity.tsx:240`; код — `changeLoginEmail.tsx:56` |
| `inviteLink.ts` :12 | TS-класс `InviteLink` (виджет, не таб) | строка инвайт-ссылки | `sharedFolder.tsx:174`, `sidebarRight/tabs/boosts.tsx:114`, `popups/giftLink.tsx:56` и др. |
| `purchaseUsernameCaption.ts` :6 | helper | подпись «купить username» | `editProfile.tsx:25`, `sidebarRight/tabs/chatType.tsx:22`, `editBot.tsx:10` |
| `editFolderInput/index.tsx` :22 | Solid custom element | поле имени папки с эмодзи | `editFolder.tsx:305` |
| `editFolderShared.ts` | helpers `:8`, `:14` | префетч/удаление папки | `tabs.ts:18,639-640`, `editFolder.tsx:34` |

### `autoDeleteMessages/`

| Файл | Конструктор | Назначение | Кто открывает |
|---|---|---|---|
| `index.tsx` :125 | `AppMessagesAutoDeleteTab` :129-133 | глобальный TTL сообщений | `privacyAndSecurity.tsx:298` |
| `options.ts` | наборы периодов (`:27-87`) | — | таб + `components/autoDeleteIcon.ts` |
| `customTimePopup/index.ts` :16 | `extends PopupElement` (не таб) | произвольный период | `autoDeleteMessages/index.tsx:77`, `chat/chat.ts:1588,1595` |

### `autoDownload/`

| Файл | Конструктор | Назначение | Кто открывает |
|---|---|---|---|
| `autoDownloadTab.tsx` :10 | фабрика-обёртка `autoDownloadTab(build)` | доступ императивного `build()` к табу | photo/video/file |
| `photo.tsx` :4 | `AppAutoDownloadPhotoTab` = Eventable :421-425 (812502980) | авто-загрузка фото | `dataAndStorage/index.tsx:102` (812502980) |
| `video.tsx` :4 | `AppAutoDownloadVideoTab` :427-431 (812502980) | авто-загрузка видео | `dataAndStorage/index.tsx:106` (812502980) |
| `file.tsx` :64 | `AppAutoDownloadFileTab` :433-437 (812502980) | авто-загрузка файлов | `dataAndStorage/index.tsx:110` (812502980) |
| `peerTypeSection.tsx` :10 (812502980) | helper | секция типов пиров | все три |

`dataAndStorage/storageQuota.tsx:237` — Solid-компонент (не таб), монтируется
`dataAndStorage/index.tsx:125` (812502980).

### `privacy/` (все — Eventable, сохранение на `destroy`)

| Файл | Конструктор | Назначение | Открывает `privacyAndSecurity.tsx:` |
|---|---|---|---|
| `privacyTab.tsx` :11 | фабрика-обёртка | — | — |
| `phoneNumber.tsx` :63 | `AppPrivacyPhoneNumberTab` :304-308 | номер телефона | :421 |
| `lastSeen.tsx` :108 | `AppPrivacyLastSeenTab` :314-318 | last seen / online | :430 (через `openTabWithGlobalPrivacy` :404) |
| `profilePhoto.tsx` :152 | `AppPrivacyProfilePhotoTab` :292-296 | фото профиля | :439 |
| `about.tsx` :7 | `AppPrivacyAboutTab` :256-260 | био | :448 |
| `calls.tsx` :8 | `AppPrivacyCallsTab` :262-266 | звонки | :457 |
| `forwardMessages.tsx` :7 | `AppPrivacyForwardMessagesTab` :286-290 | форварды | :466 |
| `addToGroups.tsx` :7 | `AppPrivacyAddToGroupsTab` :274-278 | добавление в группы | :475 |
| `birthday.tsx` :7 | `AppPrivacyBirthdayTab` :280-284 | день рождения | :484; также `popups/birthday.tsx:206` |
| `savedMusic.tsx` :7 | `AppPrivacySavedMusicTab` :298-302 | музыка профиля | :493 |
| `voices.tsx` :9 | `AppPrivacyVoicesTab` :268-272 | голосовые (premium) | :524 |
| `gifts.tsx` :151 | `AppPrivacyGiftsTab` :320-324 | подарки | :502 |
| `messages/tab.tsx` :75 | `AppPrivacyMessagesTab` :53-57 | кто может писать / платные сообщения | :534; внутри открывает `AppAddMembersTab` (`messages/paidSettingsSection.tsx:26`) |

`privacy/messages/*` (optionsSection, paidSettingsSection, starsRangeInput, useSettings, useSaveSettings,
useStateStore и т.д.) — внутренние Solid-компоненты/хуки таба, не табы.

Строки исключений всех этих табов собирает общий `PrivacySection` (`components/privacySection.tsx:171-218`):
`Row.Icon` (person_crossed_filled / adduser) + `Row.Title` (Never/Always Allow|Share) +
`Row.Subtitle` (число пользователей или «Add Users»). **У нас** (план 2D, задача 17) — тот же класс
`components/privacySection.solid.tsx` и вкладки `sidebarLeft/tabs/privacy/*.solid.tsx` (объявления —
блок в конце `solidJsTabs/tabs.ts`, все eventable, запись на `destroy`); открывают их строки React-экрана
`settings/PrivacySecuritySettings.tsx` через `getSettingsSliderHost().openTab` до задачи 23. Исключения —
`AppAddMembersTab` (`type: 'privacy'`, только пользователи — О-17). Нет вкладок Gifts/SavedMusic и секции
P2P (О-16), премиум-замка голосовых (О-34), «публичного фото» (О-35); «Сообщения» — `PrivacySection` по
нашему правилу `messages` вместо `messages/*` (О-15, О-34); своя вкладка `readTime.solid.tsx` на месте
флага `hide_read_marks` (О-18). React `settings/PrivacyRule.tsx` снесён; пины —
`sidebarLeft/tabs/privacy/privacy.solid.test.tsx` («Н…» — счётчик в `Row.Subtitle`, не в `titleRight`).

### `passcodeLock/`

| Файл | Конструктор | Назначение | Кто открывает |
|---|---|---|---|
| `mainTab.tsx` :315 | `AppPasscodeLockTab` `tabs.ts:27-39` (`onOpenAfterTimeout: sliceTabsUntilTab(AppPrivacyAndSecurityTab)`) | вкл/выкл/смена passcode | `privacyAndSecurity.tsx:204,208`; `sliceTabsUntilTab` из `mainTab.tsx:98,221` |
| `enterPasswordTab.tsx` :106 | `AppPasscodeEnterPasswordTab` `tabs.ts:41-53` | ввод/подтверждение passcode | `privacyAndSecurity.tsx:195`; `mainTab.tsx:80,92,203,215` |
| `inlineSelect.tsx` :191, `shortcutBuilder.tsx` :72 | контролы (не табы) | — | `mainTab.tsx:287,306` (inlineSelect также `keyboardShortcuts.tsx:112`) |

У нас (задача 18 плана 2D, адреса выше — по `812502980`): `sidebarLeft/tabs/passcodeLock/
{mainTab,enterPasswordTab,shortcutBuilder}.solid.tsx` — вкладки `AppPasscodeLockTab`/
`AppPasscodeEnterPasswordTab` (`solidJsTabs/tabs.ts`), открывает строка React-экрана
«Конфиденциальность» через хост; срез `onOpenAfterTimeout` — до корня хоста (О-12, до задачи 23).
Сочетание блокировки — `core/hooks/useLockScreenShortcut.ts` (вызов в `App.tsx`).

### `2fa/` (мастер, все — `scaffoldSolidJSTab`)

| Файл | Конструктор | Назначение | Кто открывает |
|---|---|---|---|
| `index.tsx` :95 | `AppTwoStepVerificationTab` :700-704 | управление 2FA | `privacyAndSecurity.tsx:200`, `2fa/enterPassword.tsx:93` |
| `enterPassword.tsx` :178 | `AppTwoStepVerificationEnterPasswordTab` :713-723 | текущий/новый пароль | `privacyAndSecurity.tsx:190`, `2fa/index.tsx:61,70` |
| `reEnterPassword.tsx` :79 | `…ReEnterPasswordTab` :732-739 | подтверждение | `2fa/enterPassword.tsx:127` |
| `hint.tsx` :85 | `…HintTab` :748-755 | подсказка | `2fa/reEnterPassword.tsx:41` |
| `email.tsx` :154 | `…EmailTab` :767-774 | recovery-email | `2fa/hint.tsx:38`, `2fa/index.tsx:82` |
| `emailConfirmation.tsx` :162 | `…EmailConfirmationTab` :786-796 | код из письма / сброс пароля | `2fa/email.tsx:75`, `privacyAndSecurity.tsx:193`, `2fa/forgotPasswordLink.ts:65` |
| `passwordSet.tsx` :44 | `…SetTab` :688-692 | финальный «готово» | `2fa/email.tsx:50`, `2fa/emailConfirmation.tsx:47` |
| `forgotPasswordLink.ts` :18 | helper-класс | «Forgot password?» | `2fa/enterPassword.tsx:37`, `2fa/emailConfirmation.tsx:98` |

## 2. Дерево навигации настроек (сжатое)

```
AppSettingsTab
├ [шапка] edit → AppEditProfileTab (settings.tsx:115); qr → showMyQrCodePopup (:105); ⋮ → showLogOutPopup (:95)
├ Notifications → AppNotificationsTab                       settings.tsx:126→137
├ Data & Storage → AppDataAndStorageTab                     :127→137
│   └ Photos/Video/Files → AppAutoDownload{Photo,Video,File}Tab + <StorageQuota/>
├ Privacy & Security → AppPrivacyAndSecurityTab             :128→137
│   └ Blocked / 2FA-флоу / Passkeys / LoginEmail / Passcode / WebSessions /
│     AutoDelete / 12 privacy-табов (таблица выше)
├ General → AppGeneralSettingsTab (:129) → Background → BackgroundColor; LiteMode → PowerSaving
├ Chat Folders → AppChatFoldersTab (:130) → EditFolder → IncludedChats(included/excluded) / SharedFolder
├ Stickers & Emoji → AppStickersAndEmojiTab (:131) → QuickReaction
├ Speakers & Camera (:132) · Devices → ActiveSessions (:183) · Language (:252) · Shortcuts (:258)
└ Premium-секция (скрыта при isPremiumPurchaseBlocked, :194-197):
    Premium → PopupPremium.show() (:266) · Stars → PopupStars (:271,:279) · Gift → PopupSendGift (:220-231)
```

**Premium/boosts/statistics:** отдельного premium-таба нет — из левого сайдбара только попапы
(`PopupPremium`/`PopupStars`/`PopupSendGift`). `AppBoostsTab` (`sidebarRight/tabs/boosts.tsx:74`) и
`AppStatisticsTab` (`sidebarRight/tabs/statistics.tsx:248`) — табы **правого** сайдбара, из левого не открываются.

---

# Часть 3. Бургер-меню

`createToolsMenu(mountTo?, positionPadding?)` (`sidebarLeft/index.ts:639-860`) — `ButtonMenuToggle`
(`direction: 'bottom-right'`, `noIcon`). Переиспользуется вертикальной колонкой папок
(`foldersSidebarContent/index.tsx:79`). Каждый пункт может иметь `verify()` — асинхронный предикат видимости,
пересчитывается при каждом открытии. Все «открывающие таб» пункты обёрнуты в `closeTabsBefore`
(закрыть всё внутри + `pause(200)`).

| Пункт | icon | Стр. | Действие / verify |
|---|---|---|---|
| Add Account | `plus` | 683-690 | `addAccount` (стр. 1624-1653: лимиты `MAX_ACCOUNTS`/`MAX_ACCOUNTS_FREE`, `AccountsLimitPopup`, exit-анимация `.page-chats.main-screen-exit(-ing)`); verify: `totalAccounts < MAX_ACCOUNTS` |
| Create A New (подменю) | `edit` | 673-681, 691 | verify: `isCollapsed()` — дублирует FAB, когда тот скрыт; подменю = `createNewChatsSubmenu` (стр. 1078-1082) |
| Saved Messages | `savedmessages` | 692-701 | `appImManager.setPeer(myId)` через `setTimeout 0` |
| Archived Chats | `archive` | 646-657, 702 | `openArchiveTab()`; verify: есть архивные диалоги ∨ архив историй ∨ архив ещё не загружен; бейдж `archivedCount` аппендится в `onOpen` (стр. 850) |
| My Stories | `stories` | 703-710 | `AppMyStoriesTab.open(getInitArgs())`; verify: `!TEST_NO_STORIES` |
| Contacts | `user` | 711-714 | `AppContactsTab` |
| Settings | `settings` | 715-724 | `AppSettingsTab`; `separator: true` |
| More (подменю) | `more` | 665-671, 725 | см. ниже |

**`onOpenBefore`** (стр. 734-846) пересобирает список при каждом открытии:
- attach-menu боты с `show_in_side_menu` вставляются перед пунктом Settings (стр. 735-777; иконка `getAttachMenuBotIcon`, флаг `new` при `side_menu_disclaimer_needed`);
- сверху вставляются аккаунты (стр. 779-843): текущий (клик → Settings) и остальные (аватар + бейдж непрочитанного; клик → exit-анимация `.chatlist-exit/-exiting` + `changeAccount`, Ctrl/Cmd → в новой вкладке; перед сменой — `saveEncryptionKeyBeforeSwitchingAccounts`, стр. 862-871).

**Подменю More** (`createMoreSubmenu`, стр. 874-1021):

| Пункт | icon | Стр. | verify |
|---|---|---|---|
| Dark Mode | `darkmode` | 892-895, 1009-1014 | клик перехвачен capture-фазой: `themeController.switchTheme` с координатами иконки (волновая анимация), меню закрывается через 20 мс |
| Enable/Disable Animations | `animations` | 896-903 | `!liteMode.isEnabled()`; тумблер пишет `appSettings.liteMode.animations` (стр. 983-999) |
| Lite Mode | `animations` | 904-912 | `liteMode.isEnabled()` → `AppPowerSavingTab` |
| Switch to A version | `aversion` | 913-925 | `App.isMainDomain`; пишет `kz_version: 'Z'` и уходит на `web.telegram.org/a/` |
| Telegram Features | `help` | 926-933 | `openUrl(TelegramFeaturesUrl)` |
| Report Bug | `bug` | 934-946 | ссылка на bugs.telegram.org |
| Install App | `plusround` | 947-954 | verify: `!!getInstallPrompt()` (PWA) |
| Picture-in-Picture | `pip` | 955-970 | verify: `DOCUMENT_PICTURE_IN_PICTURE_SUPPORTED`; label живой (`isClientPipOpen()`) |
| футер-версия | — | 1006, 1660-1675 | ссылка на CHANGELOG, `Telegram Web… (build)` |

**FAB и меню «новый чат»**: `createNewChatsMenuOptions` (стр. 1023-1060) — `newchannel` →
`AppNewChannelTab`, `newgroup` → `createNewGroupTab(this)`, `newprivate` → `AppContactsTab`.
FAB `#new-menu` (стр. 1062-1076): `.btn-circle.btn-corner.btn-menu-toggle.animated-button-icon` с двумя
иконками `newchat_filled`/`close` (морф при открытии меню), `direction: 'top-left'`.

---

# Часть 4. Глобальный поиск

> Разбор до адресов порта (loadChats, курсор `next_rate`, чипы, `cleanup`, шов с бэкендом)
> и наши расхождения — в отдельном референсе [`global-search.md`](global-search.md);
> план порта — `docs/superpowers/plans/2026-09-07-solid-wave-3-global-search.md`.

## 1. `InputSearch` — `src/components/inputSearch.ts`

Обёртка над `InputField` (plain DOM, не Solid). Контейнер `.input-search` (+`.old-style`),
инпут `.input-search-input.with-focus-effect`, иконки `input-search-icon` / `input-search-clear`
(стр. 64-111). Колбэки `onChange/onClear/onDebounce/onBack/onEnter` (стр. 22-26).
Debounce 300 мс по умолчанию (стр. 77; логика `onInput` стр. 200-220, `verifyDebounce` может дать мгновенный
вызов). `setArrowBack` (стр. 116-131) — режим со стрелкой назад (в левой колонке не используется:
там своя кнопка `backBtn`). Спиннер `toggleLoading` (стр. 143-173) — ленивый `ProgressivePreloader` +
`SetTransition('is-connecting')`; **им владеет `ConnectionStatusComponent`**
(`appDialogsManager.ts:719` → `connectionStatus.ts:45` `setPlaceholder('Search')`, `:194`
`toggleLoading(isConnecting)`) — т.е. спиннер поля = состояние соединения, не загрузка результатов.
Анимированный плейсхолдер — `setPlaceholder` (стр. 175-198).

## 2. `SearchGroup` — `src/components/searchGroup.tsx`

Фабрика `createSearchGroup()` (Solid-обёртка `Section`); тип реэкспортируется из `appSearch.ts:11-13`.
Опции (стр. 13-24): `name` (LangPackKey | `false`), `type` (`contacts|globalContacts|messages|…`),
`autonomous`, `onFound`, `noIcons`, `scrollableX`. DOM (стр. 77-112): `list = appDialogsManager.createChatList()`
внутри `.search-group.search-group-<type>`; при `scrollableX` — горизонтальный `Scrollable`.
Клики — `appDialogsManager.setListClickListener({list, onFound, autonomous})` (стр. 114-121).
API (стр. 123-169): `clear()`, `setActive()`, `toggle()`, `needShowMoreButton('is-short-5')`,
`setNameRight(...)`; «Show more/less» — стр. 52-76.
(`appSearch.ts` — легаси-поиск по одному чату, в левой колонке не используется.)

## 3. `AppSearchSuper` — `src/components/appSearchSuper.ts`

Тот же класс, что в правой колонке (right-sidebar §4), в левой создаётся с `asChatList: true`.
Ключевое для левой колонки:

- Конструктор (стр. 439-798): nav `.search-super-tabs.menu-horizontal-div` внутри `ScrollableX`
  (стр. 462-472), пункты `menu-horizontal-div-item` (стр. 474-493), контент `.search-super-tabs-container.tabs-container`
  (стр. 495-496), тач-свайп между табами (стр. 498-543), `selectTab = horizontalMenu(...)` (стр. 624-707) —
  с сохранением/восстановлением scrollTop на таб и компенсацией `translateY(diff)` на время транзишена
  (стр. 651, 663-676, 692-707; классы `sliding` — стр. 809-815).
- `performSearchResult` (стр. 1096-1257): строки-диалоги рендерит **`appDialogsManager.addDialogNew`** +
  `setLastMessageN({highlightWord: query})` (стр. 826-872) — подсветка совпадения.
- `loadChats()` (стр. 1285-1523) — сердце таба Chats:
  - при query: 4 параллельных запроса — контакты (`getContactsPeerIds`, лимит 10) → группа `contacts`;
    sponsored (стр. 1373-1421); `searchContacts(query, 20)` → `my_results`→`contacts`, `results`→`globalContacts`
    (+`is-short`/showMore при >3); `dialogsStorage.getDialogs({query})` → `contacts`; дедуп `renderedPeerIds`
    (стр. 1329-1352), подпись строки `addDialogSubtitle` (@username / телефон / участники, стр. 1297-1327);
  - без query: `createTopPeersList({group: people})` — горизонтальная лента топ-15
    (`components/topPeersList.ts:7-60`) + `renderRecentSearch()` (стр. 1452-1501) — реактивно из
    `appState.recentSearch`.
- прочие загрузчики: `loadChannels` (стр. 1971-2022: при query — броадкасты из `searchContacts`; без —
  «Joined» + `getChannelRecommendations`), `loadApps` (стр. 2024-2115: `getTopPeers('bots_app')` +
  `getPopularAppBots` c пагинацией), `loadPosts` (стр. 2117-2128 → `wrapGlobalPostsSearch`).
- `loadType`/`load` (стр. 2181-2360, 2531-2576): кэш `historyStorage[inputFilter]`, `getHistory({...searchContext})`,
  `loadCount = (windowHeight/130|0)*3*1.25`; `cleanup()`/`cleanupHTML()`/`setQuery()` — стр. 2714-2826.

## 4. Сборка в левой колонке — `initSearch()` (`sidebarLeft/index.ts:1084-1554`)

Ленивая и идемпотентная (стр. 1085): создаётся при первом фокусе инпута (стр. 220), возвращает
`{open, openWithPeerId, close}` (стр. 1525-1553). Контейнер — `#search-container` + `new Scrollable` (стр. 1087-1089).

**Группы** (стр. 1097-1103): `contacts` («Chats»), `globalContacts` («Global search»), `messages`
(+`createPlaceholder = EmptySearchPlaceholder`, стр. 1105-1116; справа в заголовке `ChatTypeMenu` —
фильтр all/users/groups/channels, стр. 1118-1126), `people` (без заголовка, `scrollableX`), `recent`
(+кнопка Clear: `confirmationPopup` → `appUsersManager.clearRecentSearch()`, стр. 1504-1519).

**Табы searchSuper** (стр. 1128-1170), порядок фиксированный:

| # | type | inputFilter | langKey |
|---|---|---|---|
| 0 | `chats` | `inputMessagesFilterEmpty` | FilterChats |
| 1 | `channels` | — | ChannelsTab |
| 2 | `apps` | — | MiniApps.AppsSearch |
| 3 | `posts` | — | PostsSearch.TabName |
| 4 | `media` | `inputMessagesFilterPhotoVideo` | SharedMediaTab2 |
| 5 | `links` | `inputMessagesFilterUrl` | SharedLinksTab2 |
| 6 | `files` | `inputMessagesFilterDocument` | SharedFilesTab2 |
| 7 | `music` | `inputMessagesFilterMusic` | SharedMusicTab2 |
| 8 | `voice` | `inputMessagesFilterRoundVoice` | SharedVoiceTab2 |

Опции: `asChatList: true, hideEmptyTabs: false, showSender: true, scrollOffset: 16` (стр. 1165-1169).
`onChangeTab` (стр. 1173-1183): уход с posts чистит инпут; вход в posts → `globalPostsSearch.setQuery`.
Таб Channels скрывается, если у пользователя нет каналов (`watchChannelsTabVisibility`, стр. 1556-1581).

**Suggestions (чипы)**: helper `div.search-helper` вставляется в `searchSuper.nav.parentElement`
(стр. 1226-1255); пока в helper есть чипы — он показан, а nav табов скрыт (`onHelperLength`, стр. 1295-1298).
`updateSearchQuery` (стр. 1328-1381): `cleanupHTML()` → `setQuery({peerId, folderId, query, chatType, minDate, maxDate})`
→ `load(true)`; параллельно собирает чипы:
- **даты** — `fillTipDates(value, dates)` (`helpers/date.ts:245`, `DateData {title,minDate,maxDate}`:240-244) —
  понимает today/yesterday, дни недели, месяцы, шаблоны дат;
- **пиры** — `dialogsStorage.getDialogs({query})` + `getContactsPeerIds(query)`, до 20 (стр. 1361-1374).

Клик по чипу (стр. 1229-1253) переносит его в контейнер инпута (`is-picked`/`is-picked-twice`,
`--paddingLeft`, стр. 1204-1224) и сужает контекст поиска (`selectedPeerId` / `selectedMin/MaxDate`);
повторный клик снимает (`unselectEntity`, стр. 1268-1284). `openWithPeerId` (стр. 1530-1549) — вход
в поиск сразу с чипом пира (используется forum-табом: `forumTab.ts:114`).

**Enter** (стр. 1312-1321): если введён URL — очистить, закрыть поиск, `appImManager.openUrl`.

**Recent**: запись — `mousedown` capture по табу Chats (стр. 1383-1396), исключая группы recent/people →
`appUsersManager.pushRecentSearch(peerId)` (`appUsersManager.ts:277-293` — unshift, обрезка до 20,
`pushToState('recentSearch')`); состояние — `config/state.ts:209`.

**`globalPostsSearch.tsx`** (`sidebarLeft/globalPostsSearch.tsx`, Solid) — поиск по публичным постам каналов
(таб posts): `getHistory({peerId: NULL_PEER_ID, isPublicPosts: true, limit: 30, allowStars})` (стр. 76-86),
квота `channels.checkSearchPostsFlood` (стр. 135-151), оплата звёздами сверх лимита
(ошибка `FLOOD_WAIT_<n>_OR_STARS_<m>`, стр. 118-128), не-премиум → `PopupPremium.show()` (стр. 202-211);
строки — `addDialogAndSetLastMessage` (стр. 27-52). Обёртка `wrapGlobalPostsSearch` (стр. 299-318);
единственный вызов — `appSearchSuper.ts:2118-2128`.

## 5. Открытие / закрытие

Последовательность открытия — `onFocus()` (стр. 1451-1486):
```
focus input (или Ctrl+F / триггер / Escape-item)
→ newBtnMenu + updateBtn .is-hidden
→ appNavigationController.pushItem({type:'global-search', onPop: close})   (кроме iOS Safari)
→ transition(1)                        # zoom-fade чатлист → выдача
→ buttonsContainer.is-visible (+appear-animated, если триггер поиска не был виден)
→ isSearchActive = true                # Solid-эффект морфит бургер (часть 7 §3)
→ onSomethingOpenInsideChange()        # свёрнутый сайдбар всплывает
```

Закрытие — клик по `backBtn` (стр. 1491-1502): `removeByType('global-search')` → `transition(0)` →
снятие `is-visible` → `isSearchActive = false` → сброс `chatTypeMenu`. **Escape** идёт через
`appNavigationController.onKeyDown` (`appNavigationController.ts:216-223`) → `onPop` итема
`'global-search'` → `close()` (= `simulateClickEvent(backBtn)`, стр. 1091-1093; публичный
`closeSearch()` — стр. 1583-1585).

Транзишен (стр. 1425-1449): `TransitionSlider({content: .sidebar-content, type: 'zoom-fade',
transitionTime: 150})`; дети — `#chatlist-container` (id 0) и `#search-container` (id 1).
`onTransitionStart` вешает `is-search-active` на `.item-main` (через него гаснет сторис-лента);
`onTransitionEnd(0)` вызывает **`cleanup()`** (стр. 1401-1423): снос чипов, `searchSuper.destroy()`,
`searchContainer.replaceChildren()`, сброс `searchInitResult` и повторная once-подписка на focus —
поиск каждый раз пересоздаётся с нуля.

---

# Часть 5. Чатлист

> Форк-специфика: чатлист виртуализован. Апстримные `Some/Some1/Some2` вынесены в
> `components/autonomousDialogList/*`, `SortedDialogList` переписан поверх Solid-виртуального списка;
> `positionElementByIndex` для строк больше не используется (только для контейнеров папок).

## 0. Классы

| Класс | Файл:строки | Ответственность |
|---|---|---|
| `AppDialogsManager` (singleton) | `src/lib/appDialogsManager.ts:512-2690` | оркестратор: папки (`xds`), клики, контекстные меню, `setLastMessage*`/`setUnreadMessages*`, плейсхолдеры, сторис, forum-табы |
| `DialogElement` + `attachRowController` (HEAD 812502980; в старой базе — `extends Row`) | `appDialogsManager.ts:288-506` (HEAD) | одна строка: DOM, `dom: DialogDom`, бейджи; у нас — `components/dialogRow.ts` на `rowTsxController.solid.tsx` (задача 29 плана 2D) |
| `SortedDialogList` | `src/components/sortedDialogList.ts:16-278` | «ключ → DialogElement» поверх виртуального списка; индексы, add/update/delete/pinned |
| `CustomPinnedDialog` | `sortedDialogList.ts:284-290` | псевдо-диалог с произвольным `render()` (строка «Архив») |
| `AutonomousDialogListBase<T>` | `src/components/autonomousDialogList/base.ts:39-381` | загрузка/пагинация/плейсхолдер/typing (бывш. `Some`) |
| `AutonomousDialogList` | `autonomousDialogList/dialogs.ts:28-420` | список конкретного `filterId`: rootScope-подписки, online/call, строка архива (бывш. `Some2`) |
| `AutonomousForumTopicList` / `AutonomousSavedDialogList` / `AutonomousMonoforumThreadList` / `AutonomousBotforumTopicList` | `forumTopics.ts:12` / `savedDialogs.ts:8` / `monoforumThreads.ts:10` / `botforumTopics.ts` | те же списки для топиков/Saved/monoforum |
| `DialogsContextMenu` | `src/components/dialogsContextMenu.ts:31-426` | контекстное меню строки |

Связка: `appDialogsManager.xds[filterId] = AutonomousDialogList` (`:1171`), у каждого —
`sortedList: SortedDialogList` (`dialogs.ts:213-230`), внутри — `createDeferredSortedVirtualList`
(`sortedDialogList.ts:61-107`).

## 1. Создание строки

Цепочка: `SortedDialogList.createElementForKey` (`sortedDialogList.ts:166-185`) →
`appDialogsManager.addListDialog` (`:2518-2573`; `withStories: true`, + `LazyLoadQueue`-префетч истории
на 50 сообщений, `:2529-2570`) → **`addDialogNew`** (`:2636-2652`, `new DialogElement`) →
`initDialog` (`:2575-2605`: групповой звонок, online-статус, `setLastMessageN({setUnread: true})`).
Для результатов поиска — `addDialogAndSetLastMessage` (`:2610-2634`). Невиртуальные списки (группы поиска)
создаются `createChatList` (`:1952-1981`, `ul.chatlist`).

DOM строки (ctor `DialogElement` `:211-400`; база `Row`, `asLink` → тег `<a>`):

```
a.row.no-wrap.chatlist-chat.chatlist-chat-bigger.row-big  href="#<peerId>" data-peer-id …
├ .avatar.…row-media.row-media-bigger.dialog-avatar        :261-283  (avatarSizeMap :177-181 — bigger:54/abitbigger:42/small:32)
├ .row-row.row-title-row.dialog-title
│ ├ .row-title.no-wrap.user-title    ← PeerTitle({withIcons}) :287-321
│ └ .row-title-right.dialog-title-details
│   ├ span.message-status.sending-status   :357-358
│   └ span.message-time                    :360-361
├ .row-row.row-subtitle-row.dialog-subtitle.has-multiple-badges  :367
│ ├ .row-subtitle.no-wrap  ← lastMessageSpan :332
│ └ …бейджи
└ unreadAvatarBadge / callIcon → в listEl
```

`setLastMessage/setLastMessageN` (`:1983-2246`): выбор draft vs `topMessage`
(`getLastMessageForDialog` `:1992-2019`); **media-превью** — `choosePhotoSize(20,20)` + `wrapPhoto` в
`.dialog-subtitle-media` (+`.is-round`, спойлер `wrapMediaSpoiler`, `:2101-2146`); **draft** —
`<span class="danger">Draft: </span>` (`:2149-2153`); префикс отправителя `.primary-text` (`:2154-2176`);
текст — `wrapMessageForReply` (`:2183-2208`); flex-вёрстка `.dialog-subtitle-flex/-span/-overflow/-last`
(`:2216-2237`); время — `formatDateAccordingToTodayNew` (`:2240-2243`).

## 2. Сортировка (индексы)

- `getDialogIndexKey(localId)` → `` `index_${localId}` `` (`appManagers/utils/dialogs/getDialogIndexKey.ts:3`);
  `getDialogIndex(dialog, indexKey)` (`getDialogIndex.ts:6-11`). indexKey у списка — по `filter.localId`
  (`dialogs.ts:212`, `base.ts:86-89`).
- `SortedDialogList.getIndexForKey` (`sortedDialogList.ts:115-130`): pinned-строка «Архив» = 0, иначе
  `dialogsStorage.getDialogIndex(...)`. Компаратор `sortWith: (a,b) => b - a` (`:102`).
- Перестановка **не через DOM-порядок**: элементы позиционируются абсолютно, `InnerItem` ставит `style.top`
  (`deferredSortedVirtualList.tsx:185-187`), а `verticalVirtualList.tsx:78-85` анимирует `top`
  (`createAnimatedValue`, 120 мс). `updateItem` мутирует `index` без пересоздания объекта, чтобы сыграла
  анимация (`deferredSortedVirtualList.tsx:141-147`).
- `positionElementByIndex` остался только для **контейнеров папок** (`appDialogsManager.ts:966, 1257, 1281`).

## 3. Ленивость / виртуализация

| Механизм | Файл:строки |
|---|---|
| показ списка → `onChatsScroll()` → `requestItemForIdx(0)` | `base.ts:144-146` |
| `requestItemForIdx` → `cursorFetcher.fetchUntil(idx+1)` | `base.ts:63-65`; `SequentialCursorFetcher` — `helpers/sequentialCursorFetcher.ts:7-74` |
| размер страницы: `guessLoadCount() = max(winH/64*1.25, 20)` | `base.ts:216-219`; `DIALOG_LOAD_COUNT = 20` (`base.ts:23`) |
| `loadDialogsInner`: `getDialogs({offsetIndex, limit, filterId})`, `addDeferredItems(items, count)` | `base.ts:247-299` |
| рефетч через 500 мс (первый ответ может дать `count: null`) | `base.ts:250-272` |
| догрузка по дну + throttle 200 мс | `base.ts:148-150, 347-351`; override с контактами — `dialogs.ts:343-349` |
| canvas-шиммер первой загрузки | `helpers/dialogsPlaceholder.ts` (`:62,79,99`); `createPlaceholder` — `base.ts:152-170` |
| per-row скелет непогруженных индексов | `components/loadingDialogSkeleton.tsx` (fallback — `deferredSortedVirtualList.tsx:306-316`) |
| **шринк DOM**: держится `maxVisible + EXTRA_ITEMS_TO_KEEP(50)`, лишнее режется `slice` | `deferredSortedVirtualList.tsx:226-239, 41, 257-263`; `onListShrinked` пересчитывает курсор — `base.ts:67-77` |
| окно рендера `thresholdPadding: 72*4`; постепенный reveal (~1 эл/120 мс) | `deferredSortedVirtualList.tsx:328, 199-223`; видимость — `verticalVirtualList.tsx:66-72` |
| размонтированный `DialogElement` реинициализируется через 200 мс при возврате | `sortedDialogList.ts:33, 70-99` |
| пустые состояния (`.empty-placeholder`, папка → 📂 + «Edit Folder») | `appDialogsManager.ts:1324-1435` |

## 4. Бейджи и статусы

`BADGE_SIZE = 22` (`appDialogsManager.ts:174`); все бейджи — `.dialog-subtitle-badge.badge.badge-22`:

| Бейдж | Метод | Классы |
|---|---|---|
| pinned | `:411-417` | `…badge-icon dialog-subtitle-badge-pinned` + `Icon('chatspinned')` |
| unread | `:419-424` | `…dialog-subtitle-badge-unread` (+рантайм `unread`/`mention`/`not-visited`) |
| unread на аватаре | `:426-431` | `…avatar-badge` (в `listEl`; включается при свёрнутом сайдбаре/forum-табе, условие `:2370`) |
| mention | `:433-439` | `…mention mention-badge`, текст `@` |
| reactions / poll | `:441-455` | `reaction-badge` + `Icon('reactions_filled')` / `poll-vote-badge` |
| переключение | `:457-474` | `SetTransition('is-visible')`, 250 мс (`autonomousDialogList/constants.ts:1`) |

`setUnreadMessages` (`:2248-2468`): **muted** — класс `is-muted` + `Icon('nosound','dialog-muted-icon')`
(`:2334-2350`); **галочки** — `setSendingStatus(dom.statusSpan)` (`:2352` →
`components/sendingStatus.ts:25-58`: `sending`/`sendingerror`/`check`/`checks`); текст бейджа —
`@` при единственном непрочитанном-меншене, иначе `formatNumber(unreadCount,1)` (`:2426-2436`).
**verified/premium/fake/emoji-status** — иконки `PeerTitle({withIcons})` (`peerTitle.ts:196-224`),
перекраска активной строки — `setDialogActiveStatus` (`:979-993`). Активная строка —
`setDialogActive` (`:995-1012`, классы `active`, `is-forum-open`).

## 5. Онлайн-точка, typing, draft

| Что | Файл:строки |
|---|---|
| онлайн-точка: `setOnlineStatus` — классы `is-online` + `is-visible` (250 мс) | `dialogs.ts:191-205`; первичная — `appDialogsManager.ts:2586-2592`; апдейты — `user_update` `dialogs.ts:76-90` |
| typing в превью: `peer_typings` → `setTyping` — `.peer-typing-container` от `appImManager.getPeerTyping`, класс `user-typing` на `lastMessageSpan` | `dialogs.ts:61-74`; `base.ts:301-318`; снятие → повторный `setLastMessageN` (`base.ts:320-334`) |
| draft: подмена превью + `danger`-префикс; дата = `max(draft.date, lastMessage.date)`; событие `dialog_draft` | `appDialogsManager.ts:1998-2007, 2149-2153, 2241`; `dialogs.ts:145-157` |
| иконка группового звонка `dialog-group-call-icon` | `dialogs.ts:302-341` |
| auto-delete таймер на аватаре | `dialogs.ts:174-176`; `sortedDialogList.ts:187-198` |

Печатающие, которых нет в зеркале пиров, отбрасываются до рендера и из счёта (tweb 50da390c6,
`appImManager.getPeerTyping`): иначе имя — фолбэк «Удалённый аккаунт». В личке проверки нет —
имени там не пишут. Строка, у которой больше некого называть, возвращает последнее сообщение
(`setDialogTyping` → `unsetTyping`). **У нас:** `core/hooks/useTypingLabel.ts` — фильтр по
`usePeers` для групп; возврат последнего сообщения у React-строки происходит сам (`active: false`).

## 6. Контекстное меню и клики

**Drag-n-drop пиннед-диалогов в чатлисте НЕТ** — `Sortable` используется только в
`usernamesSection.ts:219`, `tabs/chatFolders.tsx:296` (порядок папок), `tabs/stickersAndEmoji.tsx:289`.
Пин/анпин — только контекстным меню.

`DialogsContextMenu` (`components/dialogsContextMenu.ts`): `attach(list)` (`:48-95`; по `data-is-all-chats`
меню не открывается `:59-61`). Пункты `getButtons` (`:97-257`): OpenInNewTab `:99` · Preview `:107` ·
ViewAsTopics/Chats `:112-133` · MarkAsUnread/Read `:133` · AddToFolder (submenu `:259-282`) `:143` ·
Pin/Unpin `:153` · Mute/Unmute `:193` · Archive/Unarchive `:207` · Hide General `:217` ·
Close/RestartTopic `:224` · ChargeFee `:238` · Delete `:248`.
Подключение — `setListClickListener({withContext})` (`appDialogsManager.ts:1941-1943`); у строки «Архив»
своё меню (`:1945-1949` → `archiveDialogContextMenu.ts:24,45`: Hide/Show, MarkAllAsRead, ArchiveSettings).

Клики по строке — `setListClickListener` (`:1751-1950`): аватар → сторис (`:1770-1793`);
`archive-dialog` → `openArchiveTab` (`:1807-1811`); Shift+клик → превью-попап чата (`:1852-1862`);
форумы → `toggleForumTabByPeerId` (`:1866-1895`); Ctrl/Cmd → новая вкладка (`:1897-1902`).

## 7. Строка «Архив» и contact-list

Строка «Архив» — `CustomPinnedDialog` + веб-компонент `<archive-dialog>` (`components/archiveDialog.tsx`:
классы как у обычной строки `:43`, бейдж `:85-89`, до 10 имён в превью `:27`); создаётся только в списке
`FOLDER_ID_ALL` (`dialogs.ts:38-57`), монтируется/снимается `ensurePinned/removePinned`
(`dialogs.ts:406-414`, `sortedDialogList.ts:219-226`), индекс всегда 0 (`sortedDialogList.ts:116`).

Когда чатов < 10, под списком появляется секция **Contacts** — `_onListLengthChange`
(`appDialogsManager.ts:1479-1570`): `with-contacts` `:1500`, `SettingSection('Contacts')` `:1502-1508`,
`SortedUserList` `:1520-1530`, постраничный `loadContacts` `:1532-1545`.

## 8. Папки внутри менеджера

| Что | `appDialogsManager.ts` |
|---|---|
| `folders = {menu, menuScrollContainer, menuGradient, container: #folders-container}` | `:520-525` |
| `.chatlist-overlay` + ResizeObserver → `--chatlist-overlay-height` (табы не накрывают первую строку) | `:595-604` |
| рендер `FoldersTabs` (Solid) в оверлей | `:654-686` |
| старт: `setFilterId(FOLDER_ID_ALL)` + `addFilter(all)` | `:729-736` |
| `selectFolderByIndex`: лимит-попап, `closeEverythingInsideNaturally`, повторный клик → скролл к началу | `:738-791` |
| `horizontalMenu` args: `onTransitionEnd` чистит неактивные `xds` | `:794-810` |
| `setOnClick(selectTab)` → в стор `useFolders` (общая точка с вертикальной колонкой) | `:812` |
| `addFilter` (архив скипается `:1251-1253`), контейнер `tabs-tab.chatlist-parts.folders-scrollable` | `:1249-1290` |
| фабрика списка `l(filter)` → `AutonomousDialogList` + scrollable + click-listener | `:1170-1176` |
| показ меню при >1 папке, `has-filters`, `setHasFolders` | `:1298-1322` |
| `onTabChange`: `xd = xds[filterId]`, `reset()`, `onChatsScroll()`, `chatlistUpdates` | `:1092-1168` |
| **свайп между папками** (touch): `handleTabSwipe` по `folders.container` | `:617-634` |

Счётчики на табах — `components/foldersTabs.tsx:40-46` (`Badge`, gray при muted); данные — часть 1 §5.

## 9. Подписки на события

`AppDialogsManager.initListeners()` (один раз из `onStateLoaded`, `:1067-1070`):

| Событие | Обработчик | Стр. |
|---|---|---|
| `state_cleared` | сброс + `onStateLoaded` | `:640-652` |
| `folder_unread` (id<0) | `setUnreadMessagesN` | `:861-873` |
| `contacts_update` | `processContact` | `:875-877` |
| `peer_changed` (appImManager) | перенос `active` | `:879-922` |
| `filter_update` / `filter_delete` / `filter_order` | addFilter / destroy / переиндексация контейнеров | `:924-968` |

`AutonomousDialogList` (`dialogs.ts`, через `listenerSetter`, гейт `isActive` = `xd === this` `:179-181`):
`peer_typings` `:61` · `user_update` `:76` · `chat_update` `:92` · `dialog_flush` `:97` ·
`dialogs_multiupdate` `:105` · `dialog_drop` `:120` · `dialog_unread` `:129` ·
`dialog_notify_settings` `:137` · `dialog_draft` `:145` · `filter_update` `:159` ·
`auto_delete_period_update` `:174`.

---

# Часть 6. Сторис-лента над чатлистом

| Что | Файл:строки |
|---|---|
| контейнер `div.stories-list` создаётся менеджером между шапкой и `.sidebar-content` | `appDialogsManager.ts:606-608` |
| `_renderStories()`: `StoriesList({foldInto: '.item-main .input-search input', setScrolledOn: chatsContainer, getScrollable: () => xd.scrollable.container, listenWheelOn: bottomPart, offsetX: -1, onExpand})` | `:824-841`; рендер — `:843-845`; вызов из `onStateLoaded` `:1061` |
| сворачивание — `useCollapsable({listenWheelOn})`; прогресс — CSS-переменная `--stories-scrolled` на `#chatlist-container` | `components/stories/list.tsx:304-307, 235` |
| авто-fold при исчезновении сторис; блок горизонтального скролла в свёрнутом виде | `list.tsx:245-251, 260-262` |
| анимация «влёт» аватарок в поле поиска (`foldInto`-геометрия) | `list.tsx:274-284` |
| при активном поиске лента гаснет через `.item-main.is-search-active` | `stories/list.module.scss:157` (класс ставит транзишен поиска, часть 4 §5) |
| своя лента в архиве (`foldInto: tab.title`, `offsetX: -64`, `archive: true`) | `tabs/archivedTab.tsx:26-45` |

Клик по кнопке архива историй внутри ленты открывает `AppMyStoriesTab` (`stories/list.tsx:356,363`).

---

# Часть 7. Анимации

1. **Переходы табов слайдера** — общий `TransitionSlider({type: 'navigation', transitionTime: 250})`
   из `SidebarSlider` (right-sidebar §1.3): классы `active/to/from` на детях, `animating/backwards`
   на контейнере; кейфреймы табов — `scss/partials/_slider.scss:226-241`.
2. **Чатлист ↔ поиск** — второй, вложенный `TransitionSlider({type: 'zoom-fade', transitionTime: 150})`
   на `.sidebar-content` (`sidebarLeft/index.ts:1425-1449`): приходящий узел играет
   `fade-in-opacity .15s` + `zoom-fade-in-move .15s` (scale 1.1 → 1), уходящий — фейд
   (`_transition.scss:25-40`); `.transition-item:not(.active)` — `display: none !important` (`_transition.scss:12`).
3. **Морф бургер ↔ назад** — три класса из одного Solid-эффекта (`sidebarLeft/index.ts:408-418`):
   `showBack = useFoldersSidebarShown() || useIsLeftSearchActive()` →
   `toolsBtn.is-visible` / `backBtn.is-visible` / `animated-menu-icon.state-back`.
   Сам морф — чистый CSS `_animatedIcon.scss:58-114`: `.animated-menu-icon` — три полоски
   (элемент + `:before/:after`), `state-back` → `rotate(180deg)` + полоски
   `rotate(±45deg) scaleX(.75) translate(…)`; `transition: transform .25s` только при `animation-level(2)`.
   При показанной вертикальной колонке папок бургер в шапке всегда в состоянии «назад» (меню живёт в колонке).
4. **FAB «новый чат»** — `.animated-button-icon` с иконками `newchat_filled`/`close`
   (`sidebarLeft/index.ts:1071-1072`), морф классами при открытии `ButtonMenu`.
5. **Схлопывание/всплытие колонки** — ширину анимирует CSS-transition на `#column-left.is-collapsed`,
   JS держит `force-*`-классы 200+150 мс (`sidebarLeft/index.ts:552-599`).
6. **Строки чатлиста** — анимация `top` виртуального списка (120 мс, `verticalVirtualList.tsx:78-85`),
   бейджи — `SetTransition('is-visible')` 250 мс, сторис-лента — `--stories-scrolled`.
7. **Смена аккаунта / add account** — exit-кейфреймы `.chatlist-exit/-exiting` (`sidebarLeft/index.ts:829-833`)
   и `.main-screen-exit/-exiting` (`:1645-1649`).

---

# Часть 8. У нас (`web-client/`): карта и расхождения

## 1. Карта

| Наш файл | Роль | Аналог tweb |
|---|---|---|
| `src/components/Sidebar.tsx` (:61) | оркестратор колонки: `#column-left` с tweb-классами (:213-215), композиция хуков `useSidebar*` | `AppSidebarLeft.construct` |
| `src/components/SidebarScreens.tsx` | экраны колонки, ещё не ставшие вкладками, — **один enum-стейт** `'contacts'\|'wallet'\|'calls'\|'newGroup'\|'newChannel'\|'newPrivate'\|'newSecret'\|null` (этап 0а волны 7), lazy-подгрузка Wallet/Calls; настроек здесь нет с задачи 28 плана 2D | стек `SliderSuperTab` |
| `src/components/sidebarLeft/tabs/settings.solid.tsx` + `sidebarLeft/columnSlider.ts` | корень настроек — вкладка `AppSettingsTab` колоночного слайдера (задача 28 плана 2D); подэкраны — вкладки того же слайдера (`tab.slider.createTab`), ещё не портированные «Конфиденциальность»/«Стикеры»/«Динамики»/«Профиль» — React-экраны на мосту `sidebarLeft/reactScreenTab.tsx` (ВРЕМЕННО до 2D-23/15/26/27) | `AppSettingsTab` + дерево части 2 |
| `src/components/settings/*` | реализации ещё не портированных под-экранов (Passkeys, BlockedUsers, AutoDelete, EditProfile…). «Быстрой реакции» здесь БОЛЬШЕ НЕТ — вкладка `sidebarLeft/tabs/quickReaction.solid.tsx` (задача 14 плана 2D). «Устройства» здесь БОЛЬШЕ НЕТ — уехали на слайдер, см. §3; «Обои» и «Цвет» — тоже (`sidebarLeft/tabs/background.solid.tsx`, `backgroundColor.solid.tsx`, задача 12 плана 2D; открывает строка React-«Общих» через хост) | `sidebarLeft/tabs/*` |
| `src/lib/appDialogsManager.ts` | папочный срез владельца: `.chatlist-overlay` с Solid-рядом вкладок, `#folders-container`, скроллер на папку, переключение (`horizontalMenu` + `TransitionSlider`); встроен в колонку `Sidebar.tsx` (план папок, задача 6) | `AppDialogsManager` (папки) |
| `src/components/ChatList.tsx` / `ChatListItem.tsx` | списки папок на виртуальном ядре — порталом в `.chatlist-top` контейнеров владельца | `AutonomousDialogList` (строки) + `DialogElement` |
| `src/components/virtual/DeferredSortedVirtualList.*` | порт `deferredSortedVirtualList` | 1:1 |
| `src/core/hooks/useDialogListSource.ts` | источник набора папки/архива (фильтр, размер, курсор) | `AutonomousDialogListBase` |
| `src/core/managers/dialogsManager.ts` (воркер) | владелец диалогов: сортировка, пагинация, refresh | `dialogsStorage` (воркерная сторона) |
| `src/core/dialogs/{dialogIndex,dialogOps,loadCount}.ts` | индексы, операции, размер страницы | `getDialogIndex*`, `DIALOG_LOAD_COUNT` |
| `src/components/chatlist/dialogsPlaceholder.ts` | canvas-шиммер | `helpers/dialogsPlaceholder.ts` |
| `src/components/foldersTabs.solid.tsx` + `src/components/folders/FoldersSidebar.tsx` + `src/helpers/dom/createFolderContextMenu.ts` | горизонтальный ряд (Solid, узлами владельца) и вертикальная колонка папок (React, `tabsInSidebar`; клик — тот же `selectTab` владельца); меню папки — одна фабрика `createFolderContextMenu` на оба ряда (задача 7) | `foldersTabs` + `foldersSidebarContent` + `createFolderContextMenu` |
| `src/components/StoriesRow.tsx` (Sidebar.tsx:268-282) | сторис-лента (`foldInto`/`setScrolledOn`/`getScrollable`/`listenWheelOn`) | `stories/list.tsx` |
| `src/components/SidebarMenuButton.tsx` | бургер + морф (`searching` prop — отражение владельца поиска); узел `.sidebar-back-button` отдаётся владельцу поиска ref'ом (`backBtnRef`), своего React-обработчика у него нет; бургер в DOM всегда, при показанной колонке папок и закрытом поиске — `hide` | `createToolsMenu` + animated-menu-icon + `this.backBtn` |
| `src/components/sidebarLeft/globalSearch.ts` + шов `src/core/hooks/useGlobalSearch.ts` + `shared/ui/InputSearch` (режим ручки `searchRef` → `inputSearchHandle.ts`) | глобальный поиск: владелец (порт `initSearch`) строит и сносит детей постоянного `#search-container`, ведёт `zoom-fade` и `is-search-active`; поле — объект tweb с debounce 300 мс (задача 13 плана `2026-09-07-solid-wave-3-global-search.md`; разбор — `global-search.md`) | `initSearch` + `AppSearchSuper` + `InputSearch` |
| `src/components/connectionStatus/*` (Sidebar.tsx:88-94) | автомат плейсхолдера/спиннера поля поиска | `ConnectionStatusComponent` |
| `src/core/dom/{updateColumnWidths,installColumnResize}.ts` (Sidebar.tsx:159-189) | ресайз/коллапс колонки | `installColumnResize`, `updateColumnWidths` |

DOM-паритет первого таба выдержан сознательно: `.sidebar-slider > .item-main > .sidebar-header +
.stories-list + .sidebar-content > #chatlist-container/#search-container` с теми же классами и
`--chatlist-overlay-height` (Sidebar.tsx:229-327).

## 2. Главные структурные расхождения

1. **Колоночный слайдер есть** (задача 28 плана 2D, §3 ниже): `SidebarSlider` на
   `#column-left` (`navigationType: 'left'`), вкладка №0 — `.item-main`, настройки и папки —
   его вкладки. Экраны, ещё не ставшие вкладками, живут по-старому: плоский enum
   `SidebarScreen` (контакты, новая группа/канал, звонки, кошелёк — этап 0а волны 7) без истории
   глубже одного уровня. Не портирован `closeEverythingInsideNaturally` целиком (сам метод
   `closeAllTabsNaturally` на слайдере есть, вызывающего нет).
2. ~~**Настройки — один компонент, а не дерево табов.**~~ Снято задачей 28 плана 2D: корень —
   `AppSettingsTab`, подэкраны — вкладки (`makeSubTabConfig` с `getInitArgs`-префетчем, срезы
   `sliceTabsUntilTab` мастера 2FA и код-пароля — дословно). Остаток: четыре React-экрана на
   мосту `scaffoldReactScreenTab` (до 2D-15/23/26/27) и нет попап-режима настроек при свёрнутой
   колонке (`SettingsSliderPopup`, О-27 плана 2D).
3. ~~**Поиск без `AppSearchSuper`.**~~ Снято задачей 13 плана
   `docs/superpowers/plans/2026-09-07-solid-wave-3-global-search.md`: выдачу рисует тот же класс
   `AppSearchSuper` вторым потребителем, обвязку — владелец `components/sidebarLeft/globalSearch.ts`
   (порт `initSearch`: пять групп, `ChatTypeMenu`, чипы пира/даты, recent с «Clear» через
   `confirmationPopup`, `TransitionSlider` 'zoom-fade', `cleanup` по окончании обратного перехода).
   В колонку он встроен швом `core/hooks/useGlobalSearch.ts`: `#search-container` постоянный и
   пустой, `className` у `#chatlist-container`/`.item-main`/`.sidebar-content` постоянный — классы
   перехода и `is-search-active` ставит только владелец; `searching` колонки — отражение его
   `onSearchActive`. React-`SearchView`, `useSidebarSearch`, `shared/ui/Tabs` удалены. Остаток:
   вкладки `apps`/`posts`, лента «люди», «SimilarChannels» — «Отложено» плана (нет ручек);
   исполнителя внутренних t.me-ссылок нет (Enter со ссылкой — расхождение 1 шапки шва).
4. **Чатлист — уже портирован программой, не переизобретать.** Порт «виртуальный список диалогов 1:1»
   смержен целиком (4 этапа, `0d41dc41`): ядро `components/virtual/`, владелец диалогов в воркере
   `core/managers/dialogsManager.ts`, источник `useDialogListSource`. Спеки:
   `docs/superpowers/specs/2026-08-12-dialogs-ownership-and-virtual-list-design.md`,
   `2026-08-13-dialogs-pagination-design.md`, `2026-08-13-virtual-chatlist-design.md`,
   `2026-08-13-remaining-lists-design.md`, `2026-08-13-dialogs-count-and-refresh-design.md`
   (разделы «Отступления» читать перед правкой ядра). Ветка оживления пагинации
   `worktree-dialogs-count-refresh` готова и проверена на стенде, на момент снятия не смержена.
5. **Архив — оверлей, не таб.** tweb: `AppArchivedTab` в слайдере, переиспользующий `l(FOLDER_ID_ARCHIVE)`.
   У нас: оверлей внутри `.connection-status-bottom` (React-ребёнок хоста владельца папок; в
   `#folders-container` ему нельзя — там кадры папок, адресуемые индексом) с тем же виртуальным ядром и
   `useDialogListSource(ARCHIVE_FOLDER_ID)` (`ArchiveList`, Sidebar.tsx:467-524) — отступление названо
   в комментариях там же.
6. **Бургер-меню — другой состав.** У нас: Settings/Contacts/Saved/Premium/MyStories/CloseFriends/
   Wallet/Calls/Logout/ToggleMode (Sidebar.tsx:192-207). Нет: мультиаккаунтов, attach-menu ботов,
   Archived как пункта (архив — только строкой списка), More-подменю (A-version, PWA, PiP, Report Bug),
   verify-предикатов. Есть своё: Wallet, Calls, Logout (в tweb logout живёт в «⋮» настроек).
   Один набор обработчиков переиспользуется бургером и вертикальной колонкой папок — как в tweb.
   **Ночной режим** — первый пункт подменю «Ещё» (`MainMenu.tsx`), как у tweb `createMoreSubmenu`:
   подпись по теме (`EnableDarkMode`/`DisableDarkMode`), круг перехода — из центра иконки пункта.
   Строки «Ночной режим» в корне настроек нет (`fix/settings-root-items`).
   **Кнопка эмодзи-статуса в шапке** (`statusBtnIcon`) — `SidebarEmojiStatusButton.tsx`: только у
   подписчика Premium, `button.btn-icon.sidebar-emoji-status` без ripple справа от поиска, глиф
   `star` без статуса; `is-input-the-last-child` снимается по `toggleRightButtons`. Отступления:
   статус — юникод-эмодзи, а не документ (`wrapStatus`/`fireAroundAnimation` не портированы), выбор —
   наш попап `EmojiStatusPicker`, а не `EmoticonsDropdown` у кнопки; клик по своему статусу в профиле
   (`clickableEmojiStatus`) — `PeerProfile` в корне настроек есть с задачи 28 волны 2D; кликабельность статуса — предмет `PeerProfile.Name` (`wrapPeerTitle` c `clickableEmojiStatus`).
6а. **Контакты и «Новое сообщение» — адресная книга.** tweb: `AppContactsTab` → `ContactsList`
   (`getContactsPeerIds(query, false, …)`, без себя) — и для пункта меню, и для кнопки `newprivate`
   (`sidebarLeft/index.ts:661`, `:1039`). У нас оба экрана (`ContactsView.tsx`, `NewPrivateChat.tsx`)
   и выбор контакта для отправки (`ContactPicker`) читают книгу через `core/hooks/useContactPeerIds.ts`
   (ветка `fix/contacts-share-pickers`; прежде собирали «контакты» из личных диалогов — туда попадали
   «Избранное», служебный «Telegram» 777000 и любой собеседник). Остаток: сам `ContactsList` не
   портирован — виртуальный список, сортировка «по времени в сети»/по имени с кнопкой в шапке,
   `SectionIndex`, выделение контактов (`ContactsSelection`), меню контакта; у нас прежняя разметка
   с группами по букве, порядок по имени задаёт книга; «Новое сообщение» — отдельный экран, а не
   `AppContactsTab`.
7. **Контекстное меню диалога и contact-list-заглушка** — у tweb богатое меню
   (`dialogsContextMenu.ts`, 13 пунктов) и секция Contacts при <10 чатах; у нас этих подсистем нет
   (меню ПАПКИ — не оно: порт `createFolderContextMenu` на оба ряда, задача 7 плана папок).
8. **Фолдеры**: контейнеры, ряд вкладок и переключение — у владельца `lib/appDialogsManager.ts`
   (план `docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`, задача 6: `FolderTabs` и
   `TabSlide` из колонки сняты; переключение = список с начала, свайп есть; задача 9 перевела на
   Solid-`FoldersTabs` и ряд попапа пересылки, React-`FolderTabs.tsx` удалён). Вертикальная колонка
   (React) переключает через тот же `selectTab`. Остаток: body-классы режима папок (задача 8 — до неё
   при «папки слева» горизонтальный ряд виден вместе с колонкой), общее меню папки (задача 7),
   счётчики на клиенте из зеркала, а не `dialogsStorage.getFolderUnreadCount` (отложенная задача 16);
   разбор — `folders-tabs.md` § 2.
9. **Ресайз/коллапс** — `installColumnResize` портирован (Sidebar.tsx:159-189), но без побочек
   tweb-`onCollapsedChange` (fade/zoom-fade чатлиста, avatar-badges, Ctrl+F-подсказка) — отмечено
   комментарием Sidebar.tsx:176-178; «всплытие» has-open-tabs воспроизведено через
   `setOpenTabsLeftSidebar` (Sidebar.tsx:187-189).

## 3. Слайдер вкладок настроек (волна 2 `solid-migration`)

Подсистема вкладок портирована и заведена в колонку. Снято 2026-08-29 (задача 8 волны 2).

### Что портировано

| Наш файл | Источник tweb | Заметка |
|---|---|---|
| `components/slider.ts` | `src/components/slider.ts` | `SidebarSlider` целиком: история вкладок, `createTab`/`selectTab`/`closeTab`/`closeAllTabs`/`sliceTabsUntilTab`, `onTabsCountChange`, `canHideFirst` |
| `components/sliderTab.ts` | `src/components/sliderTab.ts` | `SliderSuperTab` + `SliderSuperTabEventable` (шапка, `Scrollable`, порядок разрушения, `managers`) |
| `components/solidJsTabs/*` | `src/components/solidJsTabs/*` | `scaffoldSolidJSTab(Eventable)`, `useSuperTab`, `PromiseCollector` |
| `components/solidJsTabs/tabs.ts` | `src/components/solidJsTabs/tabs.ts` | реестр объявлений вкладок: `AppActiveSessionsTab`, `AppSessionTab`, `AppLanguageTab`, `AppNotificationsTab`, `AppKeyboardShortcutsTab`, `AppChatBackgroundTab`, `AppBackgroundColorTab`, `AppQuickReactionTab`, `AppPowerSavingTab`, `AppDataAndStorageTab`, `AppAutoDownload{Photo,Video,File}Tab`, мастер `AppTwoStepVerification*Tab` и `AppAddMembersTab` |
| `components/sidebarLeft/tabs/activeSessions.solid.tsx` | `src/components/sidebarLeft/tabs/activeSessions.tsx` | «Устройства», порт HEAD 812502980 (план 2D, задача 9) |
| `components/sidebarLeft/tabs/session.solid.tsx` (+ `sessionInfoRow.solid.tsx`, `sessionDetails.module.scss`) | `src/components/sidebarLeft/tabs/session.tsx` (944b578e9) | экран одной сессии `AppSessionTab`, открывает строка «Устройств» |
| `components/sidebarLeft/tabs/dataAndStorage/*.solid.tsx`, `autoDownload/*.solid.tsx` | `src/components/sidebarLeft/tabs/dataAndStorage/*`, `autoDownload/*` (812502980) | «Данные и память» и вкладки автозагрузки — задача 7 плана 2D; без строки потоковых чанков (О-6); React `settings/DataStorageSettings.tsx` снесён |
| `components/sidebarLeft/tabs/notifications.solid.tsx` | `src/components/sidebarLeft/tabs/notifications.tsx` (812502980) | «Уведомления и звуки» — пилот плана 2D (задача 6): первый экран на Solid `Row`/`Section` HEAD; без «All Accounts» (О-1) и секций Stories/Reactions/Other (О-3…О-5); React `settings/NotificationsSettings.tsx` снесён |
| `components/sidebarLeft/tabs/keyboardShortcuts.solid.tsx` | `src/components/sidebarLeft/tabs/keyboardShortcuts.tsx` (812502980) | «Горячие клавиши» (план 2D, задача 10): только обрабатываемые клиентом сочетания — без `InlineSelect` отправки, `JumpToInputStart/End` и секции Other (расхождения в шапке); React `settings/HotkeysSettings.tsx` снесён |
| `components/sidebarLeft/tabs/powerSaving.solid.tsx` + `components/checkboxFields.solid.tsx` | `src/components/sidebarLeft/tabs/powerSaving.tsx`, `src/components/checkboxFields.tsx` (812502980) | «Энергосбережение» — задача 11 плана 2D; открывает строка «Общих» через хост; пункт меню «Ещё» «Отключить анимации» пишет `liteMode.animations`, пункта «Lite Mode» при `liteMode.all` (`index.ts:946-954`) нет до задачи 28; React `settings/PowerSaving.tsx` снесён |
| `components/sidebarLeft/tabs/quickReaction.solid.tsx` | `src/components/sidebarLeft/tabs/quickReaction.tsx` (812502980) | «Быстрая реакция» — задача 14 плана 2D; открывает строка `DoubleTapSetting` React-экрана «Стикеры» через хост (до задачи 15); выбор не сохраняется (О-30); React `settings/QuickReaction.tsx` снесён |
| `components/sidebarLeft/tabs/addMembers.solid.tsx` + `components/appSelectPeers.solid.tsx` | `sidebarLeft/tabs/addMembers.tsx` + `components/appSelectPeers.tsx` (812502980) | вкладка выбора участников на селекторе пиров (план 2D, задача 16); без категорий/мини-приложений (О-33), участников канала, `peerLoader`, лимита — шапки файлов; открывающих пока нет (исключения приватности — задача 17) |
| `components/sidebarLeft/tabs/sharedFolder.solid.tsx` + `inviteLink.ts` | `src/components/sidebarLeft/tabs/sharedFolder.tsx`, `inviteLink.ts` (812502980) | вкладка ссылки папки «Share Folder» (план 2D, задача 25): открывает редактор папки (`openChatlistInvite`); ссылку показывает/копирует/удаляет, выбор чатов ссылки заблокирован (нет `editExportedInvite`, О-23), кнопки «Share Link» нет (попап 2C) |
| `components/sidebarLeft/columnSlider.ts` | `sidebarLeft/index.ts:147-152`, `:652-654`, `:1743-1753` | колоночный слайдер: `createColumnSlider`/`getColumnSlider` (роль синглтона `appSidebarLeft`, ВРЕМЕННО до 2-1), `item-secondary` у вкладок, `openActiveSessionsTab` для React-«Конфиденциальности» |

Навигация: `pushItem` оригинала разложен на два наших механизма — `navigationStack.pushLayer`
(Back) и `hotkeys.pushEsc` (Escape), потому что единого `appNavigationController` у нас нет
(разбор — в шапке `slider.ts`). В tweb обе кнопки обслуживает один контроллер
(`appNavigationController.ts:216-219`).

### Иконки строк настроек (волна 2A)

tweb 2197fee9c перевёл иконки всех строк на цветные плашки: `span.row-icon.row-icon-colored`
(30×30, скругление .625rem, `.75rem` от края, белый глиф) с градиентом inline из
`helpers/rowIconBackground.ts` (реестр «иконка → цвет» + FNV-хэш по палитре для прочих),
глиф — `span.tgico.row-icon-icon` внутри. **У нас** так рисуют обе строки: Solid
`rowTsx.solid.tsx` (ванильный `row.ts` снят задачей 29 плана 2D) и React `settings/kit.tsx` (для `<TgIcon>`;
у строк `accent`/`danger` — у tweb это `Button btn-primary btn-transparent` — и у не-глифов
плашки нет). Корень настроек (`sidebarLeft/tabs/settings.solid.tsx`) — строки `.row` в
`div.profile-buttons` (дамп 14-left-13) с иконками tweb `settings.tsx`: bell_filled (красная),
data_filled (зелёная), key_filled (серая), general_filled, limit_folders_filled (синяя),
reactions_filled, speaker_filled, devices_filled, web_filled, keyboard_filled; premium_badge
(`--premium-gradient`), star_circle_filled, gift_filled. Своей карточки phone/mention больше
нет — телефон и имя показывает `PeerProfile`. Строки
«Ночной режим» в корне больше нет, как и у tweb. Подэкраны переведены на имена tweb для тех же пунктов (privacyAndSecurity,
privacy-исключения, passcode, general, editChat, editContact). Строки сессий во вкладке
«Устройства» несут иконку платформы (`helpers/sessionPlatformIcon.ts`, tweb 944b578e9).
Тумблер перерисован (`_checkbox.scss` по ef41b29db), поля строки метятся
`row-checkbox-field`/`row-radio-field`/`row-checkbox-field-toggle` (`rowFieldClasses.ts`,
803f9599d) — `_row.scss` больше не стилизует любой `.checkbox-field` внутри `.row`.
Тумблер строки носит только `row-checkbox-field-toggle` — **так и у tweb HEAD**: ef41b29db снял с
него `row-checkbox-field` (`rowTsx.tsx:482-492`), а с этим классом правило
`.row .row-checkbox-field { position: absolute }` выбило бы тумблер из `.row-title-right`.
Прежняя запись «отступление» сверялась с 803f9599d и была неверна; пин —
`styles/twebDeltaW2a.test.ts`. Solid `Row` (`rowTsx.solid.tsx`) доведён до tweb HEAD задачей 0
плана 2D (`toggleAside`, радио справа, `contextMenu`, a11y, `element`-части); экраны на нём —
следующие задачи того же плана.

### Шов с React снят (задача 28 плана 2D)

Корень настроек — вкладка `AppSettingsTab` колоночного слайдера (`sidebarLeft/columnSlider.ts`),
как у tweb: `SidebarSlider` на `#column-left` с `navigationType: 'left'`, вкладка №0 — `.item-main`
React-колонки (узлом владеет React, вкладками — слайдер). Пункт «Settings» бургера —
`closeTabsBefore(() => slider.createTab(AppSettingsTab).open())` (tweb `index.ts:759-767`).
`has-open-tabs` — отражение `hasTabsInNavigation()` через `onTabsCountChange`: писатель один,
React о закрытии вкладки узнаёт только от слайдера (пин — `Sidebar.settingsTab.test.tsx`).
Хоста со своим слоем, заглушки №0, `settingsSliderHost.module.scss`, `SettingsView`,
`SettingsSubScreen` и типа навигации `'settings-popup'` больше нет.

Что осталось временным и почему:
- **модуль вместо класса** — `createColumnSlider`/`getColumnSlider` играют синглтон
  `appSidebarLeft`, пока колонку рисует React; снимает задача 2-1 волны 7;
- **`SidebarSlider.destroy()`** — колонка монтируется и размонтируется вместе с React-шеллом
  (выход из аккаунта, тесты); вкладки уходят с ней. Снимает Э4-1 (колонки из `index.html`);
- **React-экраны вкладками** (`sidebarLeft/reactScreenTab.tsx`) — «Конфиденциальность»,
  «Стикеры и эмодзи», «Динамики и камера», «Редактировать профиль» ещё на ките; классы вкладок
  уже tweb, содержимое — React-корень. Снимают 2D-23/15/26/27;
- **«Устройства» из React-«Конфиденциальности»** — `openActiveSessionsTab` (порт
  `newAuthorization.tsx:116-121`); корень открывает вкладку сам (`onDevicesClick`, tweb :354-383).

### Каркас экрана = вкладка (план 2D, задача 3)

Все экраны волны 2D встают в каркас `SliderSuperTab` + `scaffoldSolidJSTab` + колоночный
слайдер; пины — `components/sidebarLeft/settingsTabFrame.solid.test.tsx` (настоящая вкладка
«Язык» на колоночном слайдере, настоящий `transitionend`):

- **Шапка.** Вкладка при открытии несёт `scrolled-start scrolled-end scrollable-y-bordered`
  (`sliderTab.ts::_constructor` → `Scrollable.attachBorderListeners`, tweb `sliderTab.ts:84`,
  `scrollable.ts:456-465`); у верха шапка прозрачна (`_sidebar.scss:4-5`), прокрутка снимает
  `scrolled-start` → фон `--surface-color` и линия (`_sidebar.scss:89-95`, tweb :95-100).
  Фон вкладки — `.sidebar-slider-item { background-color: var(--background-color) }`
  (`_sidebar.scss:123-127`, tweb :130-132).
- **Переход.** `TransitionSlider({type: 'navigation'})`: контейнер `.animating`
  (`.backwards` назад), приходящая — из `translate3d(W,0,0)`, уходящая — в `-W/4` с
  `brightness(80%)`; `.animating` снимает `transitionend` ПРИХОДЯЩЕЙ (к концу `selectTab`
  `from = to`, tweb `transition.ts:372`, `:212`), `active` у уходящей — её собственный
  `transitionend` или предохранитель `transitionTime + 100`.
- **Первый переход** — от `.item-main`: уходящая вкладка первого открытия — сам список чатов,
  с параллаксом и затемнением, как у tweb (заглушки №0 больше нет, задача 28).
- **Кит.** `settings/kit.tsx::SettingsScreen` ведёт `scrolled-start` тем же `Scrollable`
  (`attachBorderListeners` на свой `div.scrollable`), а не ставит `scrollable-y-bordered`
  статически; обёртка саба этого класса не несёт. Строка-тумблер кита отменяет первый клик в
  фазе захвата — иначе активация label досылала второй `click` полю и тумблер щёлкал дважды.
  Пины — `settings/kit.test.tsx`.
- **Не портировано из HEAD-каркаса:** `SliderSuperTab.shown`/`resetShown` (34f417d12 — нужен
  поиску по настройкам и `internalLinkProcessor`, О-26 плана 2D) и
  `updateScrollRegionFocusable` (472e3e76b, a11y-волна).

### Что НЕ портировано

- **Четыре подэкрана настроек** — «Конфиденциальность» (с её саб-экранами), «Стикеры и эмодзи»,
  «Динамики и камера», «Редактировать профиль» — React-экраны `components/settings/*` на мосту
  `scaffoldReactScreenTab` (задачи 2D-23/15/26/27): задача порта меняет форму объявления в
  `solidJsTabs/tabs.ts` и удаляет React-экран.
- **`SettingsSliderPopup`** (`createTab`-override при свёрнутой колонке, `sidebarLeft/index.ts:1730-1741`):
  вкладка настроек в попапе — О-27 плана 2D (предмет появился с задачей 28, порт не сделан).
- **`providedTabs.ts`** — реестр вкладок, открываемых по имени в обход циклов импортов.
  `AppActiveSessionsTab` не входит в него и в оригинале.
- **`hasSomethingOpenInside`/`onSomethingOpenInsideChange`** (`index.ts:490-600`): классы
  `has-open-tabs`/`has-real-tabs` и «всплытие» свёрнутой колонки. У нас признак ведёт React
  (`Sidebar.tsx:184`, `:228`) по своему состоянию экранов, слайдер в него не пишет — иначе
  писателей стало бы два.
- **`removeByType`-ручка** (`sidebarRight/index.ts:95,128`): снять все слои навигации слайдера
  разом, снаружи и без спроса у вкладок. Потребителя нет: хост закрывает вкладки по одной.
- **`getInitArgs`-префетч** (`SliderSuperTab.getInitArgs`, объявлен, но никем не заполняется) и
  свайп-закрытие iOS (`isSwipingBackSafari` → `canAnimate: false`, см. шапку `slider.ts`).
- **Счётчик устройств** в строке настроек (`settings.tsx:166-176` + перечитывание по событию
  `destroy` вкладки): в нашей React-строке значения нет, поэтому и подписки нет.

---

## Проверка после порта

Прощёлкать на стенде, прежде чем говорить «готово».

- [ ] Бургер → настройки → вложенные экраны; Back работает на любую глубину.
- [ ] Настройки → «Устройства» (и «Конфиденциальность» → «Активные сессии»): вкладка въезжает
      справа, правый клик по чужой сессии → Terminate → строка исчезает, Escape закрывает вкладку,
      экран настроек под ней остаётся. Клик по строке → экран сессии въезжает поверх «Устройств»
      (с параллаксом), у чужой — кнопка «Terminate Session» → подтверждение → экран закрыт, строки нет.
- [ ] Поиск: пустое состояние, результаты по чатам, табы постов/медиа/ссылок/файлов/музыки/голосовых.
- [ ] Строка чатлиста: превью последнего сообщения, бейджи, онлайн-точка, typing, draft.
- [ ] Сортировка и закреплённые вверху; папки переключаются без перерисовки всего списка.
- [ ] Архив: строка, вход, выход.
- [ ] Контекст-меню диалога: набор пунктов для чата, группы, канала.
- [ ] Создание группы: выбор участников → имя → создание.
- [ ] Схлопнутая и плавающая левая колонка на узком экране.

Машинная сверка разметки: снять DOM через `tools/tweb-parity/snapshot-dom.js` и
сравнить с эталоном — `node tools/tweb-parity/dom-parity.mjs <дамп> ours.txt`.
Подходящие дампы: 14-left-01…36, 02-chatlist, 10-global-search, 08-burger-menu.
