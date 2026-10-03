// Порт tweb `src/lib/customEmoji/element.ts` (812502980, 188 строк) — `<custom-emoji-element>`:
// узел своего эмодзи (`messageEntityCustomEmoji`), которым владеет рендерер
// (`lib/customEmoji/renderer.ts`). Регистрация, класс `custom-emoji`, `docId`, `create`,
// уборка (`clear`/`destroy`/`remove`, снятие с рендерера) и `isConnected` по плейсхолдеру поля
// ввода — как у оригинала.
//
// Расхождение — следствие расхождения 1 рендерера (своё медиа у каждого узла, без общего
// холста): узел сам не плеер. У tweb он регистрируется в `animationIntersector` и рулит общим
// плеером (`player`, `syncedPlayer`, `pause`/`play`, `connectedCallback`, `readyPromise`); у нас
// медиа внутри узла рисует `wrapSticker`, и его плеер регистрируется сам — с группой рендерера.
import type { MiddlewareHelper } from '@helpers/middleware'
import type { CustomEmojiRendererElement } from '@lib/customEmoji/renderer'

export type CustomEmojiElements = Set<CustomEmojiElement>

export default class CustomEmojiElement extends HTMLElement {
  public elements?: CustomEmojiElements
  public renderer?: CustomEmojiRendererElement
  public clean?: boolean
  public placeholder?: HTMLImageElement
  public middlewareHelper?: MiddlewareHelper

  constructor() {
    super()
    this.classList.add('custom-emoji')
  }

  public get docId() {
    return this.dataset.docId!
  }

  public set docId(docId: DocId) {
    this.dataset.docId = '' + docId
  }

  public static create(docId?: DocId) {
    const element = new CustomEmojiElement()
    if(docId) element.docId = docId
    return element
  }

  public get isConnected() {
    return this.placeholder?.isConnected ?? super.isConnected
  }

  public disconnectedCallback() {
    if(this.isConnected || !this.renderer?.isSelectable) { // prepend on sibling can invoke disconnectedCallback
      return
    }

    this.clear()
  }

  public destroy() {
    this.clear()
  }

  public clear(replaceChildren = true) {
    if(this.clean) {
      return
    }

    this.clean = true

    this.middlewareHelper?.clean()

    if(this.renderer) {
      const elements = this.renderer.customEmojis.get(this.docId)
      if(elements?.delete(this) && !elements.size) {
        this.renderer.customEmojis.delete(this.docId)
      }

      if(replaceChildren) {
        // otherwise https://bugs.chromium.org/p/chromium/issues/detail?id=1144736#c27 will happen
        this.replaceChildren()
      }
    }

    this.elements = this.renderer = undefined
  }

  public remove() {
    super.remove()
    this.clear()
  }
}

if(!customElements.get('custom-emoji-element')) {
  customElements.define('custom-emoji-element', CustomEmojiElement)
}
