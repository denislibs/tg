import { forwardRef, useLayoutEffect, useRef, type InputHTMLAttributes, type ForwardedRef, type MutableRefObject } from 'react'
import classNames from '../../lib/classNames'
import s from './Input.module.scss'

// Цифровая маска (телефон/карта/дата): фиксированный префикс + группы цифр,
// незаполненные позиции показываются прочерком. value — только сырые цифры.
export interface DigitMask {
  /** неизменяемый префикс, напр. «+7» */
  prefix: string
  /** размеры групп цифр, напр. [3,3,2,2] для РФ-номера */
  groups: number[]
  /** символ незаполненной позиции (по умолчанию «─») */
  placeholderChar?: string
}

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string
  onChange: (v: string) => void
  /** плавающий лейбл (tweb .input-field) */
  label?: string
  /** класс на обёртку (ширина/flex) */
  wrapClassName?: string
  /** цифровая маска — value трактуется как сырые цифры */
  mask?: DigitMask
}

const maskTotal = (m: DigitMask): number => m.groups.reduce((a, b) => a + b, 0)

// «+7 925 481 72 90» — заполненные позиции цифрами, остальные — placeholderChar.
function maskDisplay(digits: string, m: DigitMask): string {
  const ph = m.placeholderChar ?? '─'
  const d = digits.slice(0, maskTotal(m))
  const parts: string[] = []
  let idx = 0
  for (const g of m.groups) {
    let part = ''
    for (let i = 0; i < g; i++) { part += idx < d.length ? d[idx] : ph; idx++ }
    parts.push(part)
  }
  return `${m.prefix} ${parts.join(' ')}`
}

// Outlined-инпут с плавающим лейблом (tweb .input-field); опционально — цифровая
// маска (прозрачный input держит каретку/клавиатуру, поверх — цветной дисплей,
// строки идентичны → каретка совпадает с видимым текстом).
const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { value, onChange, label, wrapClassName, placeholder, mask, ...rest },
  ref,
) {
  if (mask) {
    return <MaskedInput value={value} onChange={onChange} label={label} wrapClassName={wrapClassName} mask={mask} inputRef={ref} rest={rest} />
  }
  // Разметка tweb `.input-field` (_input.scss): input + оверлей акцентной рамки
  // + label ПОСЛЕ инпута — всплытие лейбла держится на соседних селекторах
  // (`.input-field-input:focus ~ label`, `:not(.is-empty) ~ label`).
  return (
    <div className={classNames('input-field', s.field, wrapClassName ?? '')}>
      <input
        ref={ref}
        className={classNames('input-field-input', value ? '' : 'is-empty', s.input)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? ' '}
        {...rest}
      />
      <div className="input-field-border" />
      {label && <label>{label}</label>}
    </div>
  )
})

function MaskedInput({
  value, onChange, label, wrapClassName, mask, inputRef, rest,
}: {
  value: string
  onChange: (v: string) => void
  label?: string
  wrapClassName?: string
  mask: DigitMask
  inputRef: ForwardedRef<HTMLInputElement>
  rest: InputHTMLAttributes<HTMLInputElement>
}) {
  const total = maskTotal(mask)
  const ph = mask.placeholderChar ?? '─'
  const localRef = useRef<HTMLInputElement | null>(null)
  const setRefs = (el: HTMLInputElement | null) => {
    localRef.current = el
    if (typeof inputRef === 'function') inputRef(el)
    else if (inputRef) (inputRef as MutableRefObject<HTMLInputElement | null>).current = el
  }
  const display = maskDisplay(value, mask)

  // Каретка — перед первой незаполненной позицией (следующий прочерк).
  useLayoutEffect(() => {
    const el = localRef.current
    if (!el || document.activeElement !== el) return
    const firstPh = display.indexOf(ph)
    const pos = firstPh === -1 ? display.length : firstPh
    el.setSelectionRange(pos, pos)
  }, [display, ph])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); onChange(value.slice(0, -1)); return }
    if (/^\d$/.test(e.key)) { e.preventDefault(); if (value.length < total) onChange(value + e.key); return }
    if (e.key.length === 1) e.preventDefault() // не-цифры блокируем (навигация/Tab проходят)
  }

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    let d = e.clipboardData.getData('text').replace(/\D/g, '')
    const prefixDigits = mask.prefix.replace(/\D/g, '')
    if (prefixDigits && d.startsWith(prefixDigits) && d.length > total) d = d.slice(prefixDigits.length)
    onChange(d.slice(0, total))
  }

  return (
    <div className={classNames('input-field', s.field, s.masked, wrapClassName ?? '')}>
      <input
        ref={setRefs}
        className={classNames('input-field-input', s.input)}
        value={display}
        inputMode="numeric"
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onChange={() => { /* ввод только через onKeyDown */ }}
        {...rest}
      />
      <div className={s.maskDisplay} aria-hidden>
        {display.split('').map((ch, i) => (
          <span key={i} className={ch === ph ? s.maskDash : undefined}>{ch}</span>
        ))}
      </div>
      <div className="input-field-border" />
      {label && <label>{label}</label>}
    </div>
  )
}

export default Input
