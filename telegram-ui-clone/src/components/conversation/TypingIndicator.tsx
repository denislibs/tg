// Animated peer-typing indicator, ported 1:1 from tweb (.peer-typing-text /
// .peer-typing-record + keyframes in index.css). Renders three bouncing dots
// for "typing" or a single blinking dot for "recording voice/round video".
// Rendered inline before the typing text: it uses vertical-align:middle so the
// dot aligns to the text's x-height centre (flex-centering sits it too high
// because Cyrillic lowercase has no ascenders). tweb nudges the record/upload
// variants up 1px on top of that.
import { memo } from 'react'
import { Box } from '@mui/material'
import type { TypingKind } from '../../core/hooks/useTypingLabel'

interface Props {
  kind: TypingKind
  color: string
}

function TypingIndicator({ kind, color }: Props) {
  if (kind === 'record') {
    // tweb .peer-typing-record: one 6px dot, recordBlink 1.25s infinite.
    return (
      <Box
        component="span"
        sx={{
          display: 'inline-block',
          verticalAlign: 'middle',
          transform: 'translateY(-1px)',
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: color,
          mr: '0.375rem',
          animation: 'recordBlink 1.25s infinite',
        }}
      />
    )
  }

  // tweb .peer-typing-text: three 6px dots, .6s linear infinite, staggered.
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        verticalAlign: 'middle',
        mr: '4px',
        '& > span': {
          display: 'inline-block',
          verticalAlign: 'middle',
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: color,
          mx: '0.5px',
          animationDuration: '0.6s',
          animationIterationCount: 'infinite',
          animationTimingFunction: 'linear',
          animationName: 'typingDotMiddle',
        },
        '& > span:first-of-type': { animationName: 'typingDotFirst' },
        '& > span:last-of-type': { animationName: 'typingDotLast' },
      }}
    >
      <span />
      <span />
      <span />
    </Box>
  )
}

export default memo(TypingIndicator)
