// Порт tweb `src/components/emoticonsDropdown/tabs/SuperStickerRenderer.ts` (812502980, 194
// строки) — ячейки стикеров панели: `div.grid-item.super-sticker[data-doc-id]`; до попадания в
// вид у анимированного рисуется только превью (`onlyThumb`), видимая ячейка играет
// (`processVisible`), ушедшая — гасит плеер и возвращается к превью (`processInvisible`).
//
// Расхождения:
//  1. Документ ячейки — карта `docs` рендерера, а не `managers.appDocsManager.getDoc(docId)`
//     (`:139`, `:181`): тот же документ уже на руках у того, кто зовёт `renderSticker`, а
//     запрос к воркеру ради него — лишний круг (у tweb менеджер синхронен в своём потоке).
//  2. `withLock` (замок премиум-стикера, `:28`, `:157`) и `playOnHover` (`:29`, `:93-100`) не
//     переносились: премиум-стикеров у бэкенда нет, `playOnHover` у панели не задаётся.
//  3. Вход `wrapSticker` — `mediaId` и превью документа (наш `wrappers/sticker.ts`), а не `doc`.
import mediaSizes from '@helpers/mediaSizes'
import type { MyDocument } from '@core/media/messageMedia'
import { getPathThumb, getStrippedThumb } from '@core/media/messageMedia'
import type { LazyLoadQueue } from '@core/lazyLoadQueue'
import animationIntersector, { type AnimationItemGroup } from '@components/animationIntersector'
import LazyLoadQueueRepeat from '@components/lazyLoadQueueRepeat'
import wrapSticker from '@components/wrappers/sticker'
import { getMiddleware, type Middleware } from '@helpers/middleware'
import noop from '@helpers/noop'

export default class SuperStickerRenderer {
  public lazyLoadQueue: LazyLoadQueueRepeat
  private animated: Set<HTMLElement> = new Set()
  private docs: Map<HTMLElement, MyDocument> = new Map()
  private regularLazyLoadQueue: LazyLoadQueue
  private group: AnimationItemGroup

  constructor(options: {
    regularLazyLoadQueue: LazyLoadQueue
    group: AnimationItemGroup
    intersectionObserverInit?: IntersectionObserverInit
  }) {
    this.regularLazyLoadQueue = options.regularLazyLoadQueue
    this.group = options.group

    this.lazyLoadQueue = new LazyLoadQueueRepeat(undefined, ({ target, visible }) => {
      if(!visible) {
        this.processInvisible(target)
      }
    }, options.intersectionObserverInit)
  }

  public clear() {
    this.lazyLoadQueue.clear()
    this.animated.forEach((element) => {
      element.middlewareHelper?.destroy()
    })
    this.animated.clear()
    this.docs.clear()
  }

  public destroy() {
    this.clear()
  }

  public renderSticker(
    doc: MyDocument,
    element?: HTMLElement,
    _loadPromises?: Promise<unknown>[],
    middleware?: Middleware,
  ) {
    if(!element) {
      element = document.createElement('div')
      element.classList.add('grid-item', 'super-sticker')
      element.dataset.docId = '' + doc.id
      element.dataset.emoji = doc.stickerEmojiRaw || ''
      this.docs.set(element, doc)

      if(doc.animated) {
        this.observeAnimated(element)
      }
    }

    element.middlewareHelper ??= middleware ? middleware.create() : getMiddleware()

    // * This will wrap only a thumb
    wrapSticker({
      ...this.getWrapOptions(doc),
      div: element,
      lazyLoadQueue: this.regularLazyLoadQueue,
      group: this.group,
      onlyThumb: !!doc.animated,
      middleware: element.middlewareHelper.get(),
    }).render.catch(noop)

    return element
  }

  private getWrapOptions(doc: MyDocument) {
    const size = mediaSizes.active.esgSticker.width
    return {
      mediaId: doc.id,
      thumb: getStrippedThumb(doc),
      pathThumb: getPathThumb(doc),
      docWidth: doc.w,
      docHeight: doc.h,
      width: size,
      height: size,
    }
  }

  public observeAnimated(element: HTMLElement) {
    this.animated.add(element)
    this.lazyLoadQueue.observe({
      div: element,
      load: this.processVisible,
    })
  }

  public unobserveAnimated(element: HTMLElement) {
    element.middlewareHelper?.destroy()
    this.animated.delete(element)
    this.docs.delete(element)
    this.lazyLoadQueue.delete({ div: element })
  }

  public deleteSticker(element: HTMLElement) {
    return this.unobserveAnimated(element)
  }

  private checkAnimationContainer = (element: HTMLElement, visible: boolean) => {
    const players = animationIntersector.getAnimations(element)
    players.forEach((player) => {
      if(!visible) {
        animationIntersector.removeAnimation(player)
      } else {
        animationIntersector.checkAnimation(player, false)
      }
    })
  }

  private processVisible = async(element: HTMLElement) => {
    const doc = this.docs.get(element)
    if(!doc) return

    element.middlewareHelper ??= getMiddleware()
    element.middlewareHelper.clean()

    const promise = wrapSticker({
      ...this.getWrapOptions(doc),
      div: element,
      group: this.group,
      play: true,
      loop: true,
      middleware: element.middlewareHelper.get(),
    }).render

    promise.then(() => {
      this.checkAnimationContainer(element, this.lazyLoadQueue.intersector.isVisible(element))
    }, noop)

    return promise
  }

  public processInvisible = (element: HTMLElement) => {
    const doc = this.docs.get(element)
    if(!doc) return

    // the cell may be back on screen; demolishing it now would yank a live canvas (visible
    // blink). Leave the old player alive - the visible flip that brought the cell back already
    // queued processVisible, which cleans and re-wraps. The dropdown 'closed' sweep clears
    // visibility synchronously before calling this, so it still demolishes hidden cells.
    if(this.lazyLoadQueue.intersector.isVisible(element)) {
      return
    }

    this.checkAnimationContainer(element, false)

    element.middlewareHelper?.clean()
    // no replaceChildren - the thumb re-wrap adopts the dead canvas (pixels retained) as its
    // bottom layer and retires it only under the decoded preview img (replacePreviousMedia), so
    // a mis-timed demolition can never produce an empty/silhouette frame
    this.renderSticker(doc, element)
  }
}
