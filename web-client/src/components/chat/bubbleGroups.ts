// src/components/chat/bubbleGroups.ts
//
// Группировка баблов в серии — порт tweb `src/components/chat/bubbleGroups.ts`
// (`BubbleGroup` / `BubbleGroups` / `GroupItem`). Серия — это подряд идущие
// сообщения одного автора внутри одного дня: у них общий контейнер
// `.bubbles-group`, один прилипающий аватар на всю серию и модификаторы
// `is-group-first` / `is-group-last` на крайних баблах.
//
// ─── Зачем отдельный модуль, а не проход по окну ──────────────────────────
// Реактивная лента (`components/messages/ChatFeed.tsx`) пересчитывает
// группировку ЦЕЛИКОМ на каждом рендере: собирает прогоны альбомов, зовёт
// `groupBreak(i-1, i)` для каждого бабла и заново строит секции дней. Пришло
// одно сообщение — прошли по всем сорока.
//
// В tweb группа — объект, который правится ИНКРЕМЕНТАЛЬНО: `groupUngrouped`
// находит соседа нового элемента и вставляет элемент в его группу, а
// `updateClassNames` перевешивает `is-group-last` только у этого соседа.
// Стоимость одного сообщения падает с O(окна) до O(размера серии). Именно
// инкрементальность — смысл этого порта, а не императивная переписка того же
// полного прохода.
//
// ─── Где мы сознательно расходимся с tweb (и почему) ──────────────────────
//  • `BubbleGroupsHost` вместо `Chat`. tweb передаёт в конструктор весь
//    `Chat` и лезет через него в `chat.bubbles` за контейнерами дней,
//    middleware и `lazyLoadQueue`. У нас (как `ChatContext`/`BubblesManagers`
//    в `bubbles.ts`) — узкий структурный тип с ровно теми четырьмя методами,
//    которые нужны группам. Полный `Chat` — этап 7.
//  • Ключ сортировки — `mid`, как и в оригинале. Прежде адрес и порядок были
//    РАЗНЫМИ полями (`id` против `seq`), потому что у неотправленного бабла id
//    был отрицательным и утащил бы серию в самый верх ленты. Чисел стало одно
//    (решение Р1), а временный номер теперь ДРОБЬ поверх последнего занятого
//    (`core/history/messageId.ts`) — он сортируется туда же, куда встанет
//    настоящий.
//  • Не портированы ветки `ChatType.Scheduled` / `ChatType.Search`: у нас нет
//    ни отложенных сообщений, ни чата-выдачи поиска. Вместе с ними ушли
//    `generateGroupMid` (для не-scheduled он возвращает тот же `mid`, то есть
//    `sortGroupItemsKey === sortItemsKey`), поле `GroupItem.reverse` и ветка
//    `insertSomething` без ключа сортировки — они обслуживают ровно эти два
//    режима.
//  • Не портированы правила `canItemsBeGrouped`, у которых нет предмета в
//    нашей модели: `channelAdminLogEvent`, `isMessageForVerificationBot`,
//    `suggested_post`, `getGuestChatViaFromId`, форум/ботфорум/монофорум-треды
//    и `post_author`. Разбор — в отчёте по задаче. Два терма, у которых предмет
//    ЕСТЬ, портированы дословно: `isOutMessage` (самопересылка в «Избранное»,
//    функция ниже) и «group anonymous sending» (отправка от лица канала —
//    прямо в `canItemsBeGrouped`).
//  • `addChatThreadSeparators` / `addContinueLastTopicReplyMarkup` (монофорум и
//    ботфорум) не портированы по той же причине.
//  • Вендорные хелперы tweb (`positionElementByIndex`, `whichChild`,
//    `insertInDescendSortedArray`, `partition`) лежат ЗДЕСЬ локально: в
//    `helpers/` их ещё нет, а заводить файлы на одного потребителя — вне
//    периметра этой задачи. При появлении второго потребителя их место —
//    `helpers/dom/` и `helpers/array/`.
import rootScope from '@lib/rootScope'
import indexOfAndSplice from '@helpers/array/indexOfAndSplice'
import forEachReverse from '@helpers/array/forEachReverse'
import type { Middleware, MiddlewareHelper } from '@helpers/middleware'
import { startOfDayMs } from '@core/format/dayLabel'
import { isOurMessage, type MyMessage, type OurMessageChat } from '@core/models'
import { isServicePill } from '@core/serviceMsg'
import { messageDateISO } from '@core/messageToConvMsg'
import { getInlineMarkupRows } from '@core/markup/replyMarkup'

/** Порт tweb `bubbles.ts:306`. Позиция первой группы внутри контейнера дня:
 *  перед группами лежат дата-бабл, его `is-fake`-дубль и sentinel, который
 *  вешает `stickyIntersector.observeStickyHeaderChanges`. */
export const STICKY_OFFSET = 3

/** Порт tweb `BubbleGroups.newGroupDiff` — максимальный разрыв (секунды) между
 *  соседними сообщениями серии. */
export const NEW_GROUP_DIFF = 121

/** Срез контейнера дня (`ChatBubbles.dateMessages[timestamp]`, bubbles.ts:534),
 *  которым пользуются группы: узел-секция и счётчик живущих в нём групп. */
export interface DateContainer {
  container: HTMLElement
  groupsLength: number
  /** сам дата-бабл секции — порт поля `div` реестра `dateMessages`
   *  (tweb bubbles.ts:4837): именно на него наблюдатель вешает `is-sticky` */
  div: HTMLElement
}

/** Аватар серии — срез tweb `avatarNew` (bubbleGroups.ts:140-146). */
export interface GroupAvatar {
  node: HTMLElement
  readyThumbPromise?: Promise<void>
}

/** Срез `ChatBubbles`, которым пользуются группы (см. расхождения в шапке). */
export interface BubbleGroupsHost {
  /** Порт `chat.isMegagroup` (chat.ts:141). В tweb группы вида чата не знают —
   *  они спрашивают его у чата (`this.chat.isOutMessage`, bubbleGroups.ts:583);
   *  у нас роль чата играет хост ленты, и знание приезжает от него, а не
   *  выводится внутри предиката (`core/models.ts::OurMessageChat`). */
  readonly isMegagroup: boolean
  /** порт `chat.bubbles.getDateContainerByTimestamp` (bubbles.ts:4823);
   *  аргумент — СЕКУНДЫ, как в оригинале */
  getDateContainerByTimestamp(timestamp: number): DateContainer
  /** порт `chat.bubbles.deleteEmptyDateGroups` (bubbles.ts:11616) */
  deleteEmptyDateGroups(): void
  /** порт `chat.bubbles.getMiddleware` (bubbles.ts:6030) */
  getMiddleware(): Middleware
  /** порт связки `avatarNew` + `chat.bubbles.lazyLoadQueue` (bubbleGroups.ts:140) */
  createAvatar(message: MyMessage, middleware: Middleware): GroupAvatar
}

/** Порт tweb `GroupItem`. `mid` — адрес бабла и он же порядок в окне: чисел
 *  стало одно (решение Р1), и прежнего `seq` рядом с ним больше нет — в
 *  оригинале обе роли тоже играет `mid`. */
export interface GroupItem {
  bubble: HTMLElement
  /** ключ автора серии; отрицательный — send-as личность (см. `getMessageFromId`) */
  fromId: number
  mid: number
  /** unix-секунды отправки — по ним считается разрыв серии */
  timestamp: number
  /** локальная полночь дня сообщения — по ней бьются серии и контейнеры дней */
  dateTimestamp: number
  mounted: boolean
  /** сообщение, которое не группируется ни с чем (у нас — сервисное) */
  single: boolean
  group?: BubbleGroup
  message: MyMessage
}

// ─── вендорные хелперы tweb (см. расхождения в шапке) ───────────────────────

/** Порт tweb `helpers/dom/whichChild.ts`. Экспортируется, потому что тем же
 *  хелпером считает позицию серии внутри секции дня `scrollToBubble`
 *  (`bubbles.ts`, tweb bubbles.ts:4651) — в оригинале это отдельный модуль
 *  `helpers/dom/whichChild.ts`, у нас он приехал сюда вместе с
 *  `positionElementByIndex`. */
export function whichChild(elem: Element): number {
  if (!elem.parentNode) return -1

  let i = 0
  let cur: Element | null = elem
  while ((cur = cur.previousElementSibling) !== null) ++i
  return i
}

/** Порт tweb `helpers/dom/positionElementByIndex.ts`. */
function positionElementByIndex(element: HTMLElement, container: HTMLElement, pos: number): boolean {
  const prevPos = element.parentElement === container ? whichChild(element) : -1

  if (prevPos === pos) {
    return false
  } else if (prevPos !== -1 && prevPos < pos) { // was higher
    pos += 1
  }

  if (!pos) {
    container.prepend(element)
  } else if (container.childElementCount > pos) {
    container.insertBefore(element, container.children[pos])
  } else {
    container.append(element)
  }

  return true
}

/** Порт tweb `helpers/array/insertInDescendSortedArray.ts` в единственной
 *  используемой здесь форме — числовой ключ-свойство. */
function insertInDescendSortedArray<K extends string, T extends { [k in K]: number }>(
  array: T[],
  element: T,
  key: K,
): number {
  const sortProperty = element[key]

  const pos = array.indexOf(element)
  if (pos !== -1) {
    const prev = array[pos - 1]
    const next = array[pos + 1]
    if ((!prev || prev[key] >= sortProperty) && (!next || next[key] <= sortProperty)) {
      return pos
    }

    array.splice(pos, 1)
  }

  const len = array.length
  if (!len || sortProperty <= array[len - 1][key]) {
    return array.push(element) - 1
  } else if (sortProperty >= array[0][key]) {
    array.unshift(element)
    return 0
  }

  for (let i = 0; i < len; i++) {
    if (sortProperty > array[i][key]) {
      array.splice(i, 0, element)
      return i
    }
  }

  return array.indexOf(element)
}

/** Порт tweb `helpers/array/partition.ts`. */
function partition<T>(array: T[], predicate: (value: T) => boolean): [T[], T[]] {
  const yes: T[] = []
  const no: T[] = []
  for (const value of array) {
    (predicate(value) ? yes : no).push(value)
  }
  return [yes, no]
}

/**
 * Порт tweb `Chat.isOutMessage` (chat.ts:1392-1396) в применимом объёме.
 *
 *     isOut = isOurMessage(message) && (!fwdFrom || peerId !== myId || threadId)
 *
 * Второй множитель — это САМОПЕРЕСЫЛКА В «ИЗБРАННОЕ»: пересланное в чат с самим
 * собой сообщение перестаёт быть исходящим, потому что рисуется от лица
 * ОРИГИНАЛЬНОГО автора. Для группировки это значит, что пересылки и собственные
 * сообщения «Избранного» лежат в РАЗНЫХ сериях, — без этого терма они
 * склеиваются в одну.
 *
 * Терм `|| this.threadId` не портирован: он про окно сохранённого диалога
 * (Saved Dialogs, `ChatType.Saved`), которого у нас нет — тред у нас бывает
 * только у форум-топика и комментариев, а «Избранное» ни тем, ни другим не
 * бывает.
 *
 * `this.peerId` оригинала здесь — `message.peerId`: окно одно, и сама
 * `canItemsBeGrouped` отдельным термом требует совпадения пиров.
 */
function isOutMessage(message: MyMessage, chat: OurMessageChat): boolean {
  const fwdFrom = message._ === 'message' ? message.fwd_from : undefined
  return isOurMessage(message, chat) && (!fwdFrom || message.peerId !== chat.myId)
}

/** Порт tweb `canHaveReplyMarkup` (bubbleGroups.ts:51): у аватара серии свой
 *  отступ, когда под последним баблом висит инлайн-клавиатура. */
function canHaveReplyMarkup(message: MyMessage): boolean {
  return !!getInlineMarkupRows(message._ === 'message' ? message.reply_markup : undefined)
}

/** Порт tweb `BubbleGroup`. */
export class BubbleGroup {
  public container: HTMLElement
  /** descend sorted (items[0] — самый новый) */
  public items: GroupItem[] = []
  public avatarContainer?: HTMLElement
  public avatar?: GroupAvatar
  public avatarLoadPromise?: Promise<void>
  public mounted = false
  /** сколько узлов лежит в контейнере ПЕРЕД баблами (аватар) */
  public offset = 0
  public middlewareHelper: MiddlewareHelper
  public dateContainer?: DateContainer

  constructor(
    private host: BubbleGroupsHost,
    private groups: BubbleGroups,
    public dateTimestamp: number,
  ) {
    this.container = document.createElement('div')
    this.container.classList.add('bubbles-group')
    this.middlewareHelper = host.getMiddleware().create()
  }

  /** Порт tweb bubbleGroups.ts:129. Аватар у серии ОДИН: повторный вызов
   *  возвращает уже созданный.
   *
   *  Расхождение: tweb сторожит вход по `avatarLoadPromise` (у `avatarNew`
   *  промис есть всегда), у нас — по самому узлу: хост вправе отдать аватар
   *  без промиса, и тогда сторож tweb пропустил бы второй узел в ту же серию. */
  public createAvatar(message: MyMessage): Promise<void> | undefined {
    if (this.avatarContainer) {
      return this.avatarLoadPromise
    } else if (isServicePill(message)) {
      return undefined
    }

    this.avatarContainer = document.createElement('div')
    this.avatarContainer.classList.add('bubbles-group-avatar-container')
    ++this.offset

    this.avatar = this.host.createAvatar(message, this.middlewareHelper.get())
    this.avatar.node.classList.add('bubbles-group-avatar', 'user-avatar')

    this.updateAvatarClassNames(message)

    this.avatarLoadPromise = this.avatar.readyThumbPromise
    this.avatarContainer.append(this.avatar.node)
    this.container.append(this.avatarContainer)

    return this.avatarLoadPromise
  }

  /** Порт tweb bubbleGroups.ts:119. */
  public destroyAvatar() {
    if (!this.avatar) {
      return
    }

    this.avatarContainer!.remove()
    this.avatarLoadPromise = this.avatar = this.avatarContainer = undefined
    --this.offset
  }

  /** Порт tweb bubbleGroups.ts:168. Отступ аватара считается по ПОСЛЕДНЕМУ
   *  баблу серии — под ним и висит клавиатура. */
  public updateAvatarClassNames(message: MyMessage = this.lastItem.message) {
    if (!this.avatar || isServicePill(message)) {
      return
    }

    this.avatar.node.classList.toggle('avatar-for-reply-markup', canHaveReplyMarkup(message))
  }

  /** Самый старый элемент серии (в DOM — верхний). */
  public get firstItem(): GroupItem {
    return this.items[this.items.length - 1]
  }

  /** Самый новый элемент серии (в DOM — нижний). */
  public get lastItem(): GroupItem {
    return this.items[0]
  }

  public get firstMid(): number {
    return this.firstItem.mid
  }

  public get lastMid(): number {
    return this.lastItem.mid
  }

  /** Ключ сортировки групп между собой (порт tweb `lastMid`). */
  public get lastSeq(): number {
    return this.lastItem.mid
  }

  /** Порт tweb bubbleGroups.ts:201. Один проход по СВОЕЙ серии: края получают
   *  `is-group-first`/`is-group-last`, середина — ничего. */
  public updateClassNames() {
    const items = this.items
    const length = items.length
    if (!length) {
      return
    }

    const first = items[length - 1].bubble

    this.updateAvatarClassNames()

    if (length === 1) {
      first.classList.add('is-group-first', 'is-group-last')
      return
    } else {
      first.classList.remove('is-group-last')
      first.classList.add('is-group-first')
    }

    for (let i = 1, _length = length - 1; i < _length; ++i) {
      const bubble = items[i].bubble
      bubble.classList.remove('is-group-last', 'is-group-first')
    }

    const last = items[0].bubble
    last.classList.remove('is-group-first')
    last.classList.add('is-group-last')
  }

  /** Порт tweb bubbleGroups.ts:242. */
  public insertItem(item: GroupItem) {
    const { items } = this
    insertInDescendSortedArray(items, item, 'mid')

    item.group = this
    if (items.length === 1) {
      this.groups.insertGroup(this)
    }
  }

  /** Порт tweb bubbleGroups.ts:252. Опустевшая серия уходит из списка групп. */
  public removeItem(item: GroupItem) {
    indexOfAndSplice(this.items, item)

    if (!this.items.length) {
      indexOfAndSplice(this.groups.groups, this)
    }

    item.group = undefined
  }

  /** Порт tweb bubbleGroups.ts:262. */
  public mount(updateClassNames?: boolean) {
    if (!this.groups.groups.includes(this) || !this.items.length) { // group can be already removed
      if (this.mounted) {
        this.onItemUnmount()
      }

      return
    }

    const { offset, items } = this
    const { length } = items
    forEachReverse(items, (item, idx) => {
      this.mountItem(item, length - 1 - idx!, offset)
    })

    if (updateClassNames) {
      this.updateClassNames()
    }

    this.onItemMount()
  }

  /** Порт tweb bubbleGroups.ts:286. */
  public mountItem(item: GroupItem, idx = this.items.indexOf(item), offset = this.offset) {
    if (item.mounted) {
      return
    }

    positionElementByIndex(item.bubble, this.container, offset + idx)
    item.mounted = true
  }

  /** Порт tweb bubbleGroups.ts:295. */
  public unmountItem(item: GroupItem) {
    if (!item.mounted) {
      return
    }

    item.bubble.remove()
    item.mounted = false
    this.onItemUnmount()
  }

  /** Порт tweb bubbleGroups.ts:305. Серия въезжает в контейнер своего дня. */
  public onItemMount() {
    if (this.mounted) {
      return
    }

    const dateContainer = this.dateContainer = this.host.getDateContainerByTimestamp(this.dateTimestamp / 1000)
    const dateGroups = this.groups.groups.filter((group) => group.dateTimestamp === this.dateTimestamp)
    const dateGroupsLength = dateGroups.length
    const idx = dateGroups.indexOf(this)
    const unmountedLength = dateGroups.slice(idx + 1).reduce((acc, v) => acc + (v.mounted ? 0 : 1), 0)
    positionElementByIndex(this.container, dateContainer.container, STICKY_OFFSET + dateGroupsLength - 1 - idx - unmountedLength)
    ++dateContainer.groupsLength
    this.mounted = true
    this.groups.updateGroupsClassNames()
  }

  /** Порт tweb bubbleGroups.ts:322. Ушёл последний бабл — уходит и серия;
   *  иначе только перевешиваются края. */
  public onItemUnmount() {
    if (!this.mounted) {
      return
    }

    if (!this.items.length) {
      this.container.remove()
      if (this.dateContainer) --this.dateContainer.groupsLength
      this.dateContainer = undefined
      this.host.deleteEmptyDateGroups()
      this.mounted = false
      this.middlewareHelper.clean()
      this.groups.updateGroupsClassNames()
    } else {
      this.updateClassNames()
    }
  }
}

/** Порт tweb `BubbleGroups` (default export оригинала). */
export default class BubbleGroups {
  /** descend sorted по `mid` (itemsArr[0] — самое новое сообщение окна) */
  public itemsArr: GroupItem[] = []
  private itemsMap: Map<HTMLElement, GroupItem> = new Map()
  /** descend sorted по `lastSeq` (groups[0] — самая нижняя серия) */
  public groups: BubbleGroup[] = []

  constructor(private host: BubbleGroupsHost) {}

  /** Порт tweb bubbleGroups.ts:527. Его зовёт обработчик `history_update` в
   *  `bubbles.ts` (tweb bubbles.ts:795), чтобы понять, надо ли переставлять
   *  бабл: ему нужны `mid` (сравнить с новым) и `group` (сравнить с найденной
   *  соседней). */
  public getItemByBubble(bubble: HTMLElement): GroupItem | undefined {
    return this.itemsMap.get(bubble)
  }

  public get firstGroup(): BubbleGroup {
    return this.groups[this.groups.length - 1]
  }

  public get lastGroup(): BubbleGroup {
    return this.groups[0]
  }

  /** Порт tweb bubbleGroups.ts:689. `single` — сообщение, которое не
   *  группируется ни с чем; в tweb это всё, кроме `message` и сервисных из
   *  `SERVICE_AS_REGULAR` (звонок). У нас звонок — обычное сообщение
   *  (`type === 'call'`), поэтому весь `SERVICE_AS_REGULAR` сводится к
   *  «сервисное = single». */
  public createItem(bubble: HTMLElement, message: MyMessage): GroupItem {
    return {
      bubble,
      fromId: this.getMessageFromId(message),
      mid: message.id,
      timestamp: message.date,
      dateTimestamp: startOfDayMs(messageDateISO(message.date)),
      mounted: false,
      single: isServicePill(message),
      message,
    }
  }

  /** Порт tweb bubbleGroups.ts:668. Ключ автора серии. Send-as (сообщение от
   *  имени канала/группы) в tweb приезжает готовым `message.fromId` — у нас
   *  `senderId` остаётся реальным, а личность лежит в `sendAs`. Ключ личности
   *  ЗНАКОВЫЙ уже на проводе (`send_as.peer_id`), поэтому кодировать чат
   *  минусом здесь больше нечем — и не нужно. */
  public getMessageFromId(message: MyMessage): PeerId {
    return message.fromId ?? message.peerId
  }

  /** Срез чата для `isOurMessage`/`isOutMessage` — то, что в tweb лежит на самом
   *  `Chat` (`this.isMegagroup`) и на глобальном `rootScope`. */
  private get chatSide(): OurMessageChat {
    return { myId: rootScope.myId, isMegagroup: this.host.isMegagroup }
  }

  /** Порт tweb bubbleGroups.ts:573 — единственное место, где живут правила
   *  разрыва серии.
   *
   *  Терм «group anonymous sending» (:595) портирован ДОСЛОВНО:
   *  `!isOut1 || item1.message.fromId === rootScope.myId`. Он про send-as —
   *  отправку от лица канала в мегагруппе: `isOurMessage` там берёт сырой
   *  `pFlags.out`, поэтому такое сообщение ИСХОДЯЩЕЕ, а автор у него не я, и
   *  каждое стоит своей серией — иначе имя канала показалось бы только у
   *  первого бабла (остальные прячет CSS у не-`is-group-first`). Пост
   *  вещательного канала терма не касается: чат не мегагруппа, `pFlags.post`
   *  уводит `isOurMessage` в `false`, и подряд идущие посты остаются одной
   *  серией. `fromId` — тот же ключ автора, что у `getMessageFromId`
   *  (у tweb `message.fromId` с фолбэком на `peerId`).
   *
   *  Терм `|| this.chat.isMonoforum` не портирован — монофорума у нас нет. */
  public canItemsBeGrouped(item1: GroupItem, item2: GroupItem): boolean {
    const chat = this.chatSide
    const isOut1 = isOutMessage(item1.message, chat)
    return item2.fromId === item1.fromId &&
      item1.dateTimestamp === item2.dateTimestamp &&
      Math.abs(item2.timestamp - item1.timestamp) <= NEW_GROUP_DIFF &&
      !item1.single &&
      !item2.single &&
      isOut1 === isOutMessage(item2.message, chat) &&
      (!isOut1 || this.getMessageFromId(item1.message) === chat.myId) && // * group anonymous sending
      item1.message.peerId === item2.message.peerId
  }

  /** Порт tweb bubbleGroups.ts:600. */
  public getSiblingsAtIndex(itemIndex: number, items: GroupItem[]) {
    return [items[itemIndex - 1], items[itemIndex + 1]] as const
  }

  /** Порт tweb bubbleGroups.ts:608. Зовёт `bubbles.ts` (tweb bubbles.ts:809),
   *  чтобы понять, останется ли бабл на месте после смены сообщения. */
  public findGroupSiblingByItem(item: GroupItem, items: GroupItem[]): GroupItem | undefined {
    items = items.slice()
    const idx = this.insertItemToArray(item, items)
    return this.findGroupSiblingInItems(item, items, idx)
  }

  /** Порт tweb bubbleGroups.ts:615. Сосед ищется в СМЕЖНЫХ элементах окна:
   *  сначала предыдущий (уже сгруппированный), иначе — вниз по прогону, пока
   *  элементы группируются. Именно эта локальность и делает добавление O(1) по
   *  окну вместо полного прохода. */
  public findGroupSiblingInItems(
    item: GroupItem,
    items: GroupItem[],
    index = items.indexOf(item),
    length = items.length,
  ): GroupItem | undefined {
    const previousItem = items[index - 1]
    let siblingGroupedItem: GroupItem | undefined
    if (previousItem?.group && this.canItemsBeGrouped(item, previousItem)) {
      siblingGroupedItem = previousItem
    } else {
      for (let k = index + 1; k < length; ++k) {
        const nextItem = items[k]
        if (this.canItemsBeGrouped(item, nextItem)) {
          if (nextItem.group) {
            siblingGroupedItem = nextItem
          }
        } else {
          break
        }
      }
    }

    return siblingGroupedItem
  }

  /** Порт tweb bubbleGroups.ts:636. */
  public addItemToGroup(item: GroupItem, group: BubbleGroup) {
    group.insertItem(item)
    this.addItemToCache(item)
  }

  /** Порт tweb bubbleGroups.ts:641. */
  public insertItemToArray(item: GroupItem, array: GroupItem[]): number {
    return insertInDescendSortedArray(array, item, 'mid')
  }

  /** Порт tweb bubbleGroups.ts:645. */
  public insertGroup(group: BubbleGroup): number {
    return insertInDescendSortedArray(this.groups, group, 'lastSeq')
  }

  /** Порт tweb bubbleGroups.ts:651. */
  public updateGroupsClassNames() {
    this.groups.forEach((group, idx, arr) => {
      group.container.classList.toggle('bubbles-group-last', idx === 0)
      group.container.classList.toggle('bubbles-group-first', idx === (arr.length - 1))
    })
  }

  /** Порт tweb bubbleGroups.ts:658. */
  public addItemToCache(item: GroupItem) {
    this.insertItemToArray(item, this.itemsArr)
    this.itemsMap.set(item.bubble, item)
  }

  /** Порт tweb bubbleGroups.ts:663. */
  public removeItemFromCache(item: GroupItem) {
    indexOfAndSplice(this.itemsArr, item)
    this.itemsMap.delete(item.bubble)
  }

  /** Порт tweb bubbleGroups.ts:374. */
  public removeItem(item: GroupItem) {
    item.group?.removeItem(item)
    this.removeItemFromCache(item)
  }

  /** Порт tweb bubbleGroups.ts:558. */
  public changeItemBubble(item: GroupItem, bubble: HTMLElement) {
    this.itemsMap.delete(item.bubble)
    item.bubble = bubble
    this.itemsMap.set(bubble, item)
  }

  /** Порт tweb bubbleGroups.ts:564. */
  public changeBubbleByBubble(from: HTMLElement, to: HTMLElement) {
    const item = this.getItemByBubble(from)
    if (!item) {
      return
    }

    this.changeItemBubble(item, to)
  }

  /** Порт tweb bubbleGroups.ts:539. Бабл остался тем же узлом, но приехало
   *  новое сообщение (ack оптимистичной отправки): переезжают адрес, порядок и
   *  само сообщение — узел и группа не трогаются. */
  public changeBubbleMessage(bubble: HTMLElement, message: MyMessage) {
    const item = this.getItemByBubble(bubble)
    if (!item) {
      return
    }

    item.mid = message.id
    item.message = message

    indexOfAndSplice(this.itemsArr, item)
    this.insertItemToArray(item, this.itemsArr)
  }

  /** Порт tweb bubbleGroups.ts:739. Кладёт бабл в кэш окна ДО группировки —
   *  так `groupUngrouped` видит весь прогон разом. */
  public prepareForGrouping(bubble: HTMLElement, message: MyMessage) {
    const foundItem = this.getItemByBubble(bubble)
    if (foundItem) { // should happen only on edit
      return
    }

    const item = this.createItem(bubble, message)
    this.addItemToCache(item)
  }

  /** Порт tweb `BubbleGroups.f` (bubbleGroups.ts:517): выкинуть из групп хвост
   *  элементов, начиная с `index`. Баблы остаются в DOM — их переставит
   *  ближайший `mount()`, поэтому снимается только флаг `mounted`. */
  public ungroupFrom(items: GroupItem[], index = 0, length = items.length) {
    for (; index < length; ++index) {
      const item = items[index]
      item.mounted = false
      item.group!.removeItem(item)
      --length
      --index
    }
  }

  /** Порт tweb bubbleGroups.ts:711. Новая группа посреди чужой серии рвёт её:
   *  всё, что ниже соседа, переедет в свои группы следующим проходом. */
  public splitSiblingsOnGrouping(siblings: ReturnType<BubbleGroups['getSiblingsAtIndex']>): BubbleGroup[] | undefined {
    const [previousSibling] = siblings
    const previousGroup = previousSibling?.group

    if (!previousGroup) {
      return undefined
    }

    const items = previousGroup.items
    const index = items.indexOf(previousSibling) + 1
    const length = items.length
    if (index === length) {
      return undefined
    }

    const modifiedGroups: BubbleGroup[] = [previousGroup]
    this.ungroupFrom(items, index, length)
    return modifiedGroups
  }

  /** Порт tweb bubbleGroups.ts:750. Разложить по сериям всё, что ещё без
   *  группы: каждый такой элемент либо прилипает к группе соседа, либо заводит
   *  свою. Возвращает затронутые группы — их и надо смонтировать. */
  public groupUngrouped(): Set<BubbleGroup> {
    const items = this.itemsArr
    const length = items.length
    const modifiedGroups: Set<BubbleGroup> = new Set()
    for (let i = 0; i < length; ++i) {
      const item = items[i]
      if (item.group) {
        continue
      }

      const siblings = this.getSiblingsAtIndex(i, items)
      const foundItem = this.findGroupSiblingInItems(item, items, i, length)

      const foundGroup = foundItem?.group
      const hadGroup = !!foundGroup
      const group = foundGroup ?? new BubbleGroup(this.host, this, item.dateTimestamp)

      modifiedGroups.add(group)
      group.insertItem(item)

      if (!hadGroup) {
        const splittedGroups = this.splitSiblingsOnGrouping(siblings)
        if (splittedGroups) {
          splittedGroups.forEach((group) => modifiedGroups.add(group))
        }
      }
    }

    return modifiedGroups
  }

  /** Порт tweb bubbleGroups.ts:426. Опустевшие серии снимаются, живые —
   *  монтируются и перевешивают края. */
  public mountUnmountGroups(groups: BubbleGroup[]) {
    const [toMount, toUnmount] = partition(groups, (group) => !!group.items.length)
    toUnmount.forEach((group) => {
      group.onItemUnmount()
    })

    toMount.forEach((group) => {
      group.mount(true)
    })
  }

  /** Порт tweb bubbleGroups.ts:379. Убрать бабл из ленты: он уходит из своей
   *  серии, а если он ЕЁ РАЗДЕЛЯЛ — соседи по разрыву снова сливаются в одну. */
  public removeAndUnmountBubble(bubble: HTMLElement): boolean {
    const item = this.getItemByBubble(bubble)
    if (!item) { // * can be a placeholder
      const parentElement = bubble.parentElement
      if (parentElement) {
        if (parentElement.classList.contains('bubbles-group')) {
          parentElement.remove()
        } else {
          bubble.remove()
        }
      }

      return false
    }

    const items = this.itemsArr
    const index = items.indexOf(item)
    const siblings = this.getSiblingsAtIndex(index, items)

    const group = item.group
    this.removeItem(item)

    const modifiedGroups: Set<BubbleGroup> = new Set()
    if (group) {
      group.unmountItem(item)
      modifiedGroups.add(group)
    }

    const [previousSibling, nextSibling] = siblings
    if (
      previousSibling &&
      nextSibling &&
      this.canItemsBeGrouped(previousSibling, nextSibling) &&
      previousSibling.group !== nextSibling.group
    ) {
      const nextGroup = nextSibling.group!
      this.ungroupFrom(nextGroup.items)
      nextGroup.onItemUnmount()
      modifiedGroups.add(previousSibling.group!)
      this.groupUngrouped()
    }

    this.mountUnmountGroups(Array.from(modifiedGroups))

    return true
  }

  /** Порт tweb bubbleGroups.ts:862. */
  public cleanup() {
    this.itemsArr = []
    this.groups = []
    this.itemsMap.clear()
  }
}
