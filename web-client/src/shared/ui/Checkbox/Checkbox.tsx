// Чекбокс — разметка tweb `checkboxField.ts:134-155`:
//   label.checkbox-field[.checkbox-field-round][.checkbox-without-caption][.checkbox-disabled]
//     > input.checkbox-field-input
//     + .checkbox-box > .checkbox-box-border + .checkbox-box-background
//                     + svg.checkbox-box-check > use[href="#check"]
// Подписи мы не рендерим никогда, поэтому `checkbox-without-caption` стоит
// всегда (tweb вешает его, когда нет `options.text`).
// Вся анимация — CSS из `_checkbox.scss`: акцентный круг вкатывается
// (transform: scale(0)→1, .2s ease-in-out), галочка дорисовывается через
// stroke-dasharray (.1s с задержкой .15s). framer-motion больше не нужен.
//
// Размер по умолчанию НЕ задаётся инлайном: --size приходит из партиала
// (`.checkbox-field` 1.25rem / `.checkbox-field-round` 1.5rem — как в tweb).
//
// отступление от tweb: клик по <label> гасим preventDefault'ом — компонент
// «только отображение», состояние ведёт React (у tweb input переключается
// нативно, а change-листенер пишет в модель).
import { type CSSProperties, type MouseEvent } from 'react'
import classNames from '../../lib/classNames'
import s from './Checkbox.module.scss'

export interface CheckboxProps {
  checked: boolean
  /** цвет заливки (по умолчанию --primary-color) */
  accent?: string
  /** цвет кольца (по умолчанию --secondary-color, как в tweb) */
  ring?: string
  /** переопределить --size; без него размер берётся из _checkbox.scss */
  size?: number
  /** square — квадрат со скруглением (tweb .checkbox-field, add members) */
  shape?: 'round' | 'square'
  /** нельзя переключить (уже участник) — приглушён */
  disabled?: boolean
  /**
   * Класс-владелец раскладки (tweb-модификатор вроде `bubble-select-checkbox`).
   * Когда задан — локальная раскладка (`s.root`) НЕ применяется: позицию,
   * display и margin задаёт партиал.
   */
  className?: string
}

export default function Checkbox({
  checked, accent, ring, size, shape = 'round', disabled = false, className,
}: CheckboxProps) {
  const style = {
    ...(size ? { '--size': `${size}px` } : {}),
    ...(accent ? { '--primary-color': accent } : {}),
    ...(ring ? { '--secondary-color': ring } : {}),
  } as CSSProperties
  return (
    <label
      className={classNames(
        'checkbox-field',
        shape === 'round' ? 'checkbox-field-round' : '',
        'checkbox-without-caption',
        disabled ? 'checkbox-disabled' : '',
        className ?? s.root,
      )}
      style={style}
      onClick={(e: MouseEvent) => e.preventDefault()}
    >
      <input className="checkbox-field-input" type="checkbox" checked={checked} disabled={disabled} readOnly tabIndex={-1} />
      <div className="checkbox-box">
        <div className="checkbox-box-border" />
        <div className="checkbox-box-background" />
        <svg className="checkbox-box-check" viewBox="0 0 24 24">
          <use href="#check" x="-1" />
        </svg>
      </div>
    </label>
  )
}
