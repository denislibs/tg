// CodeInput — ввод кода подтверждения единым полем (порт tweb
// components/codeInputField.tsx): ОДИН невидимый <input inputmode=numeric
// autocomplete=one-time-code> absolute поверх ряда отрисованных ячеек. Вставка
// строки из N цифр из буфера заполняет всё; автозаполнение из SMS работает.
// Цифра влетает translateY(20px)→0 spring-безье, при удалении — scale(.5)+fade;
// в активной ячейке — мигающий caret. Ошибка — красные рамки (tweb: без shake).
// onFocusChange — для обезьянки TrackingMonkey (tweb вешает focus/blur на input).
import { useRef, useState } from 'react'
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

export default function CodeInput({ length, value, onChange, onComplete, error, onFocusChange }: {
  length: number
  value: string
  onChange: (v: string) => void
  onComplete: (code: string) => void
  error?: boolean
  onFocusChange?: (focused: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)

  const handleInput = (raw: string) => {
    const next = raw.replace(/\D/g, '').slice(0, length)
    if (next === value) return
    onChange(next)
    if (next.length === length) onComplete(next)
  }

  // Активная ячейка = позиция каретки (длина значения); caret показываем в ней,
  // пока код не набран целиком.
  const activeIdx = Math.min(value.length, length - 1)

  return (
    <div className={classNames(s.wrap, error ? s.error : '')}>
      <input
        ref={inputRef}
        className={s.input}
        inputMode="numeric"
        autoComplete="one-time-code"
        spellCheck={false}
        pattern="^\d*$"
        maxLength={length}
        autoFocus
        value={value}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={(e) => {
          setFocused(true)
          onFocusChange?.(true)
          // каретка всегда в конце — активная ячейка следует за длиной значения
          e.target.setSelectionRange(value.length, value.length)
        }}
        onBlur={() => { setFocused(false); onFocusChange?.(false) }}
      />
      {Array.from({ length }).map((_, i) => (
        <div
          key={i}
          className={classNames(s.digit, focused && i === activeIdx ? s.active : '')}
        >
          <Digit digit={value[i] ?? ''} />
          {focused && value.length === i && <div className={s.caret} />}
        </div>
      ))}
    </div>
  )
}
