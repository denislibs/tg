// Порт tweb `src/helpers/sortedList.ts:128-303` — класс `SortedList`.
//
// Сортированная коллекция «id → элемент» с отложенной вставкой узлов: `add`
// заводит запись и кладёт её создание (`onElementCreate`) в `BatchProcessor`,
// так что элементы, добавленные за один тик, создаются одной пачкой и уже
// потом расставляются (`update` → `getIndex` → `insertInDescendSortedArray` →
// `onSort`). Индекс — число, порядок убывающий: чем больше, тем выше.
//
// `BatchProcessor` (tweb `:15-126`, тот же файл) у нас портирован раньше и
// лежит отдельно — `helpers/batchProcessor.ts`; здесь он только используется.
//
// Не портировано: `log` (именованный логгер `SortedList`, у подсистемы его нет
// — как и у `BatchProcessor`). `console.error('loadPromises are still
// pending?')` в `add` (`:246`) — оставлен: это способ оригинала сказать, что
// создание элемента зависло дольше секунды.
import insertInDescendSortedArray from '@helpers/array/insertInDescendSortedArray'
import { BatchProcessor } from '@helpers/batchProcessor'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import pause from '@helpers/schedulers/pause'

export type SortedElementBase<T = unknown> = {
  id: T,
  index: number
}

export default class SortedList<SortedElement extends SortedElementBase, SortedElementId = SortedElement['id']> {
  protected elements: Map<SortedElementId, SortedElement>
  protected sorted: SortedElement[]

  protected getIndex!: (element: SortedElement) => Promise<number> | number
  protected onDelete?: (element: SortedElement) => void
  protected onUpdate?: (element: SortedElement) => void
  protected onSort?: (element: SortedElement, idx: number) => void
  protected onElementCreate!: (base: SortedElementBase<SortedElementId>) => Promise<SortedElement> | SortedElement

  protected updateElementWith = (callback: () => void) => callback()
  protected updateListWith = (callback: (canUpdate: boolean | undefined) => void) => callback(true)

  protected middlewareHelper: MiddlewareHelper

  protected batchProcessor: BatchProcessor<SortedElement>

  constructor(options: {
    getIndex: SortedList<SortedElement, SortedElementId>['getIndex'],
    onDelete?: SortedList<SortedElement, SortedElementId>['onDelete'],
    onUpdate?: SortedList<SortedElement, SortedElementId>['onUpdate'],
    onSort?: SortedList<SortedElement, SortedElementId>['onSort'],
    onElementCreate: SortedList<SortedElement, SortedElementId>['onElementCreate'],

    updateElementWith?: SortedList<SortedElement, SortedElementId>['updateElementWith'],
    updateListWith?: SortedList<SortedElement, SortedElementId>['updateListWith'],

    middleware?: Middleware
  }) {
    // tweb `:161` — `safeAssign(this, options)`; выписано по полям, чтобы
    // `middleware` (опция, а не поле) не лёг на инстанс.
    this.getIndex = options.getIndex
    this.onDelete = options.onDelete
    this.onUpdate = options.onUpdate
    this.onSort = options.onSort
    this.onElementCreate = options.onElementCreate
    if(options.updateElementWith) this.updateElementWith = options.updateElementWith
    if(options.updateListWith) this.updateListWith = options.updateListWith

    this.elements = new Map()
    this.sorted = []
    this.middlewareHelper = options.middleware?.create() || getMiddleware()

    this.batchProcessor = new BatchProcessor<SortedElement>({
      process: async(batch, m) => {
        const promises = batch.map((element) => this.update(element.id as SortedElementId, element))
        await m(Promise.all(promises))
      },
    })
  }

  public clear() {
    this.batchProcessor.clear()
    this.middlewareHelper.clean()
    this.elements.clear()
    this.sorted.length = 0
  }

  protected _updateList() {
    this.elements.forEach((element) => {
      void this.update(element.id as SortedElementId)
    })

    if(this.onSort) {
      this.sorted.forEach((element, idx) => {
        this.onSort!(element, idx)
      })
    }
  }

  public updateList(callback?: (updated: boolean) => void) {
    const middleware = this.middlewareHelper.get()
    this.updateListWith((canUpdate) => {
      if(!middleware() || (canUpdate !== undefined && !canUpdate)) {
        callback?.(false)
        return
      }

      this._updateList()

      callback?.(true)
    })
  }

  public has(id: SortedElementId) {
    return this.elements.has(id)
  }

  public get(id: SortedElementId) {
    return this.elements.get(id)
  }

  public getAll() {
    return this.elements
  }

  public async add(id: SortedElementId) {
    const element = this.get(id)
    if(element) {
      return
    }

    const base: SortedElementBase<SortedElementId> = {
      id,
      index: 0,
    }

    this.elements.set(id, base as SortedElement)
    let result = this.onElementCreate(base)
    if(result instanceof Promise) {
      let processed = false
      result = Promise.race([
        result.then((result) => {
          processed = true
          return result
        }),
        pause(1000).then(() => {
          if(!processed) {
            console.error('loadPromises are still pending?', base)
            return base as SortedElement
          }
          // Гонка уже выиграна первым обещанием — эта ветка не читается
          // (`Promise.race`), тип возврата ей нужен только формально.
          return base as SortedElement
        }),
      ])
    }
    return this.batchProcessor.addToQueue(result)
  }

  public delete(id: SortedElementId, noScheduler?: boolean) {
    const element = this.elements.get(id)
    if(!element) {
      return false
    }

    this.elements.delete(id)

    const idx = this.sorted.indexOf(element)
    if(idx !== -1) {
      this.sorted.splice(idx, 1)
    }

    if(this.onDelete) {
      if(noScheduler) {
        this.onDelete(element)
      } else {
        const middleware = this.middlewareHelper.get()
        this.updateElementWith(() => {
          if(!middleware()) {
            return
          }

          this.onDelete!(element)
        })
      }
    }

    return true
  }

  public async update(id: SortedElementId, element = this.get(id)) {
    if(!element) {
      return
    }

    element.index = await this.getIndex(element)
    if(this.get(id) !== element) {
      return
    }

    this.onUpdate?.(element)

    const idx = insertInDescendSortedArray(this.sorted, element, 'index')
    this.onSort?.(element, idx)
  }
}
