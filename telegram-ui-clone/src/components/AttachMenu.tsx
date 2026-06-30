import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Box, useTheme } from '@mui/material'
import { motion } from 'framer-motion'
import TgIcon from './TgIcon'
import Text from '../shared/ui/Text'
import { EASE } from '../motion'
import { useT } from '../i18n'

function Row({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  const tg = useTheme().tg
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.75,
        px: 1.75,
        py: 0.7,
        mx: 0.5,
        borderRadius: '8px',
        cursor: 'pointer',
        '&:hover': { background: tg.hover },
      }}
    >
      <Box sx={{ display: 'flex', color: tg.textSecondary, '& svg': { fontSize: 22 } }}>{icon}</Box>
      <Text size={15} color={tg.textPrimary} style={{ whiteSpace: 'nowrap' }}>
        {label}
      </Text>
    </Box>
  )
}

export default function AttachMenu({
  anchor,
  onClose,
  onPhotoVideo,
  onFile,
}: {
  anchor: { left: number; bottom: number }
  onClose: () => void
  onPhotoVideo?: () => void
  onFile?: () => void
}) {
  const tg = useTheme().tg
  const t = useT()

  return createPortal(
    <>
      <Box onClick={onClose} sx={{ position: 'fixed', inset: 0, zIndex: 2000 }} />
      <Box
        component={motion.div}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: EASE }}
        sx={{
          position: 'fixed',
          left: anchor.left,
          bottom: anchor.bottom,
          zIndex: 2001,
          minWidth: 200,
          py: 0.75,
          borderRadius: '12px',
          background: tg.menuBg,
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          boxShadow: tg.menuShadow,
          transformOrigin: 'bottom left',
        }}
      >
        <Row icon={<TgIcon name="image" size={22} />} label={t('Photo or Video')} onClick={onPhotoVideo ?? onClose} />
        <Row icon={<TgIcon name="document" size={22} />} label={t('Document')} onClick={onFile ?? onClose} />
        <Row icon={<TgIcon name="poll" size={22} />} label={t('Poll')} onClick={onClose} />
      </Box>
    </>,
    document.body
  )
}
