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

// Rounded search field — port of tweb .input-search.old-style. Controlled value;
// the placeholder is a positioned label (tweb), the clear button shows when filled.
const InputSearch = forwardRef<HTMLInputElement, InputSearchProps>(function InputSearch(
  { value, onChange, onFocus, onBlur, placeholder, focused, onClear, right, className },
  ref,
) {
  const has = value.length > 0
  return (
    <div className={classNames(s.root, focused ? s.focused : '', className ?? '')}>
      <input
        ref={ref}
        className={s.input}
        type="text"
        autoComplete="off"
        dir="auto"
        placeholder=" "
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <span className={s.icon}>
        <TgIcon name="search" size={24} />
      </span>
      {!has && placeholder && <span className={s.placeholder}>{placeholder}</span>}
      {has && onClear && (
        <IconButton className={s.clear} size="small" onClick={onClear} aria-label="Clear">
          <TgIcon name="close" size={20} />
        </IconButton>
      )}
      {!has && right && <span className={s.right}>{right}</span>}
    </div>
  )
})

export default InputSearch
