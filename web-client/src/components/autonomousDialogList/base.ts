// Порт tweb `src/components/autonomousDialogList/base.ts` (812502980, 434 строки):
// база списка диалогов одной папки — курсор догрузки (`SequentialCursorFetcher`),
// загрузка страницы, плейсхолдер первой загрузки, «печатает» в строке,
// обновление/удаление строки. Список строк — `SortedDialogList`
// (`components/sortedDialogList.ts`), владелец списков — `lib/appDialogsManager.ts`.
// Задача 1-4 волны 7 (`docs/superpowers/plans/2026-09-30-wave-7-shell-sidebars.md`).
//
// Слой данных НЕ здесь и не трогается (граница с программой списка диалогов,
// `roadmap.md:241`): страницы отдаёт воркерный `dialogsManager`
// (`managers.dialogs.getDialogs`), а сами диалоги и их индексы список читает из
// зеркала `chatsStore` (мост чтения п. 2 плана волны 7).
//
// Расхождения с оригиналом:
//  1. Индекс диалога — из зеркала (`chatsStore.dialogIndexById`, его считает
//     владелец), а не `getDialogIndex(dialog, indexKey)`: `dialogIndex()` на
//     главном потоке звать нельзя (`stores/noManualOrder.test.ts`). Пространство
//     индексов одно на все папки — закрепа внутри пользовательской папки у нас
//     нет (О-70), поэтому `indexKey`/`setIndexKey` не заводятся: вместо ключа —
//     `filterId` списка.
//  2. `shouldRefetch` через 0,5 с (`:255-272`, `isFirstDialogsLoad`) не портирован:
//     он лечит `count: null` первого ответа MTProto, а наш владелец отдаёт `count`
//     всегда (Отступление 1 спеки `2026-08-13-dialogs-pagination-design.md`).
//  3. Курсор не сдвинулся (пустая страница либо зеркало ещё не знает индексов
//     пришедших диалогов) — страница отдаёт фетчеру `count: 0`, иначе его цикл
//     крутился бы на том же `offsetIndex` вечно: сетевой курсор у владельца свой
//     (`dialogsManager.ts::fetchPage`), он режет кэш по значению. Обрывается только
//     текущий цикл — следующий `requestItemForIdx` начнёт с того же места.
//  4. Плейсхолдер первой загрузки — только пока зеркало не поднято
//     (`chatsStore.loaded`): весь холодный старт ждёт кэш диалогов до первого
//     рендера (`client/boot.ts`), и канвас поверх уже нарисованных строк мигал бы
//     на каждом первом показе папки. Прямоугольник канваса — сам контейнер
//     прокрутки (`getRectFromForPlaceholder` нашему `DialogsPlaceholder` не нужен,
//     шапка `components/chatlist/dialogsPlaceholder.ts`).
//  5. `preloadDialogs` (`:225-236`) — часть `onStateLoaded`, задача 1-8, вместе с
//     промисами, которые забывает `reset()` (`:364-367`) — у нас их нет, и `reset`/
//     `fullReset` не заводятся (`onTabChange` менеджера зовёт только `onChatsScroll`);
//     `attachPinnedReorder` (`:395-418`, перестановка закрепов перетаскиванием) —
//     выделения чатов (`DialogsSelection`) нет (О-30); `getDialogFromElement` —
//     его потребитель контекст-меню (задача 1-2).
//  6. `setDialogTyping` получает зону и менеджеры узлов имени: `getPeerTyping` у нас
//     функция модуля `lib/appImManager.ts` (до задачи 5-3), а не метод синглтона.
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import replaceContent from '@helpers/dom/replaceContent'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import throttle from '@helpers/schedulers/throttle'
import { SequentialCursorFetcher, type SequentialCursorFetcherResult } from '@helpers/sequentialCursorFetcher'
import { logger } from '@lib/logger'
import { getPeerTyping } from '@lib/appImManager'
import type { AppDialogsManager, DialogDom } from '@lib/appDialogsManager'
import type { PeerTitleManagers } from '@components/chat/peerTitle'
import type Scrollable from '@components/scrollable'
import type SortedDialogList from '@components/sortedDialogList'
import { DialogsPlaceholder } from '@components/chatlist/dialogsPlaceholder'
import { guessLoadCount } from '@core/dialogs/loadCount'
import type { DialogsPage } from '@core/managers/dialogsManager'
import type { Dialog } from '@core/models'
import { useChatsStore } from '@stores/chatsStore'

/** tweb `:23` */
export const DIALOG_LOAD_COUNT = 20

/**
 * tweb `:28-50`: занятие пира вместо последнего сообщения. Зовётся и из
 * подписки на набор, и при сборке строки — строке, собранной уже во время
 * набора, своего события не придёт.
 *
 * Возвращает, осталась ли в строке активность, которую больше нечем нарисовать,
 * — тогда вызывающий обязан вернуть последнее сообщение.
 */
export function setDialogTyping({ dom, peerId, middleware, managers }: {
  dom: DialogDom,
  peerId: PeerId,
  middleware: Middleware,
  managers: PeerTitleManagers,
}) {
  const oldTypingElement = dom.lastMessageSpan.querySelector<HTMLElement>('.peer-typing-container') ?? undefined
  const newTypingElement = getPeerTyping(peerId, { container: oldTypingElement, middleware, managers })
  if(newTypingElement) {
    if(!oldTypingElement) {
      replaceContent(dom.lastMessageSpan, newTypingElement)
      dom.lastMessageSpan.classList.add('user-typing')
    }

    return false
  }

  // * the row shows an activity that can no longer be rendered — its last message has to come back
  return !!oldTypingElement
}

/** Менеджеры списка: страница у владельца диалогов + всё, что нужно строке. */
export type DialogListManagers = PeerTitleManagers & {
  dialogs: {
    getDialogs(options: { offsetIndex?: number, limit: number, filterId: number }): Promise<DialogsPage>,
  },
}

export type BaseConstructorArgs = {
  appDialogsManager: AppDialogsManager,
}

export type LoadDialogsInnerArgs = {
  offsetIndex?: number,
  removePlaceholder?: boolean,
  canFinish: () => boolean,
}

/** Индекс диалога в зеркале (расхождение 1). */
export function getDialogIndex(peerId: PeerId): number | undefined {
  return useChatsStore.getState().dialogIndexById[peerId]
}

export class AutonomousDialogListBase {
  public sortedList!: SortedDialogList
  public scrollable!: Scrollable
  public loadedDialogsAtLeastOnce = false
  public needPlaceholderAtFirstTime = false
  protected managers: DialogListManagers
  protected appDialogsManager: AppDialogsManager
  protected listenerSetter: ListenerSetter
  protected middlewareHelper: MiddlewareHelper
  protected placeholder: DialogsPlaceholder | undefined
  protected log: ReturnType<typeof logger>

  protected cursorFetcher = new SequentialCursorFetcher<number | undefined>((cursor) => this.loadDialogs(cursor))
  protected hasReachedTheEnd = false

  /** tweb `:94-96` */
  public requestItemForIdx = (idx: number, itemsLength?: number) => {
    this.cursorFetcher.fetchUntil(idx + 1, itemsLength)
  }

  /** tweb `:98-108` */
  public onListShrinked = () => {
    const items = this.sortedList.getSortedItems()
    const last = items[items.length - 1]

    this.cursorFetcher.setFetchedItemsCount(items.length)
    this.cursorFetcher.setNeededCount(items.length)
    this.cursorFetcher.setCursor(last?.index)

    // Make sure the current request is canceled so the cursor is not overriden to a bigger page
    this.loadDialogsDeferred?.reject!()
  }

  constructor({ appDialogsManager }: BaseConstructorArgs) {
    this.log = logger('CL')
    this.appDialogsManager = appDialogsManager
    this.managers = appDialogsManager.managers
    this.listenerSetter = new ListenerSetter()
    this.middlewareHelper = getMiddleware()
  }

  protected deleteDialogByKey(key: PeerId) {
    this.sortedList.delete(key)
  }

  public deleteDialog(dialog: Dialog) {
    return this.deleteDialogByKey(this.getDialogKey(dialog))
  }

  /**
   * tweb `:131-147`
   * @returns Returns `true` if a new dialog was just added
   */
  private addOrDeleteDialogIfNeeded(dialog: Dialog, key: PeerId) {
    if(!this.canUpdateDialog(dialog)) {
      this.deleteDialog(dialog)
      return false
    }

    if(!this.sortedList.has(key)) {
      void this.sortedList.add(key)
      return true
    }

    return false
  }

  /** tweb `:149-165` */
  public updateDialog(dialog: Dialog) {
    const key = this.getDialogKey(dialog)

    if(this.addOrDeleteDialogIfNeeded(dialog, key)) return

    const dialogElement = this.getDialogElement(key)
    if(!dialogElement) {
      return
    }

    void this.appDialogsManager.setLastMessageN({
      dialog,
      dialogElement,
      setUnread: true,
    })
    this.sortedList.update(key)
  }

  /** tweb `:167-175` */
  protected canUpdateDialog(dialog: Dialog) {
    const sortedItems = this.sortedList.getSortedItems()
    const last = sortedItems[sortedItems.length - 1]

    const bottomIndex = last?.index
    const dialogIndex = getDialogIndex(dialog.peerId)

    return !last || (dialogIndex !== undefined && dialogIndex >= bottomIndex) || this.hasReachedTheEnd
  }

  /** tweb `:177-179` */
  public onChatsScroll() {
    this.requestItemForIdx(0)
  }

  /** tweb `:181-183` */
  protected onScrolledBottom() {
    this.cursorFetcher.tryToFetchMore()
  }

  /** tweb `:185-203` (расхождение 4) */
  public createPlaceholder(): DialogsPlaceholder {
    const placeholder = this.placeholder = new DialogsPlaceholder()
    placeholder.attach({
      container: this.sortedList.list.parentElement!,
      blockScrollable: this.scrollable.container,
    })

    return placeholder
  }

  private loadDialogsDeferred: CancellablePromise<SequentialCursorFetcherResult<number | undefined>> | undefined

  /** tweb `:207-221` */
  private loadDialogs(offsetIndex?: number) {
    this.loadDialogsDeferred?.reject!()
    const deferred = this.loadDialogsDeferred = deferredPromise<SequentialCursorFetcherResult<number | undefined>>()

    this.loadDialogsInner({ offsetIndex, canFinish: () => !deferred.isRejected })
    .then(
      deferred.resolve!.bind(deferred),
      deferred.reject!.bind(deferred),
    )
    .finally(() => {
      this.placeholder?.detach(this.sortedList?.itemsLength() || 0)
    })

    return deferred
  }

  public getDialogKey(dialog: Dialog): PeerId {
    return dialog.peerId
  }

  protected getFilterId(): number {
    throw new Error('not implemented')
  }

  /** tweb `:216-220` (расхождение 4) */
  public checkForDialogsPlaceholder() {
    if(this.placeholder || this.loadedDialogsAtLeastOnce || useChatsStore.getState().loaded) return

    this.placeholder = this.createPlaceholder()
  }

  /** tweb `:238-249` */
  protected dialogsFetcher(offsetIndex: number | undefined, limit: number): Promise<DialogsPage> {
    return this.managers.dialogs.getDialogs({
      offsetIndex,
      limit,
      filterId: this.getFilterId(),
    })
  }

  /** tweb `:251-299` (расхождения 1–3) */
  protected async loadDialogsInner({ offsetIndex, removePlaceholder = true, canFinish }: LoadDialogsInnerArgs): Promise<SequentialCursorFetcherResult<number | undefined>> {
    this.checkForDialogsPlaceholder()

    const result = await this.dialogsFetcher(offsetIndex, guessLoadCount())

    const newOffsetIndex = result.dialogs.reduce((prev, curr) => {
      const index = getDialogIndex(curr.peerId)
      return index !== undefined && index < prev ? index : prev
    }, offsetIndex || Infinity)

    const items = await Promise.all(result.dialogs.map((dialog) => {
      const key = this.getDialogKey(dialog)

      return this.sortedList.createItemForKey(key)
    }))

    if(!canFinish()) throw new Error()

    this.loadedDialogsAtLeastOnce = true
    this.hasReachedTheEnd = !!result.isEnd

    this.sortedList.addDeferredItems(items, result.count || 0)

    if(removePlaceholder) this.placeholder?.detach(this.sortedList.itemsLength())

    // расхождение 3
    if(newOffsetIndex === (offsetIndex || Infinity)) {
      return { cursor: offsetIndex, count: 0 }
    }

    return {
      cursor: newOffsetIndex === Infinity ? undefined : newOffsetIndex,
      count: result.dialogs.length,
      totalCount: this.sortedList.itemsLength(), // Note that at some point we might add duplicates
    }
  }

  /** tweb `:301-318` */
  public setTyping(dialog: Dialog) {
    const key = this.getDialogKey(dialog)
    const dialogElement = this.getDialogElement(key)
    if(!dialogElement) {
      return
    }

    const needsLastMessage = setDialogTyping({
      dom: dialogElement.dom,
      peerId: dialog.peerId,
      middleware: dialogElement.middlewareHelper.get(),
      managers: this.managers,
    })

    if(needsLastMessage) {
      this.unsetTyping(dialog)
    }
  }

  /** tweb `:320-334`: последнее сообщение — с подписью заново, бейджи не трогаются */
  public unsetTyping(dialog: Dialog) {
    const key = this.getDialogKey(dialog)
    const dialogElement = this.getDialogElement(key)
    if(!dialogElement) {
      return
    }

    dialogElement.dom.lastMessageSpan.classList.remove('user-typing')
    // tweb передаёт `setUnread: null`: `isSearch = setUnread !== null && !setUnread`
    // ложен, то есть бейджи пересчитываются так же, как при `true`
    void this.appDialogsManager.setLastMessageN({
      dialog,
      dialogElement,
      setUnread: true,
    })
  }

  public getDialogDom(key: PeerId) {
    const element = this.getDialogElement(key)
    return element?.dom
  }

  public getDialogElement(key: PeerId) {
    return this.sortedList.getDialogElement(key)
  }

  public getListElement(key: PeerId) {
    return this.getDialogElement(key)?.dom.listEl
  }

  /** tweb `:347-351` */
  public bindScrollable() {
    this.scrollable.onScrolledBottom = throttle(() => {
      this.onScrolledBottom()
    }, 200, false)
  }

  /** tweb `:353-362` */
  public clear() {
    this.sortedList.clear()
    this.placeholder?.remove()
    this.placeholder = undefined
    this.loadDialogsDeferred?.reject!()
    this.loadDialogsDeferred = undefined
    this.cursorFetcher.reset()
    this.hasReachedTheEnd = false
  }

  /** tweb `:420-426` */
  public destroy() {
    this.clear()
    this.scrollable.destroy()
    this.listenerSetter.removeAll()
    this.middlewareHelper.destroy()
    this.sortedList?.destroy()
  }
}
