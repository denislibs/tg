// Чекбокс — разметка tweb `checkboxField.ts:134-155`:
//   .checkbox-field[.checkbox-field-round][.checkbox-disabled]
//     > input.checkbox-field-input
//     + .checkbox-box > .checkbox-box-border + .checkbox-box-background
//                     + svg.checkbox-box-check > use[href="#check"]
// Вся анимация — CSS из `_checkbox.scss`: акцентный круг вкатывается
// (transform: scale(0)→1, .2s ease-in-out), галочка дорисовывается через
// stroke-dasharray (.1s с задержкой .15s). framer-motion больше не нужен.
//
// Отступление: у tweb корень — `<label>`, у нас `<div>`: компонент
// «только отображение», клик обрабатывает строка-владелец, а label
// переключал бы input мимо React.
import { type CSSProperties } from 'react'
import classNames from '../../lib/classNames'
import s from './Checkbox.module.scss'

export interface CheckboxProps {
  checked: boolean
  /** цвет заливки (по умолчанию --primary-color) */
  accent?: string
  /** цвет кольца (по умолчанию --secondary-color, как в tweb) */
  ring?: string
  size?: number
  /** square — квадрат со скруглением (tweb .checkbox-field, add members) */
  shape?: 'round' | 'square'
  /** нельзя переключить (уже участник) — приглушён */
  disabled?: boolean
}

export default function Checkbox({ checked, accent, ring, size = 18, shape = 'round', disabled = false }: CheckboxProps) {
  const style = {
    '--size': `${size}px`,
    ...(accent ? { '--primary-color': accent } : {}),
    ...(ring ? { '--secondary-color': ring } : {}),
  } as CSSProperties
  return (
    <div
      className={classNames('checkbox-field', shape === 'round' ? 'checkbox-field-round' : '', disabled ? 'checkbox-disabled' : '', s.root)}
      style={style}
    >
      <input className="checkbox-field-input" type="checkbox" checked={checked} disabled={disabled} readOnly tabIndex={-1} />
      <div className="checkbox-box">
        <div className="checkbox-box-border" />
        <div className="checkbox-box-background" />
        <svg className="checkbox-box-check" viewBox="0 0 24 24">
          <use href="#check" x="-1" />
        </svg>
      </div>
    </div>
  )
}
