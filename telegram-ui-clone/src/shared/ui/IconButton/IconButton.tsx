import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from 'react'
import classNames from '../../lib/classNames'
import s from './IconButton.module.scss'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** icon colour (cascades to the child TgIcon via currentColor) */
  color?: string
  /** 'small' tightens the padding (MUI parity); default 'medium' */
  size?: 'small' | 'medium'
}

// Round icon button — port of tweb `.btn-icon`. A real <button> (a11y/keyboard
// for free); all standard button props (onClick, disabled, aria-label, title,
// onContextMenu, style, className…) pass straight through. The icon colour rides
// in as the --ib-color CSS variable. forwardRef so framer-motion (motion(IconButton))
// and imperative refs work.
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { color, size = 'medium', className, style, type = 'button', children, ...rest },
  ref,
) {
  const cls = classNames(s.root, size === 'small' ? s.small : '', className ?? '')
  const st = color ? ({ '--ib-color': color, ...style } as CSSProperties) : style
  return (
    <button ref={ref} type={type} className={cls} style={st} {...rest}>
      {children}
    </button>
  )
})

export default IconButton
