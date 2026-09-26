// Порт поведенческой половины tweb `src/components/inputSearch.ts` (e52b5d931):
// поля `prevValue`/`timeout`/`onChange`/`onClear`/`onEnter` (:20-26),
// `debounceTime` по умолчанию 300 мс (:77), `onInput` (:200-220),
// `onKeyDown` (:222-227), `onClearClick` (:229-234), `clearTimeout` (:236-239),
// `value` (:241-249), `remove` (:251-255) и `setEmpty` поля (`inputField.ts:765-780`).
//
// Зачем отдельно от React-компонента. Владелец глобального поиска
// (`components/sidebarLeft/globalSearch.ts`) работает с полем как оригинал —
// ОБЪЕКТОМ: пишет в него `onChange`/`onClear`/`onEnter`, читает и пишет `value`
// (`inputSearch.value = ''` в `cleanup`, :1407). Контролируемое React-поле
// так не умеет: запись в DOM ре-рендер вернул бы старым `value` из состояния.
// Поэтому в режиме ручки (`searchRef` у `InputSearch.tsx`) значение живёт
// только в `<input>`, а события разбирает этот объект, как `InputSearch` tweb.
//
// Разметку строит React (`InputSearch.tsx`), объект получает готовые узлы
// через `bind` — единственное отличие формы от конструктора оригинала
// (:39-117), который строит их сам. Ванильное поле с конструктором оригинала —
// `components/inputSearch.ts`: оно наследует этот объект и строит узлы само,
// поведенческая половина у них одна.
//
// ── Расхождения с оригиналом ───────────────────────────────────────────────
//  1. Опций `verifyDebounce`/`onDebounce`/`onFocusChange`/`arrowBack`/
//     `alwaysShowClear` нет: у единственного потребителя (поле шапки левой
//     колонки, `sidebarLeft/index.ts:151`) они не заданы.
//  2. `set value` не шлёт синтетическое `input` (`inputField.ts:756-758`): у
//     оригинала оно доходит до `onInput`, где `value === prevValue` и
//     обработчик выходит сразу (:204-206), — наблюдаемого эффекта нет, кроме
//     `setEmpty`, который здесь зовётся прямо.
import { attachClickEvent } from '@helpers/dom/clickEvent'
import ListenerSetter from '@helpers/listenerSetter'

export default class InputSearchHandle {
  public container!: HTMLElement
  public input!: HTMLInputElement
  public clearBtn!: HTMLElement

  public prevValue = ''
  public timeout = 0
  public onChange?: (value: string) => void
  public onClear?: (e?: MouseEvent, wasEmpty?: boolean) => void
  public onEnter?: (value: string) => void

  private listenerSetter = new ListenerSetter()
  /** `debounceTime` (:77, по умолчанию 300) — ванильный `components/inputSearch.ts`
   *  переписывает его из опции конструктора (у селектора пиров — 200) */
  public debounceTime = 300

  /** роль конструктора (:83-94): узлы уже в DOM, вешаем слушатели */
  public bind(container: HTMLElement, input: HTMLInputElement, clearBtn: HTMLElement) {
    this.container = container
    this.input = input
    this.clearBtn = clearBtn
    this.prevValue = input.value
    this.setEmpty()

    this.listenerSetter.add(input)('input', this.onInput)
    this.listenerSetter.add(input)('keydown', this.onKeyDown)
    attachClickEvent(clearBtn, this.onClearClick, { listenerSetter: this.listenerSetter, cancelMouseDown: true })
  }

  // :200-220 (без `verifyDebounce` — расхождение 1)
  private onInput = () => {
    this.setEmpty()
    if(!this.onChange) return

    const { value, prevValue } = this
    if(value === prevValue) {
      return
    }

    this.prevValue = value
    this.clearTimeout()
    this.timeout = window.setTimeout(() => {
      this.onChange?.(value)
    }, this.debounceTime)
  }

  // :222-227
  private onKeyDown = (e: KeyboardEvent) => {
    if(e.key !== 'Enter' || !this.onEnter) return
    const value = this.value
    if(!value) return
    this.onEnter(value)
  }

  // :229-234
  private onClearClick = (e?: MouseEvent) => {
    const isEmpty = !this.input.value
    this.value = ''
    this.onChange?.('')
    this.onClear?.(e, isEmpty)
  }

  // :236-239
  private clearTimeout = () => {
    clearTimeout(this.timeout)
  }

  /** `inputField.ts:776-780` — `is-empty` на самом поле */
  private setEmpty() {
    this.input.classList.toggle('is-empty', !this.input.value)
  }

  get value() {
    return this.input.value
  }

  // :245-249 — отменяет висящий debounce: записанное владельцем значение не
  // перебивается отложенным `onChange` прежнего ввода
  set value(value: string) {
    this.prevValue = value
    this.clearTimeout()
    this.input.value = value
    this.setEmpty()
  }

  // :251-255
  public remove() {
    this.clearTimeout()
    this.listenerSetter.removeAll()
  }
}
