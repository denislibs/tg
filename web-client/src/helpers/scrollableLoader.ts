/**
 * Порт tweb/src/helpers/scrollableLoader.ts:1-47 (812502980) — догрузка списка
 * по прокрутке к низу `Scrollable`: `getPromise` грузит следующую страницу и
 * отвечает, всё ли загружено. Первый потребитель — список исключений вкладки
 * прав группы (`sidebarRight/tabs/groupPermissions/groupPermissions.solid.tsx`).
 *
 * Отличий от оригинала нет. Ветка первой загрузки, как у tweb (:35-45),
 * промиса не возвращает: `await loader.load()` вызывающего первую страницу не
 * ждёт — она ложится после въезда вкладки.
 */
import type Scrollable from '@components/scrollable'
import safeAssign from '@helpers/object/safeAssign'

export default class ScrollableLoader {
  public loading = false
  private scrollable!: Scrollable
  private getPromise!: () => Promise<boolean>
  private promise?: Promise<any>
  private loaded = false

  constructor(options: {
    scrollable: Scrollable,
    getPromise: () => Promise<boolean>
  }) {
    safeAssign(this, options)

    options.scrollable.onScrolledBottom = () => {
      void this.load()
    }
  }

  public load(): Promise<any> | undefined {
    if(this.loaded) {
      return Promise.resolve()
    }

    if(this.loading) {
      return this.promise!
    }

    this.loading = true
    this.promise = this.getPromise().then((done) => {
      this.loading = false
      this.promise = undefined

      if(done) {
        this.loaded = true
        this.scrollable.onScrolledBottom = undefined
      } else {
        this.scrollable.checkForTriggers?.()
      }
    }, () => {
      this.promise = undefined
      this.loading = false
    })
  }
}
