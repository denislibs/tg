import { forwardRef, type InputHTMLAttributes } from 'react'
import classNames from '../../lib/classNames'
import s from './Input.module.scss'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string
  onChange: (v: string) => void
  /** плавающий лейбл (tweb .input-field) */
  label?: string
  /** класс на обёртку (ширина/flex) */
  wrapClassName?: string
}

// Outlined-инпут с плавающим лейблом (tweb .input-field).
const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { value, onChange, label, wrapClassName, placeholder, ...rest },
  ref,
) {
  return (
    <div className={classNames(s.field, wrapClassName ?? '')}>
      <input
        ref={ref}
        className={s.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? ' '}
        {...rest}
      />
      {label && <label className={s.label}>{label}</label>}
    </div>
  )
})

export default Input
