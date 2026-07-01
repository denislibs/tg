// Animated peer-typing indicator, ported 1:1 from tweb (.peer-typing-text /
// .peer-typing-record + keyframes in styles/index.scss). Renders three bouncing dots
// for "typing" or a single blinking dot for "recording voice/round video".
// Rendered inline before the typing text: it uses vertical-align:middle so the
// dot aligns to the text's x-height centre (flex-centering sits it too high
// because Cyrillic lowercase has no ascenders). tweb nudges the record/upload
// variants up 1px on top of that.
import { memo, type CSSProperties } from 'react'
import type { TypingKind } from '../../core/hooks/useTypingLabel'
import s from './TypingIndicator.module.scss'

interface Props {
  kind: TypingKind
  color: string
}

function TypingIndicator({ kind, color }: Props) {
  const style = { '--typing-color': color } as CSSProperties

  // tweb .peer-typing-record: one 6px dot, recordBlink 1.25s infinite.
  if (kind === 'record') {
    return <span className={s.record} style={style} />
  }

  // tweb .peer-typing-text: three 6px dots, .6s linear infinite, staggered.
  return (
    <span className={s.dots} style={style}>
      <span />
      <span />
      <span />
    </span>
  )
}

export default memo(TypingIndicator)
