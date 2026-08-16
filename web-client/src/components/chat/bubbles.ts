// src/components/chat/bubbles.ts
//
// Каркас императивной ленты сообщений — порт tweb `src/components/chat/bubbles.ts`
// (класс `ChatBubbles`). ЭТАП 2 из семи: класс владеет DOM-деревом ленты,
// скроллом, картой отрисованных баблов и подписками на события истории.
// Контент бабла здесь ЗАГЛУШКА (текстовый узел) — настоящий контент, медиа,
// реакции, время и группировка приезжают этапами 3-6.
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
//    У нас на этапе 2 из него нужны ровно три поля — peerId, threadId и
//    ключ окна (`chat.messagesStorageKey`), — поэтому конструктор берёт узкий
//    структурный тип. Полный `Chat` — этап 7, когда лента заберёт себе и
//    остальное окружение.
//  • `BubblesManagers` вместо всего `AppManagers`: ленте нужен единственный
//    метод `messages.getHistory`. Узкий тип позволяет поднять ленту в тесте
//    без RPC-моста.
//  • `attachContainerListeners()` не портирован: весь его состав (контекстное
//    меню, выделение, dblclick-дебаг, клики по баблу) — это поведение, которого
//    на этапе 2 ещё нет. Заводить пустой метод = мёртвый код (CLAUDE.md).
//  • `performHistoryResult` без параметра `reverse`: `reverse` в tweb значит
//    «подгрузка НАД вьюпортом», а пагинации на этапе 2 нет — единственный
//    потребитель грузит первую страницу и дописывает её вниз.
//  • Ре-кей бабла на новый идентификатор в tweb живёт в подписке `message_sent`
//    (bubbles.ts:900-906: `delete this.bubbles[fullTempMid]` →
//    `this.bubbles[fullMid] = bubble` → `bubble.dataset.mid = mid`), а
//    `history_update` там репозиционирует уже переклеенный бабл. У нас
//    `message_sent` в каталоге нет: смену идентификатора объявляет
//    `history_update` вместе с `tempId` (см. докблок `lib/rootScope.ts` и
//    `core/history/messagesMirror.ts`), поэтому ре-кей выполняет он —
//    строки тела перенесены дословно.
import Scrollable from '@components/scrollable'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware } from '@helpers/middleware'
import rootScope from '@lib/rootScope'
import { mirrorWindow, putMirrorPage } from '@core/history/messagesMirror'
import { messageToConvMsg } from '@core/messageToConvMsg'
import type { Message } from '@core/models'
import type { HistoryArgs, HistoryResult } from '@core/managers/messagesManager'
import { bubbleClasses, type BubbleCtx } from '../messages/bubbleClasses'

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

/** Срез `Chat`, которым пользуется лента (см. расхождения в шапке). */
export interface ChatContext {
  peerId: number
  /** окно треда (форум-топик / комментарии); undefined — основное окно чата */
  threadId?: number
  /** ключ окна в зеркале — аналог tweb `chat.messagesStorageKey`, которым
   *  подписки сверяют «событие про ТЕКУЩИЙ чат» */
  messagesStorageKey: string
}

/** Срез менеджеров, которым пользуется лента (см. расхождения в шапке). */
export interface BubblesManagers {
  messages: { getHistory(args: HistoryArgs): Promise<HistoryResult> }
}

// tweb считает размер страницы от высоты окна (`Math.min(40, windowSize.height / 40)`,
// bubbles.ts:11392). У нашего `messages.getHistory` тот же потолок и он же дефолт.
const PAGE_COUNT = 40

// Модификаторы бабла, которых на этапе 2 ещё неоткуда взять: группировка серий
// (этап 6), подсветка jump-to-message и граница непрочитанных (этап 5), имя
// автора и признаки канала (этап 3). Одиночное сообщение в tweb — группа из
// одного, поэтому first+last и хвост.
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

export default class ChatBubbles {
  public container!: HTMLDivElement
  public chatInner!: HTMLDivElement
  public scrollable!: Scrollable
  public paddingTop!: HTMLDivElement
  public paddingBottom!: HTMLDivElement
  public remover!: HTMLDivElement
  public floatingSeparatorsContainer!: HTMLDivElement

  // Карта отрисованного — tweb bubbles.ts:530 (`{[fullMid]: HTMLElement}`).
  private bubbles: { [fullMid: string]: HTMLElement } = {}

  private listenerSetter = new ListenerSetter()
  public middlewareHelper = getMiddleware()

  constructor(private chat: ChatContext, private managers: BubblesManagers) {
    this.constructBubbles()
    this.constructPeerHelpers()
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

  // Каркас бабла: `.bubble > .bubble-content-wrapper > .bubble-content`
  // (tweb bubbles.ts:6620-6628). Текст на этапе 2 кладётся текстовым узлом
  // прямо в `.bubble-content`; настоящий `.message.spoilers-container` со всем
  // конвейером контента — этап 3.
  private renderMessage(message: Message): HTMLElement {
    const bubble = document.createElement('div')
    bubble.dataset.mid = '' + message.id
    bubble.dataset.peerId = '' + this.peerId
    bubble.classList.add(...this.classesFor(message))

    const contentWrapper = document.createElement('div')
    contentWrapper.classList.add('bubble-content-wrapper')

    const bubbleContainer = document.createElement('div')
    bubbleContainer.classList.add('bubble-content')

    contentWrapper.append(bubbleContainer)
    bubble.append(contentWrapper)
    bubbleContainer.append(document.createTextNode(message.text ?? ''))

    return bubble
  }

  /** Порт tweb `safeRenderMessage`: отрисовать сообщение и запомнить его бабл.
   *  Повторный вызов по уже отрисованному адресу — no-op (в tweb ту же роль
   *  играет проверка `this.bubbles[fullMid]` перед рендером). */
  private safeRenderMessage(message: Message): HTMLElement | undefined {
    const fullMid = makeFullMid(this.peerId, message.id)
    if (this.bubbles[fullMid]) return undefined

    const bubble = this.renderMessage(message)
    this.bubbles[fullMid] = bubble
    this.chatInner.append(bubble)
    return bubble
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
    // порт tweb bubbles.ts:900-906.
    this.listenerSetter.add(rootScope)('history_update', ({ storageKey, message, tempId }) => {
      if (storageKey !== this.chat.messagesStorageKey || tempId === undefined) return

      const fullTempMid = makeFullMid(this.peerId, tempId)
      const bubble = this.getBubble(fullTempMid)
      if (!bubble) return

      const fullMid = makeFullMid(this.peerId, message.id)
      delete this.bubbles[fullTempMid]
      this.bubbles[fullMid] = bubble
      bubble.dataset.mid = '' + message.id
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

  /** Правка содержимого одного бабла. В tweb это полный перерендер поверх того
   *  же узла (`safeRenderMessage({message, bubble})`); у нас контент —
   *  заглушка, поэтому обновляются модификаторы и текстовый узел. Узел бабла
   *  тот же — карта адресов не трогается. */
  private onMessageEdit(message: Message) {
    const bubble = this.getBubble(makeFullMid(this.peerId, message.id))
    if (!bubble) return

    bubble.className = this.classesFor(message).join(' ')
    const bubbleContainer = bubble.querySelector('.bubble-content')
    bubbleContainer?.replaceChildren(document.createTextNode(message.text ?? ''))
  }

  /** Порт tweb `deleteMessagesByIds`: снять узлы и забыть их адреса. */
  public deleteMessagesByIds(fullMids: string[]) {
    for (const fullMid of fullMids) {
      const bubble = this.bubbles[fullMid]
      if (!bubble) continue

      delete this.bubbles[fullMid]
      bubble.remove()
    }
  }

  /** Порт tweb bubbles.ts:4913. Смена пира: карта адресов и (по флагу) узлы
   *  уходят, всё летящее протухает через middleware. */
  public cleanup(bubblesToo = false) {
    this.bubbles = {}
    this.scrollable.loadedAll.top = false
    this.scrollable.loadedAll.bottom = false

    if (bubblesToo) {
      this.chatInner.replaceChildren()
    }

    this.middlewareHelper.clean()
  }

  /** Порт tweb bubbles.ts:4880. */
  public destroy() {
    this.destroyScrollable()
    this.listenerSetter.removeAll()
    this.middlewareHelper.destroy()
  }
}
