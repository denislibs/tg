import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type PointerEvent } from 'react'
import classNames from '../../lib/classNames'
import { useRipple } from '../Ripple/useRipple'
import s from './IconButton.module.scss'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** icon colour (cascades to the child TgIcon via currentColor) */
  color?: string
  /** 'small' tightens the padding (MUI parity); default 'medium' */
  size?: 'small' | 'medium'
}

// Round icon button — port of tweb `.btn-icon` (+ tweb ripple). A real <button>
// (a11y/keyboard for free); all standard button props pass straight through. The
// icon colour rides in as the --ib-color CSS variable. forwardRef so framer-motion
// (motion(IconButton)) and imperative refs work.
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { color, size = 'medium', className, style, type = 'button', onPointerDown, children, ...rest },
  ref,
) {
  const { onPointerDown: rippleDown, ripple } = useRipple()
  const cls = classNames(s.root, size === 'small' ? s.small : '', className ?? '')
  const st = color ? ({ '--ib-color': color, ...style } as CSSProperties) : style
  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    rippleDown(e)
    onPointerDown?.(e)
  }
  return (
    <button ref={ref} type={type} className={cls} style={st} onPointerDown={handlePointerDown} {...rest}>
      {children}
      {ripple}
    </button>
  )
})

export default IconButton
