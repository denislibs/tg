// src/components/chat/bubbles.ts
//
// Императивная лента сообщений — порт tweb `src/components/chat/bubbles.ts`
// (класс `ChatBubbles`). Класс владеет DOM-деревом ленты, скроллом, картой
// отрисованных баблов, подписками на события истории, группировкой серий
// (`bubbleGroups.ts`), секциями дней, очередью рендера и именем автора. Медиа,
// реакции, время, превью ответа и шапка пересылки приезжают следующими этапами.
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
//    У нас из него нужны ровно peerId, threadId, ключ окна
//    (`chat.messagesStorageKey`) и адресат кликов (`navigation`), — поэтому
//    конструктор берёт узкий структурный тип. Полный `Chat` — этап 7, когда
//    лента заберёт себе и остальное окружение.
//  • `BubblesManagers` вместо всего `AppManagers`: ленте нужны ровно два
//    метода — `messages.getHistory` и `peers.fillMirror` (объявить пробел
//    зеркала карточек, см. `peerTitle.ts`). Узкий тип позволяет поднять ленту в
//    тесте без RPC-моста.
//  • `attachContainerListeners()` портирован ЧАСТИЧНО — ровно тем составом, у
//    которого уже есть предмет: делегирование кликов по размеченным узлам
//    rich-text. Контекстное меню, выделение, dblclick-ответ и свайпы —
//    поведение, которого ещё нет; пустые ветки под них = мёртвый код
//    (CLAUDE.md). Зовёт его конструктор: в tweb это делает `Chat`
//    (`chat.ts:638`), а у нас `Chat`-хоста нет.
//  • `performHistoryResult` без параметра `reverse`: `reverse` в tweb значит
//    «подгрузка НАД вьюпортом», а пагинации ещё нет — единственный
//    потребитель грузит первую страницу и дописывает её вниз.
//  • `processBatch` портирован в объёме своего КАРКАСА: фильтр протухших
//    единиц, ОДНА группировка на пачку и монтирование затронутых серий. Всё
//    остальное тело оригинала (bubbles.ts:5808-5959) — про подсистемы, которых
//    ещё нет: сохранение/восстановление скролла (`prepareToSaveScroll`,
//    `changedTop`/`changedBottom`, `reverse`), ожидание медиа-промисов и
//    `fastRafPromise`, подмена баблов (`bubblesToReplace`/`ejectBubbles`),
//    лестница (`canAnimateLadder`), выделение, sponsored, `lazyLoadQueue`.
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
import Scrollable from '@components/scrollable'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware, type Middleware } from '@helpers/middleware'
import BatchProcessor from '@helpers/batchProcessor'
import indexOfAndSplice from '@helpers/array/indexOfAndSplice'
import noop from '@helpers/noop'
import cancelEvent from '@helpers/dom/cancelEvent'
import rootScope from '@lib/rootScope'
import { ANCHOR_ACTION_ATTRIBUTE, wrapMessageText, type AnchorAction } from '@lib/richtext'
import { mirrorWindow, putMirrorPage } from '@core/history/messagesMirror'
import { messageToConvMsg } from '@core/messageToConvMsg'
import { dayLabel } from '@core/format/dayLabel'
import type { Message } from '@core/models'
import type { HistoryArgs, HistoryResult } from '@core/managers/messagesManager'
import { bubbleClasses, type BubbleCtx } from '../messages/bubbleClasses'
import BubbleGroups, {
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
  /** адресат кликов по ссылкам/именам — аналог tweb `chat.appImManager` */
  navigation?: BubblesNavigation
}

/** Срез менеджеров, которым пользуется лента (см. расхождения в шапке). */
export interface BubblesManagers extends PeerTitleManagers {
  messages: { getHistory(args: HistoryArgs): Promise<HistoryResult> }
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
}

// tweb считает размер страницы от высоты окна (`Math.min(40, windowSize.height / 40)`,
// bubbles.ts:11392). У нашего `messages.getHistory` тот же потолок и он же дефолт.
const PAGE_COUNT = 40

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
    this.scrollable.loadedAll.top = false
    this.scrollable.loadedAll.bottom = false

    this.paddingTop = document.createElement('div')
    this.paddingTop.classList.add('bubbles-padding', 'bubbles-padding-top')

    this.paddingBottom = document.createElement('div')
    this.paddingBottom.classList.add('bubbles-padding', 'bubbles-padding-bottom')

    this.scrollable.container.append(this.paddingTop, this.chatInner, this.paddingBottom)
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
   * тот же ключ автора, по которому бьются серии (send-as кодируется
   * отрицательным id чата, как peerId в самом tweb).
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
   */
  private processBatch = async (loadQueue: (RenderedMessage | undefined)[]) => {
    const filtered = loadQueue.filter((details): details is RenderedMessage =>
      !!details && this.getBubble(makeFullMid(this.peerId, details.message.id)) === details.bubble)

    if (!filtered.length) {
      return
    }

    this.bubbleGroups.mountUnmountGroups(this.groupBubbles(filtered))
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
  private safeRenderMessage(message: Message): RenderedMessage | undefined {
    const fullMid = makeFullMid(this.peerId, message.id)
    if (this.bubbles[fullMid]) return undefined

    const bubble = this.renderMessage(message)
    this.bubbles[fullMid] = bubble

    const details: RenderedMessage = { message, bubble }
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
  private renderNewMessage(message: Message): Promise<void> {
    const promise = this._renderNewMessage(message)
    this.renderNewPromises.add(promise)
    promise.catch(noop).finally(() => {
      this.renderNewPromises.delete(promise)
    })
    return promise
  }

  /** Порт tweb `_renderNewMessage` (bubbles.ts:4537) в применимом объёме:
   *  ветки про несведённый низ окна, треды, `savedReaction` и доводку скролла
   *  к новому баблу приедут со своими подсистемами (пагинация, скролл). */
  private async _renderNewMessage(message: Message): Promise<void> {
    if (this.getBubble(makeFullMid(this.peerId, message.id))) {
      return
    }

    await this.performHistoryResult([message])
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
   *  Третий узел секции — sticky-sentinel. В tweb его кладёт
   *  `stickyIntersector.observeStickyHeaderChanges` (bubbles.ts:4867 →
   *  `components/stickyIntersector.ts::addSentinel`), и на это опирается
   *  арифметика позиций: `STICKY_OFFSET === 3` — АБСОЛЮТНЫЙ индекс первой
   *  серии внутри секции (`positionElementByIndex` в `bubbleGroups.ts`).
   *  Sticky-даты сама лента ещё не ведёт (наблюдателя нет), но узел обязан
   *  быть: без него серия, смонтированная раньше более старой (а
   *  `groupUngrouped` обходит окно от новых к старым), встала бы в секцию
   *  ВЫШЕ неё. Когда лента заведёт `StickyIntersector`, наблюдать секцию надо
   *  этим узлом — второй вызов `observeStickyHeaderChanges` добавил бы
   *  четвёртый узел и сдвинул бы все серии (та же ловушка разобрана в
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
    const sentinel = document.createElement('div')
    sentinel.classList.add('sticky_sentinel', 'sticky_sentinel--top')

    const container = document.createElement('section')
    container.className = 'bubbles-date-group'
    container.append(bubble, fakeBubble, sentinel)

    const ret = this.dateMessages[dateTimestamp] = { container, groupsLength: 0 }

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

    this.container.classList.add('has-groups')

    return ret
  }

  /** Порт tweb `deleteEmptyDateGroups` (bubbles.ts:11616). Не портированы
   *  снятие наблюдения секции (наблюдателя ещё нет),
   *  `checkIfEmptyPlaceholderNeeded` и `setStickyDateManually`. */
  public deleteEmptyDateGroups() {
    let deleted = false
    for (const key in this.dateMessages) {
      const dateMessage = this.dateMessages[key]
      if (dateMessage.groupsLength) {
        continue
      }

      dateMessage.container.remove()
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
    isEnd?: { top?: boolean, bottom?: boolean },
  ): Promise<void> {
    if (isEnd?.top) this.scrollable.loadedAll.top = true
    if (isEnd?.bottom) this.scrollable.loadedAll.bottom = true

    for (const item of history) {
      const message = typeof item === 'number' ? this.getMessage(item) : item
      if (!message) continue
      this.safeRenderMessage(message)
    }

    await this.awaitMessagesQueue()
  }

  /** Порт tweb bubbles.ts:11380: лента сама грузит свою страницу истории,
   *  кладёт её в зеркало и рисует. Аргументов пагинации (maxId/reverse/
   *  isBackLimit) здесь нет — пагинация приезжает следующим этапом. */
  public async getHistory(): Promise<void> {
    const middleware = this.middlewareHelper.get()
    const historyResult = await this.managers.messages.getHistory({
      chatId: this.chat.peerId,
      threadRoot: this.chat.threadId,
      limit: PAGE_COUNT,
    })
    // Чат сменился / лента убита, пока летел запрос — писать нечего.
    if (!middleware()) return

    putMirrorPage(this.chat.messagesStorageKey, historyResult.messages)
    await this.performHistoryResult(
      historyResult.messages.map((m) => m.id),
      { top: historyResult.reachedTop, bottom: historyResult.reachedBottom },
    )
  }

  /** Порт tweb bubbles.ts:1860/765/1104/1903 (`constructPeerHelpers`). Каждая
   *  подписка сверяет, что событие про ТЕКУЩЕЕ окно: по `storageKey`, а где его
   *  в каталоге нет (`history_delete`) — по `peerId`, ровно как в оригинале. */
  private constructPeerHelpers() {
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

  /** Порт tweb `deleteMessagesByIds` (bubbles.ts:4302-4313): забыть адрес и
   *  снять бабл ЧЕРЕЗ ГРУППЫ — `removeAndUnmountBubble` не только убирает узел,
   *  но и сливает обратно соседей, которых удалённый бабл разделял. */
  public deleteMessagesByIds(fullMids: string[]) {
    for (const fullMid of fullMids) {
      const bubble = this.bubbles[fullMid]
      if (!bubble) continue

      delete this.bubbles[fullMid]
      this.bubbleGroups.removeAndUnmountBubble(bubble)
    }
  }

  /** Порт tweb bubbles.ts:4913. Смена пира: карта адресов, секции дней и серии
   *  уходят, (по флагу) уходят и узлы, всё летящее протухает через middleware. */
  public cleanup(bubblesToo = false) {
    this.bubbles = {}
    this.scrollable.loadedAll.top = false
    this.scrollable.loadedAll.bottom = false

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
    this.renderNewPromises.clear()
    this.batchProcessor.clear()
    this.middlewareHelper.destroy()
  }
}
