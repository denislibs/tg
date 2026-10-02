// Порт tweb `src/components/sortedDialogList.ts` (812502980, 454 строки):
// «ключ → строка `DialogElement`» поверх Solid-ядра виртуального списка
// (`components/deferredSortedVirtualList.solid.tsx`, задача 1-3). Список ВЛАДЕЕТ
// строками: строит их (`createItemForKey` → `appDialogsManager.addListDialog`),
// пересобирает подпись строке, вернувшейся в окно (`unmountedDialogElements`), и
// уничтожает выброшенную (`onItemDiscard`). Задача 1-4 волны 7.
//
// Расхождения с оригиналом:
//  1. Индекс ключа — из зеркала `chatsStore.dialogIndexById` (его считает
//     владелец диалогов), см. расхождение 1 `autonomousDialogList/base.ts`;
//     `indexKey` заменён `filterId` списка (`isMainList` — список «Всех чатов»).
//  2. `CustomSortedDialog`, `virtualFilterId`, `monoforumParentPeerId`,
//     `getAsAllChats`, `attachCommunityChildBadge` — строки сообществ, тем
//     форума и монофорума (О-5, задача 1-6, О-4); `getDialogAutoDeletePeriod` —
//     таймер автоудаления на аватаре у нашего `avatarNew` не портирован (шапка
//     `components/avatar.ts`).
//  3. `onItemMount` (состояние выделения строки, ee6f7f9c2) — выделения чатов нет (О-30).
//  4. `reorderItems` — оптимистичная половина перестановки закрепов перетаскиванием
//     (`dialogsPinnedReorder.ts`), её у нас нет (О-30).
//  5. `controlled: true` (`getDialogOptions`) у нашей строки по умолчанию: без
//     `wrapOptions.middleware` `DialogElement` заводит свой корень зоны (С4 шапки
//     раздела «СТРОКА ДИАЛОГА» `lib/appDialogsManager.ts`).
import { batch, onCleanup } from 'solid-js'
import type { AppDialogsManager, DialogElement } from '@lib/appDialogsManager'
import { logger } from '@lib/logger'
import { createDeferredSortedVirtualList, type DeferredSortedVirtualListItem } from '@components/deferredSortedVirtualList.solid'
import type { LoadingDialogSkeletonSize } from '@components/loadingDialogSkeleton.solid'
import type Scrollable from '@components/scrollable'
import { ALL_FOLDER_ID } from '@core/folderIds'
import { getDialogIndex } from '@components/autonomousDialogList/base'

export type SortedDialogListKey = PeerId | CustomPinnedDialog

export default class SortedDialogList {
  private appDialogsManager: AppDialogsManager
  public log: ReturnType<typeof logger>
  public list: HTMLElement
  public filterId: number
  public onListLengthChange?: () => void

  private virtualList: ReturnType<typeof createDeferredSortedVirtualList<SortedDialogListItem>>
  private totalCount = 0
  private totalCountOffset = 0

  /**
   * The custom emoji from the last message gets destroyed completely when removing the dialog
   * element from the DOM, with no easy way of re-initializing them, so we need to forcefully
   * re-initialize the last message
   */
  private unmountedDialogElements = new WeakMap<DialogElement, boolean>()

  constructor(options: {
    appDialogsManager: AppDialogsManager,
    log?: ReturnType<typeof logger>,
    filterId: number,
    onListLengthChange?: () => void,

    scrollable: Scrollable,
    requestItemForIdx: (idx: number, itemsLength: number) => void,
    onListShrinked: () => void,
    itemSize: LoadingDialogSkeletonSize,
    noAvatar?: boolean, // For the loading skeleton placeholder
    extraPaddingBottom?: number,
  }) {
    this.appDialogsManager = options.appDialogsManager
    this.log = options.log ?? logger('SDL')
    this.filterId = options.filterId
    this.onListLengthChange = options.onListLengthChange

    this.virtualList = createDeferredSortedVirtualList<SortedDialogListItem>({
      scrollable: options.scrollable.container,
      getItemElement: (item, key) => {
        if(item.type === 'custom-pinned-dialog') {
          return item.value.render()
        }

        const dialogElement = item.value

        if(this.unmountedDialogElements.get(dialogElement)) {
          const { options } = this.getDialogOptions(key as PeerId)

          /**
           * Re-initing the dialog is pretty expensive on performance,
           * so we wait a little bit before it, in case the user scrolls
           * like crazy up and down
           */
          const timeout = self.setTimeout(() => {
            this.appDialogsManager.initDialog(dialogElement, options)
            .then(
              () => {
                this.unmountedDialogElements.delete(dialogElement)
              },
              () => {},
            )
          }, 200)

          onCleanup(() => {
            self.clearTimeout(timeout)
          })
        }

        return dialogElement.dom.listEl
      },
      // * A dropped DialogElement owns a middlewareHelper, and everything wrapped under it is
      // * released only by that helper's destroy. Only 'dialog' items are ours to destroy:
      // * the custom ones are the caller's own objects, handed in as the key, and may be re-added later.
      onItemDiscard: (item) => {
        if(item.type === 'dialog') {
          this.unmountedDialogElements.delete(item.value)
          item.value.destroy()
        }
      },
      onItemUnmount: (item) => {
        if(item.type === 'dialog') {
          this.unmountedDialogElements.set(item.value, true)
          // the nodes survive the unmount but their custom emoji do not, so the
          // re-init below must rebuild the subtitle rather than recognize it as
          // already rendered
          delete item.value.dom.lastMessageRenderKey
        }
      },
      onListShrinked: options.onListShrinked,
      requestItemForIdx: options.requestItemForIdx,
      sortWith: (a, b) => b - a,
      itemSize: options.itemSize,
      noAvatar: options.noAvatar,
      onListLengthChange: options.onListLengthChange,
      extraPaddingBottom: options.extraPaddingBottom,
    })

    this.list = this.virtualList.list

    this.list.classList.add('chatlist', 'virtual-chatlist')
  }

  /** tweb `:143-162` (расхождения 1, 2) */
  public getIndexForKey(key: SortedDialogListKey) {
    if(key instanceof CustomPinnedDialog) return 0

    return getDialogIndex(key) ?? 0
  }

  /** tweb `:164-171` */
  public async createItemForKey(key: SortedDialogListKey): Promise<DeferredSortedVirtualListItem<SortedDialogListItem>> {
    const value = await this.createElementForKey(key)
    return { id: key, index: this.getIndexForKey(key), value }
  }

  /** tweb `:173-191` (расхождения 2, 5) */
  private getDialogOptions(key: PeerId) {
    const options: Parameters<AppDialogsManager['addListDialog']>[0] = {
      peerId: key,
      isBatch: true,
      isMainList: this.filterId === ALL_FOLDER_ID,
      meAsSaved: true,
      wrapOptions: {},
    }

    return { options }
  }

  /** tweb `:203-232` (расхождение 2) */
  public createElementForKey(key: SortedDialogListKey): Promise<SortedDialogListItem> {
    if(key instanceof CustomPinnedDialog) return Promise.resolve({
      type: 'custom-pinned-dialog',
      value: key,
    })

    const { options } = this.getDialogOptions(key)
    const dialogElement = this.appDialogsManager.addListDialog(options)

    return Promise.resolve({
      type: 'dialog',
      value: dialogElement,
    })
  }

  /** tweb `:247-254` */
  public addDeferredItems(items: DeferredSortedVirtualListItem<SortedDialogListItem>[], totalCount: number) {
    batch(() => {
      this.totalCount = totalCount
      this.virtualList.setWasAtLeastOnceFetched(true)
      this.virtualList.addItems(items)
      this.updateTotalCount()
    })
  }

  /** tweb `:256-264` */
  public async add(key: SortedDialogListKey, canFinish: () => boolean = () => true) {
    const item = await this.createItemForKey(key)
    if(!canFinish()) {
      return
    }

    this.virtualList.addItems([item])
  }

  /** tweb `:266-269` */
  public async addPinned(key: SortedDialogListKey) {
    const item = await this.createItemForKey(key)
    this.virtualList.addPinnedItems([item])
  }

  /** tweb `:271-274` */
  public async ensurePinned(key: SortedDialogListKey) {
    const item = await this.createItemForKey(key)
    this.virtualList.ensurePinnedItems([item])
  }

  /** tweb `:276-278` */
  public removePinned(key: SortedDialogListKey) {
    this.virtualList.removePinnedItem(key)
  }

  public blockAnimation() {
    return this.virtualList.blockAnimation()
  }

  /** tweb `:284-298` */
  public delete(key: SortedDialogListKey, adjustTotalCount = true) {
    batch(() => {
      // * Pinned entries live in their own collection, but every read API merges both, so
      // * callers routinely discover a pinned key and delete it through here. Both sides,
      // * so delete means delete.
      const removedPinned = this.virtualList.removePinnedItem(key)
      const removedItem = this.virtualList.removeItem(key)
      if((removedPinned || removedItem) && adjustTotalCount) {
        this.adjustTotalCount(-1)
      }
    })
  }

  /** tweb `:300-303` */
  public adjustTotalCount(delta: number) {
    this.totalCount = Math.max(0, this.totalCount + delta)
    this.updateTotalCount()
  }

  private updateTotalCount() {
    this.virtualList.setTotalCount(
      Math.max(0, this.totalCount + this.totalCountOffset),
    )
  }

  public has(key: SortedDialogListKey) {
    return this.virtualList.has(key)
  }

  /** tweb `:321-324` */
  public getDialogElement(key: SortedDialogListKey) {
    const item = this.virtualList.get(key)
    if(item?.type === 'dialog') return item.value
  }

  /** tweb `:326-335` */
  public getAllDialogElementsMap() {
    const map = this.virtualList.getAll()
    const filteredEntries: [PeerId, DialogElement][] = []
    map.forEach((value, key) => {
      if(value?.type === 'dialog') filteredEntries.push([key as PeerId, value.value])
    })

    return new Map(filteredEntries)
  }

  public getSortedItems() {
    return this.virtualList.sortedItems()
  }

  /** tweb `:366-373` */
  public update(key: SortedDialogListKey, canFinish: () => boolean = () => true) {
    const index = this.getIndexForKey(key)
    if(!canFinish()) {
      return
    }

    this.virtualList.updateItem(key, index)
  }

  public itemsLength() {
    return this.virtualList.itemsLength()
  }

  /** tweb `:379-383` */
  public clear() {
    this.totalCount = 0
    this.totalCountOffset = 0
    this.virtualList?.clear()
  }

  public destroy() {
    this.virtualList?.dispose()
  }
}

/** tweb `:390-400` */
export class CustomPinnedDialog {
  render: () => HTMLElement

  constructor({ render }: { render: () => HTMLElement }) {
    this.render = render
  }
}

type SortedDialogListItem = {
  type: 'custom-pinned-dialog',
  value: CustomPinnedDialog,
} | {
  type: 'dialog',
  value: DialogElement,
}
