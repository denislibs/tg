import { Box, useTheme } from '@mui/material'
import TgIcon from './TgIcon'
import Text from '../shared/ui/Text'
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
          <Text weight={700} size={15} color={tg.textPrimary} style={{ marginBottom: '10px' }}>
            ОЧЕНЬ ВАЖНО!!!
          </Text>

          <Text size={15} color={tg.textPrimary} style={{ lineHeight: 1.5, marginBottom: '12px' }}>
            🧧 <Box component="span" sx={link}>Наш основной канал</Box> заблокировали у большинства
            подписчиков
          </Text>

          <Text size={15} color={tg.textPrimary} style={{ lineHeight: 1.5, marginBottom: '12px' }}>
            Причина? Алгоритмы решили, что у нас тут порнография. Очень суровый комплемент нашей
            индустрии 🤝
          </Text>

          <Text size={15} color={tg.textPrimary} style={{ lineHeight: 1.5, marginBottom: '12px' }}>
            Но мы не из тех, кто сдается после первого раунда. <Box component="span" sx={link}>Новый канал</Box>{' '}
            уже создан, весь контент перенесён, работа продолжается в штатном режиме.
          </Text>

          <Text size={15} color={tg.textPrimary} style={{ lineHeight: 1.5, marginBottom: '12px' }}>
            ГОСПОДА, <Box component="span" sx={link}>подписывайтесь на наш новый канал</Box>. Тут мы
            будем продолжать делать всё ровно то же самое, что делали и до этого.
          </Text>

          <Text size={15} color={tg.textPrimary} style={{ lineHeight: 1.5, marginBottom: '4px' }}>
            Так что жмем по ссылке и продолжаем
          </Text>
          <Text size={15} color={tg.textPrimary} style={{ lineHeight: 1.5 }}>
            👉<Box component="span" sx={link}>https://t.me/+Y4yhqW7nAQcxNDdi</Box>
          </Text>

          {/* Reactions */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.75 }}>
            <Reaction emoji="⭐" highlighted />
            <Reaction emoji="👍" count={5} />
            <Reaction emoji="❤️" count={1} />
            <Box sx={{ flex: 1 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: tg.textFaint }}>
              <Text size={13.5}>1.5K</Text>
              <TgIcon name="eye" size={17} />
              <Text size={13.5} style={{ marginLeft: '4px' }}>22:09</Text>
            </Box>
          </Box>
        </Box>
      </Box>
    </MotionBox>
  )
}
