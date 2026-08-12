// Порт tweb `src/helpers/listLoader.ts` — 1:1 по логике: `loadCount = 50`,
// `loadWhenLeft = 20`, `go()` со сплайсом previous/next и `onJump`,
// `load()` с дедупом по loadPromise и loadedAll, `setTargets`, `reset`,
// `goUnsafe`/`unsetCurrent` (нужны SearchListLoader-надстройке — сам
// SearchListLoader/AvatarListLoader не портированы: подключение источника
// данных — отдельная задача V4).
//
// Адаптации (поведение не менялось):
//   • строгий tsconfig (в tweb `strict` выключен): options объявляют
//     сигнатуры сами (в tweb — индексация protected-полей класса, у нас
//     TS2445); `current`/`count` честно `| undefined` (tweb пишет в них
//     `undefined` в `reset()`/до первой загрузки), loadPromise — `| null`;
//     `loadMore` помечен `!` (всегда задан после safeAssign в конструкторе)
//   • `ListLoaderResult.items` типизирован `P[]` (в tweb — `any[]`; элементы
//     реально идут в `processItem(item: P)`, рантайм тот же)
//   • закомментированный в tweb метод `filter` (строки 48-57) не перенесён —
//     мёртвый код
import forEachReverse from '@helpers/array/forEachReverse'
import safeAssign from '@helpers/object/safeAssign'

export type ListLoaderOptions<T extends object, P extends object> = {
  loadMore: (anchor: T | undefined, older: boolean, loadCount: number) => Promise<ListLoaderResult<P>>,
  loadCount?: number,
  loadWhenLeft?: number,
  processItem?: (item: P) => T | Promise<T>,
  onJump?: (item: T, older: boolean) => void,
  onLoadedMore?: () => void,
}

export type ListLoaderResult<P extends object> = { count: number, items: P[] }
export default class ListLoader<T extends object, P extends object> {
  public current: T | undefined
  public previous: T[] = []
  public next: T[] = []
  public count: number | undefined
  public reverse = false // reverse means next = higher msgid

  protected loadMore!: ListLoaderOptions<T, P>['loadMore']
  protected processItem: ListLoaderOptions<T, P>['processItem']
  protected loadCount = 50
  protected loadWhenLeft = 20

  public onJump: ListLoaderOptions<T, P>['onJump']
  public onLoadedMore: ListLoaderOptions<T, P>['onLoadedMore']

  protected loadedAllUp = false
  protected loadedAllDown = false
  protected loadPromiseUp: Promise<void> | null = null
  protected loadPromiseDown: Promise<void> | null = null

  constructor(options: ListLoaderOptions<T, P>) {
    safeAssign(this, options)
  }

  public setTargets(previous: T[], next: T[], reverse: boolean) {
    this.previous = previous
    this.next = next
    this.reverse = reverse
  }

  public get index() {
    return this.count !== undefined ? this.previous.length : -1
  }

  public reset(loadedAll = false) {
    this.current = undefined
    this.previous = []
    this.next = []
    this.setLoaded(true, loadedAll)
    this.setLoaded(false, loadedAll)
  }

  public go(length: number, dispatchJump = true) {
    let items: T[], item: T | undefined
    if (length > 0) {
      items = this.next.splice(0, length)
      item = items.pop()
      if (!item) {
        return
      }

      if (this.current !== undefined) items.unshift(this.current)
      this.previous.push(...items)
    } else {
      items = this.previous.splice(Math.max(0, this.previous.length + length), -length)
      item = items.shift()
      if (!item) {
        return
      }

      if (this.current !== undefined) items.push(this.current)
      this.next.unshift(...items)
    }

    this.current = item

    if (this.next.length < this.loadWhenLeft) {
      void this.load(!this.reverse) // void: fire-and-forget как в tweb (oxlint no-floating-promises)
    }

    if (this.previous.length < this.loadWhenLeft) {
      void this.load(this.reverse)
    }

    if (dispatchJump) this.onJump?.(item, length > 0) // в tweb `dispatchJump && ...` (oxlint no-unused-expressions)
    return this.current
  }

  protected unsetCurrent(toPrevious: boolean) {
    // `!`: SearchListLoader зовёт это только при определённом current (tweb)
    if (toPrevious) this.previous.push(this.current!)
    else this.next.unshift(this.current!)

    this.current = undefined
  }

  public goUnsafe(length: number, dispatchJump?: boolean) {
    const leftLength = length > 0 ? Math.max(0, length - this.next.length) : Math.min(0, length + this.previous.length)
    const item = this.go(length, leftLength ? false : dispatchJump)

    return {
      item: !leftLength ? item : undefined,
      leftLength,
    }
  }

  protected setLoaded(down: boolean, value: boolean) {
    const isChanged = (down ? this.loadedAllDown : this.loadedAllUp) !== value
    if (!isChanged) {
      return false
    }

    if (down) this.loadedAllDown = value
    else this.loadedAllUp = value

    if (!value) {
      if (down) this.loadPromiseDown = null
      else this.loadPromiseUp = null
    }

    return true
  }

  // нет смысла делать проверку для reverse и loadMediaPromise
  public load(older: boolean) {
    if (older ? this.loadedAllDown : this.loadedAllUp) return Promise.resolve()

    let promise = older ? this.loadPromiseDown : this.loadPromiseUp
    if (promise) return promise

    let anchor: T | undefined
    if (older) {
      anchor = this.reverse ? this.previous[0] : this.next[this.next.length - 1]
    } else {
      anchor = this.reverse ? this.next[this.next.length - 1] : this.previous[0]
    }

    anchor ??= this.current
    promise = this.loadMore(anchor, older, this.loadCount).then(async (result) => {
      if ((older ? this.loadPromiseDown : this.loadPromiseUp) !== promise) {
        return
      }

      if (result.items.length < this.loadCount) {
        this.setLoaded(older, true)
      }

      if (this.count === undefined) {
        this.count = result.count || result.items.length
      }

      const processedArr: Promise<T>[] = []
      const method = older && !this.reverse ? result.items.forEach.bind(result.items) : forEachReverse.bind(null, result.items)
      method((item: P) => {
        const processed = this.processItem ? this.processItem(item) : (item as unknown as T) // без processItem tweb кладёт сырой P как T (в tweb — any)

        if (!processed) return
        // Promise.resolve: в tweb массив смешанный (T | Promise<T>) и идёт в
        // Promise.all как есть — рантайм тот же, обёртка ради oxlint await-thenable
        processedArr.push(Promise.resolve(processed))
      })

      const results = (await Promise.all(processedArr)).filter(Boolean)
      if ((older ? this.loadPromiseDown : this.loadPromiseUp) !== promise) {
        return
      }

      if (older) {
        if (this.reverse) this.previous.unshift(...results)
        else this.next.push(...results)
      } else {
        if (this.reverse) this.next.push(...results)
        else this.previous.unshift(...results)
      }

      this.onLoadedMore?.()
    }, () => {}).then(() => {
      if (older) this.loadPromiseDown = null
      else this.loadPromiseUp = null
    })

    if (older) this.loadPromiseDown = promise
    else this.loadPromiseUp = promise

    return promise
  }
}
