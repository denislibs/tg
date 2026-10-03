/**
 * Порт tweb `src/components/inputFieldAnimated.ts` (812502980) — rich-поле с
 * анимированной высотой: невидимый двойник `inputFake` (тот же класс, `height:
 * auto`) повторяет содержимое поля, его `scrollHeight` — целевая высота;
 * переход длится `50 · ln|Δ|` мс, на время — класс `is-changing-height`.
 * Потребитель — поле сообщения `ChatInput` (`components/chat/input.ts`).
 *
 * Отличия от оригинала:
 *  1. Двойник наполняется клонами узлов поля, а не `inputFake.innerHTML =
 *     input.innerHTML` (`:102-112`): правило «не присваивать разметку в DOM»
 *     (`web-client/CLAUDE.md`, «Безопасность»). Вырезание
 *     `custom-emoji-renderer-element`/содержимого `custom-emoji-element` (`:103-105`)
 *     не нужно — этих элементов в поле нет (см. шапку `inputField.ts`, п. 1), а
 *     замена BOM-span'ов и `<br>` под `USING_BOMS = false` (`:107-109`) мертва.
 *  2. Переход — наш `core/dom/setTransition` (порт `components/singleTransition.ts`).
 */
import InputField, { type InputFieldOptions } from '@components/inputField'
import { setTransition } from '@core/dom/setTransition'

type HeightTrackedInput = HTMLElement & { oldHeight?: number, newHeight?: number }

export default class InputFieldAnimated extends InputField {
  public inputFake: HTMLElement
  public onChangeHeight?: (height: number) => void
  // Owned by the consumer via setMaxHeight(). Single source of truth: the
  // same number drives both `input.style.maxHeight` and the scrollHeight
  // clamp in onFakeInput(), so the height we report upstream (e.g. via
  // `--chat-input-height-surplus`) matches the visible input.
  private maxHeight: number | undefined

  constructor(options?: InputFieldOptions) {
    super(options)

    this.input.addEventListener('input', () => {
      this.updateInnerHTML()
      this.onFakeInput()
    })

    this.input.classList.add('scrollable', 'scrollable-y', 'no-scrollbar')
    this.inputFake = document.createElement('div')
    this.inputFake.contentEditable = 'true'
    this.inputFake.translate = false // * keep the height mirror in sync with the untranslated input
    this.inputFake.tabIndex = -1
    this.inputFake.setAttribute('aria-hidden', 'true')
    this.inputFake.className = this.input.className + ' input-field-input-fake'
  }

  public setMaxHeight(value: number | undefined) {
    if(this.maxHeight === value) return
    this.maxHeight = value
    this.input.style.maxHeight = value !== undefined ? value + 'px' : ''
    this.onFakeInput()
  }

  public onFakeInput(setHeight = true, noAnimation?: boolean) {
    const { scrollHeight } = this.inputFake
    const newHeight = this.maxHeight !== undefined ? Math.min(scrollHeight, this.maxHeight) : scrollHeight

    noAnimation ??= !this.input.isContentEditable

    const currentHeight = +this.input.style.height.replace('px', '')
    if(currentHeight === newHeight) {
      return
    }

    const TRANSITION_DURATION_FACTOR = 50
    const transitionDuration = noAnimation ? 0 : Math.round(
      TRANSITION_DURATION_FACTOR * Math.log(Math.abs(newHeight - currentHeight)),
    )

    this.input.style.transitionDuration = `${transitionDuration}ms`

    const input = this.input as HeightTrackedInput
    if(setHeight) {
      this.onChangeHeight?.(newHeight)
      input.style.height = newHeight ? newHeight + 'px' : ''
      input.oldHeight = input.newHeight
      input.newHeight = newHeight

      Array.from(input.querySelectorAll('.quote-like')).forEach((element) => {
        const scrollHeight = element.scrollHeight
        const computedStyle = getComputedStyle(element)
        const lineHeight = parseFloat(computedStyle.lineHeight)
        const paddingTop = parseFloat(computedStyle.paddingTop)
        const paddingBottom = parseFloat(computedStyle.paddingBottom)
        const lines = (scrollHeight - paddingTop - paddingBottom) / lineHeight
        element.classList.toggle('can-send-collapsed', lines > 3)
      })
    }

    const className = 'is-changing-height'
    setTransition({
      element: input,
      className,
      forwards: true,
      duration: transitionDuration,
      onTransitionEnd: () => {
        input.classList.remove(className)
        input.oldHeight = input.newHeight
      },
    })
  }

  /** см. шапку, п. 1 — имя метода tweb сохранено */
  protected updateInnerHTML() {
    this.inputFake.replaceChildren(...Array.from(this.input.childNodes, (node) => node.cloneNode(true)))
  }

  public setValueSilently(value: Parameters<InputField['setValueSilently']>[0], fromSet?: boolean) {
    super.setValueSilently(value, fromSet)

    this.updateInnerHTML()
    if(!fromSet) {
      this.onFakeInput()
    }
  }
}
