/**
 * Порт tweb `src/components/inputField.ts` (812502980, 904 строки) — класс поля
 * ввода `div.input-field`: contenteditable-`div.input-field-input` (rich-поле) или
 * (при `plainText`) `<input type=text>`, рамка, плавающая подпись `label`,
 * плейсхолдер, счётчик остатка по `maxLength`, ошибка уровня поля
 * (`span.input-field-error-label[role=alert]`, 472e3e76b), исходное значение и
 * «изменено». Стили — `styles/tweb/_input.scss`.
 *
 * Модель rich-поля — tweb: разметку хранит DOM поля (markup-span'ы
 * `wrapDraftText`/`applyMarkdown`), значение и сущности (UTF-16) читает из DOM
 * `getRichValueWithCaret`. Глобальная вставка (`init`) разбирает HTML буфера в
 * сущности и вставляет их размеченным DOM через `insertRichTextAsHTML`
 * (`execCommand('insertHTML')` — правка попадает в родную историю undo).
 *
 * Отличия от оригинала:
 *  1. Свои эмодзи в поле (`processCustomEmojisInInput`/`createCustomEmojiRendererForInput`,
 *     `:434-496`; перепривязка `customEmojiElement` к плейсхолдерам в `insertRichTextAsHTML`,
 *     `:56-59`, `:97-102`): слой рендерера (`lib/customEmoji/renderer.ts`, расхождение 2)
 *     ставится СОСЕДОМ поля (`input.after`), а не первым ребёнком, и хранится на поле
 *     (`customEmojiRenderer`), а не ищется `querySelector`; узел без привязки (поле
 *     заполнено разметкой, а не `wrapDraftText`) заводится по `data-doc-id` плейсхолдера.
 *  2. BOM-ветки под `USING_BOMS = false` (`:46`, `:95`, `:118`, `:618-624`) и
 *     филлеры своих эмодзи (`.input-selectable`/`[contenteditable="false"]`/`.pc`
 *     в `insertRichTextAsHTML`, `:34-44`, `:106-108`; `insertCustomFillers` в
 *     `onInput`, `:626`) мертвы и не перенесены — см. шапку `richInputHandler.ts`.
 *  3. Разметка поля собирается `createElement`, а не `innerHTML`-шаблонами
 *     (`:538`, `:636-638`): правило «не строить DOM из строки»
 *     (`web-client/CLAUDE.md`, «Безопасность»); атрибуты те же.
 *     Исключение — сама вставка: `execCommand('insertHTML')` получает
 *     сериализацию фрагмента, собранного `wrapDraftText` из узлов
 *     (`documentFragmentToHTML`), не пользовательскую строку.
 */
import labelControl from '@helpers/dom/labelControl'
import { bindActiveWindowListener } from '@helpers/appWindow'
import cancelEvent from '@helpers/dom/cancelEvent'
import simulateEvent from '@helpers/dom/dispatchEvent'
import documentFragmentToHTML from '@helpers/dom/documentFragmentToHTML'
import findUpAttribute from '@helpers/dom/findUpAttribute'
import findUpTag from '@helpers/dom/findUpTag'
import getCaretPosNew from '@helpers/dom/getCaretPosNew'
import getRichValueWithCaret from '@helpers/dom/getRichValueWithCaret'
import type { MarkdownType } from '@helpers/dom/getRichElementValue'
import isInputEmpty from '@helpers/dom/isInputEmpty'
import replaceContent from '@helpers/dom/replaceContent'
import RichInputHandler from '@helpers/dom/richInputHandler'
import setInnerHTML, { setDirection } from '@helpers/dom/setInnerHTML'
import { selectElementContents } from '@shared/lib/caret'
import type { MessageEntity } from '@layer'
import { i18n, _i18n, type FormatterArguments, type LangPackKey } from '@lib/langPack'
import { NULL_PEER_ID } from '@core/peers/peerId'
import { mergeEntities } from '@lib/richtext/entities'
import parseEntities from '@lib/richtext/parseEntities'
import wrapDraftText from '@lib/richtext/wrapDraftText'
import forEachReverse from '@helpers/array/forEachReverse'
import findAndSpliceAll from '@helpers/array/findAndSpliceAll'
import type { AnimationItemGroup } from '@components/animationIntersector'
import CustomEmojiElement, { type CustomEmojiElements } from '@lib/customEmoji/element'
import { CustomEmojiRendererElement } from '@lib/customEmoji/renderer'

type CustomEmojiPlaceholder = HTMLImageElement & { customEmojiElement?: CustomEmojiElement }
type InputWithCustomEmojiRenderer = HTMLElement & { customEmojiRenderer?: CustomEmojiRendererElement }

export async function insertRichTextAsHTML(input: HTMLElement, text: string, entities?: MessageEntity[], wrappingForPeerId?: PeerId) {
  const loadPromises: Promise<unknown>[] = []
  const fragment = wrapDraftText(text, { entities, wrappingForPeerId, loadPromises })

  if(loadPromises.length) await Promise.all(loadPromises)

  const customEmojiElements = Array.from(fragment.querySelectorAll<CustomEmojiPlaceholder>('.custom-emoji-placeholder')).map((el) => {
    el.dataset.ces = '1'
    return el.customEmojiElement!
  })

  const html = documentFragmentToHTML(fragment)

  const pre = getCaretPosNew(input)
  if(!pre.node) {
    const range = input.ownerDocument.createRange()
    let node = input.lastChild
    if(!node) {
      input.append(node = input.ownerDocument.createTextNode(''))
    }

    range.setStartAfter(node)
    range.collapse(true)
    pre.selection.removeAllRanges()
    pre.selection.addRange(range)
  }

  input.addEventListener('input', cancelEvent, { capture: true, once: true, passive: false })
  input.ownerDocument.execCommand('insertHTML', false, html)
  Array.from(input.querySelectorAll<CustomEmojiPlaceholder>('[data-ces]')).forEach((el, idx) => {
    delete el.dataset.ces
    const customEmojiElement = customEmojiElements[idx]
    if(!customEmojiElement) return
    el.customEmojiElement = customEmojiElement
    customEmojiElement.placeholder = el
  })
  simulateEvent(input, 'input')
}

function createCustomEmojiRendererForInput(input: HTMLElement) {
  const renderer = CustomEmojiRendererElement.create({
    isSelectable: true,
    animationGroup: input.dataset.animationGroup as AnimationItemGroup | undefined,
    observeResizeElement: input,
  })

  return renderer
}

export function processCustomEmojisInInput(input: InputWithCustomEmojiRenderer) {
  const placeholders = Array.from(input.querySelectorAll<CustomEmojiPlaceholder>('.custom-emoji-placeholder'))
  let renderer = input.customEmojiRenderer
  if(!renderer && placeholders.length) {
    renderer = input.customEmojiRenderer = createCustomEmojiRendererForInput(input)
    input.after(renderer)
  } else if(renderer && !placeholders.length) {
    renderer.remove()
    input.customEmojiRenderer = undefined
    return
  }

  if(!renderer) {
    return
  }

  const customEmojis: Map<DocId, CustomEmojiElements> = new Map()
  placeholders.forEach((placeholder) => {
    let customEmojiElement = placeholder.customEmojiElement
    if(!customEmojiElement) {
      customEmojiElement = placeholder.customEmojiElement = CustomEmojiElement.create(placeholder.dataset.docId)
      customEmojiElement.placeholder = placeholder
    }

    const { docId } = customEmojiElement
    let set = customEmojis.get(docId)
    if(!set) {
      customEmojis.set(docId, set = new Set())
    }

    set.add(customEmojiElement)
  })

  for(const [docId, hasSet] of renderer.customEmojis) {
    const customEmojiElements = customEmojis.get(docId)
    for(const customEmojiElement of [...hasSet]) {
      if(!customEmojiElements?.has(customEmojiElement)) {
        // the node sits in the layer, not detached as at tweb — take it out of there too
        customEmojiElement.remove()
      }
    }
  }

  renderer.add({
    addCustomEmojis: customEmojis,
    lazyLoadQueue: false,
  })
  renderer.forceRender()
}

let init: (() => void) | undefined = () => {
  // Global rich-paste for every contenteditable; follow the active window so paste into a popped-out
  // (Document PiP) input is still intercepted.
  bindActiveWindowListener((w) => w.document, 'paste', (e) => {
    const input = findUpAttribute(e.target!, 'contenteditable="true"')
    if(!input) {
      return
    }

    const noLinebreaks = !!input.dataset.noLinebreaks
    e.preventDefault()
    let text: string | undefined, entities: MessageEntity[] | undefined

    let plainText: string = e.clipboardData!.getData('text/plain').replace(/\r/g, '')
    let usePlainText = true

    let html: string = e.clipboardData!.getData('text/html') || plainText

    const filterEntity = (e: MessageEntity) => e._ === 'messageEntityEmoji' || (e._ === 'messageEntityLinebreak' && !noLinebreaks)
    if(noLinebreaks) {
      const regExp = /[\r\n]/g
      plainText = plainText.replace(regExp, '')
      html = html.replace(regExp, '')
    }

    const peerId: PeerId = input.dataset.peerId ? Number(input.dataset.peerId) : NULL_PEER_ID
    if(html.trim()) {
      html = html.replace(/<style([\s\S]*)<\/style>/, '')
      html = html.replace(/<!--([\s\S]*?)-->/g, '')
      html = html.replace('<br class="Apple-interchange-newline">', '')
      html = html.replace(/\r/g, '')
      html = html.replace(/<hr([\s\S]*?)</g, '<')

      const match = html.match(/<body>([\s\S]*)<\/body>/)
      if(match) {
        html = match[1].trim()
      }

      // * инертный документ: скрипты и обработчики не исполняются, из него читаются
      // * только текст и сущности (`getRichValueWithCaret`)
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')
      const span = doc.body || document.createElement('body')

      const richValue = getRichValueWithCaret(span, true, false)

      const canWrapCustomEmojis = !!input.dataset.canWrapCustomEmojis || !!peerId
      if(!canWrapCustomEmojis) {
        richValue.entities = richValue.entities.filter((entity) => entity._ !== 'messageEntityCustomEmoji')
      }

      const hasCustomEmoji = richValue.entities.some((entity) => entity._ === 'messageEntityCustomEmoji')

      // * fix new lines
      // * if we have custom emoji, plain text will miss plain emoji
      // * so we won't be able to fix new lines
      // * hopefully we won't have same problem from other websites
      if(!hasCustomEmoji) {
        // * first we clear all the new lines from rich value
        const richValueSplitted = richValue.value.split('')
        forEachReverse(richValueSplitted, (char, index, arr) => {
          if(char === '\n') {
            arr!.splice(index!, 1)
            richValue.entities.forEach((entity) => {
              // * entity starts after the removed char — shift it left
              if(entity.offset! > index!) {
                entity.offset! -= 1
              } else if(entity.offset! + entity.length! > index!) {
                // * removed char is inside the entity — shrink it
                entity.length! -= 1
              }
            })
          }
        })

        // * then we add new lines to rich value
        const plainTextLines = plainText.split('\n')
        const plainTextLinesLength = plainTextLines.length
        let plainTextLength = 0
        for(let lineIndex = 0; lineIndex < plainTextLinesLength - 1; ++lineIndex) {
          const line = plainTextLines[lineIndex]
          plainTextLength += line.length
          richValueSplitted.splice(plainTextLength, 0, '\n')
          richValue.entities.forEach((entity) => {
            // * plainTextLength is the index the new line is inserted at
            if(entity.offset! >= plainTextLength) {
              entity.offset! += 1
            } else if(entity.offset! + entity.length! > plainTextLength) {
              // * new line falls inside the entity — grow it
              entity.length! += 1
            }
          })

          plainTextLength += 1
        }

        richValue.value = richValueSplitted.join('')
      }

      const richTextNoWhitespace = richValue.value.replace(/\s/g, '')
      const plainTextNoWhitespace = plainText.replace(/\s/g, '')
      const richTextLength = richTextNoWhitespace.length
      const plainTextLength = plainTextNoWhitespace.length

      // * the html-derived rich value can be shorter than text/plain when the source ships markdown
      // * on text/plain (`code`, **bold**, ```fence```) but real formatting in the html — the markers
      // * are literal chars in plain yet zero-width entities in rich. requiring exact length parity
      // * there throws away perfectly good formatting and dumps the raw markdown into the input. so
      // * also accept the rich value when every one of its (non-whitespace) chars still appears, in
      // * order, inside the plain text — i.e. plain is just a marked-up rendering of the same content.
      const isRichSubsetOfPlain = () => {
        if(richTextLength > plainTextLength) {
          return false
        }

        let i = 0
        for(let j = 0; i < richTextLength && j < plainTextLength; ++j) {
          if(richTextNoWhitespace[i] === plainTextNoWhitespace[j]) {
            ++i
          }
        }

        return i === richTextLength
      }

      if(richTextLength === plainTextLength || hasCustomEmoji || (richValue.entities.length && isRichSubsetOfPlain())) {
        text = richValue.value
        entities = richValue.entities
        usePlainText = false

        let entities2 = parseEntities(text)
        entities2 = entities2.filter(filterEntity)
        entities = mergeEntities(entities, entities2)
      }
    }

    if(usePlainText) {
      text = plainText
      entities = parseEntities(text)
      entities = entities.filter(filterEntity)
    }

    if(entities?.length) {
      const ignoreEntities = new Set<MessageEntity['_']>([
        'messageEntityPhone',
        // * wrapDraftText renders line breaks from the text itself; passing explicit linebreak
        // * entities makes wrapRichText slice the one before a blockquote (losing a \n on e.g.
        // * `text\n\nquote`). Strip them so paste matches the edit/draft path.
        'messageEntityLinebreak',
      ])
      findAndSpliceAll(entities, (entity) => ignoreEntities.has(entity._))
    }

    void insertRichTextAsHTML(input, text!, entities, peerId)
  })

  init = undefined
}

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
  /** что тултип разметки (Б-33) предложит в поле — атрибут `can-format`; тип — tweb `MarkupTooltipTypes` (`markupTooltip.ts:22`) */
  canHaveFormatting?: Array<Extract<MarkdownType, 'bold' | 'italic' | 'underline' | 'strikethrough' | 'monospace' | 'spoiler' | 'quote' | 'link' | 'date'>>
  canWrapCustomEmojis?: boolean
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

    const { placeholder, maxLength, showLengthOn, name, plainText, canBeEdited = true, autocomplete, withBorder, allowStartingSpace, canHaveFormatting, canWrapCustomEmojis } = options
    const label = options.label || options.labelText
    this.allowStartingSpace = allowStartingSpace

    const onInputCallbacks: Array<() => void> = []
    let input: HTMLElement
    if(!plainText) {
      if(init) {
        init()
      }

      input = document.createElement('div')
      input.classList.add('input-field-input')
      this.container.append(input)

      input.contentEditable = '' + !!canBeEdited
      input.setAttribute('role', 'textbox')
      input.setAttribute('aria-multiline', 'true')
      // * browser & extension translators rewrite the text nodes right inside the contenteditable,
      // * so the value read back from the DOM is the translated one — with broken entities and custom emojis
      input.translate = false

      RichInputHandler.getInstance()

      // * клик по картинке (эмодзи-картинка, плейсхолдер своего эмодзи) ставит каретку
      // * до или после неё — по половине, в которую попал клик
      input.addEventListener('mousedown', (e) => {
        const selection = input.ownerDocument.defaultView!.getSelection()!
        if(!selection.isCollapsed) {
          return
        }

        const placeholder = findUpTag(e.target!, 'IMG')
        if(!placeholder) {
          return
        }

        const rect = placeholder.getBoundingClientRect()
        const centerX = rect.left + rect.width / 2
        const focusOnNext = e.clientX >= centerX

        const range = input.ownerDocument.createRange()
        range.setStartAfter(focusOnNext ? placeholder : placeholder.previousSibling ?? placeholder)
        selection.removeAllRanges()
        selection.addRange(range)
      })

      if(canHaveFormatting) {
        input.setAttribute('can-format', canHaveFormatting.join(','))
      }

      onInputCallbacks.push(() => {
        // * because if delete all characters there will br left
        const isEmpty = this.isEmpty()
        if(isEmpty) {
          input.replaceChildren()
        }

        this.setEmpty(isEmpty)

        // tweb :628
        processCustomEmojisInInput(input)
      })
    } else {
      // см. шапку, п. 3 — атрибуты те же, что у шаблона tweb `:636-638`
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
        const inputLength = plainText ? (input as HTMLInputElement).value.length : [...getRichValueWithCaret(input, false, false).value].length
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

    if(canWrapCustomEmojis) input.dataset.canWrapCustomEmojis = '1'

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
    return this.options.plainText ? (this.input as HTMLInputElement).value : getRichValueWithCaret(this.input, false, false).value
  }

  set value(value: Parameters<typeof replaceContent>[1]) {
    this.setValueSilently(value, true)
    this.simulateInputEvent()
  }

  public simulateInputEvent() {
    simulateEvent(this.input, 'input')
  }

  public setValueSilently(value: Parameters<typeof replaceContent>[1], _fromSet?: boolean) {
    if(this.options.plainText) {
      (this.input as HTMLInputElement).value = value as string
    } else {
      replaceContent(this.input, value)
      processCustomEmojisInInput(this.input)
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
    let _value: Parameters<typeof replaceContent>[1] = value
    if(!this.options.plainText) {
      _value = wrapDraftText(value)
    }

    if(silent) {
      this.setValueSilently(_value, false)
    } else {
      this.value = _value
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
