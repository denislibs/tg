// Порт папочного среза tweb `src/lib/appDialogsManager.ts` (2695 строк; здесь —
// `:480-490, :518-575, :577-727, :729-822, :851-858, :924-968, :1014-1101,
// :1170-1176, :1249-1322`): владелец контейнеров папок над списком чатов и их
// переключения. Разбор с адресами — `docs/tweb/folders-tabs.md` § 1.6; план —
// задача 5 `docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`.
//
// Что делает (как оригинал): кладёт в `.connection-status-bottom` оверлей
// `.chatlist-overlay` (плашка-подсказка, градиент и Solid-ряд вкладок
// `foldersTabs.solid.tsx` — узлами без хоста) и `#folders-container.tabs-container`;
// на каждую папку один раз создаёт скроллер `.tabs-tab.chatlist-parts.folders-scrollable`
// с `.chatlist-top` + `.chatlist-bottom` и держит его на позиции `localId`;
// переключает папки через `horizontalMenu` + `TransitionSlider.slideTabs`; перед
// показом чистит список цели, по концу перехода — списки всех неактивных, и
// заново просит первую страницу (памяти `scrollTop` у папок в tweb НЕТ —
// поправка 1 плана); повторный клик по активной — плавная прокрутка к началу.
// Строка диалога (`DialogElement`, `setLastMessage`/`setUnreadMessages`, клик
// по списку) — ниже, раздел «СТРОКА ДИАЛОГА» со своими расхождениями С1–С9
// (задача 1-1 волны 7, `docs/superpowers/plans/2026-09-30-wave-7-shell-sidebars.md`).
// Контекстное меню диалога (`DialogsContextMenu`, `:850`, `:2337-2339`) — задача
// 1-2, расхождение 23. Остальной менеджер (форум-табы, сторис, активность) —
// задачи 1-3…1-8 той же программы.
//
// Список папки — `AutonomousDialogList` (`components/autonomousDialogList/dialogs.ts`,
// задача 1-4 волны 7): его создаёт `l(filter)` на каждую отрисованную папку и
// держит `xds[filterId]`, как tweb (`:1474-1480`); строки — `SortedDialogList`
// поверх Solid-ядра виртуального списка. Активная строка открытого чата —
// `setDialogActive` по смене выбранного чата (`peer_changed`, `:1176-1229`).
// В колонку владелец встроен `components/Sidebar.tsx` (`// ВРЕМЕННО до 2-9`, мост
// этапа 1): `.connection-status-bottom` — хост `start()`, `#chatlist-container` —
// второй аргумент.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//
//  1. Экземпляр со `start(host, chatsContainer, hooks)` и `destroy()`, а не
//     синглтон на `document.getElementById('chatlist-container')` (`:513`):
//     колонка у нас монтируется и размонтируется, тесты поднимают её
//     многократно. `destroy()` — наш (у оригинала синглтон живёт вечно): снимает
//     подписки, наблюдатель, свайп, Solid-корень, навигационную запись, все
//     списки папок (`xds`), свои узлы и свои следы на чужих узлах (`has-filters`,
//     `--chatlist-overlay-height`) — DoD 5 спеки волны 3.
//  2. `bottomPart` не создаётся (`:587-589`, `:704`): это React-узел
//     `.connection-status-bottom` колонки, он приходит как `host`;
//     `#folders-container` (у tweb — статический в `index.html:100`) создаёт
//     владелец и кладёт в `host` последним, оверлей — первым (`:595-597`).
//  3. (снято задачей 1-4: список папки — `AutonomousDialogList`, отдельная
//     карта `filtersRendered` (`:526-528`) — контейнеры отрисованных папок, `xds` —
//     их списки и список архива, пока открыт его оверлей.)
//  4. `localId` — позиция папки в `folderItems` проекции `stores/folders.solid.ts`
//     (0 — «Все чаты»). У tweb пространство `localId` с дыркой под архив
//     (`START_LOCAL_ID`); `positionElementByIndex` это не задевает — кадры
//     ставятся по порядку, а архива среди них нет ни там, ни здесь (`:1251-1253`
//     у нас не нужен: архив — папка диалога, а не фильтр, `core/folderIds.ts`).
//  5. События `filter_update`/`filter_delete`/`filter_order` (`:924-968`) — одна
//     подписка на `folderItems` проекции: у нас это и есть поток «добавили/
//     удалили/переставили» (`appState.folders`, писатель — `foldersStore.ts`).
//     Добавление и перестановка — `addFilter` (у отрисованной папки он и есть
//     `positionElementByIndex`, `:1255-1259`, как в `filter_order` `:966`);
//     `setIndexKey` (`:964`) не нужен — индекс сортировки папки держит воркер.
//  6. Снятие активной папки: сперва контейнер снимается, потом `selectTab(0)`.
//     У tweb наоборот и через стор — `deleteFolder` (`stores/folders.ts:120-134`)
//     зовёт `onClick()(0)` раньше, чем `filter_delete` владельца снимет
//     контейнер; видимый итог тот же (к моменту, когда асинхронный
//     `selectFolderByIndex` доходит до слайдера, уходящего кадра в DOM нет →
//     `prevId === -1` → мгновенно, без `from`/`to`), но полоса оригинала успевает
//     запомнить `prevId` вкладки, которой уже нет, и её «полоска Jolly Cobra»
//     читает `children[prevId]` (`horizontalMenu.ts:108-110`) — у последней
//     вкладки это `undefined` (в 812502980 чтение прикрыто guard'ом из
//     1ca7cb99e, он портирован в `components/horizontalMenu.ts::selectTarget`).
//     Условие `length >= selectedId` (`:131`, длина против id) не портировано —
//     дефект оригинала.
//  7. `state_cleared` (`:640-652`): события на главном потоке нет. Сброс
//     `appState.folders` при логауте (`resetAppState`) приходит той же
//     подпиской (п. 5) и снимает пользовательские контейнеры. Повторный
//     `onStateLoaded` и `xd.clear()` + `onTabChange()` «Всех чатов» (`:643-649`)
//     не нужны: логаут размонтирует колонку, `destroy()` снимает всё, новый
//     вход — новый `start()`.
//  8. Из `onStateLoaded` (`:1014-1090`) взят только папочный срез: `addFilter`
//     на каждую папку, гидрация стора, `filterId = -1; onClick(0, false)`,
//     `suggestionContainer`. Папки у нас известны синхронно (подняты из State в
//     `client/boot.ts`), поэтому ветки `!haveFilters` с плейсхолдером
//     (`:1044-1057`) нет; `preloadDialogs`, сторис, `fillConversations` — волна 7.
//     `suggestionContainer` создаётся в `start()`, `authorizationContainer`
//     (`:1084-1088`, плашка «новый вход») не заводится — у колонки её нет.
//     Гидрация стора (`hydrateFilters`, `:1026-1035`) зовётся ДО ряда: полосе к
//     первому `onClick(0)` нужна вкладка «Все чаты» (у tweb её гарантирует
//     порядок `onStateLoaded`); `destroy()` проекцию гасит (`dispose`).
//  9. Лимит папок не-Premium (`:742-748`, `isFilterIdAvailable` +
//     `showLimitPopup('folders')`) не проверяется — папка всегда доступна,
//     отложенная задача 10 плана (ни лимитов, ни `PopupLimit`).
// 10. `onChange` полосы (`:806-809`, перекраска `custom-emoji-renderer-element`
//     в названии) не передаётся — сущностей в названии папки нет, отложенная
//     задача 11.
// 11. (снято задачей 7: `createFolderContextMenu` (`:814-821`) вешается на ряд,
//     остаток расхождения — п. 20.)
// 12. `setHasFolders(show)` (`:1315-1316`) пишет в стор режима
//     `stores/foldersSidebar.solid.ts` (задача 8), а `destroy()` сбрасывает
//     его в `false`: `hasFolders` — след владельца на `<body>`
//     (`has-horizontal-folders`/`has-vertical-folders`), п. 1.
// 13. `changeFiltersAllChatsKey` (`:1292-1296`, `:1320`) и слушатель `resize`
//     (`:700-702`) не портированы — мёртвый код форка (поправка 2 плана).
// 14. `onTabChange` (`:1092-1168`): плашка «N новых чатов» shared-папки
//     (`:1103-1165`, `getChatlistUpdates`) — отложенная задача 13.
// 15. `setFilterIdAndChangeTab` синхронный (у tweb `async`, `:855-858`): его
//     обещание разрешается `undefined` — `onChatsScroll` ничего не возвращает
//     (`base.ts:144-146`), — и полоса ждала бы пустоту.
// 16. Индекс активной вкладки для свайпа (`:622`, `selectedFolderIndex()`)
//     считается от `filterId` владельца: `selectedFolderId` в Solid-проекции нет
//     (решение 2 шапки `stores/folders.solid.ts`), факт выбора —
//     `foldersStore.selectedId`, и пишет его ТОЛЬКО `selectFolderByIndex` (`:784`).
// 17. Слушатели полосы и слайдера висят на `ListenerSetter` — у tweb его не
//     передают (узлы живут вечно), у нас `destroy()` их снимает.
// 18. `selectFolderByIndex` после своего `await` сверяется с `middleware`
//     прогона (`@helpers/middleware`): у tweb владелец не умирает, у нас
//     `destroy()` может прийти, пока ждём `closeEverythingInsideNaturally` (в
//     том числе прямо на старте — первый `onClick(0, false)` асинхронный), и
//     продолжение полезло бы в снятые списки папок.
// 19. Скроллеру папки и `.chatlist-bottom` владелец ставит ещё и наши классы
//     (`appDialogsManager.module.scss`): тонкий скроллбар (у tweb его включает
//     непортированный класс на `<html>`) и клиренс под compose-FAB (у tweb
//     `.chatlist-bottom` высоты не имеет; пока `ul` папки пуст, клиренс гаснет —
//     иначе браузер вернул бы скроллеру очищенной папки прежнюю позицию, и папка
//     показывалась бы не с начала). `setCollapsed` — наш: свёрнутая в
//     колонку аватаров панель при открытом форуме гасит клиренс; у tweb
//     свёрнутый чатлист устроен иначе (`left-sidebar.md` § 8.2).
// 20. Меню папки (`:814-821`): `appSidebarLeft` и `managers`, которые у tweb
//     владелец берёт у синглтонов, приходят хуками колонки
//     (`hooks.appSidebarLeft`/`hooks.managers`, адаптации — шапка
//     `helpers/dom/createFolderContextMenu.ts`); классов вкладок
//     `AppChatFoldersTab`/`AppEditFolderTab` не передаётся — экраны открывает
//     колонка. Возвращённый `destroy` у tweb выбрасывается (владелец вечен), у
//     нас `destroy()` владельца снимает им слушатели с ряда (п. 1).
// 21. `hide` градиента ряда: у tweb его ставит ref (`:678-681`, затирается
//     class-эффектом `Tabs.MenuGradient`), а снимает/ставит
//     `onFiltersLengthChange` лишь при смене показа (`:1310-1312`) — одна папка
//     на холодном старте оставляет градиент видимым под плашкой-подсказкой.
//     У нас мёртвой строки в ref нет, а `onFiltersLengthChange` синхронизирует
//     `hide` градиента с показом ряда на каждом проходе.
// 22. `peer_changed` (`:1176-1229`) — подписка на выбранный чат навигации
//     (`navigationStore.selectedId`, мост чтения п. 1 плана волны 7), а не событие
//     `appImManager` (этап 4). Тред/тема у строки не сравниваются (`isSamePeer` c
//     `threadId`): строки тем — задача 1-6.
// 23. Меню диалога (`this.contextMenu`, `:850`): менеджеры приходят хуками
//     колонки (`hooks.managers`, расхождение 20), вторым аргументом — сам
//     владелец (расхождение 1 шапки `components/dialogsContextMenu.ts`). Вешает
//     его `setListClickListener({withContext: true})` (`:2337-2339`) на `ul`
//     списка папки из `l(filter)` (`:1478`), как у tweb; `withArchiveContext`
//     (меню строки «Архив») — задача 1-5.
// 24. `openDialogInNewTab` (`:2055-2070`): маршрута `#/im?p=…` у нас нет (разбор
//     хэша — `core/messageLink.ts::parseNavHash`, ссылки — `internalLinkProcessor`,
//     Э5-4), адрес чата — наш хэш `#<peerId>` (`core/navigation/chatHistory.ts::hashForChat`).
//     Параметров `message`/`thread`/`community` нет: строки с `data-mid` и
//     `data-thread-id` (выдача поиска, темы форума) меню получают в 2-3 и 1-6,
//     сообществ нет (О-5).

import { createEffect, createRoot, on, untrack } from 'solid-js'
import Scrollable from '@components/scrollable'
import { horizontalMenu } from '@components/horizontalMenu'
import FoldersTabs from '@components/foldersTabs.solid'
import createFolderContextMenu, {
  type FolderContextMenuManagers,
  type FolderContextMenuSidebar,
} from '@helpers/dom/createFolderContextMenu'
import DialogsContextMenu, { type DialogsContextMenuManagers } from '@components/dialogsContextMenu'
import type { ScrollableContextValue } from '@components/scrollable2.solid'
import type { ToolsMenuSidebar } from '@components/sidebarLeft/toolsMenu'
import { createSolidNodes } from '@shared/solid/mountSolid.solid'
import useFolders from '@stores/folders.solid'
import { useHasFolders } from '@stores/foldersSidebar.solid'
import { useFoldersStore } from '@stores/foldersStore'
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '@core/folderIds'
import appNavigationController, { type NavigationItem } from '@core/navigation/appNavigationController'
import type SwipeHandler from '@core/dom/swipeHandler'
import positionElementByIndex from '@helpers/dom/positionElementByIndex'
import handleTabSwipe from '@helpers/dom/handleTabSwipe'
import { fastSmoothScrollToStart } from '@helpers/fastSmoothScroll'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import clamp from '@helpers/number/clamp'
import pause from '@helpers/schedulers/pause'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { IS_MOBILE_SAFARI } from '@environment/userAgent'
import { attachRowController, createRowSortableIcon, type RowMediaSizeType, type RowTsxController } from '@components/rowTsxController.solid'
import { avatarNew, type AvatarManagers } from '@components/avatar'
import PeerTitle from '@components/chat/peerTitle'
import Icon from '@components/icon'
import wrapPhoto from '@components/wrappers/photo'
import wrapMediaSpoiler from '@components/wrappers/mediaSpoiler'
import renderDialogSubtitleParts from '@components/wrappers/dialogSubtitle'
import { setSendingStatus, type SendingStatusIcon } from '@components/sendingStatus'
import { BADGE_TRANSITION_TIME } from '@components/autonomousDialogList/constants'
import { setTransition } from '@core/dom/setTransition'
import middlewarePromise from '@helpers/middlewarePromise'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import cancelEvent from '@helpers/dom/cancelEvent'
import findUpTag from '@helpers/dom/findUpTag'
import isInDOM from '@helpers/dom/isInDOM'
import replaceContent from '@helpers/dom/replaceContent'
import formatNumber from '@helpers/number/formatNumber'
import { formatDateAccordingToTodayNew } from '@helpers/date'
import { logger, LogTypes } from '@lib/logger'
import rootScope from '@lib/rootScope'
import { i18n } from '@lib/langPack'
import { choosePhotoSize, getMediaFromMessage, isMediaSpoiler, type MyDocument } from '@core/media/messageMedia'
import { getMessageText, type Dialog, type DraftMessageReal, type MyMessage } from '@core/models'
import { realDraft } from '@core/dialogs/draft'
import { EMPTY_NOTIFY_SETTINGS } from '@core/dialogs/notifySettings'
import getDialogMentionBadgeState from '@core/dialogs/dialogMentionBadgeState'
import { cachedChat, cachedPeer } from '@core/peerCache'
import { getOutputPeer, isAnyChat, isUser } from '@core/peers/peerId'
import { isForum } from '@core/peers/predicates'
import { getPeerTitle } from '@core/peers/getPeerTitle'
import { getPeerPhoto, getPeerPhotoId, isUserStatusOnline } from '@core/peers/peer'
import { openPeer, type OpenPeerManagers } from '@core/navigation/openPeer'
import { requestMessageJump } from '@core/messageLink'
import { useChatsStore } from '@stores/chatsStore'
import { isDialogMuted, useNotifyStore } from '@stores/notifyStore'
import { useNavigationStore } from '@stores/navigationStore'
import { useSecretChatStore } from '@stores/secretChatStore'
import { ARCHIVE_DIALOG_TAG_NAME, AutonomousDialogList } from '@components/autonomousDialogList/dialogs'
import { setDialogTyping, type DialogListManagers } from '@components/autonomousDialogList/base'
import styles from './appDialogsManager.module.scss'

const log = logger('DIALOGS', LogTypes.Error)

// ═══ СТРОКА ДИАЛОГА ═════════════════════════════════════════════════════════
//
// Порт tweb `appDialogsManager.ts:133-720` (`DIALOG_LIST_ELEMENT_TAG`,
// `findDialogListElement`, `DialogDom`, `setPromiseMiddleware`,
// `isRenderedSubtitleIntact`, `DialogElement` с бейджами) и методов менеджера,
// которые пишут в строку (`createChatList` `:2348`, `setListClickListener`
// `:2072-2346`, `setLastMessage` `:2382-2677`, `setUnreadMessages` `:2678-2823`,
// `getDialog` `:2825`, `initDialog` `:2931`, `addDialogNew` `:3007`,
// `setDialogActiveStatus` `:1281`), вместе с 0af53a342 (сигнатура подзаголовка
// и `setBadgeState` без перехода при неизменном состоянии). Строка — Solid `Row`
// за императивным фасадом (`attachRowController`, `components/rowTsxController.solid.tsx`).
// Её строят и главный список чатов (`SortedDialogList` → `addListDialog`, задача
// 1-4 волны 7), и строки вне списка: поиск, участники, выбор пиров, контакты, папки.
//
// РАСХОЖДЕНИЯ СТРОКИ С ОРИГИНАЛОМ
//
//  С1. Методы менеджера — функции модуля. У tweb `appDialogsManager` синглтон, а
//      строку строят и вне колонки; наш менеджер — экземпляр колонки
//      (расхождение 1 выше). Что оригинал берёт у себя (`this.filterId`,
//      `this.xd === this.xds[FOLDER_ID_ARCHIVE]`, `this.isChatListNarrow()`),
//      приходит опцией `list` (`DialogListContext`) — её подставляют методы
//      экземпляра менеджера (`setLastMessageN`, `initDialog`, задача 1-4), которыми
//      зовёт список папки; без неё строка считается строкой «Всех чатов» в широкой
//      колонке. `dialogElement` в `setLastMessage` обязателен: строку по пиру
//      находит сам список (`xd.getDialogElement`), а не функция модуля.
//  С2. В7-3 — превью из зеркала диалогов, а не из `historyStorage`:
//      `getLastMessageForDialog` берёт `dialog.lastMessage` (разрешённый
//      воркером `top_message`, `core/models.ts::Dialog`) вместо
//      `apiManagerProxy.getMessageByPeer`; `getDialog` читает `chatsStore`
//      синхронно (мост чтения п. 2 плана волны 7). Временного (отправляемого)
//      сообщения в превью строки нет: значки `sending`/`sendingerror_filled`
//      не ставятся, а «✓/✓✓» считаются по `read_outbox_max_id` диалога
//      (`components/sendingStatus.ts`, расхождение 1).
//  С3. Чего нет в модели, того нет и в строке (ветки удалены, а не заглушены):
//      сохранённые диалоги строкой (`isSavedDialog`, `threadId` = saved peer —
//      задача 1-7), темы форума строкой (`isForumTopic`, `closed`, `not-visited`
//      — задача 1-6), монофорум и «все чаты» (`monoforumParentPeerId`,
//      `asAllChats`, О-4), сообщества (`subtitlePeerId`, `getEmptySubtitle`, О-5),
//      ограничения/чувствительное/самоуничтожающееся медиа (`isMessageRestricted`,
//      `isMessageSensitive`, `ttl_seconds` — признаков нет в `core/models.ts`).
//      Отложено с предметом: закреп внутри пользовательской папки
//      (`filter.pinnedPeerIds`) — `// О-70 волна 7`; непрочитанное форума по
//      темам (`getForumUnreadCount`, `no-unmuted-topic`) — `// О-71 волна 7`;
//      «отметить непрочитанным» (`pFlags.unread_mark`) — `// О-72 волна 7`;
//      бейдж голосов опроса (`unread_poll_votes_count`, `createPollVotesBadge`)
//      — `// О-73 волна 7`; перекраска частиц спойлера активной строки
//      (b2df09771, `DotRenderer.setInlineSpoilersTextColor`) — `// О-74 волна 7`.
//  С4. Опции `DialogElement`, у которых здесь нет предмета: `loadPromises`
//      (`PeerTitle` у нас синхронный, `readyThumbPromise` аватара никто не
//      ждёт), `fromName`/`onlyFirstName`/`noIcons` (строке у нас значки нужны
//      всегда — `withIcons: true`; объём значков — шапка `generateTitleIcons.ts`),
//      `withStories` (историй у `avatarNew` нет, шапка `components/avatar.ts`),
//      `controlled`, `autoDeletePeriod`, `avatarElement`, `wrapOptions.lazyLoadQueue`
//      (очередь аватару не передаётся). Подсветка активного диалога при сборке
//      (`isActive` → `setDialogActive`, `:383-390`, `:488-490`) — у менеджера
//      (`addListDialog`, задача 1-4): строку строит его экземпляр, конструктор
//      синглтона не видит; `is-forum-open` и `dialogDom` на узле — их читают
//      форум-таб (1-6) и `setDialogActive` для `callIcon`/`titleWrapOptions` (О-96, С5).
//      `titleWrapOptions`/`textColor` — рендерера кастом-эмодзи у нас нет.
//  С5. `setDialogActiveStatus` — только класс `active`: кастом-эмодзи
//      (`setTextColor`), эмодзи-статус (`changeTitleEmojiColor`) в строке у нас
//      не рисуются, а частицы спойлера — О-74 (наш маскированный спойлер
//      красится CSS-цветом самого узла, канваса 4184843ff ещё нет).
//  С6. Подсветка запроса — `wrapMessageForReply({highlightWord})`, а не
//      `highlightText` поверх частей (f57dbcec3 не портирован, `delta/part-3.md`);
//      `disposeTextHighlight` и `data-search-query` вместе с ним.
//  С7. `data-thread-id` у строки найденного ответа в теме форума и
//      `getEmptySubtitle` — читать их некому (клик по теме форума — 1-6).
//  С8. `initDialog` разделён: подзаголовок с бейджами — функция модуля (её зовут и
//      строки вне списка), онлайн-точка (`xd.setOnlineStatus`) и «печатает»
//      (`setDialogTyping`) — метод экземпляра менеджера (у них предмет — список
//      папки). Звонок в группе (`xd.processDialogForCallStatus`) — `// О-96 волна 7`:
//      `call_active` у чата в модели нет. `addListDialog` — без ленивой догрузки
//      истории по видимости (`lazyLoadQueue`, `:2889-2926`): очереди нет.
//  С9. Порядок частей строки задаёт HEAD `rowTsx.tsx:247-257` (заголовок →
//      подпись → аватар), живые дампы `docs/tweb/dom/dumps/15-right-14…` сняты со
//      старой базы (подпись → заголовок); вид не меняется — места раскладывает
//      `_row.scss`.

/** tweb `:133` — строка чатлиста это `<a>`; по тегу её находит клик (`findUpTag`). */
export const DIALOG_LIST_ELEMENT_TAG = 'A'

/** tweb `:138-140` */
export function findDialogListElement(target: EventTarget) {
  return findUpTag(target, DIALOG_LIST_ELEMENT_TAG)
}

/** tweb `dialogsPinnedReorder.ts:28` — закреплённые строки списка; сам перенос
 *  перетаскиванием (`attachPinnedDialogsReorder`) приходит со списком (1-4). */
const PINNED_DIALOG_CLASS_NAME = 'is-pinned'

/** tweb `:142-183` без `callIcon`, `pollVotesBadge`, `titleWrapOptions`, `textHighlight` (С3, С4, С6). */
export type DialogDom = {
  avatarEl?: ReturnType<typeof avatarNew>,
  captionDiv: HTMLElement,
  titleSpan: HTMLElement,
  titleSpanContainer: HTMLElement,
  statusSpan: HTMLSpanElement,
  lastTimeSpan: HTMLSpanElement,
  pinnedBadge?: HTMLElement,
  /** the grip a pinned row is dragged by while its list can be reordered */
  sortableIcon?: HTMLElement,
  unreadBadge?: HTMLElement,
  unreadAvatarBadge?: HTMLElement,
  mentionsBadge?: HTMLElement,
  reactionsBadge?: HTMLElement,
  lastMessageSpan: HTMLElement,
  containerEl: HTMLElement,
  listEl: HTMLElement,
  subtitleEl: HTMLElement,
  mutedIcon?: HTMLElement,
  /**
   * Сигнатура последнего отрисованного подзаголовка (0af53a342): любое событие
   * диалога гонит `setLastMessage` целиком, и без неё подзаголовок
   * пересобирался бы — миниатюры и всё — на правках, которые не могли
   * поменять в нём ни символа.
   */
  lastMessageRenderKey?: string,
  /** Узлы, которыми эта сигнатура отрисована: в `lastMessageSpan` пишут и
   *  другие (группы поиска, выбор пиров), и совпавший ключ ещё не значит, что
   *  в DOM всё ещё он. */
  lastMessageRenderParts?: HTMLElement[],
  setLastMessagePromise?: CancellablePromise<void>,
  setUnreadMessagePromise?: CancellablePromise<void>,
}

/** tweb `(d.container as any).dialogElement = d` (`:3012`) — по нему группа поиска снимает строку. */
export type DialogListElement = HTMLElement & { dialogElement?: DialogElement }

/** tweb `:193-207` — новый прогон отменяет прежний на том же `dom`. */
function setPromiseMiddleware(obj: DialogDom, key: 'setLastMessagePromise' | 'setUnreadMessagePromise') {
  const oldPromise = obj[key]
  oldPromise?.reject!()

  const deferred = obj[key] = deferredPromise<void>()
  deferred.catch(() => {}).finally(() => {
    if(obj[key] === deferred) {
      delete obj[key]
    }
  })

  const middleware = middlewarePromise(() => obj[key] === deferred)
  return { deferred, middleware }
}

/**
 * tweb `:220-226` — в DOM всё ещё ровно то, что положил `setLastMessage`:
 * любой другой писатель `lastMessageSpan` обязан отменить пропуск.
 */
function isRenderedSubtitleIntact(dom: DialogDom) {
  const parts = dom.lastMessageRenderParts
  const { childNodes } = dom.lastMessageSpan
  return !!parts &&
    parts.length === childNodes.length &&
    parts.every((part, idx) => part === childNodes[idx])
}

/** tweb `:232` */
const BADGE_SIZE = 22

export type DialogElementSize = RowMediaSizeType

/** tweb `:235-239` — размер аватарки по размеру строки. */
const avatarSizeMap: { [k in DialogElementSize]?: number } = {
  bigger: 54,
  abitbigger: 42,
  small: 32,
}

export type DialogRowManagers = AvatarManagers

/** tweb `:244-264` в портированном объёме (С4). */
export type DialogElementOptions = {
  peerId: PeerId,
  rippleEnabled?: boolean,
  /** свой пир — «Избранное»: аватар `saved` и имя «Избранное» (tweb `:301`) */
  meAsSaved?: boolean,
  avatarSize?: DialogElementSize,
  /** строка НЕ в главном списке чатов: без `href` (tweb `:428-430`) */
  autonomous?: boolean,
  wrapOptions: { middleware?: Middleware },
  /** строка главного списка — ей положен бейдж на аватаре в узкой колонке (`:2770`) */
  isMainList?: boolean,
  /** менеджеры строки (у оригинала — синглтон, С1) */
  managers: DialogRowManagers,
}

/** tweb `:266-279` без `pollVotes` (О-73). */
export type DialogElementBadgeState = {
  muted: boolean,
  pinned: boolean,
  unread: boolean,
  unreadText?: string,
  unreadMention?: boolean,
  unreadAvatar: boolean,
  unreadAvatarText?: string,
  mentions: boolean,
  reactions: boolean,
  transitionDuration?: number,
}

type DialogBadgeKey = Extract<keyof DialogDom, 'unreadBadge' | 'unreadAvatarBadge' | 'mentionsBadge' | 'reactionsBadge' | 'pinnedBadge'>

/** tweb `:280-286` */
type DialogElementAppliedBadgeState = {
  [key in DialogBadgeKey]: boolean
} & {
  hasOnlyPinnedBadge: boolean,
  unreadText?: string,
  unreadAvatarText?: string,
}

// tweb `:288` — части строки приходят объявлением: их ставит на прототип
// `attachRowController`, своих полей у класса под них нет (иначе поле экземпляра
// заслонило бы геттер прототипа)
// eslint-disable-next-line typescript/no-unsafe-declaration-merging -- форма tweb `:288-290`
export interface DialogElement extends RowTsxController {}

// eslint-disable-next-line typescript/no-unsafe-declaration-merging -- форма tweb `:288-290`
export class DialogElement {
  public dom: DialogDom
  public isMainList: boolean | undefined
  public middlewareHelper: MiddlewareHelper
  /** менеджеры строки: ими же подзаголовок строит имя автора (С1) */
  public readonly managers: DialogRowManagers
  private lastBadgeState: DialogElementAppliedBadgeState | undefined

  constructor({
    peerId,
    rippleEnabled = true,
    meAsSaved = true,
    avatarSize = 'bigger',
    autonomous,
    wrapOptions,
    isMainList,
    managers,
  }: DialogElementOptions) {
    // tweb `:318-319` — дочерний scope от переданного middleware; без него
    // (`controlled`, С4) — свой корень, чтобы `destroy()` было что гасить у
    // аватара, имени и Solid-корня строки.
    this.middlewareHelper = wrapOptions.middleware ? wrapOptions.middleware.create() : getMiddleware()
    const middleware = this.middlewareHelper.get()

    // tweb `:321-332`; `havePadding` безусловный — тем форума и `asAllChats` нет (С3)
    attachRowController(this, {
      clickable: true,
      noRipple: !rippleEnabled,
      havePadding: true,
      title: true,
      titleRightSecondary: true,
      subtitle: true,
      subtitleRight: true,
      noWrap: true,
      asLink: true,
      middleware,
    })

    this.isMainList = isMainList
    // tweb `:335` — правый слот подписи создаётся `Row` и тут же снимается.
    this.subtitleRight.remove()
    this.managers = managers

    // tweb `:350-374`
    const avatar = avatarNew({
      middleware,
      size: avatarSizeMap[avatarSize]!,
      peerId,
      isDialog: !!meAsSaved,
      managers,
    })
    const avatarEl = avatar.node
    avatarEl.classList.add('dialog-avatar')
    this.applyMediaElement(avatarEl, avatarSize)

    const captionDiv = this.container

    // tweb `:378-381`
    const titleSpanContainer = this.title
    titleSpanContainer.classList.add('user-title')

    this.titleRow.classList.add('dialog-title')

    // tweb `:397-411` — имя пира узлом `.peer-title`
    const peerTitle = new PeerTitle({ peerId, dialog: meAsSaved, withIcons: true, middleware, managers })
    titleSpanContainer.append(peerTitle.element)

    const span = this.subtitle

    // tweb `:426-441`
    const li = this.container
    li.classList.add('chatlist-chat', 'chatlist-chat-' + avatarSize)
    if(!autonomous) {
      (li as HTMLAnchorElement).href = '#' + peerId
    }

    if(avatarSize === 'bigger') {
      this.container.classList.add('row-big')
    } else if(avatarSize === 'small') {
      this.container.classList.add('row-small')
    }

    li.dataset.peerId = '' + peerId

    // tweb `:448-458`
    const statusSpan = document.createElement('span')
    statusSpan.classList.add('message-status', 'sending-status')

    const lastTimeSpan = document.createElement('span')
    lastTimeSpan.classList.add('message-time')

    const rightSpan = this.titleRight
    rightSpan.classList.add('dialog-title-details')
    rightSpan.append(statusSpan, lastTimeSpan)

    this.subtitleRow.classList.add('dialog-subtitle', 'has-multiple-badges')

    // tweb `:465-477`
    this.dom = {
      avatarEl: avatar,
      captionDiv,
      titleSpan: peerTitle.element,
      titleSpanContainer,
      statusSpan,
      lastTimeSpan,
      lastMessageSpan: span,
      containerEl: li,
      listEl: li,
      subtitleEl: this.subtitleRow,
    }
  }

  /**
   * tweb `:493-497`. Зона строки у нас есть всегда, и корень снимет и её
   * `onDestroy` (`rowTsxController.solid.tsx`); `dispose()` идемпотентен и
   * оставлен дословно. `disposeTextHighlight` — С6.
   */
  public destroy() {
    this.dispose()
    this.middlewareHelper.destroy()
  }

  /** tweb `:503-506` */
  public remove() {
    this.destroy()
    this.dom.listEl.remove()
  }

  /** tweb `:508-531` */
  public setMuted(isMuted: boolean, transitionDuration = 0) {
    const { dom } = this
    const wasMuted = dom.listEl.classList.contains('is-muted') &&
      !dom.listEl.classList.contains('backwards')
    if(isMuted === wasMuted) {
      return
    }

    if(isMuted && !dom.mutedIcon) {
      dom.mutedIcon = Icon('nosound_filled', 'dialog-muted-icon')
      dom.titleSpanContainer.append(dom.mutedIcon)
    }

    setTransition({
      element: dom.listEl,
      className: 'is-muted',
      forwards: isMuted,
      duration: transitionDuration,
      onTransitionEnd: !isMuted ? (() => {
        dom.mutedIcon?.remove()
        delete dom.mutedIcon
      }) : undefined,
    })
  }

  /** tweb `:533-539` */
  public createPinnedBadge() {
    if(this.dom.pinnedBadge) return
    const badge = this.dom.pinnedBadge = document.createElement('div')
    badge.className = `dialog-subtitle-badge badge badge-icon badge-${BADGE_SIZE} dialog-subtitle-badge-pinned`
    badge.append(Icon('chatspinned'))
    this.dom.subtitleEl.append(badge)
  }

  /** tweb `:541-546` — ручка перетаскивания, видна только пока список переставляется */
  public createSortableIcon() {
    if(this.dom.sortableIcon) return
    const icon = this.dom.sortableIcon = createRowSortableIcon()
    this.dom.listEl.append(icon)
  }

  /** tweb `:548-553` */
  public createUnreadBadge() {
    if(this.dom.unreadBadge) return
    const badge = this.dom.unreadBadge = document.createElement('div')
    badge.className = `dialog-subtitle-badge badge badge-${BADGE_SIZE} dialog-subtitle-badge-unread`
    this.dom.subtitleEl.append(badge)
  }

  /** tweb `:555-560` */
  public createUnreadAvatarBadge() {
    if(this.dom.unreadAvatarBadge) return
    const badge = this.dom.unreadAvatarBadge = document.createElement('div')
    badge.className = `dialog-subtitle-badge badge badge-${BADGE_SIZE} avatar-badge`
    this.dom.listEl.append(badge)
  }

  /** tweb `:562-568` */
  public createMentionsBadge() {
    if(this.dom.mentionsBadge) return
    const badge = this.dom.mentionsBadge = document.createElement('div')
    badge.className = `dialog-subtitle-badge badge badge-${BADGE_SIZE} mention mention-badge dialog-subtitle-badge-mention`
    badge.innerText = '@'
    this.dom.subtitleEl.append(badge)
  }

  /** tweb `:570-576` */
  public createReactionsBadge() {
    if(this.dom.reactionsBadge) return
    const badge = this.dom.reactionsBadge = document.createElement('div')
    badge.className = `dialog-subtitle-badge badge badge-${BADGE_SIZE} reaction-badge dialog-subtitle-badge-reaction`
    badge.append(Icon('reactions_filled'))
    this.dom.subtitleEl.append(badge)
  }

  /** tweb `:586-690` (с 0af53a342), без бейджа голосов опроса (О-73) */
  public setBadgeState(options: DialogElementBadgeState) {
    const transitionDuration = options.transitionDuration || 0
    this.setMuted(options.muted, transitionDuration)

    const previous = this.lastBadgeState

    const mounted: { [key in DialogBadgeKey]: boolean } = {
      pinnedBadge: !!this.dom.pinnedBadge,
      unreadBadge: !!this.dom.unreadBadge,
      unreadAvatarBadge: !!this.dom.unreadAvatarBadge,
      mentionsBadge: !!this.dom.mentionsBadge,
      reactionsBadge: !!this.dom.reactionsBadge,
    }
    // * the pinned rows of a list form the block that can be reordered within itself
    this.dom.listEl.classList.toggle(PINNED_DIALOG_CLASS_NAME, !!options.pinned)

    if(options.pinned) {
      this.createPinnedBadge()
      this.createSortableIcon()
    }

    if(options.unread) this.createUnreadBadge()
    if(options.unreadAvatar) this.createUnreadAvatarBadge()
    if(options.mentions) this.createMentionsBadge()
    if(options.reactions) this.createReactionsBadge()

    const subtitleBadgesLength = [
      options.pinned,
      options.unread,
      options.mentions,
      options.reactions,
    ].filter(Boolean).length
    const hasOnlyPinnedBadge = options.pinned && subtitleBadgesLength === 1
    // * `setTransition` keeps `animating` on the element for the whole duration,
    // * and `.has-only-pinned-badge:not(.animating)` drops the subtitle's trailing
    // * margin while it is there. Replaying it for an unchanged state makes the
    // * subtitle of every pinned row widen and snap back — a visible blink.
    if(!previous || previous.hasOnlyPinnedBadge !== hasOnlyPinnedBadge) {
      setTransition({
        element: this.subtitleRow,
        className: 'has-only-pinned-badge',
        forwards: hasOnlyPinnedBadge,
        duration: transitionDuration,
      })
    }

    const states: Array<[DialogBadgeKey, boolean]> = [
      ['pinnedBadge', options.pinned],
      ['unreadBadge', options.unread],
      ['unreadAvatarBadge', options.unreadAvatar],
      ['mentionsBadge', options.mentions],
      ['reactionsBadge', options.reactions],
    ]
    for(const [key, visible] of states) {
      if(!this.dom[key]) {
        continue
      }

      // an already mounted badge that keeps its visibility needs no transition
      if(mounted[key] && previous?.[key] === visible) {
        continue
      }

      this.toggleBadgeByKey(key, visible, mounted[key], !transitionDuration)
    }

    if(options.unread && this.dom.unreadBadge) {
      if(options.unreadText !== undefined && options.unreadText !== previous?.unreadText) {
        this.dom.unreadBadge.innerText = options.unreadText
        if(this.dom.unreadAvatarBadge) {
          this.dom.unreadAvatarBadge.innerText = options.unreadText
        }
      }
      this.dom.unreadBadge.classList.add('unread')
      this.dom.unreadBadge.classList.toggle('mention', !!options.unreadMention)
    }

    if(options.unreadAvatar && this.dom.unreadAvatarBadge) {
      if(options.unreadAvatarText !== undefined && options.unreadAvatarText !== previous?.unreadAvatarText) {
        this.dom.unreadAvatarBadge.innerText = options.unreadAvatarText
      }
      this.dom.unreadAvatarBadge.classList.add('unread')
      this.dom.unreadAvatarBadge.classList.toggle('mention', !!options.unreadMention)
    }

    this.lastBadgeState = {
      pinnedBadge: options.pinned,
      unreadBadge: options.unread,
      unreadAvatarBadge: options.unreadAvatar,
      mentionsBadge: options.mentions,
      reactionsBadge: options.reactions,
      hasOnlyPinnedBadge,
      unreadText: options.unreadText,
      unreadAvatarText: options.unreadAvatarText,
    }
  }

  /** tweb `:692-718` */
  public toggleBadgeByKey(
    key: DialogBadgeKey,
    hasBadge: boolean,
    justCreated: boolean,
    batch?: boolean,
  ) {
    // * `setBadgeState` skips a badge whose visibility `lastBadgeState` says is unchanged, so
    // * out-of-band toggles must keep it in sync
    if(this.lastBadgeState) {
      this.lastBadgeState[key] = hasBadge
    }

    const element = this.dom[key]!
    setTransition({
      element,
      className: 'is-visible',
      forwards: hasBadge,
      duration: batch ? 0 : BADGE_TRANSITION_TIME,
      onTransitionEnd: hasBadge ? undefined : () => {
        this.dom[key]!.remove()
        delete this.dom[key]
      },
      useRafs: !justCreated || !isInDOM(element) ? 2 : 0,
    })
  }
}

/** Колбэки колонки: то, что у tweb владелец берёт у соседей-синглтонов. */
export type AppDialogsManagerHooks = {
  /**
   * `appSidebarLeft.closeEverythingInsideNaturally()` (`:756-758`,
   * `sidebarLeft/index.ts:505-516`): закрыть поиск, вкладки «через назад»,
   * форум. `false` — пользователь отказался, переключение отменяется. У нас это
   * состояние колонки (`Sidebar.tsx`).
   */
  closeEverythingInsideNaturally: () => boolean | Promise<boolean>
  /** `!!this.forumTab` — открытый форум гасит свайп между папками (`:631-633`). */
  isForumOpen: () => boolean
  /** `appSidebarLeft` меню папки (`:815`) — расхождение 20; `isCollapsed`/`openArchiveTab` — списку (`:1128`, `:2139`) */
  appSidebarLeft: FolderContextMenuSidebar & Pick<ToolsMenuSidebar, 'isCollapsed' | 'openArchiveTab'>
  /** `this.managers` меню папки (`:818`) и меню диалога (`:850`) — расхождения 20, 23; им же списки берут страницы и строки */
  managers: FolderContextMenuManagers & DialogsContextMenuManagers & DialogListManagers & OpenPeerManagers
  /**
   * `toggleForumTabByPeerId` (`:1941`) — клик по строке форума открывает панель
   * тем. Панель у нас — React-`TopicsPanel` колонки (`// ВРЕМЕННО до 1-6`).
   */
  openForum: (peerId: PeerId) => void
}

type FilterLike = { id: number, localId: number }

/** tweb `FilterRendered` (`:500-511`) в портированном объёме: контейнер папки и его скроллер. */
type FilterRendered = { id: number, container: HTMLElement, scrollable: Scrollable }

export class AppDialogsManager {
  public filterId: number = ALL_FOLDER_ID
  public xd: AutonomousDialogList | undefined
  public xds = new Map<number, AutonomousDialogList>()
  public contextMenu: DialogsContextMenu | undefined

  private folders!: { [k in 'menu' | 'container' | 'menuScrollContainer' | 'menuGradient']: HTMLElement }
  private filtersRendered = new Map<number, FilterRendered>()
  /** tweb `:801` — строки, подсвеченные активными (`setDialogActive`) */
  private lastActiveElements = new Set<HTMLElement>()
  private showFiltersPromise: Promise<void> | undefined
  private filtersNavigationItem: NavigationItem | undefined

  private host: HTMLElement | undefined
  public chatsContainer!: HTMLElement
  private hooks!: AppDialogsManagerHooks
  private foldersOverlay!: HTMLElement
  private _suggestionContainer: HTMLElement | undefined

  private listenerSetter = new ListenerSetter()
  private middlewareHelper = getMiddleware()
  private resizeObserver: ResizeObserver | undefined
  private swipeHandler: SwipeHandler | undefined
  private disposeTabs: (() => void) | undefined
  private disposeListeners: (() => void) | undefined
  private disposePeerChanged: (() => void) | undefined
  private destroyContextMenu: (() => void) | undefined

  /** расхождение 19; переживает `destroy()` — колонка задаёт его своим состоянием */
  private collapsed = false

  /** узел для плашки-подсказки (`:1079-1082`) — в него рисует React-`PendingSuggestion` */
  public get suggestionContainer() {
    return this._suggestionContainer
  }

  /** Менеджеры колонки — их берут списки папок (у tweb — `rootScope.managers`). */
  public get managers() {
    return this.hooks.managers
  }

  public start(host: HTMLElement, chatsContainer: HTMLElement, hooks: AppDialogsManagerHooks) {
    this.host = host
    this.chatsContainer = chatsContainer
    this.hooks = hooks

    this.contextMenu = new DialogsContextMenu(hooks.managers, this) // `:850`, расхождение 23

    const folders = useFolders()
    // `hydrateFilters` (`:1026-1035`) — до ряда, расхождение 8.
    folders.hydrate()

    const container = document.createElement('div')
    container.id = 'folders-container'
    container.classList.add('tabs-container')
    // Узлы ряда (`menu`, `menuScrollContainer`, `menuGradient`) приходят ref-ами
    // при создании `FoldersTabs` ниже — синхронно, до первого чтения (у tweb
    // поле так же заведено пустым, `:518-525`).
    this.folders = {
      menu: undefined!,
      menuScrollContainer: undefined!,
      menuGradient: undefined!,
      container,
    }

    host.append(container)

    // Single absolute overlay sitting above the chatlist (#folders-container) that hosts every
    // panel currently rendered there: pending suggestion, folder tabs scrollable, gradient.
    this.foldersOverlay = document.createElement('div')
    this.foldersOverlay.classList.add('chatlist-overlay')
    host.prepend(this.foldersOverlay)

    // Живая высота оверлея — отступ сверху у `.folders-scrollable`
    // (`padding-top: var(--chatlist-overlay-height, 0)`, `styles/tweb/_leftSidebar.scss:418`).
    this.resizeObserver = new ResizeObserver((entries) => {
      const height = entries[0].borderBoxSize?.[0]?.blockSize ?? entries[0].contentRect.height
      host.style.setProperty('--chatlist-overlay-height', height + 'px')
    })
    this.resizeObserver.observe(this.foldersOverlay)

    if(IS_TOUCH_SUPPORTED) {
      this.swipeHandler = handleTabSwipe({
        element: container,
        onSwipe: (xDiff) => {
          const prevIndex = folders.folderItems.findIndex((item) => item.id === this.filterId) // расхождение 16
          const newIndex = clamp(
            xDiff < 0 ? prevIndex + 1 : prevIndex - 1,
            0,
            folders.folderItems.length - 1,
          )
          folders.onClick()?.(newIndex)
        },
        verifyTouchTarget: () => {
          return !this.hooks.isForumOpen()
        },
      })
    }

    // `:654-686`: ряд — узлами прямо в оверлей, без хоста (`createSolidNodes`).
    let scrollableContext: ScrollableContextValue | undefined
    const tabs = createSolidNodes(FoldersTabs, {
      scrollableProps: {
        class: 'folders-tabs-scrollable hide',
        ref: (ref: HTMLDivElement) => {
          this.folders.menuScrollContainer = ref
        },
        scrollableProps: {
          contextRef: (ref: ScrollableContextValue) => scrollableContext = ref,
        },
      },
      menuProps: {
        id: 'folders-tabs',
        ref: (ref: HTMLDivElement) => {
          this.folders.menu = ref
          this.onRef(scrollableContext)
        },
      },
      gradientProps: {
        className: 'folders-tabs-gradient',
        color: 'surface',
        smaller: true,
        // У tweb здесь же `ref.classList.add('hide')` (`:678-681`) — мёртвая
        // строка: class-эффект `Tabs.MenuGradient` сразу после ref пишет
        // `className` целиком (пин задачи 4 в `foldersTabs.solid.test.tsx`).
        // `hide` градиента ставит `onFiltersLengthChange` — расхождение 21.
        ref: (ref: HTMLDivElement) => {
          this.folders.menuGradient = ref
        },
      },
    })
    this.disposeTabs = tabs.dispose
    this.foldersOverlay.append(...tabs.nodes)

    this.xd = this.xds.get(this.filterId)

    // срез `onStateLoaded` (`:1014-1090`), расхождение 8
    this.addFilters()

    this.filterId = -1
    untrack(folders.onClick)?.(0, false)

    this.initListeners()

    // `peer_changed` (`:1176-1229`) — расхождение 22
    this.disposePeerChanged = useNavigationStore.subscribe((state, prev) => {
      if(state.selectedId !== prev.selectedId) this.onPeerChanged(this.getActivePeerId())
    })

    this._suggestionContainer = document.createElement('div')
    this.foldersOverlay.prepend(this._suggestionContainer)
  }

  public destroy() {
    if(!this.host) {
      return
    }

    const folders = useFolders()
    this.middlewareHelper.clean()
    this.showFiltersPromise = undefined
    this.disposeListeners?.()
    this.disposeListeners = undefined
    this.disposePeerChanged?.()
    this.disposePeerChanged = undefined
    folders.setOnClick(undefined)
    this.destroyContextMenu?.()
    this.destroyContextMenu = undefined
    this.disposeTabs?.()
    this.disposeTabs = undefined
    this.listenerSetter.removeAll()
    this.swipeHandler?.removeListeners()
    this.swipeHandler = undefined
    this.resizeObserver?.disconnect()
    this.resizeObserver = undefined

    if(this.filtersNavigationItem) {
      appNavigationController.removeItem(this.filtersNavigationItem)
      this.filtersNavigationItem = undefined
    }

    this.xds.forEach((xd) => xd.destroy())
    this.xds.clear()
    this.filtersRendered.clear()
    this.lastActiveElements.clear()
    this.xd = undefined
    this.contextMenu = undefined

    this.foldersOverlay.remove()
    this.folders.container.remove()
    this.host.style.removeProperty('--chatlist-overlay-height')
    this.chatsContainer.classList.remove('has-filters')
    useHasFolders()[1](false) // расхождение 12
    this._suggestionContainer = undefined
    this.host = undefined

    folders.dispose()
  }

  private onRef(scrollableContext: ScrollableContextValue | undefined) {
    this.setFilterId(ALL_FOLDER_ID)
    this.addFilter({ id: ALL_FOLDER_ID, localId: 0 })

    const { onClick, setOnClick, folderItems } = useFolders()
    const selectFolderByIndex = async(index: number) => {
      const id = folderItems[index]?.filter.id ?? ALL_FOLDER_ID
      const wasFilterId = this.filterId
      const middleware = this.middlewareHelper.get()

      // Лимит папок не-Premium (`:742-748`) — расхождение 9, задача 10.

      if(!await this.hooks.closeEverythingInsideNaturally() || !middleware()) { // `middleware` — расхождение 18
        return false
      }

      if(!IS_MOBILE_SAFARI) {
        if(index) {
          if(!this.filtersNavigationItem) {
            this.filtersNavigationItem = {
              type: 'filters',
              onPop: () => {
                onClick()?.(0)
                this.filtersNavigationItem = undefined
              },
            }

            appNavigationController.spliceItems(1, 0, this.filtersNavigationItem)
          }
        } else if(this.filtersNavigationItem) {
          appNavigationController.removeItem(this.filtersNavigationItem)
          this.filtersNavigationItem = undefined
        }
      }

      if(wasFilterId === id) {
        void fastSmoothScrollToStart(this.xds.get(id)!.scrollable.container, 'y')
        return
      }

      useFoldersStore.getState().select(id)

      this.xds.get(id)!.clear()
      this.setFilterIdAndChangeTab(id)
    }

    this.foldersOverlay.append(this.folders.menuScrollContainer)
    const selectTab = horizontalMenu({
      tabs: this.folders.menu,
      content: this.folders.container,
      onClick: selectFolderByIndex,
      onTransitionEnd: () => {
        this.xds.forEach((xd, folderId) => {
          if(folderId !== this.filterId) {
            xd.clear()
          }
        })
      },
      scrollableX: scrollableContext,
      listenerSetter: this.listenerSetter,
      // `onChange` (`:806-809`) — расхождение 10, задача 11.
    })

    setOnClick(() => selectTab)

    // `destroy` — расхождение 20
    this.destroyContextMenu = createFolderContextMenu({
      appSidebarLeft: this.hooks.appSidebarLeft,
      managers: this.hooks.managers,
      className: 'menu-horizontal-div-item',
      listenTo: this.folders.menu,
    }).destroy
  }

  /** Расхождение 19: свёрнутая колонка (открыт форум) — без клиренса под FAB. */
  public setCollapsed(collapsed: boolean) {
    this.collapsed = collapsed
    this.filtersRendered.forEach(({ container }) => container.classList.toggle(styles.collapsed, collapsed))
  }

  public setFilterId(filterId: number) {
    this.filterId = filterId
  }

  public setFilterIdAndChangeTab(filterId: number) {
    this.setFilterId(filterId)
    this.onTabChange()
  }

  /** `:1092-1101`; плашка chatlist-апдейтов `:1103-1165` — расхождение 14. */
  public onTabChange = () => {
    const { filterId } = this
    const xd = this.xd = this.xds.get(filterId)!
    // `xd.reset()` (`:1400`) забывает промисы `onStateLoaded` — их у нас нет
    // (расхождение 5 шапки `autonomousDialogList/base.ts`)
    xd.onChatsScroll()
  }

  /** `addFilters` из `onStateLoaded` (`:1022-1028`): по кадру на каждую папку. */
  private addFilters() {
    untrack(() => useFolders().folderItems).forEach((item, localId) => {
      this.addFilter({ id: item.id, localId })
    })
  }

  /**
   * `filter_update`/`filter_delete`/`filter_order` (`:924-968`) одной подпиской
   * на `folderItems` — расхождение 5. Реагирует на состав и порядок (`id` по
   * позициям), а не на счётчики: `reconcile` проекции держит элементы, и смена
   * бейджа сюда не доходит.
   */
  private initListeners() {
    const { folderItems, onClick } = useFolders()
    this.disposeListeners = createRoot((dispose) => {
      createEffect(on(() => folderItems.map((item) => item.id), (ids) => {
        let deletedActive = false
        const present = new Set(ids)
        Array.from(this.filtersRendered.keys()).forEach((id) => {
          if(present.has(id)) return
          if(id === this.filterId) deletedActive = true
          this.deleteFilter(id)
        })

        this.addFilters()

        // Расхождение 6: контейнер уже снят, теперь — на «Все чаты».
        if(deletedActive) {
          untrack(onClick)?.(0)
        }
      }, { defer: true }))

      return dispose
    })
  }

  /** `filter_delete` (`:1235-1247`). */
  private deleteFilter(id: number) {
    const elements = this.filtersRendered.get(id)
    if(!elements) return

    elements.container.remove()

    this.xds.get(id)!.destroy()
    this.xds.delete(id)
    this.filtersRendered.delete(id)

    void this.onFiltersLengthChange()
  }

  /** `l(filter)` (`:1474-1480`): список папки, его скроллер и клик по строкам. */
  public l(filter: FilterLike) {
    const xd = new AutonomousDialogList({ filterId: filter.id, appDialogsManager: this })
    this.xds.set(filter.id, xd)
    const { scrollable, list } = xd.generateScrollable(filter)
    // `withArchiveContext: filter.id === FOLDER_ID_ALL` — меню строки «Архив», задача 1-5
    this.setListClickListener({ list, withContext: true })

    return { ul: list, xd, scrollable }
  }

  /** `:2055-2070` — расхождение 24 */
  public openDialogInNewTab(element: HTMLElement) {
    const peerId = +element.dataset.peerId!

    const url = `#${peerId}`
    window.open(url, '_blank')
  }

  /** `addFilter` (`:1249-1290`). */
  private addFilter(filter: FilterLike) {
    const { id } = filter

    const renderedFilter = this.filtersRendered.get(id)
    if(renderedFilter) {
      positionElementByIndex(renderedFilter.container, this.folders.container, filter.localId)
      return
    }

    const { ul, scrollable } = this.l(filter)
    scrollable.container.classList.add('tabs-tab', 'chatlist-parts', 'folders-scrollable', styles.scroll)
    scrollable.container.classList.toggle(styles.collapsed, this.collapsed) // расхождение 19
    scrollable.attachBorderListeners()

    const top = document.createElement('div')
    top.classList.add('chatlist-top')

    const bottom = document.createElement('div')
    bottom.classList.add('chatlist-bottom', styles.bottom)

    top.append(ul)
    scrollable.append(top, bottom)

    positionElementByIndex(scrollable.container, this.folders.container, filter.localId)

    this.filtersRendered.set(id, {
      id,
      container: scrollable.container,
      scrollable,
    })

    void this.onFiltersLengthChange()
  }

  /** `onFiltersLengthChange` (`:1298-1322`): один раз на тик. */
  private onFiltersLengthChange() {
    let promise = this.showFiltersPromise
    return promise ??= this.showFiltersPromise = pause(0).then(() => {
      if(this.showFiltersPromise !== promise) {
        return
      }

      const show = this.filtersRendered.size > 1
      const wasShowing = !this.folders.menuScrollContainer.classList.contains('hide')

      if(show !== wasShowing) {
        this.folders.menuScrollContainer.classList.toggle('hide', !show)
        this.chatsContainer.classList.toggle('has-filters', show)
      }

      // Расхождение 21: у tweb градиент переключается внутри `if`
      // выше (`:1310-1312`), т.е. только при СМЕНЕ показа, а `wasShowing`
      // читается по ряду. Ряд несёт `hide` с рождения (проп `class`), градиент
      // — нет (его `hide` из ref затирается, см. `gradientProps.ref`), поэтому
      // одна папка на холодном старте оставляет градиент показанным: он
      // растянут на весь оверлей (`_leftSidebar.scss:315-325`, `inset: 0`) и под
      // плашкой-подсказкой гасит прокрученные строки в её полях. Это видимый
      // артефакт оригинала — синхронизируем градиент с рядом на каждом проходе.
      this.folders.menuGradient.classList.toggle('hide', !show)

      const [, setHasFolders] = useHasFolders()
      setHasFolders(show)

      this.showFiltersPromise = undefined
    })
  }

  /** tweb `:1127-1129`: у нас форум — состояние колонки (`// ВРЕМЕННО до 1-6`) */
  public isChatListNarrow() {
    return this.hooks.isForumOpen() || this.hooks.appSidebarLeft.isCollapsed()
  }

  /** Контекст списка для строки (С1 раздела «СТРОКА ДИАЛОГА»): то, что оригинал читает у себя. */
  private getListContext(): DialogListContext {
    return {
      filterId: this.filterId,
      isArchive: !!this.xd && this.xd === this.xds.get(ARCHIVE_FOLDER_ID),
      isChatListNarrow: () => this.isChatListNarrow(),
    }
  }

  /** tweb `:2382-2389` — строка списка: контекст из менеджера (С1). */
  public setLastMessageN(options: Omit<SetLastMessageOptions, 'list'>) {
    return setLastMessageN({ ...options, list: this.getListContext() })
  }

  /**
   * tweb `:1300-1317`. Звонок в группе (`callIcon`) — О-96; `is-forum-open` —
   * панель тем у нас React (`// ВРЕМЕННО до 1-6`), класс не ставится.
   */
  public setDialogActive(listEl: HTMLElement, active: boolean) {
    setDialogActiveStatus(listEl, active)
    if(active) {
      this.lastActiveElements.add(listEl)
    } else {
      this.lastActiveElements.delete(listEl)
    }
  }

  /**
   * tweb `peer_changed` (`:1176-1229`): прежние активные строки гаснут, строка
   * нового чата подсвечивается. Источник — выбранный чат навигации
   * (`navigationStore.selectedId`, мост чтения п. 1; у tweb — событие
   * `appImManager`, этап 4): закрытый чат (`null`) гасит подсветку целиком.
   */
  private onPeerChanged(peerId: PeerId | undefined) {
    for(const element of this.lastActiveElements) {
      if(+element.dataset.peerId! !== peerId) {
        this.setDialogActive(element, false)
      }
    }

    if(!peerId) return
    const element = this.xd?.getDialogElement(peerId)?.dom.listEl
    if(element) {
      this.setDialogActive(element, true)
    }
  }

  /** Выбранный чат (`peer_changed`) — `PeerId` или ничего */
  private getActivePeerId() {
    const selectedId = useNavigationStore.getState().selectedId
    return selectedId ? +selectedId : undefined
  }

  /**
   * tweb `:2873-2929` — строка главного списка: `addDialogNew` + `initDialog`.
   * Активная при сборке (у tweb — в конструкторе `DialogElement`, `:383-390`,
   * `:488-490`) — строка открытого чата. Ленивая догрузка истории по видимости
   * (`lazyLoadQueue`, `:2889-2926`) не портирована: очереди нет (шапка
   * `components/avatar.ts`).
   */
  public addListDialog(options: Omit<Parameters<typeof addDialogNew>[0], 'managers'> & { isBatch?: boolean }) {
    const ret = addDialogNew({ ...options, managers: this.managers, autonomous: false })

    // В7-1: строка секретного чата — замок и зелёное имя (у tweb секретных чатов нет)
    if(getDialog(options.peerId).secret) {
      ret.dom.listEl.classList.add(styles.secret)
      ret.dom.titleSpanContainer.prepend(Icon('lock', styles.secretLock))
    }

    void this.initDialog(ret, options)

    if(this.getActivePeerId() === options.peerId) {
      this.setDialogActive(ret.dom.listEl, true)
    }

    return ret
  }

  /**
   * tweb `:2931-2983`: подзаголовок с бейджами, онлайн-точка и «печатает».
   * Звонок в группе (`processDialogForCallStatus`) — О-96.
   */
  public initDialog(dialogElement: DialogElement, options: { peerId: PeerId, isBatch?: boolean, lastMessage?: MyMessage }) {
    const { peerId } = options
    const dialog = getDialog(peerId)

    if(peerId !== rootScope.myId && isUser(peerId)) {
      const status = useChatsStore.getState().presence[peerId]
      if(isUserStatusOnline(status, Math.floor(Date.now() / 1000)) && dialogElement.dom.avatarEl) {
        this.xd?.setOnlineStatus(dialogElement.dom.avatarEl.node, true)
      }
    }

    const promise = initDialog(dialogElement, {
      peerId,
      dialog,
      isBatch: options.isBatch,
      lastMessage: options.lastMessage,
      list: this.getListContext(),
    })

    // * a row built while the peer is already typing gets no `peer_typings` event
    // * of its own, so the indicator has to be restored here — after the subtitle
    // * is rendered, and off the returned promise so it never delays the row
    void promise.then(() => setDialogTyping({
      dom: dialogElement.dom,
      peerId,
      middleware: dialogElement.middlewareHelper.get(),
      managers: this.managers,
    })).catch(() => {})

    return promise
  }

  /**
   * Клик по строке главного списка — `setListClickListener` (`:2072-2346`) модуля
   * с поведением главного списка: строка форума открывает панель тем
   * (`toggleForumTabByPeerId`, `:2206-2210`; `// ВРЕМЕННО до 1-6` — панель React),
   * остальное — открыть чат; подсветку ставит `peer_changed`, а не клик.
   * `withContext` — меню диалога (`:2337-2339`, расхождение 23).
   */
  public setListClickListener({ list, withContext = false }: { list: HTMLElement, withContext?: boolean }) {
    setListClickListener({
      list,
      managers: this.managers,
      openArchiveTab: () => this.openArchiveTab(),
      onFound: (elem) => {
        const peerId: PeerId = +elem.dataset.peerId!
        if(!elem.dataset.mid && isForum(cachedChat(peerId))) {
          this.hooks.openForum(peerId)
          return false
        }
      },
    })

    if(withContext) {
      this.contextMenu!.attach(list)
    }
  }

  /** tweb `appSidebarLeft.openArchiveTab()` (`sidebarLeft/index.ts:1760-1763`) — клик по строке «Архив» */
  public openArchiveTab() {
    this.hooks.appSidebarLeft.openArchiveTab()
  }

  /**
   * ВРЕМЕННО до 1-5: список архива для React-оверлея архива колонки — то, что
   * делает вкладка tweb `archivedTab.tsx:46-110` (`l({id: FOLDER_ID_ARCHIVE})`,
   * `setFilterIdAndChangeTab`, на закрытии — возврат к прежней папке и `destroy`).
   */
  public mountArchivedList(container: HTMLElement) {
    const filterId = ARCHIVE_FOLDER_ID
    const wasFilterId = this.filterId

    if(!this.xds.get(filterId)) {
      const { ul, scrollable } = this.l({ id: filterId, localId: filterId })
      scrollable.append(ul)
    }

    const xd = this.xds.get(filterId)!
    container.append(xd.scrollable.container)
    this.setFilterIdAndChangeTab(filterId)

    return () => {
      this.xds.delete(filterId)
      if(this.xd === xd) this.setFilterIdAndChangeTab(wasFilterId)
      xd.destroy()
      xd.scrollable.container.remove()
    }
  }

  /**
   * Панель тем открыта/закрыта — половина tweb `toggleForumTab` (`:1819-1876`):
   * бейджи на аватарах узкой колонки (`xd.toggleAvatarUnreadBadges`) и класс
   * `is-forum-visible` колонки (`transitionDrawersParent`, `:1878-1893`).
   * `// ВРЕМЕННО до 1-6`: сама панель — React-`TopicsPanel` колонки.
   */
  public onForumToggle(open: boolean, sidebarEl: HTMLElement) {
    this.xd?.toggleAvatarUnreadBadges(open)
    setTransition({
      element: sidebarEl,
      className: 'is-forum-visible',
      duration: 300,
      forwards: open,
    })
  }

  /**
   * Колонка свернулась/развернулась — `onCollapsedChange` tweb
   * (`sidebarLeft/index.ts:503-507`) в части списка: бейджи на аватарах.
   * `// ВРЕМЕННО до 2-1`: колбэк станет методом `AppSidebarLeft`.
   */
  public onCollapsedChange(collapsed: boolean) {
    this.xd?.toggleAvatarUnreadBadges(collapsed)
  }
}

// ═══ СТРОКА ДИАЛОГА: методы менеджера (функции модуля, С1) ════════════════

/**
 * Список, которому принадлежит строка, — то, что оригинал берёт у себя (С1):
 * `this.filterId` (закреп по папке), `this.xd === this.xds[FOLDER_ID_ARCHIVE]`,
 * `this.isChatListNarrow()` (бейдж на аватаре свёрнутой колонки).
 */
export type DialogListContext = {
  filterId: number,
  isArchive: boolean,
  isChatListNarrow: () => boolean,
}

/** Строка «Всех чатов» в широкой колонке — когда списка нет (строки поиска). */
const NO_LIST: DialogListContext = {
  filterId: ALL_FOLDER_ID,
  isArchive: false,
  isChatListNarrow: () => false,
}

/**
 * Диалог строки. У поиска это только пир (`{_: 'dialog', peerId} as any`,
 * tweb `:2992`), у списка — диалог зеркала целиком.
 */
export type PossibleDialog = Dialog | { _?: undefined, peerId: PeerId }

const isFullDialog = (dialog: PossibleDialog): dialog is Dialog => dialog._ === 'dialog'

/** tweb `dialogsStorage.isDialogPinned` (`storages/dialogs.ts:452-462`) */
function isDialogPinned(dialog: Dialog, filterId: number) {
  if(filterId !== ALL_FOLDER_ID && filterId !== ARCHIVE_FOLDER_ID) {
    // О-70 волна 7: у пользовательской папки нет `pinnedPeerIds` (`core/managers/foldersManager.ts::Folder`)
    return false
  }

  return !!dialog.pFlags?.pinned
}

/**
 * tweb `appMessagesManager.isDialogUnread`/`getDialogUnreadCount`
 * (`:14233-14254`): сумма по темам форума — О-71, `unread_mark` — О-72.
 */
export function isDialogUnread(dialog: Dialog) {
  return !!dialog.unread_count
}

/**
 * tweb `:2348-2380` — `ul.chatlist`. Из опций оригинала портирован `new`
 * (`chatlist-new`, список участников вкладки «Новая группа», `newGroup.tsx:64-66`);
 * `dialogSize` у наших потребителей не читается.
 */
export function createChatList(options: { new?: boolean } = {}) {
  const list = document.createElement('ul')
  // Legacy layout host: its direct children are native links, not li elements.
  // Keep those links exposed without announcing an invalid list structure.
  list.setAttribute('role', 'presentation')
  list.classList.add('chatlist')

  if(options.new) {
    list.classList.add('chatlist-new')
  }

  return list
}

/**
 * tweb `:1281-1298` в объёме С5 — только класс `active`.
 */
export function setDialogActiveStatus(listEl: HTMLElement, active: boolean) {
  listEl.classList.toggle('active', active)
}

/**
 * tweb `:2072-2346` — клик по строке списка. Строку ищет `mousedown` в фазе
 * захвата (раньше ripple и чужих обработчиков), а `click` по `a` гасится: у
 * строки главного списка есть `href`, переход по нему не нужен.
 *
 * Не портировано (предмета нет или он в других задачах):
 *   1. истории на аватаре (`findAvatarWithStories`/`getOpenStoryCallback`,
 *      `willOpenStory`) — историй у `avatarNew` нет; строку архива узнаём по её
 *      тегу (`ARCHIVE_DIALOG_TAG_NAME`), открывает архив хук `openArchiveTab`;
 *   2. выделение строк (`selection`, `pendingPress`, `SELECTION_BY_LIST`) —
 *      `DialogsSelectionBase` не портирован (О-30);
 *   3. `data-dialog-list-action` — таких узлов в строках у нас никто не ставит;
 *   4. реклама (`dataset.sponsored`), сообщества (`community`), монофорум и
 *      бот-форум (`linked_monoforum_id`, `bot_forum_view`) — О-4, О-5, О-3;
 *   5. Shift-клик → превью чата (`showChatPreviewPopup`), Ctrl/Cmd-клик → новая
 *      вкладка (`openDialogInNewTab`) — ни попапа, ни маршрута у нас нет;
 *   6. форум (`toggleForumTabByPeerId`, `toggleForumTab` главного списка) —
 *      форум-таб задача 1-6, главный список — 1-4;
 *   7. `lastActiveElements` — реестр менеджера, задача 1-8 (С4);
 *   8. `withContext` — меню диалога вешает метод владельца
 *      `setListClickListener` (расхождение 23), на выдачу поиска — задача 2-3; `withArchiveContext`/
 *      `openInner` — архив, задача 1-5;
 *   9. `appImManager.setPeer({peerId, lastMsgId, threadId, highlight})` →
 *      `core/navigation/openPeer.ts` + прыжок `core/messageLink.ts::requestMessageJump`
 *      для строки-сообщения (`data-mid`); `threadId`/`highlight` — С6, С7;
 *      менеджеры приходят опцией `managers` (у оригинала — синглтон).
 */
export function setListClickListener({
  list,
  onFound,
  autonomous = false,
  managers,
  openArchiveTab,
}: {
  list: HTMLElement,
  onFound?: (target: HTMLElement) => void | boolean,
  autonomous?: boolean,
  managers: OpenPeerManagers,
  /** `appSidebarLeft.openArchiveTab` (`:2137-2141`) — у списка со строкой «Архив» (С1) */
  openArchiveTab?: () => void,
}) {
  let lastActiveListElement: HTMLElement | undefined

  list.dataset.autonomous = '' + +autonomous

  const onPress = (e: MouseEvent) => {
    const archiveElem = openArchiveTab && findUpTag(e.target!, ARCHIVE_DIALOG_TAG_NAME)
    if(archiveElem) {
      openArchiveTab()
      return
    }

    const elem = findDialogListElement(e.target!)
    if(!elem) {
      return
    }

    const peerId: PeerId = +elem.dataset.peerId!
    const lastMsgId = +elem.dataset.mid! || undefined

    // tweb `setPeerFunc({peerId, lastMsgId})` — прыжок ставится до открытия:
    // лента потребляет `pendingJump`, когда чат откроется.
    const openChat = () => {
      if(lastMsgId) {
        requestMessageJump(peerId, lastMsgId)
      }

      const peer = cachedPeer(peerId)
      openPeer(managers, {
        id: peerId,
        title: getPeerTitle({ peerId, peer }),
        username: peer?._ === 'user' ? peer.username : undefined,
        photoId: getPeerPhotoId(getPeerPhoto(peer)) || undefined,
      })
    }

    if(onFound?.(elem) === false) {
      return
    }

    if(autonomous) {
      const sameElement = lastActiveListElement === elem
      if(lastActiveListElement && !sameElement) {
        setDialogActiveStatus(lastActiveListElement, false)
      }

      setDialogActiveStatus(elem, true)
      lastActiveListElement = elem
    }

    openChat()
  }

  list.addEventListener('mousedown', (e) => {
    if(e.button !== 0) {
      return
    }

    onPress(e)
  }, { capture: true })

  // cancel link click
  // ! do not change it to attachClickEvent
  list.addEventListener('click', (e) => {
    // Native links activate with a click alone from a keyboard or assistive
    // technology. Pointer activation already ran on mousedown.
    if(e.detail === 0) {
      onPress(e)
    }

    if(e.button === 0) {
      cancelEvent(e)
    }
  }, { capture: true })
}

/** tweb `:2382-2389` */
export function setLastMessageN(options: SetLastMessageOptions) {
  return setLastMessage(options).catch((err: { type?: string }) => {
    if(err?.type !== 'MIDDLEWARE') {
      log.error('set last message error', err)
    }
  })
}

/**
 * tweb `:2408-2435` — В7-3 (С2): последнее сообщение — `dialog.lastMessage`
 * зеркала. Черновик не показывается у форума (`!apiManagerProxy.isForum`),
 * монофорума у нас нет.
 */
function getLastMessageForDialog(dialog: PossibleDialog, lastMessage?: MyMessage) {
  let draftMessage: DraftMessageReal | undefined
  if(!lastMessage && isFullDialog(dialog)) {
    const draft = realDraft(dialog.draft)
    if(draft && (!isAnyChat(dialog.peerId) || !isForum(cachedChat(dialog.peerId)))) {
      draftMessage = draft
    }

    lastMessage = dialog.lastMessage
  }

  return { lastMessage, draftMessage }
}

/**
 * tweb `:2437-2483` (0af53a342) — всё, из чего рисуется подзаголовок, одной
 * строкой. Без `isSaved`/`subtitlePeerId`/`isRestricted`/`isSensitive`/
 * `ttl_seconds` (С3); `fwdFromId` у нас — наличие `fwd_from` (иконка рисуется
 * по нему, `components/wrappers/dialogSubtitle.ts`).
 */
function getLastMessageRenderKey(options: {
  peerId: PeerId,
  lastMessage?: MyMessage,
  draftMessage?: DraftMessageReal,
  highlightWord?: string,
  noForwardIcon?: boolean,
}) {
  const { lastMessage, draftMessage } = options
  const message = lastMessage?._ === 'message' ? lastMessage : undefined
  const media = lastMessage && getMediaFromMessage(lastMessage)

  return [
    options.peerId,
    options.highlightWord,
    options.noForwardIcon,
    draftMessage?.date,
    draftMessage?.message,
    lastMessage?._,
    lastMessage?.peerId,
    lastMessage?.id,
    lastMessage?.date,
    message?.edit_date,
    lastMessage?.fromId,
    !!message?.fwd_from,
    lastMessage?.reply_to?._,
    media?.id,
    media?._ === 'document' ? media.type : undefined,
    lastMessage ? isMediaSpoiler(lastMessage) : undefined,
    message?.message,
  ].join('\x01')
}

export type SetLastMessageOptions = {
  dialog: PossibleDialog,
  lastMessage?: MyMessage,
  dialogElement: DialogElement,
  highlightWord?: string,
  isBatch?: boolean,
  /** строка списка: заодно бейджи и статус (`setUnreadMessages`); у поиска — нет */
  setUnread?: boolean,
  noForwardIcon?: boolean,
  setMessageId?: boolean,
  /** С1 */
  list?: DialogListContext,
}

const VIDEO_TYPES: Set<MyDocument['type']> = new Set(['video', 'gif', 'round'])

/** tweb `:2485-2676` */
async function setLastMessage({
  dialog,
  lastMessage: _lastMessage,
  dialogElement,
  highlightWord,
  isBatch = false,
  setUnread = false,
  noForwardIcon,
  setMessageId = true,
  list,
}: SetLastMessageOptions) {
  const { dom } = dialogElement
  const { peerId } = dialog

  const { deferred: promise, middleware } = setPromiseMiddleware(dom, 'setLastMessagePromise')

  const { draftMessage, lastMessage } = getLastMessageForDialog(dialog, _lastMessage)

  const isSearch = !setUnread
  // * do not uncomment `setUnread` - unsetTyping right after this call will interrupt setting unread badges
  if(!isSearch && isFullDialog(dialog)) {
    void setUnreadMessagesN({ dialog, dialogElement, isBatch, setLastMessagePromise: promise, list })
  }

  const renderKey = getLastMessageRenderKey({
    peerId,
    lastMessage,
    draftMessage,
    highlightWord,
    noForwardIcon,
  })
  // * the key is dropped for the whole render and only restored once the new
  // * subtitle is in the DOM, so a render interrupted by the middleware can
  // * never leave a stale key behind
  const previousRenderParts = dom.lastMessageRenderParts
  const canSkipRender = dom.lastMessageRenderKey === renderKey &&
    isRenderedSubtitleIntact(dom)
  delete dom.lastMessageRenderKey
  delete dom.lastMessageRenderParts

  // В7-1: секретный чат до рукопожатия — статус вместо последнего сообщения
  // (наш продукт, у tweb секретных чатов нет; фича на паузе, но существующие чаты живы)
  const secretStatus = isFullDialog(dialog) && dialog.secret ?
    useSecretChatStore.getState().byChat[peerId]?.status :
    undefined
  if(secretStatus === 'requested' || secretStatus === 'awaiting' || secretStatus === 'rejected') {
    const span = document.createElement('span')
    span.classList.add('dialog-subtitle-span', 'dialog-subtitle-span-last')
    if(secretStatus === 'requested') span.classList.add(styles.secretInvite)
    span.append(i18n(secretStatus === 'requested' ? 'SecretChat.Invitation' : secretStatus === 'rejected' ? 'SecretChat.Rejected' : 'SecretChat.Awaiting'))
    dom.lastMessageSpan.replaceChildren(span)
    dom.lastTimeSpan.replaceChildren()
    promise.resolve!()
    return
  }

  if(!lastMessage && !draftMessage) {
    // `getEmptySubtitle` — бот-форум и сообщества (С7, О-3, О-5)
    dom.lastMessageSpan.replaceChildren()
    dom.lastTimeSpan.replaceChildren()
    delete dom.listEl.dataset.mid

    promise.resolve!()
    return
  }

  // set it before content so won't have bug in appSearch
  if(isSearch && setMessageId && lastMessage) {
    dom.listEl.dataset.mid = '' + lastMessage.id
  }

  let renderedParts = canSkipRender ? previousRenderParts : undefined

  if(!canSkipRender) {
    let mediaContainer: HTMLElement | undefined
    const mediaParts: (Promise<HTMLElement> | HTMLElement)[] = []

    if(lastMessage && !draftMessage) {
      const media = getMediaFromMessage(lastMessage)
      if(media && (media._ === 'photo' || VIDEO_TYPES.has(media.type))) {
        const spoiler = isMediaSpoiler(lastMessage)
        const size = choosePhotoSize(media, 20, 20)

        if(size) {
          const container = mediaContainer = document.createElement('div')
          container.classList.add('dialog-subtitle-media')

          if(media._ === 'document' && media.type === 'round') {
            container.classList.add('is-round')
          }

          mediaParts.push(wrapPhoto({
            photo: media,
            container,
            withoutPreloader: true,
            size,
          }).then(async() => {
            if(spoiler) {
              // `middleware` у оригинала — `stateMiddlewareHelper` менеджера, у
              // нас — строки; `multiply: 0.1` у него мёртв (`dotRenderer.ts:331`)
              const el = await wrapMediaSpoiler({
                media,
                width: 20,
                height: 20,
                middleware: dialogElement.middlewareHelper.get(),
                animationGroup: 'none',
              })
              if(el) container.append(el)
            }

            return container
          }))

          if(media._ === 'document' && VIDEO_TYPES.has(media.type)) {
            const playIcon = Icon('play_filled', 'dialog-subtitle-media-play')
            container.append(playIcon)
          }
        }
      }
    }

    const withoutMediaType = !!mediaContainer && !!(lastMessage && getMessageText(lastMessage))
    const parts = await renderDialogSubtitleParts({
      peerId,
      lastMessage,
      draftMessage,
      noForwardIcon,
      mediaParts,
      withoutMediaType,
      highlightWord: highlightWord && lastMessage && getMessageText(lastMessage) ? highlightWord : undefined,
      middleware,
      titleMiddleware: dialogElement.middlewareHelper.get(),
      managers: dialogElement.managers,
    })
    dom.lastMessageSpan.classList.add('dialog-subtitle-parts')
    dom.lastMessageSpan.replaceChildren(...parts)
    renderedParts = parts
  }

  // * the label is relative to the current day, so it is refreshed even when
  // * the subtitle itself was left alone
  const date = draftMessage ? Math.max(draftMessage.date, lastMessage?.date || 0) : lastMessage!.date
  replaceContent(dom.lastTimeSpan, formatDateAccordingToTodayNew(new Date(date * 1000)))

  dom.lastMessageRenderKey = renderKey
  dom.lastMessageRenderParts = renderedParts
  promise.resolve!()
}

export type SetUnreadMessagesOptions = {
  dialog: Dialog,
  dialogElement: DialogElement,
  isBatch?: boolean,
  setLastMessagePromise?: Promise<void>,
  /** С1 */
  list?: DialogListContext,
}

/** tweb `:2678-2680` */
export function setUnreadMessagesN(options: SetUnreadMessagesOptions) {
  return setUnreadMessages(options).catch(() => {})
}

/**
 * tweb `:2682-2823`. Факты — синхронно из зеркал (мосты чтения п. 2 плана
 * волны 7): мьют — `stores/notifyStore.ts::isDialogMuted` (порт
 * `isPeerLocalMuted({respectType: true})`, правило одно на приложение), закреп
 * и непрочитанное — из диалога (О-70…О-72). Темы, сохранённые диалоги,
 * монофорум и «все чаты» — С3.
 */
async function setUnreadMessages({
  dialog,
  dialogElement,
  isBatch = false,
  setLastMessagePromise,
  list = NO_LIST,
}: SetUnreadMessagesOptions) {
  const { dom } = dialogElement
  const { deferred, middleware } = setPromiseMiddleware(dom, 'setUnreadMessagePromise')

  const { peerId } = dialog
  const isMuted = isDialogMuted(dialog, cachedChat(peerId), useNotifyStore.getState().settings)
  const { draftMessage, lastMessage } = getLastMessageForDialog(dialog)
  const isPinned = isDialogPinned(dialog, list.filterId)
  const isUnread = isDialogUnread(dialog)

  // tweb `:2723-2726`: значок у своего последнего исходящего, не в «Избранном»;
  // «прочитан ли» — по горизонту собеседника (С2)
  let sendingStatus: SendingStatusIcon | undefined
  if(!draftMessage && lastMessage && lastMessage.pFlags.out && lastMessage.peerId !== rootScope.myId) {
    sendingStatus = lastMessage.id > dialog.read_outbox_max_id ? 'check' : 'checks'
  }

  const unreadCount = dialog.unread_count

  // * have to await all promises before modifying something

  if(setLastMessagePromise) {
    try {
      await middleware(setLastMessagePromise)
    } catch {
      return
    }
  }

  const transitionDuration = isBatch ? 0 : BADGE_TRANSITION_TIME

  setSendingStatus(dom.statusSpan, sendingStatus)

  const hasPinnedBadge = isPinned
  const hasUnreadBadge = isUnread
  const hasUnreadAvatarBadge = dialogElement.isMainList !== false &&
    !list.isArchive &&
    list.isChatListNarrow() &&
    isUnread
  // * `unreadCount` counts the unread topics for a forum, so the mention state
  // * must be derived from it too — not from `dialog.unread_count` (О-71)
  const { isMention, hasMentionsBadge } = getDialogMentionBadgeState({
    unreadCount,
    unreadMessagesCount: dialog.unread_count,
    unreadMentionsCount: dialog.unread_mentions_count,
    hasUnreadBadge,
  })
  const hasReactionsBadge = !!dialog.unread_reactions_count
  let unreadBadgeText: string | undefined
  if(hasUnreadBadge) {
    unreadBadgeText = isMention ? '@' : '' + (unreadCount ? formatNumber(unreadCount, 1) : ' ')
  }

  dialogElement.setBadgeState({
    muted: isMuted,
    pinned: hasPinnedBadge,
    unread: hasUnreadBadge,
    unreadText: unreadBadgeText,
    unreadMention: isMention,
    unreadAvatar: hasUnreadAvatarBadge,
    unreadAvatarText: unreadBadgeText || undefined,
    mentions: hasMentionsBadge,
    reactions: hasReactionsBadge,
    transitionDuration,
  })

  deferred.resolve!()
}

/**
 * tweb `:2825-2876` в объёме обычного диалога (темы, сохранённые, монофорум —
 * С3). В7-3: диалог — из зеркала `chatsStore`, синхронно; нет его —
 * заготовка, как у оригинала (`{peerId, pFlags: {}}`).
 */
export function getDialog(dialog: Dialog | PeerId): Dialog {
  if(typeof(dialog) === 'object') {
    return dialog
  }

  const found = useChatsStore.getState().dialogs.find((d) => d.peerId === dialog)
  if(found) {
    return found
  }

  return {
    _: 'dialog',
    peerId: dialog,
    peer: getOutputPeer(dialog),
    pFlags: {},
    top_message: 0,
    read_inbox_max_id: 0,
    read_outbox_max_id: 0,
    unread_count: 0,
    unread_mentions_count: 0,
    unread_reactions_count: 0,
    notify_settings: EMPTY_NOTIFY_SETTINGS,
  }
}

/**
 * tweb `:2931-2984` — первое наполнение строки: подзаголовок с бейджами. Онлайн-точку
 * и «печатает» добавляет метод менеджера `initDialog` (у них предмет — список папки,
 * `xd`), звонок в группе — О-96 (С8).
 */
export function initDialog(dialogElement: DialogElement, options: {
  peerId: PeerId,
  dialog?: Dialog,
  isBatch?: boolean,
  lastMessage?: MyMessage,
  list?: DialogListContext,
}) {
  const dialog = getDialog(options.dialog || options.peerId)
  return setLastMessageN({
    dialog,
    dialogElement,
    isBatch: options.isBatch,
    lastMessage: options.lastMessage,
    setUnread: true,
    list: options.list,
  })
}

/**
 * tweb `:3007-3022` — строка + вставка в контейнер. `container: false` —
 * «не вставлять» (потребитель расставит сам, как `SortedUserList.onSort`).
 * `autonomous` по умолчанию — «есть контейнер», как в оригинале.
 */
export function addDialogNew(options: DialogElementOptions & { container?: HTMLElement | false, append?: boolean }) {
  const d = new DialogElement({
    autonomous: !!options.container,
    avatarSize: 'bigger',
    ...options,
  });
  (d.container as DialogListElement).dialogElement = d

  if(options.container) {
    const method = options.append === false ? 'prepend' : 'append'
    options.container[method](d.container)
  }

  return d
}
