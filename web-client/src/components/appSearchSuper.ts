// Порт tweb `src/components/appSearchSuper.ts` (2843) — ЯДРО класса: разметка
// подсистемы, полоса вкладок, слайдер содержимого, ПАМЯТЬ ПОЗИЦИИ СКРОЛЛА,
// свайп между вкладками, очистка и смена пира, плюс ЗАГРУЗКА данных вкладок
// (`load`/`loadType`/`performSearchResult`).
//
// Разбор подсистемы с адресами — `docs/tweb/shared-media.md` § 1.3, § 1.4, § 1.9;
// план этапа — `docs/superpowers/plans/2026-09-07-solid-wave-3-shared-media.md`,
// задачи 5-6. Эталон разметки — живой дамп Telegram
// `docs/tweb/dom/dumps/07-right-sidebar.json:121-308` (дамп — ОДНА физическая
// строка JSON; здесь и ниже нумерация по РАЗВЁРНУТОМУ тексту, где первая
// строка — первая, `json.load(...).split('\n')`).
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧТО ЗДЕСЬ ЕЩЁ НЕ ЖИВЁТ (и почему это не заглушки, а пропуски)
//
// Класс в оригинале — один файл на всю подсистему, и портируется он этапами
// (задачи 5→14 плана). Места, где оригинал зовёт ещё не приехавшее, помечены
// комментарием со ссылкой на строку tweb и номер задачи; когда задача
// приедет, вызов встанет ровно туда. Заглушка, которую никто не зовёт, —
// мёртвый код (`CLAUDE.md`), поэтому пустых полей и методов здесь нет.
//
// Задача 14 — выделение (`SearchSelection`, `chat/selection.ts:662-839`) и
// меню элемента (`SearchContextMenu`, ниже, `:182-386`) — портирована СРАЗУ
// ПО НОВОМУ tweb, 812502980 (адреса в её коде и в расхождениях 51-54 — по
// нему; остальной файл писан по e52b5d931).
//
// ─────────────────────────────────────────────────────────────────────────────
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//
//  1. Снято задачей 2 плана папок
//     (`docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`):
//     градиент строит `Tabs.MenuGradient` из `components/tabs.solid.tsx`,
//     как у оригинала (`tweb:596-600`). Номер оставлен, чтобы ссылки на
//     остальные пункты не поехали.
//  2. `createRoot` вокруг `Section` (`tweb:567-576`) у нас ВОЗВРАЩАЕТ dispose,
//     и `destroy()` его зовёт. В оригинале корень не утилизируется никогда —
//     у нас `destroy()` обязан не оставлять следов (DoD 5 спеки волны 3).
//  3. `lazyLoadQueue.lock()`/`unlockAndRefresh()` под `useHeavyAnimationCheck`
//     (`tweb:793-795`) не портированы: наш `core/lazyLoadQueue.ts` — сокращённый
//     порт (`push`/`clear`), ручек паузы у него нет. Гасить очередь на время
//     тяжёлой анимации станет нечем до тех пор, пока очередь не дорастёт; на
//     ядро это не влияет — задачи в неё кладёт рендер (задачи 7-9).
//  4. Снято задачей 8 плана поиска: `searchGroupMedia` создаётся (`tweb:607`)
//     и чистится в `cleanupHTML` (`:2791`), как у оригинала.
//  5. `slider`/`appSidebarRight` (поле `tweb:432`, опция `:450`, дефолт `:453`)
//     не в опциях: поле нужно только вкладкам «участники»/«похожие каналы»
//     для открытия подэкранов (задачи 11-12).
//  6. `managers` (`tweb:419` — весь `AppManagers`) сужены до двух ручек
//     (`SearchSuperManagers`): подсистема ходит только за историей — шов
//     `messages.searchHistory`, порт `getHistory`/`requestHistory` (ручку по
//     контексту выбирает воркер), — и за счётчиками вкладок. Узкий шов и
//     проверяем узко.
//  7. ВЛАДЕНИЕ СКРОЛЛЕРОМ. Правило у нас такое: скроллер уничтожается только
//     если создан и принадлежит классу. Оригинал ему удовлетворяет даром —
//     `this.scrollable.destroy()` (`tweb:2831`) там роняет скроллер, который
//     создан владельцем класса (вкладка сайдбара, `sliderTab.ts:66`) и умирает
//     вместе с ним (`sliderTab.ts:109` роняет его же ещё раз), третьих
//     читателей у него нет. У нас (задача 13 плана) тот же скроллер ОБЩИЙ с
//     шапкой профиля и переживает подсистему: его создаёт и роняет хозяин —
//     хук `core/hooks/useSearchSuper.ts` (роль `SliderSuperTab`), на его
//     `onAdditionalScroll` сидит шапка панели (`sharedMedia.tsx:484-493`).
//     Развилка закрыта В ПОЛЬЗУ ХОЗЯИНА: `destroy()` скроллер НЕ роняет, а
//     снимает только то, что класс повесил сам — свой `onScrolledBottom`
//     (`:616-621`), и только если хозяин не переназначил его после. Отказ при
//     регрессе был бы тихим (`Scrollable.destroy()` лишь снимает слушателей и
//     обнуляет колбэки, `components/scrollable.ts:227-232`), поэтому пин
//     `appSearchSuper.seam.test.ts` проверяет доставку настоящего `scroll` до
//     колбэка хозяина ПОСЛЕ `destroy()`.
//  8. `destroy()` дополнительно СНИМАЕТ контейнер из DOM (`container.remove()`),
//     чего в оригинале нет вовсе: там узел снимает владелец вместе со своим
//     экраном, у нас его обязан убрать сам класс (DoD 5 — «после destroy() узлов
//     класса в документе нет»). Обратная сторона того же расхождения: `selectTab`
//     мы НЕ обнуляем, хотя оригинал обнуляет (`tweb:2837`) — поле объявлено
//     `selectTab!: SelectTab` и под `strictNullChecks` (в tweb он выключен)
//     присвоение `undefined` не проходит по типу; после `destroy()` вызов
//     `selectTab` безопасен — слушатели сняты, а переключение уже мёртвого
//     дерева ничего не наблюдает.
//  9. Снято задачей 8 плана поиска: курсор глобальной выдачи `nextRate`
//     портирован — поле контекста, запрос (`:2288`), вторая ветка критерия
//     «всё загружено» (`:2312`), запись (`:2321`), сброс в `cleanup` (`:2718`).
// 10. `filterMessagesByType` (`tweb:822-824`) делегирует в оригинале общей
//     утилите `filterMessagesByInputFilter` (её потребителей у нас нет); сюда
//     перенесена только её ветка `inputMessagesFilterUrl`
//     (`filterMessagesByInputFilter.ts:121-126`): сущности ЛИБО `matchUrl`
//     текста, дословно. Дословность и есть расхождение — с БЭКЕНДОМ: его
//     фильтр `links` — регексп `https?://` по тексту
//     (`messagesrepo.go::mediaFilterCond`), поэтому живой апдейт покажет во
//     вкладке ссылку без схемы или за текстом-якорем, которой следующая
//     страница с сервера уже не принесёт. Объявлено в
//     `docs/tweb/shared-media.md` § 3, снимается задачей 15 плана (фильтр по
//     сущностям на бэкенде).
// 11. Снято задачей 8 плана поиска: `searchGroups`/`searchGroupMedia` в
//     `performSearchResult` (`tweb:1106-1128`, `:1189-1194`) и
//     `processEmptyFilter` (`:826-871`) портированы.
// 12. Вставка НЕСКОЛЬКИХ узлов в начало (`append: false`) идёт обратным
//     обходом. Оригинал (`tweb:1214-1229`) обходит список вперёд и зовёт
//     `prepend` на каждом — порядок при этом переворачивается. У него это не
//     видно: живой апдейт всегда несёт ровно одно сообщение
//     (`sharedMedia.tsx:247`). Портировать переворот значит закладывать
//     дефект под первый же альбом; правим и объявляем.
// 13. «Чувствительный контент» не портирован: `isMessageSensitive`
//     (`tweb:2371-2373`), `hasSensitiveSpoiler`/`skipSensitive` в клике
//     (`:738-744`, `:757`) и `sensitive` у крышки (`:912-925`). Это отдельная
//     аккаунт-настройка Telegram с проверкой возраста, у нас нет ни её API, ни
//     поля у медиа — та же причина, что в шапке `wrappers/mediaSpoiler.ts`.
//     Крышка ставится ровно по `pFlags.spoiler` (`isMediaSpoiler`).
// 14. Медиавьювер. Оригинал (`tweb:757-766`) заводит `new AppMediaViewer()`,
//     отдаёт ему копию контекста поиска (`setSearchContext`) и `prevTargets`/
//     `nextTargets` из `{element, mid, peerId}` — сообщения вьювер спрашивает у
//     менеджера сам. У нас один живой вьювер (`mediaViewer/openMediaViewer.ts`)
//     с плоским `items` + `index`, и каждая цель — ГОТОВЫЙ `ViewerItem`
//     (`messageToViewerItem`), собранный из кэша вкладки
//     (`getSharedMediaMessage`) — того самого, из которого плитка и нарисована;
//     RPC `getMessageByPeer` (`:737`) сюда не нужен. Роль `setSearchContext`
//     (листать за пределы плиток тем же контекстом поиска) исполняет
//     `loadMoreMedia` поверх `createMediaNeighboursLoader` на шве
//     `searchHistory` с копией контекста; загрузчик живёт одно открытие, как
//     `SearchListLoader` у оригинала, но страницы берёт с сети, а не из кэша
//     менеджера, и листает С НАЧАЛА выдачи до якоря — поэтому курсор
//     `nextRate` у него свой, а не вкладки (у оригинала — `copySearchContext(
//     inputFilter, this.nextRates[type])`, `:757`, `:2795-2801`). Отдельного
//     метода `copySearchContext` нет: копия берётся на месте.
// 15. `onMediaClick` — метод класса, а не замыкание конструктора
//     (`tweb:716-767`): в конструкторе остаётся только подписка, тело лежит
//     рядом с `processPhotoVideoFilter`, чтобы задачи 8-9 (документы, ссылки)
//     не правили конструктор одновременно.
// 16. `multiply: 0.3` у `wrapMediaSpoiler` (`tweb:924`) не передаётся: в
//     оригинале он доезжает только до ЗАКОММЕНТИРОВАННОГО `resize`
//     (`tweb/src/components/dotRenderer.ts:331`), у нашего `DotRenderer.create`
//     такого параметра нет.
// 17. `this.log.warn`/`this.log.error` (`tweb:722`, `:1178`) — логгера у
//     подсистемы нет (см. `loadType`); клик без `data-mid` молча игнорируется,
//     ошибка рендера одного сообщения — как в оригинале — не роняет партию, но
//     и не логируется.
// 18. `processDocumentFilter` НЕ передаёт врапперу `searchContext`
//     (`tweb:951`, `copySearchContext(inputFilter, this.nextRates.files, false)`).
//     У оригинала контекст нужен контроллеру плеера, чтобы ДОГРУЖАТЬ очередь
//     с сервера за границей отрисованного и понять, что очередь пора
//     пересобрать; у нашего контроллера очередь идёт значением и собирается
//     на каждый запуск сканом соседей (шапка `components/audio.ts`). Сам
//     источник очереди «элементы вкладки» портирован ветвью `search-super-item`
//     в `findMediaTargets` (tweb `audio.ts:461-462`). Копию контекста у нас
//     берёт только медиавьювер — расхождение 14.
// 19. `lazyLoadQueue` (`tweb:952`) врапперу не передаётся: у `wrapDocument`
//     оригинала очередь нужна только обложке трека, которой у нас нет
//     (шапка `components/audio.ts`).
// 20. Шов менеджеров (расхождение 6) расширен третьей ручкой —
//     `peers.fillMirror`: имя отправителя в подписи «кто ➝ куда»
//     (`wrapSenderToPeer`) строит `PeerTitle`, а тот обязан объявить пробел
//     зеркала карточек владельцу. У оригинала это `rootScope.managers`
//     внутри самого враппера.
// 21. `message.totalEntities` (`tweb:968`) → `message.entities`. У tweb это
//     сущности сервера, СЛИТЫЕ с найденными клиентом (`parseEntities`); у нас
//     такое поле не производится. Ссылку без серверной сущности находит та же
//     ветка `matchUrl` (`:971-977`), которой оригинал обходится для сообщения
//     без сущностей вовсе, — исход тот же, только чаще через неё.
// 22. Наша `WebPage` (`core/media/messageMedia.ts`) — только конструктор
//     `webPage`: проверке `webPageEmpty` (`tweb:1020-1022`) не на что
//     сработать, а у синтетической карточки (`:1010-1017`) нет `pFlags`/`id`/
//     `hash` — полей нет в модели, значений для них — тоже.
// 23. Inline `onclick` якоря, переносимый на строку (`tweb:1080-1081`), у нас
//     запрещён (шапка `lib/richtext/url.ts`): действие внутренней ссылки живёт
//     в `data-anchor-action`, и на строку переносится он.
// 24. Снято задачей 8 плана поиска: `showSender` в `processUrlFilter`
//     (`tweb:1061-1063`) портирован; рендерер остаётся синхронным, потому что
//     синхронен наш `wrapSenderToPeer` (его шапка).
// 25. `wrapPlainText(display_url…)` (`tweb:1057`) без сущностей — тождество
//     (`wrapPlainText.ts:7-13`); хост дописывается строкой.
// 26. `canViewSaved` (`tweb:2627-2643`), `canViewGroups` (`:2658-2664`) и
//     `canViewSimilar` (`:2686-2699`) возвращают `false` без похода в сеть:
//     вкладок `saved`/`groups`/`similar` нет — задачи 17/16/18 плана
//     («Отложено»). У первых двух нет и ручки бэкенда; у `similar` ручка есть,
//     но без вкладки запрос рекомендаций на каждое открытие чата — впустую
//     (оригинал зовёт его безусловно, `:2692`).
// 27. `canViewMembers` (`tweb:2644-2657`) три вопроса о чате задаёт не RPC
//     `appChatsManager.isBroadcast/hasRights/isForum`, а зеркалу карточек
//     (`core/peerCache.ts`) после объявления пробела `peers.fillMirror`; сами
//     предикаты — порт тех же функций. Действие `view_participants` добавлено
//     в `ChatRights` (порт `hasRights.ts:140-142`).
// 28. `canViewStories` (`tweb:2665-2685`): ветка пользователя спрашивает
//     `stories.pinnedStories(peerId)` без `limit` и судит по длине списка (у
//     ручки нет `count`); ветка чата — `false`, флага
//     `stories_pinned_available` у нашей `ChannelFull` нет; `storiesArchive`
//     (`:2674-2676`) не портирован — такой опции у класса нет (задача 19).
// 29. Шов менеджеров (расхождения 6 и 20) расширен тремя ручками первого
//     показа: `chats.savedDialogs` вместо `dialogsStorage.getDialogs`
//     (`canViewSavedDialogs`), `stories.pinnedStories` (`canViewStories`),
//     `stars.profileGifts` вместо `stargifts_count` полной карточки
//     (`getGiftsCount`, `tweb:2704-2712` — поля у нас нет, считается длина
//     списка; и раз это запрос, а не чтение кэша, без вкладки `gifts` он не
//     уходит). В треде `getGiftsCount` отдаёт `0`, а не `undefined`: счётчик
//     типизирован числом, на видимость это не влияет. ЦЕНА: при наличии
//     вкладки `gifts` список подарков запрашивается ДВАЖДЫ — первым показом
//     ради счётчика и витриной (`loadGifts`, задача 12) ради плиток; у
//     оригинала счётчик лежит в карточке и запроса не стоит. Лекарство —
//     `stargifts_count` в полной карточке на бэкенде (DoD 2a), не кэш в
//     клиенте.
// 30. `updateContainerHidden` (`tweb:2520-2529`) — `public`, а не `private`:
//     вызывающих в классе два (`onCountChange` подарков, `:2151-2154`,
//     задача 12, и `updateMediaTabVisibility`, ca1416807), а пересчёт
//     видимости пинуется напрямую —
//     `appSearchSuper.firstTime.test.ts` зовёт метод сам.
// 31. `loadMembers` (`tweb:1525-1758`) портирован ОДНОЙ веткой — канала
//     (`:1718-1739`, `getChannelParticipants` → наш `groups.channelParticipants`).
//     Ветка «общих групп» (`userId`/`getCommonChats`, `:1696-1717`) — ручки
//     нет (`docs/tweb/shared-media.md` § 3), поэтому `groups` в `loadType` на
//     `loadMembers` не заводится; ветка legacy-чата (`getChatFull`,
//     `:1740-1756`) — базовый `chat` бэкенд не производит вовсе (решение №2
//     разбора, `core/peers/peerId.ts::getOutputPeer`).
// 32. ЖИВЫЕ ОБНОВЛЕНИЯ состава. Кадра `updateChannelParticipant`
//     (`chat_participant`, `:1627-1645`) на проводе нет: бэкенд на любое
//     изменение состава публикует `updateChannelFullSnapshot`
//     (`usecase/chat/group.go:153`, `:203`) — у нас `rt:chat_update`. Класс
//     обрабатывает его так, как оригинал обрабатывает `chat_full_update`
//     legacy-чата (`:1598-1625`): перечитывает список и сводит — новых рисует,
//     ушедших снимает. Отличия от той ветки навязаны проводом: `channelFull`
//     вектора `participants` не несёт, поэтому перечитывается ОТРИСОВАННОЕ
//     ОКНО списка ручкой участников (`offset: 0, limit: nextRates`), а счётчик
//     берётся из `count` ответа (как в самой ветке канала, `:1736`), а не
//     ±1 на строку (`:1589`, `:1594`). Кадр общий на 13 поводов бэкенда
//     (`publishChatUpdate`) — каждый из них перечитывает окно, пока список
//     жив. Настоящее лекарство — кадр по участнику на бэкенде, см. § 3 дока.
// 33. `slider`/`appSidebarRight` (расхождение 5) для участников заменены
//     двумя колбэками хоста в опциях: `openPeer` — вместо
//     `appImManager.setInnerPeer({peerId})` (`:1569`; `toggleSidebar(false)` на
//     мобиле, `:1564-1566`, — тоже дело хоста) и `openUserPermissions` — вместо
//     `openUserPermissionsTab(slider, …)` из меню участника (Solid-вкладка
//     `AppUserPermissionsTab` не портирована). Оба опциональны и зовутся через
//     `?.`, как остальные колбэки хоста в этом классе.
// 34. Проверка карточки участника (`:1667-1678`, `appPeersManager.getPeer`) —
//     по ЗЕРКАЛУ (`cachedPeer`); пробел объявляется владельцу через
//     `peers.fillMirror` (шов расхождения 20). Шов менеджеров расширен ручкой
//     `groups` (`channelParticipants` + действия меню участника).
// 35. `nextRates` (`tweb:378`) держит и смещение страницы участников
//     (`:1723`, `:1730`), и курсор глобальной выдачи (`:2288`, `:2321`) — одно
//     пер-типовое поле на оба, как у оригинала; сброс в `cleanup` (`:2718`).
// 36. Solid-вкладка «Подарки» монтируется мостом `mountSolid`
//     (`shared/solid/mountSolid.solid.tsx`, `ErrorBoundary` сдерживания), а не
//     прямым вызовом компонента внутри своего `createRoot` (`tweb:2137-2168`). `store`/`actions` витрины класс получает `ref`-пропом
//     (`stargifts/profileList.solid.tsx`, «Форма шва с классом»), а не из
//     возврата функции; `getFirstChild(giftsList)` (`:2165`) не нужен — мост
//     сам кладёт дерево в `itemsTab`.
// 37. `stargiftsStore`/`stargiftsActions` СБРАСЫВАЮТСЯ по `middleware.onClean`
//     (`cleanup()` → смена пира). В оригинале поля живут вечно (`cleanup`
//     `:2714-2754` их не трогает): там `setQuery` зовётся один раз на
//     экземпляр вкладки (`sharedMedia.tsx:47-58`), у нас класс переживает
//     смену пира, и без сброса `canLoadMediaTab` (`:2363-2365`) считал бы
//     витрину прошлого пира дочитанной.
// 38. `setPinnedGifts` (`tweb:2579-2610`) рисует СИМВОЛ подарка (`gift.emoji`)
//     вместо стикера `wrapSticker({static: true, doc: gift.sticker, 18×18})`:
//     в модели внешность подарка — unicode-символ, документа-стикера нет
//     (`core/messages/messageAction.ts`, докблок `StarGift`). Узел несёт тот же
//     класс `media-sticker-wrapper`, которым его метит `wrapSticker`, — на него
//     рассчитан `.search-super-pinned-gifts .media-sticker-wrapper`
//     (`_searchSuper.scss:415-419`).
// 39. Перехват свайпа вкладкой `gifts` (`tweb:508-511`,
//     `stargiftsActions.handleSwipe(xDiff, stargiftsSetCollection)`) не
//     портирован: `handleSwipe` листает КОЛЛЕКЦИИ подарков, а коллекций у
//     ручки `GET /users/{id}/gifts` нет (`stargifts/profileStore.solid.ts`).
//     Вкладка `stories` (`:513-515`) в правой колонке у нас не вкладка
//     (`docs/tweb/shared-media.md` § 2.1).
// 40. `loadSavedDialogs` (812502980 `:2214-2265`) — порт: `AutonomousSavedDialogList`
//     (`autonomousDialogList/savedDialogs.ts`, задача 1-7 волны 7) +
//     `SortedDialogList`. Отличия: владельца списков (`appDialogsManager`) класс
//     — синглтон модуля, как у tweb;
//     набор приезжает ОДНИМ ответом (`chats.savedDialogs`), поэтому `side` не
//     читается, а счётчик — число строк страницы, а не повторный
//     `dialogsStorage.getDialogs` (расхождения 1, 8 списка); меню строки и
//     перестановка закрепов (`withContext`, `attachPinnedReorder`) — О-111;
//     `openSavedDialogsInner` (`:485`, `sharedMedia.tsx:803`) не в опциях: окна
//     сохранённого диалога у нас нет (О-110), клик открывает чат источника
//     (`setListClickListener`, `lib/appDialogsManager.ts`).
// 41. Опция `asChatList` (`tweb:408`, `:444`) не заводится: у оригинала её
//     ПИШЕТ левая колонка (`sidebarLeft/index.ts:1165`) и не читает никто —
//     ни класс, ни кто-либо ещё (`grep -rn asChatList tweb/src` — три
//     вхождения, все три объявление и запись). Поле без читателя — мёртвый код.
// 42. `processEmptyFilter` (`tweb:826-871`) — в объёме нашей строки чатлиста
//     (`lib/appDialogsManager.ts`, шапка «что НЕ портировано»): опций
//     `withStories`/`fromName`/`loadPromises`/`dontSetActive` у
//     `DialogElement` нет, поэтому промисы аватара партию не ждут (ждёт только
//     `setLastMessageN`). Ветка `isSaved` (`:827-832`, `noForwardIcon`) — без
//     вкладки `saved` (расхождение 26); `getPeerMigratedTo` (`:833`) — миграции
//     legacy-чата в супергруппу у бэкенда нет (`core/peers/peerId.ts::getOutputPeer`,
//     план глобального поиска, «Отложено» п. 22). Группа `searchGroupMedia`
//     (`:607`) получает `middleware` своего хелпера, и `destroy()` гасит её
//     Solid-корень — у оригинала корень не утилизируется (то же, что
//     расхождение 2); пин — `appSearchSuper.dom.test.ts` (счёт корней).
// 51. Действия меню элемента и плашки выделения — колбэки хоста в опциях,
//     как `openPeer`/`openUserPermissions` (расхождение 33):
//     `setInnerPeer` — вместо `appImManager.setInnerPeer` (812502980 `:342-348`,
//     `chat/selection.ts:782-793`). «Скачать» (`ChatContextMenu.onDownloadClick`,
//     `:297`, `:302`) — сам, через `appDownloadManager`, как у оригинала.
//     Пересылка и удаление (`:357-385`, `selection.ts:795-822`) с П-5 зовут
//     попапы напрямую, как оригинал: `popups/forward.bridge.ts` (ВРЕМЕННО до
//     2C-24) и `popups/deleteMessages.ts`.
// 52. `SearchContextMenu` берёт сообщение из кэша shared media
//     (`getSharedMediaMessage`) — тот, из которого элемент и нарисован, —
//     а не RPC `getMessageByPeer` (`:233`); выбранные — так же
//     (`SearchSelection.getSelectedMessages`). «Можно переслать» — `message._
//     === 'message'`: остальных слагаемых `canForward` (`noforwards`
//     сообщения и пира, `ttl_seconds`) в модели нет, та же граница, что у
//     меню ленты (`ContextMenuChat.canForward`). «Можно удалить» — общий порт
//     `core/messages/canDeleteMessage.ts`.
// 53. `destroy()` снимает узел меню из документа (`search-contextmenu`). У
//     оригинала меню, однажды положенное в `getOverlayRoot()` (`:339`),
//     живёт там вечно; у нас `destroy()` обязан не оставлять следов (DoD 5,
//     то же, что расхождение 8).
// 54. `ChatContextMenu.canDownload`/`canCopyMedia` зовутся без четвёртого
//     аргумента `attachTo` (`:292`, `:298`, `:303`): у оригинала это носитель
//     ветки сенситив-медиа `canDownload`, которой у нас нет (расхождение 13,
//     докблок `canDownload` в `chat/contextMenu.ts`).
// 43. `loadType` не передаёт `offsetPeerId` (`tweb:2280`, `:2286`) и не читает
//     `value.isEnd.top` (`:2314`). Первое — половина курсора `searchGlobal`
//     (`offset_peer`), которая нашему серверу не нужна: «rate» — номер
//     последнего отданного сообщения в глобально монотонной нумерации
//     (`docs/tweb/global-search.md` часть 3). Второго нет в ответе шва: края
//     слайса выводит кэш истории менеджера оригинала, а у поисковых ручек его
//     нет — конец выдачи говорят длина страницы и отсутствие `nextRate`.
// 44. Источники `loadChats`/`loadChannels`/`renderPeerDialogs` (задача 9 плана
//     поиска). Шов менеджеров расширен тремя ручками: `contacts.getContactsPeerIds`,
//     `channels.search` (роль `appUsersManager.searchContacts`) и
//     `dialogs.getDialogs`. `channels.search` отдаёт `contacts.found` как есть —
//     ССЫЛКИ `Peer` и тела (так их читал снесённый задачей 13 React-экран поиска), поэтому
//     перевод в ключи и дедуп `my_results` (`appUsersManager.ts:1089`) сделаны
//     здесь, а не в менеджере; тела менеджер отдаёт владельцу карточек до
//     ответа, как `saveApiUsers`/`saveApiChats` (`:1085-1086`). Карточка
//     (`getPeer`, `getPeerUsername`, `getUser`, `isBroadcast` — RPC у
//     оригинала) читается из зеркала после объявления пробела `peers.fillMirror`
//     (метод `getPeer`, как в расхождении 34); `getPeerActiveUsernames` — одно
//     `username`, вектора `usernames` у модели нет. `getCachedDialogs()`
//     (`:1995`) — зеркало диалогов `useChatsStore` в порядке `REAL_FOLDERS`
//     (основная папка, затем архив). `useAppState()` (`:1451`) — zustand-стор
//     State: ключ `recentSearch` переведён в сигнал, по которому работает
//     `For` оригинала. Подписи — наши порты тех же функций:
//     `getChatMembersString` отдаёт строку по форматтеру языка,
//     `getUserStatusString` (`core/presence.ts`),
//     `formatPhoneNumber` → `formatUserPhone` (`core/format/phone.ts`).
// 45. Кнопка «show more» группы «Global search» прошлого запроса снимается
//     сигналом группы (`needShowMoreButton('')`), а не удалением узла из
//     заголовка (`:1432-1434`). Удаление узла — пережиток группы до Solid, где
//     кнопку дописывали в `nameEl` руками; поверх Solid-группы оно снимает узел,
//     которым владеет мемо, а повторный `needShowMoreButton('is-short')` того
//     же значения мемо не будит — у оригинала второй запрос с >3 глобальными
//     результатами остаётся без кнопки. Сброс стоит ДО ручного `is-short`:
//     пересчёт класса группы затирает добавленное руками.
// 46. Не портировано из `loadChats`/`loadChannels`/`renderPeerDialogs`:
//     реклама в «Global search» (`getSponsoredPeers`, `:1373-1421`) — вне
//     продукта (`roadmap.md`, «Что в план НЕ входит»); лента «люди»
//     (`createTopPeersList`, `:1503-1517`) — ручки топа собеседников нет, группа
//     `people` у владельца остаётся скрытой (задача 14 плана поиска); группа
//     «SimilarChannels» (`:2009-2018`) — глобальных рекомендаций каналов у
//     бэкенда нет (задача 15); ветки ботов `renderPeerDialogs`
//     (`bot_active_users`, `UnknownBotUsers`, `:1961-1966`) вместе с параметром
//     `type` — их зовёт только вкладка `apps` (задача 16), а поля
//     `bot_active_users` у модели нет; опции строки `withStories`
//     (`:1345`, `:1469`, `:1475`) — у `DialogElement` её нет (расхождение 42);
//     `meAsSaved` — по умолчанию `true`, как у оригинала; параметр `showMembersCount`
//     (`:1329`) не читается и у оригинала.
// 47. Две проверки жизни, которых у оригинала нет. `loadChannels` после ответа
//     `contacts.search` сверяет `middleware`: без неё ответ прошлого запроса лёг
//     бы в вкладку нового и выставил бы ей `loaded` (`cleanup` к этому моменту
//     уже обнулил его), и новый запрос каналов не ушёл бы. Строка «Recent» гасит
//     свой хелпер (`onCleanup`), когда `For` её снимает, — у оригинала хелпер
//     строки не гасится никогда, и её аватар с именем слушают зеркало вечно.
// 56. `ScrollableRefiller` (tweb fb18166dc, B8) портирован без двух
//     `refiller.reset('media')` оригинала (812502980 `:1053`, `:1120`): они
//     стоят в переключении фильтра вкладки «Медиа» фото/видео (553143f1e),
//     которого у нас нет — нет ни меню шапки, ни фильтров `photos`/`videos` на
//     бэкенде (BLOCKED, `docs/tweb/delta/README.md`). Приедет фильтр — сброс
//     встанет в оба места. E2E-спека `profileSidebarIdle.spec.ts` (нужен
//     вошедший клиент) заменена шовным пином `appSearchSuper.refill.test.ts`:
//     живой `Scrollable` в неполном окне, счёт вызовов `load`.
import Scrollable, { ScrollableX } from '@components/scrollable'
import ScrollableRefiller from '@components/scrollableRefiller'
import { horizontalMenu } from '@components/horizontalMenu'
import type { SelectTab } from '@components/horizontalMenu'
import { createLazyLoadQueue, type LazyLoadQueue } from '@core/lazyLoadQueue'
import { putPreloader } from '@components/putPreloader'
import ripple from '@components/ripple'
import Section from '@components/section.solid'
import Tabs from '@components/tabs.solid'
import { i18n, join, type LangPackKey } from '@lib/langPack'
import findUpClassName from '@helpers/dom/findUpClassName'
import { getMiddleware } from '@helpers/middleware'
import ListenerSetter from '@helpers/listenerSetter'
import type SwipeHandler from '@core/dom/swipeHandler'
import handleTabSwipe from '@helpers/dom/handleTabSwipe'
import lockTouchScroll from '@helpers/dom/lockTouchScroll'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import safeAssign from '@helpers/object/safeAssign'
import type { ScrollStartCallbackDimensions } from '@helpers/fastSmoothScroll'
import { createRoot } from 'solid-js'
import type { Middleware } from '@helpers/middleware'
import type { Managers } from '@/client/bootstrap'
import { isDialogArchived, type MyMessage } from '@core/models'
import { getMessageKind } from '@core/messages/messageKind'
import { getSharedMediaMessage, saveSharedMediaMessages } from '@components/sharedMediaHistories'
import showForwardPopup from '@components/popups/forward.bridge'
import showDeleteMessagesPopup from '@components/popups/deleteMessages'
import { ChatType } from '@components/chat/chatType'
import { getHeavyAnimationPromise } from '@core/dom/heavyAnimation'
import windowSize from '@helpers/windowSize'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import { choosePhotoSize, getMediaFromMessage, isMediaSpoiler } from '@core/media/messageMedia'
import wrapPhoto, { type WrappedPhoto } from '@components/wrappers/photo'
import wrapVideo from '@components/wrappers/video'
import wrapMediaSpoiler, { onMediaSpoilerClick } from '@components/wrappers/mediaSpoiler'
import { openMediaViewer, type OpenMediaViewerArgs } from '@components/mediaViewer/openMediaViewer'
import { messageToViewerItem, type LightboxCtx } from '@components/mediaViewer/collectLightboxItems'
import type { ViewerItem } from '@components/mediaViewer/appMediaViewer'
import { createMediaNeighboursLoader } from '@components/mediaViewer/mediaNeighbours'
import rootScope from '@lib/rootScope'
import { cachedChat, cachedPeer, hasRightsPeer, isBroadcastPeer, isForumPeer } from '@core/peerCache'
import { useI18nStore } from '@/i18n'
import wrapDocument from '@components/wrappers/document'
import { getDocumentFromMessage, type MyDocument } from '@core/media/messageMedia'
import { renderSearchWebPageRow } from '@components/searchWebPageRow.solid'
import wrapWebPageTitle from '@components/wrappers/webPageTitle'
import wrapWebPageDescription from '@components/wrappers/webPageDescription'
import wrapSentTime from '@components/wrappers/sentTime'
import type { WebPage } from '@core/media/messageMedia'
import { wrapAbbreviation } from '@lib/richtext/abbreviation'
import wrapRichText from '@lib/richtext/wrapRichText'
import { ANCHOR_ACTION_ATTRIBUTE, matchUrl } from '@lib/richtext/url'
import setInnerHTML from '@helpers/dom/setInnerHTML'
import SortedUserList from '@components/sortedUserList'
import createParticipantContextMenu, { type Participant } from '@helpers/dom/createParticipantContextMenu'
import appDialogsManager, { addDialogNew, DIALOG_LIST_ELEMENT_TAG, setLastMessageN, type DialogDom } from '@lib/appDialogsManager'
import { ALL_FOLDER_ID } from '@core/folderIds'
import { createSearchGroup, type SearchGroup, type SearchGroupType } from '@components/searchGroup.solid'
import wrapSenderToPeer from '@components/wrappers/senderToPeer'
import { setTransition } from '@core/dom/setTransition'
import liteMode from '@helpers/liteMode'
import { INPUT_FILTER_WIRE, type MessagesWireFilter, type MyInputMessagesFilter } from '@core/messages/inputMessagesFilter'
import type { SearchHistoryOptions } from '@core/managers/messagesManager'
import findUpTag from '@helpers/dom/findUpTag'
import filterAsync from '@helpers/array/filterAsync'
import findAndSplice from '@helpers/array/findAndSplice'
import findAndSpliceAll from '@helpers/array/findAndSpliceAll'
import type { MiddlewareHelper } from '@helpers/middleware'
import { getParticipantPeerId, getParticipantRank } from '@core/peers/participant'
import { getPeerId, isAnyChat, isUser, toChatId } from '@core/peers/peerId'
import { RT, type ChatUpdateEvt } from '@core/realtime/events'
import { children, createEffect, createSignal, For, on, onCleanup } from 'solid-js'
import { unwrap } from 'solid-js/store'
import { mountSolid } from '@shared/solid/mountSolid.solid'
import { StarGiftsProfileTab, type StarGiftsProfileTabProps } from '@components/stargifts/profileList.solid'
import type { StarGiftsProfileActions, StarGiftsProfileStore } from '@components/stargifts/profileStore.solid'
import { AutonomousSavedDialogList } from '@components/autonomousDialogList/savedDialogs'
import SortedDialogList from '@components/sortedDialogList'
import type { SavedStarGift } from '@core/managers/starsManager'
import { formatUserPhone } from '@core/format/phone'
import { getUserStatusString } from '@core/presence'
import { getChatMembersString } from '@components/wrappers/getChatMembersString'
import { useAppStateStore } from '@stores/appState'
import { useChatsStore } from '@stores/chatsStore'
import { SearchSelection } from '@components/chat/selection'
import { ButtonMenuSync, type ButtonMenuItemOptions } from '@components/buttonMenu'
import ChatContextMenu from '@components/chat/contextMenu'
import copyMessageMediaWithFeedback from '@components/copyMessageMediaWithFeedback'
import canDeleteMessage from '@core/messages/canDeleteMessage'
import { attachContextMenuListener } from '@helpers/dom/attachContextMenuListener'
import cancelClickOrNextIfNotClick from '@helpers/dom/cancelClickOrNextIfNotClick'
import { simulateClickEvent } from '@helpers/dom/clickEvent'
import contextMenuController from '@helpers/contextMenuController'
import positionMenu from '@helpers/positionMenu'

/**
 * tweb `:111` — фильтр сообщений (`inputMessagesFilterPhotoVideo` и т.п.),
 * алиас `MyInputMessagesFilter`, как в оригинале. Союз — в
 * `core/messages/inputMessagesFilter.ts`: его же читает шов `searchHistory`.
 */
export type SearchSuperType = MyInputMessagesFilter

/** tweb `:112-124`. `chatType` — поле опций истории (`Pick<RequestHistoryOptions, 'chatType'>`). */
export type SearchSuperContext = {
  peerId: PeerId
  inputFilter: { _: SearchSuperType | undefined }
  query?: string
  maxId?: number
  folderId?: number
  threadId?: number
  date?: number
  nextRate?: number
  minDate?: number
  maxDate?: number
} & Pick<SearchHistoryOptions, 'chatType'>

/** tweb `:126-128` — 16 логических вкладок. */
export type SearchSuperMediaType = 'stories' | 'members' | 'media' |
  'files' | 'links' | 'music' | 'chats' | 'voice' | 'groups' | 'similar' |
  'savedDialogs' | 'saved' | 'channels' | 'apps' | 'gifts' | 'posts'

/**
 * tweb `:129-139` — описание вкладки. Существенное: вкладка НЕСЁТ СВОИ УЗЛЫ и
 * СВОЮ ЗАПОМНЕННУЮ ПОЗИЦИЮ СКРОЛЛА (`scroll`), поэтому переключение вкладок
 * ничего не размонтирует и ничего не теряет.
 */
export type SearchSuperMediaTab = {
  inputFilter?: SearchSuperType
  name: LangPackKey
  type: SearchSuperMediaType
  contentTab?: HTMLElement
  itemsTab?: HTMLElement
  menuTab?: HTMLElement
  menuTabName?: HTMLElement
  scroll?: { scrollTop: number, scrollHeight: number }
  hideOn?: HTMLElement
}

/**
 * tweb ca1416807 (812502980 `:154-157`).
 * * a tab whose visibility follows its message counter — an empty one is hidden (see loadFirstTime)
 */
export function isCounterDrivenMediaTab(mediaTab: SearchSuperMediaTab) {
  return !!mediaTab.inputFilter && mediaTab.inputFilter !== 'inputMessagesFilterEmpty'
}

/**
 * tweb `:545-553` — типы, которым НЕ нужна карточка `Section`: они рисуют свою
 * разметку целиком (грид медиа, Solid-вкладки историй/подарков, чатлисты).
 */
const NO_SECTION_TYPES: Set<SearchSuperMediaType> = new Set([
  'stories',
  'media',
  'gifts',
  'chats',
  'channels',
  'apps',
  'posts',
])

/** tweb `:141-147` — что нужно `loadType`, чтобы загрузить ОДНУ вкладку. */
type SearchSuperLoadTypeOptions = {
  mediaTab: SearchSuperMediaTab
  justLoad: boolean
  loadCount: number
  middleware: Middleware
  /** С какого края догружаем. Единственный читатель у оригинала —
   *  `loadSavedDialogs` (`tweb:1892`, `:2203`, `:2398`): там `side` уходит в
   *  пагинацию `AutonomousSavedDialogList.onChatsScroll`; у нас список приезжает
   *  одним RPC, и наш `loadSavedDialogs` его не читает — расхождение 40. Поле
   *  остаётся: это форма публичного `load(single, justLoad, side)`. */
  side: 'top' | 'bottom'
}

/** tweb `:149-154`. `canAnimateIn` — появление контейнера группы (`:1115-1128`). */
type PerformSearchResultArgs = {
  messages: MyMessage[]
  mediaTab: SearchSuperMediaTab
  canAnimateIn?: boolean
  append?: boolean
}

/**
 * Порт tweb `SearchContextMenu` (`appSearchSuper.ts:182-386`, 812502980) —
 * контекстное меню элемента shared media: правый клик (на таче — долгое
 * нажатие) по `.search-super-item` открывает `.search-contextmenu`, пункты
 * которого решает `verify()`; в режиме выделения остаются только пункты
 * `withSelection`. Если не прошёл ни один — меню не открывается.
 * Адаптации — расхождения 51-54 в шапке файла.
 */
class SearchContextMenu {
  private buttons!: (ButtonMenuItemOptions & { verify?: () => boolean | Promise<boolean>, withSelection?: true })[]
  private element?: HTMLElement
  private target?: HTMLElement
  private peerId!: PeerId
  private mid!: number
  private isSelected = false
  private noForwards = false
  private message?: MyMessage
  private selectedMessages?: MyMessage[]
  private copyMediaButton?: ButtonMenuItemOptions & {
    verify?: () => boolean | Promise<boolean>
  }

  // `attachTo` у оригинала ещё и поле — ради четвёртого аргумента
  // `canDownload` (расхождение 54); здесь он нужен только подписке.
  constructor(
    attachTo: HTMLElement,
    private searchSuper: AppSearchSuper,
    private listenerSetter: ListenerSetter,
  ) {
    // tweb :204-272
    const onContextMenu = (e: MouseEvent | TouchEvent) => {
      if(!this.element) {
        this.init()
      }

      const item = findUpClassName(e.target as HTMLElement, 'search-super-item')

      // stories have their own context menu in StoriesProfileTab
      const isStory = !!findUpClassName(e.target as HTMLElement, 'search-super-content-stories')
      if(isStory) return

      if(!item) return

      // cross-realm-safe `instanceof MouseEvent` (excludes touch, survives the Document PiP window)
      if(!('touches' in e)) e.preventDefault()
      const element = this.element!
      if(element.classList.contains('active')) {
        return false
      }
      if(!('touches' in e)) e.stopPropagation()

      const selection = this.searchSuper.selection!
      const r = async() => {
        this.target = item
        this.peerId = +(item.dataset.peerId ?? '')
        this.mid = +(item.dataset.mid ?? '')
        this.isSelected = selection.isMidSelected(this.peerId, this.mid)
        // расхождение 52
        this.message = getSharedMediaMessage(this.peerId, this.mid)
        this.noForwards = selection.isSelecting ?
          !!selection.selectionForwardBtn?.classList.contains('hide') :
          this.message?._ !== 'message'
        this.selectedMessages = selection.isSelecting ? selection.getSelectedMessages() : undefined

        const f = await Promise.all(this.buttons.map(async(button) => {
          let good: boolean

          if(selection.isSelecting && !button.withSelection) {
            good = false
          } else {
            good = button.verify ? !!(await button.verify()) : true
          }

          button.element!.classList.toggle('hide', !good)
          return good
        }))

        if(!f.some((v) => v)) {
          return
        }

        item.classList.add('menu-open')

        positionMenu(e, element)
        contextMenuController.openBtnMenu(element, () => {
          item.classList.remove('menu-open')
        })
      }

      void r()
    }

    attachContextMenuListener({
      element: attachTo,
      callback: onContextMenu,
      listenerSetter,
    })
  }

  /** tweb :275-340 */
  private init() {
    const selection = () => this.searchSuper.selection!
    this.buttons = [{
      icon: 'forward',
      text: 'Forward',
      onClick: this.onForwardClick,
      verify: () => !this.noForwards,
    }, {
      icon: 'forward',
      text: 'Message.Context.Selection.Forward',
      onClick: this.onForwardClick,
      verify: () => selection().isSelecting && !this.noForwards,
      withSelection: true,
    }, this.copyMediaButton = {
      icon: 'copy',
      text: 'MediaViewer.Context.Copy',
      onClick: this.onCopyMediaClick,
      verify: () => !selection().isSelecting &&
        ChatContextMenu.canCopyMedia(this.message, undefined, this.noForwards),
      keepOpen: true,
    }, {
      icon: 'download',
      text: 'MediaViewer.Context.Download',
      onClick: () => ChatContextMenu.onDownloadClick(this.message, this.noForwards),
      verify: () => !selection().isSelecting && ChatContextMenu.canDownload(this.message, undefined, this.noForwards),
    }, {
      icon: 'download',
      text: 'Message.Context.Selection.Download',
      onClick: () => ChatContextMenu.onDownloadClick(this.selectedMessages, this.noForwards),
      verify: () => selection().isSelecting && ChatContextMenu.canDownload(this.selectedMessages, undefined, this.noForwards),
      withSelection: true,
    }, {
      icon: 'message',
      text: 'Message.Context.Goto',
      onClick: this.onGotoClick,
      withSelection: true,
    }, {
      icon: 'select',
      text: 'Message.Context.Select',
      onClick: this.onSelectClick,
      verify: () => !this.isSelected,
      withSelection: true,
    }, {
      icon: 'select',
      text: 'Message.Context.Selection.Clear',
      onClick: this.onClearSelectionClick,
      verify: () => this.isSelected,
      withSelection: true,
    }, {
      icon: 'delete',
      className: 'danger',
      text: 'Delete',
      onClick: this.onDeleteClick,
      verify: () => !selection().isSelecting && canDeleteMessage(this.message),
    }, {
      icon: 'delete',
      className: 'danger',
      text: 'Message.Context.Selection.Delete',
      onClick: this.onDeleteClick,
      verify: () => selection().isSelecting && !!selection().selectionDeleteBtn && !selection().selectionDeleteBtn!.classList.contains('hide'),
      withSelection: true,
    }]

    this.element = ButtonMenuSync({ buttons: this.buttons, listenerSetter: this.listenerSetter })
    this.element.classList.add('search-contextmenu', 'contextmenu')
    document.body.append(this.element)
  }

  /** Расхождение 53 в шапке файла. */
  public destroy() {
    this.element?.remove()
    this.element = undefined
  }

  /** tweb :342-348 */
  private onGotoClick = () => {
    this.searchSuper.setInnerPeer?.({
      peerId: this.peerId,
      lastMsgId: this.mid,
      threadId: this.searchSuper.mediaTab.type === 'saved' ? this.searchSuper.searchContext.peerId : this.searchSuper.searchContext.threadId,
    })
  }

  /** tweb :350-355 (508acd4f5) */
  private onCopyMediaClick = () => {
    copyMessageMediaWithFeedback({
      message: this.message,
      button: this.copyMediaButton!,
    })
  }

  /** tweb :357-365 */
  private onForwardClick = () => {
    const selection = this.searchSuper.selection!
    if(selection.isSelecting) {
      simulateClickEvent(selection.selectionForwardBtn!)
    } else {
      void showForwardPopup({
        [this.peerId]: [this.mid],
      })
    }
  }

  /** tweb :367-369 */
  private onSelectClick = () => {
    this.searchSuper.selection!.toggleByElement(this.target!)
  }

  /** tweb :371-373 */
  private onClearSelectionClick = () => {
    this.searchSuper.selection!.cancelSelection()
  }

  /** tweb :375-385 */
  private onDeleteClick = () => {
    const selection = this.searchSuper.selection!
    if(selection.isSelecting) {
      simulateClickEvent(selection.selectionDeleteBtn!)
    } else {
      showDeleteMessagesPopup(
        this.peerId,
        [this.mid],
        ChatType.Chat,
        undefined,
        (mid) => getSharedMediaMessage(this.peerId, mid),
      )
    }
  }
}

/**
 * tweb `:346-354` — что рендерер ОДНОГО сообщения получает от
 * `performSearchResult`. `elemsToAppend` (накопитель) не портирован: наши
 * рендереры его не читают, узлы собирает `performSearchResult`.
 */
type ProcessSearchSuperResult = {
  message: MyMessage
  middleware: Middleware
  promises: Promise<unknown>[]
  inputFilter: SearchSuperType
  searchGroup?: SearchGroup
  mediaTab: SearchSuperMediaTab
}

/** tweb `:1173` — узел вкладки вместе с сообщением, из которого он собран. */
type SearchSuperItem = { element: HTMLElement, message: MyMessage }

/**
 * Ручки менеджеров, которыми пользуется подсистема — расхождения 6, 20, 29,
 * 34, 36-40 и 44 в шапке. `groups` — участники (задача 11); `stories`/`chats`/
 * `stars` — предикаты первого показа (задача 10) и вкладки «Чаты»/«Подарки»
 * (задача 12); `presence` — присутствие пира; `contacts`/`channels`/`dialogs` — группы
 * контактов левой колонки и вкладка «Каналы» (задача 9 плана поиска).
 */
export type SearchSuperManagers = {
  messages: Pick<Managers['messages'], 'searchHistory' | 'searchCounters'>
  peers: Pick<Managers['peers'], 'fillMirror'>
  groups: Pick<Managers['groups'], 'channelParticipants' | 'addMember' | 'removeMember' | 'unban'>
  stories: Pick<Managers['stories'], 'pinnedStories'>
  // те же ручки, что просят `SavedDialogListManagers`/`StarGiftsProfileTabProps` у своих `managers`
  chats: Pick<Managers['chats'], 'savedDialogs'>
  stars: Pick<Managers['stars'], 'profileGifts'>
  presence: Pick<Managers['presence'], 'get'>
  // `appUsersManager.getContactsPeerIds` (tweb `:1365`)
  contacts: Pick<Managers['contacts'], 'getContactsPeerIds'>
  // `appUsersManager.searchContacts` — `contacts.search` (`:1423`, `:1978`)
  channels: Pick<Managers['channels'], 'search'>
  // `dialogsStorage.getDialogs({query})` — локальный индекс диалогов (`:1442`)
  dialogs: Pick<Managers['dialogs'], 'getDialogs'>
}

/**
 * Фильтр сообщений → вид шаред-медиа на проводе — только для счётчиков вкладок
 * (`searchCounters` берёт слова REST). Историю класс просит фильтром как есть,
 * через шов `messages.searchHistory`, как оригинал (`tweb:2284`).
 */
const WIRE_FILTER: Partial<Record<SearchSuperType, MessagesWireFilter>> = INPUT_FILTER_WIRE

/**
 * tweb `appPeersManager.getPeerUsername` (`:79-81`) — первое активное имя из
 * `getPeerActiveUsernames`. Вектора `usernames` у нашей модели нет, публичное
 * имя одно — `username`.
 */
const getPeerUsername = (peer: ReturnType<typeof cachedPeer>) =>
  (peer && 'username' in peer && peer.username) || ''

/**
 * Виды сообщений, которые проходят фильтр (порт таблицы
 * `filterMessagesByInputFilter`, tweb `neededContents`/`neededDocTypes`).
 * `gif` в оригинале — документ с `type === 'video'` (`:47-51`), у нас свой вид,
 * и он тоже медиа: вкладки GIF в правой колонке нет (поправка 2 плана).
 */
const FILTER_KINDS: Partial<Record<SearchSuperType, ReadonlySet<ReturnType<typeof getMessageKind>>>> = {
  inputMessagesFilterPhotoVideo: new Set(['photo', 'video', 'gif'] as const),
  inputMessagesFilterDocument: new Set(['document'] as const),
  inputMessagesFilterMusic: new Set(['audio'] as const),
  inputMessagesFilterRoundVoice: new Set(['voice', 'roundVideo'] as const),
}

export type AppSearchSuperOptions = {
  mediaTabs: SearchSuperMediaTab[]
  /** скроллер приходит СНАРУЖИ: весь профиль скроллится одним контейнером (tweb `:406`) */
  scrollable: Scrollable
  managers: SearchSuperManagers
  /** tweb `:407` — группы выдачи левой колонки (`sidebarLeft/index.ts:1095-1103`);
   *  найденные сообщения вкладки `chats` рисуются строками в `messages`. */
  searchGroups?: { [group in SearchGroupType]: SearchGroup }
  /** tweb `:409` — `false` у левой колонки: вкладки не прячутся по счётчикам. */
  hideEmptyTabs?: boolean
  /** tweb `:411`, `:447` — подписывать документы отправителем («кто ➝ куда»);
   *  у голосовых и кружков отправитель показывается и без него (`:942`). */
  showSender?: boolean
  onChangeTab?: (mediaTab: SearchSuperMediaTab) => void
  /** tweb `:428` — «во вкладке стало N элементов»; читает шапка профиля. */
  onLengthChange?: (type: SearchSuperMediaType, length: number) => void
  scrollOffset?: number
  /** Открыть чат с участником — расхождение 33 в шапке. */
  openPeer?: (peerId: PeerId) => void
  /** Открыть экран прав участника из его меню — расхождение 33 в шапке. */
  openUserPermissions?: (participant: Participant, isAdmin?: boolean) => void
  /** tweb `appImManager.setInnerPeer` — «перейти к сообщению»; расхождение 51. */
  setInnerPeer?: (options: { peerId: PeerId, lastMsgId: number, threadId?: number }) => void
}

export default class AppSearchSuper {
  /** tweb `:357` — «фильтр → узел списка»; по нему рендер ищет, куда класть элементы. */
  public tabs: Partial<Record<SearchSuperType, HTMLElement>> = {}

  public mediaTab!: SearchSuperMediaTab

  public container: HTMLElement
  public nav: HTMLElement
  public navScrollableContainer: HTMLElement
  public tabsContainer: HTMLElement
  public navScrollable: ScrollableX
  private tabsMenu: HTMLElement
  private prevTabId = -1

  private lazyLoadQueue: LazyLoadQueue = createLazyLoadQueue()
  public middleware = getMiddleware()

  /**
   * tweb `:372-373`. Кэш сообщений по фильтру ЖИВЁТ СНАРУЖИ класса (владелец —
   * обвязка правой колонки, `sharedMedia.tsx:33-36`) и переживает и `cleanup()`,
   * и смену пира; класс лишь держит ссылку и помечает, сколько он из кэша уже
   * отрисовал.
   */
  public historyStorage: Partial<Record<SearchSuperType, { mid: number, peerId: PeerId }[]>> = {}
  public usedFromHistory: Partial<Record<SearchSuperType, number>> = {}

  public searchContext!: SearchSuperContext

  /**
   * tweb `:376`. Обещание, которое `performSearchResult` ждёт ПЕРЕД тем, как
   * вставить узлы (`:1196-1206`): пока оно не разрешилось, показывать нечего —
   * его ставит обвязка на время своей собственной подготовки
   * (`sharedMedia.tsx:205-207`).
   */
  public loadMutex?: Promise<unknown>

  /** tweb `:379-380` — «этот тип уже грузится» и «этот тип дочитан до конца». */
  private loadPromises: Partial<Record<SearchSuperMediaType, Promise<unknown> | null>> = {}
  private loaded: Partial<Record<SearchSuperMediaType, boolean>> = {}
  /** tweb fb18166dc — повторная проверка триггеров после загрузки, пока растёт прогресс вкладки. */
  private refiller: ScrollableRefiller<SearchSuperMediaType>
  /** tweb `:381` — группы контактов вкладки `chats` уже нарисованы на этот
   *  запрос (`loadChats` зовётся один раз, `:2232-2235`); сброс — `cleanup`. */
  private loadedChats = false
  /** tweb `:378` — курсор следующей страницы по типу: `nextRate` глобальной
   *  выдачи (`:2288`, `:2321`) и смещение участников (расхождение 35). */
  private nextRates: Partial<Record<SearchSuperMediaType, number | undefined>> = {}

  /** tweb `:382`, `:420` — «вкладки ещё не выбирали» и живое обещание первого показа. */
  private firstLoad = true
  private loadFirstTimePromise?: Promise<void>

  /** tweb `:398` — «список сохранённых уже смонтирован»; см. `loadSavedDialogs`. */
  private _loadSavedDialogs?: () => Promise<void>

  /** tweb `:427-428` — число элементов вкладки; читает шапка профиля. */
  public counters: Partial<Record<SearchSuperMediaType, number>> = {}
  public onLengthChange?: (type: SearchSuperMediaType, length: number) => void

  public selectTab!: SelectTab
  public mediaTabsMap: Map<SearchSuperMediaType, SearchSuperMediaTab> = new Map()

  private skipScroll?: boolean

  /** tweb `:388`, `:607` — группа «Messages» вкладки `media` при непустом запросе
   *  (`:1106-1110`); её корень гасит `destroy()` — расхождение 42. */
  private searchGroupMedia: SearchGroup
  private searchGroupMediaMiddleware = getMiddleware()

  /** tweb `:392-394` — состояние вкладки «Участники»: от первого рендера до `cleanup()`. */
  private membersList?: SortedUserList
  private membersParticipantMap?: Map<PeerId, Participant>
  private membersMiddlewareHelper?: MiddlewareHelper

  // * arguments
  public mediaTabs!: SearchSuperMediaTab[]
  public scrollable!: Scrollable
  public managers!: SearchSuperManagers
  public searchGroups?: { [group in SearchGroupType]: SearchGroup }
  public hideEmptyTabs? = true
  public showSender? = false
  public onChangeTab?: (mediaTab: SearchSuperMediaTab) => void
  public scrollOffset?: number
  public openPeer?: (peerId: PeerId) => void
  public openUserPermissions?: (participant: Participant, isAdmin?: boolean) => void
  public setInnerPeer?: AppSearchSuperOptions['setInnerPeer']

  /** tweb `:459-460` (812502980) — меню элемента и выделение (задача 14). */
  private searchContextMenu?: SearchContextMenu
  public selection?: SearchSelection

  /** tweb `:416` — назначается потребителем (`sharedMedia.tsx:682-684`). */
  public scrollStartCallback?: (dimensions: ScrollStartCallbackDimensions) => void

  /** tweb `:616-621`; см. вызов в конструкторе и расхождение 7. */
  private onScrolledBottom = () => {
    if(this.mediaTab.contentTab && this.canLoadMediaTab(this.mediaTab)) {
      void this.load(true, undefined, 'bottom')
    }
  }

  private listenerSetter: ListenerSetter
  private swipeHandler?: SwipeHandler

  /**
   * tweb `:437` — узел градиента (тот, что `Tabs.MenuGradient` отдаёт наружу,
   * то есть КОНТЕЙНЕР, а не внутренний слой: `tabs.tsx:77-93`). Читается при
   * первом показе вкладок (`loadFirstTime`) и при пересчёте видимых
   * (`updateContainerHidden`): когда доступна ровно одна вкладка, ряд получает
   * `is-single`, а градиент — `hide` (`tweb:2509-2511` и `:2523-2525`).
   *
   * `public`, а не `private` как в оригинале: узел читает пин разметки
   * (`appSearchSuper.dom.test.ts`), как и соседние узлы подсистемы
   * (`container`, `nav`, `navScrollableContainer`, `tabsContainer`).
   */
  public menuGradient: HTMLElement

  /** tweb `:434-435` — стор и действия витрины подарков; живут от `loadGifts`
   *  до `middleware.clean()` (расхождение 37). */
  public stargiftsStore?: StarGiftsProfileStore
  public stargiftsActions?: StarGiftsProfileActions

  /** см. расхождение 2 в шапке файла */
  private disposeSections: (() => void)[] = []

  constructor(options: AppSearchSuperOptions) {
    safeAssign(this, options)

    // tweb fb18166dc
    this.refiller = new ScrollableRefiller({
      scrollable: this.scrollable,
      getProgress: (type) => this.getMediaTabProgress(type),
    })

    this.container = document.createElement('div')
    this.container.classList.add('search-super')

    this.listenerSetter = new ListenerSetter()
    // tweb `:520-521` (812502980). Менеджер прав выделению не передаётся —
    // факта «нельзя переслать/удалить» нет (докблок `SelectionManagers`).
    this.searchContextMenu = new SearchContextMenu(this.container, this, this.listenerSetter)
    this.selection = new SearchSelection(this, { messages: {} }, this.listenerSetter)

    // tweb `:462-472` — липкий ряд вкладок в горизонтальном скроллере.
    const navScrollableContainer = this.navScrollableContainer = document.createElement('div')
    navScrollableContainer.classList.add('search-super-tabs-scrollable', 'menu-horizontal-scrollable', 'sticky')

    const navScrollable = this.navScrollable = new ScrollableX(navScrollableContainer)
    navScrollable.container.classList.add('search-super-nav-scrollable')

    const nav = this.nav = document.createElement('nav')
    nav.classList.add('search-super-tabs', 'menu-horizontal-div')
    this.tabsMenu = nav

    navScrollable.container.append(nav)

    // tweb `:474-493` — по вкладке на строку: подчёркивание (`i`) идёт ПЕРВЫМ,
    // название — вторым (дамп `07-right-sidebar.json:128-130`: ripple, i, span).
    for(const mediaTab of this.mediaTabs) {
      const menuTab = document.createElement('div')
      menuTab.classList.add('menu-horizontal-div-item')
      const span = document.createElement('span')
      span.classList.add('menu-horizontal-div-item-span')
      const i = document.createElement('i')
      i.classList.add('menu-horizontal-div-item-background')

      span.append(mediaTab.menuTabName = i18n(mediaTab.name))

      menuTab.append(i, span)

      ripple(menuTab)

      this.tabsMenu.append(menuTab)

      this.mediaTabsMap.set(mediaTab.type, mediaTab)

      mediaTab.menuTab = menuTab
    }

    this.tabsContainer = document.createElement('div')
    this.tabsContainer.classList.add('search-super-tabs-container', 'tabs-container')

    // tweb `:498-542` — свайп между вкладками. `unlockScroll` объявлен ЗДЕСЬ,
    // а снимается в `onTransitionEnd` слайдера (`tweb:701-704`): замок держится
    // ровно до конца анимации перехода.
    let unlockScroll: ReturnType<typeof lockTouchScroll> | undefined
    if(IS_TOUCH_SUPPORTED) {
      this.swipeHandler = handleTabSwipe({
        element: this.tabsContainer,
        onSwipe: (xDiff) => {
          xDiff *= -1

          const prevId = this.selectTab.prevId()
          const children = Array.from(this.tabsMenu.children) as HTMLElement[]

          // tweb `:508-515` — у вкладок `gifts`/`stories` своя горизонтальная
          // навигация (коллекции/альбомы), и она перехватывает свайп первой.
          // Не портировано — расхождение 39 в шапке.

          // Соседняя СКРЫТАЯ вкладка пропускается: `hide` на строке ряда значит
          // «в этом чате такой вкладки нет» (`tweb:517-531`).
          let idx: number | undefined
          if(xDiff > 0) {
            for(let i = prevId + 1; i < children.length; ++i) {
              if(!children[i].classList.contains('hide')) {
                idx = i
                break
              }
            }
          } else {
            for(let i = prevId - 1; i >= 0; --i) {
              if(!children[i].classList.contains('hide')) {
                idx = i
                break
              }
            }
          }

          if(idx !== undefined) {
            unlockScroll = lockTouchScroll(this.tabsContainer)
            this.selectTab(idx)
          }
        },
        verifyTouchTarget: (e) => {
          return !findUpClassName(e.target, 'scrollable-x')
        },
      })
    }

    // tweb `:554-594` — содержимое вкладок (сам набор `noSectionTypes`,
    // `tweb:545-553`, у нас поднят в модульную константу `NO_SECTION_TYPES`).
    for(const mediaTab of this.mediaTabs) {
      const container = document.createElement('div')
      container.classList.add('search-super-tab-container', 'search-super-container-' + mediaTab.type, 'tabs-tab')

      const content = document.createElement('div')
      content.classList.add('search-super-content-container', 'search-super-content-' + mediaTab.type)

      container.append(content)

      const useSection = !NO_SECTION_TYPES.has(mediaTab.type)
      let itemsContainer = content
      if(useSection) {
        const items = document.createElement('div')
        // Карточка секции создаётся СКРЫТОЙ (`class: 'hide'`) и открывается
        // первым же отрисованным элементом; она же — `mediaTab.hideOn`.
        this.disposeSections.push(createRoot((dispose) => {
          Section({
            noDelimiter: true,
            class: 'hide',
            ref: (ref: HTMLDivElement) => {
              content.append(mediaTab.hideOn = ref)
            },
            children: [items],
          })
          return dispose
        }))
        itemsContainer = items
      } else if(mediaTab.type === 'media') {
        const grid = document.createElement('div')
        grid.classList.add('search-super-content-media-grid')
        content.append(grid)
        itemsContainer = grid
      }

      this.tabsContainer.append(container)

      const { inputFilter } = mediaTab
      if(inputFilter) {
        this.tabs[inputFilter] = itemsContainer
      }

      mediaTab.contentTab = content
      mediaTab.itemsTab = itemsContainer
    }

    // tweb `:596-600` — узел градиента и создаётся, и запоминается в поле прямо
    // в `append`.
    this.container.append(
      this.menuGradient = Tabs.MenuGradient({
        color: 'background',
        className: 'search-super-tabs-gradient',
      }) as HTMLElement,
      navScrollableContainer,
      this.tabsContainer,
    )

    // * construct end

    this.searchGroupMedia = createSearchGroup({
      type: 'messages',
      middleware: this.searchGroupMediaMiddleware.get(),
    })

    // tweb `:616-621` — доскроллили до низа: догружаем ТЕКУЩУЮ вкладку.
    // Полем, а не замыканием: `destroy()` снимает ровно этот хук (расхождение 7).
    this.scrollable.onScrolledBottom = this.onScrolledBottom

    this.selectTab = horizontalMenu({
      tabs: this.tabsMenu,
      content: this.tabsContainer,
      // tweb `:624-691`
      onClick: (id, _tabContent, animate) => {
        if(this.prevTabId === id && !this.skipScroll) {
          this.scrollToStart()
          return
        }

        const newMediaTab = this.mediaTabs[id]
        this.onChangeTab?.(newMediaTab)

        const fromMediaTab = this.mediaTab
        this.mediaTab = newMediaTab

        if(this.prevTabId !== -1 && animate) {
          this.onTransitionStart()
        }

        if(this.skipScroll) {
          this.skipScroll = false
        } else {
          const offsetTop = this.container.offsetTop - (this.scrollOffset || 0)
          let scrollTop = this.scrollable.scrollPosition
          if(scrollTop < offsetTop) {
            this.scrollToStart()
            scrollTop = offsetTop
          }

          fromMediaTab.scroll = { scrollTop: scrollTop, scrollHeight: this.scrollable.scrollSize }

          if(newMediaTab.scroll === undefined) {
            // Первый заход на вкладку: её «позиция» — не ноль, а расстояние от
            // верха контейнера подсистемы до верха его родителя, иначе новая
            // вкладка улетела бы вверх мимо шапки профиля (`tweb:653-661`).
            const rect = this.container.getBoundingClientRect()
            const rect2 = this.container.parentElement!.getBoundingClientRect()
            const diff = rect.y - rect2.y

            if(scrollTop > diff) {
              newMediaTab.scroll = { scrollTop: diff, scrollHeight: 0 }
            }
          }

          if(newMediaTab.scroll) {
            const diff = fromMediaTab.scroll.scrollTop - newMediaTab.scroll.scrollTop

            if(diff) {
              // Главный трюк подсистемы (`tweb:673`): физически скролл ещё стоит
              // там, где его оставила УХОДЯЩАЯ вкладка, поэтому приходящую на
              // время анимации сдвигают инлайновым `translateY` на разницу
              // позиций — визуально она «стоит на своём месте». Настоящий
              // `scrollPosition` выставляется по концу перехода (`:693-707`).
              newMediaTab.contentTab!.style.transform = `translateY(${diff}px)`
            }
          }
        }

        // tweb `:686-689` — вкладка пуста и это не первый показ: грузим её.
        if(this.prevTabId !== -1 && !newMediaTab.itemsTab!.childElementCount) {
          void this.load(true)
        }

        this.prevTabId = id
      },
      // tweb `:693-707`
      onTransitionEnd: () => {
        this.scrollable.onScroll()

        if(this.mediaTab.scroll !== undefined) {
          this.mediaTab.contentTab!.style.transform = ''
          this.scrollable.scrollPosition = this.mediaTab.scroll.scrollTop
        }

        if(unlockScroll) {
          unlockScroll()
          unlockScroll = undefined
        }

        this.onTransitionEnd()
      },
      scrollableX: navScrollable,
      listenerSetter: this.listenerSetter,
    })

    // tweb `:767-772` (812502980) — в режиме выделения клик по элементу
    // выбирает его, а не открывает: перехват на погружении, до обработчиков
    // вкладок. Клик мимо элемента у оригинала роняет `toggleByElement(null)`
    // исключением — здесь он просто ничего не выбирает.
    attachClickEvent(this.tabsContainer, (e) => {
      if(this.selection?.isSelecting) {
        cancelClickOrNextIfNotClick(e)
        const item = findUpClassName(e.target as HTMLElement, 'search-super-item')
        if(item) this.selection.toggleByElement(item)
      }
    }, { capture: true, passive: false, listenerSetter: this.listenerSetter })

    // tweb `:768-772` — открытие медиавьювера по клику в грид. Тело
    // обработчика — метод `onMediaClick` (расхождение 15 в шапке). Подписка
    // для документов (`:773-777`, клик по обложке `document-with-thumb`) не
    // заводится: обложек файлов у нашего `wrapDocument` нет (шапка
    // `wrappers/document.ts`, «что не портировано») — слушать было бы нечего.
    if(this.tabs.inputMessagesFilterPhotoVideo) {
      attachClickEvent(
        this.tabs.inputMessagesFilterPhotoVideo,
        (e) => this.onMediaClick('grid-item', 'grid-item', 'inputMessagesFilterPhotoVideo', e),
        { listenerSetter: this.listenerSetter },
      )
    }

    this.mediaTab = this.mediaTabs[0]

    // tweb `:793-797` — пауза `lazyLoadQueue` на время тяжёлой анимации;
    // см. расхождение 3 в шапке файла.
  }

  /** tweb `:800-807` */
  private scrollToStart() {
    // `void` — наша правка под oxlint (`no-floating-promises`); обещание
    // доводки скролла в оригинале так же никем не ожидается.
    void this.scrollable.scrollIntoViewNew({
      element: this.container,
      position: 'start',
      startCallback: this.scrollStartCallback,
      getElementPosition: this.scrollOffset ?
        ({ elementPosition }) => elementPosition - this.scrollOffset! :
        undefined,
    })
  }

  /** tweb `:809-811` — `sliding` снимает `max-height` с подсистемы на время перехода. */
  private onTransitionStart = () => {
    this.container.classList.add('sliding')
  }

  /** tweb `:813-815` */
  private onTransitionEnd = () => {
    this.container.classList.remove('sliding')
  }

  /** tweb `:817-820` — «во вкладке стало N»; видимость вкладки — за счётчиком (ca1416807). */
  public setCounter(type: SearchSuperMediaType, count: number) {
    this.counters[type] = count
    this.updateMediaTabVisibility(type)
    this.onLengthChange?.(type, count)
  }

  /**
   * tweb ca1416807 (812502980 `:923-961`), B9.
   * * counter-driven tabs are hidden while empty (see loadFirstTime), so they have to appear
   * * (and disappear) on the fly when their counter crosses zero
   */
  private updateMediaTabVisibility(type: SearchSuperMediaType) {
    if(!this.hideEmptyTabs || this.firstLoad) {
      return
    }

    const mediaTab = this.mediaTabsMap.get(type)
    if(!mediaTab || !isCounterDrivenMediaTab(mediaTab)) {
      return
    }

    const menuTab = mediaTab.menuTab!
    const hide = !this.counters[type]
    if(menuTab.classList.contains('hide') === hide) {
      return
    }

    menuTab.classList.toggle('hide', hide)

    let needChangeActive: boolean
    if(hide) {
      needChangeActive = menuTab.classList.contains('active')
      menuTab.classList.remove('active')
    } else {
      // * there was nothing to select when every tab was empty
      needChangeActive = !this.mediaTabs.some((tab) => tab.menuTab!.classList.contains('active'))
    }

    this.updateContainerHidden(needChangeActive)

    if(
      needChangeActive &&
      this.mediaTab &&
      !this.mediaTab.menuTab!.classList.contains('hide') &&
      this.canLoadMediaTab(this.mediaTab)
    ) {
      void this.load(true)
    }
  }

  /**
   * tweb `:822-824` (через `filterMessagesByInputFilter`) — какие из сообщений
   * относятся к этому фильтру. Спрашивают отсюда двое: рендер из кэша
   * (`:2258`) и живой апдейт (`sharedMedia.tsx:229`), поэтому вывод один.
   */
  public filterMessagesByType(messages: (MyMessage | undefined)[], type: SearchSuperType): MyMessage[] {
    const kinds = FILTER_KINDS[type]
    return messages.filter((message): message is MyMessage => {
      if(!message) {
        return false
      }

      // `filterMessagesByInputFilter.ts:18-20` — пустой фильтр пропускает всё
      if(type === 'inputMessagesFilterEmpty') {
        return true
      }

      if(type === 'inputMessagesFilterUrl') {
        // Дословно (`filterMessagesByInputFilter.ts:121-126`), и потому шире,
        // чем ищет бэкенд, — расхождение 10 в шапке, задача 15 плана.
        const entities = message._ === 'message' ? message.entities : undefined
        return !!entities?.some((e) => e._ === 'messageEntityUrl' || e._ === 'messageEntityTextUrl') ||
          (message._ === 'message' && !!matchUrl(message.message))
      }

      return !!kinds?.has(getMessageKind(message))
    })
  }

  /** tweb `:2375-2377` — счётчики нескольких вкладок ОДНИМ запросом. */
  public getSearchCounters(filters: SearchSuperType[]) {
    const { peerId } = this.searchContext
    const wire = filters.map((inputFilter) => WIRE_FILTER[inputFilter]).filter((f): f is MessagesWireFilter => !!f)
    return this.managers.messages.searchCounters(peerId, wire).then((counters) => filters.map((inputFilter) => ({
      inputFilter,
      count: counters.find((c) => c.filter === WIRE_FILTER[inputFilter])?.count ?? 0,
    })))
  }

  /**
   * tweb `:964-1094` — строка вкладки «Ссылки». Карточку (`webPage`) даёт
   * сообщение; если её нет, карточка собирается из ПЕРВОЙ ссылки в сущностях
   * или в тексте (`:967-1018`): превью — абвиатура, описание — весь текст,
   * заголовок — хост. Ничего не даёт для сообщения без ссылки и для строки, в
   * которой нечего показать (`:1092-1094`). Расхождения 13-17 в шапке.
   */
  private processUrlFilter({ message, promises, middleware }: ProcessSearchSuperResult): HTMLElement | undefined {
    // Пилюля не несёт ни текста, ни вложения — ссылке взяться неоткуда.
    if(message._ !== 'message') {
      return
    }

    let webPage: WebPage | undefined = message.media?._ === 'messageMediaWebPage' ? message.media.webpage : undefined

    if(!webPage) {
      const entity = message.entities ? message.entities.find((e) => e._ === 'messageEntityUrl' || e._ === 'messageEntityTextUrl') : null
      let url: string

      if(!entity) {
        const match = matchUrl(message.message)
        if(!match) {
          return
        }

        url = match[0]
      } else {
        url = message.message.slice(entity.offset, entity.offset + entity.length)
      }

      if(entity?._ === 'messageEntityTextUrl') {
        url = entity.url
      }

      let display_url = url

      const same = message.message === url
      if(!url.match(/^(ftp|http|https):\/\//)) {
        display_url = 'https://' + url
        url = url.includes('@') ? url : 'https://' + url
      }

      display_url = new URL(display_url).hostname

      webPage = {
        _: 'webPage',
        url,
        display_url,
      }

      if(!same) {
        webPage.description = message.message
      }
    }

    const previewDiv = document.createElement('div')
    previewDiv.classList.add('preview')

    if(webPage.photo) {
      // Не ждём, как и оригинал (`:1028`): в копилку `promises` враппер сам
      // кладёт превью, полное фото догружает очередь.
      void wrapPhoto({
        container: previewDiv,
        photo: webPage.photo,
        boxWidth: 0,
        boxHeight: 0,
        withoutPreloader: true,
        lazyLoadQueue: this.lazyLoadQueue,
        middleware,
        size: choosePhotoSize(webPage.photo, 60, 60),
        loadPromises: promises,
        noBlur: true,
      })
    } else {
      previewDiv.classList.add('empty')
      setInnerHTML(previewDiv, wrapAbbreviation(webPage.title || webPage.display_url || webPage.description || webPage.url, true))
    }

    const title = wrapWebPageTitle(webPage)

    const subtitleFragment = wrapWebPageDescription(webPage)
    // `htmlToDocumentFragment` оригинала (`:1042`) для фрагмента — тождество
    // (`htmlToDocumentFragment.ts:2`); наш `wrapRichText` отдаёт фрагмент сразу.
    const aFragment = wrapRichText(webPage.url || '')
    const a = aFragment.firstElementChild
    const aIsAnchor = a instanceof HTMLAnchorElement
    if(aIsAnchor) {
      try { // can have 'URIError: URI malformed'
        a.innerText = decodeURIComponent(a.href)
      } catch {
        // адрес остаётся закодированным — как в оригинале (`:1046-1050`)
      }
    }

    if(subtitleFragment.firstChild) {
      subtitleFragment.append('\n')
    }

    // Оригинал (`:1064`) кладёт `a` как есть; без якоря (адрес не распознан
    // ссылкой) он получил бы текст «null» — кладём сам адрес текстом.
    subtitleFragment.append(a ?? aFragment)

    // tweb `:1061-1063` — третьей строкой отправитель «кто ➝ куда». Наш
    // `wrapSenderToPeer` синхронный (его шапка), поэтому рендерер без `await`.
    if(this.showSender) {
      subtitleFragment.append('\n', wrapSenderToPeer(message, middleware, this.managers))
    }

    if(!title.textContent) {
      // расхождение 25: `wrapPlainText` без сущностей — тождество
      title.append(webPage.display_url.split('/', 1)[0])
    }

    // tweb 812502980 `:1398-1413` — строка на Solid `Row` (`searchWebPageRow.solid.tsx`),
    // её корень снимается с middleware отрисовки; расхождение 23: вместо inline
    // `onclick` — атрибут действия
    const row = renderSearchWebPageRow({
      title,
      titleRight: wrapSentTime(message),
      subtitle: subtitleFragment,
      media: previewDiv,
      link: aIsAnchor ? {
        href: a.href,
        action: a.getAttribute(ANCHOR_ACTION_ATTRIBUTE) ?? undefined,
        targetBlank: a.target === '_blank',
      } : undefined,
      middleware,
    })

    if(row.innerText.trim().length) {
      return row
    }
  }

  /**
   * tweb `:826-871` — найденное сообщение СТРОКОЙ ЧАТЛИСТА: строка пира
   * (`addDialogNew`) с превью сообщения, подсветкой запроса и временем
   * (`setLastMessageN`). С группой строка ложится прямо в её список, и узла
   * наружу нет (`:865-867`); без группы — отдаётся `performSearchResult`.
   * Расхождение 42 в шапке.
   */
  private async processEmptyFilter({ message, searchGroup }: ProcessSearchSuperResult): Promise<SearchSuperItem | undefined> {
    // `isSaved` (`:827-832`) — вкладки `saved` нет (расхождение 26), а
    // `getPeerMigratedTo` (`:833`) — миграции чатов нет (расхождение 42).
    const peerId = message.peerId

    const middleware = this.middleware.get()

    const dialogElement = addDialogNew({
      peerId,
      container: searchGroup?.list || false,
      avatarSize: 'bigger',
      wrapOptions: {
        middleware,
      },
      autonomous: false,
      managers: this.managers,
    })

    await setLastMessageN({
      dialog: {
        peerId,
      },
      lastMessage: message,
      dialogElement,
      highlightWord: this.searchContext.query,
    })

    if(searchGroup) {
      return
    }

    return { element: dialogElement.container, message }
  }

  /**
   * tweb `:1096-1257`. Собирает узлы по сообщениям и кладёт их в список вкладки
   * — в конец (`append`) при пагинации и в НАЧАЛО при живом апдейте.
   *
   * Группы левой колонки (`:1106-1128`, `:1189-1194`): пустой фильтр рисует
   * строки в `searchGroups.messages`, медиа с непустым запросом — в
   * `searchGroupMedia` внутри вкладки. Рендер элемента — развилка `buildItem`
   * (`tweb:1143-1170`); обвязка вокруг него — классы, `data-mid`/`data-peer-id`,
   * порядок вставки — оригинальная.
   */
  public async performSearchResult({ messages, mediaTab, canAnimateIn = false, append = true }: PerformSearchResultArgs) {
    const sharedMediaDiv = mediaTab.contentTab!
    const promises: Promise<unknown>[] = []
    const middleware = this.middleware.get()
    let inputFilter = mediaTab.inputFilter
    if(!inputFilter) {
      return 0
    }

    await getHeavyAnimationPromise()

    let searchGroup: SearchGroup | undefined
    if(inputFilter === 'inputMessagesFilterPhotoVideo' && !!this.searchContext.query!.trim()) {
      inputFilter = 'inputMessagesFilterEmpty'
      searchGroup = this.searchGroupMedia
      sharedMediaDiv.append(searchGroup.container)
    } else if(inputFilter === 'inputMessagesFilterEmpty') {
      searchGroup = this.searchGroups?.messages
    }

    // tweb `:1115-1128`. Правил под `is-hidden`/`is-visible` у группы нет и в
    // стилях оригинала (`_searchGroup.scss`) — классы переключаются как есть.
    if(canAnimateIn && liteMode.isAvailable('animations') && searchGroup?.container) {
      const container = searchGroup.container
      container.classList.add('is-hidden')

      setTimeout(() => setTransition({
        element: container,
        className: 'is-visible',
        forwards: true,
        duration: 250,
        onTransitionEnd: () => {
          container.classList.remove('is-hidden')
          container.classList.remove('is-visible')
        },
      }), 100) // doesn't properly animate without it, even useRafs don't really help
    }

    // tweb `:1173-1186` — сообщения рендерятся ПАРАЛЛЕЛЬНО, и ошибка на одном
    // не роняет партию (расхождение 17 в шапке — про её лог). Рендерер вправе
    // не дать узла (`:1167-1169`, `default: break` — фильтр без рендерера; у
    // ссылок — строка вышла пустой; у пустого фильтра с группой — строка уже
    // в группе): такое сообщение пропускается.
    const filter = inputFilter
    const results = messages.map(async(message): Promise<SearchSuperItem | undefined> => {
      try {
        return await this.buildItem({ message, middleware, promises, inputFilter: filter, searchGroup, mediaTab })
      } catch {
        return undefined
      }
    })
    const elemsToAppend = (await Promise.all(results)).filter((item): item is SearchSuperItem => !!item)

    // tweb `:1189-1194`
    const showSearchGroupAnyway = mediaTab.type === 'chats' && searchGroup?.createPlaceholder
    if(searchGroup && (searchGroup.list.childElementCount || showSearchGroupAnyway)) {
      searchGroup.setActive()

      if(!searchGroup.list.childElementCount && searchGroup.createPlaceholder) searchGroup.addPlaceholder(searchGroup.createPlaceholder())
    }

    if(this.loadMutex) {
      promises.push(this.loadMutex)
    }

    if(promises.length) {
      await Promise.all(promises)
      if(!middleware()) {
        return 0
      }
    }

    const length = elemsToAppend.length
    if(length) {
      const method = append ? 'append' : 'prepend'
      const container = this.tabs[inputFilter]!
      // При `prepend` порядок сохраняется только обратным обходом: иначе
      // сообщения встали бы в начале списка задом наперёд (расхождение 12).
      const ordered = append ? elemsToAppend : [...elemsToAppend].reverse()
      ordered.forEach(({ element, message }) => {
        element.classList.add('search-super-item')
        element.dataset.mid = '' + message.id
        element.dataset.peerId = '' + message.peerId
        container[method](element)

        // tweb `:1549-1551` (812502980) — элемент, доехавший в режиме выделения
        if(this.selection?.isSelecting) {
          this.selection.toggleElementCheckbox(element, true)
        }
      })
    }

    // tweb `:1253` — строки пустого фильтра лежат в группе, узлов наружу нет,
    // и «ничего не найдено» вкладке не нужно.
    this.afterPerforming(inputFilter === 'inputMessagesFilterEmpty' ? 1 : length, mediaTab)

    return length
  }

  /**
   * tweb `:1143-1170` — выбор рендерера по фильтру (там `switch` стоит прямо в
   * `performSearchResult`; здесь вынесен, чтобы ветки приезжали по одной —
   * задачи 7, 8, 9). Обвязка вокруг узла (классы, `data-mid`/`data-peer-id`,
   * порядок вставки) — в `performSearchResult`, как в оригинале.
   */
  private buildItem(options: ProcessSearchSuperResult): Promise<SearchSuperItem | undefined> | SearchSuperItem | undefined {
    switch(options.inputFilter) {
      case 'inputMessagesFilterEmpty':
        return this.processEmptyFilter(options)
      case 'inputMessagesFilterPhotoVideo':
        return this.processPhotoVideoFilter(options)
      // tweb `:1154-1160` — ОДИН рендерер на файлы, музыку, голосовые и кружки.
      case 'inputMessagesFilterRoundVoice':
      case 'inputMessagesFilterMusic':
      case 'inputMessagesFilterDocument':
        return this.processDocumentFilter(options)

      case 'inputMessagesFilterUrl': {
        const element = this.processUrlFilter(options)
        return element ? { element, message: options.message } : undefined
      }
    }
  }

  /**
   * tweb `:874-938` — плитка грида. Размер плитке задаёт CSS
   * (`.search-super-content-media-grid .grid-item`), поэтому бокс — нули, а
   * ступень выбирается заранее под 200×200 (`choosePhotoSize`) и уезжает в
   * оба враппера явно (`size`/`photoSize`). Видео — только постер: ни файла
   * (`onlyPreview`), ни кнопки воспроизведения (`noPlayButton`), ни кольца
   * (`withoutPreloader`). Расхождения 13, 16 в шапке — про крышку.
   */
  private async processPhotoVideoFilter({ message, promises, middleware }: ProcessSearchSuperResult): Promise<SearchSuperItem> {
    // фильтр пропускает только фото/видео/gif — файл у вложения есть по построению
    const media = getMediaFromMessage(message)!

    const div = document.createElement('div')
    div.classList.add('grid-item')

    let wrapped: WrappedPhoto | undefined
    const size = choosePhotoSize(media, 200, 200)
    if(media._ !== 'photo') {
      wrapped = (await wrapVideo({
        doc: media,
        message: { mid: message.id, peerId: message.peerId, date: message.date },
        container: div,
        boxWidth: 0,
        boxHeight: 0,
        lazyLoadQueue: this.lazyLoadQueue,
        middleware,
        onlyPreview: true,
        withoutPreloader: true,
        noPlayButton: true,
        photoSize: size,
      })).thumb
    } else {
      wrapped = await wrapPhoto({
        photo: media,
        container: div,
        boxWidth: 0,
        boxHeight: 0,
        lazyLoadQueue: this.lazyLoadQueue,
        middleware,
        withoutPreloader: true,
        noBlur: true,
        size,
      })
    }

    if(isMediaSpoiler(message)) {
      const mediaSpoiler = await wrapMediaSpoiler({
        animationGroup: 'chat',
        media,
        middleware,
        width: 140,
        height: 140,
      })

      // без stripped-ступени крышки нет (`wrapMediaSpoiler` отдаёт `undefined`)
      if(mediaSpoiler) {
        div.append(mediaSpoiler)
      }
    }

    // `thumb` у видео есть всегда: постер в ветке `onlyPreview` строится без
    // условий (`wrappers/video.ts`), а у фото это сам результат `wrapPhoto`
    if(wrapped) {
      [
        wrapped.images.thumb,
        wrapped.images.full,
      ].filter((image): image is NonNullable<typeof image> => !!image).forEach((image) => {
        image.classList.add('grid-item-media')
      })

      promises.push(wrapped.loadPromises.thumb)
    }

    return { element: div, message }
  }

  /**
   * tweb `:716-767` — клик по медиа во вкладке. Крышка спойлера перехватывает
   * первый клик (`:726-733`); иначе открывается вьювер, и ЛИСТАЕТ ОН ПО
   * ЭЛЕМЕНТАМ ЭТОЙ ВКЛАДКИ (`:740-751`), а не по ленте чата. Расхождения
   * 13-15 в шапке.
   */
  private onMediaClick(className: string, targetClassName: string, inputFilter: SearchSuperType, e: MouseEvent) {
    const target = findUpClassName(e.target as HTMLElement, className)
    if(!target) return

    const mid = +target.dataset.mid!
    if(!mid) {
      return
    }

    const mediaSpoiler = target.querySelector<HTMLElement>('.media-spoiler-container')
    if(mediaSpoiler) {
      onMediaSpoilerClick({
        event: e,
        mediaSpoiler,
      })
      return
    }

    const peerId = +target.dataset.peerId!
    const message = getSharedMediaMessage(peerId, mid)
    if(!message) {
      return
    }

    const container = this.tabs[inputFilter]!
    const targets = Array.from(container.querySelectorAll<HTMLElement>('.' + targetClassName)).map((el) => {
      const containerEl = findUpClassName(el, className)!
      return {
        element: el,
        message: getSharedMediaMessage(+containerEl.dataset.peerId!, +containerEl.dataset.mid!),
      }
    }).filter((t): t is { element: HTMLElement, message: MyMessage } => !!t.message)

    const ctx = this.lightboxCtx(targets.map((t) => t.message))
    const items = targets.map((t) => messageToViewerItem(t.message, ctx, t.element))
    const idx = items.findIndex((item) => item.mid === mid)

    void openMediaViewer({
      items,
      index: idx,
      target: items[idx].element!,
      // порядок вкладки — newest-first (`ORDER BY seq DESC`), это и есть
      // порядок листания вьювера (см. докблок `OpenMediaViewerArgs.reverse`)
      reverse: false,
      loadMoreMedia: this.loadMoreMedia(inputFilter, className),
    })
  }

  /**
   * Роль `copySearchContext` → `setSearchContext` (`tweb:757`, `:2795-2801`):
   * за пределы отрисованных плиток вьювер листает ТЕМ ЖЕ контекстом поиска,
   * что и вкладка, — копией на момент открытия (`copy(this.searchContext)`),
   * через тот же шов `searchHistory`. Курсор у загрузчика СВОЙ: он листает с
   * начала выдачи до якоря (расхождение 14), поэтому `nextRate` вкладки ему не
   * передаётся, а свой ведётся страница за страницей.
   */
  private loadMoreMedia(inputFilter: SearchSuperType, className: string): OpenMediaViewerArgs['loadMoreMedia'] {
    const context: SearchHistoryOptions = { ...this.searchContext, inputFilter: { _: inputFilter } }
    let nextRate: number | undefined = 0
    const loader = createMediaNeighboursLoader({
      fetchPage: async(offsetId, limit) => {
        // глобальная выдача без курсора дальше кончилась: запрос с пустым
        // курсором отдал бы её первую страницу заново
        if(offsetId && context.folderId !== undefined && !nextRate) {
          return []
        }

        const value = await this.managers.messages.searchHistory({ ...context, offsetId, limit, nextRate })
        nextRate = value.nextRate
        return value.messages
      },
    })

    return async(older: boolean, anchor: ViewerItem | undefined, loadCount: number) => {
      if(!anchor) return []
      try {
        const slice = await loader.neighbours(anchor.mid, older, loadCount)
        const ctx = this.lightboxCtx(slice)
        const container = this.tabs[inputFilter]!
        // сосед может быть уже отрисован (плитка ниже кликнутой) — тогда полёт
        // закрытия летит в неё; иначе `element: null`, как у tweb `processItem`
        return slice.map((m) => messageToViewerItem(
          m, ctx, container.querySelector<HTMLElement>(`.${className}[data-mid="${m.id}"]`),
        ))
      } catch {
        return [] // ошибка сети = край списка: вьювер листает уже загруженное
      }
    }
  }

  /**
   * Контекст авторов для подписей вьювера — как у ленты
   * (`chat/bubbles.ts::openMediaViewerFor`): карточки пиров точечно из зеркала.
   */
  private lightboxCtx(messages: readonly MyMessage[]): LightboxCtx {
    const peers = new Map<PeerId, NonNullable<ReturnType<typeof cachedPeer>>>()
    for(const m of messages) {
      const fromId = m.fromId
      if(fromId == null || peers.has(fromId)) continue
      const peer = cachedPeer(fromId)
      if(peer) peers.set(fromId, peer)
    }

    return {
      meId: rootScope.myId,
      peers,
      lang: useI18nStore.getState().lang,
    }
  }

  /**
   * tweb `:940-962`. Файл — строка `.document` с именем, размером и временем
   * отправки; музыка, голосовое и кружок — `audio-element` с классом
   * `audio-48`. Голосовое и кружок рисуются КАК ТРЕК (`voiceAsMusic`): у них
   * заголовком стоит отправитель, поэтому подписью времени они не
   * дублируются (`withTime: !showSender`).
   *
   * Возврат синхронный: наш `wrapDocument` синхронен (см. его шапку).
   * `searchContext`/`lazyLoadQueue` не передаются — расхождения 18-19 в шапке.
   */
  private processDocumentFilter({ message, middleware }: ProcessSearchSuperResult) {
    const doc = getDocumentFromMessage(message)!
    const showSender = this.showSender || (['voice', 'round'] as MyDocument['type'][]).includes(doc.type)

    const div = wrapDocument({
      doc,
      // `MyMessage` целиком враппер не берёт (порт в объёме ленты) — ему
      // отдаётся то, что нужно подписи и плееру: адрес, дата, отправитель и
      // гейт точки «не прослушано».
      message: {
        mid: message.id,
        peerId: message.peerId,
        date: message.date,
        fromId: message.fromId,
        fwd_from: message._ === 'message' ? message.fwd_from : undefined,
        out: !!message.pFlags.out,
        mediaUnread: !!message.pFlags.media_unread,
      },
      middleware,
      withTime: !showSender,
      fontWeight: 400,
      voiceAsMusic: true,
      showSender,
      managers: this.managers,
      autoDownloadSize: 0,
      getSize: () => 320,
    })

    if((['audio', 'voice', 'round'] as MyDocument['type'][]).includes(doc.type)) {
      div.classList.add('audio-48')
    }

    return { message, element: div }
  }

  /** tweb `:1259-1283`. */
  private afterPerforming(length: number, mediaTab: SearchSuperMediaTab) {
    const contentTab = mediaTab.contentTab
    if(!contentTab) {
      return
    }

    if(mediaTab.hideOn) {
      mediaTab.hideOn.classList.remove('hide')
    }

    // Всё, что лежит в родителе ПОСЛЕ содержимого вкладки, — это прелоадер и
    // прошлая заглушка «ничего не найдено»; их снимает первый же результат.
    const parent = contentTab.parentElement!
    Array.from(parent.children).slice(1).forEach((child) => {
      child.remove()
    })

    if(!length && !mediaTab.itemsTab!.childElementCount) {
      const div = document.createElement('div')
      div.append(i18n('Chat.Search.NothingFound'))
      div.classList.add('position-center', 'text-center', 'content-empty', 'no-select')

      parent.append(div)
    }
  }

  /**
   * tweb `:1285-1523` — группы контактов вкладки `chats` левой колонки.
   * Зовётся ОДИН раз на запрос из `loadType` (`loadedChats`, `:2232-2235`):
   * все группы очищаются и ложатся в узел вкладки (`:1289-1292`), затем одна
   * из трёх веток —
   *  • С ЗАПРОСОМ (`:1295-1449`): книга контактов (лимит 10), `contacts.search`
   *    (`my_results` → «Chats», `results` → «Global search» с обрезкой до трёх
   *    и «show more») и локальный индекс диалогов, параллельно; пир рисуется
   *    один раз на всю выдачу (`renderedPeerIds`), подпись — `addDialogSubtitle`;
   *  • БЕЗ ЗАПРОСА, пира и даты (`:1450-1519`): группа «Recent» реактивно из
   *    `recentSearch`;
   *  • иначе (выбран чип пира или даты) — ничего: сообщения приедут обычной
   *    веткой `loadType` (`:1522`).
   * Не портировано: реклама (`getSponsoredPeers`, `:1373-1421`) и лента «люди»
   * (`createTopPeersList`, `:1503-1517`) — расхождение 46. Источники данных —
   * расхождение 44, «show more» группы «Global search» — 45.
   */
  private loadChats(): Promise<unknown> {
    const renderedPeerIds: Set<PeerId> = new Set()
    const middleware = this.middleware.get()
    // группы есть только у левой колонки, а вкладка `chats` — только у неё
    const searchGroups = this.searchGroups!

    for(const i in searchGroups) {
      const group = searchGroups[i as SearchGroupType]
      group.clear()
      this.tabs.inputMessagesFilterEmpty!.append(group.container)
    }

    const query = this.searchContext.query
    if(query && !this.searchContext.peerId) {
      const addDialogSubtitle = async(dom: DialogDom, peerId: PeerId) => {
        const peer = await this.getPeer(peerId)
        if(peerId === rootScope.myId) {
          dom.lastMessageSpan.append(i18n('Presence.YourChat'))
        } else {
          let username = getPeerUsername(peer)
          if(!username) {
            if(peer?._ === 'user' && peer.phone) {
              username = formatUserPhone(peer.phone)
            }
          } else {
            username = '@' + username
          }

          const toJoin: (Node | string)[] = [
            username,
          ]

          // `participants_count || participants` (`:1321`) — вектора
          // `participants` у нашей модели чата нет
          if(peer && 'participants_count' in peer && peer.participants_count) {
            toJoin.push(getChatMembersString(cachedChat(peerId), useI18nStore.getState().tArgs))
          }

          dom.lastMessageSpan.append(...join(toJoin.filter(Boolean), false))
        }
      }

      // Третий параметр оригинала (`showMembersCount`) не читается и там —
      // его проверка закомментирована (`:1321`).
      const setResults = (results: PeerId[], group: SearchGroup) => {
        results.flatMap((peerId) => {
          if(renderedPeerIds.has(peerId)) {
            return []
          }

          renderedPeerIds.add(peerId)

          const { dom } = addDialogNew({
            peerId,
            container: group.list,
            avatarSize: 'abitbigger',
            autonomous: group.autonomous,
            wrapOptions: {
              middleware,
            },
            managers: this.managers,
          })

          return [{ dom, peerId }]
        }).forEach(({ dom, peerId }) => void addDialogSubtitle(dom, peerId))

        group.toggle()
      }

      const onLoad = <T>(arg: T) => {
        if(!middleware()) {
          return
        }

        return arg
      }

      return Promise.all([
        this.managers.contacts.getContactsPeerIds(query, true, undefined, 10)
        .then(onLoad)
        .then((contacts) => {
          if(contacts) {
            setResults(contacts, searchGroups.contacts)
          }
        }),

        // `getSponsoredPeers` (`:1373-1421`) — расхождение 46

        this.managers.channels.search(query, 20)
        .then(onLoad)
        .then((contacts) => {
          if(contacts) {
            const globalContacts = searchGroups.globalContacts
            // `contacts.search` отдаёт повторы в `my_results` — дедуп у
            // оригинала в менеджере (`appUsersManager.ts:1089`), расхождение 44
            setResults([...new Set(contacts.my_results.map(getPeerId))], searchGroups.contacts)
            setResults(contacts.results.map(getPeerId), globalContacts)

            // Кнопка прошлого запроса снимается сигналом, а не из DOM
            // (`:1432-1434`) — расхождение 45; снять её надо ДО класса-обрезки:
            // пересчёт класса группы затирает добавленное руками.
            globalContacts.needShowMoreButton('')
            globalContacts.container.classList.add('is-short')

            if(globalContacts.list.childElementCount > 3) {
              globalContacts.needShowMoreButton('is-short')
            }
          }
        }),

        this.managers.dialogs.getDialogs({ query, offsetIndex: 0, limit: 20, filterId: 0 })
        .then(onLoad)
        .then((value) => {
          if(value) {
            setResults(value.dialogs.map((d) => d.peerId), searchGroups.contacts)
          }
        }),
      ])
    } else if(!this.searchContext.peerId && !this.searchContext.minDate) {
      const recent = searchGroups.recent
      const renderRecentSearch = (setActive = true) => {
        if(!middleware()) {
          return
        }

        recent.list.replaceChildren()

        createRoot((dispose) => {
          middleware.onClean(dispose)

          // `useAppState()` (`:1451`) — у нас State в zustand: ключ
          // переводится в сигнал, и `For` ниже реагирует на него так же, как
          // на стор оригинала (расхождение 44)
          const [recentSearch, setRecentSearch] = createSignal(useAppStateStore.getState().recentSearch)
          onCleanup(useAppStateStore.subscribe((state) => setRecentSearch(state.recentSearch)))

          const arr = For({
            get each() {
              return recentSearch()
            },
            children: (key) => {
              // ключ пира в State — строка (`core/state/state.ts:22`)
              const peerId: PeerId = +key
              const middlewareHelper = getMiddleware()
              // строка ушла из списка — её аватар и имя больше не слушаются
              // (у оригинала хелпер строки не гасится) — расхождение 47
              onCleanup(() => middlewareHelper.destroy())
              const { dom } = addDialogNew({
                peerId,
                container: false,
                avatarSize: 'abitbigger',
                autonomous: true,
                wrapOptions: {
                  middleware: middlewareHelper.get(),
                },
                managers: this.managers,
              })

              void (async() => {
                const peer = await this.getPeer(peerId)
                dom.lastMessageSpan.append(isUser(peerId) ?
                  getUserStatusString(peer?._ === 'user' ? peer : undefined) :
                  getChatMembersString(cachedChat(peerId), useI18nStore.getState().tArgs))
              })()

              return dom.containerEl
            },
          })

          const elements = children(() => arr)
          createEffect(() => {
            recent.list.replaceChildren(...(elements.toArray() as HTMLElement[]))
          })

          createEffect(() => {
            if(!recentSearch().length) {
              recent.clear()
            } else if(setActive) {
              recent.setActive()
            }
          })
        })
      }

      // У оригинала — `Promise.all` с обещанием ленты «люди»
      // (`createTopPeersList`, `:1503-1517`, расхождение 46); сама отрисовка
      // недавних синхронна и обещания не даёт.
      renderRecentSearch()
      return Promise.resolve()
    } else return Promise.resolve()
  }

  /**
   * `appPeersManager.getPeer` (RPC у оригинала) — карточка из зеркала; пробел
   * объявляется владельцу (`peers.fillMirror`), как в расхождении 34.
   */
  private async getPeer(peerId: PeerId) {
    let peer = cachedPeer(peerId)
    if(!peer) {
      await this.managers.peers.fillMirror([peerId])
      peer = cachedPeer(peerId)
    }

    return peer
  }

  /**
   * tweb `:1525-1758` — вкладка «Участники». `SortedUserList` создаётся ЛЕНИВО
   * ОДИН РАЗ (`:1543-1574`) и живёт до `cleanup()`; каждая страница лишь
   * доливает в него строки, первая партия — 50, дальше по 200 (`:1719`).
   * Портирована ветка канала (`:1718-1739`) — расхождение 31; живые обновления
   * — 32; навигация и подэкраны — 33; проверка карточки — 34; `nextRates` — 35.
   */
  private async loadMembers({ mediaTab }: SearchSuperLoadTypeOptions) {
    const peerId = this.searchContext.peerId
    const chatId = toChatId(peerId)
    const middleware = this.middleware.get()

    const renderParticipants = async(participants: Participant[]) => {
      if(this.loadMutex) {
        await this.loadMutex

        if(!middleware()) {
          return
        }
      }

      let membersList = this.membersList,
        membersParticipantMap = this.membersParticipantMap,
        membersMiddlewareHelper = this.membersMiddlewareHelper
      if(!membersList || !membersParticipantMap || !membersMiddlewareHelper) {
        membersParticipantMap = this.membersParticipantMap = new Map()
        membersMiddlewareHelper = this.membersMiddlewareHelper = getMiddleware()
        membersList = this.membersList = new SortedUserList({
          rippleEnabled: false,
          managers: this.managers,
          middleware,
        })
        attachClickEvent(membersList.list, (e) => {
          if(findUpClassName(e.target!, 'has-stories')) {
            return
          }

          const li = findUpTag(e.target!, DIALOG_LIST_ELEMENT_TAG)
          if(!li) {
            return
          }

          // `:1562-1570` — `toggleSidebar(false)` на мобиле и `setInnerPeer`
          // здесь оба у хоста (расхождение 33).
          this.openPeer?.(+li.dataset.peerId!)
        })
        mediaTab.itemsTab!.append(membersList.list)
        this.afterPerforming(1, mediaTab)

        if(chatId) {
          const middleware = membersMiddlewareHelper.get()
          createParticipantContextMenu({
            chatId,
            listenTo: membersList.list,
            participants: membersParticipantMap,
            managers: this.managers,
            middleware,
            openPeer: (peerId) => this.openPeer?.(peerId),
            openUserPermissions: (participant, isAdmin) => this.openUserPermissions?.(participant, isAdmin),
          })

          // `:1585-1590` без `setCounter(… − 1)`: счётчик приходит из `count`
          // перечитанного окна (расхождение 32).
          const deleteByPeerId = (peerId: PeerId) => {
            membersList!.ranks.delete(peerId)
            membersList!.delete(peerId)
            membersParticipantMap!.delete(peerId)
          }

          // `:1597-1625` в форме, навязанной проводом (расхождение 32):
          // перечитать отрисованное окно, нарисовать новых, снять ушедших.
          const onChatUpdate = async(update: ChatUpdateEvt) => {
            if(getPeerId(update.peer) !== peerId) {
              return
            }

            // Окно — всё отрисованное; если список был дочитан до конца, то
            // и всё, что появилось за ним (число — из самого снимка).
            const rendered = this.nextRates[mediaTab.type] || 0
            if(!rendered) {
              return
            }

            const total = update.chat_full?.full_chat?.participants_count ?? rendered
            const limit = this.loaded[mediaTab.type] ? Math.max(rendered, total) : rendered
            const participants = await this.managers.groups.channelParticipants(peerId, 0, limit)
            if(!middleware()) {
              return
            }

            this.nextRates[mediaTab.type] = participants.participants.length
            this.loaded[mediaTab.type] = participants.participants.length >= participants.count
            this.setCounter(mediaTab.type, participants.count)

            const processedPeerIds = new Set<PeerId>()
            for(const participant of participants.participants) {
              processedPeerIds.add(getParticipantPeerId(participant))
            }

            membersParticipantMap!.forEach((_participant, peerId) => {
              if(!processedPeerIds.has(peerId)) {
                deleteByPeerId(peerId)
              }
            })

            return renderParticipants(participants.participants)
          }
          rootScope.addEventListener(RT.chatUpdate, onChatUpdate)
          middleware.onClean(() => {
            rootScope.removeEventListener(RT.chatUpdate, onChatUpdate)
          })
        }
      }

      // `:1650-1665` — ветка `chatId`: пиры-чаты в списке участников пропускаются.
      const peerIds = participants.flatMap((participant) => {
        const peerId = getParticipantPeerId(participant)
        if(isAnyChat(peerId)) {
          return []
        }

        return [{
          peerId,
          rank: getParticipantRank(participant),
          participant,
        }]
      })

      // `:1667-1678` — карточка из зеркала, пробел объявляем владельцу
      // (расхождение 34); удалённые аккаунты в список не попадают.
      const filtered = await filterAsync(peerIds, async({ peerId }) => {
        let peer = cachedPeer(peerId)
        if(!peer) {
          await this.managers.peers.fillMirror([peerId])
          peer = cachedPeer(peerId)
        }

        if(!middleware()) {
          return false
        }

        if(!peer || (peer._ === 'user' && peer.pFlags?.deleted)) {
          return false
        }

        return true
      })

      for(const { peerId, rank, participant } of filtered) {
        if(rank) {
          membersList.ranks.set(peerId, rank)
        } else {
          membersList.ranks.delete(peerId)
        }

        membersParticipantMap.set(peerId, participant)
        if(membersList.has(peerId)) {
          void membersList.update(peerId)
        } else {
          void membersList.add(peerId)
        }
      }
    }

    // `:1718-1739` — страница участников канала; `groups.channelParticipants`
    // — наш `getChannelParticipants` (расхождение 31).
    const LOAD_COUNT = !this.membersList ? 50 : 200
    return this.managers.groups.channelParticipants(peerId, this.nextRates[mediaTab.type] || 0, LOAD_COUNT).then((participants) => {
      if(!middleware()) {
        return
      }

      const list = mediaTab.itemsTab!.firstElementChild as HTMLUListElement | null
      this.nextRates[mediaTab.type] = (list ? list.childElementCount : 0) + participants.participants.length

      if(participants.participants.length < LOAD_COUNT) {
        this.loaded[mediaTab.type] = true
      }

      this.setCounter(mediaTab.type, participants.count)

      return renderParticipants(participants.participants)
    })
  }

  /**
   * tweb 812502980 `:2214-2265` — вкладка «Чаты» (savedDialogs):
   * `AutonomousSavedDialogList` + `SortedDialogList` на скроллере ВСЕЙ панели,
   * строки — `DialogElement` своего пира с источником в `threadId`
   * (расхождение 40 в шапке).
   */
  private loadSavedDialogs({ mediaTab, middleware }: SearchSuperLoadTypeOptions): Promise<void> {
    if(this._loadSavedDialogs) {
      return this._loadSavedDialogs()
    }

    const xd = new AutonomousSavedDialogList({ appDialogsManager, managers: this.managers })
    xd.scrollable = this.scrollable
    xd.sortedList = new SortedDialogList({
      appDialogsManager,
      requestItemForIdx: xd.requestItemForIdx,
      onListShrinked: xd.onListShrinked,
      itemSize: 72,
      scrollable: this.scrollable,
      // `indexKey: 'index_0'` — у оригинала это и делает строку `isMainList`
      filterId: ALL_FOLDER_ID,
      virtualFilterId: rootScope.myId,
      virtualDialogs: xd,
      extraPaddingBottom: 0,
    })

    const list = xd.sortedList.list

    // `withContext: true` и `xd.attachPinnedReorder()` — О-111 волна 7: меню
    // строки и перестановку закрепов нечем исполнить (на бэкенде нет ни закрепа,
    // ни удаления сохранённого диалога). `openInner` — О-110 волна 7: окна
    // сохранённого диалога нет, строку открывает клик списка (`setListClickListener`).
    appDialogsManager.setListClickListener({ list })

    // расхождение 40: число строк полученной страницы
    const getCount = () => xd.getCount()

    const onAnyUpdate = xd.onAnyUpdate = async() => {
      if(!middleware()) return
      const count = await getCount()
      if(!middleware()) return
      this.setCounter(mediaTab.type, count)
    }

    void onAnyUpdate()

    mediaTab.itemsTab!.append(list)
    this.afterPerforming(1, mediaTab)

    this._loadSavedDialogs = () => Promise.resolve(xd.onChatsScroll())
    middleware.onClean(() => {
      xd.destroy()
      list.remove()
      this._loadSavedDialogs = undefined
    })

    return Promise.resolve(xd.onChatsScroll())
  }

  /**
   * tweb `:1943-1969` — строки пиров группы вкладки «Каналы»: подпись — число
   * участников у чата, иначе `@username`. Строки идут по одной, каждая ждёт
   * свою карточку, как у оригинала. Ветки ботов (`bot_active_users`,
   * `type === 'bots'`, `:1961-1966`) и сам параметр `type` — вкладки `apps`
   * (задача 16), расхождение 46.
   */
  private async renderPeerDialogs(peerIds: PeerId[], group: SearchGroup, middleware: Middleware) {
    if(!middleware()) return

    for(const peerId of peerIds) {
      const { dom } = addDialogNew({
        peerId,
        container: group.list,
        avatarSize: 'abitbigger',
        wrapOptions: {
          middleware,
        },
        managers: this.managers,
      })

      const peer = await this.getPeer(peerId)
      const username = getPeerUsername(peer)

      if(peer && 'participants_count' in peer) {
        dom.lastMessageSpan.append(getChatMembersString(cachedChat(peerId), useI18nStore.getState().tArgs))
      } else if(username) {
        dom.lastMessageSpan.append('@' + username)
      }
    }
  }

  /**
   * tweb `:1971-2022` — вкладка «Каналы» левой колонки. С запросом —
   * `contacts.search` с запасом (200), из выдачи остаются вещательные каналы,
   * группа без заголовка; без запроса — «Channels you joined» из закэшированных
   * диалогов (обрезка до пяти и «show more»). Группа «SimilarChannels»
   * (`:2009-2018`) — задача 15 плана поиска, расхождение 46; источники данных —
   * 44; проверка актуальности после ответа — 47.
   */
  private async loadChannels({ mediaTab, middleware }: SearchSuperLoadTypeOptions) {
    if(this.searchContext.query) {
      const group = createSearchGroup({ name: 'Channels', type: 'channels', middleware })
      group.setActive()
      group.nameEl.style.display = 'none'

      const SEARCH_LIMIT = 200 // will get filtered anyway
      const { results: globalResults } = await this.managers.channels.search(this.searchContext.query, SEARCH_LIMIT)
      const filteredResultsWithUndefined = await Promise.all(
        globalResults.map(async(peer) => {
          // `appPeersManager.isBroadcast(user)` — вопрос зеркалу после
          // объявления пробела (расхождение 44)
          const peerId = getPeerId(peer)
          await this.getPeer(peerId)
          return isBroadcastPeer(peerId) ? peerId : undefined
        }),
      )
      const filteredResults = filteredResultsWithUndefined.filter((peerId): peerId is PeerId => peerId !== undefined)

      if(!middleware()) return

      void this.renderPeerDialogs(filteredResults, group, middleware)

      if(filteredResults.length) {
        mediaTab.itemsTab!.append(group.container)
      }
      this.afterPerforming(filteredResults.length, mediaTab)

      this.loaded[mediaTab.type] = true
      return
    }

    // `dialogsStorage.getCachedDialogs()` — диалоги реальных папок по порядку
    // `REAL_FOLDERS` (основная, затем архив; `dialogs.ts:491-494`), у нас —
    // из зеркала диалогов (расхождение 44)
    const dialogs = useChatsStore.getState().dialogs
    const cachedDialogs = [...dialogs.filter((dialog) => !isDialogArchived(dialog)), ...dialogs.filter(isDialogArchived)]
    const channelDialogs = cachedDialogs.filter((dialog) => isBroadcastPeer(dialog.peerId))

    if(channelDialogs.length) {
      const group = createSearchGroup({ name: 'Chat.Search.JoinedChannels', type: 'channels', middleware })
      group.setActive()
      mediaTab.itemsTab!.append(group.container)

      const SHOW_MORE_LIMIT = 5
      if(channelDialogs.length > SHOW_MORE_LIMIT) group.needShowMoreButton()

      void this.renderPeerDialogs(channelDialogs.map((dialog) => dialog.peerId), group, middleware)
    }

    // `getChannelRecommendations()` → группа «SimilarChannels» (`:2009-2018`) — расхождение 46

    this.afterPerforming(1, mediaTab)
    this.loaded[mediaTab.type] = true
  }

  /**
   * tweb `:2130-2179` — вкладка «Подарки». Первый вызов монтирует Solid-витрину
   * (расхождение 36) и отдаёт ей счётчик: ноль подарков прячет строку ряда, а
   * если витрина была активной — уступает первой видимой вкладке
   * (`:2143-2153`). Каждый новый набор кладёт первые три подарка в имя вкладки
   * (`setPinnedGifts`, `:2156-2160`). Повторный вызов — догрузка
   * (`:2174-2178`), у нас после первого ответа набор дочитан.
   */
  private loadGifts(): Promise<void> {
    const mediaTab = this.mediaTabsMap.get('gifts')
    if(!mediaTab) return Promise.resolve()

    if(!this.stargiftsStore) {
      const middleware = this.middleware.get()
      const { dispose } = mountSolid<StarGiftsProfileTabProps>(mediaTab.itemsTab!, StarGiftsProfileTab, {
        peerId: this.searchContext.peerId,
        managers: this.managers,
        onCountChange: (count) => {
          this.setCounter('gifts', count)

          mediaTab.menuTab!.classList.toggle('hide', count === 0)
          let needChangeActive = false
          if(count === 0) {
            needChangeActive = mediaTab.menuTab!.classList.contains('active')
            mediaTab.menuTab!.classList.remove('active')
          }
          this.updateContainerHidden(needChangeActive)
        },
        ref: ({ store, actions }) => {
          // `:2156-2160`; условие `chosenCollection === ALL_COLLECTIONS_ID`
          // у нас всегда истинно — коллекций нет (расхождение 39).
          createEffect(on(() => store.items, (items) => {
            if(items.length > 0) {
              this.setPinnedGifts(unwrap(items))
            }
          }))
          this.stargiftsStore = store
          this.stargiftsActions = actions
        },
      })
      // расхождение 37 — сброс вместе с корнем
      middleware.onClean(() => {
        dispose()
        this.stargiftsStore = this.stargiftsActions = undefined
      })

      if(this.mediaTab?.type === 'gifts') {
        this.onChangeTab?.(this.mediaTab)
      }
      return Promise.resolve()
    }

    if(this.stargiftsStore.loading || this.stargiftsStore.loaded) {
      return Promise.resolve()
    }

    return this.stargiftsActions!.loadNext()
  }

  /**
   * tweb fb18166dc — How far a tab has got, for `ScrollableRefiller`: fetched
   * messages plus the ones already rendered out of them. Both only ever grow
   * within a peer (and `cleanup` resets the refiller along with them), which is
   * what makes the refill chain terminate.
   *
   * This is the exact state behind `canLoadMediaTab`'s second clause: the
   * `justLoad` preload grows `historyStorage` WITHOUT rendering, and the only
   * thing that renders the remainder into a list too short to scroll is the
   * chain. A tab with no `inputFilter` — saved dialogs, stories, gifts, apps,
   * posts — has no such state and no cache to drain, so it reports a flat 0 and
   * gets the one check after a load that asks "is the viewport full yet"; its
   * list owns whatever paging comes after that.
   */
  private getMediaTabProgress(type: SearchSuperMediaType) {
    const inputFilter = this.mediaTabsMap.get(type)?.inputFilter
    if(!inputFilter) {
      return 0
    }

    return Math.max(0, this.usedFromHistory[inputFilter] ?? 0) + (this.historyStorage[inputFilter]?.length ?? 0)
  }

  /** tweb `:2362-2369`. */
  private canLoadMediaTab(mediaTab: SearchSuperMediaTab) {
    if(mediaTab.type === 'gifts') {
      return !this.stargiftsStore || (!this.stargiftsStore.loading && !this.stargiftsStore.loaded)
    }

    const inputFilter = mediaTab.inputFilter
    const history = inputFilter && this.historyStorage[inputFilter]
    return !this.loaded[mediaTab.type] ||
      (!!history && !!inputFilter && this.usedFromHistory[inputFilter]! < history.length)
  }

  /**
   * tweb `:2380-2513` — ПЕРВЫЙ ПОКАЗ: какие вкладки есть у этого пира и какая
   * открывается первой. Счётчики всех медиа-вкладок берутся ОДНИМ запросом
   * (`:2388-2389`), предикаты остальных — параллельно с ним; вкладка, которой
   * нечего показать, получает `hide` на строке ряда, но ИЗ DOM НЕ УХОДИТ — так
   * свайп (`:517-531`) и `updateContainerHidden` знают о ней. Приоритет первой
   * открытой (`:2478-2495`): stories → members (перебивает stories) →
   * savedDialogs → gifts, иначе первая непустая медиа-вкладка. Выбор идёт без
   * анимации и без прокрутки (`skipScroll`).
   *
   * `maybePinnedGifts`/`setPinnedGifts` (`:2410`, `:2499-2501` — топ-3
   * подарков стикерами в ряду) приезжают задачей 12. Расхождения 26-29 в шапке.
   */
  private async loadFirstTime() {
    const middleware = this.middleware.get()
    const { peerId } = this.searchContext
    if(!this.hideEmptyTabs) {
      return
    }

    const mediaTabs = this.mediaTabs.filter(isCounterDrivenMediaTab)
    const filters = mediaTabs.map((mediaTab) => mediaTab.inputFilter!)

    const [
      counters,
      canViewSavedDialogs,
      canViewSaved,
      canViewMembers,
      canViewGroups,
      canViewStories,
      canViewSimilar,
      canViewGifts,
      giftsCount,
    ] = await Promise.all([
      this.getSearchCounters(filters),
      this.canViewSavedDialogs(),
      this.canViewSaved(),
      this.canViewMembers(),
      this.canViewGroups(),
      this.canViewStories(),
      this.canViewSimilar(),
      // единственный синхронный предикат (`:2700`); в `Promise.all` — под `await-thenable`
      Promise.resolve(this.canViewGifts()),
      this.getGiftsCount(),
      // `:2410` — `appGiftsManager.getPinnedGifts(peerId)` у своего профиля: задача 12.
    ])

    if(!middleware()) {
      return
    }

    if(this.loadMutex) {
      await this.loadMutex

      if(!middleware()) {
        return
      }
    }

    let firstMediaTab: SearchSuperMediaTab | undefined
    let count = 0
    mediaTabs.forEach((mediaTab) => {
      const counter = counters.find((c) => c.inputFilter === mediaTab.inputFilter)!

      mediaTab.menuTab!.classList.toggle('hide', !counter.count)
      mediaTab.menuTab!.classList.remove('active')

      this.setCounter(mediaTab.type, counter.count)

      if(counter.count) {
        if(firstMediaTab === undefined) {
          firstMediaTab = mediaTab
        }

        ++count
      }
    })

    const savedDialogsTab = this.mediaTabsMap.get('savedDialogs')
    const savedTab = this.mediaTabsMap.get('saved')
    const membersTab = this.mediaTabsMap.get('members')
    const storiesTab = this.mediaTabsMap.get('stories')
    const groupsTab = this.mediaTabsMap.get('groups')
    const similarTab = this.mediaTabsMap.get('similar')
    const giftsTab = this.mediaTabsMap.get('gifts')

    const showGiftsTab = canViewGifts && giftsCount !== 0

    const a: [SearchSuperMediaTab | undefined, boolean][] = [
      [savedDialogsTab, canViewSavedDialogs],
      [savedTab, canViewSaved],
      [storiesTab, canViewStories],
      [membersTab, canViewMembers],
      [groupsTab, canViewGroups],
      [similarTab, canViewSimilar],
      [giftsTab, showGiftsTab],
    ]

    a.forEach(([tab, value]) => {
      if(!tab) {
        return
      }

      tab.menuTab!.classList.toggle('hide', !value)

      if(value) {
        ++count
      }
    })

    this.setCounter('gifts', giftsCount)

    // Каждый `canView*` ниже истинен только при объявленной вкладке — узел есть.
    if(canViewStories) {
      firstMediaTab = storiesTab

      const newTitle = i18n(isUser(peerId) ? 'Stories' : 'ProfileStories')
      storiesTab!.menuTabName!.replaceWith(storiesTab!.menuTabName = newTitle)
    }

    if(canViewMembers) {
      firstMediaTab = membersTab
    }

    if(canViewSavedDialogs) {
      firstMediaTab = savedDialogsTab
    }

    if(showGiftsTab && !firstMediaTab) {
      firstMediaTab = giftsTab
    }

    // `:2499-2501` — `setPinnedGifts(maybePinnedGifts)`: задача 12.

    this.toggleContainerHidden(!firstMediaTab)
    if(firstMediaTab) {
      this.skipScroll = true
      this.selectTab(this.mediaTabs.indexOf(firstMediaTab), false)

      const isSingle = count <= 1
      this.navScrollableContainer.classList.toggle('is-single', isSingle)
      this.menuGradient.classList.toggle('hide', isSingle)
    }
  }

  /** tweb `:2515-2518` — подсистема целиком: `hide` на контейнере, `search-empty` — на родителе. */
  private toggleContainerHidden(hidden: boolean) {
    this.container.classList.toggle('hide', hidden)
    this.container.parentElement?.classList.toggle('search-empty', hidden)
  }

  /**
   * tweb `:2520-2529` — пересчёт по ФАКТИЧЕСКИ видимым строкам ряда: когда
   * вкладка обнулилась живым апдейтом. `changeActive` — среди пропавших была
   * активная, переключиться на первую видимую. Вызывающих у оригинала два:
   * счётчик подарков (`:2151-2154`) и видимость вкладки по счётчику
   * (`updateMediaTabVisibility`, ca1416807); `public` вместо `private` —
   * расхождение 30 в шапке.
   */
  public updateContainerHidden(changeActive = false) {
    const visibleTabs = this.mediaTabs.filter((tab) => !tab.menuTab!.classList.contains('hide'))
    this.toggleContainerHidden(visibleTabs.length === 0)
    const isSingle = visibleTabs.length <= 1
    this.navScrollableContainer.classList.toggle('is-single', isSingle)
    this.menuGradient.classList.toggle('hide', isSingle)
    if(changeActive && visibleTabs.length) {
      this.selectTab(this.mediaTabs.indexOf(visibleTabs[0]), false)
    }
  }

  /**
   * tweb `:2181-2360` — загрузка ОДНОЙ вкладки. Три существенных свойства
   * оригинала, каждое из которых у нас прежде отсутствовало:
   *
   *  1. ДЕДУПЛИКАЦИЯ (`:2192-2195`): пока обещание типа живо, второй запрос не
   *     уходит — возвращается то же обещание.
   *  2. РЕНДЕР ИЗ КЭША (`:2245-2276`): если в списке фильтра есть неотрисованный
   *     хвост, порция берётся ИЗ НЕГО, и сети не будет вовсе.
   *  3. ПАГИНАЦИЯ КУРСОРОМ (`:2278-2291`): следующая страница просится по id
   *     последнего элемента списка, а не по его длине.
   */
  private loadType(options: SearchSuperLoadTypeOptions): Promise<unknown> {
    const { mediaTab, justLoad, loadCount, middleware } = options
    const { type, inputFilter } = mediaTab

    const running = this.loadPromises[type]
    if(running) {
      return running
    }

    // tweb `:2197-2227` — развилка типов без фильтра сообщений: участники
    // (`groups` — расхождение 31), сохранённые и подарки (задача 12), каналы
    // левой колонки (задача 9 плана поиска); истории/похожие каналы — не
    // вкладки правой колонки у нас (`docs/tweb/shared-media.md` § 2.1),
    // приложения/посты — не вкладки левой (задачи 16-17 плана поиска).
    let special: Promise<unknown> | undefined
    if(type === 'members') {
      special = this.loadMembers(options)
    } else if(type === 'savedDialogs') {
      special = this.loadSavedDialogs(options)
    } else if(type === 'channels') {
      special = this.loadChannels(options)
    } else if(type === 'gifts') {
      special = this.loadGifts()
    }

    if(special) {
      return this.loadPromises[type] = special.finally(() => {
        if(!middleware()) {
          return
        }

        this.loadPromises[type] = null

        // докрутить, если содержимого не хватило на экран (`:2222-2224`) —
        // только пока вкладка растёт (tweb fb18166dc, B8): у `savedDialogs`
        // `loaded` не ставится никогда, и безусловный повтор крутился вечно
        this.refiller.schedule(type, middleware)
      })
    }

    // Вкладки без фильтра сообщений, у которых нет и своего загрузчика
    // (`stories`/`similar`/`apps`/`posts`, выше), у нас не объявляются; у
    // оригинала сюда не доходит ни одна.
    if(!inputFilter) {
      return Promise.resolve()
    }

    const history = this.historyStorage[inputFilter] ??= []

    // tweb `:2231-2240` — вкладка `chats`: группы контактов рисуются ОДИН раз
    // на запрос (`loadedChats`), а пустой запрос без пира и даты выдачи
    // сообщений не просит вовсе — его содержимое только группы. Условие
    // `type !== 'saved'` (`:2231`) не переносится: вкладки `saved` нет
    // (расхождение 26), а другой вкладки с пустым фильтром у класса нет.
    if(inputFilter === 'inputMessagesFilterEmpty' && !history.length) {
      if(!this.loadedChats) {
        void this.loadChats()
        this.loadedChats = true
      }

      if(!this.searchContext.query!.trim() && !this.searchContext.peerId && !this.searchContext.minDate) {
        this.loaded[type] = true
        return Promise.resolve()
      }
    }

    const promise: Promise<unknown> = this.loadPromises[type] = Promise.resolve().then(async() => {
      // 2 — рендер из кэша
      if(history.length && this.usedFromHistory[inputFilter]! < history.length && !justLoad) {
        const messages: MyMessage[] = []
        let used = Math.max(0, this.usedFromHistory[inputFilter]!)
        let slicedLength = 0

        do {
          const ids = history.slice(used, used + loadCount)
          used += ids.length
          slicedLength += ids.length

          messages.push(...this.filterMessagesByType(
            ids.map((m) => getSharedMediaMessage(m.peerId, m.mid)),
            inputFilter,
          ))
        } while(slicedLength < loadCount && used < history.length)

        this.usedFromHistory[inputFilter] = used
        return this.performSearchResult({ messages, mediaTab }).finally(() => {
          this.refiller.schedule(type, middleware) // tweb fb18166dc
        })
      }

      // 3 — курсор: id последнего уже загруженного (`tweb:2278-2279`), у
      // глобальной выдачи — ещё и `nextRate` прошлого ответа (`:2288`). Ручку
      // по контексту выбирает шов `searchHistory` (`requestHistory` оригинала).
      // `offsetPeerId` (`:2280`) не передаётся — расхождение 43.
      const lastItem = history[history.length - 1]
      const offsetId = lastItem?.mid || 0

      const value = await this.managers.messages.searchHistory({
        ...this.searchContext,
        inputFilter: { _: inputFilter },
        offsetId,
        limit: loadCount,
        nextRate: this.nextRates[type] ??= 0,
      })
      const messages = value.messages
      saveSharedMediaMessages(messages)

      history.push(...messages.map((m) => ({ mid: m.id, peerId: m.peerId })))

      if(!this.counters[type]) {
        this.setCounter(type, value.count)
      }

      if(!middleware()) {
        return
      }

      // `tweb:2310-2319`: страница короче запрошенной ИЛИ глобальная выдача
      // (`folderId` задан) без курсора дальше. `isEnd.top` — расхождение 43.
      if(
        messages.length < loadCount ||
        (this.searchContext.folderId !== undefined && !value.nextRate)
      ) {
        this.loaded[type] = true
      }

      this.nextRates[type] = value.nextRate

      if(justLoad) {
        return
      }

      this.usedFromHistory[inputFilter] = history.length

      // `tweb:2329-2348` — отложенная предзагрузка следующей страницы: пока
      // пользователь смотрит на эту, следующая уже едет.
      if(!this.loaded[type]) {
        void promise.then(() => {
          setTimeout(() => {
            if(!middleware()) return
            if(this.mediaTab === mediaTab) {
              void this.load(true, true).then(() => {
                if(!middleware()) return
                this.refiller.schedule(type, middleware) // tweb fb18166dc
              })
            }
          }, 0)
        })
      }

      return this.performSearchResult({
        messages: this.filterMessagesByType(messages, inputFilter),
        mediaTab,
        canAnimateIn: !offsetId,
      })
    }).catch(() => {
      // Оригинал логирует (`:2353-2354`); логгера у подсистемы нет — ошибка
      // сети означает «страница не приехала», и вкладка останется как есть.
    }).finally(() => {
      this.loadPromises[type] = null
    })

    return promise
  }

  /**
   * tweb `:2531-2576`. `single` — только текущая вкладка, иначе все остальные
   * (предзагрузка соседних). `justLoad` — набить кэш, ничего не рисуя.
   *
   * Первый вызов после `cleanup()` сначала ждёт `loadFirstTime` (`:2536-2544`):
   * до него `this.mediaTab` — просто первая вкладка набора, а не та, что
   * выбрана по счётчикам. Обещание одно на все параллельные вызовы (`??=`).
   */
  public async load(single = false, justLoad = false, side: 'top' | 'bottom' = 'bottom') {
    const middleware = this.middleware.get()

    if(this.firstLoad) {
      await (this.loadFirstTimePromise ??= this.loadFirstTime())
      if(!middleware()) {
        return
      }

      this.loadFirstTimePromise = undefined
      this.firstLoad = false
    }

    let toLoad = single ? [this.mediaTab] : this.mediaTabs.filter((t) => t !== this.mediaTab)
    toLoad = toLoad.filter((mediaTab) => this.canLoadMediaTab(mediaTab))

    // tweb `:2551-2555` — «участники» у пользователя и «общие группы» у чата
    // выбрасываются здесь.
    if(isUser(this.searchContext.peerId)) {
      findAndSplice(toLoad, (mediaTab) => mediaTab.type === 'members')
    } else {
      findAndSpliceAll(toLoad, (mediaTab) => mediaTab.type === 'groups')
    }

    if(!toLoad.length) {
      return
    }

    const loadCount = justLoad ? 50 : Math.round((windowSize.height / 130 | 0) * 3 * 1.25)

    const promises = toLoad.map((mediaTab) => this.loadType({
      mediaTab,
      justLoad,
      loadCount,
      middleware,
      side,
    }))

    // tweb `:2572-2574` — результат `Promise.all` отдаётся как есть; ошибка
    // одной вкладки гасится там же, где у оригинала (`this.log.error` —
    // расхождение 17: логгера нет, остаётся только гашение).
    return Promise.all(promises).catch(() => {})
  }

  /**
   * tweb `:2611-2626`. У оригинала «диалоги Избранного достались» —
   * `dialogsStorage.getDialogs({filterId: myId})`; у нас тот же вопрос задаёт
   * ручка `chats.savedDialogs` (расхождение 29). Сам список тянет вкладка
   * (`loadSavedDialogs`, задача 12).
   */
  public async canViewSavedDialogs() {
    if(this.searchContext.peerId !== rootScope.myId || this.searchContext.threadId || !this.mediaTabsMap.has('savedDialogs')) {
      return false
    }

    try {
      await this.managers.chats.savedDialogs()
      return true
    } catch {
      return false
    }
  }

  /**
   * tweb `:2579-2610` — первые три подарка набора рисуются в имени вкладки
   * (`menuTabName`, тот самый узел `i18n(mediaTab.name)`), под классом-обёрткой
   * `search-super-pinned-gifts-wrap`. Пустой набор снимает узел; повторный
   * вызов ПОДМЕНЯЕТ детей (`replaceChildren`), а не копит. Символ вместо
   * стикера — расхождение 38 в шапке; `Promise.all` оригинала ждал рендера
   * стикеров, символу ждать нечего — узлы строятся синхронно.
   */
  public setPinnedGifts(gifts: SavedStarGift[]) {
    const giftsTab = this.mediaTabsMap.get('gifts')
    const menuTabName = giftsTab?.menuTabName
    if(!menuTabName) return
    menuTabName.classList.add('search-super-pinned-gifts-wrap')
    const nodes = gifts.slice(0, 3).map((gift) => {
      const div = document.createElement('div')
      div.classList.add('media-sticker-wrapper')
      div.textContent = gift.gift.emoji ?? ''
      return div
    })

    let wrap = menuTabName.querySelector('.search-super-pinned-gifts')
    if(nodes.length === 0) {
      wrap?.remove()
      return
    }

    if(!wrap) {
      wrap = document.createElement('div')
      wrap.className = 'search-super-pinned-gifts'
      menuTabName.append(wrap)
    }
    wrap.replaceChildren(...nodes)
  }

  /**
   * tweb `:2627-2643` — вкладка `saved` (Saved Messages внутри пира). Всегда
   * `false`: историю треда по `saved_peer_id` бэкенд не отдаёт — задача 17
   * плана («Отложено»), расхождение 26.
   */
  public async canViewSaved() {
    return false
  }

  /**
   * tweb `:2644-2657`. Три вопроса о чате (`isBroadcast`,
   * `hasRights('view_participants')`, `isForum`) у оригинала — RPC в
   * `appChatsManager`; у нас они читаются из зеркала карточек после объявления
   * пробела владельцу (`peers.fillMirror`) — расхождение 27.
   */
  public async canViewMembers() {
    const { peerId } = this.searchContext
    if(!isAnyChat(peerId) || !this.mediaTabsMap.has('members')) return false
    await this.managers.peers.fillMirror([peerId])
    const isBroadcast = isBroadcastPeer(peerId)
    const hasRights = hasRightsPeer(peerId, 'view_participants')
    const isForum = isForumPeer(peerId)
    return !isBroadcast && hasRights && (!this.searchContext.threadId || !isForum)
  }

  /**
   * tweb `:2658-2664` — «Общие группы». Всегда `false`: аналога
   * `users.getCommonChats` у бэкенда нет вовсе — задача 16 плана («Отложено»),
   * расхождение 26.
   */
  public async canViewGroups() {
    return false
  }

  /**
   * tweb `:2665-2685`. Ветка пользователя — есть ли закреплённые истории
   * (`stories.pinnedStories`); ветка чата — `false`: флага
   * `stories_pinned_available` у нашей `ChannelFull` нет. `storiesArchive`
   * (`:2674-2676`) не портирован — такой опции у класса нет. Расхождение 28.
   */
  public async canViewStories() {
    const { peerId, threadId } = this.searchContext
    if(!this.mediaTabsMap.has('stories') || threadId) {
      return false
    }

    if(peerId === rootScope.myId) {
      return false
    }

    if(isUser(peerId)) {
      return this.managers.stories.pinnedStories(peerId).then((stories) => !!stories.length).catch(() => false)
    }

    return false
  }

  /**
   * tweb `:2686-2699` — «Похожие каналы». Всегда `false`: вкладка отложена
   * (задача 18 плана), а без неё `getChannelRecommendations` на каждое
   * открытие чата — запрос впустую. Расхождение 26.
   */
  public async canViewSimilar() {
    return false
  }

  /** tweb `:2700-2703` */
  public canViewGifts() {
    return !this.searchContext.threadId && this.mediaTabsMap.has('gifts')
  }

  /**
   * tweb `:2704-2712`. `stargifts_count` полной карточки у нас нет — число
   * берётся длиной списка `stars.profileGifts`, и потому не считается вовсе,
   * когда вкладки `gifts` нет (у оригинала это чтение кэшированного профиля,
   * у нас — запрос списка). В треде оригинал отдаёт `undefined`, у нас `0`:
   * тип счётчика — число, а на видимость это не влияет. Расхождение 29.
   */
  public async getGiftsCount() {
    if(!this.canViewGifts()) {
      return 0
    }

    const gifts = await this.managers.stars.profileGifts(this.searchContext.peerId)
    return gifts.length
  }

  /**
   * tweb `:2714-2754`. Помечает всё загруженное недействительным, НО САМ КЭШ
   * СООБЩЕНИЙ НЕ ТРЁТ: `usedFromHistory[filter] = -1` значит «из кэша ничего не
   * отрисовано», а не «кэша нет» — вернувшись к тому же пиру, вкладки
   * нарисуются без сети (`tweb:2239-2276`).
   */
  public cleanup() {
    this.loadPromises = {}
    this.loaded = {}
    this.refiller.reset() // tweb fb18166dc
    this.loadedChats = false
    this.firstLoad = true
    this.nextRates = {}
    this.prevTabId = -1
    this.counters = {}

    this.lazyLoadQueue.clear()

    this.mediaTabs.forEach((mediaTab) => {
      const { inputFilter } = mediaTab
      if(!inputFilter) {
        return
      }

      this.usedFromHistory[inputFilter] = -1
    })

    // tweb `:3121-3123` (812502980)
    if(this.selection?.isSelecting) {
      this.selection.cancelSelection()
    }

    this.middleware.clean()
    this.loadFirstTimePromise = undefined
    this.cleanScrollPositions()

    // tweb `:2749-2752` — состояние участников; следующий `loadMembers`
    // заведёт список заново.
    this.membersList = undefined
    this.membersParticipantMap = undefined
    this.membersMiddlewareHelper?.destroy()
    this.membersMiddlewareHelper = undefined
  }

  /**
   * tweb `:2756-2760`. Зовётся СНАРУЖИ при выходе из полноэкранного режима
   * shared media (`sharedMedia.tsx:515`): геометрия поменялась, и запомненные
   * позиции больше ни о чём не говорят.
   */
  public cleanScrollPositions() {
    this.mediaTabs.forEach((mediaTab) => {
      mediaTab.scroll = undefined
    })
  }

  /**
   * tweb `:2762-2793`. Возвращает разметку в состояние «ещё ничего не
   * показывали»: списки пусты, карточки секций снова скрыты, у вкладок без
   * кэша крутится прелоадер, скролл — в начало.
   *
   */
  public cleanupHTML() {
    this.mediaTabs.forEach((tab) => {
      tab.itemsTab!.replaceChildren()

      if(tab.hideOn) {
        tab.hideOn.classList.add('hide')
      }

      if(this.hideEmptyTabs) {
        this.container.classList.add('hide')
        this.container.parentElement?.classList.add('search-empty')
      }

      if(tab.type === 'chats') {
        return
      }

      if(tab.inputFilter && !this.historyStorage[tab.inputFilter]) {
        const parent = tab.contentTab!.parentElement!
        if(!parent.querySelector('.preloader')) {
          putPreloader(parent, true)
        }

        const empty = parent.querySelector('.content-empty')
        empty?.remove()
      }
    })

    this.searchGroupMedia.clear()
    this.scrollable.scrollPosition = 0
  }

  /**
   * tweb `:2803-2826`. Пересобирает контекст поиска, ПОДМЕНЯЕТ кэш на
   * переданный снаружи (кэш принадлежит обвязке и живёт по пирам) и зовёт
   * `cleanup()`. Загрузку НЕ запускает — это ответственность вызывающего.
   */
  public setQuery({ peerId, query, threadId, historyStorage, folderId, minDate, maxDate, chatType }: {
    peerId: PeerId
    query?: string
    threadId?: number
    historyStorage?: AppSearchSuper['historyStorage']
    folderId?: number
    minDate?: number
    maxDate?: number
  } & Pick<SearchHistoryOptions, 'chatType'>) {
    this.searchContext = {
      peerId,
      query: query || '',
      inputFilter: { _: this.mediaTab.inputFilter },
      threadId,
      folderId,
      minDate,
      maxDate,
      chatType,
    }

    this.historyStorage = historyStorage ?? {}

    this.cleanup()
  }

  /**
   * tweb `:2828-2843`.
   *
   * `this.scrollable.destroy()` (`:2831`) НЕ портирован: скроллер чужой и
   * переживает подсистему — снимается только свой `onScrolledBottom`
   * (расхождение 7 в шапке файла). `container.remove()` и несброшенный
   * `selectTab` — расхождение 8.
   */
  public destroy() {
    this.cleanup()
    this.listenerSetter.removeAll()
    if(this.scrollable.onScrolledBottom === this.onScrolledBottom) {
      this.scrollable.onScrolledBottom = undefined
    }
    this.swipeHandler?.removeListeners()
    // tweb `:3245` (812502980); узел меню — расхождение 53
    this.selection?.cleanup()
    this.searchContextMenu?.destroy()

    // Расхождение 2 в шапке: корни Solid-секций утилизируются, чтобы
    // `destroy()` не оставлял следов; корень группы медиа — расхождение 42.
    this.disposeSections.forEach((dispose) => dispose())
    this.disposeSections.length = 0
    this.searchGroupMediaMiddleware.destroy()

    this.container.remove()

    this.scrollStartCallback =
      this.onChangeTab =
      this.searchContextMenu =
      this.swipeHandler =
      this.selection =
        undefined
  }
}
