// Порт tweb `src/lib/customEmoji/renderer.ts` (812502980, 1566 строк) — `CustomEmojiRendererElement`,
// владелец своих эмодзи (`CustomEmojiElement`) одного контейнера: сетка категории эмодзи-дропдауна
// (`emoticonsDropdown/tabs/emoji.ts`) и поле ввода (`components/inputField.ts`,
// `processCustomEmojisInInput`). Форма и API оригинала: `create({animationGroup, customEmojiSize,
// middleware, isSelectable, observeResizeElement})`, `customEmojis` (docId → узлы), `add({addCustomEmojis,
// onlyThumb, lazyLoadQueue})`, `forceRender`, `middlewareHelper`, класс `custom-emoji-renderer`.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Нет общего холста. У tweb рендерер рисует кадры всех своих эмодзи на одном `canvas`
//     (`custom-emoji-canvas`, offscreen-композитор `lib/customEmoji/compositor.worker.ts`,
//     синхронные плееры одного документа, `getOffsets`/`render`), а узлы пусты. У нас каждый узел
//     несёт своё медиа — `wrapSticker` (`components/wrappers/sticker.ts`) по id документа (он же
//     id медиа): наш `wrapSticker` берёт один контейнер, а не массив узлов, и не знает своих
//     эмодзи (`isCustomEmoji`, `syncedVideo`, `textColor`). Отсюда нет `clearCanvas`,
//     `setDimensionsFromRect`/`ignoreSettingDimensions`, `textColored`/`setTextColor` (перекраски
//     эмодзи цветом текста нет), `playersSynced`/`lastPausedVideo`.
//  2. Поле ввода (`isSelectable`): в поле стоят плейсхолдеры `img.custom-emoji-placeholder`, а
//     узлы лежат в слое рендерера (`custom-emoji-renderer.is-selectable`), который стоит
//     СОСЕДОМ поля, а не первым его ребёнком: узлы с медиа внутри contenteditable попали бы в
//     значение и пустоту поля (`getRichValueWithCaret`, `isInputEmpty`); у tweb узлы
//     отсоединены, в поле лежит только холст. `forceRender` ставит каждый узел на место его
//     плейсхолдера и зовётся на прокрутке и изменении размера поля (`observeResizeElement`).
//  3. Документ не запрашивается (`getCachedCustomEmojiDocuments`/`getCustomEmojiDocuments`):
//     файл берётся по id, вид (lottie/webm/статика) — по `Content-Type` (`wrappers/stickerContent`).
//  4. Общая очередь `globalLazyLoadQueue` — наша `core/lazyLoadQueue`, без `div`-адресации.
import type { AnimationItemGroup } from '@components/animationIntersector'
import wrapSticker from '@components/wrappers/sticker'
import { createLazyLoadQueue, type LazyLoadQueue } from '@core/lazyLoadQueue'
import type { MediaSize } from '@helpers/mediaSize'
import mediaSizes from '@helpers/mediaSizes'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import noop from '@helpers/noop'
import appEmojiManager from '@lib/appManagers/appEmojiManager'
import type CustomEmojiElement from '@lib/customEmoji/element'
import type { CustomEmojiElements } from '@lib/customEmoji/element'

const globalLazyLoadQueue = createLazyLoadQueue()

export type CustomEmojiRendererElementOptions = Partial<{
  animationGroup: AnimationItemGroup
  customEmojiSize: MediaSize
  isSelectable: boolean
  middleware: Middleware
  observeResizeElement: HTMLElement
}>

export class CustomEmojiRendererElement extends HTMLElement {
  public static globalLazyLoadQueue: LazyLoadQueue = globalLazyLoadQueue

  public customEmojis: Map<DocId, CustomEmojiElements>
  public animationGroup: AnimationItemGroup
  public size!: MediaSize
  public isSelectable?: boolean
  public middlewareHelper!: MiddlewareHelper
  public auto?: boolean
  public destroyed?: boolean

  public observeResizeElement?: HTMLElement
  private resizeObserver?: ResizeObserver
  private observedParent?: HTMLElement

  constructor() {
    super()

    this.classList.add('custom-emoji-renderer')
    this.customEmojis = new Map()
    this.animationGroup = 'EMOJI'
  }

  public connectedCallback() {
    if(!this.isSelectable) {
      return
    }

    // * the field scrolls and reflows under the layer - keep the emojis on their placeholders
    const parent = this.observeResizeElement ?? this.parentElement
    if(parent && parent !== this.observedParent) {
      this.disconnectParent()
      this.observedParent = parent
      parent.addEventListener('scroll', this.forceRender, { passive: true })
      if(typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(this.forceRender)
        this.resizeObserver.observe(parent)
      }
    }

    this.forceRender()
  }

  public disconnectedCallback() {
    if(this.isConnected) {
      return
    }

    this.disconnectParent()
    if(this.auto) {
      this.destroy()
    }
  }

  private disconnectParent() {
    this.observedParent?.removeEventListener('scroll', this.forceRender)
    this.resizeObserver?.disconnect()
    this.resizeObserver = this.observedParent = undefined
  }

  public destroy() {
    if(this.destroyed) {
      return
    }

    this.destroyed = true
    this.disconnectParent()
    this.customEmojis.forEach((elements) => {
      elements.forEach((element) => {
        element.clear()
      })
    })
    this.customEmojis.clear()
    this.middlewareHelper.destroy()
  }

  public remove() {
    super.remove()
    this.destroy()
  }

  /**
   * Places every emoji of a selectable renderer over its placeholder in the field (расхождение 2);
   * a grid renderer's emojis already sit in their cells.
   */
  public forceRender = () => {
    if(!this.isSelectable || !this.isConnected) {
      return
    }

    const rendererRect = this.getBoundingClientRect()
    this.customEmojis.forEach((elements) => {
      elements.forEach((element) => {
        const { placeholder } = element
        if(!placeholder?.isConnected) {
          return
        }

        const rect = placeholder.getBoundingClientRect()
        element.style.transform = `translate(${rect.left - rendererRect.left}px, ${rect.top - rendererRect.top}px)`
        element.style.width = rect.width + 'px'
        element.style.height = rect.height + 'px'
      })
    })
  }

  private wrap({ docId, elements, onlyThumb, lazyLoadQueue }: {
    docId: DocId
    elements: CustomEmojiElements
    onlyThumb?: boolean
    lazyLoadQueue?: LazyLoadQueue | false
  }) {
    const { size } = this
    const queue = lazyLoadQueue === false ? undefined : (lazyLoadQueue || globalLazyLoadQueue)

    // tweb `wrapSticker({isCustomEmoji})` ставит узлу эмодзи документа (`data-sticker-emoji`) —
    // по нему узел читается обратно в текст (`getEmojiFromElement`)
    if([...elements].some((element) => !element.dataset.stickerEmoji)) {
      void appEmojiManager.getCustomEmojiDocument(docId).then((doc) => {
        if(!doc?.stickerEmojiRaw) return
        elements.forEach((element) => {
          if(!element.dataset.stickerEmoji) element.dataset.stickerEmoji = doc.stickerEmojiRaw
        })
      })
    }

    elements.forEach((element) => {
      if(this.isSelectable && element.parentElement !== this) {
        this.append(element)
      }

      wrapSticker({
        mediaId: Number(docId),
        div: element,
        width: size.width,
        height: size.height,
        play: !onlyThumb,
        loop: true,
        onlyThumb,
        group: this.animationGroup,
        lazyLoadQueue: queue,
        middleware: element.middlewareHelper!.get(),
      }).render.catch(noop)
    })
  }

  public add({
    addCustomEmojis,
    lazyLoadQueue,
    onlyThumb,
  }: {
    addCustomEmojis: Map<DocId, CustomEmojiElements>
    lazyLoadQueue?: LazyLoadQueue | false
    onlyThumb?: boolean
  }) {
    const middleware = this.middlewareHelper.get()

    addCustomEmojis.forEach((addElements, docId) => { // prevent adding old elements
      let elements = this.customEmojis.get(docId)
      if(!elements) this.customEmojis.set(docId, elements = new Set())

      for(const el of addElements) {
        if(elements.has(el) && !el.clean) {
          addElements.delete(el)
        } else {
          el.clean = false
          el.renderer = this
          el.elements = elements
          el.middlewareHelper = middleware.create()
          elements.add(el)
        }
      }

      if(!addElements.size) {
        addCustomEmojis.delete(docId)
      }
    })

    addCustomEmojis.forEach((elements, docId) => {
      this.wrap({ docId, elements, onlyThumb, lazyLoadQueue })
    })

    this.forceRender()
  }

  public static create(options: CustomEmojiRendererElementOptions) {
    const renderer = new CustomEmojiRendererElement()
    if(options.animationGroup) renderer.animationGroup = options.animationGroup
    renderer.size = options.customEmojiSize || mediaSizes.active.customEmoji
    renderer.isSelectable = options.isSelectable
    renderer.observeResizeElement = options.observeResizeElement
    if(options.isSelectable) {
      renderer.classList.add('is-selectable')
    }

    const middleware = options.middleware
    if(middleware) {
      renderer.middlewareHelper = middleware.create()
      renderer.middlewareHelper.get().onDestroy(() => {
        renderer.destroy()
      })
    } else {
      renderer.auto = true
      renderer.middlewareHelper = getMiddleware()
    }

    return renderer
  }
}

export type CustomEmojiRenderer = CustomEmojiRendererElement

if(!customElements.get('custom-emoji-renderer-element')) {
  customElements.define('custom-emoji-renderer-element', CustomEmojiRendererElement)
}

export type { CustomEmojiElement }
