/** @jsxImportSource solid-js */
// CodeInput — ввод кода подтверждения единым полем. Порт tweb
// `components/codeInputField.tsx` (291 строка) — У ЭТОГО ФАЙЛА ОРИГИНАЛ УЖЕ
// НА SOLID (единственный из четырёх полей задачи 4), поэтому здесь настоящий
// порт 1:1 движка выбора/подсветки ячеек (`CodeInputField`, tweb :60-291), а
// не перевод с React.
//
// ОДИН невидимый <input inputmode=numeric autocomplete=one-time-code> absolute
// поверх ряда отрисованных ячеек. Вставка строки из N цифр из буфера заполняет
// всё; автозаполнение из SMS работает. Подсветка ячейки считается по
// `selectionStart/selectionEnd`: инпут принудительно держит выделение шириной
// в один символ (`setSelectionRange(start, end, direction)`), поэтому стрелки
// двигают рамку по ячейкам, а Shift+стрелки выделяют несколько. Каретка
// рисуется только в режиме дописывания (`isInserting`) и только в ячейке за
// последней цифрой.
//
// ── Что снято против tweb `CodeInputFieldCompat` (класс-обёртка, :7-58) ─────
// Не портирована. Она существовала ТОЛЬКО затем, чтобы дать ИМПЕРАТИВНОМУ
// вызывающему (`new CodeInputFieldCompat({...})`, `.value = ''`, `.error =
// true`) мост в Solid-дерево через сигналы. У нас вызывающий —
// `AuthCodeCard.solid.tsx`, САМ Solid-компонент: `value`/`error`/`disabled`
// передаются реактивными пропами напрямую, мост не нужен. Заодно `value`
// здесь — ПОЛНОСТЬЮ управляемый проп (`value`/`onChange`), а не опциональный
// `valueSignal` — carrier-сигнал оригинала бридж-класса тоже был нужен только
// императивному вызывающему.
//
// `onFocusChange` (React-версия его несла — для `TrackingMonkey`, которая
// вешает focus/blur на инпут) СНЯТ ревью: у `AuthCodeCard.solid.tsx` сегодня
// обезьянка-заглушка (`div.media-sticker-wrapper` без канв, см. её докблок),
// потребителя пропа нет. Появится настоящий Solid-порт `TrackingMonkey` —
// добавить проп обратно вместе с ним, а не заранее.
import { createSignal, Index, Show, type JSX } from 'solid-js'
import classNames from '@helpers/string/classNames'
import { subscribeOn } from '@helpers/solid/subscribeOn'
import { Transition } from '@vendor/solid-transition-group'
import styles from './CodeInput.module.scss'

export type CodeInputSolidProps = {
  length: number
  value: string
  onChange: (v: string) => void
  onComplete: (code: string) => void
  error?: boolean
  /** идёт отправка — ячейки гаснут, инпут не кликается (tweb `.disabled`) */
  disabled?: boolean
  /** доп. класс на `.wrap` — карточка кода вешает `.codeInputField` (margin-top) */
  class?: string
  ref?: (el: HTMLInputElement) => void
}

export default function CodeInput(props: CodeInputSolidProps): JSX.Element {
  const [activeIndexStart, setActiveIndexStart] = createSignal(-1)
  const [activeIndexEnd, setActiveIndexEnd] = createSignal(-1)
  const [isInserting, setIsInserting] = createSignal(false)

  let isFocused = false
  let isShiftKeyDown = false
  const previousSelection = {
    inserting: false as boolean,
    start: null as number | null,
    end: null as number | null,
  }

  const syncSelection = (sel: {
    start: number | null
    end: number | null
    inserting: boolean
    originalStart: number | null
    originalEnd: number | null
  }) => {
    previousSelection.inserting = sel.inserting
    previousSelection.start = sel.originalStart
    previousSelection.end = sel.originalEnd
    if (sel.start === null || sel.end === null) {
      setActiveIndexStart(-1)
      setActiveIndexEnd(-1)
      return
    }
    setActiveIndexStart(sel.start)
    setActiveIndexEnd(sel.end)
  }

  let inputRef!: HTMLInputElement

  // Порт tweb `onSelectionChange`: нормализует выделение инпута к ширине в
  // один символ и переносит его в индексы подсвеченных ячеек.
  const onSelectionChange = (inputType?: string) => {
    if (
      !isFocused ||
      inputRef.ownerDocument.activeElement !== inputRef ||
      inputRef.selectionStart === null ||
      inputRef.selectionEnd === null
    ) {
      syncSelection({
        start: null,
        end: null,
        inserting: false,
        originalStart: inputRef.selectionStart,
        originalEnd: inputRef.selectionEnd,
      })
      setIsInserting(false)
      return
    }

    const maxLength = props.length
    const inserting = inputRef.value.length < maxLength && inputRef.selectionStart === inputRef.value.length
    setIsInserting(inserting)

    if (inserting || inputRef.selectionStart !== inputRef.selectionEnd) {
      syncSelection({
        start: inputRef.selectionStart,
        end: inserting ? inputRef.selectionEnd + 1 : inputRef.selectionEnd,
        inserting,
        originalStart: inputRef.selectionStart,
        originalEnd: inputRef.selectionEnd,
      })
      return
    }

    let selectionStart = 0
    let selectionEnd = 0
    let direction: 'forward' | 'backward' | undefined
    if (inputRef.selectionStart === 0) {
      selectionStart = 0
      selectionEnd = 1
      direction = 'forward'
    } else if (inputRef.selectionStart === maxLength) {
      selectionStart = maxLength - 1
      selectionEnd = maxLength
      direction = 'backward'
    } else {
      let startOffset = 0
      let endOffset = 1
      if (previousSelection.start !== null && previousSelection.end !== null) {
        const navigatedBackwards =
          inputRef.selectionStart < previousSelection.end &&
          Math.abs(previousSelection.start - previousSelection.end) === 1
        direction = navigatedBackwards ? 'backward' : 'forward'
        if (
          (navigatedBackwards && !previousSelection.inserting && inputType !== 'deleteContentForward') ||
          (!navigatedBackwards && isShiftKeyDown)
        ) {
          startOffset += -1
        }
      }
      if (isShiftKeyDown && inputType === undefined) endOffset += 1
      selectionStart = inputRef.selectionStart + startOffset
      selectionEnd = inputRef.selectionEnd + startOffset + endOffset
    }

    inputRef.setSelectionRange(selectionStart, selectionEnd, direction)
    syncSelection({
      start: selectionStart,
      end: selectionEnd,
      inserting,
      originalStart: inputRef.selectionStart,
      originalEnd: inputRef.selectionEnd,
    })
  }

  // tweb слушает `selectionchange` на документе — только так ловятся стрелки
  // и мышиное выделение внутри инпута. `subscribeOn` снимает слушатель сам
  // при размонтировании (onCleanup внутри).
  subscribeOn(document)('selectionchange', () => onSelectionChange())

  const handleInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (e) => {
    const input = e.currentTarget
    const rawValue = input.value
    const oldValue = props.value
    const selectionSize = Math.abs((previousSelection.start ?? 0) - (previousSelection.end ?? 0))

    let finalValue = rawValue
    if (previousSelection.inserting || selectionSize === oldValue.length) {
      finalValue = finalValue.replace(/\D/g, '')
    }
    finalValue = finalValue.slice(0, props.length)

    const hasInvalidChars = !/^\d*$/.test(finalValue)
    if ((rawValue.length !== 0 && finalValue.length === 0) || finalValue === oldValue || hasInvalidChars) {
      input.value = oldValue
      if (hasInvalidChars) input.setSelectionRange(previousSelection.start ?? 0, previousSelection.end ?? 0)
      return
    }

    if (finalValue.length < oldValue.length) onSelectionChange(e.inputType)

    props.onChange(finalValue)
    if (finalValue.length === props.length) props.onComplete(finalValue)
  }

  return (
    <div class={classNames(styles.wrap, props.error && styles.error, props.disabled && styles.disabled, props.class)}>
      <input
        ref={(el) => {
          inputRef = el
          props.ref?.(el)
        }}
        class={styles.input}
        inputMode="numeric"
        autocomplete="one-time-code"
        required
        spellcheck={false}
        pattern="^\d*$"
        value={props.value}
        disabled={props.disabled}
        onFocus={() => {
          inputRef.setSelectionRange(props.value.length, props.value.length)
          isFocused = true
          onSelectionChange()
        }}
        onBlur={() => {
          isFocused = false
          onSelectionChange()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Shift') isShiftKeyDown = true
        }}
        onKeyUp={(e) => {
          if (e.key === 'Shift') isShiftKeyDown = false
        }}
        onInput={handleInput}
      />

      <Index each={Array.from({ length: props.length })}>
        {(_, idx) => (
          <div class={classNames(styles.digit, activeIndexStart() <= idx && idx < activeIndexEnd() && styles.active)}>
            <Transition>
              <Show when={props.value[idx]}>
                <div class={styles.digitContent}>{props.value[idx]}</div>
              </Show>
            </Transition>
            {isInserting() && props.value.length === idx && <div class={styles.caret} />}
          </div>
        )}
      </Index>
    </div>
  )
}
