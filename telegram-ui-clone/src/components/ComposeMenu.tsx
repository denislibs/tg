import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Box, Typography, useTheme } from '@mui/material'
import { motion } from 'framer-motion'
import CampaignRounded from '@mui/icons-material/CampaignRounded'
import GroupRounded from '@mui/icons-material/GroupRounded'
import PersonRounded from '@mui/icons-material/PersonRounded'
import { useT } from '../i18n'

interface Props {
  open: boolean
  onClose: () => void
  onNewGroup?: () => void
  onNewPrivate?: () => void
  onNewChannel?: () => void
}

function Row({ icon, label, onClick }: { icon: ReactNode; label: string; onClick?: () => void }) {
  const tg = useTheme().tg
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 1.5,
        py: 0.6,
        mx: 0.5,
        borderRadius: '8px',
        cursor: 'pointer',
        '&:hover': { background: tg.hover },
      }}
    >
      <Box sx={{ color: tg.textPrimary, display: 'flex', '& svg': { fontSize: 20 } }}>{icon}</Box>
      <Typography sx={{ fontSize: 14.5, fontWeight: 500, color: tg.textPrimary, whiteSpace: 'nowrap' }}>
        {label}
      </Typography>
    </Box>
  )
}

export default function ComposeMenu({ open, onClose, onNewGroup, onNewPrivate, onNewChannel }: Props) {
  const tg = useTheme().tg
  const t = useT()
  if (!open) return null
  return createPortal(
    <>
      <Box onClick={onClose} sx={{ position: 'fixed', inset: 0, zIndex: 2000 }} />
      <Box
        sx={{
          position: 'fixed',
          left: 116,
          bottom: 96,
          zIndex: 2001,
          width: 240,
              background: tg.menuBg,
              backdropFilter: 'blur(40px)',
              WebkitBackdropFilter: 'blur(40px)',
              borderRadius: '14px',
              boxShadow: tg.menuShadow,
              py: 0.75,
              transformOrigin: 'bottom right',
            }}
          >
            <Box
              component={motion.div}
              initial={{ opacity: 0, scale: 0.88, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              sx={{ transformOrigin: 'bottom right' }}
            >
              <Row
                icon={<CampaignRounded />}
                label={t('New Channel')}
                onClick={() => {
                  onClose()
                  onNewChannel?.()
                }}
              />
              <Row
                icon={<GroupRounded />}
                label={t('New Group')}
                onClick={() => {
                  onClose()
                  onNewGroup?.()
                }}
              />
              <Row
                icon={<PersonRounded />}
                label={t('New Private Chat')}
                onClick={() => {
                  onClose()
                  onNewPrivate?.()
                }}
              />
            </Box>
      </Box>
    </>,
    document.body
  )
}
