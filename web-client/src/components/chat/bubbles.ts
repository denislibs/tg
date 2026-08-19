// src/components/chat/bubbles.ts
//
// Императивная лента сообщений — порт tweb `src/components/chat/bubbles.ts`
// (класс `ChatBubbles`). Класс владеет DOM-деревом ленты, скроллом, картой
// отрисованных баблов, подписками на события истории, группировкой серий
// (`bubbleGroups.ts`), секциями дней, очередью рендера, именем автора,
// пагинацией с обеих сторон, сохранением позиции при вставке над вьюпортом
// (`ScrollSaver`), липкими датами (`StickyIntersector`), подрезкой вьюпорта и
// границей непрочитанных. Реакции, время, превью ответа и шапка пересылки
// приезжают следующими этапами.
//
// Источник данных — НЕреактивное зеркало окон `core/history/messagesMirror.ts`
// (порт `apiManagerProxy.mirrors`): страницу истории лента кладёт туда сама
// (`getHistory` → `putMirrorPage`), точечные изменения приезжают событиями
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
//  • `BubblesManagers` вместо всего `AppManagers`: ленте нужны ровно четыре
//    метода — `messages.getHistory`, `peers.fillMirror` (объявить пробел
//    зеркала карточек, см. `peerTitle.ts`) и пара `dialogs.*` под границу
//    непрочитанных. Узкий тип позволяет поднять ленту в тесте без RPC-моста.
//  • `setPeer` не портирован (этап 7), поэтому первую страницу окна
//    запрашивает `loadFirstHistory()` — извлечённый фрагмент его тела
//    (bubbles.ts:5337-5344). Всё остальное в пагинации 1:1: `loadMoreHistory`
//    → `getHistory1` (гейт стороны + предзагрузка) → `getHistory`.
//  • `attachContainerListeners()` портирован ЧАСТИЧНО — ровно тем составом, у
//    которого уже есть предмет: делегирование кликов по размеченным узлам
//    rich-text. Контекстное меню, выделение, dblclick-ответ и свайпы —
//    поведение, которого ещё нет; пустые ветки под них = мёртвый код
//    (CLAUDE.md). Зовёт его конструктор: в tweb это делает `Chat`
//    (`chat.ts:638`), а у нас `Chat`-хоста нет.
//  • `processBatch` портирован вместе со скроллом (`changedTop`/`changedBottom`
//    → `reverse` → `prepareToSaveScroll`/`restoreScroll`) и ожиданиями
//    (`getHeavyAnimationPromise`, `setUnreadDelimiter`, `fastRafPromise`). Вне
//    порта осталось то, у чего нет предмета: ожидание медиа-промисов единицы
//    (наш состав бабла синхронный), подмена баблов
//    (`bubblesToReplace`/`ejectBubbles`), лесенка (`canAnimateLadder`),
//    выделение, sponsored, `lazyLoadQueue` — построчно перечислено у метода.
//  • Ре-кей бабла на новый идентификатор в tweb живёт в подписке `message_sent`
//    (bubbles.ts:900-906: `delete this.bubbles[fullTempMid]` →
//    `this.bubbles[fullMid] = bubble` → `bubble.dataset.mid = mid`), а
//    `history_update` там репозиционирует уже переклеенный бабл. У нас
//    `message_sent` в каталоге нет: смену идентификатора объявляет
//    `history_update` вместе с `tempId` (см. докблок `lib/rootScope.ts` и
//    `core/history/messagesMirror.ts`), поэтому ре-кей выполняет он —
//    строки тела перенесены дословно.
//  • Ветка `hide-name` живёт не здесь, а в `bubbleClasses` (общий с React-лентой
//    вычислитель модификаторов бабла): в tweb класс ставится прямо по ходу
//    сборки имени (bubbles.ts:9516/9648), у нас — по тому же признаку
//    `showName`, который лента считает `needName`.
import Scrollable, { type SliceSides } from '@components/scrollable'
import StickyIntersector from '@components/stickyIntersector'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware, type Middleware } from '@helpers/middleware'
import BatchProcessor, { type MiddlewareAwaiter } from '@helpers/batchProcessor'
import indexOfAndSplice from '@helpers/array/indexOfAndSplice'
import noop from '@helpers/noop'
import cancelEvent from '@helpers/dom/cancelEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import getViewportSlice from '@helpers/dom/getViewportSlice'
import ScrollSaver from '@helpers/scrollSaver'
import debounce, { type DebounceReturnType } from '@helpers/schedulers/debounce'
import { fastRafPromise } from '@helpers/schedulers'
import { FocusDirection, type ScrollStartCallbackDimensions } from '@helpers/fastSmoothScroll'
import windowSize from '@helpers/windowSize'
import mediaSizes from '@helpers/mediaSizes'
import { IS_SAFARI } from '@environment/userAgent'
import { getHeavyAnimationPromise, onHeavyAnimation as useHeavyAnimationCheck } from '@core/dom/heavyAnimation'
import rootScope from '@lib/rootScope'
import { ANCHOR_ACTION_ATTRIBUTE, wrapMessageText, type AnchorAction } from '@lib/richtext'
import { mirrorWindow, putMirrorPage } from '@core/history/messagesMirror'
import { messageToConvMsg } from '@core/messageToConvMsg'
import { dayLabel } from '@core/format/dayLabel'
import type { Message } from '@core/models'
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
import { createDateBubble as createServiceDateBubble } from './serviceMessage'
import PeerTitle, { type PeerTitleManagers } from './peerTitle'
import { useI18nStore } from '../../i18n'

/** Адрес бабла — порт tweb `FullMid` (`${peerId}_${mid}`, bubbles.ts:440-449).
 *
 *  Вторая половина ключа у нас — `Message.id`, а НЕ `seq`. Причина ровно та же,
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
}

/** Срез менеджеров, которым пользуется лента (см. расхождения в шапке). */
export interface BubblesManagers extends PeerTitleManagers {
  messages: { getHistory(args: HistoryArgs): Promise<HistoryResult> }
  /** Порт двух источников границы непрочитанных: `appMessagesManager
   *  .getReadMaxIdIfUnread` и `Chat.getHistoryMaxId` (tweb bubbles.ts:11570-11572).
   *  Владелец обоих фактов у нас — воркерный `dialogsManager` (запись диалога),
   *  ленте они приезжают RPC — как в tweb, где это тоже вызовы менеджера. */
  dialogs: {
    getReadMaxSeqIfUnread(chatId: number): Promise<number>
    getHistoryMaxSeq(chatId: number): Promise<number>
  }
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
  message: Message
  bubble: HTMLElement
  /** Порт поля `reverse` единицы очереди (tweb bubbles.ts:6294): «сообщение
   *  дописывается НАД вьюпортом». Из него `processBatch` выводит направление
   *  якоря `ScrollSaver` для всей пачки. */
  reverse: boolean
}

// tweb bubbles.ts:307. Ближе этого к низу лента считается «прижатой» —
// и кнопка «вниз» гаснет, и новое сообщение доводится скроллом.
const SCROLLED_DOWN_THRESHOLD = 300

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

  // tweb bubbles.ts:492-493 — «страница этой стороны уже в полёте». Он же гейт
  // повторного триггера пагинации (`loadMoreHistory`).
  private getHistoryTopPromise?: Promise<unknown>
  private getHistoryBottomPromise?: Promise<unknown>

  // tweb bubbles.ts:544-547.
  private scrolledDown = true
  private isScrollingTimeout = 0
  private stickyIntersector?: StickyIntersector
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
  // tweb bubbles.ts:604 — «лента короче вьюпорта, поэтому ей подставлена
  // верхняя распорка».
  private isTopPaddingSet = false
  // Отписка от шины тяжёлых анимаций (в tweb её снимает `listenerSetter`,
  // которому `useHeavyAnimationCheck` передан третьим аргументом).
  private removeHeavyAnimationListener?: () => void

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

  // Порт tweb bubbles.ts:1439-1458 — дерево дословно.
  private constructBubbles() {
    const container = this.container = document.createElement('div')
    container.classList.add('bubbles', 'scrolled-down')

    const chatInner = this.chatInner = document.createElement('div')
    chatInner.classList.add('bubbles-inner')

    const removerContainer = document.createElement('div')
    removerContainer.classList.add('bubbles-remover-container')
    const remover = this.remover = document.createElement('div')
    remover.classList.add('bubbles-remover', 'bubbles-inner')
    removerContainer.append(remover)

    const floatingSeparatorsContainer = this.floatingSeparatorsContainer = document.createElement('div')
    floatingSeparatorsContainer.classList.add('bubbles-floating-separators-container')

    this.setScroll()

    container.append(removerContainer, this.scrollable.container, floatingSeparatorsContainer)
  }

  // Порт tweb bubbles.ts:4169-4187. Высоты распорок в tweb приезжают из
  // `chat.chatPaddingTop/Bottom` (плейты топбара и высота композера) — этого
  // окружения у ленты на этапе 2 нет, поэтому узлы создаются без высоты.
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
   *  Не портированы `checkPlaceholders`-ветки (`setPeerLanguageLoaded`,
   *  sponsored, плейсхолдеры бота/пустого чата/неизвестного пользователя,
   *  `checkIfEmptyPlaceholderNeeded`) — ни одной из этих подсистем в ленте ещё
   *  нет; вместе с ними отпадает и сам параметр `checkPlaceholders`. */
  private setLoaded(side: SliceSides, value: boolean) {
    const willChange = this.scrollable.loadedAll[side] !== value
    if(!willChange) {
      return
    }

    this.scrollable.loadedAll[side] = value
    this.scrollable.onScroll() // ! WARNING
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
  private getMessage(mid: number): Message | undefined {
    return mirrorWindow(this.chat.messagesStorageKey)?.find((m) => m.id === mid)
  }

  private classesFor(message: Message): string[] {
    // `out` — поле самого сообщения (порт tweb `pFlags.out`), его выводит
    // владелец в воркере; лента только читает. `rootScope.myId` (порт tweb
    // rootScope.ts:253) нужен messageToConvMsg лишь для автора превью ответа
    // («Вы» vs имя собеседника) — 1:1 с оригиналом, где лента берёт свой id
    // оттуда же (bubbles.ts:740, 813, 928).
    const conv = messageToConvMsg(message, rootScope.myId)
    return bubbleClasses(conv, { ...STUB_CTX, out: !!message.out, showName: this.needName(message) })
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
  private needName(message: Message): boolean {
    const iPostedAsSomeoneElse = this.bubbleGroups.getMessageFromId(message) !== rootScope.myId
    return (iPostedAsSomeoneElse || !message.out) && !!this.chat.isLikeGroup
  }

  /** Порт tweb `createTitle` (bubbles.ts:9984). Цвет пира
   *  (`getPeerColorIndexByPeer` → `peer-N-color-rgb`) и значок премиума не
   *  портированы: палитры пиров и премиум-статусов в нашей модели нет — сам
   *  класс `colored-name` при этом ставится, его CSS берёт цвет от
   *  `data-peer-id` бабла. */
  private createTitle(message: Message, fromId: number): PeerTitle {
    return new PeerTitle({
      peerId: fromId,
      // send-as: карточки у чат-личности нет (владелец знает только
      // пользователей), а её заголовок приезжает прямо в сообщении — это ровно
      // случай `fromName` в оригинале (peerTitle.ts:105-113).
      fromName: message.sendAs?.title,
      middleware: this.getMiddleware(),
      managers: this.managers,
    })
  }

  // Каркас бабла: `.bubble > .bubble-content-wrapper > .bubble-content >
  // .message.spoilers-container` (tweb bubbles.ts:6618-6629). Медиа, время,
  // реакции и прочий состав `.bubble-content` — следующие этапы.
  private renderMessage(message: Message): HTMLElement {
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
    messageDiv.append(this.wrapMessageContent(message))

    bubbleContainer.append(messageDiv)

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
      nameDiv.append(this.createTitle(message, fromId).element)
      // tweb :9502-9513. `noColor` в оригинале не присваивается никогда, так что
      // ветка всегда живая; `our` для группы — ровно `pFlags.out`
      // (chat.ts:1375-1377 `isOurMessage` при `isMegagroup`).
      if (!message.out) {
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

    contentWrapper.append(bubbleContainer)
    bubble.append(contentWrapper)

    return bubble
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
  private wrapMessageContent(message: Message): DocumentFragment {
    return wrapMessageText(message.text, message.entities, { middleware: this.getMiddleware() })
  }

  /** Порт tweb `groupBubbles` (bubbles.ts:5984-6028) в применимом объёме: ветка
   *  `ChatType.Scheduled` и аватары серий не портированы. Аватар в tweb
   *  заводится здесь же по `isAvatarNeeded` (bubbles.ts:6008 →
   *  `chat.isLikeGroup && !isOutMessage`), а `isLikeGroup` — знание о типе
   *  пира, которого в `ChatContext` ещё нет; поэтому и гейт, и сам узел
   *  аватара приедут одной работой (см. `createAvatar` ниже). */
  public groupBubbles(items: { bubble: HTMLElement, message: Message }[]): BubbleGroup[] {
    items.forEach(({ bubble, message }) => {
      this.bubbleGroups.prepareForGrouping(bubble, message)
    })

    return [...this.bubbleGroups.groupUngrouped()]
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
  private safeRenderMessage(message: Message, reverse: boolean): RenderedMessage | undefined {
    const fullMid = makeFullMid(this.peerId, message.id)
    if (this.bubbles[fullMid]) return undefined

    const bubble = this.renderMessage(message)
    this.bubbles[fullMid] = bubble

    const details: RenderedMessage = { message, bubble, reverse }
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
  private renderNewMessage(message: Message, scrolledDown?: boolean): Promise<void> {
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
   * нас отдельное, чужое сюда не приезжает), `savedReaction` (фильтр окна по
   * своей реакции — подсистемы нет), `cancelPreservePaddingScroll` (нижняя
   * распорка композера — окружение `Chat`), ветка `ChatType.Scheduled`.
   */
  private async _renderNewMessage(message: Message, scrolledDown?: boolean): Promise<void> {
    if (!this.scrollable.loadedAll.bottom) { // seems search active or sliced
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

  /** Дата-разделитель дня. Сам узел строит модуль сервисных сообщений
   *  (`serviceMessage.ts::createDateBubble`, порт tweb bubbles.ts:4778-4813) —
   *  здесь остаётся ровно то, чем владеет лента: подпись дня и ключ секции.
   *
   *  Подпись в tweb считает `formatDate`/`i18n` внутри самого `createDateBubble`;
   *  у нас её отдаёт вызывающий (`core/format/dayLabel`), а язык берётся из
   *  стора i18n на момент постройки узла — как в других ванильных портах
   *  (`connectionStatus.ts`, `mediaViewer/appMediaViewer.ts`).
   *  `data-date` — ключ дня в той же форме, что рисует React-лента
   *  (`components/messages/ChatFeed.tsx:82-96`): на него смотрит
   *  `components/chatStickyDates.ts`. */
  private createDateBubble(dateTimestamp: number): HTMLElement {
    const bubble = createServiceDateBubble(
      dayLabel(new Date(dateTimestamp).toISOString(), useI18nStore.getState().lang),
    )
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
   *  строку заменил ЕЁ ОРИГИНАЛ: узел ставит наблюдатель, второй sentinel в ту
   *  же секцию не попадает (та же ловушка разобрана в
   *  `components/chatStickyDates.ts::observeNewSections`). */
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

  /** Порт связки tweb `avatarNew` + `chat.bubbles.lazyLoadQueue`
   *  (bubbleGroups.ts:140).
   *
   *  Пока НЕ ЗОВЁТСЯ и заведомо возвращает пустой узел: аватар серии — это
   *  карточка пира (фото/инициалы/градиент), а её знает стор пиров, куда ленте
   *  ходить нельзя, и гейт `isAvatarNeeded` (tweb bubbles.ts:11689) требует
   *  `chat.isLikeGroup`, которого в `ChatContext` тоже ещё нет. Метод
   *  реализован потому, что его требует контракт `BubbleGroupsHost`, и служит
   *  точкой подключения: ванильный порт `avatarNew` встанет ровно сюда, а
   *  вызов — в `groupBubbles` (tweb bubbles.ts:6005-6015). */
  public createAvatar(_message: Message, _middleware: Middleware): GroupAvatar {
    return { node: document.createElement('div') }
  }

  // ─── клики ────────────────────────────────────────────────────────────────

  /** Порт tweb `attachContainerListeners` (bubbles.ts:1460) в применимом
   *  объёме — ОДИН делегированный слушатель на контейнере ленты. Разбирает
   *  разметку, которую оставляет rich-text вместо inline-обработчиков tweb
   *  (см. докблок `BubblesNavigation`). Контекстное меню, выделение, dblclick
   *  и свайпы не портированы: их поведения ещё нет. */
  private attachContainerListeners() {
    this.listenerSetter.add(this.container)('click', this.onContainerClick)
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
    history: readonly (Message | number)[],
    reverse: boolean,
    isEnd?: { top?: boolean, bottom?: boolean },
  ): Promise<void> {
    if (!this.scrollable.loadedAll.bottom || !this.scrollable.loadedAll.top) {
      if (isEnd?.top) this.setLoaded('top', true)
      if (isEnd?.bottom) this.setLoaded('bottom', true)
    }

    for (const item of history) {
      const message = typeof item === 'number' ? this.getMessage(item) : item
      if (!message) continue
      this.safeRenderMessage(message, reverse)
    }

    await this.awaitMessagesQueue()
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
   *  чата (`Scheduled`/`Pinned`/`Search`) у ленты нет. */
  public getHistory1(maxId?: FullMid, reverse?: boolean, isBackLimit?: boolean, justLoad?: boolean) {
    const middleware = this.getMiddleware(justLoad ? undefined : () => {
      return (reverse ? this.getHistoryTopPromise : this.getHistoryBottomPromise) === waitPromise
    })

    const result = this.getHistory(maxId, reverse, isBackLimit, justLoad, middleware)
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
   *  РАСХОЖДЕНИЕ, которое нельзя обойти: в tweb `mid` — И идентификатор, И
   *  порядковый ключ, поэтому `offset_id` там буквально `maxId`. У нас это два
   *  разных поля (`Message.id` — адрес, `Message.seq` — порядок, см. докблок
   *  `FullMid`), а страницу бэкенд отдаёт по `offset_seq`. Поэтому seq берётся
   *  из зеркала по адресу.
   *
   *  Форма `(maxId, loadCount, backLimit)` — оригинальная; отображение на нашу
   *  ручку такое же, как у React-ленты (`core/hooks/useMessageWindow.ts`):
   *  «старее» — `addOffset: 1` (наш бэкенд включает сам `offset_seq`, менеджер
   *  срезает пересечение), «новее» — `addOffset: -backLimit`, первая страница —
   *  `offsetSeq: 0`. */
  private requestHistory(maxId: FullMid, loadCount: number, backLimit: number): Promise<HistoryResult> {
    const { mid } = splitFullMid(maxId)
    const offsetSeq = mid ? (this.getMessage(mid)?.seq ?? 0) : 0

    return this.managers.messages.getHistory({
      peerId: this.chat.peerId,
      threadRoot: this.chat.threadId,
      offsetSeq,
      addOffset: backLimit ? -backLimit : (offsetSeq ? 1 : 0),
      limit: loadCount || backLimit,
    })
  }

  /**
   * Load and render history — порт tweb `getHistory` (bubbles.ts:11380).
   * @param maxId max message id
   * @param reverse 'true' means up
   * @param isBackLimit is search
   * @param justLoad do not render
   */
  public async getHistory(
    maxId: FullMid = EMPTY_FULL_MID,
    reverse = false,
    isBackLimit = false,
    justLoad = false,
    middleware?: () => boolean,
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

    // Ветка `additionalFullMid` (:11425-11453 — дорисовать последнее сообщение
    // поверх страницы прыжка) не портирована: её единственный вызывающий —
    // `setPeer`, которого у ленты ещё нет. Вместе с ней отпадают `isAdditionRender`
    // и второй, «догоняющий», промис `waitPromise` — он остаётся самим `promise`,
    // ровно как в оригинале при `isAdditionRender === false` (:11538).
    const sup = async () => {
      await getHeavyAnimationPromise()

      // Наше зеркало наполняет тот, кто загрузил страницу (см. докблок
      // `putMirrorPage`); в tweb это делает сам менеджер, поэтому здесь у
      // оригинала строки нет — но `performHistoryResult` там точно так же
      // читает УЖЕ ЛЕЖАЩЕЕ, а не ответ сети.
      putMirrorPage(this.chat.messagesStorageKey, historyResult.messages)

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

    return { cached: !!historyResult.cached, promise, waitPromise: promise }
  }

  /** Порт фрагмента tweb `setPeer` (bubbles.ts:5337-5344 + ожидание `promise`
   *  ниже по телу), которым лента запрашивает ПЕРВУЮ страницу окна:
   *  `getHistory1(EMPTY_FULL_MID, true)` — «от самого низа истории и вверх».
   *  Остальной `setPeer` (смена пира, сохранённая позиция, прыжок к сообщению,
   *  лесенка) — этап 7; сюда вынесен ровно тот его кусок, у которого уже есть
   *  предмет, чтобы у хоста (`VanillaFeed`) был один честный вход. */
  public async loadFirstHistory(): Promise<void> {
    const result = await this.getHistory1(EMPTY_FULL_MID, true)
    // `.catch(noop)` — та же причина, что у `safeRenderMessage`: страницу
    // отвергает `PEER_CHANGED_ERROR`, когда поколение ленты умерло за время
    // полёта запроса; для ждущего это не сбой, а «дальше не работаем». В tweb
    // ту же роль играет `m(...)` вокруг `getHistory1` внутри `setPeer`.
    await result?.promise.catch(noop)
  }

  // ─── скролл, пагинация, липкие даты ──────────────────────────────────────

  /** Порт tweb `getRenderedHistory` (bubbles.ts:3981). Источник порядка —
   *  СЕРИИ, а не карта адресов: `this.bubbles` не упорядочен, а группы лежат от
   *  нижней к верхней, элементы внутри — от нового к старому.
   *
   *  `clearOutgoing` в оригинале отсекает ещё не подтверждённые сообщения по
   *  битовой разметке mid (`clearMessageId`) — у нас неотправленный бабл несёт
   *  ОТРИЦАТЕЛЬНЫЙ `id` (см. докблок `FullMid`), то есть отсекается тем же
   *  условием, что и `clearLocal`; отдельного параметра для него нет. */
  public getRenderedHistory(sort: 'asc' | 'desc' = 'desc', clearLocal?: boolean): FullMid[] {
    let history = this.bubbleGroups.groups
      .map((group) => group.items.map((item) => makeFullMid(this.peerId, item.mid)))
      .flat()

    if (sort === 'asc') {
      history.reverse()
    }

    if (clearLocal) {
      history = history.filter((fullMid) => splitFullMid(fullMid).mid > 0)
    }

    return history
  }

  /** Порт tweb bubbles.ts:2910. */
  public getRenderedLength(): number {
    return this.getRenderedHistory().length
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
   *  Не портированы: гейт `isLoading` (`!this.preloader.detached` — прелоадер
   *  первой загрузки у нас живёт в `Chat.tsx`, не в ленте) и ветка
   *  `willScrollOnLoad` (её взводит `setPeer`). */
  private onRenderScrollSet(state?: { scrollHeight: number, clientHeight: number }) {
    const className = 'has-sticky-dates'
    if(this.container.classList.contains(className)) {
      return
    }

    state ??= {
      scrollHeight: this.scrollable.scrollSize,
      clientHeight: this.scrollable.clientSize,
    }

    if(state.scrollHeight === state.clientHeight) {
      return
    }

    const middleware = this.getMiddleware()
    setTimeout(() => {
      if(!middleware()) return
      this.container.classList.add(className)
    }, 600)
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
      .find((fullMid) => (this.bubbleGroups.getItemByBubble(this.getBubble(fullMid)!)?.seq ?? 0) > readMaxSeq)

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

    const foundSeq = this.bubbleGroups.getItemByBubble(bubble)?.seq ?? 0
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
      void this.renderNewMessage(message)
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

    // tweb bubbles.ts:1903
    this.listenerSetter.add(rootScope)('history_delete', ({ peerId, msgs }) => {
      if (peerId !== this.peerId) return
      this.deleteMessagesByIds([...msgs].map((mid) => makeFullMid(peerId, mid)))
    })
  }

  /** Правка содержимого одного бабла. В tweb это перерендер (новый узел
   *  въезжает на место старого через `bubblesToReplace`/`changeBubbleByBubble`,
   *  bubbles.ts:6338); у нас состав бабла — текст, поэтому обновляются
   *  модификаторы и тело сообщения поверх ТОГО ЖЕ узла, и карта адресов не
   *  трогается.
   *
   *  `item.message` в группах при этом не обновляется — как и в tweb, где
   *  `prepareForGrouping` на правке находит существующий элемент и выходит
   *  (bubbleGroups.ts:619, «should happen only on edit»). */
  private onMessageEdit(message: Message) {
    const bubble = this.getBubble(makeFullMid(this.peerId, message.id))
    if (!bubble) return

    // `className` пишется целиком — значит, стираются и `is-group-first`/
    // `is-group-last`, которыми владеет серия. Возвращает их владелец, а не
    // мы: `updateClassNames` — единственное место, где эти классы считаются.
    bubble.className = this.classesFor(message).join(' ')
    this.bubbleGroups.getItemByBubble(bubble)?.group?.updateClassNames()

    bubble.querySelector('.message')?.replaceChildren(this.wrapMessageContent(message))
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
    }

    this.scrollable.ignoreNextScrollEvent()
    this.deleteEmptyDateGroups()

    if (!ignoreOnScroll) {
      this.scrollable.onScroll()
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
    this.getHistoryTopPromise = this.getHistoryBottomPromise = undefined
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
    }

    // tweb делает это следом, уже в `setPeer` (bubbles.ts:5420) — у нас
    // `setPeer` не портирован, а реестр секций опустел прямо здесь.
    this.container.classList.remove('has-groups')

    this.middlewareHelper.clean()
  }

  /** Порт tweb bubbles.ts:4880. `batchProcessor.clear()` здесь — наше
   *  дополнение: в tweb очередь гасит `cleanup()`, который лента обязательно
   *  проходит на смене пира, а у нас `destroy()` — единственная точка гашения
   *  (`VanillaFeed` зовёт только его). Без этой строки уже стартовавшая пачка
   *  домонтировала бы серии в оторванное от документа дерево. */
  public destroy() {
    this.destroyScrollable()
    this.listenerSetter.removeAll()
    this.removeHeavyAnimationListener?.()
    this.sliceViewportDebounced?.clearTimeout()
    // tweb bubbles.ts:4893-4897.
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
