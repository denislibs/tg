import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type PointerEvent } from 'react'
import classNames from '../../lib/classNames'
import { useRipple } from '../Ripple/useRipple'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** icon colour (cascades to the child TgIcon via currentColor) */
  color?: string
  /** 'small' tightens the padding; default 'medium' */
  size?: 'small' | 'medium'
  /** tweb `ButtonIcon(icon, {noRipple: true})` — без класса `rp` и без узла `div.c-ripple` */
  noRipple?: boolean
}

// Round icon button — port of tweb `ButtonIcon` (button.ts:17-45 + buttonIcon.ts):
// `button.btn-icon` (+ `.rp` и `div.c-ripple` ПЕРВЫМ ребёнком, если ripple не
// отключён). Настоящий <button> (a11y/клавиатура даром); все стандартные пропы
// кнопки проходят насквозь. forwardRef — для императивных рефов.
//
// отступление от tweb: наши добавки к `.btn-icon` (цвет из пропа, компактный
// size='small', flex-shrink) идут ИНЛАЙНОМ, а не классом CSS-модуля. Во-первых,
// так в DOM остаётся ровно `button.btn-icon` из tweb, без хеш-класса модуля.
// Во-вторых, глобальные партиалы попадают в бандл ПОСЛЕ CSS-модулей, и при равной
// специфичности `.btn-icon` из `_button.scss` (`color`, `padding: .5rem`) перебивал
// модуль — пропы `color` и `size="small"` не работали вовсе.
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { color, size = 'medium', noRipple, className, style, type = 'button', onPointerDown, children, ...rest },
  ref,
) {
  const { onPointerDown: rippleDown, ripple } = useRipple()
  const cls = classNames('btn-icon', noRipple ? '' : 'rp', className ?? '')
  const st: CSSProperties = {
    // кнопка не должна сжиматься в узких флекс-шапках
    flexShrink: 0,
    ...(size === 'small' ? { padding: '0.3125rem' } : null),
    ...(color ? { color } : null),
    ...style,
  }
  const handlePointerDown = noRipple
    ? onPointerDown
    : (e: PointerEvent<HTMLButtonElement>) => {
        rippleDown(e)
        onPointerDown?.(e)
      }
  return (
    <button ref={ref} type={type} className={cls} style={st} onPointerDown={handlePointerDown} {...rest}>
      {noRipple ? null : ripple}
      {children}
    </button>
  )
})

export default IconButton
