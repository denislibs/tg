// Порт tweb `src/components/chat/markupTooltip.ts` (812502980) — тултип разметки
// над выделением в rich-поле: жирный, курсив, подчёркнутый, зачёркнутый,
// моноширинный, спойлер, цитата, ссылка (с полем ввода адреса). Синглтон в
// корне оверлеев; слушает `selectionchange` документа (`handleSelection`, его
// ставит `appImManager`). Кнопки зовут `applyMarkdown` (`helpers/dom/markdown.ts`),
// тот после правки — `setActiveMarkupButton`; Ctrl/Cmd+K — `showLinkEditor`.
// Пачка П-6, Б-33. Стили — `styles/tweb/_chatMarkupTooltip.scss`.
//
// Расхождения с оригиналом:
//  1. Кнопки даты (`['date', 'calendar']`, `showDatePicker`, статический
//     `showDatePickerPopup`) нет: сущность `messageEntityFormattedDate` бэкенд не
//     принимает (`backend/internal/domain/mtentity.go`, «нет предмета») — дата
//     пропадала бы на отправке. Б-139.
import ButtonIcon from '@components/buttonIcon'
import { replaceButtonIcon } from '@components/button'
import { bindActiveWindowListener, getAppWindow, getOverlayRoot } from '@helpers/appWindow'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { IS_APPLE, IS_MOBILE } from '@environment/userAgent'
import appNavigationController from '@core/navigation/appNavigationController'
import { _i18n } from '@lib/langPack'
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import isSelectionEmpty from '@helpers/dom/isSelectionEmpty'
import type { MarkdownType } from '@helpers/dom/getRichElementValue'
import getVisibleRect from '@helpers/dom/getVisibleRect'
import clamp from '@helpers/number/clamp'
import { matchUrl, normalizeUrlProtocol } from '@lib/richtext/url'
import getMarkupInSelection from '@helpers/dom/getMarkupInSelection'
import { applyMarkdown } from '@helpers/dom/markdown'
import findUpClassName from '@helpers/dom/findUpClassName'
import overlayCounter from '@helpers/overlayCounter'
import type { IconName } from '@core/tgico-icons'

export type MarkupTooltipTypes = Extract<MarkdownType, 'bold' | 'italic' | 'underline' | 'strikethrough' | 'monospace' | 'spoiler' | 'quote' | 'link' | 'date'>

export default class MarkupTooltip {
  private static INSTANCE: MarkupTooltip
  public static DISPLAY_MARKUP_PARTLY = false

  public container!: HTMLElement
  private wrapper!: HTMLElement
  private buttons: { [type in MarkupTooltipTypes]?: HTMLElement } = {}
  private buttonIcons: Partial<{ [type in MarkupTooltipTypes]: { inactive: IconName, active: IconName } }> = {}
  private linkBackButton!: HTMLElement
  private linkApplyButton!: HTMLButtonElement
  private linkDelimiter!: HTMLElement
  private hideTimeout?: number
  private addedListener = false
  private waitingForMouseUp = false
  private linkInput!: HTMLInputElement
  private savedRange?: Range
  private mouseUpCounter: number = 0
  private input?: HTMLElement
  private linkInputFocusTimeout?: number

  public static getInstance() {
    return this.INSTANCE ||= new MarkupTooltip()
  }

  private init: (() => void) | null = () => {
    this.container = document.createElement('div')
    this.container.classList.add('markup-tooltip', 'z-depth-1', 'hide')

    this.wrapper = document.createElement('div')
    this.wrapper.classList.add('markup-tooltip-wrapper')

    const tools1 = document.createElement('div')
    const tools2 = document.createElement('div')
    tools1.classList.add('markup-tooltip-tools', 'markup-tooltip-tools-regular')
    tools2.classList.add('markup-tooltip-tools', 'markup-tooltip-tools-link')

    // * расхождение 1: без `['date', 'calendar']`
    const arr: Array<MarkupTooltipTypes | [MarkupTooltipTypes, IconName] | [MarkupTooltipTypes, IconName, IconName]> = [
      'bold',
      'italic',
      'underline',
      'strikethrough',
      'monospace',
      'spoiler',
      ['quote', 'blockquote'],
      'link',
    ]
    arr.forEach((c) => {
      const type = typeof(c) === 'string' ? c : c[0]
      const inactiveIcon = (typeof(c) === 'string' ? c : c[1]) as IconName
      const activeIcon = typeof(c) === 'string' ? undefined : c[2]
      if(activeIcon !== undefined && activeIcon !== inactiveIcon) {
        this.buttonIcons[type] = { inactive: inactiveIcon, active: activeIcon }
      }

      const button = ButtonIcon(inactiveIcon, { noRipple: true })
      tools1.append(this.buttons[type] = button)

      if(type === 'link') {
        attachClickEvent(button, (e) => {
          cancelEvent(e)
          this.showLinkEditor()
          this.cancelClosening()
        })
      } else {
        button.addEventListener('mousedown', (e) => {
          cancelEvent(e)
          applyMarkdown({ input: this.input!, type })
          this.cancelClosening()
        })
      }
    })

    this.linkBackButton = ButtonIcon('left', { noRipple: true })
    this.linkInput = document.createElement('input')
    _i18n(this.linkInput, 'MarkupTooltip.LinkPlaceholder', undefined, 'placeholder')
    this.linkInput.classList.add('input-clear')
    this.linkInput.addEventListener('keydown', (e) => {
      const valid = !this.linkInput.value.length || !!matchUrl(this.linkInput.value)

      if(e.key === 'Enter') {
        if(!valid) {
          if(this.linkInput.classList.contains('error')) {
            this.linkInput.classList.remove('error')
            void this.linkInput.offsetLeft // reflow
          }

          this.linkInput.classList.add('error')
        } else {
          this.applyLink(e)
        }
      }
    })

    this.linkInput.addEventListener('input', () => {
      const valid = this.isLinkValid()

      this.linkInput.classList.toggle('is-valid', valid)
      this.linkInput.classList.remove('error')
    })

    this.linkBackButton.addEventListener('mousedown', (e) => {
      cancelEvent(e)
      this.container.classList.remove('is-link')
      this.clearLinkInputFocusTimeout()
      this.resetSelection()
      this.setTooltipPosition()
      this.cancelClosening()
    })

    this.linkApplyButton = ButtonIcon('check markup-tooltip-link-apply', { noRipple: true }) as HTMLButtonElement
    this.linkApplyButton.addEventListener('mousedown', (e) => {
      this.applyLink(e)
    })

    const applyDiv = document.createElement('div')
    applyDiv.classList.add('markup-tooltip-link-apply-container')

    const delimiter1 = document.createElement('span')
    const delimiter2 = document.createElement('span')
    const delimiter3 = document.createElement('span')
    delimiter1.classList.add('markup-tooltip-delimiter')
    delimiter2.classList.add('markup-tooltip-delimiter')
    delimiter3.classList.add('markup-tooltip-delimiter')
    tools1.insertBefore(delimiter1, this.buttons.link!)
    this.linkDelimiter = delimiter1
    applyDiv.append(delimiter3, this.linkApplyButton)
    tools2.append(this.linkBackButton, delimiter2, this.linkInput, applyDiv)

    this.wrapper.append(tools1, tools2)
    this.container.append(this.wrapper)
    getOverlayRoot().append(this.container)

    window.addEventListener('resize', () => {
      this.hide()
    })
  }

  private clearLinkInputFocusTimeout() {
    if(this.linkInputFocusTimeout) {
      clearTimeout(this.linkInputFocusTimeout)
      this.linkInputFocusTimeout = undefined
    }
  }

  public showLinkEditor() {
    if(!this.container || !this.container.classList.contains('is-visible')) { // * if not inited yet (Ctrl+A + Ctrl+K)
      this.show()
    }

    const button = this.buttons.link!
    this.container.classList.add('is-link')

    this.saveRange()

    const markup = getMarkupInSelection(['link'])
    const anchor = markup.link.elements.find((element) => element.tagName === 'A') as HTMLAnchorElement | undefined

    if(button.classList.contains('active') && anchor) {
      this.linkInput.value = anchor.href
    } else {
      this.linkInput.value = ''
    }

    this.setTooltipPosition(true)

    this.linkInputFocusTimeout = window.setTimeout(() => {
      this.linkInputFocusTimeout = undefined
      this.linkInput.focus() // !!! instant focus will break animation
    }, 200)
    this.linkInput.classList.toggle('is-valid', this.isLinkValid())
  }

  private applyLink(e: Event) {
    cancelEvent(e)
    this.resetSelection()
    let url = this.linkInput.value
    if(url) {
      url = normalizeUrlProtocol(url)
    }

    applyMarkdown({ input: this.input!, type: 'link', href: url })
    setTimeout(() => {
      this.hide()
    }, 0)
  }

  private isLinkValid() {
    return !this.linkInput.value.length || !!matchUrl(this.linkInput.value)
  }

  private resetSelection(range: Range | undefined = this.savedRange) {
    const selection = window.getSelection()!
    selection.removeAllRanges()
    if(range) selection.addRange(range)
    this.input?.focus()
  }

  private saveRange(selection: Selection = document.getSelection()!) {
    return this.savedRange = selection.getRangeAt(0)
  }

  public hide() {
    if(this.init) return

    this.input = undefined
    this.container.classList.remove('is-visible')
    document.removeEventListener('mouseup', this.onMouseUpSingle)
    this.waitingForMouseUp = false

    appNavigationController.removeByType('markup')

    if(this.hideTimeout) clearTimeout(this.hideTimeout)
    this.clearLinkInputFocusTimeout()
    this.hideTimeout = window.setTimeout(() => {
      this.hideTimeout = undefined
      this.container.classList.add('hide')
      this.container.classList.remove('is-link')
    }, 200)
  }

  public getActiveMarkupButton() {
    const currentMarkups: Set<HTMLElement> = new Set()

    const types = Object.keys(this.buttons) as MarkupTooltipTypes[]
    const markup = getMarkupInSelection(types)
    types.forEach((type) => {
      const { partly, fully } = markup[type]
      if(MarkupTooltip.DISPLAY_MARKUP_PARTLY ? partly : fully) {
        currentMarkups.add(this.buttons[type]!)
      }
    })

    return [...currentMarkups]
  }

  public setActiveMarkupButton() {
    if(this.init) return // * у tweb до первого показа `buttons` пуст и цикл ниже — пустой

    const activeButtons = this.getActiveMarkupButton()

    for(const i in this.buttons) {
      const type = i as MarkupTooltipTypes
      const button = this.buttons[type]!
      const isActive = activeButtons.includes(button)
      const wasActive = button.classList.contains('active')
      button.classList.toggle('active', isActive)

      const icons = this.buttonIcons[type]
      if(icons && wasActive !== isActive) {
        replaceButtonIcon(button, isActive ? icons.active : icons.inactive)
      }
    }
  }

  private setTooltipPosition(isLinkToggle = false) {
    const selection = document.getSelection()!
    const range = selection.getRangeAt(0)

    const rowsWrapper = (this.input && (
      findUpClassName(this.input, 'simple-message-input-container') ||
      findUpClassName(this.input, 'rows-wrapper') ||
      findUpClassName(this.input, 'input-message-container') ||
      findUpClassName(this.input, 'input-field') ||
      this.input.closest<HTMLElement>('[data-markup-tooltip-host]')
    )) || undefined

    if(!rowsWrapper) return

    const currentTools = (this.container.classList.contains('is-link') ?
      this.wrapper.lastElementChild :
      this.wrapper.firstElementChild) as HTMLElement
    const bodyRect = getOverlayRoot().getBoundingClientRect()
    const selectionRect = range.getBoundingClientRect()
    const inputRect = rowsWrapper.getBoundingClientRect()
    const sizesRect = currentTools.getBoundingClientRect()

    this.container.style.maxWidth = inputRect.width + 'px'

    const visibleRect = getVisibleRect(
      undefined as unknown as HTMLElement,
      this.input!,
      false,
      selectionRect,
    )

    const { newHeight = 0, oldHeight = newHeight } = this.input as HTMLElement & { newHeight?: number, oldHeight?: number }

    if(!visibleRect) { // can be when modifying quote that's not in visible area
      return
    }

    const selectionTop = visibleRect.rect.top + (bodyRect.top * -1)

    const top = selectionTop - sizesRect.height - 8 + (oldHeight - newHeight)

    const minX = inputRect.left
    const maxX = (inputRect.left + inputRect.width) - Math.min(inputRect.width, sizesRect.width)
    let left: number
    if(isLinkToggle) {
      const containerRect = this.container.getBoundingClientRect()
      left = clamp(containerRect.left, minX, maxX)
    } else {
      const x = selectionRect.left + (selectionRect.width - sizesRect.width) / 2
      left = clamp(x, minX, maxX)
    }

    this.container.style.transform = `translate3d(${left}px, ${top}px, 0)`
  }

  public show() {
    if(this.init) {
      this.init()
      this.init = null
    }

    if(isSelectionEmpty()) {
      this.hide()
      return
    }

    if(this.hideTimeout !== undefined) {
      clearTimeout(this.hideTimeout)
    }

    if(this.container.classList.contains('is-visible')) {
      return
    }

    this.container.classList.toggle('night', overlayCounter.isDarkOverlayActive)

    this.setActiveMarkupButton()

    const canFormat = this.input?.getAttribute('can-format')
    const allowedTypes = canFormat ?
      new Set(canFormat.split(',').filter(Boolean) as MarkupTooltipTypes[]) :
      null
    ;(Object.keys(this.buttons) as MarkupTooltipTypes[]).forEach((type) => {
      const hidden = !!allowedTypes && !allowedTypes.has(type)
      this.buttons[type]!.classList.toggle('hide', hidden)
      if(type === 'link') {
        this.linkDelimiter.classList.toggle('hide', hidden)
      }
    })

    this.container.classList.remove('is-link')
    const isFirstShow = this.container.classList.contains('hide')
    if(isFirstShow) {
      this.container.classList.remove('hide')
      this.container.classList.add('no-transition')
    }

    this.setTooltipPosition()

    if(isFirstShow) {
      void this.container.offsetLeft // reflow
      this.container.classList.remove('no-transition')
    }

    this.container.classList.add('is-visible')

    if(!IS_MOBILE) {
      appNavigationController.pushItem({
        type: 'markup',
        onPop: () => {
          this.hide()
        },
      })
    }
  }

  private onMouseUpSingle = (e?: Event) => {
    this.waitingForMouseUp = false

    if(IS_TOUCH_SUPPORTED) {
      if(e) cancelEvent(e)
      if(this.mouseUpCounter++ === 0) {
        this.resetSelection()
      } else {
        this.hide()
        return
      }
    }

    this.show()
  }

  public setMouseUpEvent() {
    if(this.waitingForMouseUp) return
    this.waitingForMouseUp = true

    // Active window's document so text-selection formatting still works in a Document PiP window.
    getAppWindow().document.addEventListener('mouseup', this.onMouseUpSingle, { once: true })
  }

  public cancelClosening() {
    if(IS_TOUCH_SUPPORTED && !IS_APPLE) {
      getAppWindow().document.removeEventListener('mouseup', this.onMouseUpSingle)
      getAppWindow().document.addEventListener('mouseup', (e) => {
        cancelEvent(e)
        this.mouseUpCounter = 1
        this.waitingForMouseUp = false
        this.setMouseUpEvent()
      }, { once: true })
    }
  }

  public canFormatInput(input: Element | null) {
    return !!input && (input.classList.contains('input-message-input') || !!input.getAttribute('can-format'))
  }

  public handleSelection() {
    if(this.addedListener) return
    this.addedListener = true
    // selectionchange/beforeinput are document-level — follow the active window so text-selection
    // formatting works in a Document PiP window (the events fire on the PiP document there).
    bindActiveWindowListener((w) => w.document, 'selectionchange', () => {
      const doc = getAppWindow().document
      if(this.linkInputFocusTimeout) { // * if it soon will be focused, ignore the event because of click event
        return
      }

      if(doc.activeElement === this.linkInput) {
        return
      }

      const activeElement = doc.activeElement as HTMLElement
      if(this.input ? activeElement !== this.input : !this.canFormatInput(activeElement)) {
        this.hide()
        return
      }

      const selection = doc.getSelection()
      if(isSelectionEmpty(selection)) {
        this.hide()
        return
      }

      this.input = activeElement

      if(IS_TOUCH_SUPPORTED) {
        if(IS_APPLE) {
          this.show()
          this.setTooltipPosition() // * because can skip this in .show();
        } else {
          if(this.mouseUpCounter === 2) {
            this.mouseUpCounter = 0
            return
          }

          this.saveRange(selection!)
          this.setMouseUpEvent()
        }
      } else if(this.container && this.container.classList.contains('is-visible')) {
        this.setActiveMarkupButton()
        this.setTooltipPosition()
      } else if(this.input.matches(':active')) {
        this.setMouseUpEvent()
      } else {
        this.show()
      }
    })

    bindActiveWindowListener((w) => w.document, 'beforeinput', (e) => {
      const inputType = (e as InputEvent).inputType
      if(inputType === 'historyRedo' || inputType === 'historyUndo') {
        e.target!.addEventListener('input', () => this.setActiveMarkupButton(), { once: true })
      }
    })
  }
}
