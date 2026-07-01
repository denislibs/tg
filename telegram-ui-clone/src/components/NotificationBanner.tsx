import { Box, useTheme } from '@mui/material'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { motion } from 'framer-motion'
import { useT } from '../i18n'

interface Props {
  onClose: () => void
}

export default function NotificationBanner({ onClose }: Props) {
  const tg = useTheme().tg
  const t = useT()
  return (
    <motion.div
      initial={{ opacity: 0, height: 0, marginBottom: 0 }}
      animate={{ opacity: 1, height: 'auto', marginBottom: 8 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
      style={{ overflow: 'hidden' }}
    >
      <Box
        sx={{
          mx: 1.5,
          mt: 1,
          px: 2,
          py: 1.5,
          borderRadius: '16px',
          background: tg.bannerBg,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Text weight={600} size={15} color={tg.textPrimary}>
            {t('Never miss a message! 🔔')}
          </Text>
          <Text size={14} color={tg.textSecondary} style={{ marginTop: '2px' }}>
            {t('Enable notifications to stay updated.')}
          </Text>
        </Box>
        <IconButton size="small" onClick={onClose} color={tg.textFaint} style={{ marginTop: '-4px', marginRight: '-4px' }}>
          <TgIcon name="close" size={20} />
        </IconButton>
      </Box>
    </motion.div>
  )
}
