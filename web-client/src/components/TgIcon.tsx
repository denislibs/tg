// src/components/TgIcon.tsx
// Renders a Telegram tgico glyph (the same icon font tweb uses). A glyph is just a
// character at a PUA codepoint, so it's coloured via `color` and sized via
// `font-size` like any text. Names come from the ported tgico-icons map.
//
//   <TgIcon name="archive" />
//   <TgIcon name="checks" size={18} color="#3aa0e3" />
import type { CSSProperties } from 'react'
import Icons, { type IconName } from '../core/tgico-icons'

export type { IconName }

interface Props {
  name: IconName
  /** glyph size in px (maps to font-size); default 24 */
  size?: number
  /** glyph colour; defaults to currentColor (inherits text colour) */
  color?: string
  className?: string
  style?: CSSProperties
  onClick?: () => void
}

export default function TgIcon({ name, size = 24, color, className, style, onClick }: Props) {
  return (
    <span
      className={className ? `tgico ${className}` : 'tgico'}
      onClick={onClick}
      aria-hidden
      style={{ fontSize: size, color, display: 'inline-block', ...style }}
    >
      {String.fromCharCode(parseInt(Icons[name], 16))}
    </span>
  )
}
