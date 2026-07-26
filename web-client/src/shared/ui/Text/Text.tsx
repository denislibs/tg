import type { CSSProperties, HTMLAttributes } from 'react'
import classNames from '../../lib/classNames'
import s from './Text.module.scss'

interface TextProps extends HTMLAttributes<HTMLDivElement> {
  /** font-size in px (same value used in the old sx) */
  size?: number
  /** font-weight */
  weight?: number
  /** color — a token var() or literal */
  color?: string
  /** single-line with ellipsis (MUI Typography `noWrap`) */
  noWrap?: boolean
}

// Text — replacement for MUI <Typography>. Renders a <div> (block, like Typography);
// size/weight/colour ride in as CSS variables, layout (flex/minWidth/margins) stays
// the caller's concern via `style`/`className`.
export default function Text({ size, weight, color, noWrap, className, style, children, ...rest }: TextProps) {
  const cls = classNames(s.root, noWrap ? s.noWrap : '', className ?? '')
  const vars: Record<string, string> = {}
  if (size != null) vars['--text-size'] = `${size}px`
  if (weight != null) vars['--text-weight'] = String(weight)
  if (color != null) vars['--text-color'] = color
  return (
    <div className={cls} style={{ ...vars, ...style } as CSSProperties} {...rest}>
      {children}
    </div>
  )
}
