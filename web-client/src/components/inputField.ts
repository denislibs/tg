/**
 * Порт tweb `src/components/inputField.ts` (812502980, 904 строки) — класс поля
 * ввода `div.input-field`: contenteditable-`div.input-field-input` или (при
 * `plainText`) `<input type=text>`, рамка, плавающая подпись `label`,
 * плейсхолдер, счётчик остатка по `maxLength`, ошибка уровня поля
 * (`span.input-field-error-label[role=alert]`, 472e3e76b), исходное значение и
 * «изменено». Первый потребитель — Solid-обёртка `inputFieldTsx.solid.tsx`
 * (волна 2D: профиль, 2FA, редактор папки). Порт — в объёме НЕ-rich поля;
 * стили — `styles/tweb/_input.scss`.
 *
 * Отличия от оригинала (не портировано — у потребителей волны нет ни
 * форматирования, ни своих эмодзи в поле):
 *  1. Глобальная вставка (`init`, `insertRichTextAsHTML`, `:28-395`): разбор
 *     HTML буфера в сущности, свои эмодзи, `RichInputHandler`/BOM. Вставка в
 *     contenteditable-поле идёт браузерной по умолчанию — ОТЛОЖЕНО, О-28
 *     плана 2D (до первого потребителя с contenteditable-полем — профиль,
 *     задача 27; строку О-28 в таблицу «Отложено» вносит план, PR #285).
 *  2. Обработка своих эмодзи (`processCustomEmojisInInput`,
 *     `createCustomEmojiRendererForInput`, `insertCustomFillers`, клик по
 *     IMG-плейсхолдеру, `:434-493`, `:549-565`, `:588-608`), `can-format`
 *     (`canHaveFormatting`), `canWrapCustomEmojis`.
 *  3. Значение contenteditable — `textContent`, а не
 *     `getRichValueWithCaret(...).value` (`:747`): без п. 1-2 в поле нет ни
 *     эмодзи-узлов, ни сущностей. Черновик (`setDraftValue`, `:790-801`)
 *     кладётся строкой, без `wrapDraftText`.
 *  4. `<input>` для `plainText` собирается `createElement`, а не
 *     `innerHTML`-шаблоном (`:633-636`): у нас правило «не строить DOM из
 *     строки» (`web-client/CLAUDE.md`, «Безопасность»); атрибуты те же.
 *  5. `simulateEvent` → `new Event('input', {bubbles, cancelable})` — хелпера
 *     `dispatchEvent` у нас нет (как в `checkboxField.ts`).
 */
import labelControl from '@helpers/dom/labelControl'
import isInputEmpty from '@helpers/dom/isInputEmpty'
import replaceContent from '@helpers/dom/replaceContent'
import setInnerHTML, { setDirection } from '@helpers/dom/setInnerHTML'
import { selectElementContents } from '@shared/lib/caret'
import { i18n, _i18n, type FormatterArguments, type LangPackKey } from '@lib/langPack'

export enum InputState {
  Neutral = 0,
  Valid = 1,
  Error = 2,
}

export type InputFieldOptions = {
  placeholder?: LangPackKey
  label?: LangPackKey
  labelOptions?: FormatterArguments
  labelText?: string | DocumentFragment
  name?: string
  maxLength?: number
  showLengthOn?: number
  plainText?: true
  required?: boolean
  canBeEdited?: boolean
  validate?: () => boolean
  inputMode?: 'tel' | 'numeric'
  withLinebreaks?: boolean
  autocomplete?: string
  withBorder?: boolean
  allowStartingSpace?: boolean
  onRawInput?: (value: string) => void
}

let inputFieldErrorIdSeed = 0

export default class InputField {
  public container: HTMLElement
  public input: HTMLElement
  public label!: HTMLLabelElement
  public placeholder?: HTMLElement
  public errorLabel?: HTMLElement

  public originalValue?: string

  public required?: boolean
  public validate?: () => boolean

  public allowStartingSpace?: boolean

  private isInputHidden = false

  constructor(public options: InputFieldOptions = {}) {
    this.container = document.createElement('div')
    this.container.classList.add('input-field')

    this.required = options.required
    this.validate = options.validate

    if(options.maxLength !== undefined && options.showLengthOn === undefined) {
      options.showLengthOn = Math.min(40, Math.round(options.maxLength / 3))
    }

    const { placeholder, maxLength, showLengthOn, name, plainText, canBeEdited = true, autocomplete, withBorder, allowStartingSpace } = options
    const label = options.label || options.labelText
    this.allowStartingSpace = allowStartingSpace

    const onInputCallbacks: Array<() => void> = []
    let input: HTMLElement
    if(!plainText) {
      input = document.createElement('div')
      input.classList.add('input-field-input')
      this.container.append(input)

      input.contentEditable = '' + !!canBeEdited
      input.setAttribute('role', 'textbox')
      input.setAttribute('aria-multiline', 'true')
      // * browser & extension translators rewrite the text nodes right inside the contenteditable,
      // * so the value read back from the DOM is the translated one — with broken entities and custom emojis
      input.translate = false

      onInputCallbacks.push(() => {
        // * because if delete all characters there will br left
        const isEmpty = this.isEmpty()
        if(isEmpty) {
          input.replaceChildren()
        }

        this.setEmpty(isEmpty)
      })
    } else {
      // см. шапку, п. 4 — атрибуты те же, что у шаблона tweb `:633-636`
      const plainInput = document.createElement('input')
      plainInput.type = 'text'
      if(name) plainInput.name = name
      plainInput.autocomplete = (autocomplete ?? 'off') as AutoFill
      if(label) plainInput.required = true
      plainInput.classList.add('input-field-input')
      this.container.append(plainInput)
      input = plainInput

      onInputCallbacks.push(() => {
        const isEmpty = this.isEmpty()
        if(isEmpty) {
          (input as HTMLInputElement).value = ''
        }

        this.setEmpty(isEmpty)
      })
    }

    setDirection(input)

    if(options.inputMode) {
      input.inputMode = options.inputMode
    }

    if(placeholder) {
      this.placeholder = document.createElement('span')
      this.placeholder.classList.add('input-field-placeholder')
      this.container.append(this.placeholder)
      _i18n(this.placeholder, placeholder)
    }

    if(withBorder !== false && withBorder || label || placeholder) {
      const border = document.createElement('div')
      border.classList.add('input-field-border')
      this.container.append(border)
    }

    if(label != null) {
      this.label = document.createElement('label')
      this.setLabel()
      this.container.append(this.label)
    }

    // Give the control an accessible name by associating it with the floating
    // label (or, failing that, the placeholder). `aria-labelledby` works for
    // both the plain <input> and the contenteditable rich-text div.
    const namingElement = this.label || this.placeholder
    labelControl(input, namingElement)

    if(maxLength) {
      const labelEl = this.container.lastElementChild as HTMLLabelElement
      let showingLength = false

      const onInput = () => {
        const wasError = input.classList.contains('error')
        // * https://stackoverflow.com/a/54369605 #2 to count emoji as 1 symbol
        const inputLength = plainText ? (input as HTMLInputElement).value.length : [...this.value].length
        const diff = maxLength - inputLength
        const isError = diff < 0
        input.classList.toggle('error', isError)

        if(isError || diff <= showLengthOn!) {
          this.setLabel()
          labelEl.append(` (${maxLength - inputLength})`)
          if(!showingLength) showingLength = true
        } else if((wasError && !isError) || showingLength) {
          this.setLabel()
          showingLength = false
        }
      }

      onInputCallbacks.push(onInput)
    }

    const noLinebreaks = !options.withLinebreaks
    if(noLinebreaks && !plainText) {
      input.dataset.noLinebreaks = '1'
      input.addEventListener('keypress', (e) => {
        if(e.key === 'Enter') {
          e.preventDefault()
          return false
        }
      })
    }

    if(options.onRawInput) {
      onInputCallbacks.push(() => {
        options.onRawInput!(this.value)
      })
    }

    if(onInputCallbacks.length) {
      input.addEventListener('input', () => {
        onInputCallbacks.forEach((callback) => callback())
      })
    }

    this.input = input
    this.setEmpty(true)
  }

  public select() {
    if(!this.value) { // * avoid selecting whole empty field on iOS devices
      return
    }

    if(this.options.plainText) {
      (this.input as HTMLInputElement).select() // * select text
    } else {
      selectElementContents(this.input)
    }
  }

  public setLabel() {
    this.label.textContent = ''
    if(this.options.labelText) {
      setInnerHTML(this.label, this.options.labelText)
    } else {
      this.label.append(i18n(this.options.label!, this.options.labelOptions))
    }
    this.label.style.visibility = this.label.textContent ? 'visible' : 'hidden'
  }

  get value(): string {
    // см. шапку, п. 3
    return this.options.plainText ? (this.input as HTMLInputElement).value : (this.input.textContent ?? '')
  }

  set value(value: Parameters<typeof replaceContent>[1]) {
    this.setValueSilently(value, true)
    this.simulateInputEvent()
  }

  public simulateInputEvent() {
    this.input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })) // см. шапку, п. 5
  }

  public setValueSilently(value: Parameters<typeof replaceContent>[1], _fromSet?: boolean) {
    if(this.options.plainText) {
      (this.input as HTMLInputElement).value = value as string
    } else {
      replaceContent(this.input, value)
    }

    this.setEmpty()
  }

  private setEmpty = (empty = this.isEmpty()) => {
    [this.input, this.placeholder].filter(Boolean).forEach((el) => {
      el!.classList.toggle('is-empty', empty)
    })
  }

  public setHidden(hidden: boolean) {
    this.isInputHidden = hidden
    this.setEmpty()
  }

  public isEmpty() {
    return isInputEmpty(this.input, this.allowStartingSpace) || this.isInputHidden
  }

  public isChanged() {
    return this.value !== this.originalValue
  }

  public isValid() {
    return !this.input.classList.contains('error') &&
      (!this.validate || this.validate()) &&
      (!this.required || !this.isEmpty())
  }

  public isValidToChange() {
    return this.isValid() && this.isChanged()
  }

  public setDraftValue(value = '', silent?: boolean) {
    // см. шапку, п. 3 — без `wrapDraftText`
    if(silent) {
      this.setValueSilently(value, false)
    } else {
      this.value = value
    }
  }

  public setOriginalValue(value: InputField['originalValue'] = '', silent?: boolean) {
    this.originalValue = value
    this.setDraftValue(value, silent)
  }

  private removeErrorLabel() {
    if(!this.errorLabel) return

    const errorId = this.errorLabel.id
    const describedBy = (this.input.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .filter((id) => id && id !== errorId)

    if(describedBy.length) {
      this.input.setAttribute('aria-describedby', describedBy.join(' '))
    } else {
      this.input.removeAttribute('aria-describedby')
    }

    this.errorLabel.remove()
    this.errorLabel = undefined
    this.container.classList.remove('has-error-label')
  }

  public setState(state: InputState, label?: LangPackKey, labelOptions?: FormatterArguments) {
    const isError = !!(state & InputState.Error)

    if(label && isError) {
      if(!this.errorLabel) {
        this.errorLabel = this.container.ownerDocument.createElement('span')
        this.errorLabel.id = 'input-field-error-' + (++inputFieldErrorIdSeed)
        this.errorLabel.classList.add('input-field-error-label')
        this.errorLabel.setAttribute('role', 'alert')
        this.container.append(this.errorLabel)
      }

      this.errorLabel.replaceChildren(i18n(label, labelOptions ?? this.options.labelOptions))
      this.container.classList.add('has-error-label')

      const describedBy = new Set(
        (this.input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean),
      )
      describedBy.add(this.errorLabel.id)
      this.input.setAttribute('aria-describedby', [...describedBy].join(' '))
    } else if(label) {
      this.label.textContent = ''
      this.label.append(i18n(label, labelOptions ?? this.options.labelOptions))
      this.label.style.visibility = 'visible'
    } else {
      this.setLabel()
    }

    if((!isError || !label) && this.errorLabel) {
      this.removeErrorLabel()
    }

    if(isError) {
      this.input.setAttribute('aria-invalid', 'true')
    } else {
      this.input.removeAttribute('aria-invalid')
    }
    this.input.classList.toggle('error', isError)
    this.input.classList.toggle('valid', !!(state & InputState.Valid))
  }

  public setError(label?: LangPackKey, labelOptions?: FormatterArguments) {
    this.setState(InputState.Error, label, labelOptions)
  }

  public toggleForceFocus(enabled: boolean) {
    this.input.classList.toggle('force-focus', enabled)
  }
}
