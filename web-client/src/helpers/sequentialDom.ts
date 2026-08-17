// Порт tweb `src/helpers/sequentialDom.ts` — 1:1 по логике (формат под
// `.oxlintrc.json` этого репозитория: без `;`; `MOUNT_CLASS_TO`-отладочный
// хвост оригинала не портирован, как и во всех прочих наших портах).
//
// Зачем довезён: это прямая зависимость `helpers/dom/renderMediaWithFadeIn.ts`
// (tweb renderMediaWithFadeIn.ts:1) — батчер записей в DOM, который склеивает
// все мутации кадра в один `fastRaf`. Без него вставка полного медиа поверх
// превью пришлось бы писать «своим» планировщиком, а это уже не порт.
//
// Существенное свойство, ради которого он и нужен именно здесь:
// `mutateElement` для элемента ВНЕ документа выполняет колбэк СИНХРОННО
// (`isInDOM` → false). Бабл ленты собирается до вставки в DOM, и без этого
// правила первый кадр ленты уезжал бы на rAF позже.
import { fastRaf } from '@helpers/schedulers'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import isInDOM from '@helpers/dom/isInDOM'

class SequentialDom {
  private promises: Partial<{
    read: CancellablePromise<void>
    write: CancellablePromise<void>
  }> = {}

  private raf = fastRaf.bind(null)
  private scheduled = false

  private do(kind: 'read' | 'write', callback?: () => void) {
    let promise = this.promises[kind]
    if (!promise) {
      this.scheduleFlush()
      promise = this.promises[kind] = deferredPromise<void>()
    }

    if (callback !== undefined) {
      void promise.then(() => callback())
    }

    return promise
  }

  public measure(callback?: () => void) {
    return this.do('read', callback)
  }

  public mutate(callback?: () => void) {
    return this.do('write', callback)
  }

  /**
   * Сработает мгновенно, если элемент не в документе
   */
  public mutateElement(element: HTMLElement, callback?: () => void) {
    const isConnected = isInDOM(element)
    const promise: Promise<void> = isConnected ? this.mutate() : Promise.resolve()

    if (callback !== undefined) {
      if (!isConnected) {
        callback()
      } else {
        void promise.then(() => callback())
      }
    }

    return promise
  }

  private scheduleFlush() {
    if (!this.scheduled) {
      this.scheduled = true

      this.raf(() => {
        // `?.()` на самом `resolve` — от строгого tsconfig: в нашем
        // `CancellablePromise` поле опционально (в tweb strict выключен).
        this.promises.read?.resolve?.()
        this.promises.write?.resolve?.()

        this.scheduled = false
        this.promises = {}
      })
    }
  }
}

const sequentialDom = new SequentialDom()
export default sequentialDom
