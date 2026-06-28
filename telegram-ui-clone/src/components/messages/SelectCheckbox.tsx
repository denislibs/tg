// Round selection checkbox, ported from tweb's .checkbox-field-round:
// an unchecked ring; when checked, an accent circle scales in (.2s, .05s delay,
// ease-in-out) and a white checkmark draws (.15s delay). Used in multi-select.
import { Box } from '@mui/material'
import { motion } from 'framer-motion'

const EASE = 'easeInOut' as const

export default function SelectCheckbox({ checked, accent, ring, size = 18 }: {
  checked: boolean
  accent: string
  ring: string
  size?: number
}) {
  return (
    <Box sx={{ width: size, height: size, position: 'relative', flexShrink: 0 }}>
      {/* unchecked ring */}
      <Box sx={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `1.5px solid ${ring}`, boxSizing: 'border-box' }} />
      {/* filled circle (scales in) */}
      <Box
        component={motion.div}
        initial={false}
        animate={{ scale: checked ? 1 : 0 }}
        transition={{ duration: 0.2, delay: checked ? 0.05 : 0, ease: EASE }}
        sx={{ position: 'absolute', inset: 0, borderRadius: '50%', background: accent }}
      />
      {/* checkmark (draws after the circle) — tighter path inside the circle */}
      <Box component="svg" viewBox="0 0 24 24" sx={{ position: 'absolute', inset: 0, width: size, height: size }}>
        <motion.path
          d="M7 12.5 L10.5 16 L17 8.5"
          fill="none"
          stroke="#fff"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={{ duration: 0.15, delay: checked ? 0.15 : 0, ease: EASE }}
        />
      </Box>
    </Box>
  )
}
