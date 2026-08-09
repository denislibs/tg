import type { ButtonHTMLAttributes } from 'react'
import classNames from '../../lib/classNames'
import s from './Button.module.scss'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  fullWidth?: boolean
  uppercase?: boolean
}

// Заполненная акцентная кнопка — классы tweb `btn btn-primary btn-color-primary`
// (_button.scss:1021 + :1207). Форма/высота/радиус/hover-фон (--dark-primary-color)
// и disabled приходят оттуда.
//
// Отступление: tweb-кнопка ВСЕГДА `width: 100%` и UPPERCASE — это форма
// «главная кнопка секции». У нас Button стоит и в инлайновых местах, поэтому
// ширина и регистр остаются пропами (`fullWidth`/`uppercase`), а базовое
// поведение tweb гасим в модуле.
export default function Button({ fullWidth, uppercase, className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={classNames(
        'btn', 'btn-primary', 'btn-color-primary',
        s.btn, fullWidth ? s.fullWidth : '', uppercase ? '' : s.noUppercase, className ?? '',
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
