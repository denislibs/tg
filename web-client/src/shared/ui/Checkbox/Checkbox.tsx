// Чекбокс — разметка tweb `checkboxField.ts:134-155`:
//   label.checkbox-field[.checkbox-field-round][.checkbox-without-caption][.checkbox-disabled]
//     > [div.c-ripple] + input.checkbox-field-input
//     + .checkbox-box > .checkbox-box-border + .checkbox-box-background
//                     + svg.checkbox-box-check > use[href="#check"]
//     + [span.checkbox-caption]
// Без `caption` подпись не рендерится и стоит `checkbox-without-caption`
// (tweb вешает его, когда нет `options.text`); с `caption` строка целиком —
// это и есть `.checkbox-field`, как в конфирме PopupPeer (peer.ts:84-92,
// дамп `06-delete-popup.json`).
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
import { type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
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
  /** подпись строки (tweb `span.checkbox-caption`); без неё — `checkbox-without-caption` */
  caption?: ReactNode
  /** узел ripple (tweb `ripple(label)` при `withRipple`) — кладётся ПЕРВЫМ ребёнком */
  ripple?: ReactNode
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void
  /** переключение состояния (нативный toggle всё равно гасится preventDefault'ом) */
  onToggle?: () => void
  /**
   * `input[type=radio]` вместо `checkbox` (tweb `CheckboxField({asRadio: true})`,
   * `checkboxField.ts:59-64`) — группа взаимоисключающих строк (тарифы Premium).
   * `name` идёт на `input.name` (в tweb — только для радио; для чекбокса это
   * был бы `input.id`, но у нас `id` не нужен — подписи `<label>` не отдельные).
   */
  asRadio?: boolean
  name?: string
}

export default function Checkbox({
  checked, accent, ring, size, shape = 'round', disabled = false, className, caption, ripple, onPointerDown, onToggle,
  asRadio = false, name,
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
        caption == null ? 'checkbox-without-caption' : '',
        disabled ? 'checkbox-disabled' : '',
        className ?? s.root,
      )}
      style={style}
      onPointerDown={onPointerDown}
      // Без onToggle компонент «только отображение» — гасим нативный toggle.
      // С onToggle переключение идёт нативным путём tweb (клик по label →
      // change у input → слушатель пишет в модель), поэтому preventDefault
      // здесь не ставим: он бы срезал перенос клика с label на input.
      onClick={onToggle ? undefined : (e: MouseEvent) => e.preventDefault()}
    >
      {ripple}
      <input
        className="checkbox-field-input"
        type={asRadio ? 'radio' : 'checkbox'}
        name={name}
        checked={checked}
        disabled={disabled}
        tabIndex={-1}
        {...(onToggle ? { onChange: () => onToggle() } : { readOnly: true })}
      />
      <div className="checkbox-box">
        <div className="checkbox-box-border" />
        <div className="checkbox-box-background" />
        <svg className="checkbox-box-check" viewBox="0 0 24 24">
          <use href="#check" x="-1" />
        </svg>
      </div>
      {caption != null && <span className="checkbox-caption">{caption}</span>}
    </label>
  )
}
