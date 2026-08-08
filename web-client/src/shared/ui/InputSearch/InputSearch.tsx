import { forwardRef, type ReactNode } from 'react'
import classNames from '../../lib/classNames'
import TgIcon from '../../../components/TgIcon'
import IconButton from '../IconButton'
import s from './InputSearch.module.scss'

interface InputSearchProps {
  value: string
  onChange: (v: string) => void
  onFocus?: () => void
  onBlur?: () => void
  placeholder?: string
  /** accent border/icon (parent's persistent "searching" state) */
  focused?: boolean
  onClear?: () => void
  /** right-side slot (e.g. folded stories) shown when the field is empty */
  right?: ReactNode
  className?: string
}

// Поле поиска — разметка tweb `.input-search.old-style` (живой DOM §2):
//   input.input-field-input.input-search-input[.is-empty] + .input-field-border
//   + span.tgico.input-search-part.input-search-icon.will-animate
//   + button.btn-icon.input-search-clear.input-search-part.input-search-button
//   + span.i18n.input-search-placeholder.will-animate
// Обёртку `.input-search.old-style` вешает вызывающий (Sidebar), чтобы поле
// можно было переиспользовать и вне левой колонки.
const InputSearch = forwardRef<HTMLInputElement, InputSearchProps>(function InputSearch(
  { value, onChange, onFocus, onBlur, placeholder, focused, onClear, right, className },
  ref,
) {
  const has = value.length > 0
  return (
    <div className={classNames(s.root, focused ? s.focused : '', className ?? '')}>
      <input
        ref={ref}
        className={classNames('input-field-input', 'input-search-input', 'with-focus-effect', has ? '' : 'is-empty', s.input)}
        type="text"
        autoComplete="off"
        dir="auto"
        placeholder=" "
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <div className="input-field-border" />
      <span className={classNames('tgico', 'input-search-part', 'input-search-icon', 'will-animate', s.icon)}>
        <TgIcon name="search" size={24} />
      </span>
      {has && onClear && (
        <IconButton
          className={classNames('input-search-clear', 'input-search-part', 'input-search-button', s.clear)}
          size="small"
          onClick={onClear}
          aria-label="Clear"
        >
          <TgIcon name="close" size={20} />
        </IconButton>
      )}
      {!has && placeholder && (
        <span className={classNames('i18n', 'input-search-placeholder', 'will-animate', s.placeholder)}>{placeholder}</span>
      )}
      {!has && right && <span className={s.right}>{right}</span>}
    </div>
  )
})

export default InputSearch
