// src/components/chat/bubbles.ts
//
// Императивная лента сообщений — порт tweb `src/components/chat/bubbles.ts`
// (класс `ChatBubbles`). Класс владеет DOM-деревом ленты, скроллом, картой
// отрисованных баблов, подписками на события истории, группировкой серий
// (`bubbleGroups.ts`), секциями дней, очередью рендера, именем автора,
// пагинацией с обеих сторон, сохранением позиции при вставке над вьюпортом
// (`ScrollSaver`), липкими датами (`StickyIntersector`), подрезкой вьюпорта,
// границей непрочитанных и САМОЙ ОТМЕТКОЙ ПРОЧТЕНИЯ (наблюдатель пересечения по
// непрочитанным баблам — см. секцию «отметка о прочтении»). Шапка пересылки
// приезжает следующим этапом.
//
// Источник данных — НЕреактивное зеркало окон `core/history/messagesMirror.ts`
// (порт `apiManagerProxy.mirrors`): страницу истории лента кладёт туда сама —
// `getHistory` → `putMirrorPage` (догрузка ДОПОЛНЯЕТ окно) или
// `replaceMirrorWindow` (страница `setPeer` НАЧИНАЕТ его заново, как `cleanup()`
// начинает заново отрисованное), точечные изменения приезжают событиями
// каталога tweb (`history_append`/`history_update`/`message_edit`/
// `history_delete`).
//
// ─── Где мы сознательно расходимся с tweb (и почему) ───────────────────────
//  • `ChatContext` вместо `Chat`. tweb передаёт в конструктор весь объект
//    `Chat` (топбар, инпут, выделение, контекстное меню, `bubbleGroups`…).
//    У нас из него нужны peerId, threadId, ключ окна
//    (`chat.messagesStorageKey`), два узла окружения (`container` — колонка
//    `.chat`, `bubblesViewport` — видимая зона ленты) и адресат кликов
//    (`navigation`), — поэтому конструктор берёт узкий структурный тип. Полный
//    `Chat` — этап 7, когда лента заберёт себе и остальное окружение; узлы
//    окружения до тех пор создаёт хост (`VanillaFeed`, порт `chat.ts:640-643`).
//  • `BubblesManagers` вместо всего `AppManagers`: ленте нужен узкий набор
//    методов — три формы страницы (`messages.getHistory`/`getAround`),
//    `messages.messageByDate` под календарь, `peers.fillMirror` (объявить
//    пробел зеркала карточек, см. `peerTitle.ts`) и пара `dialogs.*` под
//    границу непрочитанных и последнее сообщение чата. Узкий тип позволяет
//    поднять ленту в тесте без RPC-моста.
//  • `setPeer` портирован БЕЗ ветки смены пира: у нас пир меняет хост,
//    пересоздавая ленту эффектом по `peerId` (`VanillaFeed.tsx`), поэтому «тот
//    же инстанс на новый пир» предмета не имеет — построчный разбор того, что
//    из ветки `!samePeer` перенесено, а что нет, лежит у самого метода. Всё
//    остальное в пагинации 1:1: `loadMoreHistory` → `getHistory1` (гейт стороны
//    + предзагрузка) → `getHistory`.
//  • `attachContainerListeners()` портирован ЧАСТИЧНО — ровно тем составом, у
//    которого уже есть предмет: делегирование кликов по размеченным узлам
//    rich-text и ответ жестом (даблклик на десктопе / свайп на таче, порт
//    bubbles.ts:1496-1572), плюс контекстное меню (:1478) и выделение (:1479) —
//    оба лента поднимает фабрикой хоста (`createContextMenu`/`createSelection`).
//    Зовёт его конструктор: в tweb это делает `Chat` (`chat.ts:638`), а у нас
//    `Chat`-хоста нет.
//  • `processBatch` портирован вместе со скроллом (`changedTop`/`changedBottom`
//    → `reverse` → `prepareToSaveScroll`/`restoreScroll`) и ожиданиями
//    (`getHeavyAnimationPromise`, `setUnreadDelimiter`, `fastRafPromise`) и
//    запуском лестницы (`canAnimateLadder`). Вне порта осталось то, у чего нет
//    предмета: ожидание медиа-промисов единицы (наш состав бабла синхронный),
//    подмена баблов (`bubblesToReplace`/`ejectBubbles`), выделение, sponsored,
//    `lazyLoadQueue` — построчно перечислено у метода.
//  • Ре-кей бабла на новый идентификатор в tweb живёт в подписке `message_sent`
//    (bubbles.ts:900-906: `delete this.bubbles[fullTempMid]` →
//    `this.bubbles[fullMid] = bubble` → `bubble.dataset.mid = mid`), а
//    `history_update` там репозиционирует уже переклеенный бабл. У нас
//    `message_sent` в каталоге нет: смену идентификатора объявляет
//    `history_update` вместе с `tempId` (см. докблок `lib/rootScope.ts` и
//    `core/history/messagesMirror.ts`), поэтому ре-кей выполняет он —
//    строки тела перенесены дословно.
//  • Сервисное сообщение уходит по своей ветке `renderMessage`
//    (порт bubbles.ts:6708-6712 → :7293-7301), но САМ узел пилюли строит
//    `serviceMessage.ts` — там же, где дата-разделитель: у tweb оба каркаса
//    тоже лежат в одном файле (ленте), просто у нас лента разрезана на модули.
//    Роль `SERVICE_AS_REGULAR` играет `getMessageKind` — см. саму ветку.
//  • Ветка `hide-name` живёт не здесь, а в `bubbleClasses` (общий с React-лентой
//    вычислитель модификаторов бабла): в tweb класс ставится прямо по ходу
//    сборки имени (bubbles.ts:9516/9648), у нас — по тому же признаку
//    `showName`, который лента считает `needName`.
import type { LangPackKey } from '@/lang'
import Scrollable, { type SliceSides } from '@components/scrollable'
import StickyIntersector from '@components/stickyIntersector'
import SuperIntersectionObserver from '@helpers/dom/superIntersectionObserver'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware, type Middleware } from '@helpers/middleware'
import middlewarePromise from '@helpers/middlewarePromise'
import BatchProcessor, { type MiddlewareAwaiter } from '@helpers/batchProcessor'
import indexOfAndSplice from '@helpers/array/indexOfAndSplice'
import noop from '@helpers/noop'
import cancelEvent from '@helpers/dom/cancelEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import getViewportSlice from '@helpers/dom/getViewportSlice'
import ScrollSaver from '@helpers/scrollSaver'
import debounce, { type DebounceReturnType } from '@helpers/schedulers/debounce'
import { fastRaf, fastRafPromise } from '@helpers/schedulers'
import { FocusDirection, type ScrollStartCallbackDimensions } from '@helpers/fastSmoothScroll'
import windowSize from '@helpers/windowSize'
import mediaSizes from '@helpers/mediaSizes'
import { IS_MOBILE, IS_SAFARI } from '@environment/userAgent'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import idleController from '@helpers/idleController'
import { getHeavyAnimationPromise, onHeavyAnimation as useHeavyAnimationCheck } from '@core/dom/heavyAnimation'
import rootScope from '@lib/rootScope'
import { ANCHOR_ACTION_ATTRIBUTE, wrapMessageText, type AnchorAction } from '@lib/richtext'
import { mirrorWindow, putMirrorPage, replaceMirrorWindow } from '@core/history/messagesMirror'
import { generateTempMessageId, isLocalMessageId } from '@core/history/messageId'
import { messageToConvMsg } from '@core/messageToConvMsg'
import { dayLabel } from '@core/format/dayLabel'
import { fmtViews } from '@core/format/fmtViews'
import { getMessageText, isOurMessage, isOutMessage, type MessageReal, type MessageReplies, type MessageService, type MyMessage, type OurMessageChat } from '@core/models'
import { getOutputPeer, isAnyChat, toPeerId } from '@core/peers/peerId'
import { hasReactionEmoticon } from '@core/reactions/messageReactions'
import type { HistoryArgs, HistoryResult } from '@core/managers/messagesManager'
import { bubbleClasses, type BubbleCtx } from '../messages/bubbleClasses'
import BubbleGroups, {
  STICKY_OFFSET,
  whichChild,
  type BubbleGroup,
  type BubbleGroupsHost,
  type DateContainer,
  type GroupAvatar,
} from './bubbleGroups'
import { createDateBubble as createServiceDateBubble, createServiceBubble } from './serviceMessage'
import { createReplyContainer } from './replyContainer'
import { createMessageTime, setRepliesCount, setSendingStatus } from './messageTime'
import { createReactionsElement, type ReactionsManagers } from './reactions'
import { renderReplies, setRepliesElementCount } from './replies'
import { attachReplySwipe, findDoubleClickReplyBubble } from './replySwipe'
import type ChatContextMenu from './contextMenu'
import type { ContextMenuBubbles } from './contextMenu'
import type ChatSelection from './selection'
import type { SelectionBubbles } from './selection'
import wrapPhoto from '@components/wrappers/photo'
import wrapVideo from '@components/wrappers/video'
import wrapSticker from '@components/wrappers/sticker'
import wrapDocument from '@components/wrappers/document'
import wrapAlbum from '@components/wrappers/album'
import wrapMediaSpoiler, { onMediaSpoilerClick } from '@components/wrappers/mediaSpoiler'
import wrapMessageForReply from '@components/wrappers/messageForReply'
import { setAttachmentSize } from '@core/dom/mediaSizes'
import { openMediaViewer, type OpenMediaViewerArgs } from '@components/mediaViewer/openMediaViewer'
import { collectLightboxItems } from '@components/mediaViewer/collectLightboxItems'
import { cachedPeer } from '@core/peerCache'
import { getBubbleMedia, getStrippedThumb, isMediaSpoiler, type MyDocument } from '@core/media/messageMedia'
import { getMediaId, getMessageKind } from '@core/messages/messageKind'
import type { MessageActionPhoneCall } from '@core/messages/messageAction'
import Icon from '@components/icon'
import { formatVideoTime } from '@components/messages/videoPlayback'
import PeerTitle, { type PeerTitleManagers } from './peerTitle'
import { generateTail } from './tail'
import { avatarNew } from '@components/avatar'
import ProgressivePreloader from '@components/preloader'
import liteMode from '@helpers/liteMode'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import { animateLadderLists, type LadderStep } from '@core/dom/ladder'
import { deleteChatPosition, getChatPosition, saveChatPosition, type ChatPosition } from '@core/chat/chatPositions'
import { getActiveGradientRenderer } from '@core/chat/activeGradient'
import type { ChatAutoDownload } from '@core/hooks/useChatAutoDownload'
import { i18n } from '@lib/langPack'
import { useI18nStore } from '../../i18n'

/** Адрес бабла — порт tweb `FullMid` (`${peerId}_${mid}`, bubbles.ts:440-449).
 *
 *  Вторая половина ключа у нас — `MyMessage.id`, а НЕ `seq`. Причина ровно та же,
 *  по которой события истории адресуют сообщение по `id`
 *  (`core/realtime/messageOps.ts::dedupKey`): у неотправленного бабла `seq` —
 *  выдумка владельца (`tentativeSeq = maxSeq + 1`), и чужое входящее может
 *  приехать с тем же `seq`, а `id` уникален (у бабла он отрицательный).
 *  Ключевать баблы по `seq` значило бы, что входящее вытесняет из карты бабл
 *  «отправляется…» — тот же дефект, который в слое операций закрыл `dedupKey`.
 *  Ре-кей на серверный `id` при ack делает подписка `history_update` (tempId). */
export type FullMid = `${number}_${number}`

export function makeFullMid(peerId: number, mid: number): FullMid {
  return `${peerId}_${mid}`
}

/** Порт tweb `splitFullMid` (bubbles.ts:451-458). */
export function splitFullMid(fullMid: string): { peerId: number, mid: number } {
  const idx = fullMid.indexOf('_')
  return { peerId: +fullMid.slice(0, idx), mid: +fullMid.slice(idx + 1) }
}

/** Порт tweb bubbles.ts:464 (`makeFullMid(NULL_PEER_ID, 0)`) — «адреса нет»:
 *  им `loadMoreHistory` затыкает пустую отрисованную историю, и с него же
 *  начинается первая страница окна. */
const EMPTY_FULL_MID = makeFullMid(0, 0)

/**
 * Куда лента адресует клики по размеченным узлам rich-text — точка расширения
 * для навигации. Порт ДВУХ путей tweb, которые у него ведут в `appImManager`:
 *   • внутренние ссылки Telegram (`t.me/...`, `tg://...`). tweb вешает на такой
 *     `<a>` inline `onclick` с именем глобальной функции (`addAnchorListener`,
 *     исполняет `internalLinkProcessor`); у нас inline-обработчики запрещены
 *     (`web-client/CLAUDE.md`, «Безопасность»), поэтому имя действия лежит в
 *     `data-anchor-action` (`lib/richtext/url.ts`), а слушателя вешает лента;
 *   • клик по имени/упоминанию автора — `onBubblesClick` (bubbles.ts:3360:
 *     `findUpClassName(target, 'peer-title') || findUpAttribute(target,
 *     'data-follow')` → `setInnerPeer`).
 *
 * Обработчик возвращает `true`, если действие исполнено, — тогда лента гасит
 * событие ровно как tweb (`cancelEvent`). Без обработчика (или при `false`)
 * остаётся браузерное поведение ссылки: `setBlankToAnchor` проставил
 * `target="_blank"`, то есть t.me открывается новой вкладкой — ровно то, что
 * делает сегодня React-лента (`components/RichText.tsx:73`). Своей навигации
 * лента не изобретает: и `openPeer`, и разбор внутренних ссылок живут выше
 * (`core/hooks/useNavigationActions`, стор навигации), куда ленте ходить
 * нельзя.
 */
export interface BubblesNavigation {
  /** имя действия из `data-anchor-action` + сам `<a>` (у него `href` уже
   *  прошёл allow-list схем) */
  openInternalLink?(action: AnchorAction, anchor: HTMLElement): boolean
  /** peerId из `.peer-title[data-peer-id]` / `a.follow[data-follow]` */
  openPeer?(peerId: number, element: HTMLElement): boolean
  /**
   * Показать календарь — порт `showDatePickerPopup({initDate, onPick:
   * this.onDatePick})` из ветки клика по ДАТА-баблу (tweb bubbles.ts:3075-3078).
   *
   * Здесь, а не внутри ленты, потому что попап у нас React-компонент
   * (`components/DatePickerPopup.tsx`), а монтирует его владелец слоя попапов —
   * то есть хост. Лента отдаёт ровно то, что отдаёт оригинал: день секции
   * (`initDate`, мс) и ЧТО ДЕЛАТЬ с выбранным днём — `onDatePick`. Решение «день
   * → номер → прыжок» остаётся у ленты, как в tweb (bubbles.ts:10205).
   *
   * Не переносятся `canMultiSelect`/`multiSelectAction` (:3081-3105) — выбор
   * диапазона дней ради «Очистить историю»: наш попап такого режима не знает.
   */
  openDatePicker?(initDate: number, onPick: (timestamp: number) => void): void
  /**
   * Открыть тред комментариев поста канала — порт ветки клика по футеру
   * (tweb bubbles.ts:3315-3343): `setInnerPeer({peerId: replies.channel_id
   * .toPeerId(true), type: ChatType.Discussion, threadId})`.
   *
   * Здесь, а не внутри ленты, по той же причине, что календарь: тред у нас
   * открывается стеком колонки чата (`stores/chatStackStore.setInnerPeer` через
   * `Chat.tsx::onOpenThread`), а стеком владеет хост. Лента отдаёт то же, что
   * отдаёт оригинал: КЛЮЧ ГРУППЫ ОБСУЖДЕНИЯ (не канала — :3335) и номер поста.
   *
   * Расхождение одно: у оригинала `threadId` — номер ЗЕРКАЛА поста в группе,
   * который приезжает ответом `getDiscussionMessage` (:3332); у нас корнем
   * треда служит номер САМОГО ПОСТА (`Chat.tsx::onOpenThread` → `rootMsgId`), и
   * зеркало остаётся деталью бэкенда (`usecase/chat/discussion.go::CommentCounts`
   * — «ключи результата остаются НОМЕРАМИ ПОСТОВ»). Поэтому лишнего запроса
   * перед открытием нет.
   */
  openDiscussion?(args: { peerId: PeerId, postMid: number }): void
  /**
   * ПЕРЕЗВОНИТЬ по баблу лога звонка — порт ветки tweb bubbles.ts:3192-3196
   * (`this.chat.appImManager.callUser(this.peerId.toUserId(), callDiv.dataset
   * .type)`).
   *
   * Здесь, а не внутри ленты, ровно по адресу самого поля `navigation`: у
   * оригинала это вызов `appImManager` — окружения, а не ленты. Наш звонок
   * поднимает `core/calls/callEngine::startOutgoing`, и ему нужна КАРТОЧКА
   * собеседника (имя, градиент, id фотографии), которой лента не владеет;
   * собирает её хост (`VanillaFeed`) — тем же способом, что список звонков
   * (`components/CallsView.tsx`).
   *
   * Тип едет тем же значением, что лежит в `data-type` бабла: `'voice'` либо
   * `'video'` (tweb `CallType`). Не передан — клик по баблу звонка ничего не
   * делает, как и любая другая непереданная ручка навигации.
   */
  callUser?(type: 'voice' | 'video'): void
}

/** Срез `Chat`, которым пользуется лента (см. расхождения в шапке). */
export interface ChatContext {
  peerId: number
  /** окно треда (форум-топик / комментарии); undefined — основное окно чата */
  threadId?: number
  /** ключ окна в зеркале — аналог tweb `chat.messagesStorageKey`, которым
   *  подписки сверяют «событие про ТЕКУЩИЙ чат» */
  messagesStorageKey: string
  /** Порт tweb `chat.isLikeGroup` (chat.ts:145, считается
   *  `appPeersManager.isLikeGroup`): «чат, где у сообщений есть подписанный
   *  автор» — любая группа, а также канал с `signature_profiles`. Единственный
   *  гейт показа имени автора в бабле (`needName`, bubbles.ts:9331).
   *  `signature_profiles` в нашей модели нет, поэтому хост передаёт сюда просто
   *  «это группа» (`Chat.tsx`). */
  isLikeGroup?: boolean
  /** Порт tweb `chat.isBroadcast` (chat.ts) — канал. Единственный потребитель
   *  здесь — размер страницы истории (tweb bubbles.ts:11389: у канала 20). */
  isBroadcast?: boolean
  /** Порт tweb `chat.isMegagroup` (chat.ts:141). Читает его РОВНО одно место —
   *  `isOurMessage` (chat.ts:1375), то есть сторона бабла: в мегагруппе она
   *  берётся из сырого `pFlags.out`, и сообщение от лица канала (send-as)
   *  рисуется исходящим. Вид чата знает `Chat`, а не лента, поэтому он
   *  приезжает сюда — как `isLikeGroup` и `isBroadcast`. */
  isMegagroup?: boolean
  /** Порт tweb `chat.container` (chat.ts:80) — узел `.chat`. Лента вешает на
   *  него класс `is-go-down-visible` (`updateGoDownVisibility`, tweb
   *  bubbles.ts:4907) и читает `is-toggling-helper` (`scrollToBubble`, :4677). */
  container: HTMLElement
  /** Порт tweb `chat.bubblesViewport` (chat.ts:640) — узел `.bubbles-viewport`,
   *  сосед `.bubbles` внутри `.chat`. Реально видимая зона ленты: сам
   *  скролл-контейнер уезжает под топбар и композер
   *  (`inset-block: -page-chats-padding`), поэтому все позиции скролла
   *  `scrollToBubble` считает относительно ЭТОГО прямоугольника, а не
   *  контейнера. */
  bubblesViewport: HTMLElement
  /** адресат кликов по ссылкам/именам — аналог tweb `chat.appImManager` */
  navigation?: BubblesNavigation
  /**
   * Порт tweb `Chat.selection` (chat.ts:615 `new ChatSelection(this,
   * this.bubbles, this.input, this.managers)`) — режим выделения сообщений.
   *
   * ФАБРИКА, а не готовый объект, потому что связь двусторонняя: выделению
   * нужна лента (её баблы), а ленте — выделение (гейты кликов). В tweb узел
   * разрубает `Chat`, который держит обоих; у нас роль `Chat` исполняет хост
   * (`VanillaFeed`), и он отдаёт сюда СПОСОБ создать выделение — лента зовёт
   * его, передав себя. Так владельцем остаётся хост: это он знает про плашку
   * действий и попапы.
   */
  createSelection?(bubbles: SelectionBubbles): ChatSelection
  /**
   * Порт tweb `Chat.contextMenu` (chat.ts:614 `new ChatContextMenu(this,
   * this.managers)`, лента вешает его в `attachContainerListeners`,
   * bubbles.ts:1478) — контекстное меню сообщения.
   *
   * ФАБРИКА по той же причине, что `createSelection`: связь двусторонняя —
   * меню читает у ленты живой режим выделения (`ContextMenuBubbles.selection`),
   * а лента отдаёт меню свой контейнер. Узел разрубает тот, кто держит обоих:
   * в tweb `Chat`, у нас хост (`VanillaFeed`). Он же владелец попапов, которые
   * открывают пункты, — поэтому собрать меню может только он.
   */
  createContextMenu?(bubbles: ContextMenuBubbles): ChatContextMenu
  /**
   * Порт tweb `chat.autoDownload` (chat.ts:137) — пороги автозагрузки медиа
   * ОТКРЫТОГО чата: `{photo, video, file}` в байтах, 0 = «не качать само,
   * только по клику». Лента их не считает, а раздаёт врапперам ровно там же,
   * где оригинал (bubbles.ts:7901 альбом, :7919 фото, :8542/:8561 видео и
   * кружок, :8597 документ) — считает их роль `Chat` (chat.ts:1055
   * `useAutoDownloadSettings`), у нас `Chat.tsx`.
   *
   * ФУНКЦИЯ, а не значение, по той же причине, что `canSend`: у оригинала это
   * поле, которое `createEffect` держит свежим на смену настроек, то есть
   * чтение всегда живое. Не передана — врапперы качают всё (у tweb это
   * `autoDownload: undefined` → `noAutoDownload = autoDownloadSize === 0`
   * не взводится).
   */
  autoDownload?(): ChatAutoDownload | undefined
  /** Порт tweb `chat.canSend()` (chat.ts, без аргумента — действие
   *  `send_messages`): гейт СВАЙП-ответа (bubbles.ts:1548). Асинхронный, как в
   *  оригинале. Не передан — жест не начинается вовсе. */
  canSend?(): boolean | Promise<boolean>
  /** Порт tweb `chat.input.canSendPlain()` — гейт ДАБЛКЛИК-ответа
   *  (bubbles.ts:1503). У оригинала это отдельное право (`send_plain`), не то
   *  же самое, что `canSend()`: в чате можно быть вправе слать медиа, но не
   *  текст. Не передан — даблклик ничего не делает. */
  canSendPlain?(): boolean
  /** Порт tweb `chat.input.initMessageReply(chat.input
   *  .getChatInputReplyToFromMessage(message))` (bubbles.ts:1539, :1699) — вход
   *  в reply-флоу композера. Композер — окружение `Chat`, которого у ленты
   *  нет, поэтому сюда едет только номер: собрать по нему плашку умеет
   *  владелец композера (`Chat.tsx` через `draftReplyState`). */
  initMessageReply?(mid: number): void
  /**
   * ОТПРАВИТЬ СТИКЕР — порт клика по стикеру-приветствию пустого чата
   * (tweb bubbles.ts:10586-10589: `attachClickEvent(stickerDiv, … this.chat
   * .input.emoticonsDropdown.onMediaClick({target}, undefined, undefined,
   * true))`).
   *
   * Здесь, а не внутри ленты, ровно по адресу оригинала: отправкой владеет
   * КОМПОЗЕР (`chat.input`), которого у ленты нет. Хост отдаёт тот же путь,
   * которым стикер уходит из панели эмодзи (`Chat.tsx::onComposerPickSticker`).
   * Не передан — стикер приветствия просто не кликается.
   */
  sendSticker?(doc: MyDocument): void
  /**
   * Действия МЕДИАВЬЮВЕРА, которых у самой ленты быть не может: прыжок к
   * сообщению, пересылка, удаление и догрузка соседей за пределами окна.
   *
   * В tweb это роль `AppMediaViewer`, собранного вокруг `SearchListLoader` и
   * `appImManager` (`mediaViewer.ts`); у нас вьювер общий на весь клиент
   * (`components/mediaViewer/*`), а перечисленные четыре ручки знает окружение
   * чата — попапы пересылки/удаления, стек колонки и REST-пагинация
   * `/chats/{id}/media`. Поэтому их отдаёт хост, как и попапы контекстного
   * меню. Не переданы — вьювер открывается, листает загруженное и закрывается.
   */
  mediaViewerActions?: Pick<OpenMediaViewerArgs, 'jumpToMessage' | 'onForward' | 'onDelete' | 'loadMoreMedia'>
}

/** Срез менеджеров, которым пользуется лента (см. расхождения в шапке). */
export interface BubblesManagers extends PeerTitleManagers {
  messages: {
    getHistory(args: HistoryArgs): Promise<HistoryResult>
    /** Окно ВОКРУГ сообщения — вторая форма страницы, которой лента отвечает на
     *  `backLimit` (`requestHistory`, см. расхождение в его докблоке).
     *
     *  У tweb метод один: `appMessagesManager.getHistory` с полем `backLimit`,
     *  которое `processRequestHistoryOptions` (appMessagesManager.ts:9319-9322)
     *  разворачивает в арифметику MTProto — `addOffset = -backLimit`,
     *  `limit += backLimit`. Наш бэкенд этой арифметики не знает: отрицательный
     *  `add_offset` он читает только как знак «новее» (`chat_handler.go:496` →
     *  `GetHistory`), а окно вокруг номера отдаёт отдельным параметром
     *  (`?around=`, `chat_handler.go:480-489`). Поэтому вторая форма — второй
     *  метод, а не второе поле. */
    getAround(peerId: number, centerId: number, limit?: number, threadRoot?: number):
      Promise<{ messages: MyMessage[], reachedTop: boolean, reachedBottom: boolean }>
    /** Номер сообщения по дню — порт запроса `onDatePick`
     *  (tweb bubbles.ts:10207-10213: `requestHistory({offsetDate, limit: 2,
     *  addOffset: -1})` и `messages[0].mid` из ответа). У нас тот же вопрос
     *  задаётся ручкой `message_by_date`, поэтому ответ — сразу номер. */
    messageByDate(peerId: number, date: number): Promise<number | null>
    /** Порт `Chat.sendReaction` (tweb chat.ts:1457) в объёме тоггла: у
     *  оригинала это ОДИН метод, который сам решает, ставить или снимать; у
     *  нашего владельца операций две, потому что каждая несёт свою
     *  оптимистичную дельту и свой откат. Решение остаётся за лентой — она
     *  знает `is-chosen` кликнутого чипа.
     *
     *  Опциональны: без них лента рисует реакции, но не переключает их — так
     *  поднимается тест, которому реакции нужны только как разметка. */
    react?(peerId: number, msgId: number, emoji: string): Promise<void>
    unreact?(peerId: number, msgId: number, emoji: string): Promise<void>
    /**
     * ОТМЕНА ОТДАЧИ ФАЙЛА с бабла — единственный вызыватель ручки
     * `messages.cancelPending` (`core/managers/messages/pending.ts:748`).
     *
     * У tweb на этом месте не ручка менеджера, а `cancel()` самого промиса
     * аплоада: кольцо зовёт `this.promise?.cancel?.()` (preloader.ts:144-146),
     * промис рвёт отдачу, а `appMessagesManager` уже по его отказу зовёт
     * `cancelPendingMessage(random_id)` (appMessagesManager.ts:1486). У нас
     * байты отдаёт ВОРКЕР (`messages.sendFile`), реестра аплоадов по имени
     * файла (`appDownloadManager.getUpload`) на вкладке нет вовсе — поэтому
     * промис ленте приходится строить самой (`uploadPromiseFor`), а его
     * `cancel` ведёт в ту же самую точку оригинала одним вызовом: воркер и
     * рвёт отдачу, и выкидывает неотправленный бабл операцией `remove`.
     *
     * Опциональна по той же причине, что `react`/`unreact`: без неё лента
     * рисует кольцо отдачи, но крестик ничего не отменяет, — так поднимается
     * тест, которому аплоад не нужен.
     */
    cancelPending?(args: { clientMsgId: string }): Promise<unknown>
    /**
     * Страница истории, ОТФИЛЬТРОВАННАЯ по тегу-реакции «Избранного» — вторая
     * ветка `requestHistory` (см. её докблок).
     *
     * У tweb отдельного метода здесь нет: `savedReaction` — обычное поле
     * `RequestHistoryOptions`, из-за которого `requestHistory` подставляет
     * `inputFilter ??= inputMessagesFilterEmpty` и уходит методом
     * `messages.search` с полем `saved_reaction`
     * (appMessagesManager.ts:9947-9948, :9982). Наш бэкенд отвечает на тот же
     * вопрос отдельной ручкой (`GET /chats/{id}/search?reaction=`,
     * `chat_handler.go:896`), поэтому и метод отдельный.
     *
     * Опционален по той же причине, что `react`/`unreact`: без него панель
     * тегов не появляется вовсе (её показ гейтит `Chat.tsx`), а лента остаётся
     * нефильтрованной.
     */
    searchMessages?(peerId: number, q: string, opts: {
      reaction?: string, offset?: number, limit?: number,
    }): Promise<{ messages: MyMessage[], count: number }>
  }
  /**
   * Порт `appStickersManager.getGreetingSticker`
   * (appStickersManager.ts:135-163) — стикер-приветствие для плейсхолдера
   * пустого личного чата (`renderEmptyPlaceholder('greeting')`).
   *
   * У оригинала это `getStickersByEmoticon({emoticon: '👋⭐️',
   * includeServerStickers: true})` — служебная пара эмодзи, по которой сервер
   * Telegram отдаёт ИМЕННО набор приветствий. Наш `GET /stickers/search?emoji=`
   * ищет по эмодзи самого стикера (`stickers_handler.go:313`), поэтому пара
   * вырождается в одиночное `👋`.
   *
   * Опционален: без него карточка приветствия рисуется без стикера — ровно как
   * у оригинала, когда `getGreetingSticker` отказал (`NO_STICKERS`).
   */
  stickers?: {
    searchByEmoji(emoji: string): Promise<MyDocument[]>
  }
  /** Порт двух источников границы непрочитанных: `appMessagesManager
   *  .getReadMaxIdIfUnread` и `Chat.getHistoryMaxId` (tweb bubbles.ts:11570-11572).
   *  Владелец обоих фактов у нас — воркерный `dialogsManager` (запись диалога),
   *  ленте они приезжают RPC — как в tweb, где это тоже вызовы менеджера. */
  dialogs: {
    getReadMaxSeqIfUnread(chatId: number): Promise<number>
    getHistoryMaxSeq(chatId: number): Promise<number>
  }
  /** Порт `appMessagesManager.readHistory({peerId, maxId, threadId,
   *  monoforumThreadId})` — единственной ручки отметки прочтения, которую зовёт
   *  лента tweb (bubbles.ts:2978 из `readUnreaded`, :5752 из
   *  `onScrolledAllDown`).
   *
   *  Ручка НЕ НОВАЯ: это та же `realtime.markRead`
   *  (`core/realtime/realtime.ts:95`), которой чат отмечала снесённая
   *  React-лента. Второго пути отметки нет: у ручки ровно один вызыватель —
   *  этот.
   *
   *  Расхождения с оригиналом:
   *   • `upToId` вместо `maxId` — имя нашей ручки; номер КЛИЕНТСКИЙ, в
   *     серверный его переводит сама ручка (`getServerMessageId`, граница
   *     `core/history/messageId.ts`);
   *   • нет `threadId`/`monoforumThreadId`: горизонт чтения у нас один на чат
   *     (`connectionManager.markRead(peerId, upToSeq)`), отдельного горизонта
   *     треда владелец не держит;
   *   • нет `force` (tweb им обходит собственную проверку «уже прочитано»,
   *     :5757): у нашей ручки такой проверки нет вовсе — дедуп стоит ниже, по
   *     уже отправленному рубежу (`connectionManager.ts:178`). */
  realtime: {
    markRead(args: { peerId: number, upToId: number }): Promise<unknown>
  }
  /** Порт `appMessagesManager.incrementMessageViews(peerId, mids)` — РЕГИСТРАЦИЯ
   *  просмотра показавшихся постов (tweb bubbles.ts:2145 из
   *  `sendViewCountersDebounced`). Не опрос счётчика: он приезжает внутри самого
   *  сообщения.
   *
   *  Опционален по той же причине, что `messages.react`/`unreact` выше: без него
   *  лента рисует посты, но просмотров не регистрирует, — так поднимается тест,
   *  которому канал нужен только как разметка. */
  channels?: {
    registerViews(peerId: number, msgIds: number[]): Promise<void>
  }
  /** Каталог доступных реакций — единственный источник файлов иконки чипа
   *  (`center`/`static`) и эффекта вокруг него (`around`/`center`); у оригинала
   *  это `apiManagerProxy.getReaction` (reaction.ts:805, :1476). Опционален по
   *  той же причине, что `messages.react` и `channels` выше: без него лента
   *  рисует чипы текстовым эмодзи и не играет эффект. */
  reactions?: ReactionsManagers['reactions']
}

/** Порт tweb bubbles.ts:308. Ошибка, которой `BatchProcessor` отвергает пачку,
 *  когда поколение ленты умерло за время её обработки: для ждущего это не сбой,
 *  а «дальше не работаем». */
const PEER_CHANGED_ERROR = new Error('peer changed')

/** Единица очереди рендера — порт того, что `safeRenderMessage` возвращает в
 *  tweb (bubbles.ts:6307-6310: результат `renderMessage` + `updatePosition`).
 *  У нас состав бабла — текст, поэтому от результата остаются ровно сообщение и
 *  его узел; `updatePosition` (в tweb — «не трогать позицию», для баблов
 *  плейсхолдеров и sponsored) предмета не имеет. */
interface RenderedMessage {
  message: MyMessage
  bubble: HTMLElement
  /** Порт поля `reverse` единицы очереди (tweb bubbles.ts:6294): «сообщение
   *  дописывается НАД вьюпортом». Из него `processBatch` выводит направление
   *  якоря `ScrollSaver` для всей пачки. */
  reverse: boolean
  /** Порт поля `canAnimateLadder` единицы очереди (tweb bubbles.ts:6277,
   *  :6284): «этот бабл — часть страницы истории, а не точечная дорисовка».
   *  Взводит его один вызывающий — `performHistoryResult` (:10061); из него
   *  `processBatch` решает, дёргать ли лестницу (:5905). */
  canAnimateLadder?: boolean
}

// tweb bubbles.ts:307. Ближе этого к низу лента считается «прижатой» —
// и кнопка «вниз» гаснет, и новое сообщение доводится скроллом.
const SCROLLED_DOWN_THRESHOLD = 300

/** Вид плейсхолдера пустого чата — порт `EmptyPlaceholderType`
 *  (tweb bubbles.ts, объединение имён веток `renderEmptyPlaceholder`) в том
 *  объёме, у которого есть предмет; разбор пропущенных — у
 *  `checkIfEmptyPlaceholderNeeded`. */
type EmptyPlaceholderType = 'saved' | 'greeting' | 'noMessages'

/** Бокс стикера-приветствия — `_chatBubble.scss:4051-4058`
 *  (`.empty-bubble-placeholder-sticker { width: 200px; height: 200px }`). */
const GREETING_STICKER_SIZE = 200

// tweb bubbles.ts:310-312 — рубильники подрезки вьюпорта. Значения дословные:
// подрезка включена везде, кроме Safari (он не умеет вернуть скролл после
// удаления узлов сверху) — и там она выключена только на скролле.
const DO_NOT_SLICE_VIEWPORT = false
const DO_NOT_SLICE_VIEWPORT_ON_RENDER = false
const DO_NOT_SLICE_VIEWPORT_ON_SCROLL = IS_SAFARI

// Модификаторы бабла, которых на рендере ещё неоткуда взять: подсветка
// jump-to-message и граница непрочитанных (этап 5) и признаки канала.
//
// `firstInGroup`/`lastInGroup` здесь — СЕМЯ РЕНДЕРА, а не позиция в серии:
// из них `bubbleClasses` выводит `can-have-tail`, который tweb тоже ставит на
// рендере, независимо от места бабла в серии (хвост показывает CSS у
// `.is-group-last`). Сами `is-group-first`/`is-group-last` перевешивает
// владелец серий — `BubbleGroup.updateClassNames` (bubbleGroups.ts:297) на
// каждом монтировании группы.
const STUB_CTX: Omit<BubbleCtx, 'out' | 'showName'> = {
  firstInGroup: true,
  lastInGroup: true,
  isChannel: false,
  isHighlighted: false,
  isFirstUnread: false,
  bigEmojiCount: 0,
  animatedSticker: false,
}

export default class ChatBubbles implements BubbleGroupsHost {
  public container!: HTMLDivElement
  public chatInner!: HTMLDivElement
  public scrollable!: Scrollable
  public paddingTop!: HTMLDivElement
  public paddingBottom!: HTMLDivElement
  public remover!: HTMLDivElement
  public floatingSeparatorsContainer!: HTMLDivElement

  // Карта отрисованного — tweb bubbles.ts:530 (`{[fullMid]: HTMLElement}`).
  private bubbles: { [fullMid: string]: HTMLElement } = {}
  // Реестр секций дней — tweb bubbles.ts:534 (`dateMessages`). Из полей
  // оригинала держим ровно те, что нужны: узел секции и счётчик живущих в ней
  // серий (`DateContainer`, срез для групп). `div` (сам дата-бабл) и
  // `firstTimestamp` там нужны sticky-датам и наблюдателю — их ещё нет.
  private dateMessages: { [dateTimestamp: number]: DateContainer } = {}
  // Владелец серий — tweb bubbles.ts:536 (`new BubbleGroups(this.chat)`; там
  // группы лезут в ленту через `chat.bubbles`, у нас хост — сама лента).
  private bubbleGroups = new BubbleGroups(this)

  // Очередь рендера — tweb bubbles.ts:657/747. Всё, что отрисовано за один ход,
  // группируется и монтируется ОДНОЙ пачкой; `messagesQueuePromise` — точка, на
  // которую опирается всё, что обязано дождаться отрисовки (обработчик
  // `history_update`, а дальше — компенсация скролла).
  private batchProcessor: BatchProcessor<RenderedMessage | undefined>
  // tweb bubbles.ts:651. Рендер нового сообщения асинхронен (ждёт свою пачку),
  // и ждущий обязан дождаться сначала ЕГО, а потом уже очереди: иначе бабл
  // ещё не попал в очередь, и ожидание очереди ничего не даст (bubbles.ts:780-783).
  private renderNewPromises: Set<Promise<void>> = new Set()

  /**
   * «Следующая прокрутка обязана сдвинуть градиент обоев» — порт tweb
   * bubbles.ts:652. Флаг взводит отправка своего сообщения
   * (`history_append`, :1859-1864), а тратит его ПЕРВАЯ же прокрутка к баблу
   * (`scrollToBubble` → `startCallback`, :4710-4714). Разнесено на два места
   * именно так и в оригинале: градиент едет ровно на длину прокрутки, а не
   * сам по себе, и знать эту длину может только тот, кто прокручивает.
   */
  private updateGradient?: boolean

  // tweb bubbles.ts:492-493 — «страница этой стороны уже в полёте». Он же гейт
  // повторного триггера пагинации (`loadMoreHistory`).
  private getHistoryTopPromise?: Promise<unknown>
  private getHistoryBottomPromise?: Promise<unknown>

  // tweb bubbles.ts:544-547.
  private scrolledDown = true
  private isScrollingTimeout = 0
  private stickyIntersector?: StickyIntersector
  /** Последние распорки, выданные окружением (`setPaddings`). Хранятся, потому
   *  что `StickyIntersector` заводится заново на каждый `setPeer`, а его
   *  `rootMargin` — та же величина. */
  private paddings = { top: 0, bottom: 0 }
  // tweb bubbles.ts:559 (`previousStickyDate`) — какой дата-пилюле сейчас
  // принадлежит `is-sticky`.
  private previousStickyDate?: HTMLElement
  // tweb bubbles.ts:620.
  private sliceViewportDebounced?: DebounceReturnType<ChatBubbles['sliceViewport']>
  // tweb bubbles.ts:586 — пока играет тяжёлая анимация, лента не подрезает
  // вьюпорт, не грузит страницы и не пересчитывает «прижат к низу».
  private isHeavyAnimationInProgress = false
  // tweb bubbles.ts:589 — бабл, к которому сейчас едет скролл.
  private scrollingToBubble?: HTMLElement
  // tweb bubbles.ts:597-598 — граница непрочитанных ставится один раз за окно.
  private firstUnreadBubble?: HTMLElement
  private attachedUnreadBubble = false

  // ─── пересечения ленты (tweb bubbles.ts:2127) ─────────────────────────────
  // ОДИН наблюдатель на все вопросы «что сейчас видно», как в оригинале:
  // `new SuperIntersectionObserver({root: this.scrollable.container})`
  // раздаёт свои записи восьми колбэкам ленты (непрочитанные, непрочитанное
  // содержимое, просмотры, метрики чтения, эффекты стикера и сообщения,
  // подсказка guest-chat). У нас колбэка ДВА — непрочитанные
  // (`unreadedObserverCallback`) и просмотры поста (`viewsObserverCallback`);
  // остальные шесть приедут вместе со своими подсистемами. Прежде здесь стоял
  // голый `IntersectionObserver` с единственным колбэком — «мультиплексор без
  // второго клиента»; клиент появился (просмотры), и второй наблюдатель рядом
  // был бы не портом, а нашей развилкой: у оригинала вопрос «что сейчас видно»
  // задаёт РОВНО ОДИН объект, и снятие наблюдения адресуется КОЛБЭКУ, а не
  // узлу (tweb :4314-4329 снимает семь колбэков с одного бабла по одному).
  private observer?: SuperIntersectionObserver
  // tweb :551/553. Карта «наблюдаемый узел → номер, до которого он читает» и
  // набор УВИДЕННЫХ номеров, ждущих отправки.
  private unreaded = new Map<HTMLElement, number>()
  private unreadedSeen = new Set<number>()
  // tweb :561 — «отметка уже летит»; пока летит, вторую не начинаем. У
  // оригинала поле объявлено `Promise<void>`, у нас — `unknown`: ответ нашей
  // ручки не пустой (`{ok: true}`), а гасить его лишним `.then(noop)` значило
  // бы завести строку ради типа.
  private readPromise?: Promise<unknown>
  // ─── просмотры поста канала (tweb bubbles.ts:601-602) ─────────────────────
  // Номера постов, которые ПОКАЗАЛИСЬ и ещё не зарегистрированы, и дебаунс
  // регистрации. У оригинала в наборе `FullMid` (пир + номер), потому что его
  // лента умеет режим `GLOBAL_MIDS`; у нас окно всегда одного пира — см.
  // сборку дебаунса в `setScroll`.
  private viewsMids = new Set<number>()
  private sendViewCountersDebounced?: DebounceReturnType<() => void>
  /**
   * Горизонт прочтения окна — порт tweb `getRenderReadMaxId`
   * (bubbles.ts:664-669, `memoizeAsyncWithTTL(getReadMaxIdIfUnread, …, 0)`).
   *
   * У оригинала это ЗАПРОС НА КАЖДЫЙ бабл, склеенный мемоизацией на один
   * проход рендера; наш `renderMessage` синхронен (см. `renderMedia`), поэтому
   * горизонт снимается СНИМКОМ в `setPeer` — там он и так спрашивается тем же
   * RPC, что `getHistoryMaxSeq`. Снимок устаревает только В СТОРОНУ БОЛЬШЕГО
   * числа наблюдаемых баблов (горизонт двигается вперёд), то есть даёт лишнюю
   * отметку, а не пропущенную.
   */
  private renderReadMaxSeq = 0
  // tweb bubbles.ts:604 — «лента короче вьюпорта, поэтому ей подставлена
  // верхняя распорка».
  private isTopPaddingSet = false
  // tweb bubbles.ts:649 — поколение окна. Каждый `setPeer` взводит своё, и
  // единственный смысл поля — middleware «моя ли ещё лента»: всё, что летело в
  // прошлое окно, отвергается `PEER_CHANGED_ERROR`.
  private setPeerTempId = 0
  // tweb bubbles.ts:622 — «этот `setPeer` сам уведёт скролл». Читает поле
  // `onRenderScrollSet`: когда скролл всё равно поедет, липкие даты можно
  // включать сразу, без задержки в 600мс (bubbles.ts:10192).
  private willScrollOnLoad?: boolean

  // ─── фильтр «Избранного» по тегу-реакции (tweb chat.ts:98 `savedReaction`) ──
  /**
   * Активный тег-реакция «Избранного» — порт поля `Chat.savedReaction`
   * (chat.ts:98) в нашей адресации реакции (эмодзи-строка вместо конструктора
   * `Reaction`; у оригинала поле — ВЕКТОР, потому что MTProto принимает
   * несколько тегов сразу, а наша ручка — один).
   *
   * Это ОДИН ИЗ КЛЮЧЕЙ ПОИСКА (tweb `CHAT_SEARCH_KEYS`, chat.ts:73-74), а не
   * фильтр по отрисованному: смена ключа перезапрашивает историю с нуля
   * (`setPeer` с `sameSearch: false`), пагинация идёт по ОТФИЛЬТРОВАННОМУ
   * набору, а новое входящее проверяется на тег перед отрисовкой
   * (`_renderNewMessage`, tweb :4559-4568). Снятие фильтра — тот же путь с
   * `undefined`.
   *
   * Прежняя React-лента фильтровала УЖЕ ЗАГРУЖЕННОЕ окно (`feedMsgs` в
   * `Chat.tsx`) — то есть показывала не «все сообщения с этим тегом», а «те из
   * последних сорока, у которых он есть». Это была наша выдумка, а не порт.
   */
  private savedReaction?: string
  /**
   * Сколько отфильтрованных сообщений уже забрано — смещение следующей
   * страницы фильтра.
   *
   * РАСХОЖДЕНИЕ С ОРИГИНАЛОМ, И ОНО НАВЯЗАНО РУЧКОЙ. tweb листает
   * отфильтрованную историю тем же `offset_id`, что и обычную
   * (`messages.search` принимает `offset_id`/`add_offset`,
   * appMessagesManager.ts:9970-9984), поэтому отдельного счётчика ему не нужно.
   * Наш `GET /chats/{id}/search` принимает только `offset`/`limit`
   * (`chat_handler.go:890-891` → `messagesrepo.go:186` `LIMIT $n OFFSET $n`),
   * то есть ПОРЯДКОВЫЙ номер в выдаче, — его и приходится вести самому.
   * Сбрасывается вместе с окном (`cleanup`).
   */
  private savedReactionOffset = 0

  /** Порт tweb bubbles.ts:599 — бабл-плейсхолдер пустого чата, если он сейчас
   *  показан. Он же гейт «второй раз не рисуем»
   *  (`checkIfEmptyPlaceholderNeeded`, :11305). */
  private emptyPlaceholderBubble?: HTMLElement

  // ─── первое открытие чата (tweb bubbles.ts:566, :587, :598, :569) ─────────
  /**
   * Спиннер ПЕРВОЙ загрузки — порт tweb bubbles.ts:752-754 (`new
   * ProgressivePreloader({cancelable: false})`). Один на всю жизнь ленты, как
   * в оригинале.
   *
   * Он не про «грузится ещё одна страница»: вешается РОВНО в одной точке —
   * `setPeer`, ветка «пир сменился И страница не из кэша» (:5378-5379), —
   * и снимается, едва окно смонтировано (:5393). Пагинация к нему не
   * обращается вовсе: там прежнее окно на экране, и накрывать его спиннером
   * нечего.
   */
  private preloader: ProgressivePreloader
  // tweb bubbles.ts:587 — «эта лента ещё ни одной страницы не отрисовала».
  // Взводится сменой пира (:5237), гасится первым же запросом истории (:11479):
  // из него `getHistory` выводит `isFirstMessageRender` — единственный гейт
  // лестницы.
  private isFirstLoad = true
  // tweb bubbles.ts:569 — «когда пачка домонтируется, запусти лестницу».
  // Ставит его `getHistory` (:11543), зовут оба места, где пачка доехала:
  // очередь рендера (:5905) и `performHistoryResult` (:10159).
  private messagesQueueOnRenderAdditional?: () => void
  // tweb bubbles.ts:598 — отложенная лестница. Лестница, вызванная ВНУТРИ
  // `setPeer` (окно ещё собирается в оторванном узле), сохраняет себя сюда, а
  // выполняется, когда `setPeer` домонтировал дерево (:5395-5397).
  private resolveLadderAnimation?: () => Promise<unknown> | undefined
  /**
   * Порт `Chat.setPeerPromise` (tweb chat.ts:108; ставится на :1124 и гасится
   * на :1127-1128) — «прямо сейчас идёт смена окна». Читает его РОВНО одно
   * место — `animateAsLadder` (:10318), чтобы отложить каскад до монтирования.
   *
   * В оригинале поле живёт на `Chat`, потому что `Chat.setPeer` — обёртка
   * вокруг `bubbles.setPeer` и промис у неё под рукой ДО того, как лента уйдёт
   * в запрос. У нас роль `Chat` исполняет хост (`VanillaFeed`), но факт
   * «идёт смена окна» целиком выводится внутри ленты, а хосту он не нужен, —
   * поэтому поле здесь, а промис отложенный: свой собственный возвращаемый
   * промис асинхронный метод назвать не может.
   */
  private setPeerPromise?: CancellablePromise<void>
  // Отписка от шины тяжёлых анимаций (в tweb её снимает `listenerSetter`,
  // которому `useHeavyAnimationCheck` передан третьим аргументом).
  private removeHeavyAnimationListener?: () => void

  /** Порт tweb `this.chat.selection` — им лента гейтит клики и жесты.
   *  Живёт здесь, а не в `ChatContext`, потому что создаётся уже с готовой
   *  лентой (см. `createSelection`). */
  public selection?: ChatSelection

  /** Порт tweb `this.chat.contextMenu` (bubbles.ts:1478). Живёт здесь, а не в
   *  `ChatContext`, по той же причине, что `selection`: создаётся уже с готовой
   *  лентой (см. `createContextMenu`). */
  private contextMenu?: ChatContextMenu

  /** Порт поля tweb `this.replySwipeHandler` (bubbles.ts:1543) — слушатели
   *  жеста висят на контейнере и снимаются на `destroy`. */
  private replySwipeHandler?: { removeListeners(): void }

  /**
   * Живые отдачи файлов этой ленты: `clientMsgId` → промис, которым кормится
   * кольцо прогресса на неотправленном бабле.
   *
   * Роль реестра в оригинале играет `appDownloadManager.getUpload(
   * uploadingFileName)` (tweb wrappers/photo.ts:238-239, video.ts:503-508):
   * враппер спрашивает по ИМЕНИ ФАЙЛА промис отдачи, который завёл
   * `appMessagesManager.sendFile`. У нас отдачей владеет воркер, вкладке
   * приезжает только поток прогресса (`media:upload_progress`), — поэтому
   * промис ей приходится строить самой, а ключ реестра — тот же
   * `clientMsgId`, которым адресован и сам кадр прогресса, и ручка отмены.
   */
  private uploads = new Map<string, CancellablePromise<unknown>>()

  private listenerSetter = new ListenerSetter()
  public middlewareHelper = getMiddleware()

  constructor(private chat: ChatContext, private managers: BubblesManagers) {
    this.constructBubbles()
    // Порядок как в tweb (bubbles.ts:743-751): очередь заводится сразу после
    // построения дерева и ДО подписок — первая же из них может в неё положить.
    this.batchProcessor = new BatchProcessor({
      process: this.processBatch,
      possibleError: PEER_CHANGED_ERROR,
    })
    // tweb bubbles.ts:752-754 — ровно там же, сразу за очередью. `cancelable:
    // false`: у спиннера первой загрузки нет ни крестика отмены, ни ретрая —
    // отменять нечего, окно всё равно соберётся.
    this.preloader = new ProgressivePreloader({
      cancelable: false,
    })
    this.constructPeerHelpers()
    this.attachContainerListeners()
  }

  /** Порт tweb bubbles.ts:2190. */
  public get messagesQueuePromise(): Promise<void> | undefined {
    return this.batchProcessor.queuePromise
  }

  public get peerId() {
    return this.chat.peerId
  }

  /** Порт `chat.isMegagroup` (chat.ts:141) для групп: в tweb `canItemsBeGrouped`
   *  спрашивает вид чата через `this.chat.isOutMessage` (bubbleGroups.ts:583),
   *  у нас хост групп — сама лента, и она пробрасывает то же знание дальше. */
  public get isMegagroup(): boolean {
    return !!this.chat.isMegagroup
  }

  /** Срез чата для обоих предикатов стороны — то, что в tweb лежит на самом
   *  `Chat`/`rootScope`, а у нас приезжает сюда (`ChatContext`) и берётся из шины. */
  private get ourChat(): OurMessageChat {
    return { myId: rootScope.myId, isMegagroup: this.chat.isMegagroup }
  }

  /** Порт `Chat.isOurMessage` (chat.ts:1374) — «моё ли это сообщение».
   *  СТОРОНУ бабла решает не он, а `isOutMessage` (см. ниже). */
  public isOurMessage(message: MyMessage): boolean {
    return isOurMessage(message, this.ourChat)
  }

  /** Порт `Chat.isOutMessage` (chat.ts:1392) — СТОРОНА бабла (bubbles.ts:7613).
   *  Отличается от `isOurMessage` ровно самопересылкой в «Избранное». */
  public isOutMessage(message: MyMessage): boolean {
    return isOutMessage(message, this.ourChat)
  }

  /** Порт чтения `this.chat.autoDownload` (tweb bubbles.ts:7901 и соседи) —
   *  живое, на каждый рендер медиа: настройка могла смениться, пока чат открыт. */
  private get autoDownload(): ChatAutoDownload | undefined {
    return this.chat.autoDownload?.()
  }

  /**
   * Порт `forEach` из tweb `ChatBubbles.finishPeerChange` (bubbles.ts:5787-5792,
   * зовётся `Chat.finishPeerChange` → `this.bubbles.finishPeerChange()`, chat.ts:1203):
   * `[this.chatInner, this.remover].forEach(el => { el.classList.toggle('is-chat',
   * isLikeGroup); ...; el.classList.toggle('is-broadcast', isBroadcast) })`.
   *
   * Без `is-chat` не срабатывает правило `styles/tweb/_chat.scss:1311-1316`
   * (`margin-inline-start: 2.875rem` на `.bubble-content-wrapper`) — аватарная
   * колонка (`.bubbles-group-avatar-container`, `position: absolute`, вне
   * потока) ложится поверх бабла, а с ней и реакции.
   *
   * ОБА узла — как в оригинале, одним forEach: `remover` создаётся только
   * здесь и никогда не пересоздаётся, поэтому забыть его — рассинхронить
   * анимацию удаления бабла (`.bubbles-remover`) с самой лентой.
   *
   * `isLikeGroup`/`isBroadcast` читаются с `this.chat` — как в оригинале
   * `Chat.isLikeGroup`/`Chat.isBroadcast` (chat.ts:145, appPeersManager).
   * Оба поля на `ChatContext` неизменны на весь срок жизни инстанса ленты
   * (хост, `VanillaFeed.tsx`, пересоздаёт `ChatBubbles` целиком при их смене).
   *
   * ВЫЧЕТЫ (два соседних тумблера того же forEach — предмета нет):
   *  - `no-messages` — нужен асинхронный `Chat.hasMessages()` (chat.ts),
   *    которого у ленты нет;
   *  - `with-message-avatars` — гейтит `isVerificationBot(peerId)`, а ботов-
   *    верификаторов в нашей модели не существует вовсе.
   */
  private applyChatTypeClasses(element: HTMLElement) {
    element.classList.toggle('is-chat', !!this.chat.isLikeGroup)
    element.classList.toggle('is-broadcast', !!this.chat.isBroadcast)
  }

  // Порт tweb bubbles.ts:1439-1458 — дерево дословно.
  private constructBubbles() {
    const container = this.container = document.createElement('div')
    container.classList.add('bubbles', 'scrolled-down')

    const chatInner = this.chatInner = document.createElement('div')
    chatInner.classList.add('bubbles-inner')
    this.applyChatTypeClasses(chatInner)

    const removerContainer = document.createElement('div')
    removerContainer.classList.add('bubbles-remover-container')
    const remover = this.remover = document.createElement('div')
    remover.classList.add('bubbles-remover', 'bubbles-inner')
    this.applyChatTypeClasses(remover)
    removerContainer.append(remover)

    const floatingSeparatorsContainer = this.floatingSeparatorsContainer = document.createElement('div')
    floatingSeparatorsContainer.classList.add('bubbles-floating-separators-container')

    this.setScroll()

    container.append(removerContainer, this.scrollable.container, floatingSeparatorsContainer)
  }

  // Порт tweb bubbles.ts:4169-4187. Высоты распорок в tweb приезжают из
  // `chat.chatPaddingTop/Bottom` (плейты топбара и высота композера) — этого
  // окружения у ленты на этапе 2 нет, поэтому узлы создаются без высоты.
  /**
   * Порт «ленточной» половины tweb `Chat.recomputePaddings` (chat.ts:345-365):
   * высоты распорок `.bubbles-padding-top/-bottom` и `rootMargin` наблюдателя
   * липких дат. САМИ ЧИСЛА считает окружение — в оригинале это `Chat`, у нас
   * `Chat.tsx` (там же, где `--pinned-floating-height` и излишек композера):
   * лента не знает ни про топбар, ни про плейты, ни про высоту композера.
   */
  public setPaddings(top: number, bottom: number) {
    this.paddings = { top, bottom }
    this.paddingTop.style.height = `${top}px`
    this.paddingBottom.style.height = `${bottom}px`
    this.applyStickyRootMargin()
  }

  /** tweb `updateStickyIntersectorRootMargin` (зовётся из `recomputePaddings`):
   *  дата «прилипает» под шапкой, а не под верхней кромкой скролл-контейнера. */
  private applyStickyRootMargin() {
    this.stickyIntersector?.setRootMargin(`-${this.paddings.top}px 0px -${this.paddings.bottom}px 0px`)
  }

  public setScroll() {
    if (this.scrollable) {
      this.destroyScrollable()
    }

    this.scrollable = new Scrollable(undefined, 'IM', 300)
    this.scrollable.container.classList.add('bubbles-scrollable')
    this.setLoaded('top', false)
    this.setLoaded('bottom', false)

    this.paddingTop = document.createElement('div')
    this.paddingTop.classList.add('bubbles-padding', 'bubbles-padding-top')

    this.paddingBottom = document.createElement('div')
    this.paddingBottom.classList.add('bubbles-padding', 'bubbles-padding-bottom')

    this.scrollable.container.append(this.paddingTop, this.chatInner, this.paddingBottom)

    // tweb bubbles.ts:4199-4202. Именно эти три строки делают ленту участником
    // скролла: троттлящийся `onScroll` Scrollable дёргает наш `onScroll`, а
    // `checkForTriggers` — пагинацию с обеих сторон.
    this.scrollable.onAdditionalScroll = this.onScroll
    this.scrollable.onScrolledTop = () => this.loadMoreHistory(true)
    this.scrollable.onScrolledBottom = () => this.loadMoreHistory(false)

    // Ветка `IS_TOUCH_SUPPORTED && false` (tweb :4208-4230) не портирована:
    // условие в оригинале константно ложно — это выключенный автором черновик
    // тач-жестов, а не механизм.
  }

  /** Порт tweb `setLoaded` (bubbles.ts:11055) в применимом объёме. `onScroll()`
   *  сразу после записи — помечен в оригинале `// ! WARNING`: взведённый край
   *  меняет ответ на вопрос «прижат ли низ», и пересчитать это надо ДО того,
   *  как пользователь тронет колесо.
   *
   *  Из `checkPlaceholders`-веток портирована одна — `checkIfEmptyPlaceholderNeeded`
   *  (:11096): это ЕДИНСТВЕННОЕ место оригинала, где плейсхолдер пустого чата
   *  появляется на открытии, и логично так: пусто — это «оба края сведены, а
   *  баблов нет», а края взводит именно этот метод. Остальные
   *  (`setPeerLanguageLoaded`, sponsored, плейсхолдеры бота, botforum-темы и
   *  неизвестного пользователя) не портированы — ни одной из этих подсистем у
   *  ленты нет; вместе с ними отпадает и сам параметр `checkPlaceholders`,
   *  которым оригинал гасит ВСЮ пачку разом. */
  private setLoaded(side: SliceSides, value: boolean) {
    const willChange = this.scrollable.loadedAll[side] !== value
    if(!willChange) {
      return
    }

    this.scrollable.loadedAll[side] = value
    this.scrollable.onScroll() // ! WARNING

    void this.checkIfEmptyPlaceholderNeeded()
  }

  private destroyScrollable() {
    this.scrollable.destroy()
  }

  /** Порт tweb bubbles.ts:6167 — адрес либо парой (peerId, mid), либо готовым
   *  fullMid. */
  public getBubble(peerId: number | string, mid?: number): HTMLElement | undefined {
    let fullMid: string
    if (mid) {
      fullMid = makeFullMid(peerId as number, mid)
    } else {
      fullMid = peerId as string
    }

    return this.bubbles[fullMid]
  }

  /** Синхронное чтение сообщения окна — аналог tweb `chat.getMessage(mid)`
   *  (там за ним стоит `apiManagerProxy`, у нас — зеркало). */
  private getMessage(mid: number): MyMessage | undefined {
    return mirrorWindow(this.chat.messagesStorageKey)?.find((m) => m.id === mid)
  }

  /**
   * Сообщения одной группы `grouped_id` по возрастанию номера — порт
   * `appMessagesManager.getMessagesByGroupedId` (:4909-4913).
   *
   * У оригинала группа лежит отдельным хранилищем (`groupedMessagesStorage`),
   * у нас источник один — окно зеркала. Разница только в месте хранения:
   * порядок тот же (`asc`), и на нём стоит выбор главного сообщения.
   */
  private groupedMessages(groupedId: number): MyMessage[] {
    const window = mirrorWindow(this.chat.messagesStorageKey)
    if (!window) return []
    return window
      .filter((m) => m._ === 'message' && m.grouped_id === groupedId)
      .sort((a, b) => a.id - b.id)
  }

  /**
   * Главное сообщение группы — порт `getMainGroupedMessage`: ПЕРВОЕ по
   * возрастанию номера. Именно оно получает бабл, остальные не рисуются вовсе
   * (tweb bubbles.ts:6600-6605).
   */
  private mainGroupedMessage(message: MyMessage): MyMessage | undefined {
    const groupedId = message._ === 'message' ? message.grouped_id : undefined
    if (!groupedId) return undefined
    return this.groupedMessages(groupedId)[0]
  }

  private classesFor(message: MyMessage): string[] {
    // `out` — поле самого сообщения (порт tweb `pFlags.out`), его выводит
    // владелец в воркере; лента только читает. `rootScope.myId` (порт tweb
    // rootScope.ts:253) нужен messageToConvMsg лишь для автора превью ответа
    // («Вы» vs имя собеседника) — 1:1 с оригиналом, где лента берёт свой id
    // оттуда же (bubbles.ts:740, 813, 928).
    const conv = messageToConvMsg(message as MyMessage, rootScope.myId, { isMegagroup: this.chat.isMegagroup })
    // tweb bubbles.ts:7613 → :9669 — сторона бабла это `isOutMessage`,
    // а не `isOurMessage`: пересылка в «Избранное» рисуется СЛЕВА.
    return bubbleClasses(conv, { ...STUB_CTX, out: this.isOutMessage(message), showName: this.needName(message) })
  }

  /**
   * Порт tweb `needName` (bubbles.ts:9325-9335) — единственное условие показа
   * имени автора в бабле.
   *
   *   needName = ((iPostedAsSomeoneElse || !isOut) && chat.isLikeGroup)
   *              || viaBotId || storyFromPeerId || guestChatViaFromId
   *              || (showNameForVerificationCodes && !replyTo)
   *
   * Из пяти слагаемых применимо первое; у остальных нет предмета: `via @bot`,
   * репост истории, guest-chat и сообщения бота-верификатора в нашей модели
   * сообщения отсутствуют как понятия (не «не сделано», а нечего проверять).
   *
   * `iPostedAsSomeoneElse` (tweb :9325 — `message.fromId !== rootScope.myId`)
   * держит send-as: пост от имени канала/группы подписывается именем ДАЖЕ у
   * своего сообщения. Наш `fromId` считает `bubbleGroups.getMessageFromId` —
   * тот же ключ автора, по которому бьются серии (у send-as это знаковый ключ
   * личности прямо с провода, как `fromId` в самом tweb).
   *
   * ПЕРВОЕ СООБЩЕНИЕ СЕРИИ здесь НЕ проверяется — и это тоже 1:1 с tweb: узел
   * имени рисуется у КАЖДОГО бабла серии, а прячет его у всех, кроме первого,
   * CSS (`_chatBubble.scss:663-670`: `&:not(.forwarded):not(.must-have-name)
   * &:not(.is-group-first) .name { display: none }`). Иначе слияние/разрыв
   * серии требовал бы пересборки узлов, а не одного класса.
   */
  private needName(message: MyMessage): boolean {
    const iPostedAsSomeoneElse = this.bubbleGroups.getMessageFromId(message) !== rootScope.myId
    // tweb :9331 берёт здесь `isOut` (сторону бабла), а не `our`
    return (iPostedAsSomeoneElse || !this.isOutMessage(message)) && !!this.chat.isLikeGroup
  }

  /** Порт tweb `createTitle` (bubbles.ts:9984). Цвет пира
   *  (`getPeerColorIndexByPeer` → `peer-N-color-rgb`) и значок премиума не
   *  портированы: палитры пиров и премиум-статусов в нашей модели нет — сам
   *  класс `colored-name` при этом ставится, его CSS берёт цвет от
   *  `data-peer-id` бабла. */
  private createTitle(fromId: number): PeerTitle {
    return new PeerTitle({
      peerId: fromId,
      // send-as: карточки у чат-личности нет (владелец знает только
      // пользователей), а её заголовок приезжает прямо в сообщении — это ровно
      // случай `fromName` в оригинале (peerTitle.ts:105-113).
      // send-as: автором на проводе стоит сам канал (`from_id`), и его имя
      // берётся из карточки пира — снимка `send_as.title` рядом больше нет.
      fromName: undefined,
      middleware: this.getMiddleware(),
      managers: this.managers,
    })
  }

  /**
   * ОТДАЧА ФАЙЛА ЭТОГО БАББЛА — промис, которым враппер кормит кольцо
   * прогресса и по которому крестик отменяет отправку.
   *
   * Порт связки tweb `uploadingFileName` → `appDownloadManager.getUpload(
   * uploadingFileName)` (wrappers/photo.ts:229-239, video.ts:503-508,
   * album.ts:97): бабл отвечает на вопрос «этот файл сейчас отдаётся?» и, если
   * да, отдаёт врапперу ОТМЕНЯЕМЫЙ промис. Дальше всё поведение уже в
   * портированных врапперах: `new ProgressivePreloader({isUpload: true})` +
   * `attachPromise` — то есть кольцо с КРЕСТИКОМ (`preloader-close`,
   * preloader.ts:108-124), клик по которому идёт в `onClick` (:148-158) и, раз
   * кольцо не `manual`, зовёт `promise.cancel()`.
   *
   * УСЛОВИЕ ДОСТУПНОСТИ. У оригинала это НАЛИЧИЕ `message.uploadingFileName` —
   * поля, которое `sendFile` держит ровно пока идёт отдача. У нас того же
   * смысла поля нет: отдачей владеет воркер. Тот же факт выражается парой
   * признаков неотправленного бабла — ДРОБНЫЙ номер (`isLocalMessageId`:
   * серверного ещё нет) и `random_id` (тот самый `clientMsgId`, которым
   * адресуются и кадр прогресса, и ручка отмены). Упавшая отправка (`failed`)
   * исключена: отдавать там уже нечего, кольцо было бы вечным.
   *
   * Промис ОДИН НА СООБЩЕНИЕ, а не на вызов: у альбома вложение каждого
   * элемента спрашивает его отдельно, но отдача у сообщения одна.
   */
  private uploadPromiseFor(message: MyMessage): CancellablePromise<unknown> | undefined {
    if (message._ !== 'message' || message.failed) return undefined
    const clientMsgId = message.random_id
    if (!clientMsgId || !isLocalMessageId(message.id)) return undefined

    const existing = this.uploads.get(clientMsgId)
    if (existing) return existing

    const promise = deferredPromise<unknown>()
    // Ручка ОДНА и делает всё, что у оригинала делают две (рвёт отдачу и
    // выкидывает бабл), — см. докблок `BubblesManagers.messages.cancelPending`.
    // Кольцо она гасит не сама: воркер отвечает кадром `done`, который
    // разрешает этот же промис.
    promise.cancel = () => {
      void this.managers.messages.cancelPending?.({ clientMsgId }).catch(noop)
    }
    this.uploads.set(clientMsgId, promise)
    return promise
  }

  /**
   * Медиа-ветка бабла — порт медиа-switch tweb (bubbles.ts:7878-7935 для фото).
   *
   * Здесь и только здесь создаётся `attachmentDiv` (:7874-7875) и вставляется
   * ПЕРЕД телом сообщения (:9247-9268), а классы стыка (`no-brb` у вложения,
   * `mt-shorter` у текста) обнуляют радиусы там, где вложение и подпись
   * срастаются в один блок.
   *
   * ПОЧЕМУ РЕЗУЛЬТАТ ВРАППЕРА НЕ ЖДЁТСЯ. У оригинала `renderMessage`
   * асинхронен, и `loadPromises` копятся, чтобы пачка баблов показалась уже с
   * готовыми превью. У нас этого ожидания нет по причине, названной в
   * `processBatch`: очередь не ждёт промисы единицы. Вставленный контейнер
   * враппер наполняет сам, как и в tweb, — он владеет своим узлом; поэтому
   * ветка синхронна, а ошибка загрузки гасится (превью просто не появится,
   * бабл с текстом останется целым).
   *
   * Портированы ветки ФОТО (:7878-7935) и ВИДЕО/GIF/КРУЖКА (:8511-8587).
   * Альбом, стикер, документы и голосовые приезжают следующими срезами: у
   * каждого свой набор классов бабла и свой враппер, и валить их в один заход
   * значило бы отдать непроверяемый кусок.
   *
   * Хвост медиа (`with-media-tail`, :7908/:8548) не ставится: он гейтится
   * `USE_MEDIA_TAILS` и `canHaveTail`, а хвостов у нашего бабла ещё нет вовсе
   * (этап 6). Ставить класс, под который нет ни SVG-хвоста, ни его CSS, значило
   * бы объявить наличие того, чего нет.
   *
   * НЕ ПОРТИРОВАНА ВЕТКА `messageMediaPaidMedia` (:8840-9030), а с нею и
   * РАЗБЛОКИРОВКА ПЛАТНОГО МЕДИА (ветка клика `is-buy`, :3199-3232).
   *
   * Ручка у действия есть — `starsManager.unlockPaidMedia`
   * (`core/managers/starsManager.ts:163`, раскрытие приезжает кадром
   * `rt:paid_media_unlock`), — но УЗЛА И УСЛОВИЯ ПОКАЗА нет вовсе, и одним
   * обработчиком их не завести:
   *   • неоплаченное платное медиа файла не несёт (приезжает
   *     `messageExtendedMediaPreview`), поэтому `getBubbleMedia` отвечает
   *     `undefined` и эта ветка выходит СРАЗУ — заблокированный бабл сегодня
   *     рисуется пустым. Класс `is-buy` оригинал вешает на `attachmentDiv`
   *     (:8897), которого в этом случае никто не создаёт;
   *   • сам показ — это отдельная сборка: псевдо-фото из превью
   *     (`generatePhotoForExtendedMediaPreview`, :8926-8931), ценник
   *     `.extended-media-buy` с `PaidMedia.Unlock` (:8899-8907), заслонка
   *     (`spoilered: !isAlreadyPaid`), «шум» `DotRenderer` (:9010-9020) и опрос
   *     `extendedMediaMessages` (:9003-9008), которым бабл узнаёт об оплате;
   *   • владелец клика у оригинала — `PopupPayment` с подтверждением суммы
   *     (:3210-3216). Попапа платежей у нас нет, а `unlockPaidMedia` списывает
   *     звёзды МОЛЧА: дословный порт ветки дал бы кнопку, которая тратит деньги
   *     без подтверждения, — расхождение хуже отсутствия.
   * Это самостоятельная работа «платное медиа в ванильной ленте», а не
   * потерянный обработчик; строка о ней — в таблице долгов `web-client/CLAUDE.md`.
   */
  private renderMedia(message: MyMessage, bubbleContainer: HTMLElement, messageDiv: HTMLElement): void {
    if (message._ !== 'message') return

    const media = message.media
    const mediaObject = getBubbleMedia(message)
    if (!mediaObject) return

    const isPhoto = media?._ === 'messageMediaPhoto'
    const doc = media?._ === 'messageMediaDocument' ? media.document : undefined
    // Порядок веток — как в оригинале: сначала стикер (:8510), потом видео
    // (:8511). Стикер это тоже документ, и без первой проверки он ушёл бы в
    // видео-ветку.
    if (doc?.sticker) {
      this.renderStickerMedia(doc, bubbleContainer)
      return
    }
    const isVideo = !!doc && (doc.type === 'video' || doc.type === 'gif' || doc.type === 'round')
    // Прочие документы (файл, голосовое, музыка) — своя ветка оригинала
    // (:8588-8646): узел встаёт В ТЕЛО сообщения, а не в attachment, поэтому
    // `attachmentDiv` у неё не заводится вовсе (`noAttachmentDivNeeded`).
    if (doc && !isVideo) {
      this.renderDocumentMedia(message, doc, bubbleContainer, messageDiv)
      return
    }
    if (!isPhoto && !isVideo) return

    const isRound = doc?.type === 'round'
    const bubble = bubbleContainer.parentElement?.parentElement
    // tweb :7890 (`photo`) и :8530 (`round` либо `video`).
    bubble?.classList.add(isPhoto ? 'photo' : isRound ? 'round' : 'video')

    const attachmentDiv = document.createElement('div')
    attachmentDiv.classList.add('attachment')

    const middleware = this.getMiddleware()
    // Подпись есть — бокс расширяется (tweb `hasMessageBlock`).
    const hasMessageBlock = !!getMessageText(message)

    // Альбом: ≥2 медиа одной группы рисуются ОДНОЙ раскладкой внутри того же
    // вложения (tweb :7891-7906 для фото, :8531-8544 для видео). Группа из
    // одного сообщения альбомом не считается — у оригинала тот же гейт
    // (`groupedMids.length !== 1`).
    const groupedId = message.grouped_id
    const groupMessages = groupedId ? this.groupedMessages(groupedId) : []
    if (groupMessages.length > 1) {
      bubble?.classList.add('is-album', 'is-grouped')
      const albumMessages = groupMessages.filter((m): m is MessageReal => m._ === 'message')
      wrapAlbum({
        messages: albumMessages,
        attachmentDiv,
        middleware,
        animationGroup: 'chat',
        spoilered: isMediaSpoiler(message),
        // tweb album.ts:97 — у альбома отдача СВОЯ у каждой ячейки
        // (`uploadingFileName?.[idx]`): фотографии уходят по одной, и крестик
        // на ячейке отменяет именно её.
        uploadPromises: albumMessages.map((m) => this.uploadPromiseFor(m)),
        // tweb :7901 (фото-альбом) / :8542 (видео-альбом) — весь свод целиком:
        // внутри альбом сам выбирает `photo` для ячейки-фотографии и отдаёт
        // свод дальше в `wrapVideo` для ячейки-видео.
        autoDownload: this.autoDownload,
      })
      messageDiv.before(attachmentDiv)
      attachmentDiv.classList.add('no-brb')
      messageDiv.classList.add('mt-shorter')
      return
    }

    // Отдача файла этого бабла — она же отмена по крестику (см. `uploadPromiseFor`).
    const uploadPromise = this.uploadPromiseFor(message)

    const promise = (isVideo && doc
      ? wrapVideo({
        doc,
        container: attachmentDiv,
        middleware,
        uploadPromise,
        boxWidth: mediaSizes.active.regular.width,
        boxHeight: mediaSizes.active.regular.height,
        group: 'chat',
        hasMessageBlock,
        message: {
          mid: message.id,
          peerId: this.peerId,
          date: message.date,
          mediaUnread: !!message.pFlags?.media_unread,
          // Свой кружок «просмотренным» не отмечается — гейт оригинала
          // (`message.fromId !== rootScope.myId`, appMediaPlaybackController.ts:452).
          out: !!message.pFlags?.out,
          // tweb `noInfo: message.mid <= 0` (:8571) — у неотправленного нет ни
          // времени, ни счётчика просмотров, показывать нечего.
          isOutgoing: message.id <= 0,
        },
        noInfo: message.id <= 0,
        // tweb :8572 — у спойлера автоплей не заводится: иначе видео играло бы
        // под крышкой.
        noAutoplayAttribute: isMediaSpoiler(message),
        // tweb :8561 — весь свод: враппер берёт `video` для самого документа и
        // `photo` для его превью-кадра (`wrapVideo` :370/:415).
        autoDownload: this.autoDownload,
      })
      : wrapPhoto({
        photo: mediaObject,
        container: attachmentDiv,
        middleware,
        boxWidth: mediaSizes.active.regular.width,
        boxHeight: mediaSizes.active.regular.height,
        hasMessage: true,
        hasMessageBlock,
        uploadPromise,
        // tweb :7919 — у фото порог отдельным числом (`autoDownloadSize`).
        autoDownloadSize: this.autoDownload?.photo,
      })
    ).catch(noop)

    // tweb :7922-7930 — крышка спойлера поверх вложения. Узел строит враппер,
    // а вставляет ВЫЗЫВАЮЩИЙ (у оригинала это `wrapMediaSpoiler` самой ленты,
    // bubbles.ts:6034-6058): крышка живёт поверх того же attachment.
    if (isMediaSpoiler(message)) {
      void promise
        .then(() => wrapMediaSpoiler({ media: mediaObject, middleware, animationGroup: 'chat' }))
        .then((cover) => {
          if (cover && middleware()) attachmentDiv.append(cover)
        })
        .catch(noop)
    }

    // tweb :9247-9268: вложение встаёт ПЕРЕД телом, и стык между ними теряет
    // радиусы с обеих сторон.
    messageDiv.before(attachmentDiv)
    attachmentDiv.classList.add('no-brb')
    messageDiv.classList.add('mt-shorter')
  }

  /**
   * Reply-заголовок бабла — порт `MessageRender.setReply` (tweb
   * messageRender.ts:418-593) вместе с условием его показа
   * (bubbles.ts:9372-9405).
   *
   * УСЛОВИЕ ПОКАЗА — не «есть reply_to», а точнее: ответ на КОРЕНЬ треда
   * заголовка не даёт (:9377-9378 сравнивает `reply_to_mid` с `threadId` и
   * `reply_to_top_id`). Иначе каждое сообщение комментариев несло бы шапку с
   * ссылкой на сам пост, которую пользователь и так видит сверху.
   *
   * Заголовок встаёт ПЕРЕД телом и получает `mb-shorter`, когда снизу от него
   * идёт текст (:9391-9393); вложение при этом теряет верхние радиусы —
   * `no-brt` (:9395-9397): reply лежит НАД вложением, и стык между ними
   * такой же, как стык вложения с подписью снизу.
   *
   * Класс `is-reply` ставит `bubbleClasses` (общий с React-лентой вычислитель),
   * а не эта ветка: второй ответ на вопрос «есть ли у бабла ответ» разъехался
   * бы с первым.
   */
  private renderReply(
    message: MyMessage,
    bubbleContainer: HTMLElement,
    messageDiv: HTMLElement,
  ): void {
    if (message._ !== 'message') return

    const replyTo = message.reply_to
    const replyToMid = replyTo?.reply_to_msg_id
    if (!replyTo || !replyToMid) return
    // Ответ на корень треда шапки не даёт (:9377-9378).
    if (replyToMid === replyTo.reply_to_top_id) return

    const container = createReplyContainer({ replyTo, original: this.getMessage(replyToMid) })
    // Адрес оригинала — на самом узле: по нему прыгает клик, и он же нужен
    // догрузке (tweb хранит его в `bubble.dataset.replyToPeerId`/`mid`).
    container.dataset.replyToMid = String(replyToMid)

    bubbleContainer.prepend(container)

    const attachment = bubbleContainer.querySelector<HTMLElement>('.attachment')
    if (!attachment && messageDiv.textContent) container.classList.add('mb-shorter')
    attachment?.classList.add('no-brt')
  }

  /**
   * ЛОГ ЗВОНКА — порт ветки tweb `messageMediaCall` (bubbles.ts:8650-8704).
   *
   * Бабл у звонка ОБЫЧНЫЙ, а не служебная пилюля: у оригинала за это отвечает
   * `SERVICE_AS_REGULAR` (:278 — в наборе ровно один элемент,
   * `messageActionPhoneCall`), у нас ту же роль играет `getMessageKind`
   * (`'call'`, а не `'service'`), см. ветку сервисного бабла в `renderMessage`.
   *
   * Узел встаёт В ТЕЛО сообщения (`messageDiv.append(div)`, :8703) — как и
   * строка документа, вложения (`attachment`) у ветки нет вовсе
   * (`noAttachmentDivNeeded`, :8699). `data-type` на самом `.bubble-call`
   * (:8656-8657) — не украшение: по нему обработчик клика узнаёт, каким
   * перезванивать (`callDiv.dataset.type`, :3194).
   *
   * РАСХОЖДЕНИЕ ОДНО, и оно в подписи длительности: оригинал зовёт
   * `wrapCallDuration` → `formatDuration(duration, 2)` (wrapDuration.ts:32),
   * то есть «1 минута 20 секунд» через МНОЖЕСТВЕННЫЕ формы langPack. Ни
   * `formatDuration`, ни плюрализации у нашего словаря нет вовсе, поэтому
   * длительность идёт тем же `m:ss`, что у таймкода видео
   * (`formatVideoTime`), — как её и рисовала снесённая React-лента.
   */
  private renderCall(action: MessageActionPhoneCall, isOut: boolean, bubble: HTMLElement, messageDiv: HTMLElement): void {
    const t = useI18nStore.getState().t

    const div = document.createElement('div')
    div.classList.add('bubble-call')
    div.append(Icon(action.pFlags?.video ? 'videocamera' : 'phone', 'bubble-call-icon'))

    // tweb :8656-8657 — тип звонка на самом узле; его читает обработчик клика.
    div.dataset.type = action.pFlags?.video ? 'video' : 'voice'

    const title = document.createElement('div')
    title.classList.add('bubble-call-title')
    // tweb :8662-8665 — четыре ключа: сторона × «видео или нет».
    title.textContent = t(isOut
      ? (action.pFlags?.video ? 'CallMessageVideoOutgoing' : 'CallMessageOutgoing')
      : (action.pFlags?.video ? 'CallMessageVideoIncoming' : 'CallMessageIncoming'))

    const subtitle = document.createElement('div')
    subtitle.classList.add('bubble-call-subtitle')

    // tweb :8669-8688 — СОСТОЯВШИЙСЯ звонок отличает НАЛИЧИЕ длительности, а не
    // причина: она есть у любого завершённого. Ветка `default` оригинала
    // (`phoneCallDiscardReasonHangup` и всё прочее) — «отменён».
    if(action.duration !== undefined) {
      subtitle.append(document.createTextNode(formatVideoTime(action.duration)))
    } else {
      subtitle.classList.add('is-reason') // tweb :8687
      subtitle.append(document.createTextNode(t(
        action.reason?._ === 'phoneCallDiscardReasonBusy' ? 'Call.StatusBusy'
        : action.reason?._ === 'phoneCallDiscardReasonMissed' ? 'ChatList.Service.Call.Missed'
        : 'CallMessageCancelled',
      )))
    }

    // tweb :8691 — стрелка ПЕРЕД текстом, зелёная у состоявшегося звонка и
    // красная у сорвавшегося.
    subtitle.prepend(Icon('arrow_next', 'bubble-call-arrow', 'bubble-call-arrow-' + (action.duration !== undefined ? 'green' : 'red')))

    div.append(title, subtitle)

    bubble.classList.add('call-message') // tweb :8702
    messageDiv.append(div)
  }

  /**
   * Документ, голосовое, музыка — порт ветки tweb :8588-8646 в применимом
   * объёме.
   *
   * Отличие от фото и видео принципиальное: строка документа встаёт В ТЕЛО
   * сообщения (`messageDiv`), а не в `attachment`, — у оригинала эта ветка
   * помечена `noAttachmentDivNeeded`. Подпись при этом остаётся под строкой,
   * потому что тело у бабла одно.
   *
   * `bubble-content-background` (:8616-8618) — подложка бабла: у документов
   * фон рисует она, а не сам `bubble-content`.
   *
   * Классы бабла (`document-message`/`voice-message`/`audio-message` плюс
   * `min-content`) здесь НЕ ставятся — их считает общий с React-лентой
   * `bubbleClasses` по тому же правилу оригинала (:8632-8642). Второй
   * вычислитель того же был бы вторым ответом на один вопрос.
   *
   * АЛЬБОМ ДОКУМЕНТОВ не портирован (задача #68): у оригинала эту ветку ведёт
   * `wrapGroupedDocuments` с `albumMustBeRenderedFull`, а группировки у нашей
   * ленты нет вовсе. Одиночный документ от этого не страдает — он и в
   * оригинале идёт тем же путём.
   */
  private renderDocumentMedia(
    message: MyMessage,
    doc: MyDocument,
    bubbleContainer: HTMLElement,
    messageDiv: HTMLElement,
  ): void {
    const node = wrapDocument({
      doc,
      middleware: this.getMiddleware(),
      // `mediaUnread`/`out` — не украшение сообщения, а ГЕЙТ точки «не
      // прослушано» у голосового: её ставит `AudioElement.render`
      // (`components/audio.ts:470`, порт tweb audio.ts:571-574), а гасит по
      // первому движению времени `markPlayed` (:540, порт
      // appMediaPlaybackController.ts:452-456). Без этих двух полей голосовое
      // рисовалось бы всегда прослушанным, а отправитель не узнавал бы, что
      // его послушали.
      message: {
        mid: message.id,
        peerId: this.peerId,
        date: message.date,
        mediaUnread: !!message.pFlags?.media_unread,
        out: !!message.pFlags?.out,
      },
      sizeType: 'documentName',
      // tweb :8597 — у документа порог СВОЙ и сравнивается с размером файла
      // (`wrapDocument`: `autoDownloadSize >= doc.size`), а не только с нулём.
      autoDownloadSize: this.autoDownload?.file,
    })

    // tweb :8616-8618 — подложка перед содержимым.
    const background = document.createElement('div')
    background.classList.add('bubble-content-background')
    bubbleContainer.prepend(background)

    // Строка документа идёт ПЕРЕД подписью — в начало того же `messageDiv`.
    //
    // РАСХОЖДЕНИЕ С ОРИГИНАЛОМ, названное явно: у tweb подпись документа не
    // сосед строки, а её ПОТОМОК — `wrapGroupedDocuments` кладёт текст в
    // `.document-message` внутри `.document-container > .document-wrapper`
    // (groupedDocuments.ts:100-127,145-147) и в тело добавляет уже весь
    // контейнер (:151); в самом теле текста нет вовсе, потому что для
    // документа `needToSetHTML = false` (bubbles.ts:7337-7341, гейт
    // `setInnerHTML(messageDiv, richText)` на :7540-7541). Эта обёртка
    // приедет вместе с альбомом документов (задача #68) — она же его несущая
    // конструкция. Пока подпись остаётся соседом, тело знает о строке
    // документа: `BODY_NOT_CONTENT`.
    messageDiv.prepend(node)
  }

  /**
   * Стикер — порт `ChatBubbles.wrapSticker` (tweb bubbles.ts:6069-6119) в
   * применимом объёме.
   *
   * Стикер это НЕ обычное вложение: бабл получает `sticker` (и
   * `sticker-animated` у анимированного), становится standalone-медиа — то
   * есть `just-media`, без фона и паддингов, — а размер бокса берётся из
   * лестницы `mediaSizes.active` и переносится в `min-width`/`min-height`
   * самого `bubble-content` (:6110-6119), чтобы бабл не схлопывался, пока
   * стикер грузится.
   *
   * НЕ портировано (нет предмета): `boxSize` для emoji-big (ветка больших
   * эмодзи ещё не заведена), премиум-эффекты и `nopremium` (:6120-6161 —
   * подсистемы эффектов у нас нет).
   */
  private renderStickerMedia(doc: MyDocument, bubbleContainer: HTMLElement): void {
    const bubble = bubbleContainer.parentElement?.parentElement
    bubble?.classList.add('sticker')
    // tweb :6101-6104 — анимированный отличается классом, и по нему же CSS
    // снимает фон у бабла.
    const isAnimated = !!doc.animated
    if (isAnimated) bubble?.classList.add('sticker-animated')
    // `just-media` в оригинале ставит `isStandaloneMedia` уже после switch'а
    // (:9660); у нас поля контекста нет, поэтому класс ставится здесь — по
    // тому же признаку и с тем же смыслом.
    bubble?.classList.add('just-media')

    const attachmentDiv = document.createElement('div')
    attachmentDiv.classList.add('attachment')

    const boxSize = isAnimated ? mediaSizes.active.animatedSticker : mediaSizes.active.staticSticker
    setAttachmentSize({
      width: doc.w ?? boxSize.width,
      height: doc.h ?? boxSize.height,
      element: attachmentDiv,
      boxWidth: boxSize.width,
      boxHeight: boxSize.height,
      noMinSize: true,
    })
    // tweb :6116-6117 — бокс стикера держит МИНИМУМ бабла.
    bubbleContainer.style.minWidth = attachmentDiv.style.width
    bubbleContainer.style.minHeight = attachmentDiv.style.height

    wrapSticker({
      mediaId: doc.id,
      div: attachmentDiv,
      group: 'chat',
      middleware: this.getMiddleware(),
      width: parseInt(attachmentDiv.style.width, 10) || boxSize.width,
      height: parseInt(attachmentDiv.style.height, 10) || boxSize.height,
      emoji: doc.stickerEmojiRaw,
      liteModeKey: 'stickers_chat',
      thumb: getStrippedThumb(doc),
      docWidth: doc.w,
      docHeight: doc.h,
    }).render.catch(noop)

    bubbleContainer.prepend(attachmentDiv)
  }

  /** Старший номер, который читает этот бабл, — порт tweb bubbles.ts:6608-6609
   *  (`maxBubbleMid`). У альбома бабл ОДИН на всю группу, поэтому и рубеж
   *  прочтения у него — старший номер группы, а не номер главного сообщения. */
  private maxBubbleMid(message: MyMessage): number {
    const grouped = message._ === 'message' && message.grouped_id
      ? this.groupedMessages(message.grouped_id)
      : []
    return grouped.length ? grouped[grouped.length - 1].id : message.id
  }

  /**
   * Сервисный бабл — порт ветки tweb bubbles.ts:6708-7277 (`bubble.className =
   * 'bubble service'` → `bubbleContainer.replaceChildren()` → `.service-msg`).
   *
   * Сам каркас и фразу строит `serviceMessage.ts::createServiceBubble` — там же,
   * где живёт дата-разделитель; здесь остаётся то, чем владеет лента: адрес
   * чата и РАЗРЕШЁННОЕ превью закреплённого.
   *
   * Превью: у `messageActionPinMessage` параметров нет вовсе, цель лежит в
   * `reply_to` самого служебного сообщения — 1:1 с оригиналом
   * (`messageActionTextNewUnsafe.ts:400-419`: `getMessageByPeer(peerId,
   * reply_to_mid)` → `wrapLinkToMessage`, а без сообщения — ключ
   * `ActionPinnedNoText`). Догрузка отсутствующего оригинала
   * (`fetchMessageReplyTo`, :411-413) не портирована: этой ручки у ленты нет —
   * тот же пробел, что у превью ответа (`renderReply` берёт оригинал из окна).
   *
   * `is-group-first`/`is-group-last` не вешаются здесь (в tweb `is-group-last`
   * ставит сама ветка по `pFlags.is_single`, :7272-7274): у нас «пилюля не
   * группируется ни с чем» уже выражена `GroupItem.single`
   * (`bubbleGroups.ts:489` по `isServicePill`), а классы краёв ставит
   * `BubbleGroup.updateClassNames` — одиночной серии оба.
   *
   * Не портированы `wrapServiceMediaBubble` (аватар нового фото чата, кнопка
   * «Установить фото» у `suggest_photo`) и solid-компоненты подарков/розыгрышей
   * — см. шапку `serviceMessage.ts`.
   */
  private renderServiceMessage(message: MessageService): HTMLElement {
    const pinnedToMid = message.action._ === 'messageActionPinMessage'
      ? message.reply_to?.reply_to_msg_id
      : undefined
    const pinnedTarget = pinnedToMid !== undefined ? this.getMessage(pinnedToMid) : undefined

    return createServiceBubble({
      message,
      pinnedPreview: pinnedTarget ? wrapMessageForReply({ message: pinnedTarget }) : undefined,
      peerId: this.peerId,
      mid: message.id,
      timestamp: message.date,
      middleware: this.getMiddleware(),
      managers: this.managers,
    })
  }

  // Каркас бабла: `.bubble > .bubble-content-wrapper > .bubble-content >
  // .message.spoilers-container` (tweb bubbles.ts:6618-6629). Время и реакции —
  // следующие этапы; медиа заводит `renderMedia`.
  private renderMessage(message: MyMessage): HTMLElement {
    // Порт tweb :6667-6679 — «этот бабл ещё не прочитан», единственный гейт
    // наблюдения. Первое слагаемое оригинала (:6667-6669,
    // `!our && !pFlags.out && !!pFlags.unread`) предмета не имеет: флага
    // `unread` НА СООБЩЕНИИ у нас нет вовсе (`MessagePFlags`, `core/models.ts`).
    // Остаётся второе (:6674-6679) — сравнение с горизонтом прочтения, и гейт
    // `peerId.isAnyChat()` с него снят по той же причине: без флага у личного
    // чата не было бы наблюдения ВООБЩЕ. Ноль горизонта («непрочитанного нет»,
    // `dialogsManager.getReadMaxSeqIfUnread`) при этом наблюдает всё — ровно как
    // у оригинала, где `readMaxId` тоже возвращается нулём и тоже проходит
    // сравнение (:6676, `readMaxId !== undefined && readMaxId < maxBubbleMid`).
    // Лишняя отметка безвредна: рубеж дедуплится ниже
    // (`connectionManager.ts:178`), а пропущенная стоила бы непогасшего бейджа.
    const maxBubbleMid = this.maxBubbleMid(message)
    const setUnreadObserver = this.renderReadMaxSeq < maxBubbleMid
      ? (element: HTMLElement) => this.setUnreadObserver(element, maxBubbleMid)
      : undefined

    // Порт tweb :6708-6712 (`!isMessage && !SERVICE_AS_REGULAR.has(action._)`)
    // и :7293-7301 (`returnService` — ветка возвращает бабл СРАЗУ, до медиа,
    // ответа, времени и имени).
    //
    // Роль `SERVICE_AS_REGULAR` (там — только `messageActionPhoneCall`) у нас
    // играет `getMessageKind`: он и есть ответ «какой бабл у этого служебного
    // сообщения». Кроме звонка (`call`) он уводит из пилюли ПОДАРОК
    // (`messageActionStarGift` → `gift`) — расхождение с tweb, где подарок это
    // сервисный бабл с solid-компонентом `PremiumGiftBubble` (:7128). Своего
    // бабла у подарка в ванильной ленте пока нет вовсе; пилюлей его рисовать
    // нельзя — фразы для него у `serviceMsgSegs` нет, и он читался бы «действие
    // не поддерживается».
    if(message._ === 'messageService' && getMessageKind(message) === 'service') {
      const serviceBubble = this.renderServiceMessage(message)
      setUnreadObserver?.(serviceBubble)
      return serviceBubble
    }

    const bubble = document.createElement('div')
    bubble.dataset.mid = '' + message.id
    bubble.dataset.peerId = '' + this.peerId
    bubble.classList.add(...this.classesFor(message))

    const contentWrapper = document.createElement('div')
    contentWrapper.classList.add('bubble-content-wrapper')

    const bubbleContainer = document.createElement('div')
    bubbleContainer.classList.add('bubble-content')

    // Тело сообщения. Класс `spoilers-container` — не украшение: по нему
    // `revealSpoiler` (`lib/spoiler/spoilerReveal.ts`) находит область, которой
    // раскрывать спойлер; без него раскрытие уехало бы на весь
    // `.bubble-content` (фолбэк `parentElement`).
    const messageDiv = document.createElement('div')
    messageDiv.classList.add('message', 'spoilers-container')
    this.renderMessageContent(message, messageDiv)

    bubbleContainer.append(messageDiv)

    contentWrapper.append(bubbleContainer)
    bubble.append(contentWrapper)

    // tweb :7305-7307: у обычного бабла читающий узел — САМ бабл. У поста
    // канала он другой (см. ниже, у времени).
    if(!this.chat.isBroadcast) {
      setUnreadObserver?.(bubble)
    }

    // Просмотры — порт tweb :7672/:7684-7690. Наблюдаемый узел — САМ бабл, в
    // отличие от отметки прочтения (та у поста канала висит на времени: пост
    // бывает выше вьюпорта, и «прочитан» он, только когда домотали до конца, а
    // «просмотрен» — как только показался край).
    //
    // Гейт — НАЛИЧИЕ счётчика (`isMessage && message.views`, :7672), а не вид
    // чата: у поста канала `views:flags.10?int` стоит с первой публикации и
    // нулевым не бывает (минимум единица — как у своего ещё не отправленного
    // поста в оригинале, appMessagesManager.ts:2930). Наш сервер шлёт пару
    // views/forwards ровно у поста и всегда — domain.MessageReal.PostCounters.
    //
    // `!message.pFlags.is_outgoing` (:7684) у нас выражает ДРОБНЫЙ номер: своя
    // ещё не отправленная публикация номера в канале не имеет, регистрировать
    // просмотр нечему. Ветки `previewOnly` и метрик чтения (:7687-7690) предмета
    // не имеют — превью-ленты и метрик у нас нет.
    if(message._ === 'message' && message.views && !isLocalMessageId(message.id)) {
      this.observer?.observe(bubble, this.viewsObserverCallback)
    }

    // Медиа — после сборки каркаса: ветке нужен и `bubbleContainer` (куда
    // встаёт вложение), и сам `bubble` (классы `photo`/`video`/`round`).
    this.renderMedia(message, bubbleContainer, messageDiv)

    // Лог звонка — соседняя ветка того же switch'а оригинала (:8650), поэтому
    // и здесь она стоит рядом с медиа. Само сообщение при этом СЛУЖЕБНОЕ:
    // из пилюли его увёл `getMessageKind` (см. ветку сервисного бабла выше),
    // как `SERVICE_AS_REGULAR` уводит его в tweb.
    if(message._ === 'messageService' && message.action._ === 'messageActionPhoneCall') {
      this.renderCall(message.action, this.isOutMessage(message), bubble, messageDiv)
    }

    this.renderReply(message, bubbleContainer, messageDiv)

    this.renderMessageMeta(message, bubble, bubbleContainer, messageDiv, setUnreadObserver)

    // Имя автора. Порт обычной ветки `nameDiv` (tweb bubbles.ts:9498-9514) и
    // её вставки (:9567-9590); `nameContainer` в оригинале — тот же
    // `bubbleContainer`, пока сообщение не standalone-медиа (:7782).
    //
    // НЕ портирована ветка ПЕРЕСЫЛКИ (:9410-9497) — «Переслано от …» с
    // аватаркой 20px, вторым заголовком форварда-форварда и `post_author`.
    // У неё нет ни данных (модель форварда у нас — плоские `fwdFrom*`, без
    // `saved_from`/`from_name`/`post_author`), ни подсистем (`avatarNew`,
    // langPack-ключи `ForwardedFrom*`); классы `forwarded`/`must-have-name`
    // при этом уже ставит `bubbleClasses`, так что шапка форварда приедет
    // сюда же вместе с самим форвардом — отдельной работой, как и медиа.
    if (this.needName(message)) {
      const fromId = this.bubbleGroups.getMessageFromId(message)
      const nameDiv = document.createElement('div')
      nameDiv.append(this.createTitle(fromId).element)
      // tweb :9502-9513. `noColor` в оригинале не присваивается никогда, так что
      // ветка всегда живая; `our` для мегагруппы — ровно `pFlags.out`
      // (chat.ts:1375-1377 `isOurMessage` при `isMegagroup`), поэтому у своей
      // отправки от лица канала имя есть, но НЕ цветное.
      if (!this.isOurMessage(message)) {
        nameDiv.classList.add('colored-name')
      }
      nameDiv.dataset.peerId = '' + fromId

      nameDiv.classList.add('name')
      nameDiv.setAttribute('dir', 'auto') // tweb setDirection(nameDiv), :9569
      nameDiv.classList.add('floating-part') // :9584
      bubbleContainer.prepend(nameDiv)
      // tweb `updateMessageDiv` (:9571-9575): имя вплотную к телу сообщения
      // съедает верхний отступ тела.
      if (nameDiv.nextElementSibling === messageDiv) {
        nameDiv.classList.add('next-is-message')
      }
    }

    // Хвост бабла — порт tweb :9707-9712. `canHaveTail` уже посчитан в
    // `bubbleClasses` (класс `can-have-tail` стоит на `bubble` с самой сборки
    // каркаса); `round` кладёт та же `bubbleClasses` по `m.type ===
    // 'roundVideo'` (:78) — оба READ-ONLY здесь, вычислять их заново значило
    // бы завести ВТОРОЙ источник правды. Узел — ПОСЛЕДНИЙ ребёнок
    // `.bubble-content` (:9711 `bubbleContainer.append(generateTail())`): CSS
    // (`_chatBubble.scss:2089-2103`) сам решает, виден ли он, по классам
    // `.can-have-tail`/`.is-group-last`/`.is-forced-rounded` — узел безопасно
    // держать в DOM и тогда, когда сейчас скрыт.
    const canHaveTail = bubble.classList.contains('can-have-tail')
    const isRound = bubble.classList.contains('round')
    if (canHaveTail || isRound) {
      bubbleContainer.append(generateTail())
    }

    return bubble
  }

  /**
   * МЕТА-ХВОСТ тела сообщения: время, значок отправки, тред и реакции.
   *
   * Отдельный метод, потому что вызывателей у него ДВА — сборка бабла и правка
   * (`onMessageEdit`). В tweb второго вызывателя нет: там правка ПЕРЕСОЗДАЁТ
   * бабл целиком (:6338 `changeBubbleByBubble`), и весь хвост собирается заново
   * тем же проходом. Почему мы не пересоздаём — см. докблок `onMessageEdit`.
   *
   * Порядок внутри — оригинала, и он не косметический:
   *  • время в КОНЕЦ тела (:7630-7631 `messageDiv.append(timeSpan, clearfix())`)
   *    — ИЛИ, у медиа без подписи, прямо на `.bubble-content` с классом
   *    `is-floating` (:9257-9276, `isFloatingTime`/`appendBubbleTime(bubble,
   *    bubbleContainer, …)`) — читай докблок про `isFloatingTime` ниже;
   *  • тред (:9682-9701) — ДО реакций, как в оригинале (:9703);
   *  • реакции последними, потому что время ПЕРЕЕЗЖАЕТ внутрь их контейнера
   *    (:9855 `reactionsElement.append(timeSpan)`), чтобы чипы и время встали
   *    одной строкой-обёрткой; сам контейнер реакций у медиа без подписи —
   *    ребёнок `.bubble-content-wrapper`, а не `.message` (:9849-9851).
   */
  private renderMessageMeta(
    message: MyMessage,
    bubble: HTMLElement,
    bubbleContainer: HTMLElement,
    messageDiv: HTMLElement,
    setUnreadObserver?: (element: HTMLElement) => void,
  ): void {
    // `.bubble-content-wrapper` — родитель `bubbleContainer` (`.bubble-content`,
    // tweb :6497-6500). У медиа без подписи реакции встают СЮДА (:9850), а не в
    // `messageDiv` — как и в оригинале, читаем узел через `querySelector`, а не
    // тащим третьим параметром: владелец разметки уже отдал этот адрес методу
    // `appendReactionsElementToBubble`.
    const contentWrapper = bubble.querySelector<HTMLElement>(':scope > .bubble-content-wrapper')

    // Метод ИДЕМПОТЕНТЕН, как и `renderMessageReplies` ниже, и по той же
    // причине: вызывателей два, и правка застаёт прошлый хвост на месте.
    // Снимает его ВЛАДЕЛЕЦ — иначе «что здесь лежит» пришлось бы знать ещё и
    // вызывателю. Прошлое поколение узлов ищем по ВСЕМ трём возможным адресам
    // (`messageDiv` — обычный бабл, `bubbleContainer` — floating без реакций,
    // `contentWrapper` — floating с реакциями): какой из них сейчас занят,
    // решают классы бабла, а они могли смениться (правка добавила/убрала
    // медиа). Прошлое поколение контейнера реакций забирается ДО сноса: только
    // в нём живёт предыдущая версия агрегата, по которой считается
    // `changedResults` (порт appMessagesManager.ts:10651-10677 — у tweb обе
    // версии на руках у владельца сообщения, у нас `message_edit` несёт только
    // новую).
    const previousReactions = messageDiv.querySelector<HTMLElement>(':scope > .reactions')
      ?? contentWrapper?.querySelector<HTMLElement>(':scope > .reactions')
    for (const owner of [messageDiv, bubbleContainer, contentWrapper]) {
      owner?.querySelectorAll(':scope > .time, :scope > .reactions').forEach((node) => node.remove())
    }

    // Точка вставки у оригинала меняется (подпись документа, floating), но
    // базовая именно эта; остальные приедут вместе со своими подсистемами.
    const timeSpan = createMessageTime(message)
    // Значок отправки — порт `setBubbleSendingStatus` (:6382-6408). САМ статус
    // считает общий с React-лентой `messageToConvMsg` по правилу оригинала
    // (:9716-9719): ошибка → «отправляется» → прочитано/доставлено. Второго
    // вычислителя того же здесь нет намеренно.
    //
    // «Прочитано» (две галочки) пока не наступает: правило требует горизонта
    // ИСХОДЯЩИХ (`read_outbox_max_id`), а лента его не получает — в
    // `BubblesManagers` есть только горизонт входящих, под границу
    // непрочитанных. Названо задачей.
    setSendingStatus(timeSpan, messageToConvMsg(message, rootScope.myId, {
      isMegagroup: this.chat.isMegagroup,
    }).status)
    // У ЛОГА ЗВОНКА время уезжает В ПОДПИСЬ — tweb `appendBubbleTime(bubble,
    // subtitle, () => subtitle.append(timeSpan))` (:8693): длительность и время
    // стоят одной строкой, иначе бабл в две строки распирало бы третьей.
    // Реестр `bubble.timeAppenders` оригинала (:468-470) не портируется: он
    // нужен, чтобы ПЕРЕВЫЛОЖИТЬ время, когда бабл меняет форму, а из наших
    // веток такую точку вставки объявляет ровно одна.
    const callSubtitle = messageDiv.querySelector<HTMLElement>('.bubble-call-subtitle')
    callSubtitle?.querySelector(':scope > .time')?.remove()

    // МЕДИА БЕЗ ПОДПИСИ — tweb :9257-9276. `has-floating-time` уже стоит на
    // бабле (bubbleClasses.ts:129, тем же условием `isMessageEmpty`, каким
    // оригинал считает `isFloatingTime`): `.message` у такого бабла ПУСТОЕ тело
    // без текста, и класть время внутрь него нельзя — часть текстовых стилей
    // `.message` (`float:right` вместо `position:absolute`) растянула бы время
    // на всю ширину колонки, а не прижала к углу медиа. Оригинал в этой ветке
    // вовсе СНОСИТ `messageDiv` из DOM (:9261 `messageDiv.remove()`) и кладёт
    // время ПРЯМО на `.bubble-content` — соседом `.message`, а не потомком; мы
    // `messageDiv` не удаляем (он остаётся пустым узлом тела — другая, отдельно
    // прожитая часть порта), но адрес вставки времени — тот же сосед.
    // `is-floating` — CSS-класс времени (`_chatBubble.scss:1818-1848`,
    // `position: absolute; bottom: .1875rem; right: .1875rem`), без него узел
    // остаётся в потоке `.message` со `position: static`.
    const isFloatingTime = bubble.classList.contains('has-floating-time')
    if (isFloatingTime) timeSpan.classList.add('is-floating')

    if (callSubtitle) {
      callSubtitle.append(timeSpan)
    } else if (isFloatingTime) {
      bubbleContainer.append(timeSpan)
    } else {
      messageDiv.append(timeSpan)
    }

    // tweb :7638-7640. У ПОСТА КАНАЛА читающий узел — время, а не бабл: пост
    // бывает выше вьюпорта, и «увиден» он, только когда пользователь домотал до
    // его конца. Время стоит в конце тела, поэтому целью наблюдения оригинал
    // берёт именно его.
    if(this.chat.isBroadcast) {
      setUnreadObserver?.(timeSpan)
    }

    this.renderMessageReplies(message, bubble, bubbleContainer)

    const reactionsElement = createReactionsElement(
      message._ === 'message' ? message.reactions : undefined,
      {
        peerId: this.peerId,
        bubble,
        middleware: this.getMiddleware(),
        managers: this.managers,
        isOut: !!message.pFlags.out,
        previous: previousReactions,
        scrollable: this.scrollable,
      },
    )
    if (reactionsElement) {
      // tweb :9849-9851 (`appendReactionsElementToBubble`): у floating-time
      // узел реакций — ребёнок `.bubble-content-wrapper`, а НЕ `.message`
      // (в оригинале `.message` в этой ветке вовсе снесён из DOM). Перенос
      // ВРЕМЕНИ внутрь `reactionsElement` (`appendBubbleTime`, :9855) в
      // оригинале стоит ТОЛЬКО в ветке `else` (:9852-9856) — у floating/
      // service-ветки время туда не переезжает, а остаётся на
      // `.bubble-content` (там его уже разместил код выше классом
      // `is-floating`). Раньше здесь стоял безусловный
      // `reactionsElement.append(timeSpan)` до этой развилки — время у
      // floating-бабла С реакциями уезжало в `.bubble-content-wrapper`,
      // другой узел дерева, где `position: absolute` резолвится не
      // относительно медиа (см. docs/tweb/bubbles.md §4.21).
      if (isFloatingTime) {
        (contentWrapper ?? bubbleContainer).append(reactionsElement)
      } else {
        reactionsElement.append(timeSpan)
        messageDiv.append(reactionsElement)
      }
    }
  }

  /**
   * Тред сообщения — РАЗВИЛКА оригинала (tweb bubbles.ts:9682-9701), и обе её
   * ветки рисуют РАЗНОЕ:
   *  • пост канала с привязанным обсуждением (`replies.pFlags.comments` +
   *    `channel_id`, гейт `getMessageWithCommentReplies`,
   *    appMessagesManager.ts:9237-9247) → футер `replies-element` под баблом
   *    (:9683 `MessageRender.renderReplies`);
   *  • сообщение ГРУППЫ с ответами, у которого этих двух ключей нет
   *    (:9698 `else if(isMessage && message.replies && this.chat.isAnyGroup)`)
   *    → число у времени (`setBubbleRepliesCount`, :6410-6431).
   * Данные обеих веток производит `hydrateThreads`
   * (`backend/internal/usecase/chat/messagescontainer.go:97-154`): каналу —
   * `NewMessageReplies(count, discussionChatId, repliers)`, группе —
   * `NewMessageReplies(count, 0, nil)`, то есть без флага и без `channel_id`.
   *
   * Метод ИДЕМПОТЕНТЕН: старый футер снимается перед сборкой нового, а
   * `setRepliesCount(…, 0)` сам убирает число. Это цена второго вызывателя
   * (правка): у оригинала он один, потому что бабл там новый.
   *
   * `bubble.classList.add('with-replies')` (:7775) ставится ЗДЕСЬ, а не в
   * `bubbleClasses`: общий с React-лентой вычислитель модификаторов о треде не
   * знает, а класс обязан сниматься вместе с исчезнувшим футером.
   */
  private renderMessageReplies(message: MyMessage, bubble: HTMLElement, bubbleContainer: HTMLElement): void {
    bubbleContainer.querySelector(':scope > .replies')?.remove()
    bubble.classList.remove('with-replies', 'with-beside-replies')

    const replies = message._ === 'message' ? message.replies : undefined

    const commentReplies = this.getMessageWithCommentReplies(message)
    if (commentReplies) {
      // tweb :7775 — класс объявляет наличие футера, по нему CSS убирает хвост
      // бабла и растягивает нижние углы.
      bubble.classList.add('with-replies')
      const isFooter = renderReplies({
        bubble,
        bubbleContainer,
        replies: commentReplies.replies,
        peerId: this.peerId,
        mid: commentReplies.mid,
        middleware: this.getMiddleware(),
        managers: this.managers,
      })
      // tweb :9692-9697. Хвост бабла (`context.canHaveTail = true`) у нас не
      // ставится — хвостов у ванильного бабла ещё нет вовсе (этап 6, см.
      // `renderMedia`); beside-вариант свой класс получает.
      if (!isFooter) bubble.classList.add('with-beside-replies')
      return
    }

    // tweb :6411 — внутри треда счётчика нет: там ответы и есть содержимое окна.
    if (this.chat.threadId) return
    // tweb :9698 `this.chat.isAnyGroup` — порт `appPeersManager.isAnyGroup`
    // (:117-119): чат, который не канал. Пост канала сюда не попадает даже без
    // обсуждения — у него ветка одна, футерная.
    if (!replies || !isAnyChat(this.peerId) || this.chat.isBroadcast) return
    setRepliesCount(bubble, replies.replies)
  }

  /**
   * Порт `appMessagesManager.getMessageWithCommentReplies`
   * (tweb appMessagesManager.ts:9237-9247): «у этого сообщения есть тред
   * КОММЕНТАРИЕВ», то есть пост канала с привязанной группой обсуждения.
   *
   * Внутри — `getMessageWithReplies` (:9233-9235): у АЛЬБОМА тред лежит на
   * ОДНОМ сообщении группы, и футер рисуется один на альбом
   * (docs/tweb/comments.md:160). Поэтому возвращается пара «тред + номер
   * НЕСУЩЕГО его сообщения»: номер уезжает в `data-post-key` футера, как в
   * оригинале (replies.ts:43).
   *
   * Ветка `message.peerId === REPLIES_PEER_ID` (:9238) и проверка
   * `channel_id.toChatId() !== REPLIES_HIDDEN_CHANNEL_ID` (:9241) не портируются:
   * чата `Replies` у нас нет как пира вовсе.
   */
  private getMessageWithCommentReplies(message: MyMessage): { replies: MessageReplies, mid: number } | undefined {
    if (message._ !== 'message') return undefined

    const carrier = message.grouped_id
      ? this.groupedMessages(message.grouped_id).find((m) => m._ === 'message' && !!m.replies)
      : message
    if (carrier?._ !== 'message') return undefined

    const replies = carrier.replies
    if (!replies?.pFlags?.comments || !replies.channel_id) return undefined

    return { replies, mid: carrier.id }
  }

  /** Текст сообщения → DOM. Порт вызова tweb bubbles.ts:7497
   *  (`wrapRichText(context.messageMessage, getRichTextOptions(totalEntities))`)
   *  — сам `wrapMessageEntities` внутри `wrapMessageText` (`lib/richtext`).
   *
   *  Из `getRichTextOptions` (bubbles.ts:7414-7425) применимо ровно одно поле —
   *  `middleware`: подсветка кода у нас асинхронная (prism грузится чанком,
   *  `lib/richtext/highlightCode.ts`), и её результат обязан проверяться на
   *  актуальность (`web-client/CLAUDE.md`, «Асинхронщина и актуальность»).
   *  Остальные не имеют предмета:
   *   • `entities` приходит аргументом (их доразметка — внутри `wrapMessageText`);
   *   • `passEntities` в tweb — ровно `{messageEntityBotCommand: isAnyGroup || isBot}`
   *     (bubbles.ts:5209), а `bot_command` в нашей модели сущностей нет;
   *   • `loadPromises` в tweb ждёт очередь рендера перед показом пачки баблов
   *     (`batchProcessor`) — очереди у нас нет, собирать промисы некому;
   *   • `lazyLoadQueue`, `customEmojiSize`, `animationGroup`, `maxMediaTimestamp`,
   *     `textColor`, `passMaskedLinks` — у нашего `wrapRichText` таких опций нет:
   *     общий рендерер кастом-эмодзи, медиа-таймстемпы и sponsored-сообщения не
   *     портированы (см. шапку `lib/richtext/wrapRichText.ts`). */
  private wrapMessageContent(message: MyMessage): DocumentFragment {
    return wrapMessageText(getMessageText(message), message._ === 'message' ? message.entities : undefined, { middleware: this.getMiddleware() })
  }

  /**
   * ЧТО ЛЕЖИТ В ТЕЛЕ БАБЛА (`.message`) ПОМИМО СОДЕРЖИМОГО — один список, и
   * он здесь один нарочно. Порознь этот вопрос знали бы `renderDocumentMedia`
   * (строка файла/плеера) и `renderMessageMeta` (время, реакции), а правка,
   * пересобирающая содержимое, сносила бы то, о чём не вспомнили: так и
   * пропадала строка документа.
   *
   * Пара `.document, .audio` — не наша выдумка: ровно ею оригинал ищет строку
   * документа ВНУТРИ ТЕЛА, когда пристраивает к ней время
   * (tweb bubbles.ts:8624 `messageDiv.lastElementChild.querySelector(
   * '.document, .audio')`). Первый класс ставит `wrapDocument`
   * (`wrappers/document.ts` — `docDiv.classList.add('document', …)`), второй —
   * `AudioElement.render` (`components/audio.ts:446`).
   *
   * Хвост (`.time`, `.reactions`) в списке потому, что он тоже НЕ содержимое.
   * Снимает и выкладывает его заново свой владелец — `renderMessageMeta`.
   */
  private static readonly BODY_NOT_CONTENT = '.document, .audio, .time, .reactions'

  /**
   * СОДЕРЖИМОЕ тела — текст сообщения с разметкой.
   *
   * Вызывателей два (сборка бабла и `onMessageEdit`), и второй застаёт тело
   * НЕПУСТЫМ, поэтому здесь не `replaceChildren`: он считал бы `.message`
   * контейнером одного только текста и уносил всё остальное. Снимается ровно
   * содержимое — то, что не перечислено в `BODY_NOT_CONTENT`.
   *
   * Строка документа переживает правку, а не пересобирается, по той же
   * причине, по которой её не пересобирает и вложение: узел живой — кольцо
   * загрузки, `ProgressivePreloader`, играющий `AudioElement`. У оригинала
   * вопроса нет вовсе, там правка строит бабл заново (:1097 →
   * `safeRenderMessage({message, bubble})`); почему мы так не делаем — в
   * докблоке `onMessageEdit`.
   *
   * Новый текст встаёт В КОНЕЦ: строка документа стоит перед подписью
   * (`renderDocumentMedia`), а хвост выкладывается после — уже
   * `renderMessageMeta`.
   */
  private renderMessageContent(message: MyMessage, messageDiv: HTMLElement): void {
    for (const node of Array.from(messageDiv.childNodes)) {
      if (node instanceof Element && node.matches(ChatBubbles.BODY_NOT_CONTENT)) continue
      node.remove()
    }

    messageDiv.append(this.wrapMessageContent(message))
  }

  /** Порт tweb `groupBubbles` (bubbles.ts:5984-6028) в применимом объёме: ветка
   *  `ChatType.Scheduled` и аватары серий не портированы. Аватар в tweb
   *  заводится здесь же по `isAvatarNeeded` (bubbles.ts:6008 →
   *  `chat.isLikeGroup && !isOutMessage`), а `isLikeGroup` — знание о типе
   *  пира, которого в `ChatContext` ещё нет; поэтому и гейт, и сам узел
   *  аватара приедут одной работой (см. `createAvatar` ниже). */
  public groupBubbles(items: { bubble: HTMLElement, message: MyMessage }[]): BubbleGroup[] {
    items.forEach(({ bubble, message }) => {
      this.bubbleGroups.prepareForGrouping(bubble, message)
    })

    const groups = [...this.bubbleGroups.groupUngrouped()]

    // Аватарка серии — порт tweb bubbles.ts:6002-6016. Заводится по ПЕРВОМУ
    // элементу серии.
    //
    // Проверки «у серии уже есть аватарка» здесь НЕТ, хотя у оригинала она
    // стоит (:6010-6012): у нас тот же сторож живёт уровнем ниже, в самом
    // `BubbleGroup.createAvatar` (`bubbleGroups.ts:249-250`), и стоит он там
    // по своей причине — хост вправе отдать аватар без промиса, и сторож tweb
    // такой случай пропустил бы. Второй такой же здесь был бы вторым ответом
    // на тот же вопрос: мутация его снятия ничего не красит.
    //
    // Оригинал собирает промисы (`avatarPromises`) и ждёт их перед вставкой
    // серий, чтобы аватарка не проявлялась рывком после появления баблов. Здесь
    // ожидания нет: `readyThumbPromise` у нашей аватарки уже разрешён к этому
    // моменту во всех ветках, кроме загрузки фотографии, а её оригинал тоже не
    // ждёт — ждёт он только stripped-подложку, которая у нас ставится
    // синхронно (`components/avatar.ts`).
    for(const group of groups) {
      const firstItem = group.firstItem
      if(firstItem && this.isAvatarNeeded(firstItem.message)) {
        void group.createAvatar(firstItem.message)
      }
    }

    return groups
  }

  /** Порт tweb `isAvatarNeeded` (bubbles.ts:11689-11707) в применимом объёме.
   *
   *  Из трёх веток оригинала остаётся последняя (:11706): бот верификации и
   *  гостевой чат — подсистемы, которых у нас нет, а журнал админ-действий
   *  (`channelAdminLogEvent`) наша модель не производит. */
  public isAvatarNeeded(message: MyMessage): boolean {
    return !!this.chat.isLikeGroup && !this.isOutMessage(message)
  }

  /**
   * Порт tweb `processBatch` (bubbles.ts:5808) в объёме каркаса — см. шапку.
   *
   * Здесь и только здесь группируется пачка: ОДИН вызов `groupBubbles` на всю
   * очередь (оригинал — :5824) и одно `mountUnmountGroups` на посчитанный им
   * набор серий (:5936). Порядок единиц — порядок постановки в очередь, его
   * держит сам `BatchProcessor` (`queue.splice` + `Promise.all`).
   *
   * `filterQueue` (:5811-5819) — единицы, протухшие ПОКА пачка ждала: бабл могли
   * удалить (`history_delete`) или переклеить на другой узел. Сверка ровно как в
   * оригинале — «по адресу бабла лежит именно ЭТОТ узел».
   *
   * Второй сторож оригинала — `changedMids` (:685/5816, «message is sent faster
   * than temporary one was rendered») — не портирован СОЗНАТЕЛЬНО: он ловит ровно
   * тот же случай, что и сверка выше. Бабл, которому ack сменил идентификатор до
   * разбора пачки, уже не лежит по адресу своего temp-mid (ре-кей делает
   * `history_update`), поэтому единица отсеивается первым же условием, а карта
   * temp→final была бы вторым выражением того же факта.
   *
   * ГЛАВНОЕ В ЭТОМ МЕТОДЕ — ПОРЯДОК (:5824 → :5893 → :5936 → :5942). Серии
   * СЧИТАЮТСЯ (`groupBubbles`) до сохранения скролла, а в DOM въезжают
   * (`mountUnmountGroups`) — после: `ScrollSaver.save()` замеряет `DOMRect`
   * первого видимого бабла, и замер обязан быть сделан ДО мутации дерева, иначе
   * якорь уже уехал. `restoreScroll()` идёт сразу за монтированием.
   *
   * `changedTop`/`changedBottom` — сменился ли КРАЙ окна (первый/последний mid
   * среди серий). Из них и из `reverse` единиц выводится направление якоря:
   * пачка «с одной стороны» верит своему `reverse`, смешанная — считает
   * «дописали сверху» ровно когда верх поехал, а низ остался (:5844).
   *
   * Не портировано (нет предмета): ожидание медиа-промисов единицы и логи
   * времени (:5854-5878 — у нас состав бабла синхронный, промисов не бывает),
   * `avatarPromises`, sponsored-правка `newLastMid`, `bubblesToReplace`/
   * `ejectBubbles` (перерендер бабла новым узлом — у нас правка идёт поверх
   * того же узла, см. `onMessageEdit`), `chat.selection`, локальные сообщения
   * (плейсхолдеры), `updatePlaceholderPosition`, `lazyLoadQueue.setAllSeen`
   * и `messagesQueueOnRenderAdditional` (лесенка открытия — анимация).
   */
  private processBatch = async (loadQueue: (RenderedMessage | undefined)[], m: MiddlewareAwaiter) => {
    const filterQueue = (queue: (RenderedMessage | undefined)[]) =>
      queue.filter((details): details is RenderedMessage =>
        !!details && this.getBubble(makeFullMid(this.peerId, details.message.id)) === details.bubble)

    const queue = filterQueue(loadQueue)

    // Догрузка в режиме выделения: новым баблам сразу нужен чекбокс, иначе
    // подгруженная страница приехала бы без него (tweb bubbles.ts:5931-5935).
    if (this.selection?.isSelecting) {
      queue.forEach(({ bubble }) => this.selection!.toggleElementCheckbox(bubble, true))
    }

    const firstGroup: BubbleGroup | undefined = this.bubbleGroups.firstGroup
    const lastGroup: BubbleGroup | undefined = this.bubbleGroups.lastGroup
    const firstMid = firstGroup?.firstMid
    const lastMid = lastGroup?.lastMid

    const groups = this.groupBubbles(queue)

    const newFirstGroup: BubbleGroup | undefined = this.bubbleGroups.firstGroup
    const newLastGroup: BubbleGroup | undefined = this.bubbleGroups.lastGroup
    const newFirstMid = newFirstGroup?.firstMid
    const newLastMid = newLastGroup?.lastMid

    const changedTop = firstMid !== newFirstMid
    const changedBottom = !!lastGroup && lastMid !== newLastMid // if has no groups then save bottom scroll position

    const firstItem = queue[0]
    const firstReverse = firstItem?.reverse
    const isOneSide = queue.every(({ reverse }) => reverse === firstReverse)
    const reverse = isOneSide ? firstReverse : changedTop && !changedBottom

    // * это нужно для того, чтобы если захочет подгрузить reply или какое-либо
    // * сообщение, то скролл не прервался и не сдвинулся
    await m(Promise.all([getHeavyAnimationPromise(), this.setUnreadDelimiter()]).catch(noop)) // не нашёл места лучше
    await m(fastRafPromise()) // have to be the last

    // Повторный `filterQueue` оригинала (:5890) сюда не перенесён: его результат
    // в tweb читают только неперенесённые ветки (`bubblesToReplace`, выделение,
    // локальные сообщения) — набор серий `groups` посчитан ДО ожиданий и от него
    // не зависит ни там, ни здесь. Отдельной строкой он был бы мёртвым кодом.

    const { restoreScroll } = this.prepareToSaveScroll(
      reverse,
      firstMid === newFirstMid,
      lastMid === newLastMid,
    )

    // tweb bubbles.ts:5905-5907 (ровно здесь, между `prepareToSaveScroll` и
    // монтированием) — первая из двух точек, где доехавшая пачка запускает
    // лестницу. Гейт `canAnimateLadder` отсекает точечные дорисовки (новое
    // сообщение, правка): каскад — про СТРАНИЦУ.
    if (queue.some((details) => details.canAnimateLadder)) {
      this.messagesQueueOnRenderAdditional?.()
    }

    this.bubbleGroups.mountUnmountGroups(groups)

    restoreScroll?.()
  }

  /** Порт tweb bubbles.ts:5961. В оригинале аргумент — ПРОМИС результата
   *  (`renderMessage` там асинхронен: медиа, стикеры, кастом-эмодзи); у нас
   *  состав бабла синхронный, поэтому в очередь кладётся готовое значение —
   *  `BatchProcessor` принимает и то и другое (`Item | Promise<Item>`). */
  public renderMessagesQueue(details: RenderedMessage | undefined): Promise<void> {
    return this.batchProcessor.addToQueue(details)
  }

  /** Порт tweb `safeRenderMessage`: отрисовать сообщение, запомнить его бабл и
   *  ПОСТАВИТЬ ЕГО В ОЧЕРЕДЬ РЕНДЕРА. Повторный вызов по уже отрисованному
   *  адресу — no-op (в tweb ту же роль играет проверка `this.bubbles[fullMid]`
   *  перед рендером, bubbles.ts:6286).
   *
   *  В `chatInner` бабл НЕ кладётся, и в серию тоже: и то и другое делает
   *  очередь (`processBatch` → `groupBubbles` → `mountUnmountGroups`) — как в
   *  tweb, где `safeRenderMessage` только создаёт узел и кладёт его в
   *  `renderMessagesQueue` (bubbles.ts:6360).
   *
   *  Адрес в `this.bubbles` при этом проставляется СИНХРОННО (оригинал —
   *  :6341 `bubble = this.bubbles[fullMid] = newBubble`, тоже до очереди): на
   *  это опирается и дедуп повторного рендера, и подписка `history_update`,
   *  которая находит бабл ещё до того, как он попал в серию.
   *
   *  `.catch(noop)` на промисе очереди: пачку отвергает `PEER_CHANGED_ERROR`,
   *  когда поколение ленты умерло за время её обработки. Здесь результат никому
   *  не нужен (в tweb он тоже отбрасывается — :6360), а необработанное
   *  отвержение шумело бы в консоли. */
  private safeRenderMessage(message: MyMessage, reverse: boolean, canAnimateLadder?: boolean): RenderedMessage | undefined {
    // Альбом рисуется ОДНИМ баблом: бабл получает главное сообщение группы,
    // остальные не рисуются вовсе (tweb :6600-6605 — `renderMessage` уходит
    // `return` до создания узла). Адресуется такой бабл по mid ЛЮБОГО
    // сообщения группы, поэтому ключи прочих её сообщений ведут на тот же
    // узел (см. ниже).
    const main = this.mainGroupedMessage(message)
    if (main && main.id !== message.id) {
      const mainBubble = this.bubbles[makeFullMid(this.peerId, main.id)]
      if (mainBubble) {
        this.bubbles[makeFullMid(this.peerId, message.id)] = mainBubble
      }
      return undefined
    }

    const fullMid = makeFullMid(this.peerId, message.id)
    if (this.bubbles[fullMid]) return undefined

    const bubble = this.renderMessage(message)
    this.bubbles[fullMid] = bubble

    // Прочие сообщения группы адресуют ТОТ ЖЕ узел: правка, удаление и ре-кей
    // после ack приходят по СВОЕМУ номеру, и без этих ключей бабл альбома
    // нашёлся бы только по главному. `maxBubbleMid` (tweb :6608-6609) —
    // старший номер группы: по нему лента считает горизонт прочтения.
    const grouped = message._ === 'message' && message.grouped_id
      ? this.groupedMessages(message.grouped_id)
      : []
    for (const m of grouped) {
      if (m.id !== message.id) this.bubbles[makeFullMid(this.peerId, m.id)] = bubble
    }
    bubble.dataset.maxBubbleMid = String(this.maxBubbleMid(message))

    const details: RenderedMessage = { message, bubble, reverse, canAnimateLadder }
    this.renderMessagesQueue(details).catch(noop)
    return details
  }

  /** Дождаться, пока очередь рендера разберётся целиком — порт ожиданий tweb
   *  (bubbles.ts:785-787, 10152, 10157). Отдельный метод, а не голое
   *  `await this.messagesQueuePromise`, ровно из-за `.catch(noop)`: см.
   *  `safeRenderMessage`. Ждущий обязан после этого проверить свою
   *  актуальность сам — как и в оригинале (:789 `if(this.getBubble(fullMid)
   *  !== bubble) return`). */
  private async awaitMessagesQueue(): Promise<void> {
    const promise = this.messagesQueuePromise
    if (promise) {
      await promise.catch(noop)
    }
  }

  /** Порт tweb `renderNewMessage` (bubbles.ts:4528): промис рендера нового
   *  сообщения живёт в реестре, пока не разрешится, — на него смотрит
   *  обработчик `history_update` (:780-783). */
  private renderNewMessage(message: MyMessage, scrolledDown?: boolean): Promise<void> {
    const promise = this._renderNewMessage(message, scrolledDown)
    this.renderNewPromises.add(promise)
    promise.catch(noop).finally(() => {
      this.renderNewPromises.delete(promise)
    })
    return promise
  }

  /**
   * Порт tweb `_renderNewMessage` (bubbles.ts:4537) в применимом объёме.
   *
   * ПЕРВАЯ ВЕТКА (:4538-4551) — низ окна не сведён с концом истории: новое
   * сообщение рисовать НЕЛЬЗЯ, иначе оно встанет вплотную к куску истории,
   * между которым и им лежит незагруженное. tweb в этом случае ждёт `setPeer`
   * и перерисовывает; у нас `setPeer` не портирован, поэтому остаётся сам
   * выход — он и есть суть ветки.
   *
   * `scrolledDown` (:4580-4586) — «лента и так стоит внизу, значит новое
   * сообщение надо ДОВЕСТИ скроллом». Проверка «не едем ли мы сейчас к другому
   * баблу» дословная: доводить к концу можно, только если текущая цель скролла
   * — последний бабл или сама лента.
   *
   * Не портированы: треды/монофорум-фильтр (`getMessageThreadId` — окно треда у
   * нас отдельное, чужое сюда не приезжает), `cancelPreservePaddingScroll`
   * (нижняя распорка композера — окружение `Chat`), ветка `ChatType.Scheduled`.
   */
  private async _renderNewMessage(message: MyMessage, scrolledDown?: boolean): Promise<void> {
    if (!this.scrollable.loadedAll.bottom) { // seems search active or sliced
      return
    }

    // tweb :4558-4568 — окно ОТФИЛЬТРОВАНО по тегу, и новое сообщение попадает в
    // него только с этим тегом. Проверка у оригинала «все названные теги
    // присутствуют» (`savedReaction.every`), у нас тег один — отсюда одно
    // сравнение. Сравнивается ЭМОДЗИ чипа: реакция у нас это он (см. поле
    // `savedReaction`), а `reactionsEqual` оригинала разбирает конструктор.
    if(this.savedReaction && !hasReactionEmoticon(message.reactions, this.savedReaction)) {
      return
    }

    const fullMid = makeFullMid(this.peerId, message.id)
    if (this.getBubble(fullMid)) {
      return
    }

    if (!scrolledDown) {
      scrolledDown = this.scrolledDown && (
        !this.scrollingToBubble ||
        this.scrollingToBubble === this.getLastBubble() ||
        this.scrollingToBubble === this.chatInner
      )
    }

    const middleware = this.getMiddleware()
    const { isPaddingNeeded, unsetPadding } = this.setTopPadding(middleware)

    const promise = this.performHistoryResult([message], false)
    if (scrolledDown) {
      void promise.then(() => {
        if (!middleware()) return

        const scrollPromise = this.scrollToEnd()
        if (isPaddingNeeded) {
          // it will be called only once even if was set multiple times (that won't happen)
          void scrollPromise.then(unsetPadding)
        }
      })
    }

    return promise
  }

  // ─── BubbleGroupsHost: секции дней, актуальность, аватар серии ────────────

  /** Порт tweb `getDateForDateContainer` (bubbles.ts:4815). Аргумент —
   *  СЕКУНДЫ, ответ — локальная полночь этого дня. Милисекунды тоже обнуляем
   *  (tweb зовёт `setHours(0, 0, 0)`): ключ дня у групп считает `startOfDayMs`
   *  (`core/format/dayLabel.ts`), где они обнулены, — иначе реестр секций и
   *  группы разъехались бы по ключу. Пары `{date, dateTimestamp}`, как в tweb,
   *  здесь нет: сам `Date` нужен там только чтобы отдать его в
   *  `createDateBubble`, а наш строит подпись по числу. */
  private getDateForDateContainer(timestamp: number): number {
    const date = new Date(timestamp * 1000)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }

  /** Дата-разделитель дня. Разметку строит модуль сервисных сообщений
   *  (`serviceMessage.ts::createDateBubble`, порт tweb bubbles.ts:4778-4813) —
   *  здесь остаётся ровно то, чем владеет лента: подпись дня и ключ секции.
   *
   *  Подпись — ЖИВОЙ УЗЕЛ ядра (`core/format/dayLabel`, порт веток :4783-4798), а
   *  не строка: язык у неё ведёт `applyLangPack`, и спрашивать стор i18n на
   *  момент постройки, как делалось раньше, больше не нужно — смена языка
   *  доезжала бы только до заново построенных разделителей.
   *  `data-date` — ключ дня в форме `day-<timestamp>`: по нему секция дня
   *  адресуется в реестре `dateMessages` и в наблюдателе липких дат
   *  (`constructPeerHelpers`). */
  private createDateBubble(dateTimestamp: number): HTMLElement {
    const bubble = createServiceDateBubble(dayLabel(dateTimestamp))
    bubble.dataset.date = `day-${dateTimestamp}`
    return bubble
  }

  /** Порт tweb `getDateContainerByTimestamp` (bubbles.ts:4823). Аргумент —
   *  СЕКУНДЫ (так его зовёт `BubbleGroup.onItemMount`).
   *
   *  ТРЕТИЙ УЗЕЛ СЕКЦИИ — sticky-sentinel, и кладёт его именно
   *  `stickyIntersector.observeStickyHeaderChanges` (:4867 →
   *  `components/stickyIntersector.ts::addSentinel`), а не сама секция. На этом
   *  стоит арифметика позиций: `STICKY_OFFSET === 3` — АБСОЛЮТНЫЙ индекс первой
   *  серии внутри секции (`positionElementByIndex` в `bubbleGroups.ts`).
   *  Этап 3 создавал sentinel руками (наблюдателя ещё не было) — теперь эту
   *  строку заменил ЕЁ ОРИГИНАЛ: узел ставит наблюдатель, и второй sentinel в
   *  ту же секцию не попадает (иначе `STICKY_OFFSET` сдвинул бы все серии). */
  public getDateContainerByTimestamp(timestamp: number): DateContainer {
    const dateTimestamp = this.getDateForDateContainer(timestamp)
    const found = this.dateMessages[dateTimestamp]
    if (found) {
      return found
    }

    const bubble = this.createDateBubble(dateTimestamp)
    const fakeBubble = this.createDateBubble(dateTimestamp)
    fakeBubble.classList.add('is-fake')

    const container = document.createElement('section')
    container.className = 'bubbles-date-group'
    container.append(bubble, fakeBubble)

    const ret = this.dateMessages[dateTimestamp] = { container, groupsLength: 0, div: bubble }

    // Секции лежат по возрастанию дня; вставляем перед первой более поздней
    // (tweb bubbles.ts:4846-4864 — там тот же обход отсортированных ключей,
    // а не вставка по индексу: выше секций может лежать не-дневной узел).
    const laterTimestamp = Object.keys(this.dateMessages)
      .map(Number)
      .sort((a, b) => a - b)
      .find((t) => t > dateTimestamp)
    if (laterTimestamp === undefined) {
      this.chatInner.append(container)
    } else {
      this.chatInner.insertBefore(container, this.dateMessages[laterTimestamp].container)
    }

    this.stickyIntersector?.observeStickyHeaderChanges(container)

    this.container.classList.add('has-groups')

    return ret
  }

  /** Порт tweb `deleteEmptyDateGroups` (bubbles.ts:11616). Не портированы
   *  `checkIfEmptyPlaceholderNeeded` (плейсхолдера пустого чата нет) и
   *  `setStickyDateManually` (в оригинале тело метода закомментировано целиком,
   *  bubbles.ts:2865-2908 — переносить нечего). */
  public deleteEmptyDateGroups() {
    let deleted = false
    for (const key in this.dateMessages) {
      const dateMessage = this.dateMessages[key]
      if (dateMessage.groupsLength) {
        continue
      }

      dateMessage.container.remove()
      this.stickyIntersector?.unobserve(dateMessage.container, dateMessage.div)
      delete this.dateMessages[key]
      deleted = true
    }

    if (!deleted) {
      return
    }

    if (!Object.keys(this.dateMessages).length) {
      this.container.classList.remove('has-groups')
    }
  }

  /** Порт tweb `getMiddleware` (bubbles.ts:6030). */
  public getMiddleware(additionalCallback?: () => boolean): Middleware {
    return this.middlewareHelper.get(additionalCallback)
  }

  /** Порт связки tweb `avatarNew` + серия баблов (bubbleGroups.ts:140-146).
   *
   *  Зовёт его `BubbleGroup.createAvatar`, а решает о вызове `groupBubbles` по
   *  гейту `isAvatarNeeded` — как в оригинале (bubbles.ts:6008-6014).
   *
   *  `lazyLoadQueue` оригинала (:143) не передаётся: очереди ленивой загрузки у
   *  ленты нет, и аватарка грузит фотографию сама, тем же путём, что медиа
   *  бабла. */
  public createAvatar(message: MyMessage, middleware: Middleware): GroupAvatar {
    // tweb bubbleGroups.ts:140-145 — размер 40 и автор из `getAvatarOptions`
    // (:83-88). Ветка «переслано из канала» там подменяет пира на источник
    // пересылки; у нас предмета нет. `fwdFromId` — ПРОИЗВОДНОЕ поле tweb: в
    // сгенерированном типе оно есть (`layer.d.ts:1059`), но на провод не
    // выводится (значится в списке невыводимых полей конструктора `message`,
    // `backend/internal/pkg/tl/schema_gen.go:8477`) и не заполняется ни бэком,
    // ни клиентом. Поэтому автор берётся тем же способом, что и для имени в
    // шапке бабла (`needName` → `getMessageFromId`), — второго правила «кто
    // автор» не заводим.
    return avatarNew({
      peerId: this.bubbleGroups.getMessageFromId(message),
      size: 40,
      middleware,
      managers: this.managers,
    })
  }

  // ─── клики ────────────────────────────────────────────────────────────────

  /** Порт tweb `attachContainerListeners` (bubbles.ts:1460) в применимом
   *  объёме — ОДИН делегированный слушатель на контейнере ленты. Разбирает
   *  разметку, которую оставляет rich-text вместо inline-обработчиков tweb
   *  (см. докблок `BubblesNavigation`), и крышку спойлера медиа.
   *
   *  ПОРЯДОК ВЕТОК ЗНАЧИМ, и он взят у оригинала (`onBubblesClick`,
   *  bubbles.ts:3014-3627): первый совпавший выигрывает. Поэтому спойлер
   *  (:3236) стоит раньше имени автора (:3360) — крышка лежит поверх вложения,
   *  и клик по ней не должен доходить до того, что под ней.
   *
   *  ЧТО РАЗБИРАЕТ ЭТОТ СЛУШАТЕЛЬ (по веткам `onBubblesClick`): календарь по
   *  дата-баблу (:3057), вход в выделение кликом по времени (:3118), тоггл
   *  выбора в режиме выделения (:3156), крышку спойлера (:3236), чип реакции
   *  (:3245), прыжок к оригиналу по reply-заголовку (:3520), медиавьювер
   *  (:3479) и имя автора/упоминание (:3360). Рядом с ним лента вешает свои
   *  слушатели: выделение (:1479), даблклик-ответ (:1497) и свайп-ответ (:1543).
   *
   *  Контекстное меню и выделение вешаются ПЕРЕД ним и в этом же порядке —
   *  тем же, что у оригинала (:1478 `contextMenu.attachTo`, :1479
   *  `selection.attachListeners`). */
  private attachContainerListeners() {
    // Контекстное меню — tweb bubbles.ts:1478. Слушатели оно вешает себе само
    // (внутри `attachTo` собственный `ListenerSetter`), лента отдаёт только узел.
    this.contextMenu = this.chat.createContextMenu?.(this)
    this.contextMenu?.attachTo(this.container)

    this.listenerSetter.add(this.container)('click', this.onContainerClick)

    // Выделение — tweb bubbles.ts:1479. Слушатели ему лента вешает на СВОЙ
    // контейнер, но своим `ListenerSetter`: их снимает сам режим, когда его
    // отвязывают, — у оригинала ровно так же (`new ListenerSetter()` прямо в
    // аргументе).
    this.selection = this.chat.createSelection?.(this)
    this.selection?.attachListeners(this.container, new ListenerSetter())

    // Ответ жестом — tweb bubbles.ts:1496-1572. Развилка ровно оригинала и
    // ВЗАИМОИСКЛЮЧАЮЩАЯ: на десктопе ответ даёт даблклик, на таче — свайп.
    // Держать оба сразу нельзя: на таче даблклик стрелял бы по концу свайпа.
    //
    // Гейт `TEST_BUBBLES_DELETION` оригинала не переносится — это его
    // отладочная константа, а не поведение (в tweb она же выключает половину
    // ленты).
    if (!IS_MOBILE) {
      this.listenerSetter.add(this.container)('dblclick', this.onContainerDoubleClick)
    } else if (IS_TOUCH_SUPPORTED) {
      this.replySwipeHandler = attachReplySwipe(this.container, {
        isSelecting: () => !!this.selection?.isSelecting, // tweb :1547
        canSend: () => this.chat.canSend?.() ?? false,
        initMessageReply: (mid) => this.chat.initMessageReply?.(mid),
      })
    }
  }

  /**
   * Даблклик-ответ (десктоп) — порт обработчика tweb bubbles.ts:1497-1542.
   *
   * Решение «этот даблклик — ответ?» целиком в `findDoubleClickReplyBubble`:
   * в tweb оно перемешано с телом обработчика, у нас вынесено предикатом,
   * потому что тем же правилом пользуется тач-путь.
   */
  private onContainerDoubleClick = (e: Event) => {
    const bubble = findDoubleClickReplyBubble(e, {
      // `ChatType.Pinned`/`ChatType.Logs` у ленты пока не существуют как
      // понятия — вернуть вместе с ними.
      isPinnedOrLogs: false,
      isSelecting: !!this.selection?.isSelecting, // tweb :1502
      canSendPlain: this.chat.canSendPlain?.() ?? false,
      isRepliable: (b) => {
        // Отрицание tweb `message.pFlags.is_outgoing || message.peerId !==
        // this.peerId` (:1535-1538). Проверки пира здесь нет: лента владеет
        // ОДНИМ окном, чужой бабл в ней не появляется. «Ещё не отправлено» у
        // нас — дробный номер (`isLocalMessageId`), а не флаг.
        const mid = Number(b.dataset.mid)
        return !!mid && !isLocalMessageId(mid)
      },
    })
    if (!bubble) return

    this.chat.initMessageReply?.(Number(bubble.dataset.mid))
  }

  private onContainerClick = (e: Event) => {
    const target = e.target as HTMLElement | null
    if (!target) {
      return
    }

    const navigation = this.chat.navigation

    // Внутренняя ссылка Telegram (`data-anchor-action`) — tweb исполняет её
    // глобалью из `addAnchorListener`.
    const anchor = target.closest<HTMLElement>(`[${ANCHOR_ACTION_ATTRIBUTE}]`)
    if (anchor) {
      const action = anchor.getAttribute(ANCHOR_ACTION_ATTRIBUTE)!
      if (navigation?.openInternalLink?.(action, anchor)) {
        cancelEvent(e)
      }

      return
    }

    const bubble = target.closest<HTMLElement>('.bubble')

    // Дата-разделитель — календарь (tweb :3057-3110). Ветка стоит ПЕРВОЙ среди
    // «по баблу», как у оригинала (:3057 против :3118 у времени и :3156 у
    // выделения).
    //
    // Три проверки оригинала перенесены дословно:
    //  • клик засчитывается только по `.bubble-content` (:3057) — не по всей
    //    полосе секции;
    //  • `is-fake`-двойник (:3058-3060) уступает НАСТОЯЩЕМУ дата-баблу: реестр
    //    `dateMessages` знает только его;
    //  • по ЗАЛИПШЕЙ дате (:3062-3064) календарь открывается лишь во время
    //    скролла — иначе пилюля, висящая над лентой, перехватывала бы клики по
    //    сообщениям под собой.
    if (bubble?.classList.contains('is-date') && findUpClassName(target, 'bubble-content')) {
      const dateBubble = bubble.classList.contains('is-fake')
        ? bubble.previousElementSibling as HTMLElement | null
        : bubble
      if (!dateBubble || (dateBubble.classList.contains('is-sticky') && !this.chatInner.classList.contains('is-scrolling'))) {
        return
      }

      for (const timestamp in this.dateMessages) {
        if (this.dateMessages[timestamp].div === dateBubble) {
          navigation?.openDatePicker?.(+timestamp, this.onDatePick)
          break
        }
      }

      return
    }

    // Клик по времени на десктопе — вход в выделение (tweb :3118-3121).
    // Ветка стоит ПЕРЕД спойлером и реакциями, как у оригинала: время лежит в
    // теле сообщения, и на таче по нему открывается меню, а не выделение —
    // поэтому гейт по `IS_TOUCH_SUPPORTED` тоже оригинала.
    if (this.selection && bubble) {
      if (!IS_TOUCH_SUPPORTED && findUpClassName(target, 'time')) {
        this.selection.toggleByElement(bubble)
        return
      }

      // В режиме выделения ЛЮБОЙ клик по баблу тогглит выбор (tweb :3156-3172)
      // — и перебивает все ветки ниже: ни вьювер, ни прыжок к оригиналу в этом
      // режиме не срабатывают. `isTrusted` — страховка оригинала от
      // автокликов аудио-элемента.
      if (this.selection.isSelecting && e.isTrusted) {
        // Служебный бабл без номера выбирать нечем.
        if (bubble.classList.contains('service') && !bubble.dataset.mid) {
          return
        }

        cancelEvent(e)

        // На таче выделение текста заканчивается тем же кликом — он не должен
        // ещё и переключать выбор (tweb :3164-3167).
        if (IS_TOUCH_SUPPORTED && this.selection.selectedText) {
          this.selection.selectedText = undefined
          return
        }

        this.selection.toggleByElement(findUpClassName(target, 'grouped-item') || bubble)
        return
      }
    }

    // Бабл звонка — ПЕРЕЗВОНИТЬ (tweb bubbles.ts:3192-3196). Ветка стоит здесь,
    // как у оригинала: раньше крышки спойлера (:3236) и чипа реакции (:3245),
    // но ПОЗЖЕ гейта выделения (:3156) — в режиме выделения клик по баблу
    // звонка выбирает бабл, а не звонит.
    //
    // Каким звонить, знает САМ УЗЕЛ (`data-type`, tweb :3194) — второй раз
    // спрашивать это у сообщения незачем. `cancelEvent` у оригинала здесь нет,
    // и его нет здесь: под баблом звонка нет ничего, что могло бы перехватить
    // клик.
    const callDiv = target.closest<HTMLElement>('.bubble-call')
    if (callDiv) {
      navigation?.callUser?.(callDiv.dataset.type as 'voice' | 'video')
      return
    }

    // Крышка спойлера — tweb bubbles.ts:3236-3243. Ветка стоит ЗДЕСЬ, а не
    // ниже, потому что у оригинала она раньше имени (:3236 против :3360):
    // крышка лежит ПОВЕРХ вложения, и клик по ней не должен доходить до того,
    // что под ней.
    const mediaSpoiler = target.closest<HTMLElement>('.media-spoiler-container')
    if (mediaSpoiler) {
      onMediaSpoilerClick({ event: e, mediaSpoiler })
      return
    }

    // Чип реакции — tweb bubbles.ts:3245-3279: тоггл своей реакции. Ветка
    // стоит РАНЬШЕ reply и медиа: чипы лежат внутри тела сообщения, и клик по
    // ним не должен доставаться ни вложению, ни шапке.
    const chip = target.closest<HTMLElement>('.reaction[data-reaction]')
    if (chip) {
      cancelEvent(e)
      this.toggleReaction(chip)
      return
    }

    // Футер комментариев — tweb bubbles.ts:3315-3343. У оригинала эта ветка
    // стоит РАНЬШЕ всех оставшихся ниже (имя :3360, медиа :3479, reply :3520),
    // и порядок значим: футер лежит под телом бабла, но `.replies-footer .rp`
    // растянут на всю его площадь, так что клик по нему обязан выиграть.
    const commentsDiv = findUpClassName(target, 'replies')
    if (commentsDiv && bubble) {
      cancelEvent(e)
      this.openDiscussion(bubble)
      return
    }

    // Reply-заголовок — tweb bubbles.ts:3520-3616: прыжок к оригиналу. Ветка
    // стоит ПЕРЕД медиа: у бабла с вложением заголовок лежит над ним, и клик
    // по нему не должен открывать вьювер.
    const replyEl = target.closest<HTMLElement>('.reply[data-reply-to-mid]')
    if (replyEl) {
      cancelEvent(e)
      this.jumpToMessage(Number(replyEl.dataset.replyToMid))
      return
    }

    // Медиа — tweb bubbles.ts:3479-3482 (`checkTargetForMediaViewer`). Ветка
    // стоит после спойлера и перед именем: у оригинала тот же порядок, и он
    // существен — у медиа с крышкой первым обязан сработать спойлер.
    const attachment = target.closest<HTMLElement>('.attachment')
    if (attachment && this.openMediaViewerFor(attachment)) {
      cancelEvent(e)
      return
    }

    // Имя автора / упоминание — tweb bubbles.ts:3360-3364: peerId берётся из
    // `data-peer-id` у `.peer-title` либо из `data-follow` у упоминания
    // (`a.follow`, wrapRichText.ts:408-409).
    const nameDiv = target.closest<HTMLElement>('.peer-title[data-peer-id], [data-follow]')
    if (!nameDiv || nameDiv.classList.contains('bubble')) {
      return
    }

    const peerId = Number(nameDiv.dataset.peerId ?? nameDiv.dataset.follow)
    if (!peerId) {
      return
    }

    if (navigation?.openPeer?.(peerId, nameDiv)) {
      cancelEvent(e)
    }
  }

  /**
   * Открыть тред комментариев кликнутого поста — тело ветки tweb
   * bubbles.ts:3327-3341 (не-`REPLIES_PEER_ID`).
   *
   * Тред берётся тем же гейтом, что рисовал футер
   * (`getMessageWithCommentReplies` — у оригинала на этом месте
   * `getMessageWithReplies`, :3329): у альбома он живёт на ОДНОМ сообщении
   * группы, а бабл у альбома один.
   */
  private openDiscussion(bubble: HTMLElement): void {
    const message = this.getMessage(Number(bubble.dataset.mid))
    const found = message && this.getMessageWithCommentReplies(message)
    // `channel_id` уже гарантирован гейтом — повтор нужен только типу
    // (в схеме параметр опционален, делит бит с `comments`).
    if (!found?.replies.channel_id) return

    // tweb :3335 — пир треда это ГРУППА ОБСУЖДЕНИЯ, а не канал.
    this.chat.navigation?.openDiscussion?.({
      peerId: toPeerId(found.replies.channel_id, true),
      postMid: found.mid,
    })
  }

  /**
   * Тоггл своей реакции по клику на чип — порт `Chat.sendReaction`
   * (tweb chat.ts:1457) в объёме, который есть у нашего владельца.
   *
   * ЧТО ДЕЛАТЬ — ставить или снимать — лента решает по КЛИКНУТОМУ ЧИПУ
   * (`is-chosen`), а не по перечитыванию сообщения: у оригинала тот же
   * источник (`reactionsElement.getReactionCount(reactionElement)` даёт
   * `chosen_order` именно этого чипа). Иначе быстрый повторный клик успел бы
   * прочитать ещё не обновлённое состояние.
   *
   * Оптимистика и откат живут у ВЛАДЕЛЬЦА (воркерный менеджер применяет дельту
   * до сети и откатывает её на ошибке) — лента их не дублирует и результата не
   * ждёт: обновление приедет операцией, как и всякое изменение сообщения.
   *
   * Кастом-эмодзи реакции пропускаются: у чипа тогда нет эмодзи, а адресовать
   * реакцию документом наш владелец не умеет (задача #47).
   */
  private toggleReaction(chip: HTMLElement): void {
    const { react, unreact } = this.managers.messages
    if (!react || !unreact) return

    const mid = Number(chip.closest<HTMLElement>('.bubble')?.dataset.mid)
    const emoji = chip.querySelector('.reaction-sticker')?.textContent ?? ''
    if (!mid || !emoji) return

    const promise = chip.classList.contains('is-chosen')
      ? unreact(this.peerId, mid, emoji)
      : react(this.peerId, mid, emoji)
    promise.catch(noop)
  }

  /**
   * Прыжок к сообщению — хвост ветки reply оригинала (bubbles.ts:3604-3612:
   * `setInnerPeer({peerId: replyToPeerId, lastMsgId: replyToMid, …})`).
   *
   * У оригинала это ОДИН вход и для «оригинал в окне», и для «оригинал за его
   * пределами»: `setInnerPeer` доходит до `bubbles.setPeer`, а тот сам решает,
   * доскроллить до уже показанного бабла (кэш-ветка, :5156-5200) или пересобрать
   * окно вокруг номера. У нас ровно так же — `setMessageId`.
   *
   * ОГРАНИЧЕНИЕ, которое остаётся: чужой чат. Оригинал прыгает и в него (по
   * `reply_to_peer_id`), а лента владеет ОДНИМ окном — открыть другой чат может
   * только хост. Стека возврата (`followStack`, :3585) тоже нет: кнопка
   * «вернуться» живёт в окружении `Chat`.
   *
   * `.catch(noop)` — как `Chat.setPeer` у оригинала (chat.ts:1122): прыжок,
   * вытесненный следующим прыжком, отвергается `PEER_CHANGED_ERROR`, и это не
   * сбой.
   */
  private jumpToMessage(mid: number): void {
    void this.setMessageId({ lastMsgId: mid }).catch(noop)
  }

  /**
   * Открыть медиавьювер по кликнутому вложению — порт
   * `checkTargetForMediaViewer` (tweb bubbles.ts:3641+) в применимом объёме.
   *
   * Список для листания собирается ИЗ ОКНА, как у оригинала (:3843
   * `reverse: true` — порядок по возрастанию номера): вьювер листает то, что
   * уже загружено, а не ходит за медиа отдельно. Сбор общий с React-лентой
   * (`collectLightboxItems`) — второй такой же был бы вторым ответом на вопрос
   * «что считается просматриваемым медиа».
   *
   * Прыжок к сообщению, пересылка, удаление и догрузка медиа
   * (`jumpToMessage`/`onForward`/`onDelete`/`loadMoreMedia`) — это окружение
   * `Chat`: попапы, стек колонки и REST-пагинация. Оно отдаёт их одним полем
   * `ChatContext.mediaViewerActions`, и они расстилаются в аргументы вьювера
   * ниже. Все четыре у вьювера ОПЦИОНАЛЬНЫ: не переданы — он открывается,
   * листает загруженное и закрывается.
   */
  private openMediaViewerFor(attachment: HTMLElement): boolean {
    const bubble = attachment.closest<HTMLElement>('.bubble')
    const mid = Number(bubble?.dataset.mid)
    if (!mid) return false

    const message = this.getMessage(mid)
    const mediaId = message && getMediaId(message)
    if (mediaId == null) return false

    const msgs = mirrorWindow(this.chat.messagesStorageKey)
    if (!msgs) return false

    // Карточки авторов — точечно из зеркала, а не выгрузкой его целиком:
    // подписи вьюверу нужны только у тех, чьи сообщения он листает.
    const peers = new Map<number, NonNullable<ReturnType<typeof cachedPeer>>>()
    for (const m of msgs) {
      const fromId = m.fromId
      if (fromId == null || peers.has(fromId)) continue
      const peer = cachedPeer(fromId)
      if (peer) peers.set(fromId, peer)
    }

    const { items, index } = collectLightboxItems({
      msgs: [...msgs],
      mediaId,
      ctx: {
        meId: rootScope.myId,
        peers,
        lang: useI18nStore.getState().lang,
      },
      findElement: (m) => this.getBubble(makeFullMid(this.peerId, m.id))?.querySelector('.attachment') ?? null,
    })
    if (!items[index]) return false

    items[index].element = attachment // источник полёта — кликнутая миниатюра
    void openMediaViewer({ items, index, target: attachment, reverse: true, ...this.chat.mediaViewerActions })
    return true
  }

  /** Порт tweb bubbles.ts:10037. Порядок тела — как в оригинале: сначала края
   *  окна (`setLoaded('top'/'bottom')`, bubbles.ts:10069-10101), потом рендер
   *  (bubbles.ts:10139-10146), потом ОЖИДАНИЕ ОЧЕРЕДИ (:10152) — метод
   *  разрешается, когда пачка действительно отрисована.
   *
   *  Аргумент — как в tweb (:10065-10067): элемент списка либо готовое
   *  сообщение, либо ИДЕНТИФИКАТОР, который разрешается через зеркало
   *  (`typeof(mid) === 'number' ? this.chat.getMessage(mid) : mid`). Обе формы
   *  нужны и здесь: страницу `getHistory` отдаёт идентификаторами намеренно —
   *  у зеркала уже могут лежать более свежие копии тех же сообщений (правка
   *  приехала операцией, пока летел запрос), и рисовать надо лежащее, а не
   *  ответ сети; а `renderNewMessage` передаёт объект, который сам приехал
   *  событием, — ровно как оригинал.
   *
   *  Края в tweb выводятся из слайсов `historyStorage` (`SliceEnd.Top/Bottom`),
   *  потому что там страница может лечь в середину уже известного окна; у нашего
   *  `messages.getHistory` они приезжают готовыми полями ответа. Как и в
   *  оригинале, край только ВЗВОДИТСЯ (`if(isEnd.top) setLoaded('top', true)`) —
   *  ответ, не дошедший до края, не гасит уже известный край. */
  public async performHistoryResult(
    history: readonly (MyMessage | number)[],
    reverse: boolean,
    isEnd?: { top?: boolean, bottom?: boolean },
  ): Promise<void> {
    if (!this.scrollable.loadedAll.bottom || !this.scrollable.loadedAll.top) {
      if (isEnd?.top) this.setLoaded('top', true)
      if (isEnd?.bottom) this.setLoaded('bottom', true)
    }

    let first: MyMessage | undefined
    for (const item of history) {
      const message = typeof item === 'number' ? this.getMessage(item) : item
      if (!message) continue
      first ??= message
      // `canAnimateLadder: true` — tweb bubbles.ts:10058-10062: страницу
      // истории лестница анимирует, точечную дорисовку — нет.
      this.safeRenderMessage(message, reverse, true)
    }

    // Плашка «Обсуждение началось» — см. `threadServiceStartMessage`. Рисуется
    // ТОЙ ЖЕ пачкой, что и корень: у оригинала она и вставляется в тот же
    // слайс истории (appMessagesManager.ts:9782-9797), то есть приезжает в
    // ленту неотличимо от настоящего сообщения.
    if (isEnd?.top && first) {
      const service = this.threadServiceStartMessage(first)
      if (service) {
        this.safeRenderMessage(service, reverse, true)
      }
    }

    await this.awaitMessagesQueue()

    // tweb bubbles.ts:10159-10161 — вторая точка запуска лестницы: пачка
    // разобрана, а очередь до неё не дотянулась (например, все сообщения
    // страницы уже были отрисованы и `queue` оказалась пустой). Гейт
    // `loadedAll.top` — оригинала: пока верх не сведён, каскад запускать рано.
    //
    // Повторный вызов оригинала (`this.messagesQueueOnRenderAdditional?.()`,
    // :10161 — «can set it second time») не портирован: он обслуживает
    // счётчик `times = 2` из ветки `isAdditionRender`, которой у нас нет
    // (см. докблок `getHistory`), а без счётчика первый же вызов гасит поле и
    // второй становится пустым.
    if (this.scrollable.loadedAll.top && this.messagesQueueOnRenderAdditional) {
      this.messagesQueueOnRenderAdditional()
    }
  }

  /**
   * Плашка «Обсуждение началось» в ветке комментариев — порт
   * `appMessagesManager.generateThreadServiceStartMessage`
   * (appMessagesManager.ts:6109-6135).
   *
   * ЧТО ЭТО. КЛИЕНТСКОЕ служебное сообщение с действием
   * `messageActionDiscussionStarted`: сервер его не присылает и не может —
   * события с таким смыслом в чате нет, есть только сам пост. Оригинал строит
   * его один раз на тред (`threadsServiceMessagesIdsStorage`) и кладёт в СЛАЙС
   * истории треда сразу за корнем, когда верх треда сведён
   * (appMessagesManager.ts:9776-9797: `addSlice = [threadServiceMid, ...mids]`
   * в убывающем слайсе, то есть по возрастанию — корень, плашка, комментарии).
   *
   * ГДЕ ЭТО У НАС. В ленте, а не в менеджере, потому что вставка в слайс — это
   * ровно «дорисовать бабл страницей истории», а слайсами треда на главном
   * потоке владеет она (см. шапку файла про зеркало). Условие оригинала
   * перенесено дословно: `threadId` И `isTopEnd`. Роль реестра
   * `threadsServiceMessagesIdsStorage` играет детерминированный номер плашки
   * вместе с проверкой `safeRenderMessage` («бабл с таким адресом уже есть»):
   * второй раз она не появится.
   *
   * КОРЕНЬ — ПЕРВОЕ сообщение сведённой с верхом страницы. У оригинала он
   * берётся адресно (`getMessageByPeer(peerId, options.threadId)`), у нас так
   * нельзя: клиент адресует тред номером ПОСТА (внешний контракт), а в окне
   * лежит его ЗЕРКАЛО в группе обсуждения — с другим номером
   * (`usecase/chat/sync.go:27-33`, `resolveThreadRootForQuery`). Зато бэкенд
   * гарантирует, что корень в сведённом с верхом окне ЕСТЬ и стоит первым:
   * SQL берёт его условием `thread_root_id=root OR id=root`, а не попавший в
   * страницу — подшивает синтетическим `seq=0`
   * (`usecase/chat/sync.go:112-135`, `prependForeignThreadRoot`).
   *
   * НОМЕР — дробь поверх корня (`generateTempMessageId`, порт того же вызова в
   * оригинале, :6121): плашка обязана встать сразу за ним, а сортировка окна
   * идёт по номеру. Отрицательного номера, как у прочих локальных сообщений
   * tweb, у нас нет вовсе — клиентское пространство номеров это дроби
   * (`core/history/messageId.ts`).
   *
   * `from_id` не ставится: у оригинала там `peerUser(NULL_PEER_ID)` — заглушка
   * ради типа, а фраза плашки автора не упоминает (`serviceMsg.ts:110`).
   */
  private threadServiceStartMessage(root: MyMessage): MessageService | undefined {
    if(!this.chat.threadId) {
      return undefined
    }

    return {
      _: 'messageService',
      pFlags: {},
      id: generateTempMessageId(root.id),
      peer_id: getOutputPeer(this.peerId),
      peerId: this.peerId,
      date: root.date,
      action: { _: 'messageActionDiscussionStarted' },
    }
  }

  /** Порт tweb `getHistory1` (bubbles.ts:11326) — обёртка над `getHistory`,
   *  которая ВЛАДЕЕТ гейтом повторного триггера пагинации.
   *
   *  Механика дословная и в ней две неочевидные детали:
   *   • `middleware` собирается ДО запроса, а его дополнительный предикат
   *     сверяет `getHistoryTopPromise === waitPromise` — то есть «этот запрос
   *     всё ещё ТЕКУЩИЙ для своей стороны». Ссылка на `waitPromise` внутри
   *     предиката — из TDZ-замыкания: к моменту ВЫЗОВА предиката переменная уже
   *     инициализирована. Так поздний ответ вытесненного запроса не рисует
   *     ничего в окно.
   *   • поле стороны гасится ТОЛЬКО если middleware ещё жив (:11336-11340):
   *     иначе завершившийся старый запрос обнулил бы гейт нового.
   *
   *  Предзагрузка следующей страницы (`justLoad`, :11346-11358) перенесена как
   *  есть: она и делает пагинацию бесшовной — пока пользователь смотрит на
   *  доехавшую страницу, следующая уже в кэше. `ChatType.Chat`-гейт снят: типов
   *  чата (`Scheduled`/`Pinned`/`Search`) у ленты нет.
   *
   *  `replaceWindow` — наш параметр, у оригинала его нет (см. докблок
   *  `getHistory`): «эта страница НАЧИНАЕТ окно, а не продолжает его». Едет
   *  сквозь обёртку нетронутым — решает вызывающий, а не она. */
  public getHistory1(maxId?: FullMid, reverse?: boolean, isBackLimit?: boolean, justLoad?: boolean, replaceWindow?: boolean) {
    const middleware = this.getMiddleware(justLoad ? undefined : () => {
      return (reverse ? this.getHistoryTopPromise : this.getHistoryBottomPromise) === waitPromise
    })

    const result = this.getHistory(maxId, reverse, isBackLimit, justLoad, middleware, replaceWindow)
    const waitPromise: Promise<unknown> = result.then((res) => res && (res.waitPromise || res.promise))

    if (reverse) this.getHistoryTopPromise = waitPromise
    else this.getHistoryBottomPromise = waitPromise

    void waitPromise.then(() => {
      if (!middleware()) {
        return
      }

      if (reverse) this.getHistoryTopPromise = undefined
      else this.getHistoryBottomPromise = undefined

      if (!justLoad) {
        // preload more
        setTimeout(() => {
          if (reverse) {
            this.loadMoreHistory(true, true)
          } else {
            this.loadMoreHistory(false, true)
          }
        }, 0)
      }
    }, noop)

    return result
  }

  /** Порт tweb `requestHistory` (вызов `appMessagesManager.getHistory` из
   *  bubbles.ts:11457) — единственное место, где адрес бабла (`FullMid`)
   *  превращается в аргументы страницы.
   *
   *  Номер у сообщения ОДИН и он же адрес бабла (см. докблок `FullMid`),
   *  поэтому `offsetId` — буквально `mid` из адреса, как `offset_id` в
   *  оригинале. Через зеркало он НЕ разрешается: цель прыжка по определению
   *  может лежать вне загруженного окна, и «нет в зеркале» означало бы
   *  `offsetId: 0`, то есть молчаливую подмену страницы прыжка страницей от
   *  низа истории.
   *
   *  ФОРМА `(maxId, loadCount, backLimit)` — оригинальная, отображений у неё
   *  ТРИ, и последнее — расхождение:
   *   • первая страница — `offsetId: 0`;
   *   • «старее» — `addOffset: 1` (наш бэкенд включает сам `offset_id`,
   *     менеджер срезает пересечение);
   *   • «новее» (`backLimit` БЕЗ `loadCount` — так `getHistory` зовёт пагинацию
   *     вниз, обнулив `loadCount`, bubbles.ts:11416-11422) — `addOffset:
   *     -backLimit`;
   *   • ОКНО ВОКРУГ номера (`backLimit` ВМЕСТЕ с `loadCount` — так его зовёт
   *     прыжок из `setPeer`) — отдельная ручка `getAround`, а не арифметика
   *     `addOffset`. Причина — в докблоке `BubblesManagers.messages.getAround`:
   *     tweb разворачивает `backLimit` в `addOffset = -backLimit, limit +=
   *     backLimit` (appMessagesManager.ts:9319-9322) и получает окно по обе
   *     стороны от номера; наш бэкенд из отрицательного `add_offset` читает
   *     только знак («новее»), а окно вокруг номера отдаёт по `?around=`.
   *     Размер окна тот же, что у оригинала после разворота, — `loadCount +
   *     backLimit`. */
  private requestHistory(maxId: FullMid, loadCount: number, backLimit: number): Promise<HistoryResult> {
    // ФИЛЬТР ПО ТЕГУ — ВТОРАЯ ФОРМА СТРАНИЦЫ, и она у оригинала тоже отдельная:
    // `requestHistory` под `savedReaction` уходит НЕ методом
    // `messages.getHistory`, а `messages.search` (appMessagesManager.ts:9947,
    // :9970-9984). Отсюда и здесь — ветка до всей арифметики `offsetId`:
    // адресация у отфильтрованной страницы своя (см. `savedReactionOffset`).
    if(this.savedReaction) {
      return this.requestSavedReactionHistory(loadCount || backLimit)
    }

    const { mid } = splitFullMid(maxId)
    const offsetId = mid || 0

    if(backLimit && loadCount) {
      return this.managers.messages
        .getAround(this.chat.peerId, offsetId, loadCount + backLimit, this.chat.threadId)
        .then((around) => ({ ...around, count: around.messages.length }))
    }

    return this.managers.messages.getHistory({
      peerId: this.chat.peerId,
      threadRoot: this.chat.threadId,
      offsetId,
      addOffset: backLimit ? -backLimit : (offsetId ? 1 : 0),
      limit: loadCount || backLimit,
    })
  }

  /**
   * Страница ОТФИЛЬТРОВАННОЙ по тегу истории — та же роль, что у `requestHistory`
   * выше, но у оригинала это не отдельный метод, а другая ветка того же
   * (см. `BubblesManagers.messages.searchMessages`).
   *
   * Три вывода из ответа, и каждый — оригинала по смыслу:
   *  • ПОРЯДОК. Выдача поиска идёт от нового к старому (`ORDER BY m.seq DESC`,
   *    `messagesrepo.go:186`), а `HistoryResult.messages` у нас — по
   *    возрастанию (контракт `messages.getHistory`); отсюда `reverse()`.
   *    В tweb тем же занимается `SlicedArray`, который хранит убывающий слайс,
   *    а наружу отдаёт то, что попросили.
   *  • НИЗ СВЕДЁН ВСЕГДА. Первая страница фильтра берётся от `offset: 0`, то
   *    есть от самого нового отмеченного сообщения: ниже него по фильтру ничего
   *    нет. У tweb тот же вывод делает `historyStorage.searchHistory`
   *    (bubbles.ts:5082-5083 берёт `first[0]` как «верх» окна поиска).
   *  • ВЕРХ СВЕДЁН, когда выбрано всё: `count` — общее число совпадений
   *    (`messagesrepo.go:182-185`), поэтому `offset + длина >= count` и есть
   *    «страниц больше нет».
   */
  private async requestSavedReactionHistory(limit: number): Promise<HistoryResult> {
    const reaction = this.savedReaction
    const search = this.managers.messages.searchMessages
    if(!reaction || !search) {
      return { messages: [], count: 0, reachedTop: true, reachedBottom: true }
    }

    const offset = this.savedReactionOffset
    const { messages, count } = await search(this.chat.peerId, '', { reaction, offset, limit })
    this.savedReactionOffset = offset + messages.length

    return {
      messages: messages.slice().reverse(),
      count,
      reachedTop: this.savedReactionOffset >= count,
      reachedBottom: offset === 0,
    }
  }

  /**
   * Load and render history — порт tweb `getHistory` (bubbles.ts:11380).
   * @param maxId max message id
   * @param reverse 'true' means up
   * @param isBackLimit is search
   * @param justLoad do not render
   * @param replaceWindow страница НАЧИНАЕТ окно (`setPeer`), а не продолжает
   *        его (пагинация) — см. докблок `sup()` ниже
   */
  public async getHistory(
    maxId: FullMid = EMPTY_FULL_MID,
    reverse = false,
    isBackLimit = false,
    justLoad = false,
    middleware?: () => boolean,
    replaceWindow = false,
  ): Promise<{ cached: boolean, promise: Promise<void>, waitPromise: Promise<unknown> } | null> {
    // Размер страницы — 1:1 (:11389-11391). `Math.max(35, pageCount)` для уже
    // непустой ленты: подгружаемая страница не должна быть заметно меньше
    // экрана, иначе триггер пагинации сработает повторно сразу же.
    const isBroadcast = this.chat.isBroadcast
    const pageCount = Math.min(40, windowSize.height / 40 | 0)
    const realLoadCount = isBroadcast ? 20 : (this.getRenderedHistory(undefined, true).length > 0 ? Math.max(35, pageCount) : pageCount)
    let loadCount = realLoadCount

    let backLimit = 0
    if (isBackLimit) {
      backLimit = loadCount

      if (!reverse) { // if not jump
        loadCount = 0
      }
    }

    const historyResult = await this.requestHistory(maxId, loadCount, backLimit)

    // tweb bubbles.ts:11467, :11479 — ЕДИНСТВЕННЫЙ гейт лестницы, и он тройной:
    //  • `isFirstLoad` — эта лента ещё ничего не рисовала (взводится сменой
    //    пира, :5237);
    //  • `!cached` — страница приехала СЕТЬЮ. Из кэша окно встаёт мгновенно, и
    //    анимировать нечего: каскад маскирует ожидание, а его не было;
    //  • `loadCount > 0` — это страница, а не догрузка «новее» с обнулённым
    //    `loadCount` (:11418).
    // Слагаемое `isAdditionRender` формулы оригинала опущено вместе с самой
    // веткой дополнительного рендера (см. разбор ниже).
    const isFirstMessageRender = this.isFirstLoad && !historyResult.cached && loadCount > 0
    this.isFirstLoad = false

    // Ветка `additionalFullMid` (:11425-11453) не портирована, и причина у неё
    // НЕ «`setPeer` ещё нет» — он есть (:5219-5220 его и вычисляют). Причина в
    // том, что оба дела этой ветки здесь беспредметны.
    //
    // Дело первое — вернуть последнее сообщение чата, срезанное запросом
    // `< max_id` (комментарий оригинала на :5218). Оно возникает потому, что
    // БЕЗ прыжка tweb шлёт `maxId = topMessageFullMid`: тернарник :5340 берёт
    // `EMPTY_FULL_MID` только при `!additionalFullMid`, а тот при `!isJump`
    // как раз определён. Наш `setPeer` в этом случае шлёт `EMPTY_FULL_MID`
    // всегда (`!isJump && lastMsgFullMid === topMessageFullMid` — это одно и то
    // же условие: `isJump` и есть их неравенство), то есть страница берётся ОТ
    // САМОГО НИЗА и последнее сообщение приезжает в ней самой. Второй источник
    // `additionalMid` — `overrideAdditionMsgId` — приходит из непортированной
    // ветки `followingUnread` (:5121-5133, см. докблок `setPeer`).
    //
    // Дело второе — `isAdditionRender` (:11465): нарисовать УЖЕ ИЗВЕСТНЫЙ хвост
    // мгновенно (:11470-11474 подменяют `result` на готовый список), а сетевую
    // страницу догнать вторым промисом (`waitPromise`, :11538). Хвост берётся
    // из СЛАЙСА зеркала и только если нижний слайс сведён с низом истории и не
    // сведён с верхом (:11433-11437). У нас границ слайсов на главном потоке
    // нет: `SlicedArray` живёт в воркерном `messagesManager`, а зеркало окна —
    // плоский список без ответа на вопрос «сведён ли низ». Пока этого ответа
    // нет, `waitPromise` остаётся самим `promise` — ровно как в оригинале при
    // `isAdditionRender === false` (:11538).
    const sup = async () => {
      await getHeavyAnimationPromise()

      // Наше зеркало наполняет тот, кто загрузил страницу (см. докблок
      // `putMirrorPage`); в tweb это делает сам менеджер, поэтому здесь у
      // оригинала строки нет — но `performHistoryResult` там точно так же
      // читает УЖЕ ЛЕЖАЩЕЕ, а не ответ сети.
      //
      // ДОСЛИТЬ или НАЧАТЬ ЗАНОВО — объявляет ВЫЗЫВАЮЩИЙ (`replaceWindow`), и
      // угадать здесь нечего: обе стороны ходят одной дорогой. В оригинале это
      // различие проведено дважды, на двух разных этажах.
      //  • Этаж хранилища: страница ложится в `SlicedArray.insertSlice`
      //    (appMessagesManager.ts:9603), а та приклеивает её к слайсу, ТОЛЬКО
      //    если та стыкуется с ним по границам (slicedArray.ts:207-224);
      //    страница вокруг далёкого номера ни с чем не стыкуется и становится
      //    ОТДЕЛЬНЫМ слайсом (slicedArray.ts:225-235).
      //  • Этаж окна: `setPeer` выкидывает прежнее окно целиком — `cleanup()`
      //    (bubbles.ts:5243) обнуляет `this.bubbles` (:4920), и следом заводится
      //    НОВЫЙ `chatInner` (:5244). Именно этот этаж играет наше зеркало:
      //    источник пагинации у оригинала — отрисованное (`getRenderedHistory`,
      //    :3981, из `loadMoreHistory` :4017), а у нас лента и React читают
      //    окно (`useMirrorWindow`).
      // Отсюда замена НА ПРИХОДЕ страницы, а не заранее: у оригинала прежнее
      // окно видно всё время полёта запроса (новое дерево собирается в
      // оторванном `chatInner` и въезжает целиком), и очистка зеркала до
      // ответа дала бы React пустое окно — мигание приветствием бота и
      // клавиатурой ответа в `Chat.tsx`.
      if (replaceWindow) {
        replaceMirrorWindow(this.chat.messagesStorageKey, historyResult.messages)
      } else {
        putMirrorPage(this.chat.messagesStorageKey, historyResult.messages)
      }

      return this.performHistoryResult(
        historyResult.messages.map((m) => m.id),
        reverse,
        { top: historyResult.reachedTop, bottom: historyResult.reachedBottom },
      )
    }

    const processPromise = async () => {
      if (middleware && !middleware()) {
        throw PEER_CHANGED_ERROR
      }

      if (justLoad) {
        // нужно делать из-за ранней прогрузки
        this.scrollable.onScroll()
        return
      }

      return sup()
    }

    if (justLoad) {
      void processPromise().catch(noop)
      return null
    }

    const promise = processPromise()

    // tweb bubbles.ts:11540-11559 — лестница ВООРУЖАЕТСЯ здесь, а стреляет
    // тогда, когда пачка домонтировалась: сама `getHistory` не знает, доехали
    // ли уже баблы. `liteMode.isAvailable('animations')` — гейт оригинала
    // (:11540): при выключенных анимациях окно просто появляется.
    //
    // Счётчик `times` оригинала (:11541, :11545) не портирован: он равен двум
    // только под `isAdditionRender`, которого у нас нет, а при единице
    // `if(--times) return` — тождественно ложное условие.
    //
    // Предзагрузка соседней страницы по концу каскада (:11551-11554) —
    // оригинала: пока играет лестница, сеть свободна.
    if (isFirstMessageRender && liteMode.isAvailable('animations')) {
      this.messagesQueueOnRenderAdditional = () => {
        this.messagesQueueOnRenderAdditional = undefined

        void this.animateAsLadder(backLimit, maxId).then(() => {
          setTimeout(() => { // preload messages
            this.loadMoreHistory(reverse, true)
          }, 0)
        })
      }
    } else {
      this.messagesQueueOnRenderAdditional = undefined
    }

    return { cached: !!historyResult.cached, promise, waitPromise: promise }
  }

  /**
   * Порт tweb `ChatBubbles.setPeer` (bubbles.ts:5036) — ЕДИНСТВЕННЫЙ вход, через
   * который лента набирает окно: и первая страница чата, и прыжок к сообщению.
   *
   * ЧТО ПОРТИРОВАНО:
   *  • поколение окна (`setPeerTempId` → `middleware` → `middlewarePromise`,
   *    :5039-5056): всё, что летит в старое окно, отвергается
   *    `PEER_CHANGED_ERROR` — в том числе страница, доехавшая после нового
   *    прыжка;
   *  • разбор цели (:5070-5141): `lastMsgFullMid`/`topMessageFullMid` →
   *    `isTarget`/`isJump`/`isGoingToBottomEnd`, включая правку «уходим в самый
   *    низ, а сообщения нет» (:5143-5149);
   *  • КЭШ-ВЕТКА (:5156-5200): цель уже показана — лента НЕ перерисовывается,
   *    только доводится скроллом и подсвечивается;
   *  • пересборка окна (:5241-5250, :5339-5344, :5386-5420): `cleanup()`,
   *    НОВЫЙ `chatInner` (страница собирается в оторванном узле, поэтому
   *    `prepareToSaveScroll` её не якорит — см. его гейт `isMounted`), запрос
   *    страницы, подмена детей `Scrollable` уже готовым деревом;
   *  • доводка (:5439-5498): `scrollFromDown`/`scrollFromUp`, поиск ближайшего
   *    смонтированного бабла, позиция `center`/`end`, подсветка цели.
   *
   * ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ (каждый пункт — с предметом, а не «потом»):
   *  • СМЕНА ПИРА. Ветка `!samePeer` портирована ровно в тех строках, которые
   *    ничего не требуют от окружения (класс нового `chatInner` :5249,
   *    мгновенный скролл `FocusDirection.Static` :5468, спиннер первой
   *    загрузки :5378-5379, сохранённая позиция :5100-5103/:5437-5438). Всё
   *    остальное в ней — `chat.onChangePeer` (:5061), `chat.finishPeerChange`
   *    (:5372/:5389), фон чата `revealPreparedBackground` (:5377/:5407),
   *    ранги админов (:5282-5335), `sharedMediaTab` — это окружение `Chat`, которого
   *    у ленты нет. У нас пир меняет ХОСТ, пересоздавая ленту эффектом по
   *    `peerId` (`VanillaFeed.tsx`), поэтому «тот же инстанс на новый пир»
   *    предмета пока не имеет.
   *  • `followingUnread` (:5121-5133, :5453/:5463/:5471) — открытие чата на первом
   *    непрочитанном.
   *    Требует `!samePeer` И `dialog.unread_count !== 1`; счётчика диалога
   *    ленте никто не отдаёт (`BubblesManagers.dialogs` знает только горизонт
   *    чтения). Сама черта непрочитанных при этом работает и здесь — её ставит
   *    `setUnreadDelimiter` на любой отрисованной странице.
   *  • `additionalFullMid` (:5219-5220) — дорисовать последнее сообщение поверх
   *    страницы прыжка; ветка его обработки не портирована и в `getHistory`
   *    (см. её докблок).
   *  • `followStack` (:5157-5159) — стек возврата: кнопка «вернуться» живёт в
   *    окружении `Chat`.
   *  • sponsored (:5279), плейсхолдеры (:5410-5414),
   *    `mediaTimestamp`/`startParam`/`pollOption`,
   *    `ChatType.Search/Pinned/Scheduled/Logs`, `lazyLoadQueue`,
   *    `dispatchEvent('setPeer')`, `setFetchHistoryInterval` — подсистем нет.
   *
   * Возвращает то же, что оригинал: `null`, если окно перерисовывать не
   * пришлось (кэш-ветка), иначе `{cached, promise}` — промис доводки.
   */
  public async setPeer(options: {
    /** порт `ChatSetPeerOptions.lastMsgId` — номер, ВОКРУГ которого собирается
     *  окно; без него лента уходит в самый низ истории */
    lastMsgId?: number,
    /** порт вычисленного `Chat.setPeer` признака (chat.ts:1032
     *  `appImManager.isSamePeer`): «этот же чат уже показан». У нас его знает
     *  ХОСТ — первый вызов после создания ленты идёт с `false`, прыжок внутри
     *  открытого чата (`setMessageId`) — с `true`. */
    samePeer?: boolean,
    /**
     * Порт КЛЮЧА ПОИСКА `savedReaction` из `ChatSearchKeys` (tweb chat.ts:73).
     * Механика оригинала дословная и держится на `hasOwnProperty`
     * (chat.ts:1093-1098): САМО ПРИСУТСТВИЕ ключа в `options` означает «поиск
     * задан заново», даже если значение то же; отсюда `'savedReaction' in
     * options` ниже, а не сравнение значений.
     */
    savedReaction?: string,
  } = {}): Promise<{ cached: boolean, promise: Promise<void> } | null> {
    const { lastMsgId, samePeer = false } = options

    // tweb chat.ts:1092-1099. Ключ поиска переписывается, если пир сменился ЛИБО
    // вызывающий назвал ключ; `sameSearch` — «выдача та же, что была». Дальше он
    // работает ровно там же, где в оригинале: гасит кэш-ветку (:5155) и
    // `canScroll` (:5254) — окно надо пересобрать, а не доводить скроллом.
    let sameSearch = true
    if(!samePeer || 'savedReaction' in options) {
      this.savedReaction = options.savedReaction
      sameSearch = false
    }
    const peerId = this.peerId
    const tempId = ++this.setPeerTempId

    const middleware = () => {
      return this.setPeerTempId === tempId
    }

    const m = middlewarePromise(middleware, PEER_CHANGED_ERROR)

    // Порт `Chat.setPeerPromise` (chat.ts:1124-1129) — «идёт смена окна».
    // Взводится СИНХРОННО, до первого `await`: единственный читатель,
    // `animateAsLadder`, спрашивает его из очереди рендера, то есть ещё внутри
    // запроса истории. В оригинале это делает обёртка `Chat.setPeer`, у нас
    // обёртки нет (см. поле `setPeerPromise`), поэтому отложенный промис.
    const setPeerDeferred = this.setPeerPromise = deferredPromise<void>()
    const finishSetPeer = () => {
      if(this.setPeerPromise === setPeerDeferred) {
        this.setPeerPromise = undefined
      }

      setPeerDeferred.resolve?.()
    }

    let lastMsgFullMid: FullMid = lastMsgId ? makeFullMid(peerId, lastMsgId) : EMPTY_FULL_MID

    // tweb :5079-5081 берёт `historyStorage.maxId` синхронно; у нас последнее
    // сообщение чата знает воркерный `dialogsManager` (`dialog.lastMessage.id`),
    // поэтому вопрос задаётся RPC — как и горизонт чтения в `setUnreadDelimiter`.
    //
    // Вторым числом здесь едет ГОРИЗОНТ ПРОЧТЕНИЯ — снимок под наблюдатель
    // непрочитанных (см. поле `renderReadMaxSeq`; в оригинале его спрашивает
    // сам `renderMessage`, :6675). Тем же вызовом, что у границы непрочитанных:
    // владелец факта один.
    const [historyMaxId, readMaxSeq] = await m(Promise.all([
      this.managers.dialogs.getHistoryMaxSeq(peerId),
      this.managers.dialogs.getReadMaxSeqIfUnread(peerId),
    ]))
    const topMessageFullMid: FullMid = historyMaxId ? makeFullMid(peerId, historyMaxId) : EMPTY_FULL_MID
    const isTarget = lastMsgFullMid !== EMPTY_FULL_MID

    // tweb :5100-5135. Цели нет — прежде чем уходить к последнему сообщению
    // чата, спрашиваем СОХРАНЁННУЮ ПОЗИЦИЮ.
    //
    // Оба гейта — оригинала, и оба существенные:
    //  • `!isTarget` (:5101): у прыжка цель названа явно, и подменять её тем,
    //    где чат был оставлен, нельзя;
    //  • `!samePeer` (:5102): позиция — про ВОЗВРАЩЕНИЕ в чат. Прыжок внутри
    //    уже открытого чата (`setMessageId`) читать её не должен — иначе
    //    кнопка «вниз» уводила бы обратно в середину.
    // Третий гейт оригинала — тип чата (`Chat/Discussion/Saved`,
    // appImManager.ts:2152): у ленты типов чата нет как понятия.
    //
    // Ветка `savedPosition?.mids` (:5109) в оригинале ПУСТА — она лишь
    // перехватывает управление у «уйти к последнему сообщению» ниже. Здесь она
    // выражена тем же условием в `else if`.
    let savedPosition: ChatPosition | undefined
    if(!isTarget) {
      if(!samePeer) {
        savedPosition = getChatPosition(peerId, this.chat.threadId)
      }

      if(!savedPosition && topMessageFullMid !== EMPTY_FULL_MID) {
        lastMsgFullMid = topMessageFullMid
      }
    }

    // tweb :5137-5138. `followingUnread` в формуле нет — ветки, которая его
    // взводит, здесь тоже нет (см. докблок).
    const isGoingToBottomEnd = lastMsgFullMid === topMessageFullMid || lastMsgFullMid === EMPTY_FULL_MID
    const isJump = lastMsgFullMid !== topMessageFullMid

    // tweb :5140-5147: «уходим в самый низ, но такого сообщения у нас нет» —
    // тогда цели нет вовсе, и страница берётся от низа истории.
    if(isGoingToBottomEnd && lastMsgFullMid !== EMPTY_FULL_MID && !this.getMessage(splitFullMid(lastMsgFullMid).mid)) {
      lastMsgFullMid = EMPTY_FULL_MID
    }

    // tweb :5156-5200 — цель УЖЕ в окне. Ленту не трогаем: только скролл и
    // подсветка. Ветка `skippedMids` (:5161-5164) не портирована — пропущенных
    // при рендере сообщений у нас не бывает.
    //
    // `sameSearch` (:5155) — вторая половина гейта оригинала: смена тега
    // «Избранного» меняет ВЫДАЧУ, и отрисованное окно к ней отношения не имеет,
    // сколько бы целей в нём ни было смонтировано.
    if(samePeer && sameSearch) {
      const mounted = await m(this.getMountedBubble(lastMsgFullMid))
      const bubble = mounted?.bubble
      if(bubble) {
        if(isTarget) {
          void this.scrollToBubble(bubble, 'center')
          this.highlightBubble(bubble)
        } else if(topMessageFullMid !== EMPTY_FULL_MID && !isJump) {
          void this.scrollToEnd()
        }

        finishSetPeer()
        return null
      }
    }

    // tweb :5222-5234 — с какого бабла лента сейчас смотрит вниз: по нему
    // ниже решается, ехать скроллу сверху или снизу.
    let maxBubbleFullMid: FullMid = EMPTY_FULL_MID
    if(samePeer) {
      const el = this.getBubbleByPoint('bottom')
      if(el?.dataset.mid) {
        maxBubbleFullMid = makeFullMid(peerId, +el.dataset.mid)
      }

      if(maxBubbleFullMid === EMPTY_FULL_MID) {
        maxBubbleFullMid = this.getRenderedHistory('desc', true)[0] ?? EMPTY_FULL_MID
      }
    } else {
      // tweb :5236-5238 — чат открыт заново, значит следующая же страница будет
      // ПЕРВОЙ для этого окна; из этого признака `getHistory` выводит лестницу.
      // `forceIsFirstLoad` оригинала (:5235) не портирован: его взводит
      // `Chat.setPeer` при возврате по стеку, а стека возврата у ленты нет
      // (см. `followStack` в докблоке).
      this.isFirstLoad = true
    }

    // tweb :5241-5250. Новое окно собирается в ОТОРВАННОМ узле и въезжает в
    // документ уже целиком (`scrollable.replaceChildren` ниже) — поэтому старое
    // окно видно всё время полёта запроса, а `prepareToSaveScroll` не якорит
    // рендер (его гейт `isMounted`).
    const oldChatInner = this.chatInner
    // tweb :5242 — плейсхолдер ПРОШЛОГО окна снимается не здесь, а после того,
    // как новое дерево въехало в документ (:5410-5412): иначе между уборкой и
    // приездом страницы лента мигнула бы пустотой.
    const oldPlaceholderBubble = this.emptyPlaceholderBubble
    this.cleanup()
    // ПОСЛЕ `cleanup()`: он сбрасывает снимок вместе с картой наблюдения.
    this.renderReadMaxSeq = readMaxSeq
    const chatInner = this.chatInner = document.createElement('div')
    if(samePeer) {
      chatInner.className = oldChatInner.className
      chatInner.classList.remove('disable-hover', 'is-scrolling')
    } else {
      chatInner.classList.add('bubbles-inner')
    }
    // `!samePeer` — самый частый путь (первый `setPeer` после монтирования,
    // `reload()`) — обнуляет `className` до голого `bubbles-inner`, унося с
    // собой `is-chat`/`is-broadcast`, поставленные в `constructBubbles`; при
    // `samePeer` они уже скопированы вместе с остальным `className`, и вызов
    // ниже идемпотентен (`toggle` с явным булем). См. докблок
    // `applyChatTypeClasses`.
    this.applyChatTypeClasses(chatInner)

    // tweb :5254-5270.
    const canScroll = samePeer && sameSearch
    const haveToScrollToBubble = canScroll || (topMessageFullMid !== EMPTY_FULL_MID && isJump) || isTarget
    const fromUp = maxBubbleFullMid !== EMPTY_FULL_MID && (
      lastMsgFullMid === EMPTY_FULL_MID ||
      splitFullMid(maxBubbleFullMid).mid < splitFullMid(lastMsgFullMid).mid
    )
    const scrollFromDown = !fromUp && canScroll
    const scrollFromUp = !scrollFromDown && fromUp && canScroll
    this.willScrollOnLoad = scrollFromDown || scrollFromUp

    // tweb :5339-5344 (без `additionalFullMid`, см. докблок). `isJump` едет
    // третьим аргументом — это и есть `isBackLimit`: страница берётся ВОКРУГ
    // номера, а не от него вверх.
    //
    // Последним аргументом — `replaceWindow`: страница `setPeer` НАЧИНАЕТ окно,
    // а не продолжает его. Это тот же `cleanup()` строкой выше, но для зеркала:
    // отрисованное оригинал выкидывает целиком (:5243 → `this.bubbles = {}`
    // :4920, новый `chatInner` :5244), и окно, собранное вокруг далёкого
    // номера, не имеет со старым ни одного общего бабла. Без этого аргумента
    // страница прыжка СЛИВАЛАСЬ бы с прежним окном у низа истории: между ними
    // дыра, а лента и React читали бы их как одно непрерывное окно.
    // tweb :5375-5380 — спиннер первой загрузки. Условия оригинала два:
    // `!samePeer` («это открытие чата, а не прыжок внутри») и `!cached`
    // («страница летит по сети, а не встаёт из кэша»). Старое окно при этом
    // убирается из `Scrollable` — иначе спиннер висел бы поверх чужих баблов.
    //
    // РАСХОЖДЕНИЕ ПО МЕСТУ ВЫЗОВА, И ОНО СОХРАНЯЕТ ПОВЕДЕНИЕ, А НЕ ЛОМАЕТ ЕГО.
    // У оригинала обе проверки стоят ПОСЛЕ `await getHistory1`, и это ничего не
    // стоит: там `requestHistory` — ПОДТВЕРЖДЁННЫЙ вызов
    // (`managers.acknowledged.*` → `AckedResult {cached, result}`, tweb
    // bubbles.ts:11458, :10276), то есть внешний промис резолвится, едва воркер
    // ПОДТВЕРДИЛ запрос, и `cached` известен ДО того, как приедут данные;
    // страница летит во втором промисе (`result.result`). У нас
    // подтверждённых вызовов нет вовсе — `requestHistory` ждёт сами данные (см.
    // её докблок), и дословная расстановка строк дала бы спиннер, который
    // появляется РОВНО ТОГДА, когда ждать уже нечего, — то есть ровно ту
    // пустоту вместо спиннера, ради которой механизм и портируется.
    // Поэтому спиннер вешается до запроса, а условие `!cached` проверяется
    // сразу после (`detach` ниже). Видимого «моргания» на кэше это не даёт:
    // `attach` показывает узел не сразу, а через кадр (`useRafs` в
    // `SetTransition`, `preloader.ts:243-256`), и `detach` этот кадр отменяет.
    //
    // `finishPeerChange`/`revealPreparedBackground` соседних строк оригинала —
    // окружение `Chat`, которого у ленты нет (см. докблок).
    if(!samePeer) {
      this.scrollable.replaceChildren(this.paddingTop, this.paddingBottom)
      this.preloader.attach(this.container)
    }

    // tweb :5337-5352 — с сохранённой позицией запроса НЕТ ВОВСЕ: окно
    // восстанавливается из тех самых номеров, которые были отрисованы на
    // выходе, и объявляется `cached` (то есть без спиннера — показывать нечего,
    // окно встаёт мгновенно). `waitPromise` там `Promise.resolve()`: догонять
    // сеть нечем.
    let result: Awaited<ReturnType<ChatBubbles['getHistory']>>
    if(!savedPosition) {
      result = await m(this.getHistory1(
        !isJump && lastMsgFullMid === topMessageFullMid ? EMPTY_FULL_MID : lastMsgFullMid,
        true,
        isJump,
        undefined,
        true,
      ))
    } else {
      const mids = savedPosition.mids
      result = {
        promise: getHeavyAnimationPromise().then(() => {
          return this.performHistoryResult(mids, true)
        }),
        cached: true,
        waitPromise: Promise.resolve(),
      }
    }

    // `getHistory` отдаёт `null` только под `justLoad` (:11525), которого здесь
    // нет; ветка нужна тайпчекеру, а не рантайму.
    if(!result) {
      finishSetPeer()
      return null
    }

    const { promise, cached } = result

    // Вторая половина гейта `!cached` (tweb :5375): страница пришла из кэша —
    // окно встанет мгновенно, спиннеру предмета нет. См. разбор выше.
    if(cached) {
      this.preloader.detach()
    }

    const setPeerPromise: Promise<void> = m(promise).then(async() => {
      // tweb :5386. Бабл цели ищется ПОСЛЕ отрисовки страницы — до неё его нет.
      const mountedByLastMsgId = haveToScrollToBubble ?
        await m(lastMsgFullMid !== EMPTY_FULL_MID ? this.getMountedBubble(lastMsgFullMid) : { bubble: this.getLastBubble() }) :
        undefined

      // tweb :5393. Окно собрано — спиннеру конец, ещё ДО того, как дерево
      // въедет в документ: `detach` уводит его переходом, и они не мигают друг
      // об друга.
      this.preloader.detach()

      // tweb :5395-5397. Лестница, отложенная на время сборки окна, стреляет
      // здесь — тоже до `replaceChildren`: классы стартового состояния надо
      // навесить ДО того, как дерево станет видимым, иначе первый кадр покажет
      // баблы уже на месте.
      if(this.resolveLadderAnimation) {
        void this.resolveLadderAnimation()
        this.resolveLadderAnimation = undefined
      }

      const scrollable = this.scrollable
      scrollable.lastScrollDirection = 0
      scrollable.lastScrollPosition = 0
      scrollable.replaceChildren(this.paddingTop, chatInner, this.paddingBottom)

      // tweb :5410-5412.
      if(oldPlaceholderBubble) {
        this.cleanupPlaceholders(oldPlaceholderBubble)
      }

      // tweb :5420.
      this.container.classList.toggle('has-groups', !!Object.keys(this.dateMessages).length)

      // tweb :5436-5438 — восстановленное окно ставится на ту же позицию, с
      // которой чат был оставлен, и ПЕРВОЙ веткой: `haveToScrollToBubble` в
      // этом случае истинен (цели нет, значит `isJump`), и без перехвата
      // скролл уехал бы к последнему сообщению.
      if(savedPosition) {
        scrollable.setScrollPositionSilently(savedPosition.top)
      } else if(haveToScrollToBubble) {
        let unsetPadding: (() => void) | undefined
        if(scrollFromDown) {
          scrollable.setScrollPositionSilently(99999)
        } else if(scrollFromUp) {
          const set = this.setTopPadding()
          if(set.isPaddingNeeded) {
            unsetPadding = set.unsetPadding
          }

          scrollable.setScrollPositionSilently(0)
        }

        let bubble = mountedByLastMsgId?.bubble
        const foundTarget = !!bubble?.parentElement
        if(!foundTarget) {
          bubble = this.findNextMountedBubbleByMsgId(lastMsgFullMid, false) || this.findNextMountedBubbleByMsgId(lastMsgFullMid, true)
        }

        let scrollPromise: Promise<void> | undefined
        // ! sometimes there can be no bubble
        if(bubble) {
          const lastBubble = this.getLastBubble()
          // `followingUnread ? 'start' : ...` (:5463) свёрнуто: ветки, которая
          // его взводит, здесь нет.
          const position: ScrollLogicalPosition = !isJump && !isTarget && lastBubble === bubble ? 'end' : 'center'

          if(position === 'end' && lastBubble === bubble && samePeer) {
            scrollPromise = this.scrollToEnd()
          } else {
            scrollPromise = this.scrollToBubble(bubble, position, !samePeer ? FocusDirection.Static : undefined)
          }

          if(isTarget && foundTarget) {
            this.highlightBubble(bubble)
          }
        }

        // tweb :5483-5487. Тост «Сообщение не найдено» (:5477-5481) не
        // портирован — тостов у ленты нет.
        if(unsetPadding) {
          void (scrollPromise ?? Promise.resolve()).then(unsetPadding)
        }
      } else {
        scrollable.setScrollPositionSilently(99999)
      }

      scrollable.updateThumb(scrollable.lastScrollPosition)
      this.onRenderScrollSet()
      this.onScroll()

      // tweb :5431-5434 + :5500-5505 — окно доехало, но список мог оказаться короче
      // вьюпорта: позицию скролла надо пересчитать, а не сверять с прошлой.
      void Promise.all([setPeerPromise, getHeavyAnimationPromise()]).then(() => {
        if(!middleware()) {
          return
        }

        scrollable.onScroll()
      })
    })

    // tweb :5557-5563 — окно вытеснено следующим `setPeer`: спиннер снимать
    // некому (ветка `.then` не выполнится), а висеть он останется поверх
    // нового окна.
    //
    // Вторая половина — гашение признака «идёт смена окна». В оригинале это
    // делает `Chat.setPeer` (chat.ts:1126-1129) на СВОЕЙ цепочке, отдавая
    // наружу исходный промис; сверка `this.setPeerPromise === setPeerDeferred`
    // оттуда же — вытесненный `setPeer` не должен гасить признак у нового.
    void setPeerPromise.catch((err) => {
      if(!middleware()) {
        this.preloader.detach()
      }

      throw err
    }).catch(noop).finally(finishSetPeer)

    return { cached, promise: setPeerPromise }
  }

  /** Порт tweb `Chat.setMessageId` (chat.ts:1164-1177) — «тот же чат, другая
   *  цель». В оригинале обёртка досыпает в `setPeer` координаты чата
   *  (`peerId`/`threadId`), у нас лента владеет ОДНИМ окном и досыпать нечего,
   *  кроме `samePeer: true`, — но входом обёртка остаётся: прыжок зовут и клик
   *  по reply-заголовку, и календарь, и (придёт с окружением) поиск.
   *
   *  Через неё же ставится и СНИМАЕТСЯ тег «Избранного» — ровно как в оригинале
   *  (`appImManager.chat.setMessageId({savedReaction: …})`, topbarSearch.tsx:1057
   *  и :1071-1075). Ключ обязан ПРИСУТСТВОВАТЬ в объекте даже со значением
   *  `undefined`: по его наличию `setPeer` и понимает, что выдача сменилась. */
  public setMessageId(options: { lastMsgId?: number, savedReaction?: string } = {}) {
    const promise = this.setPeer({ ...options, samePeer: true })
    // Порт chat.ts:1119-1126: `Chat` заводит СВОЮ цепочку до второго промиса и
    // гасит её `.catch(noop)`, а наружу отдаёт исходный. Без этой строки
    // вытесненное окно отвергалось бы `PEER_CHANGED_ERROR` в никуда — то есть
    // необработанным отказом промиса.
    void promise.then((result) => result?.promise).catch(noop)
    return promise
  }

  /** Порт tweb `onDatePick` (bubbles.ts:10205-10222) — выбранный в календаре
   *  день превращается в номер сообщения и отдаётся прыжку.
   *
   *  Запрос другой (одна ручка вместо `requestHistory` с `offsetDate`, см.
   *  `BubblesManagers.messages.messageByDate`), сверка пира после ответа — та же
   *  (:10218): пока летел запрос, лента могла уехать в другой чат. */
  public onDatePick = (timestamp: number) => {
    const peerId = this.peerId
    void this.managers.messages.messageByDate(peerId, timestamp).then((mid) => {
      if(!mid || this.peerId !== peerId) {
        return
      }

      void this.setMessageId({ lastMsgId: mid }).catch(noop)
    })
  }

  // ─── скролл, пагинация, липкие даты ──────────────────────────────────────

  /** Порт tweb `getRenderedHistory` (bubbles.ts:3981). Источник порядка —
   *  СЕРИИ, а не карта адресов: `this.bubbles` не упорядочен, а группы лежат от
   *  нижней к верхней, элементы внутри — от нового к старому.
   *
   *  У оригинала здесь ДВА РАЗНЫХ вопроса и два фильтра (:3994-3998):
   *  `clearLocal` — `mid > 0`, отсекает сообщения, ПОРОЖДЁННЫЕ КЛИЕНТОМ
   *  (у tweb это спонсорские и плейсхолдеры, они несут отрицательный номер);
   *  `clearOutgoing` — `clearMessageId(mid, false) === mid`, отсекает ЕЩЁ НЕ
   *  ПОДТВЕРЖДЁННЫЕ отправки, у tweb размеченные битами в том же числе.
   *
   *  У нас предмет есть только у второго: клиентское пространство номеров —
   *  ДРОБИ (`isLocalMessageId` = «не целое», `core/history/messageId.ts`), а
   *  отрицательных номеров не порождает никто. Поэтому параметр один и
   *  спрашивает он именно дробность.
   *
   *  Раньше здесь стояло `mid > 0` с обоснованием «неотправленный бабл несёт
   *  отрицательный id». Это было НЕВЕРНО, и фильтр молча не отсекал ничего:
   *  временный номер вида `5.0001` больше нуля. */
  public getRenderedHistory(sort: 'asc' | 'desc' = 'desc', clearLocal?: boolean): FullMid[] {
    let history = this.bubbleGroups.groups
      .map((group) => group.items.map((item) => makeFullMid(this.peerId, item.mid)))
      .flat()

    if (sort === 'asc') {
      history.reverse()
    }

    if (clearLocal) {
      history = history.filter((fullMid) => !isLocalMessageId(splitFullMid(fullMid).mid))
    }

    return history
  }

  /** Порт tweb `getBubbleGroupedItems` (bubbles.ts:3921) — ячейки альбома
   *  внутри бабла. Наш альбом их даёт: `prepareAlbum` вешает `.grouped-item`
   *  с `data-mid` на каждую (`components/prepareAlbum.ts:60`). */
  public getBubbleGroupedItems(bubble: HTMLElement): HTMLElement[] {
    return Array.from(bubble.querySelectorAll<HTMLElement>('.grouped-item'))
  }

  /**
   * Порт tweb `getMountedBubble` (bubbles.ts:3925-3956) — «в каком узле
   * ПОКАЗАН этот номер». Не то же самое, что `getBubble`: у сообщения из
   * альбома своего бабла нет, оно живёт ячейкой внутри бабла главного.
   *
   * Асинхронность — оригинала: там разрешение альбома идёт через менеджер
   * (`getGroupedBubble`), у нас группа собирается из зеркала синхронно, но
   * сигнатуру порта это менять не должно — иначе вызывающий разъедется с tweb.
   *
   * Уточнение `.document-container[data-mid]` (:3946) не переносится: оно про
   * группу ДОКУМЕНТОВ, которую наша лента ещё не рисует (задача #69).
   */
  public async getMountedBubble(fullMid: FullMid): Promise<{ bubble: HTMLElement, peerId: number, mid: number } | undefined> {
    const { peerId, mid } = splitFullMid(fullMid)
    const message = this.getMessage(mid)
    if (!message) return

    const groupedId = message._ === 'message' ? message.grouped_id : undefined
    if (groupedId) {
      const main = this.mainGroupedMessage(message)
      const bubble = main && this.getBubble(makeFullMid(peerId, main.id))
      if (bubble) return { bubble, peerId, mid }
    }

    const bubble = this.getBubble(fullMid)
    return bubble && { bubble, peerId, mid }
  }

  /**
   * Порт tweb `findNextMountedBubbleByMsgId` (bubbles.ts:3958-3979) — «цели в
   * окне нет; какой из отрисованных баблов к ней ближе». Им `setPeer` спасает
   * прыжок, когда сама цель не доехала (её удалили, она вне выданной страницы),
   * — иначе окно доехало бы, а скролл остался бы стоять.
   *
   * `prev` переворачивает и порядок обхода, и сравнение: назад ищем ближайший
   * СТАРШЕ цели по убыванию, вперёд — ближайший МЛАДШЕ по возрастанию.
   * Условие `parentElement` — оригинала: бабл может лежать в карте адресов, но
   * ещё не быть смонтированным в серию.
   *
   * Ветка `ChatType.Search` (:3959-3965) не портирована — типа чата «поиск» у
   * ленты нет как понятия.
   */
  private findNextMountedBubbleByMsgId(fullMid: FullMid, prev?: boolean): HTMLElement | undefined {
    const fullMids = this.getRenderedHistory(prev ? 'desc' : 'asc')
    const { mid } = splitFullMid(fullMid)

    const filterCallback: (_mid: FullMid) => boolean = prev ?
      (_mid) => splitFullMid(_mid).mid < mid :
      (_mid) => mid < splitFullMid(_mid).mid

    const foundMid = fullMids.find((_mid) => {
      if(!filterCallback(_mid)) return false
      return !!this.getBubble(_mid)?.parentElement
    })

    return foundMid ? this.getBubble(foundMid) : undefined
  }

  /** Порт tweb bubbles.ts:2910. */
  public getRenderedLength(): number {
    return this.getRenderedHistory().length
  }

  // ─── отметка о прочтении ──────────────────────────────────────────────────
  //
  // ГДЕ ЭТО ЖИВЁТ В ОРИГИНАЛЕ — В САМОЙ ЛЕНТЕ, и по-другому быть не может:
  // «прочитано» это «увидено», а видимость бабла знает только тот, кто им
  // владеет. Скролл-обработчик хоста («прижат к низу — читаем всё») отвечает на
  // другой вопрос и врёт в обе стороны: длинный пост канала он считает
  // прочитанным, едва тот коснулся низа, а сообщение, до которого пользователь
  // домотал в середине истории, не считает вовсе.
  //
  // Порт: bubbles.ts:2289-2295 (колбэк), :2914-2926 (`onUnreadedInViewport`),
  // :2941-3012 (`readUnreaded`), :6433-6443 (`setUnreadObserver`).
  //
  // НЕ ПОРТИРОВАН наблюдатель ВТОРОГО типа — `'content'`
  // (`unreadedContent`/`unreadedContentSeen`/`readContentPromise`,
  // :2297-2303, :2979-2992). Он отмечает прочитанными УПОМИНАНИЯ и
  // НЕПРОЧИТАННЫЕ РЕАКЦИИ (`isMentionUnread(message) ||
  // getUnreadReactions(message)`), а у нас нет ни того факта, ни другого:
  // непрочитанная реакция на конкретном сообщении в модели отсутствует, а
  // `pFlags.media_unread` («прослушано») уже принадлежит другому владельцу —
  // плееру (`core/mediaRead.ts::markMediaPlayed` ← `components/audio.ts`), ровно
  // как в tweb, где ту же точку гасит `AudioElement`. Заводить здесь второй путь
  // к тому же факту нельзя.
  //
  // НЕ ПОРТИРОВАН `unreadedChat`/`isUnreadedChatChanged` (:2928-2939): он
  // закрывает окно между синхронной сменой пира в `Chat.setPeer` и `cleanup()`,
  // а у нас пир ленты не меняется никогда — новый пир это новый инстанс
  // (`VanillaFeed`), см. шапку файла.

  /** Порт tweb :2289-2295. */
  private unreadedObserverCallback = (entry: IntersectionObserverEntry) => {
    if(!entry.isIntersecting) return
    const target = entry.target as HTMLElement
    const mid = this.unreaded.get(target)
    // У оригинала проверки нет (`strictNullChecks` он не включает): там узел
    // без записи в карте отсекается самим мультиплексором.
    if(mid === undefined) return
    this.onUnreadedInViewport(target, mid)
  }

  /**
   * Пост канала показался — ЗАРЕГИСТРИРОВАТЬ просмотр. Порт tweb :2305-2328.
   *
   * Наблюдение ОДНОРАЗОВОЕ (:2308 снимает его первым же делом): просмотр
   * считается один раз на пару «пост + зритель», второй показ того же поста
   * ничего не меняет — ни здесь, ни на сервере.
   *
   * Ветки `chat.isPreview` (:2310) и спонсорских сообщений (:2313-2322) не
   * портированы: превью-ленты у нас нет как режима, спонсорских сообщений нет
   * как предмета.
   */
  private viewsObserverCallback = (entry: IntersectionObserverEntry) => {
    if(!entry.isIntersecting) return
    const bubble = entry.target as HTMLElement
    this.observer?.unobserve(bubble, this.viewsObserverCallback)
    const mid = Number(bubble.dataset.mid)
    if(!mid) return
    this.viewsMids.add(mid)
    void this.sendViewCountersDebounced?.()
  }

  /** Порт tweb `onUnreadedInViewport` (:2914-2926) в объёме типа `'history'`. */
  private onUnreadedInViewport(target: HTMLElement, mid: number) {
    this.unreadedSeen.add(mid)
    this.observer?.unobserve(target, this.unreadedObserverCallback)
    this.unreaded.delete(target)
    this.readUnreaded()
  }

  /**
   * Порт tweb `readUnreaded` (:2941-3012) в объёме типа `'history'`.
   *
   * Ветка «увиденное дотянулось до низа окна» (:2958-2966) — не оптимизация:
   * пока лента внизу, прочитанным считается ВЕСЬ чат, включая то, что ещё не
   * отрисовано (`getHistoryMaxSeq`), иначе бейдж чата не гас бы до конца.
   *
   * Ветка `this.unreaded.forEach` (:2968-2972) снимает наблюдение со всего, что
   * рубеж уже накрыл: узел ниже увиденного читать отдельным кругом незачем.
   *
   * Расхождения: гейт `chat.isPreview` (:2942) и лог (:2974-2975, :3001)
   * предмета не имеют; ветка `'content'` — см. комментарий секции выше.
   */
  private readUnreaded() {
    if(this.readPromise) return

    const middleware = this.getMiddleware()
    this.readPromise = idleController.getFocusPromise().then(async() => {
      if(!middleware()) return

      const peerId = this.peerId

      let maxId = Math.max(...Array.from(this.unreadedSeen))

      if(this.scrollable.loadedAll.bottom) {
        const rendered = this.getRenderedHistory('desc', true)
        const bubblesMaxId = rendered.length ? splitFullMid(rendered[0]).mid : -1
        if(maxId >= bubblesMaxId) {
          maxId = Math.max(await this.managers.dialogs.getHistoryMaxSeq(peerId), maxId)
          if(!middleware()) return
        }
      }

      this.unreaded.forEach((mid, target) => {
        if(mid <= maxId) {
          this.onUnreadedInViewport(target, mid)
        }
      })

      this.unreadedSeen.clear()

      const callback = () => this.managers.realtime.markRead({ peerId, upToId: maxId })

      // tweb :2997-3009: отказ — один повтор, и в любом исходе замок снимается,
      // а накопившееся за время полёта уходит следующим кругом. `.catch(noop)`
      // на повторе — НАША строка: `markRead` у нас RPC-промис, и его
      // необработанный отказ шумел бы в консоли.
      return callback().catch(() => {
        void callback().catch(noop)
      }).finally(() => {
        if(!middleware()) return

        this.readPromise = undefined

        if(this.unreadedSeen.size) {
          this.readUnreaded()
        }
      })
    })
  }

  /**
   * Порт tweb `setUnreadObserver` (:6433-6443) в объёме типа `'history'`.
   *
   * Аргумента `bubble` рядом с `element` здесь нет: в оригинале он нужен только
   * ради `mid ??= bubble.maxBubbleMid` (:6435), а единственный оставшийся у нас
   * вызыватель номер знает и передаёт сам.
   */
  private setUnreadObserver(element: HTMLElement, mid: number) {
    if(!this.observer) return

    this.observer.observe(element, this.unreadedObserverCallback)
    this.unreaded.set(element, mid)
  }

  /** Порт tweb `loadMoreHistory` (bubbles.ts:4004).
   *
   *  ЗДЕСЬ ЖИВЁТ ГЕЙТ ПОВТОРНОГО ТРИГГЕРА: `checkForTriggers` у Scrollable
   *  срабатывает на КАЖДОМ throttled-скролле, пока вьюпорт стоит в 300px от
   *  края, — то есть много раз за одну загрузку. Отсекают повтор ровно два
   *  условия стороны: «страница уже в полёте» (`getHistoryTopPromise`) и «край
   *  истории уже известен» (`loadedAll.top`). Их снимает `getHistory1` — и
   *  только когда его middleware ещё жив.
   *
   *  `justLoad` — предзагрузка соседней страницы: грузим, но не рисуем.
   *
   *  Не портирован гейт `this.chat.setPeerPromise` (смены пира у ленты ещё нет).
   */
  public loadMoreHistory(top: boolean, justLoad = false) {
    if(
      !this.peerId ||
      this.isHeavyAnimationInProgress ||
      (top && (this.getHistoryTopPromise || this.scrollable.loadedAll.top)) ||
      (!top && (this.getHistoryBottomPromise || this.scrollable.loadedAll.bottom))
    ) {
      return
    }

    const history = this.getRenderedHistory('asc')

    if(!history.length) {
      history.push(EMPTY_FULL_MID)
    }

    if(top) {
      void this.getHistory1(history[0], true, undefined, justLoad)
    } else {
      void this.getHistory1(history[history.length - 1], false, true, justLoad)
    }
  }

  /**
   * Порт tweb `onScroll` (bubbles.ts:4047) — обработчик, который лента вешает
   * НА Scrollable (`onAdditionalScroll`), а не на DOM: Scrollable уже
   * оттроттлил событие и посчитал направление.
   *
   * Три ветки тела:
   *  • `isHeavyAnimationInProgress` (:4050-4056) — пока играет тяжёлая
   *    анимация, обработчик выходит, ЕСЛИ лента и так прижата к низу. Комментарий
   *    оригинала объясняет зачем: иначе кнопка «вниз» моргала бы на каждом кадре
   *    анимации, а отправка нового сообщения с проскроллом вниз отработала бы
   *    неправильно. `ignoreHeavyAnimation` — заход от `scrollToBubble`, который
   *    сам эту анимацию и начал.
   *  • «идёт скролл» (:4071-4082) — класс `is-scrolling` на `.bubbles-inner`,
   *    снимается таймаутом через 1350мс + длительность программного скролла
   *    (CSS по нему показывает липкую дату). Таймаут ПЕРЕВЗВОДИТСЯ, а класс
   *    ставится только если его ещё нет — порядок веток тут не косметика:
   *    `clearTimeout` в `if` и `classList.add` в `else if` означают, что класс
   *    ставится один раз на серию событий.
   *  • «прижат к низу» (:4084-4090) — `scrolled-down` на `.bubbles` + флаг
   *    `scrolledDown`. Условие взведения ассиметрично условию снятия: взвести
   *    можно, только если низ истории ДЕЙСТВИТЕЛЬНО загружен (или скролл
   *    принудительный), а снять — просто по расстоянию.
   *
   * Не портированы (нет предмета): `sliceViewportDebounced?.clearTimeout()` в
   * ветке тяжёлой анимации остался (подрезка есть), а вот
   * `chat.topbar.pinnedMessage.setCorrectIndexThrottled` (плашка закреплённого —
   * окружение `Chat`), `setStickyDateManually` (тело метода в оригинале
   * закомментировано целиком), `checkIntersectingVideos` и
   * `scheduleReadMetricsBatch` (наблюдатели видео и метрик чтения) — их нет.
   */
  private onScroll = (ignoreHeavyAnimation?: boolean, scrollDimensions?: ScrollStartCallbackDimensions, forceDown?: boolean) => {
    if(this.isHeavyAnimationInProgress) {
      this.sliceViewportDebounced?.clearTimeout()

      // * В таком случае, кнопка не будет моргать если чат в самом низу, и правильно отработает случай написания нового сообщения и проскролла вниз
      if(this.scrolledDown && !ignoreHeavyAnimation) {
        return
      }
    } else {
      void this.sliceViewportDebounced?.()
    }

    if(scrollDimensions && scrollDimensions.distanceToEnd < SCROLLED_DOWN_THRESHOLD && this.scrolledDown) {
      return
    }

    const distanceToEnd = forceDown ? 0 : scrollDimensions?.distanceToEnd ?? this.scrollable.getDistanceToEnd()
    if((this.scrollable.lastScrollDirection !== 0 && distanceToEnd > 0) || scrollDimensions || forceDown) {
      if(this.isScrollingTimeout) {
        clearTimeout(this.isScrollingTimeout)
      } else if(!this.chatInner.classList.contains('is-scrolling')) {
        this.chatInner.classList.add('is-scrolling')
      }

      this.isScrollingTimeout = window.setTimeout(() => {
        this.chatInner.classList.remove('is-scrolling')
        this.isScrollingTimeout = 0
      }, 1350 + (scrollDimensions?.duration ?? 0))
    }

    if(distanceToEnd < SCROLLED_DOWN_THRESHOLD && (forceDown || this.scrollable.loadedAll.bottom || !this.peerId)) {
      this.container.classList.add('scrolled-down')
      this.scrolledDown = true
    } else if(this.container.classList.contains('scrolled-down')) {
      this.container.classList.remove('scrolled-down')
      this.scrolledDown = false
    }

    this.updateGoDownVisibility()
  }

  /** Порт tweb bubbles.ts:4907. Видимость угловой кнопки «вниз» даёт КЛАСС на
   *  колонке чата (`_chat.scss:1217` → `.chat.is-go-down-visible
   *  .bubbles-go-down`), а не монтирование кнопки: сама кнопка живёт в
   *  композере (tweb `chat/input.ts:615`) и о ленте не знает. */
  public updateGoDownVisibility = () => {
    const visible = !this.scrolledDown &&
                    !this.container.classList.contains('search-results-active')
    this.chat.container.classList.toggle('is-go-down-visible', visible)
  }

  /** Порт tweb `createScrollSaver` (bubbles.ts:2243). Селектор дословный:
   *  якорем позиции может быть только настоящий бабл сообщения — ни
   *  дата-разделитель, ни sponsored, ни плейсхолдер новой темы (двух последних
   *  у нас нет, но селектор — часть оригинала, а не наш фильтр).
   *
   *  `reverse` = «контент дописывается СВЕРХУ»: якорем берётся ПЕРВЫЙ видимый
   *  бабл и держится его верхняя граница. При `reverse: false` якорь — ПОСЛЕДНИЙ
   *  видимый и держится нижняя (`ScrollSaver.getAnchor`/`positionKey`). Отсюда и
   *  разные значения у вызывающих: подгрузка вверх и удаление сверху — `true`,
   *  дописывание/удаление снизу — `false`. */
  public createScrollSaver(reverse = true) {
    const scrollSaver = new ScrollSaver(
      this.scrollable,
      '.bubble:not(.is-date):not(.is-sponsored):not(.botforum-new-topic-bubble)',
      reverse,
    )
    return scrollSaver
  }

  /** Порт tweb `prepareToSaveScroll` (bubbles.ts:10003).
   *
   *  Снимок делается ДО мутации дерева, восстановление — после; между ними
   *  живёт подрезка вьюпорта, и комментарий оригинала прямо предупреждает:
   *  «let's save scroll position by point before the slicing, not after».
   *
   *  `sliceTop`/`sliceBottom` приходят из `processBatch` как «этот край НЕ
   *  поехал» — подрезать можно только неподвижную сторону, иначе удалённые
   *  узлы и добавленные встретятся в одном кадре. */
  private prepareToSaveScroll(reverse?: boolean, sliceTop?: boolean, sliceBottom?: boolean) {
    const isMounted = !!this.chatInner.parentElement
    if(!isMounted) {
      return {}
    }

    const scrollSaver = this.createScrollSaver(reverse)
    scrollSaver.save() // * let's save scroll position by point before the slicing, not after

    if((sliceTop || sliceBottom) && this.getRenderedLength()) {
      const viewportSlice = this.getViewportSlice(true)
      if(!sliceTop) viewportSlice.invisibleTop.length = 0
      if(!sliceBottom) viewportSlice.invisibleBottom.length = 0
      this.deleteViewportSlice(viewportSlice, true)
    }

    return {
      restoreScroll: () => {
        scrollSaver.restore(reverse)
        this.onRenderScrollSet(scrollSaver.getSaved())
      },
      scrollSaver,
    }
  }

  /** Порт tweb `onRenderScrollSet` (bubbles.ts:10167). Класс `has-sticky-dates`
   *  включает липкие даты (`_chatBubble.scss:513-517`) и ставится с задержкой
   *  600мс — ровно чтобы дата не мигнула на первом кадре открытия чата.
   *
   *  Задержки НЕТ, когда `setPeer` и так уведёт скролл (`willScrollOnLoad`,
   *  :10192-10196): мигать нечему — дата встанет на своё место тем же движением.
   *  Поле гасится в конце (:10202), как в оригинале: признак живёт ровно один
   *  проход.
   *
   *  Гейт `isLoading` (:10170) — оригинала: пока висит спиннер первой
   *  загрузки, высоты мерить бессмысленно (окно ещё не смонтировано, лента
   *  ровно в клиентскую высоту), и липкие даты включаются авансом. */
  private onRenderScrollSet(state?: { scrollHeight: number, clientHeight: number }) {
    const className = 'has-sticky-dates'
    if(!this.container.classList.contains(className)) {
      const isLoading = !this.preloader.detached

      if(isLoading || (state ??= {
        scrollHeight: this.scrollable.scrollSize,
        clientHeight: this.scrollable.clientSize,
      }, state.scrollHeight !== state.clientHeight)) {
        const middleware = this.getMiddleware()
        const callback = () => {
          if(!middleware()) return
          this.container.classList.add(className)
        }

        if(this.willScrollOnLoad) {
          callback()
        } else {
          setTimeout(callback, 600)
        }

        return
      }
    }

    this.willScrollOnLoad = undefined
  }

  /** Порт tweb bubbles.ts:10988. */
  public getViewportSlice(useExtra?: boolean) {
    return getViewportSlice({
      overflowElement: this.scrollable.container,
      selector: '.bubbles-date-group .bubble:not(.is-date)',
      extraSize: useExtra ? Math.max(700, windowSize.height) * 2 : undefined,
      extraMinLength: useExtra ? 5 : undefined,
    })
  }

  /** Порт tweb `deleteViewportSlice` (bubbles.ts:10998) — удаление баблов,
   *  уехавших далеко за пределы вьюпорта.
   *
   *  Тонкость, которую легко потерять: вместе с удалением края СНИМАЕТСЯ
   *  соответствующий `loadedAll` и гасится его `getHistory*Promise` — иначе
   *  подрезанная сторона считалась бы «дальше грузить нечего» и пагинация
   *  назад не заработала бы.
   *
   *  Не портирован `permanent` (анимация удаления бабла — `destroyBubble`). */
  public deleteViewportSlice(slice: ReturnType<ChatBubbles['getViewportSlice']>, ignoreScrollSaving?: boolean) {
    if(DO_NOT_SLICE_VIEWPORT_ON_RENDER) {
      return
    }

    const { invisibleTop, invisibleBottom } = slice
    const invisible = invisibleTop.concat(invisibleBottom)
    if(!invisible.length) {
      return
    }

    if(invisibleTop.length) {
      this.setLoaded('top', false)
      this.getHistoryTopPromise = undefined
    }

    if(invisibleBottom.length) {
      this.setLoaded('bottom', false)
      this.getHistoryBottomPromise = undefined
    }

    const fullMids = invisible.map(({ element }) => makeFullMid(this.peerId, +element.dataset.mid!))

    let scrollSaver: ScrollSaver | undefined
    if(!ignoreScrollSaving) {
      scrollSaver = this.createScrollSaver(!!invisibleTop.length)
      scrollSaver.save()
    }

    this.deleteMessagesByIds(fullMids, true)

    if(scrollSaver) {
      scrollSaver.restore()
    } else if(invisibleTop.length) {
      this.scrollable.lastScrollPosition = this.scrollable.scrollPosition
    }
  }

  /** Порт tweb `sliceViewport` (bubbles.ts:11041). */
  public sliceViewport(ignoreHeavyAnimation?: boolean) {
    // Safari cannot reset the scroll.
    if(IS_SAFARI || (this.isHeavyAnimationInProgress && !ignoreHeavyAnimation) || DO_NOT_SLICE_VIEWPORT) {
      return
    }

    const slice = this.getViewportSlice(true)
    this.deleteViewportSlice(slice)
  }

  /**
   * «Лестница» появления баблов — порт tweb `animateAsLadder`
   * (bubbles.ts:10313-10464). Механика перехода живёт в `core/dom/ladder.ts`
   * (её же гоняет приветствие пустого чата); ЗДЕСЬ — то, ради чего метод
   * существует: КОГО и в каком порядке анимировать.
   *
   * КОГО: не сами `.bubble`, а их последнего ребёнка —
   * `.bubble-content-wrapper` (:10379 `bubble.lastElementChild`), плюс аватар
   * серии, но только у ПОСЛЕДНЕГО её сообщения (:10386-10390): аватар в tweb
   * один на серию и прилипает к её низу.
   *
   * В КАКОМ ПОРЯДКЕ: каскад идёт ОТ сообщения, к которому лента приехала
   * (`targetMid`), в обе стороны (:10352-10355) — вверх по `topIds`, вниз по
   * `bottomIds` (перевёрнутым, чтобы отсчёт шёл от цели), а сама цель едет
   * первой и без сдвига. При открытии чата целью оказывается самое нижнее
   * отрисованное сообщение, и лестница читается снизу вверх.
   *
   * КОГДА НЕ АНИМИРУЕТ (все гейты — оригинала):
   *  • `setPeer` ещё в полёте (:10318) — окно собирается в ОТОРВАННОМ узле,
   *    анимировать невидимое бессмысленно; каскад откладывается в
   *    `resolveLadderAnimation` и стреляет из `setPeer` сразу после
   *    монтирования (:5395-5397);
   *  • окно пустое (:10327-10330);
   *  • страница пришла из кэша, лента уже что-то рисовала, анимации выключены
   *    — это гейты `isFirstMessageRender`/`liteMode` у самого вооружения
   *    лестницы (`getHistory`, :11467/:11540).
   *
   * Параметры оригинала `additionalFullMid`/`additionalFullMids`/
   * `isAdditionalRender` не портированы вместе с самой веткой дополнительного
   * рендера (см. докблок `getHistory`): без неё `isAdditionalRender` тождественно
   * ложно, а значит `delay`/`offsetIndex` — константы 40/1 (:10364-10365),
   * `middleIds`/`bottomIds` не обнуляются, и фильтровать `sortedFullMids`
   * (:10337-10339) нечем.
   */
  private async animateAsLadder(backLimit: number, maxId: FullMid): Promise<unknown> {
    // tweb :10318-10322.
    if(this.setPeerPromise && !this.resolveLadderAnimation) {
      this.resolveLadderAnimation = this.animateAsLadder.bind(this, backLimit, maxId)
      return
    }

    const fullMids = this.getRenderedHistory('desc')

    if(!fullMids.length) {
      return
    }

    const sortedFullMids = fullMids.slice()

    // tweb :10341-10350. `maxId || …`: `EMPTY_FULL_MID` — строка `'0_0'`, то
    // есть истинная, поэтому при `backLimit` цель всегда берётся из аргумента —
    // ровно как в оригинале, где `FullMid` тоже строка (tweb bubbles.ts:441).
    const targetMid: FullMid = backLimit ? (maxId || sortedFullMids[0]) : sortedFullMids[0]

    // tweb :10352-10354, ДОСЛОВНО, включая сравнение `targetMid > mid`. Оно
    // ЛЕКСИКОГРАФИЧЕСКОЕ: `FullMid` — строка (tweb bubbles.ts:441, у нас :151),
    // и это остаток миграции оригинала с числовых `mid`. На открытии чата, ради
    // которого лестница и существует, цель — `sortedFullMids[0]`, и границы
    // считаются верно при любых номерах: первое же сравнение с соседом даёт
    // `topIds` = «всё, кроме цели», `bottomIds` = пусто. Расходится оно с
    // числовым порядком только на прыжке через разрядность номера (`'1_100' >
    // '1_99'` ложно) — там `findIndex` вернёт −1, и `slice(-1)` возьмёт хвост.
    // Чинить это здесь нельзя: расхождение с оригиналом — это отсебятина.
    const topIds = sortedFullMids.slice(sortedFullMids.findIndex((mid) => targetMid > mid))
    const middleIds = [targetMid]
    const bottomIds = sortedFullMids.slice(0, sortedFullMids.findIndex((mid) => targetMid >= mid)).reverse()

    // tweb :10376-10391 — из адреса в узлы, которые поедут одним шагом.
    const toSteps = (ids: FullMid[]): LadderStep[] => {
      const steps: LadderStep[] = []
      for(const fullMid of ids) {
        const bubble = this.getBubble(fullMid)
        if(!bubble) {
          continue
        }

        // `bubble not ready yet` оригинала (:10381): у tweb состав бабла
        // асинхронный, у нас `renderMessage` синхронен — узел либо есть
        // целиком, либо его нет в `getRenderedHistory`. Проверка остаётся
        // сторожем типа (`lastElementChild` нуллабелен), а не веткой поведения.
        const contentWrapper = bubble.lastElementChild as HTMLElement | null
        if(!contentWrapper) {
          continue
        }

        const elementsToAnimate: HTMLElement[] = [contentWrapper]
        const item = this.bubbleGroups.getItemByBubble(bubble)
        if(item?.group?.avatar && item.group.lastItem === item) {
          elementsToAnimate.push(item.group.avatar.node)
        }

        steps.push(elementsToAnimate)
      }

      return steps
    }

    // tweb :10420-10422 — три списка, у крайних отсчёт задержек сдвинут на шаг
    // (:10365), у цели — нет.
    return animateLadderLists(this.chatInner, [
      { steps: toSteps(topIds), offsetIndex: 1 },
      { steps: toSteps(middleIds) },
      { steps: toSteps(bottomIds), offsetIndex: 1 },
    ], { delay: 40 })
  }

  /** Порт tweb bubbles.ts:4630. */
  public getLastBubble(): HTMLElement | undefined {
    const group: BubbleGroup | undefined = this.bubbleGroups.lastGroup
    return group?.lastItem?.bubble
  }

  /**
   * Порт tweb `scrollToBubble` (bubbles.ts:4635).
   *
   * `fallbackToElementStartWhenCentering` (:4649-4660) — если центрируемый бабл
   * ПЕРВЫЙ в своей серии, а серия первая в секции дня (позиция ровно
   * `STICKY_OFFSET`, потому что до неё лежат дата-бабл, его `is-fake`-двойник и
   * sticky-sentinel), то целью запасного варианта становится вся секция: иначе
   * дата-разделитель остался бы над верхней границей вьюпорта.
   *
   * Позиции считаются относительно `.bubbles-viewport`, а не самого
   * скролл-контейнера: контейнер уезжает под топбар и композер. Для `position:
   * 'end'` `fastSmoothScroll` берёт низ контейнера жёстко, поэтому разница
   * компенсируется через `margin` (:4674).
   *
   * Не портированы: `updateGradient`/`gradientRenderer` (фон чата у нас
   * React-компонент) и чтение `chat.input.messageInput` в `isChangingHeight`
   * (композер не входит в окружение ленты; `is-toggling-helper` при этом
   * читается — он живёт на самой колонке).
   */
  public scrollToBubble(
    element: HTMLElement,
    position: ScrollLogicalPosition,
    forceDirection?: FocusDirection,
    forceDuration?: number,
  ) {
    const bubble = findUpClassName(element, 'bubble')

    let fallbackToElementStartWhenCentering: HTMLElement | undefined
    // * if it's a start, then scroll to start of the group
    if(bubble && position !== 'end') {
      const item = this.bubbleGroups.getItemByBubble(bubble)
      const group = item?.group
      if(group && group.firstItem === item && whichChild(group.container) === (this.stickyIntersector ? STICKY_OFFSET : 1)) {
        fallbackToElementStartWhenCentering = group.container.parentElement ?? undefined
      }
    }

    const bubblesViewportRect = this.chat.bubblesViewport.getBoundingClientRect()
    const containerRect = this.scrollable.container.getBoundingClientRect()
    // For 'end', fastSmoothScroll's path uses raw containerRect.bottom and isn't
    // overridable, so compensate via margin to land at viewport.bottom instead.
    const margin = 4 + (position === 'end' ? containerRect.bottom - bubblesViewportRect.bottom : 0)

    const isChangingHeight = this.chat.container.classList.contains('is-toggling-helper')
    const promise = this.scrollable.scrollIntoViewNew({
      element,
      position,
      margin,
      forceDirection,
      forceDuration,
      axis: 'y',
      getNormalSize: isChangingHeight ? () => {
        let height = windowSize.height
        height -= this.container.offsetTop
        height -= mediaSizes.isMobile || windowSize.height < 570 ? 58 : 78
        return height
      } : () => bubblesViewportRect.height,
      getElementPosition: ({ elementRect }) => elementRect.top - bubblesViewportRect.top,
      fallbackToElementStartWhenCentering,
      startCallback: (dimensions) => {
        this.onScroll(true, dimensions)

        // Порт tweb bubbles.ts:4710-4714 дословно. Роль `this.chat
        // .gradientRenderer` (геттер к `appChatBackground
        // .getActiveGradientRenderer()`, chat.ts:270-272) исполняет модуль
        // `core/chat/activeGradient`: обои у нас живут в порталe
        // (`components/ChatBackground.tsx`), общего родителя-владельца с лентой
        // нет — реестр активного рендерера вынесен туда.
        //
        // Аргумент `getProgress` ОБЯЗАТЕЛЕН: без него `toNextPosition` уходит в
        // ветку самоанимации (`gradientRenderer.ts:258-288`) и фон едет сам по
        // себе, а не вместе с прокруткой.
        if (this.updateGradient) {
          getActiveGradientRenderer()?.toNextPosition(dimensions.getProgress)
          this.updateGradient = undefined
        }
      },
    })

    // fix flickering date when opening unread chat and focusing message
    if(forceDirection === FocusDirection.Static) {
      this.scrollable.lastScrollPosition = this.scrollable.scrollPosition
    }

    return promise
  }

  /** Порт tweb bubbles.ts:4726. */
  public scrollToEnd() {
    return this.scrollToBubbleEnd(this.chatInner)
  }

  /** Порт tweb bubbles.ts:4730. `scrollingToBubble` держится всё время полёта —
   *  на него смотрит `_renderNewMessage`, решая, доводить ли новое сообщение. */
  public async scrollToBubbleEnd(bubble: HTMLElement) {
    if(bubble) {
      this.scrollingToBubble = bubble
      const middleware = this.getMiddleware()
      await this.scrollToBubble(bubble, 'end', undefined, undefined)
      if(!middleware()) return
      this.scrollingToBubble = undefined
    }
  }

  /** Порт tweb bubbles.ts:4758. */
  public async scrollToBubbleIfLast(bubble: HTMLElement) {
    if(this.getLastBubble() === bubble) {
      return this.scrollToEnd()
    }
  }

  /** Порт tweb `highlightBubble` (bubbles.ts:4771). Таймер живёт в самом
   *  `dataset` узла — так повторный прыжок к тому же баблу перезапускает
   *  подсветку с нуля (снять класс → reflow → поставить снова), а не сливается
   *  с уже играющей. */
  public highlightBubble(element: HTMLElement) {
    const datasetKey = 'highlightTimeout'
    if(element.dataset[datasetKey]) {
      clearTimeout(+element.dataset[datasetKey])
      element.classList.remove('is-highlighted')
      void element.offsetWidth // reflow
    }

    element.classList.add('is-highlighted')
    element.dataset[datasetKey] = '' + window.setTimeout(() => {
      element.classList.remove('is-highlighted')
      delete element.dataset[datasetKey]
    }, 2000)
  }

  /** Порт tweb `getBubbleByPoint` (bubbles.ts:3898). */
  public getBubbleByPoint(verticalSide: 'top' | 'bottom'): HTMLElement | undefined {
    const slice = this.getViewportSlice()
    const item = slice.visible[verticalSide === 'top' ? 0 : slice.visible.length - 1]
    return item?.element
  }

  /**
   * Порт tweb `setUnreadDelimiter` (bubbles.ts:11556) — граница «Непрочитанные
   * сообщения» (класс `is-first-unread` на баббле, текст рисует CSS).
   *
   * Ставится ОДИН раз за окно (`attachedUnreadBubble`) и только если в диалоге
   * реально есть непрочитанное. Кандидат — первое ВХОДЯЩЕЕ (`:not(.is-out)`)
   * отрисованное сообщение новее горизонта прочтения; последнее сообщение чата
   * границей не помечается (`readMaxId !== historyMaxId`), иначе черта висела
   * бы под всей историей у любого чата с одним непрочитанным.
   *
   * РАСХОЖДЕНИЕ по той же причине, что в `requestHistory`: «новее прочитанного»
   * сравнивается по `seq` (порядковый ключ), а адресуется бабл по `id`.
   *
   * Не портированы гейты типа чата (`ChatType.Chat/Discussion`) и
   * `canManageDirectMessages` — этих понятий у ленты нет.
   */
  public async setUnreadDelimiter() {
    if(this.attachedUnreadBubble) {
      return
    }

    const middleware = this.getMiddleware()

    const peerId = this.peerId
    const [historyMaxSeq, readMaxSeq] = await Promise.all([
      this.managers.dialogs.getHistoryMaxSeq(peerId),
      this.managers.dialogs.getReadMaxSeqIfUnread(peerId),
    ])
    if(!readMaxSeq || !middleware()) return

    const found = this.getRenderedHistory('asc', true)
      .filter((fullMid) => !this.getBubble(fullMid)!.classList.contains('is-out'))
      .find((fullMid) => (this.bubbleGroups.getItemByBubble(this.getBubble(fullMid)!)?.mid ?? 0) > readMaxSeq)

    if(!found) {
      return
    }

    const bubble = this.getBubble(found)
    if(!bubble) {
      return
    }

    if(this.firstUnreadBubble && this.firstUnreadBubble !== bubble) {
      this.firstUnreadBubble.classList.remove('is-first-unread')
      this.firstUnreadBubble = undefined
    }

    const foundSeq = this.bubbleGroups.getItemByBubble(bubble)?.mid ?? 0
    if(foundSeq !== historyMaxSeq) {
      bubble.classList.add('is-first-unread')
    }

    this.firstUnreadBubble = bubble
    this.attachedUnreadBubble = true
  }

  /** Порт tweb `setTopPadding` (bubbles.ts:4485). Когда вся история короче
   *  вьюпорта, скроллить некуда — и новое сообщение появилось бы БЕЗ выезда
   *  снизу. Распорка в высоту вьюпорта даёт этот запас, скролл сразу уводится в
   *  самый низ (тихо), а снимается распорка после доводки. */
  private setTopPadding(middleware = this.getMiddleware()) {
    let isPaddingNeeded = false
    let setPaddingTo: HTMLElement | undefined
    if(!this.isTopPaddingSet) {
      const { clientHeight, scrollHeight } = this.scrollable.container
      isPaddingNeeded = clientHeight === scrollHeight

      if(isPaddingNeeded) {
        setPaddingTo = this.chatInner
        setPaddingTo.style.paddingTop = clientHeight + 'px'
        this.scrollable.setScrollPositionSilently(scrollHeight)
        this.isTopPaddingSet = true
      }
    }

    return {
      isPaddingNeeded,
      unsetPadding: isPaddingNeeded ? () => {
        if(!middleware()) {
          return
        }

        setPaddingTo!.style.paddingTop = ''
        setPaddingTo!.style.minHeight = ''
        this.isTopPaddingSet = false
      } : undefined,
    }
  }

  /** Порт tweb bubbles.ts:1860/765/1104/1903 (`constructPeerHelpers`). Каждая
   *  подписка сверяет, что событие про ТЕКУЩЕЕ окно: по `storageKey`, а где его
   *  в каталоге нет (`history_delete`) — по `peerId`, ровно как в оригинале. */
  private constructPeerHelpers() {
    // Липкие даты — tweb bubbles.ts:1382-1408. Класс `is-sticky` ставит САМ
    // наблюдатель и прямо на узел дата-бабла: это единственный владелец класса,
    // никакого «посчитать наверху и передать вниз».
    //
    // Логика выбора дословная: наблюдатель кричит про КАЖДУЮ застрявшую секцию,
    // а `is-sticky` носит ровно одна — с максимальным днём среди застрявших
    // (`stuckContainers` × обход реестра `dateMessages`). Прошлая при этом
    // гасится, и только если она ДРУГАЯ, — иначе на каждом кадре скролла класс
    // снимался бы и ставился заново, перезапуская CSS-переход.
    const stuckContainers = new WeakSet<HTMLElement>()

    this.stickyIntersector = new StickyIntersector(this.scrollable.container, (stuck, target) => {
      if(stuck) stuckContainers.add(target)
      else stuckContainers.delete(target)

      // Only the bottom-most (latest-timestamp) stuck date should carry is-sticky.
      let newStickyDate: HTMLElement | undefined
      let latestTimestamp = -Infinity
      for(const timestamp in this.dateMessages) {
        const dateMessage = this.dateMessages[timestamp]
        const ts = +timestamp
        if(stuckContainers.has(dateMessage.container) && ts > latestTimestamp) {
          latestTimestamp = ts
          newStickyDate = dateMessage.div
        }
      }

      if(this.previousStickyDate !== newStickyDate) {
        if(this.previousStickyDate) {
          this.previousStickyDate.classList.remove('is-sticky')
        }

        newStickyDate?.classList.add('is-sticky')
        this.previousStickyDate = newStickyDate
      }
    })
    // Наблюдатель пересоздаётся на каждый `setPeer`, а распорки живут дольше —
    // возвращаем ему актуальный `rootMargin` (tweb делает то же из
    // `recomputePaddings`).
    this.applyStickyRootMargin()

    // tweb bubbles.ts:2127 — один наблюдатель на все вопросы «что сейчас
    // видно», корень тот же (см. поле `observer`).
    this.observer = new SuperIntersectionObserver({ root: this.scrollable.container })

    // Порт tweb :2129-2147. Дебаунс на СЕКУНДУ и не по переднему фронту
    // (третий аргумент `false`): прокрутка мимо десятка постов не должна
    // порождать десять запросов.
    //
    // Разбивки `byPeers` (tweb :2133-2143) у нас нет: она обслуживает режим
    // `GLOBAL_MIDS`, где в одном окне лежат сообщения РАЗНЫХ пиров и `fullMid`
    // несёт пир внутри себя. У нашей ленты окно всегда одного пира, поэтому
    // адресат — `this.peerId`, а набор хранит голые номера.
    this.sendViewCountersDebounced = debounce(() => {
      const mids = [...this.viewsMids]
      this.viewsMids.clear()
      void this.managers.channels?.registerViews(this.peerId, mids).catch(noop)
    }, 1000, false, true)

    // tweb bubbles.ts:1411-1413.
    if(!DO_NOT_SLICE_VIEWPORT_ON_SCROLL) {
      this.sliceViewportDebounced = debounce(this.sliceViewport.bind(this), 3000, false, true)
    }

    // tweb bubbles.ts:1416-1436 в применимом объёме: флаг «идёт тяжёлая
    // анимация» читают `onScroll` и `loadMoreHistory`. Ветки `lazyLoadQueue`
    // (lock/unlockAndRefresh) не портированы — очереди ленивой загрузки у
    // ленты нет. tweb снимает подписку своим `listenerSetter` (третий аргумент);
    // наш `onHeavyAnimation` — вендорная шина `@core/dom/heavyAnimation` —
    // возвращает отписку функцией, её и зовёт `destroy()`.
    this.removeHeavyAnimationListener = useHeavyAnimationCheck(() => {
      this.isHeavyAnimationInProgress = true
    }, () => {
      this.isHeavyAnimationInProgress = false
    })

    // will call when message is sent (only 1) — tweb bubbles.ts:1860.
    // Рендер идёт через `renderNewMessage` (:1891), а не прямым
    // `safeRenderMessage`: его промис обязан лежать в `renderNewPromises` —
    // иначе `history_update`, прилетевший тем же ходом (ack своей отправки
    // догоняет собственный бабл), дождётся пустой очереди и выйдет ни с чем.
    this.listenerSetter.add(rootScope)('history_append', ({ storageKey, message }) => {
      if (storageKey !== this.chat.messagesStorageKey) return

      // СДВИГ ГРАДИЕНТА ОБОЕВ — порт tweb bubbles.ts:1862-1864. Гейт
      // `liteMode.isAvailable('chat_background')` дословный: при «без анимаций»
      // фон стоит на месте.
      //
      // РАСХОЖДЕНИЕ ПО ИСТОЧНИКУ, названное явно. У tweb `history_append`
      // объявляет ТОЛЬКО свою отправку: единственный вызыватель по этому пути —
      // `beforeMessageSending` (appMessagesManager.ts:2792), а чужое входящее
      // приезжает вторым событием — `history_multiappend` (:1897), которое
      // флага не ставит. У нас событие одно на оба случая (`insert` зеркала,
      // `core/history/messagesMirror.ts:273`), поэтому «моё ли это» приходится
      // спрашивать здесь — `isOurMessage` и есть тот же самый вопрос, на
      // который у оригинала отвечает выбор события.
      if (liteMode.isAvailable('chat_background') && this.isOurMessage(message)) {
        this.updateGradient = true
      }

      void this.renderNewMessage(message)
    })

    // ПРОГРЕСС ОТДАЧИ ФАЙЛА → кольцо на неотправленном бабле. В tweb этого
    // слушателя нет вовсе: там промис отдачи ЖИВОЙ объект, который
    // `apiFileManager` двигает сам (`promise.notifyAll({done, total})`), а
    // враппер берёт его из реестра по имени файла. У нас байты отдаёт воркер, и
    // единственное, что доезжает до вкладки, — кадр `media:upload_progress`;
    // здесь он и переводится обратно в те же `notifyAll`, которых ждёт
    // `ProgressivePreloader.attachPromise` (preloader.ts:218-224).
    //
    // `done` (аплоад кончился — успехом, ошибкой или отменой) РАЗРЕШАЕТ промис,
    // а не отклоняет: отклонение у оригинала нужно, чтобы кольцо осталось с
    // ретраем (`tryAgainOnFail`), а у нас неудачную отправку помечает сам бабл
    // (`failed`), отменённый бабл воркер выкидывает операцией `remove`, — то
    // есть кольцу в обоих случаях остаётся ровно одно: уйти.
    this.listenerSetter.add(rootScope)('media:upload_progress', ({ id, loaded, total, done }) => {
      const promise = this.uploads.get(id)
      if (!promise) return

      if (done) {
        this.uploads.delete(id)
        promise.resolve?.(undefined)
        return
      }

      if (total > 0) promise.notifyAll?.({ done: loaded, total })
    })

    // Смена идентификатора сообщения (ack оптимистичного бабла): бабл НЕ
    // пересоздаётся, переклеивается только его ключ в карте и data-mid —
    // порт tweb bubbles.ts:900-906; следом бабл переезжает на своё место по
    // новому порядку — порт тела `history_update` (tweb bubbles.ts:794-865).
    this.listenerSetter.add(rootScope)('history_update', async ({ storageKey, message, tempId, sequential }) => {
      if (storageKey !== this.chat.messagesStorageKey || tempId === undefined) return

      const fullTempMid = makeFullMid(this.peerId, tempId)
      const bubble = this.getBubble(fullTempMid)
      if (!bubble) return

      const fullMid = makeFullMid(this.peerId, message.id)
      delete this.bubbles[fullTempMid]
      this.bubbles[fullMid] = bubble
      bubble.dataset.mid = '' + message.id

      // Порт tweb bubbles.ts:917-938. Ack — это НЕ ТОЛЬКО новый номер: тем же
      // ходом оригинал снимает с бабла «отправляется» и выставляет статус
      // (`is-outgoing` → `setBubbleSendingStatus`). Без этой половины бабл
      // остаётся с часами НАВСЕГДА: второго события про него не будет, и
      // «отправляется» держится до перезагрузки чата. Найдено живьём.
      //
      // `fastRaf` и перепроверка адреса — тоже оригинал (:917-921): между
      // событием и кадром бабл могли переселить или заменить, и тогда красить
      // уже нечего.
      fastRaf(() => {
        if (this.getBubble(fullMid) !== bubble) return
        // Классы пишутся целиком — как в `onMessageEdit`, потому что вопрос
        // «что за бабл» имеет один ответ (`classesFor`); серию возвращает её
        // владелец.
        bubble.className = this.classesFor(message).join(' ')
        this.bubbleGroups.getItemByBubble(bubble)?.group?.updateClassNames()

        const bubbleContainer = bubble.querySelector<HTMLElement>('.bubble-content')
        const messageDiv = bubble.querySelector<HTMLElement>('.message')
        if (bubbleContainer && messageDiv) {
          this.renderMessageMeta(message, bubble, bubbleContainer, messageDiv)
        }
      })

      // Порт tweb bubbles.ts:780-789. Бабл, который надо переставить, может быть
      // ещё НЕ РАЗЛОЖЕН по сериям: узел и адрес заводятся синхронно
      // (`safeRenderMessage`), а серия — только в пачке очереди рендера. Поэтому
      // сначала дожидаемся всех начатых рендеров новых сообщений, потом самой
      // очереди, и лишь затем проверяем, что за адресом всё ещё ЭТОТ узел.
      if (this.renderNewPromises.size) {
        await Promise.all(Array.from(this.renderNewPromises)).catch(noop)
      }

      await this.awaitMessagesQueue()

      if (this.getBubble(fullMid) !== bubble) return

      // tweb bubbles.ts:794-800: репозиционируется только то, что лежит в
      // группах; `item.mid === mid` — событие уже применено.
      const item = this.bubbleGroups.getItemByBubble(bubble)
      if (!item || item.mid === message.id) return

      // Порт tweb bubbles.ts:802-819.
      //
      // ЧТО ЗНАЧИТ `sequential`. Признак приходит от отправителя
      // (`PendingDetails.sequential`, `core/managers/messages/pending.ts`; в tweb
      // — `pendingData.sequential`) и означает «кадр отправки ушёл на сервер тем
      // же ходом, что и появление бабла». Отсюда следует главное: пока бабл
      // висел «отправляется…», ВПЕРЁД НЕГО ничего уйти не могло, поэтому
      // серверный идентификатор почти наверняка сохранит ту позицию внизу окна,
      // которую бабл уже занимает. У отправки с аплоадом (`sendFile`) признака
      // нет — там между баблом и кадром стоят байты, и обогнать его успевают.
      //
      // ЧТО ДЕЛАЕТ ВЕТКА. Проверяет догадку, не трогая DOM: строит ВРЕМЕННЫЙ
      // элемент серии для нового сообщения (`createItem` — он никуда не
      // регистрируется) и ищет ему соседа в копии окна БЕЗ старого элемента.
      // Если сосед оказался в той же серии, где бабл уже лежит, — переставлять
      // нечего, достаточно подменить сообщение (`changeBubbleMessage`
      // перевешивает адрес и порядок, узел и серию не трогает). Два запасных
      // условия оригинала — про случаи, где соседа нет вовсе: бабл один в самой
      // нижней серии того же дня, и «Избранное» (`peerId === myId`), где чужих
      // сообщений не бывает. Третье условие tweb перепроверяет `sequential`
      // внутри уже взведённого `if(sequential)` — тавтология, не переносим.
      //
      // ЦЕНА ОТСУТСТВИЯ ВЕТКИ — не только лишняя работа: общий путь ниже снимает
      // бабл из серии и раскладывает заново, а это `is-group-first/last` на
      // соседях и перестановка узлов в DOM на каждом ack самой частой операции
      // в мессенджере.
      if (sequential) {
        const group = item.group
        const newItem = this.bubbleGroups.createItem(bubble, message)
        const items = this.bubbleGroups.itemsArr.slice()
        indexOfAndSplice(items, item)
        const foundItem = this.bubbleGroups.findGroupSiblingByItem(newItem, items)
        if (
          group === foundItem?.group ||
          (group === this.bubbleGroups.lastGroup && group?.items.length === 1 && newItem.dateTimestamp === item.dateTimestamp) ||
          (this.peerId === rootScope.myId && newItem.dateTimestamp === item.dateTimestamp)
        ) {
          this.bubbleGroups.changeBubbleMessage(bubble, message)
          return
        }
      }

      this.bubbleGroups.removeAndUnmountBubble(bubble)
      this.bubbleGroups.mountUnmountGroups(this.groupBubbles([{ bubble, message }]))
    })

    // tweb bubbles.ts:1104 → onMessageEdit
    this.listenerSetter.add(rootScope)('message_edit', ({ storageKey, message }) => {
      if (storageKey !== this.chat.messagesStorageKey) return
      this.onMessageEdit(message)
    })

    /**
     * Просмотры поста — порт tweb bubbles.ts:2094-2124.
     *
     * Переписывается ОДИН узел уже отрисованного бабла, а не бабл целиком, и
     * это существенно: у поста канала просмотры тикают у каждого зрителя, а
     * пересборка тела перезапустила бы вложение (см. докблок `onMessageEdit`).
     *
     * `.post-views` в бабле ДВА — часть времени дублируется в `.time-inner`
     * (`messageTime.ts`), поэтому запрос возвращает список, а не один узел.
     *
     * `ScrollSaver` заводится ЛЕНИВО и только когда текст реально меняется
     * (:2109-2117): число другой длины меняет ширину времени, а у поста, стоящего
     * над вьюпортом, это сдвинуло бы ленту под пальцем. `different` в оригинале
     * взводится один раз на бабл — второй узел переписывается уже безусловно,
     * чтобы дубль не разъехался с видимой копией.
     *
     * Гейт `chat.type === Scheduled` (:2095) предмета не имеет: отложенные у нас
     * живут отдельным экраном, а не типом ленты. `GLOBAL_MIDS` — тоже (окно
     * всегда одного пира).
     */
    this.listenerSetter.add(rootScope)('messages_views', (arr) => {
      fastRaf(() => {
        let scrollSaver: ScrollSaver | undefined
        for (const { peerId, mid, views } of arr) {
          if (this.peerId !== peerId) continue

          const bubble = this.getBubble(makeFullMid(peerId, mid))
          if (!bubble) continue

          const postViewsElements = Array.from(bubble.querySelectorAll<HTMLElement>('.post-views'))
          if (!postViewsElements.length) continue

          const str = fmtViews(views)
          let different = false
          postViewsElements.forEach((postViews) => {
            if (different || postViews.textContent !== str) {
              if (!scrollSaver) {
                scrollSaver = this.createScrollSaver(true)
                scrollSaver.save()
              }

              different = true
              postViews.textContent = str
            }
          })
        }

        scrollSaver?.restore()
      })
    })

    /**
     * Комментарии поста — порт глобального слушателя `replies_updated`
     * (tweb replies.ts:17-22) вместе с приёмом :1137-1142: потребитель читает
     * ТОЛЬКО ЧИСЛО.
     *
     * Футер адресуется `data-post-key`, а не картой баблов, и это из оригинала:
     * у АЛЬБОМА тред лежит на одном сообщении группы, а футер рисуется один на
     * альбом — поэтому номер в ключе футера не обязан совпадать с `data-mid`
     * бабла, под которым тот висит (`getMessageWithCommentReplies`).
     *
     * Ветки `setBubbleRepliesCount` (число у времени, tweb :6410-6431) здесь
     * нет: она про сообщение ГРУППЫ с ответами, а кадр — канальный
     * (`updateChannelMessageReplies`). Счётчик группы двигает обычная правка
     * сообщения, как и всё остальное её содержимое.
     */
    this.listenerSetter.add(rootScope)('replies_updated', ({ storageKey, peerId, mid, message }) => {
      if (storageKey !== this.chat.messagesStorageKey) return
      const replies = message._ === 'message' ? message.replies : undefined
      if (!replies) return
      const elements = this.chatInner.querySelectorAll<HTMLElement>(`replies-element[data-post-key="${peerId}_${mid}"]`)
      elements.forEach((element) => { setRepliesElementCount(element, replies.replies) })
    })

    // tweb bubbles.ts:1903
    this.listenerSetter.add(rootScope)('history_delete', ({ peerId, msgs }) => {
      if (peerId !== this.peerId) return
      this.deleteMessagesByIds([...msgs].map((mid) => makeFullMid(peerId, mid)))
    })
  }

  /**
   * Правка одного бабла.
   *
   * ─── ПОЧЕМУ НЕ ПУТЬ ОРИГИНАЛА ───────────────────────────────────────────
   * В tweb правка ПЕРЕСОЗДАЁТ бабл: `onMessageEdit` (bubbles.ts:1072-1102)
   * зовёт `safeRenderMessage({message, bubble})`, тот строит НОВЫЙ узел и
   * меняет его на старый (:6336-6338 `bubblesToReplace` +
   * `changeBubbleByBubble`). Поэтому у оригинала и нет проблемы «что ещё живёт
   * внутри бабла»: заново собирается всё.
   *
   * У нас это было бы не то же самое, потому что СОБЫТИЕ ДРУГОЕ. `message_edit`
   * в tweb значит ровно «сообщение отредактировали»: реакции там приезжают
   * своим событием `messages_reactions` (:1247), и оно перерисовывает ТОЛЬКО
   * контейнер реакций, аккуратно сохраняя узел времени (`bubble.timeSpan`,
   * :9852-9855, и возврат времени на место при исчезновении реакций, :1294-1298).
   * У нас же `message_edit` — единственная воронка ЛЮБОГО изменения сообщения:
   * `core/history/messagesMirror.ts:192` объявляет им и `replace`, и КАЖДЫЙ
   * `patch` — реакцию, `media_read`, опрос, factcheck. Пересоздание бабла на
   * каждый клик по реакции заново собирало бы вложение: перезапуск лотти,
   * повторный `wrapVideo`, мигание превью.
   *
   * Поэтому узел бабла остаётся ТЕМ ЖЕ, а пересобирается его содержимое —
   * теми же методами, которыми его собирает рендер (`renderMessageContent` и
   * `renderMessageMeta`), чтобы второго ответа на вопрос «что лежит в теле» не
   * появилось. Сам ответ — один список, `BODY_NOT_CONTENT`.
   *
   * ─── ЧТО ИМЕННО ТЕРЯЛОСЬ ────────────────────────────────────────────────
   * Прежняя строка `messageDiv.replaceChildren(...)` считала `.message`
   * контейнером ОДНОГО ТОЛЬКО содержимого. Живут в нём ещё:
   *  • время (`createMessageTime`) — и у ПОСТА КАНАЛА это наблюдаемый узел
   *    отметки прочтения (tweb :7638-7640, порт в `renderMessageMeta`);
   *    ломался не показ, а механика: пост переставал отмечаться прочитанным;
   *  • контейнер реакций, внутрь которого время переезжает (tweb :9855);
   *  • СТРОКА ДОКУМЕНТА — файл, голосовое, музыка (`renderDocumentMedia`):
   *    у этой ветки оригинала узел встаёт в тело, а не во вложение
   *    (`noAttachmentDivNeeded`, tweb :8645). Её сносил КАЖДЫЙ `message_edit`,
   *    то есть и чужой клик по реакции, и `media_read`: от документа
   *    оставалась одна подпись.
   * Первые два выкладывает заново их владелец, третий переживает правку —
   * узел живой, у него кольцо загрузки и проигрывание.
   *
   * Наблюдение поэтому ПЕРЕВЕШИВАЕТСЯ на новый узел времени, а не сохраняется
   * вместе со старым: у оригинала оно тоже регистрируется заново, потому что
   * бабл новый. Узел, который наблюдатель уже отпустил (сообщение прочитано,
   * `onUnreadedInViewport` вычистил его из `unreaded`), не перевешивается — иначе
   * прочитанное вернулось бы в непрочитанные.
   *
   * `item.message` в группах при этом не обновляется — как и в tweb, где
   * `prepareForGrouping` на правке находит существующий элемент и выходит
   * (bubbleGroups.ts:619, «should happen only on edit»).
   */
  private onMessageEdit(message: MyMessage) {
    const bubble = this.getBubble(makeFullMid(this.peerId, message.id))
    if (!bubble) return

    // ПИЛЮЛЯ: у неё нет ни тела `.message`, ни классов от `bubbleClasses`, и
    // `classesFor` ниже стёр бы `service`, превратив её в пустой обычный бабл.
    // tweb этой ловушки не знает: там правка ПЕРЕСОЗДАЁТ бабл целиком
    // (`bubblesToReplace`/`changeBubbleByBubble`, :6338), а у нас узел тот же.
    // Содержимое собирается тем же, чем собиралось на рендере: фраза целиком
    // выводится из `action`, поэтому её надо пересобрать, а не подправить.
    if (message._ === 'messageService' && bubble.classList.contains('service')) {
      bubble.replaceChildren(...Array.from(this.renderServiceMessage(message).childNodes))
      return
    }

    const messageDiv = bubble.querySelector<HTMLElement>('.message')
    const bubbleContainer = bubble.querySelector<HTMLElement>('.bubble-content')
    if (!messageDiv || !bubbleContainer) return

    // Снять наблюдение со СТАРОГО времени, запомнив рубеж. `unreaded` не
    // содержит узла, который наблюдатель уже отпустил (`onUnreadedInViewport`),
    // — значит и перевешивать нечего. Ищем по ВСЕМУ баблу, а не только внутри
    // `messageDiv`: у медиа без подписи (`has-floating-time`) время лежит
    // соседом `.message`, на `.bubble-content` (`renderMessageMeta`), и поиск
    // строго внутри `.message` его бы не нашёл.
    const oldTime = bubble.querySelector<HTMLElement>('.time')
    const observedMid = oldTime ? this.unreaded.get(oldTime) : undefined
    if (oldTime && observedMid !== undefined) {
      this.observer?.unobserve(oldTime, this.unreadedObserverCallback)
      this.unreaded.delete(oldTime)
    }

    // `className` пишется целиком — значит, стираются и `is-group-first`/
    // `is-group-last`, которыми владеет серия. Возвращает их владелец, а не
    // мы: `updateClassNames` — единственное место, где эти классы считаются.
    bubble.className = this.classesFor(message).join(' ')
    this.bubbleGroups.getItemByBubble(bubble)?.group?.updateClassNames()

    this.renderMessageContent(message, messageDiv)
    this.renderMessageMeta(
      message,
      bubble,
      bubbleContainer,
      messageDiv,
      observedMid === undefined ? undefined : (element) => this.setUnreadObserver(element, observedMid),
    )
  }

  /** Порт tweb `deleteMessagesByIds` (bubbles.ts:4302-4313/4470-4478): забыть
   *  адрес и снять бабл ЧЕРЕЗ ГРУППЫ — `removeAndUnmountBubble` не только
   *  убирает узел, но и сливает обратно соседей, которых удалённый бабл
   *  разделял.
   *
   *  Хвост — из оригинала (:4452, :4463-4468): `ignoreNextScrollEvent` глушит
   *  «скролл», который родит само схлопывание контента, пустые секции дней
   *  уходят, и лента пересчитывает скролл — КРОМЕ случая `ignoreOnScroll`, то
   *  есть подрезки вьюпорта, где позицию восстанавливает `ScrollSaver` и лишний
   *  пересчёт посреди этого только помешал бы.
   *
   *  `permanent` (анимация удаления через `destroyBubble`) не портирован —
   *  анимации удаления бабла у нас нет; вместо неё осталось снятие границы
   *  непрочитанных с удаляемого узла (:4306-4308). */
  public deleteMessagesByIds(fullMids: string[], ignoreOnScroll?: boolean) {
    for (const fullMid of fullMids) {
      const bubble = this.bubbles[fullMid]
      if (!bubble) continue

      delete this.bubbles[fullMid]

      if (this.firstUnreadBubble === bubble) {
        this.firstUnreadBubble = undefined
      }

      this.bubbleGroups.removeAndUnmountBubble(bubble)

      // tweb :4314-4316 снимает наблюдение непрочитанных с САМОГО бабла. У
      // поста канала наблюдаемый узел не бабл, а время внутри него (:7638-7640),
      // поэтому здесь обход по вхождению: иначе подрезка вьюпорта оставляла бы
      // в карте оторванный от документа узел на каждый удалённый пост.
      if (this.observer) {
        // Удаление ТЕКУЩЕГО ключа по ходу обхода `Map` определено спецификацией
        // (пропускается только запись, удалённая ДО того, как её посетили), —
        // копию делать не за чем.
        for (const element of this.unreaded.keys()) {
          if (element === bubble || bubble.contains(element)) {
            this.observer.unobserve(element, this.unreadedObserverCallback)
            this.unreaded.delete(element)
          }
        }
        // tweb :4321-4322 — просмотры своей парой: наблюдаемый узел здесь сам
        // бабл (:7685), а накопленный номер уходит из набора, чтобы дебаунс не
        // зарегистрировал просмотр удалённого поста.
        this.observer.unobserve(bubble, this.viewsObserverCallback)
        this.viewsMids.delete(splitFullMid(fullMid).mid)
      }
    }

    this.scrollable.ignoreNextScrollEvent()
    this.deleteEmptyDateGroups()

    // tweb :11654 — чат мог опустеть ИМЕННО этим удалением; края окна при этом
    // не меняются, поэтому `setLoaded` сюда не приведёт и спросить надо здесь.
    void this.checkIfEmptyPlaceholderNeeded()

    if (!ignoreOnScroll) {
      this.scrollable.onScroll()
    }
  }

  /**
   * Плейсхолдер ПУСТОГО ЧАТА — порт tweb `checkIfEmptyPlaceholderNeeded`
   * (bubbles.ts:11302-11316) вместе с выбором ветки (:10798-10857).
   *
   * УСЛОВИЕ ОРИГИНАЛА, три слагаемых из его пяти:
   *  • оба края окна сведены (`loadedAll.top && loadedAll.bottom`) — «истории
   *    больше нет ни сверху, ни снизу», а не «страница ещё едет»;
   *  • плейсхолдера ещё нет (`emptyPlaceholderBubble === undefined`);
   *  • ИСТОРИЯ ПУСТА — `!this.chat.getHistoryStorage().count` оригинала. Роль
   *    счётчика хранилища у нас играет длина окна в зеркале: другого ответа на
   *    вопрос «сколько сообщений в этом окне» на главном потоке нет. Спрашивать
   *    вместо него `getRenderedLength()` НЕЛЬЗЯ — отрисовка асинхронна
   *    (очередь), а края взводит `performHistoryResult` ДО неё, и на непустой
   *    странице карточка успевала бы выскочить в это окно.
   * Второе слагаемое оригинала на том же месте — `Object.keys(this.bubbles)
   * .length && !this.getRenderedLength()` — не портировано: оно обслуживает
   * ПРОПУЩЕННЫЕ при рендере сообщения (`skippedMids`), которых у нас не бывает
   * (см. кэш-ветку `setPeer`). Не портированы и `chat.isRestricted`/
   * `ChatType.Logs`/`ChatType.Scheduled` — типов чата и ограничений у ленты нет
   * как понятия; `shouldShowUnknownUserPlaceholder`/`isBotforum` — подсистемы,
   * которых нет.
   *
   * ВЕТКА выбирается цепочкой оригинала (:10798-10857) в применимом объёме:
   *  • `saved` — «Избранное» (`rootScope.myId === peerId`, :10837);
   *  • `greeting` — личный чат, куда можно писать (:10839-10850). Слагаемое
   *    `!isBot` опущено: признака «это бот» у ленты нет вовсе (в `ChatContext`
   *    его не передаёт никто); `premiumRequired`/`paidMessages` — подсистем
   *    нет;
   *  • `noMessages` — всё остальное (:10856), последняя ветка и у оригинала.
   * Пропущены ветки, у которых нет предмета: `restricted`, `directChannelMessages`,
   * `group` (нужен `pFlags.creator` пира), `noScheduledMessages`, `topic`,
   * `logs`, бот и sponsored.
   */
  private async checkIfEmptyPlaceholderNeeded(): Promise<void> {
    if(
      !this.scrollable.loadedAll.top ||
      !this.scrollable.loadedAll.bottom ||
      this.emptyPlaceholderBubble !== undefined ||
      mirrorWindow(this.chat.messagesStorageKey)?.length
    ) {
      return
    }

    const middleware = this.getMiddleware()
    const type: EmptyPlaceholderType =
      rootScope.myId === this.peerId ? 'saved' :
      !isAnyChat(this.peerId) && await this.chat.canSend?.() ? 'greeting' :
      'noMessages'

    if(!middleware()) {
      return
    }

    return this.renderEmptyPlaceholder(type, middleware)
  }

  /**
   * Порт tweb `renderEmptyPlaceholder` (bubbles.ts:10466) вместе с той частью
   * `processLocalMessageRender` (:10745-10930), которая строит и вешает узел.
   *
   * ОДНО РАСХОЖДЕНИЕ ПО ФОРМЕ, и оно осознанное: у оригинала плейсхолдер — это
   * НАСТОЯЩЕЕ локальное сообщение (`generateLocalFirstMessage(true)`, :11320),
   * которое едет через `safeRenderMessage` и очередь рендера. Здесь узел
   * строится напрямую, потому что у нашего служебного бабла содержимое
   * выводится ИЗ ДЕЙСТВИЯ (`serviceMsgSegs`), а у плейсхолдера действия нет
   * вовсе — сообщение-носитель было бы пустой формальностью, и `renderMessage`
   * нарисовал бы по нему «действие не поддерживается». Каркас и классы при
   * этом дословные (:10769, :10785-10787, :10739, :10743), поэтому SCSS
   * (`_chatBubble.scss:3884` — порт 1:1) подхватывает узел без правок.
   *
   * СОСТАВ ВЕТОК — оригинала (:10474-10600):
   *  • заголовок: `saved` → «Your cloud storage», `greeting`/`noMessages` →
   *    «No messages here yet...»;
   *  • `saved` — четыре строки списка с буллетом «•» (:10510-10515, :10728-10735);
   *  • `greeting` — подпись «Send a message or tap the greeting below.» и
   *    СТИКЕР-ПРИВЕТСТВИЕ (:10516-10600). Ветка `business_intro` (:10531-10566)
   *    не портирована: делового профиля у нас нет.
   * Каждому элементу дописывается `-line`, а сам бабл получает
   * `has-service-description`, если элементов больше одного (:10738-10742) —
   * именно этот класс делает пилюлю КАРТОЧКОЙ (колонка, крупный заголовок,
   * радиус 1.5rem; `_chatBubble.scss:2672-2690`).
   */
  private async renderEmptyPlaceholder(type: EmptyPlaceholderType, middleware: Middleware): Promise<void> {
    const BASE_CLASS = 'empty-bubble-placeholder'

    const bubble = document.createElement('div')
    // tweb :10769 (`is-group-first`/`is-group-last` — плейсхолдер всегда один),
    // :10785 (`bubble-first`), :10473 (`BASE_CLASS` + вид).
    bubble.className = `bubble service is-group-first is-group-last bubble-first ${BASE_CLASS} ${BASE_CLASS}-${type}`

    const contentWrapper = document.createElement('div')
    contentWrapper.classList.add('bubble-content-wrapper')
    const bubbleContainer = document.createElement('div')
    bubbleContainer.classList.add('bubble-content')
    const serviceMsg = document.createElement('div')
    serviceMsg.classList.add('service-msg')
    bubbleContainer.append(serviceMsg)
    contentWrapper.append(bubbleContainer)
    bubble.append(contentWrapper)

    // Строка — УЗЕЛ ЯДРА (`i18n(key)`), а не свой `span` с классом `i18n` и
    // текстом внутри. Класс на самодельном узле — подделка: `applyLangPack`
    // находит его обходом `.i18n`, но `weakMap.get` даёт `undefined`, и узел
    // молча пропускается (`lib/langPack.ts:568-572`). Здесь это был не просто
    // шум, а застывший текст: карточка живёт, пока чат пуст, и смены языка не
    // переживала. Оригинал на этом месте тоже строит `i18n(...)` (:10473-10515).
    const line = (key: LangPackKey, cls: string) => {
      const span = i18n(key)
      span.classList.add('center', cls)
      return span
    }

    const elements: HTMLElement[] = [
      line(type === 'saved' ? 'ChatYourSelfTitle' : 'NoMessages', `${BASE_CLASS}-title`),
    ]

    if(type === 'saved') {
      // tweb :10510-10515 + :10728-10735 — буллет как ОТДЕЛЬНЫЙ узел перед
      // строкой, а не символ в тексте.
      const items: LangPackKey[] = [
        'ChatYourSelfDescription1',
        'ChatYourSelfDescription2',
        'ChatYourSelfDescription3',
        'ChatYourSelfDescription4',
      ]
      for(const key of items) {
        const span = document.createElement('span')
        span.classList.add(`${BASE_CLASS}-list-item`)
        const bullet = document.createElement('span')
        bullet.classList.add(`${BASE_CLASS}-list-bullet`)
        bullet.textContent = '•'
        span.append(bullet, i18n(key))
        elements.push(span)
      }
    } else if(type === 'greeting') {
      elements.push(line('NoMessagesGreetingsDescription', `${BASE_CLASS}-subtitle`))

      const stickerDiv = document.createElement('div')
      stickerDiv.classList.add(`${BASE_CLASS}-sticker`)
      elements.push(stickerDiv)
      // Стикер догоняет карточку — как в оригинале, где `wrapSticker` тоже
      // асинхронен, а место под него в раскладке уже занято (200×200,
      // `_chatBubble.scss:4051-4058`).
      void this.renderGreetingSticker(stickerDiv, middleware)
    }

    // tweb :10738-10742.
    if(elements.length > 1) {
      bubble.classList.add('has-service-description')
    }

    for(const element of elements) {
      element.classList.add(`${BASE_CLASS}-line`)
    }

    serviceMsg.prepend(...elements)

    if(!middleware()) {
      return
    }

    // tweb :10795 (`appendTo = this.container`) + :10781 — плейсхолдер живёт НЕ
    // в скролл-контейнере, а в самой `.bubbles`: CSS центрирует его по ней
    // абсолютом (`_chatBubble.scss:3884-3889`), поэтому он не уезжает вместе с
    // прокруткой и не участвует в раскладке окна.
    this.container.append(bubble)
    this.emptyPlaceholderBubble = bubble
  }

  /**
   * Стикер-приветствие — порт tweb :10520-10589 (`getGreetingSticker` →
   * `wrapSticker` → `attachClickEvent`).
   *
   * Случайный из выдачи — как в оригинале: там набор перемешивается один раз
   * (`greetingStickers.sort(() => Math.random() - Math.random())`,
   * appStickersManager.ts:148) и дальше выдаётся по кругу. Круга у нас нет —
   * карточка живёт ровно одно открытие чата, и второго стикера ей не нужно.
   */
  private async renderGreetingSticker(div: HTMLElement, middleware: Middleware): Promise<void> {
    const docs = await this.managers.stickers?.searchByEmoji('👋').catch(() => [] as MyDocument[])
    if(!middleware() || !docs?.length) {
      return
    }

    const doc = docs[Math.floor(Math.random() * docs.length)]
    wrapSticker({
      mediaId: doc.id,
      div,
      group: 'chat',
      middleware,
      width: GREETING_STICKER_SIZE,
      height: GREETING_STICKER_SIZE,
      emoji: doc.stickerEmojiRaw,
      liteModeKey: 'stickers_chat',
      thumb: getStrippedThumb(doc),
      docWidth: doc.w,
      docHeight: doc.h,
    }).render.catch(noop)

    // tweb :10586-10589 — тап по стикеру ОТПРАВЛЯЕТ его (у оригинала через
    // `emoticonsDropdown.onMediaClick`, у нас — ручкой хоста, см.
    // `ChatContext.sendSticker`).
    div.addEventListener('click', (e) => {
      cancelEvent(e)
      this.chat.sendSticker?.(doc)
    })
  }

  /** Порт tweb `cleanupPlaceholders` (bubbles.ts:5014). У оригинала это
   *  `destroyBubble` (плейсхолдер там — настоящий бабл со своим middleware); у
   *  нас узел построен напрямую (см. `renderEmptyPlaceholder`), поэтому от
   *  уборки остаётся ровно снятие узла. */
  private cleanupPlaceholders(bubble = this.emptyPlaceholderBubble) {
    bubble?.remove()
    if(this.emptyPlaceholderBubble === bubble) {
      this.emptyPlaceholderBubble = undefined
    }
  }

  /** Порт tweb bubbles.ts:4913. Смена пира: карта адресов, секции дней и серии
   *  уходят, (по флагу) уходят и узлы, всё летящее протухает через middleware. */
  public cleanup(bubblesToo = false) {
    this.bubbles = {}
    this.setLoaded('top', false)
    this.setLoaded('bottom', false)

    // tweb bubbles.ts:5005-5008.
    if (this.isScrollingTimeout) {
      clearTimeout(this.isScrollingTimeout)
      this.isScrollingTimeout = 0
    }

    // tweb bubbles.ts:4967-4970: наблюдатель липких дат смотрит на секции
    // ПРОШЛОГО окна — вместе с реестром уходит и он.
    this.stickyIntersector?.disconnect()
    this.previousStickyDate = undefined
    this.firstUnreadBubble = undefined
    this.attachedUnreadBubble = false
    // tweb bubbles.ts:4988 — отложенная лестница держит замыкание на баблы
    // ПРОШЛОГО окна; выполнять её после пересборки нечего.
    this.resolveLadderAnimation = undefined
    // tweb bubbles.ts:4971-4980: наблюдатель непрочитанных смотрел на баблы
    // ПРОШЛОГО окна. `disconnect()` не убивает сам объект — наблюдать им
    // дальше можно, как и `stickyIntersector` строкой выше.
    this.observer?.disconnect()
    this.unreaded.clear()
    this.unreadedSeen.clear()
    // tweb bubbles.ts:4982 — накопленные видимые посты принадлежат ПРОШЛОМУ окну.
    this.viewsMids.clear()
    // Реестр отдач держит промисы, к которым привязаны кольца ПРОШЛОГО окна:
    // сами узлы уходят вместе с ним, а новый рендер того же неотправленного
    // бабла заведёт новый промис (`uploadPromiseFor`). У оригинала реестр
    // переживает смену окна, потому что живёт не в ленте, а в
    // `appDownloadManager`; у нас он ленточный — см. поле `uploads`.
    this.uploads.clear()
    this.readPromise = undefined
    this.renderReadMaxSeq = 0
    // Смещение отфильтрованной выдачи принадлежит ПРОШЛОМУ окну — новое окно
    // фильтра начинается от самого нового отмеченного сообщения. У оригинала
    // ту же роль играет смена ключа хранилища истории (`getHistoryStorageKey`
    // включает `savedReaction`, `getHistoryStorageKey.ts:18-22`): под новым
    // ключом лежит пустой слайс, и листать его тоже не с чего.
    this.savedReactionOffset = 0
    this.getHistoryTopPromise = this.getHistoryBottomPromise = undefined
    // tweb bubbles.ts:4960 — невостребованный сдвиг градиента принадлежит
    // ПРОШЛОМУ окну: прокрутка нового окна не должна его тратить.
    this.updateGradient = undefined
    this.scrolledDown = true

    this.dateMessages = {}
    // Порт tweb bubbles.ts:4943/4956: незакрытые рендеры и недоработанная
    // очередь принадлежат ПРОШЛОМУ поколению ленты. `clear()` не просто
    // опустошает очередь, а гасит её middleware — уже стартовавшая пачка
    // отвергается `PEER_CHANGED_ERROR` и в новое окно ничего не допишет.
    this.renderNewPromises.clear()
    this.batchProcessor.clear()
    this.bubbleGroups.cleanup()
    // Новый инстанс, а не только `cleanup()` — как в tweb (bubbles.ts:4938):
    // у групп остаются собственные middleware-хелперы, привязанные к прошлому
    // поколению ленты.
    this.bubbleGroups = new BubbleGroups(this)

    if (bubblesToo) {
      this.chatInner.replaceChildren()
      // tweb :4947-4950 — узел плейсхолдера снимается ровно тогда, когда
      // сносятся сами баблы: он живёт не в `chatInner`, а в `.bubbles`
      // (см. `renderEmptyPlaceholder`), и `replaceChildren` его не задевает.
      this.cleanupPlaceholders()
    }

    // tweb :4990 — ССЫЛКА гасится всегда: узел прошлого окна снимет `setPeer`
    // (он держит его в `oldPlaceholderBubble` до подмены дерева), а держать на
    // него поле нельзя — иначе `checkIfEmptyPlaceholderNeeded` нового окна
    // решит, что плейсхолдер уже показан.
    this.emptyPlaceholderBubble = undefined

    this.middlewareHelper.clean()
  }

  /**
   * Порт `appImManager.saveChatPosition` (tweb lib/appImManager.ts:2111-2149)
   * — «запомнить, где пользователь оставил чат».
   *
   * ГДЕ ЭТО ЖИВЁТ В ОРИГИНАЛЕ и почему здесь. В tweb метод висит на
   * `appImManager`, потому что там же лежит и карта позиций, но ВСЕ факты,
   * которыми он оперирует, он берёт у ленты — `chatBubbles.scrollable`,
   * `getRenderedLength`, `getViewportSlice`, `sliceViewport`,
   * `getRenderedHistory`. У нас карта осталась отдельным модулем
   * (`core/chat/chatPositions.ts`), а решение — здесь, у владельца фактов.
   *
   * КОГДА ЗОВЁТСЯ. В оригинале — по событию `peer_changing`
   * (appImManager.ts:378-380), то есть «этот чат сейчас уйдёт». У нас чат
   * уходит вместе с инстансом ленты: пир меняет хост, пересоздавая её
   * (`VanillaFeed.tsx`), — поэтому точка одна и это `destroy()`.
   *
   * КОГДА ПОЗИЦИЯ НЕ СОХРАНЯЕТСЯ (`shouldSavePosition`, :2122-2126) — три
   * условия оригинала, и каждое отсекает свой случай:
   *  • чат оставлен ПРИЖАТЫМ К НИЗУ (`getDistanceToEnd() <= 16` вместе с
   *    `loadedAll.bottom`) — восстанавливать нечего, чат и должен открыться
   *    внизу;
   *  • окно пустое (`getRenderedLength()`);
   *  • НИЖЕ ВЬЮПОРТА НИЧЕГО НЕТ (`getViewportSlice().invisibleBottom.length`)
   *    — то же «мы у низа», но измеренное по баблам, а не по пикселям.
   * И тогда прошлая запись УДАЛЯЕТСЯ (:2144), а не остаётся: она увела бы
   * следующее открытие в середину истории.
   *
   * Четвёртое условие оригинала — `!chat.savedReaction` (:2125): позиция в
   * ОТФИЛЬТРОВАННОЙ по тегу выдаче к обычной истории отношения не имеет, и
   * восстанавливать по ней следующее открытие чата нельзя.
   *
   * Ветка `pinnedMessages` (:2119, :2133, :2140-2142) не портирована вместе с
   * плашкой закрепа — это окружение чата, у ленты его нет. Гейт по типу чата
   * (:2112) предмета не имеет — типов чата у ленты нет.
   */
  private saveChatPosition() {
    const peerId = this.peerId
    if(!peerId) {
      return
    }

    const threadId = this.chat.threadId
    const shouldSavePosition =
      !(this.scrollable.getDistanceToEnd() <= 16 && this.scrollable.loadedAll.bottom) &&
      this.getRenderedLength() &&
      !this.savedReaction &&
      this.getViewportSlice().invisibleBottom.length // * don't save if we're close to the end

    if(!shouldSavePosition) {
      deleteChatPosition(peerId, threadId)
      return
    }

    // tweb :2128-2134. Подрезка ПЕРЕД снятием списка — не оптимизация: без неё
    // в позицию уехало бы всё окно целиком, и следующее открытие рисовало бы
    // сотни баблов вместо экрана.
    this.sliceViewport(true)
    saveChatPosition(peerId, threadId, {
      mids: this.getRenderedHistory('desc', true).map((fullMid) => splitFullMid(fullMid).mid),
      top: this.scrollable.scrollPosition,
    })
  }

  /** Порт tweb bubbles.ts:4880. `batchProcessor.clear()` здесь — наше
   *  дополнение: в tweb очередь гасит `cleanup()`, который лента обязательно
   *  проходит на смене пира, а у нас `destroy()` — единственная точка гашения
   *  (`VanillaFeed` зовёт только его). Без этой строки уже стартовавшая пачка
   *  домонтировала бы серии в оторванное от документа дерево. */
  public destroy() {
    // ПЕРВОЙ строкой, до `destroyScrollable()`: позиция читается с живого
    // скролл-контейнера. См. докблок метода.
    this.saveChatPosition()
    // Поколение окна — НАША строка, по той же причине, что `batchProcessor
    // .clear()` ниже: в tweb `setPeerTempId` вытесняет следующий `setPeer`,
    // который его лента обязательно проходит на смене пира, а у нас лента
    // умирает целиком. Без строки страница, доехавшая после `destroy()`,
    // прошла бы `middleware()` (`middlewareHelper` после `destroy()` выдаёт
    // ЖИВОЙ токен — см. `MiddlewareHelper.clean`, где `details` пересоздаются)
    // и дописала бы окно в оторванное дерево.
    ++this.setPeerTempId
    this.destroyScrollable()
    this.listenerSetter.removeAll()
    // Свайп вешает слушатели СВОИМ хендлером, мимо `listenerSetter`, — снимать
    // их надо отдельно. Это НАША строка, а не порт: tweb хендлер не снимает
    // никогда (поле публично ради `selection.ts:817` — сброса жеста при входе
    // в выделение), потому что его лента живёт столько же, сколько приложение.
    // У нас лента умирает на каждой смене чата, а `SwipeHandler` вешает
    // move/end на `element.ownerDocument` (`core/dom/swipeHandler.ts:350,401`),
    // который её переживает, — без снятия это утечка на каждый открытый чат.
    this.replySwipeHandler?.removeListeners()
    this.replySwipeHandler = undefined
    // tweb отвязывает меню и выделение через `Chat.destroy` (chat.ts:845-846:
    // `this.contextMenu?.destroy()`, затем `selection?.attachListeners(undefined,
    // undefined)`); у нас владелец обеих связок — лента, она же их и рвёт.
    this.contextMenu?.destroy()
    this.contextMenu = undefined
    this.selection?.attachListeners(undefined, undefined)
    this.selection?.cleanup()
    this.removeHeavyAnimationListener?.()
    this.sliceViewportDebounced?.clearTimeout()
    // Дебаунс просмотров переживает ленту (таймер висит на окне) и на срабатывании
    // прочитал бы `this.peerId` уже умершего инстанса — гасим вместе с ней, тем же
    // приёмом, что и подрезку вьюпорта строкой выше.
    this.sendViewCountersDebounced?.clearTimeout()
    // tweb bubbles.ts:4891-4897.
    this.observer?.disconnect()
    this.observer = undefined
    this.stickyIntersector?.disconnect()
    this.stickyIntersector = undefined
    if (this.isScrollingTimeout) {
      clearTimeout(this.isScrollingTimeout)
      this.isScrollingTimeout = 0
    }
    this.renderNewPromises.clear()
    this.batchProcessor.clear()
    this.middlewareHelper.destroy()
  }
}
