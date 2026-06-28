import { Box, Typography, useTheme } from '@mui/material'
import TgIcon from './TgIcon'
import { motion } from 'framer-motion'
import PostImage from './PostImage'
import Reaction from './Reaction'

const MotionBox = motion(Box)

export default function MessageBubble() {
  const theme = useTheme()
  const tg = theme.tg
  const link = { color: tg.link, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }

  return (
    <MotionBox
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
      sx={{ maxWidth: 520, width: '100%' }}
    >
      <Box
        sx={{
          background: tg.bubble,
          border: `1px solid ${tg.bubbleBorder}`,
          borderRadius: '14px',
          overflow: 'hidden',
          boxShadow:
            theme.palette.mode === 'dark'
              ? '0 1px 2px rgba(0,0,0,0.4)'
              : '0 1px 3px rgba(0,0,0,0.08)',
        }}
      >
        {/* Photo */}
        <Box sx={{ overflow: 'hidden' }}>
          <PostImage />
        </Box>

        {/* Body */}
        <Box sx={{ px: 1.75, py: 1.5 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 15, mb: 1.25, color: tg.textPrimary }}>
            ОЧЕНЬ ВАЖНО!!!
          </Typography>

          <Typography sx={{ fontSize: 15, lineHeight: 1.5, mb: 1.5, color: tg.textPrimary }}>
            🧧 <Box component="span" sx={link}>Наш основной канал</Box> заблокировали у большинства
            подписчиков
          </Typography>

          <Typography sx={{ fontSize: 15, lineHeight: 1.5, mb: 1.5, color: tg.textPrimary }}>
            Причина? Алгоритмы решили, что у нас тут порнография. Очень суровый комплемент нашей
            индустрии 🤝
          </Typography>

          <Typography sx={{ fontSize: 15, lineHeight: 1.5, mb: 1.5, color: tg.textPrimary }}>
            Но мы не из тех, кто сдается после первого раунда. <Box component="span" sx={link}>Новый канал</Box>{' '}
            уже создан, весь контент перенесён, работа продолжается в штатном режиме.
          </Typography>

          <Typography sx={{ fontSize: 15, lineHeight: 1.5, mb: 1.5, color: tg.textPrimary }}>
            ГОСПОДА, <Box component="span" sx={link}>подписывайтесь на наш новый канал</Box>. Тут мы
            будем продолжать делать всё ровно то же самое, что делали и до этого.
          </Typography>

          <Typography sx={{ fontSize: 15, lineHeight: 1.5, mb: 0.5, color: tg.textPrimary }}>
            Так что жмем по ссылке и продолжаем
          </Typography>
          <Typography sx={{ fontSize: 15, lineHeight: 1.5, color: tg.textPrimary }}>
            👉<Box component="span" sx={link}>https://t.me/+Y4yhqW7nAQcxNDdi</Box>
          </Typography>

          {/* Reactions */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.75 }}>
            <Reaction emoji="⭐" highlighted />
            <Reaction emoji="👍" count={5} />
            <Reaction emoji="❤️" count={1} />
            <Box sx={{ flex: 1 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: tg.textFaint }}>
              <Typography sx={{ fontSize: 13.5 }}>1.5K</Typography>
              <TgIcon name="eye" size={17} />
              <Typography sx={{ fontSize: 13.5, ml: 0.5 }}>22:09</Typography>
            </Box>
          </Box>
        </Box>
      </Box>
    </MotionBox>
  )
}
