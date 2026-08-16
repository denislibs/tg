// src/components/chat/bubbles.ts
//
// Императивная лента сообщений — порт tweb `src/components/chat/bubbles.ts`
// (класс `ChatBubbles`). Класс владеет DOM-деревом ленты, скроллом, картой
// отрисованных баблов, подписками на события истории, группировкой серий
// (`bubbleGroups.ts`) и секциями дней. Медиа, реакции, время, имя автора и
// прочий состав бабла приезжают следующими этапами.
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
//  • `BubblesManagers` вместо всего `AppManagers`: ленте нужен единственный
//    метод `messages.getHistory`. Узкий тип позволяет поднять ленту в тесте
//    без RPC-моста.
//  • `attachContainerListeners()` портирован ЧАСТИЧНО — ровно тем составом, у
//    которого уже есть предмет: делегирование кликов по размеченным узлам
//    rich-text. Контекстное меню, выделение, dblclick-ответ и свайпы —
//    поведение, которого ещё нет; пустые ветки под них = мёртвый код
//    (CLAUDE.md). Зовёт его конструктор: в tweb это делает `Chat`
//    (`chat.ts:638`), а у нас `Chat`-хоста нет.
//  • `performHistoryResult` без параметра `reverse`: `reverse` в tweb значит
//    «подгрузка НАД вьюпортом», а пагинации ещё нет — единственный
//    потребитель грузит первую страницу и дописывает её вниз.
//  • Ре-кей бабла на новый идентификатор в tweb живёт в подписке `message_sent`
//    (bubbles.ts:900-906: `delete this.bubbles[fullTempMid]` →
//    `this.bubbles[fullMid] = bubble` → `bubble.dataset.mid = mid`), а
//    `history_update` там репозиционирует уже переклеенный бабл. У нас
//    `message_sent` в каталоге нет: смену идентификатора объявляет
//    `history_update` вместе с `tempId` (см. докблок `lib/rootScope.ts` и
//    `core/history/messagesMirror.ts`), поэтому ре-кей выполняет он —
//    строки тела перенесены дословно.
//  • Группировка вызывается ПОБАБЛЬНО, а не пачкой. В tweb баблы копятся в
//    очереди рендера (`renderMessagesQueue` → `batchProcessor` →
//    `groupBubbles(loadQueue)` один раз на пачку, bubbles.ts:5997-6000);
//    очереди рендера у нас ещё нет, поэтому каждый бабл группируется своим
//    вызовом `groupBubbles([...])`. Результат тот же: `groupUngrouped`
//    инкрементальна по построению — она разбирает всё, что ещё без группы,
//    и ищет соседа в СМЕЖНЫХ элементах окна (см. докблок `bubbleGroups.ts`).
import Scrollable from '@components/scrollable'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware, type Middleware } from '@helpers/middleware'
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
  /** адресат кликов по ссылкам/именам — аналог tweb `chat.appImManager` */
  navigation?: BubblesNavigation
}

/** Срез менеджеров, которым пользуется лента (см. расхождения в шапке). */
export interface BubblesManagers {
  messages: { getHistory(args: HistoryArgs): Promise<HistoryResult> }
}

// tweb считает размер страницы от высоты окна (`Math.min(40, windowSize.height / 40)`,
// bubbles.ts:11392). У нашего `messages.getHistory` тот же потолок и он же дефолт.
const PAGE_COUNT = 40

// Модификаторы бабла, которых на рендере ещё неоткуда взять: подсветка
// jump-to-message и граница непрочитанных (этап 5), имя автора и признаки
// канала (этап 3).
//
// `firstInGroup`/`lastInGroup` здесь — СЕМЯ РЕНДЕРА, а не позиция в серии:
// из них `bubbleClasses` выводит `can-have-tail`, который tweb тоже ставит на
// рендере, независимо от места бабла в серии (хвост показывает CSS у
// `.is-group-last`). Сами `is-group-first`/`is-group-last` перевешивает
// владелец серий — `BubbleGroup.updateClassNames` (bubbleGroups.ts:297) на
// каждом монтировании группы.
const STUB_CTX: Omit<BubbleCtx, 'out'> = {
  firstInGroup: true,
  lastInGroup: true,
  showName: false,
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

  private listenerSetter = new ListenerSetter()
  public middlewareHelper = getMiddleware()

  constructor(private chat: ChatContext, private managers: BubblesManagers) {
    this.constructBubbles()
    this.constructPeerHelpers()
    this.attachContainerListeners()
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
    return bubbleClasses(conv, { ...STUB_CTX, out: !!message.out })
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
  private groupBubbles(items: { bubble: HTMLElement, message: Message }[]): BubbleGroup[] {
    items.forEach(({ bubble, message }) => {
      this.bubbleGroups.prepareForGrouping(bubble, message)
    })

    return [...this.bubbleGroups.groupUngrouped()]
  }

  /** Порт tweb `safeRenderMessage`: отрисовать сообщение и запомнить его бабл.
   *  Повторный вызов по уже отрисованному адресу — no-op (в tweb ту же роль
   *  играет проверка `this.bubbles[fullMid]` перед рендером).
   *
   *  В `chatInner` бабл НЕ кладётся: его место в DOM определяет серия
   *  (`BubbleGroup.mount` внутри секции своего дня) — как в tweb, где рендер
   *  только создаёт узел, а монтирует его `mountUnmountGroups` (bubbles.ts:5945). */
  private safeRenderMessage(message: Message): HTMLElement | undefined {
    const fullMid = makeFullMid(this.peerId, message.id)
    if (this.bubbles[fullMid]) return undefined

    const bubble = this.renderMessage(message)
    this.bubbles[fullMid] = bubble
    this.bubbleGroups.mountUnmountGroups(this.groupBubbles([{ bubble, message }]))
    return bubble
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
   *  (bubbles.ts:10139-10146).
   *
   *  Страница приходит СПИСКОМ ИДЕНТИФИКАТОРОВ, а сами сообщения разрешаются
   *  через зеркало (`getMessage`) — это ровно шаг tweb `history.map((mid) =>
   *  this.chat.getMessage(mid))` (bubbles.ts:10065-10067). Не сокращаем его до
   *  «рисуем то, что вернул запрос»: у зеркала уже могут лежать более свежие
   *  копии тех же сообщений (правка/патч приехали операцией, пока летел
   *  `getHistory`), и рисовать надо лежащее, а не ответ сети.
   *
   *  Края в tweb выводятся из слайсов `historyStorage` (`SliceEnd.Top/Bottom`),
   *  потому что там страница может лечь в середину уже известного окна; у нашего
   *  `messages.getHistory` они приезжают готовыми полями ответа. Как и в
   *  оригинале, край только ВЗВОДИТСЯ (`if(isEnd.top) setLoaded('top', true)`) —
   *  ответ, не дошедший до края, не гасит уже известный край. */
  public performHistoryResult(historyResult: HistoryResult) {
    if (historyResult.reachedTop) this.scrollable.loadedAll.top = true
    if (historyResult.reachedBottom) this.scrollable.loadedAll.bottom = true

    for (const mid of historyResult.messages.map((m) => m.id)) {
      const message = this.getMessage(mid)
      if (!message) continue
      this.safeRenderMessage(message)
    }
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
    this.performHistoryResult(historyResult)
  }

  /** Порт tweb bubbles.ts:1860/765/1104/1903 (`constructPeerHelpers`). Каждая
   *  подписка сверяет, что событие про ТЕКУЩЕЕ окно: по `storageKey`, а где его
   *  в каталоге нет (`history_delete`) — по `peerId`, ровно как в оригинале. */
  private constructPeerHelpers() {
    // will call when message is sent (only 1) — tweb bubbles.ts:1860
    this.listenerSetter.add(rootScope)('history_append', ({ storageKey, message }) => {
      if (storageKey !== this.chat.messagesStorageKey) return
      this.safeRenderMessage(message)
    })

    // Смена идентификатора сообщения (ack оптимистичного бабла): бабл НЕ
    // пересоздаётся, переклеивается только его ключ в карте и data-mid —
    // порт tweb bubbles.ts:900-906; следом бабл переезжает на своё место по
    // новому порядку — порт тела `history_update` (tweb bubbles.ts:794-865).
    this.listenerSetter.add(rootScope)('history_update', ({ storageKey, message, tempId }) => {
      if (storageKey !== this.chat.messagesStorageKey || tempId === undefined) return

      const fullTempMid = makeFullMid(this.peerId, tempId)
      const bubble = this.getBubble(fullTempMid)
      if (!bubble) return

      const fullMid = makeFullMid(this.peerId, message.id)
      delete this.bubbles[fullTempMid]
      this.bubbles[fullMid] = bubble
      bubble.dataset.mid = '' + message.id

      // tweb bubbles.ts:794-800: репозиционируется только то, что лежит в
      // группах; `item.mid === mid` — событие уже применено.
      const item = this.bubbleGroups.getItemByBubble(bubble)
      if (!item || item.mid === message.id) return

      // Ветка `sequential` (tweb bubbles.ts:802-819, «бабл и так на своём
      // месте — только подменить сообщение») не портируется: признака
      // `sequential` в нашем каталоге нет — его источник в tweb, `pendingData`,
      // живёт у отправителя (см. докблок `lib/rootScope.ts:156`). Идём общим
      // путём tweb — снять и разложить заново; УЗЕЛ при этом тот же.
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

  /** Порт tweb bubbles.ts:4880. */
  public destroy() {
    this.destroyScrollable()
    this.listenerSetter.removeAll()
    this.middlewareHelper.destroy()
  }
}
