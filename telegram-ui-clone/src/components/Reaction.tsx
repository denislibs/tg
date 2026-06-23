import { Box, Typography, useTheme } from '@mui/material'
import { motion } from 'framer-motion'

const MotionBox = motion(Box)

interface Props {
  emoji: string
  count?: number
  highlighted?: boolean
}

export default function Reaction({ emoji, count, highlighted }: Props) {
  const tg = useTheme().tg
  return (
    <MotionBox
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 500, damping: 22 }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        height: 30,
        px: count != null ? 1.25 : 0,
        width: count != null ? 'auto' : 30,
        justifyContent: 'center',
        borderRadius: 15,
        cursor: 'pointer',
        background: highlighted ? 'linear-gradient(135deg,#f7b733,#fc8a3b)' : tg.searchBg,
        color: highlighted ? '#fff' : tg.accent,
        userSelect: 'none',
      }}
    >
      <Typography component="span" sx={{ fontSize: 16, lineHeight: 1 }}>
        {emoji}
      </Typography>
      {count != null && (
        <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: tg.accent }}>{count}</Typography>
      )}
    </MotionBox>
  )
}
