import { Box, Typography, useTheme } from '@mui/material'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded'
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded'
import { motion } from 'framer-motion'
import { useT } from '../i18n'

const MotionBox = motion(Box)

const commenters = [
  { bg: 'linear-gradient(135deg,#ff5f6d,#ffc371)', label: 'ДЧ' },
  { bg: 'linear-gradient(135deg,#43e97b,#38f9d7)', label: '' },
  { bg: 'linear-gradient(135deg,#5b5b5b,#1a1a1a)', label: '' },
]

export default function CommentsBar({ onOpen }: { onOpen?: () => void }) {
  const t = useT()
  const tg = useTheme().tg

  const roundBtn = {
    width: 44,
    height: 44,
    borderRadius: '50%',
    background: tg.bubble,
    border: `1px solid ${tg.bubbleBorder}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, maxWidth: 520, width: '100%', mt: 0.75 }}>
      <MotionBox
        onClick={onOpen}
        whileHover={{ background: tg.hover }}
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          background: tg.bubble,
          border: `1px solid ${tg.bubbleBorder}`,
          borderRadius: '14px',
          px: 1.5,
          py: 1.25,
          cursor: 'pointer',
        }}
      >
        <Box sx={{ display: 'flex' }}>
          {commenters.map((c, i) => (
            <Box
              key={i}
              sx={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: c.bg,
                ml: i === 0 ? 0 : '-9px',
                border: `2px solid ${tg.bubble}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 700,
                color: '#fff',
              }}
            >
              {c.label}
            </Box>
          ))}
        </Box>
        <Typography sx={{ flex: 1, fontSize: 14.5, fontWeight: 600, color: tg.accent }}>
          4 {t('Comments')}
        </Typography>
        <ChevronRightRoundedIcon sx={{ color: tg.textFaint }} />
      </MotionBox>

      <MotionBox whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.9 }} sx={roundBtn}>
        <FavoriteRoundedIcon sx={{ fontSize: 20, color: '#ff3b5c' }} />
      </MotionBox>
      <MotionBox whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.9 }} sx={roundBtn}>
        <ReplyRoundedIcon sx={{ fontSize: 20, color: tg.textSecondary, transform: 'scaleX(-1)' }} />
      </MotionBox>
    </Box>
  )
}
