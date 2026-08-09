// CodeInput — ввод кода подтверждения единым полем (порт tweb
// `components/codeInputField.tsx`): ОДИН невидимый <input inputmode=numeric
// autocomplete=one-time-code> absolute поверх ряда отрисованных ячеек. Вставка
// строки из N цифр из буфера заполняет всё; автозаполнение из SMS работает.
//
// Подсветка ячейки считается по `selectionStart/selectionEnd`, как в оригинале:
// инпут принудительно держит выделение шириной в один символ
// (`setSelectionRange(start, end, direction)`), поэтому стрелки двигают рамку по
// ячейкам, а Shift+стрелки выделяют несколько. Каретка рисуется только в режиме
// дописывания (`isInserting`) и только в ячейке за последней цифрой.
//
// Цифра влетает translateY(20px)→0 spring-безье, при удалении — scale(.5)+fade.
// onFocusChange — для обезьянки TrackingMonkey (tweb вешает focus/blur на input).
import { useEffect, useRef, useState } from 'react'
import classNames from '../../shared/lib/classNames'
import s from './CodeInput.module.scss'

// Ячейка: держит последнюю цифру, чтобы при удалении сыграть exit-анимацию
// (tweb Transition s-exit-to: scale(.5)+fade) без framer.
function Digit({ digit }: { digit: string }) {
  const [leaving, setLeaving] = useState('')
  const prev = useRef(digit)
  if (prev.current !== digit) {
    if (prev.current && !digit) setLeaving(prev.current)
    prev.current = digit
  }
  return (
    <>
      {digit && <div key={digit} className={classNames(s.digitContent, s.enter)}>{digit}</div>}
      {!digit && leaving && (
        <div className={classNames(s.digitContent, s.exit)} onAnimationEnd={() => setLeaving('')}>
          {leaving}
        </div>
      )}
    </>
  )
}

export default function CodeInput({
  length,
  value,
  onChange,
  onComplete,
  error,
  disabled,
  onFocusChange,
  className = '',
}: {
  length: number
  value: string
  onChange: (v: string) => void
  onComplete: (code: string) => void
  error?: boolean
  /** идёт отправка — ячейки гаснут, инпут не кликается (tweb `.disabled`) */
  disabled?: boolean
  onFocusChange?: (focused: boolean) => void
  /** доп. класс на `.wrap` — карточка кода вешает `.codeInputField` (margin-top 1.5rem) */
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  // Диапазон подсвеченных ячеек — [start, end) в терминах tweb activeIndex*.
  const [active, setActive] = useState<[number, number]>([-1, -1])
  const [isInserting, setIsInserting] = useState(false)

  const focusedRef = useRef(false)
  const shiftRef = useRef(false)
  // Предыдущее «сырое» выделение — по нему tweb определяет направление хода.
  const prevSel = useRef<{ inserting: boolean; start: number | null; end: number | null }>({
    inserting: false,
    start: null,
    end: null,
  })

  // Порт tweb `onSelectionChange`: нормализует выделение инпута к ширине в один
  // символ и переносит его в индексы подсвеченных ячеек.
  const syncSelection = (inputType?: string) => {
    const input = inputRef.current
    if (!input) return
    const remember = (
      start: number | null,
      end: number | null,
      inserting: boolean,
      originalStart: number | null,
      originalEnd: number | null,
    ) => {
      prevSel.current = { inserting, start: originalStart, end: originalEnd }
      const a = start === null || end === null ? -1 : start
      const b = start === null || end === null ? -1 : end
      setActive((p) => (p[0] === a && p[1] === b ? p : [a, b]))
    }

    if (
      !focusedRef.current ||
      document.activeElement !== input ||
      input.selectionStart === null ||
      input.selectionEnd === null
    ) {
      remember(null, null, false, input.selectionStart, input.selectionEnd)
      setIsInserting(false)
      return
    }

    const inserting = input.value.length < length && input.selectionStart === input.value.length
    setIsInserting(inserting)

    if (inserting || input.selectionStart !== input.selectionEnd) {
      remember(
        input.selectionStart,
        inserting ? input.selectionEnd + 1 : input.selectionEnd,
        inserting,
        input.selectionStart,
        input.selectionEnd,
      )
      return
    }

    let selectionStart = 0
    let selectionEnd = 0
    let direction: 'forward' | 'backward' | undefined
    if (input.selectionStart === 0) {
      selectionStart = 0
      selectionEnd = 1
      direction = 'forward'
    } else if (input.selectionStart === length) {
      selectionStart = length - 1
      selectionEnd = length
      direction = 'backward'
    } else {
      let startOffset = 0
      let endOffset = 1
      if (prevSel.current.start !== null && prevSel.current.end !== null) {
        const navigatedBackwards =
          input.selectionStart < prevSel.current.end &&
          Math.abs(prevSel.current.start - prevSel.current.end) === 1
        direction = navigatedBackwards ? 'backward' : 'forward'
        if (
          (navigatedBackwards && !prevSel.current.inserting && inputType !== 'deleteContentForward') ||
          (!navigatedBackwards && shiftRef.current)
        ) {
          startOffset += -1
        }
      }
      if (shiftRef.current && inputType === undefined) endOffset += 1
      selectionStart = input.selectionStart + startOffset
      selectionEnd = input.selectionEnd + startOffset + endOffset
    }

    input.setSelectionRange(selectionStart, selectionEnd, direction)
    remember(selectionStart, selectionEnd, inserting, input.selectionStart, input.selectionEnd)
  }

  // tweb слушает `selectionchange` на документе — только так ловятся стрелки и
  // мышиное выделение внутри инпута.
  const syncRef = useRef(syncSelection)
  syncRef.current = syncSelection
  useEffect(() => {
    const handler = () => syncRef.current()
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [])

  // Значение приходит сверху (карточка сбрасывает его на ошибке), а React
  // пишет его в DOM уже после коммита — пересчитываем подсветку по факту.
  useEffect(() => {
    syncRef.current()
  }, [value])

  // На время отправки поле гаснет и теряет фокус; после ответа сервера tweb
  // возвращает его обратно (`fastRaf(() => codeInputField.input.focus())`).
  const wasFocused = useRef(false)
  useEffect(() => {
    if (disabled) {
      wasFocused.current = focusedRef.current
      return
    }
    if (!wasFocused.current) return
    wasFocused.current = false
    inputRef.current?.focus()
  }, [disabled])

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    const raw = input.value
    const inputType = (e.nativeEvent as InputEvent).inputType
    const selectionSize = Math.abs((prevSel.current.start ?? 0) - (prevSel.current.end ?? 0))

    let next = raw
    if (prevSel.current.inserting || selectionSize === value.length) next = next.replace(/\D/g, '')
    next = next.slice(0, length)

    const hasInvalid = !/^\d*$/.test(next)
    if ((raw.length !== 0 && next.length === 0) || next === value || hasInvalid) {
      input.value = value
      if (hasInvalid) input.setSelectionRange(prevSel.current.start ?? 0, prevSel.current.end ?? 0)
      return
    }

    if (next.length < value.length) syncSelection(inputType)

    onChange(next)
    if (next.length === length) onComplete(next)
  }

  return (
    <div
      className={classNames(s.wrap, error ? s.error : '', disabled ? s.disabled : '', className)}
    >
      <input
        ref={inputRef}
        className={s.input}
        inputMode="numeric"
        autoComplete="one-time-code"
        spellCheck={false}
        pattern="^\d*$"
        required
        disabled={disabled}
        autoFocus
        value={value}
        onChange={handleInput}
        onFocus={(e) => {
          e.target.setSelectionRange(value.length, value.length)
          focusedRef.current = true
          onFocusChange?.(true)
          syncSelection()
        }}
        onBlur={() => {
          focusedRef.current = false
          onFocusChange?.(false)
          syncSelection()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Shift') shiftRef.current = true
        }}
        onKeyUp={(e) => {
          if (e.key === 'Shift') shiftRef.current = false
        }}
      />
      {Array.from({ length }).map((_, i) => (
        <div
          key={i}
          className={classNames(s.digit, active[0] <= i && i < active[1] ? s.active : '')}
        >
          <Digit digit={value[i] ?? ''} />
          {isInserting && value.length === i && <div className={s.caret} />}
        </div>
      ))}
    </div>
  )
}
