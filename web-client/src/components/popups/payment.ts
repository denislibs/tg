// Порт tweb `src/components/popups/payment.tsx:82-149` (812502980) — ТОЛЬКО
// `InputRightNumber`: числовое поле в правой части строки, ширина — по тексту,
// каретка всегда в конце. Сам попап оплаты (`PopupPayment`, остальные 2000+
// строк файла) у нас не портирован — платежей нет; поле живёт в его модуле, как
// у оригинала, ради первого потребителя: «Число пользователей» вкладки
// «Новая ссылка» (`sidebarRight/tabs/editChatInviteLink.solid.tsx`, 0б-3 волны 7).
//
// Расхождения: `placeCaretAtEnd(input)` — наш `shared/lib/caret.ts` (он же ставит
// фокус, как `helpers/dom/placeCaretAtEnd` оригинала); `ignoreNextSelectionChange`
// инициализирован нулём (строгий tsconfig).
import { FontFamily, FontFull, FontSize } from '@config/font'
import { getAppWindow } from '@helpers/appWindow'
import getTextWidth from '@helpers/canvas/getTextWidth'
import { placeCaretAtEnd } from '@shared/lib/caret'

export class InputRightNumber {
  public input: HTMLInputElement

  constructor(public options: {
    fontWeight?: number
  } = {}) {
    const input = this.input = document.createElement('input')
    input.type = 'tel'
    input.classList.add('input-clear')

    const haveToIgnoreEvents = 1 // tweb :94 — `input instanceof HTMLInputElement ? 1 : 2`
    const onSelectionChange = () => {
      if(ignoreNextSelectionChange) {
        --ignoreNextSelectionChange
        return
      }

      ignoreNextSelectionChange = haveToIgnoreEvents
      placeCaretAtEnd(input)
    }

    const onFocus = () => {
      setTimeout(() => {
        ignoreNextSelectionChange = haveToIgnoreEvents
        placeCaretAtEnd(input)
        getAppWindow().document.addEventListener('selectionchange', onSelectionChange)
      }, 0)
    }

    const onFocusOut = () => {
      input.addEventListener('focus', onFocus, { once: true })
      getAppWindow().document.removeEventListener('selectionchange', onSelectionChange)
    }

    let ignoreNextSelectionChange = 0
    input.addEventListener('focusout', onFocusOut)
    onFocusOut()
  }

  public get value() {
    return this.input.value
  }

  public set value(value: string) {
    this.input.value = value
    this.onValue()
  }

  public onValue() {
    if(this.input.ownerDocument.activeElement === this.input) {
      placeCaretAtEnd(this.input)
    }

    this.setWidth()
  }

  public setWidth() {
    const width = getTextWidth(this.value, this.options?.fontWeight ? `${this.options.fontWeight} ${FontSize} ${FontFamily}` : FontFull)
    this.input.style.width = width + 'px'
  }
}
