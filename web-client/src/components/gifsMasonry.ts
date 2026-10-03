/**
 * Порт tweb `src/components/gifsMasonry.ts` (812502980, 204 строки) — кладка GIF.
 * Потребитель у нас — вкладка «Поиск GIF» правой колонки
 * (`sidebarRight/tabs/gifs.solid.tsx`, tweb `gifs.tsx:107`); у tweb тем же
 * классом пользуется и вкладка GIF дропдауна (у нас она ещё React —
 * `components/emoji/GifsTab.tsx`, волна 5).
 *
 * Механика оригинала сохранена: ячейка `div.gif.grid-item[data-doc-id]` со
 * своим `middlewareHelper` (ребёнок хелпера кладки), превью рисуется сразу
 * (`add`, `onlyPreview`), видео — только пока ячейка видима
 * (`processVisibleDiv`), и после конца скролла (`scrollPromise`, 150 мс);
 * ушедшая из вида ячейка возвращает превью и гасит поколение видео
 * (`processInvisibleDiv`).
 *
 * Расхождения с оригиналом:
 *  1. Элемент кладки — `GifItem` Tenor-выдачи (`core/gifs.ts`), а не документ:
 *     поиск GIF у нас — прокси Tenor (`GET /gifs/search`), а не инлайн-бот
 *     `@gif` с `botInlineMediaResult.document` (tweb `gifs.tsx:36-60`), О-27
 *     волна 7. Отсюда
 *     `this.map` держит сам элемент (ключ `GifItem.key` = `data-doc-id`), и
 *     `managers.appDocsManager.getDoc(docId)` (`:82`) не нужен.
 *  2. `wrapVideo` (`:90-98`, `:186-192`) → `wrapGifPreview`/`wrapGifVideo` ниже:
 *     наш `wrapVideo` принимает документ и стримит media-эндпоинт
 *     (`resolveStreamUrl`), у Tenor-результата есть только ссылки CDN. Функции
 *     повторяют ветки оригинала для `doc.type === 'gif'`: класс
 *     `media-gif-wrapper` и размеры документа на контейнере, постер
 *     `img.media-photo` (`onlyPreview`), `video.media-video` muted/loop/autoplay
 *     с потоковым прелоадером до первого кадра и регистрацией в
 *     `animationIntersector` (`noPreview`, tweb `wrappers/video.ts:104-106`,
 *     `:525-530`, `:604-610`, `:645-661`).
 *  3. `LazyLoadQueueRepeat2` (`:32-38`) → `VisibilityIntersector` (видимость, тот
 *     же порт tweb) + `core/lazyLoadQueue` (очередь с потолком 8,
 *     `lazyLoadQueueBase.ts:6`): иерархии `lazyLoadQueue*` у нас нет, её роль
 *     «видимые — вперёд» (`lazyLoadQueueRepeat2.ts:10-15`) очередь выполняет
 *     живым геттером видимости цели. `clear()` снимает ещё не начатые задачи
 *     (промис отклоняется — ловим) и отключает наблюдатель
 *     (`lazyLoadQueueIntersector.ts:38-41`).
 *  4. `addBatch`/`update`/`delete` (`:150-203`) — для вкладки GIF эмодзи-дропдауна
 *     (`emoticonsDropdown/tabs/gifs.ts`, сохранённые GIF); элемент сохранённого GIF —
 *     `savedGifToItem` (`core/gifs.ts`): видео стримится с медиа-эндпоинта
 *     (`resolveStreamUrl`), превью — stripped-миниатюра документа.
 *  5. `clear()` забывает ячейки (`map` и их `middlewareHelper`), а не только
 *     очередь (`:70-72`). Единственный вызывающий оригинала — `reset()` вкладки
 *     поиска (`gifs.tsx:28-33`), который тут же вычищает кладку
 *     (`gifsDiv.replaceChildren()`, `:51-53`); с живой `map` повторная выдача
 *     тех же документов (возврат к трендам после запроса) отсекается проверкой
 *     `map.has` в `add` (`:169-171`) и кладка остаётся пустой.
 */
import animationIntersector, { type AnimationItemGroup } from '@components/animationIntersector'
import ProgressivePreloader from '@components/preloader'
import type Scrollable from '@components/scrollable'
import VisibilityIntersector from '@components/visibilityIntersector'
import type { GifItem } from '@core/gifs'
import { createLazyLoadQueue, type LazyLoadQueue } from '@core/lazyLoadQueue'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import createVideo from '@helpers/dom/createVideo'
import renderImageFromUrl from '@helpers/dom/renderImageFromUrl'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import noop from '@helpers/noop'
import onMediaLoad from '@helpers/onMediaLoad'
import { doubleRaf } from '@helpers/schedulers'
import positionElementByIndex from '@helpers/dom/positionElementByIndex'
import { resolveStreamUrl } from '@core/mediaUrl'

/**
 * Превью ячейки — ветка `onlyPreview` tweb `wrapVideo` для гифки
 * (`video.ts:104-106` → `wrapPhoto` → `:434-446`): класс `media-gif-wrapper`,
 * `media-container` и размеры документа на контейнере, постер `img.media-photo`.
 */
function wrapGifPreview(item: GifItem, container: HTMLElement, middleware: Middleware) {
  container.classList.add('media-gif-wrapper', 'media-container')
  container.style.width = item.width + 'px'
  container.style.height = item.height + 'px'

  if(!item.previewUrl) return

  const img = document.createElement('img')
  img.classList.add('media-photo')
  void renderImageFromUrl(img, item.previewUrl, () => {
    if(!middleware()) return
    container.append(img)
  })
}

/**
 * Видео ячейки — ветка `noPreview` tweb `wrapVideo` для гифки: потоковый
 * прелоадер (`cancelable: false`, `prepend`, `video.ts:525-530`) до первого
 * кадра (`:604-610`), видео `muted`/`loop`/`autoplay` (`:630-635`), после
 * загрузки — регистрация в `animationIntersector` и вставка в контейнер
 * (`:645-661`). `loadPromise` — `res.loadPromise` оригинала.
 */
function wrapGifVideo(item: GifItem, container: HTMLElement, group: AnimationItemGroup, middleware: Middleware) {
  const video = createVideo({ middleware })
  video.classList.add('media-video')
  video.muted = true
  video.loop = true
  video.autoplay = true

  const preloader = new ProgressivePreloader({ cancelable: false, attachMethod: 'prepend' })
  preloader.attach(container, false)

  const loadPromise = onMediaLoad(video).then(() => {
    if(!middleware()) return

    animationIntersector.addAnimation({
      animation: video,
      group,
      observeElement: video,
      type: 'video',
    })

    preloader.detach()

    if(!video.parentElement) {
      container.append(video)
    }
  }, (err: unknown) => {
    preloader.detach()
    throw err
  })

  if(item.mp4Url) {
    video.src = item.mp4Url
  } else {
    const url = resolveStreamUrl(item.mediaId!)
    if(typeof url === 'string') video.src = url
    else void url.then((url) => { if(middleware()) video.src = url })
  }

  return { video, loadPromise }
}

export default class GifsMasonry {
  public lazyLoadQueue: LazyLoadQueue
  public intersector: VisibilityIntersector
  private scrollPromise: CancellablePromise<void> = deferredPromise<void>()
  private timeout = 0
  private middlewareHelper: MiddlewareHelper
  private map: Map<string, { item: GifItem, div: HTMLElement }>

  constructor(
    private element: HTMLElement,
    private group: AnimationItemGroup,
    private scrollable: Scrollable,
    attach = true,
  ) {
    this.middlewareHelper = getMiddleware()
    this.map = new Map()
    // tweb :16 — `scrollPromise` стартует разрешённым: до первого скролла
    // видимые ячейки грузятся сразу.
    this.scrollPromise.resolve!()

    this.lazyLoadQueue = createLazyLoadQueue()
    this.intersector = new VisibilityIntersector(({ target, visible }) => {
      if(visible) {
        this.processVisibleDiv(target)
      } else {
        void this.processInvisibleDiv(target)
      }
    })

    if(attach) {
      this.attach()
    }
  }

  private onScroll = () => {
    if(this.timeout) {
      clearTimeout(this.timeout)
    } else {
      this.scrollPromise = deferredPromise<void>()
    }

    this.timeout = window.setTimeout(() => {
      this.timeout = 0
      this.scrollPromise.resolve!()
    }, 150)
  }

  public attach() {
    this.scrollable.container.addEventListener('scroll', this.onScroll)
  }

  public detach() {
    this.clear()
    this.scrollable.container.removeEventListener('scroll', this.onScroll)
    this.middlewareHelper.destroy()
  }

  public clear() {
    this.lazyLoadQueue.clear()
    this.intersector.disconnect()
    // Расхождение 5: ячейки забываются вместе с очередью.
    for(const { div } of this.map.values()) {
      div.middlewareHelper!.destroy()
    }
    this.map.clear()
  }

  /** Элемент кладки по `data-doc-id` ячейки (вместо `appDocsManager.getDoc`, расхождение 1). */
  public getItem(docId: string) {
    return this.map.get(docId)?.item
  }

  private processVisibleDiv(div: HTMLElement) {
    const video = div.querySelector('video')
    if(video) {
      return
    }

    const load = () => {
      const item = this.map.get(div.dataset.docId!)?.item
      return this.scrollPromise.then(async() => {
        if(!item || !this.intersector.isVisible(div)) {
          void this.processInvisibleDiv(div)
          return
        }

        div.middlewareHelper!.clean()
        const middleware = div.middlewareHelper!.get().create().get()
        const res = wrapGifVideo(item, div, this.group, middleware)

        const promise = res.loadPromise
        void promise.finally(() => {
          middleware.onDestroy(() => {
            res.video.remove()
          })

          if(!middleware() || !this.intersector.isVisible(div)) {
            void this.processInvisibleDiv(div)
            return
          }

          const thumb = div.querySelector('img, canvas')
          thumb?.classList.add('hide')
        }).catch(noop)

        return promise
      })
    }

    // `clear()` снимает ещё не начатую задачу отказом (расхождение 3) — это
    // штатный исход, а не ошибка загрузки.
    this.lazyLoadQueue.push(load, () => this.intersector.isVisible(div)).catch(noop)
  }

  public processInvisibleDiv = (div: HTMLElement) => {
    return this.scrollPromise.then(async() => {
      if(this.intersector.isVisible(div)) {
        return
      }

      const thumb = div.querySelector('img, canvas')

      if(thumb) {
        thumb.classList.remove('hide')
        await doubleRaf()
      }

      if(this.intersector.isVisible(div)) {
        return
      }

      div.middlewareHelper!.clean()
    })
  }

  public add(item: GifItem, appendTo = this.element) {
    if(this.map.has(item.key)) {
      return
    }

    const div = document.createElement('div')
    div.classList.add('gif', 'grid-item')
    div.dataset.docId = item.key
    div.middlewareHelper = this.middlewareHelper.get().create()
    this.map.set(item.key, { item, div })

    appendTo.append(div)

    this.intersector.observe(div)

    wrapGifPreview(item, div, div.middlewareHelper.get())
  }

  public addBatch(items: GifItem[]) {
    items.forEach((item) => this.add(item))
  }

  public update(items: GifItem[]) {
    for(const [key] of this.map) {
      if(!items.some((item) => item.key === key)) {
        this.delete(key)
      }
    }

    this.addBatch(items)
    for(let i = 0, length = items.length; i < length; ++i) {
      const element = this.map.get(items[i].key)
      if(element) positionElementByIndex(element.div, this.element, i)
    }
  }

  public delete(key: string) {
    const element = this.map.get(key)
    if(element) {
      element.div.remove()
      element.div.middlewareHelper!.destroy()
      this.intersector.unobserve(element.div)
      this.map.delete(key)
    }
  }
}
