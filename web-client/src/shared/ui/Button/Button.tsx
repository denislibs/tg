import type { ButtonHTMLAttributes } from 'react'
import classNames from '../../lib/classNames'
import s from './Button.module.scss'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  fullWidth?: boolean
  uppercase?: boolean
}

// Заполненная акцентная кнопка (tweb .btn-primary).
export default function Button({ fullWidth, uppercase, className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={classNames(s.btn, fullWidth ? s.fullWidth : '', uppercase ? s.uppercase : '', className ?? '')}
      {...rest}
    >
      {children}
    </button>
  )
}
