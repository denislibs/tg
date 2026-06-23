import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Box, Typography, useTheme } from '@mui/material'
import { motion } from 'framer-motion'
import AddRounded from '@mui/icons-material/AddRounded'
import BookmarkBorderRounded from '@mui/icons-material/BookmarkBorderRounded'
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded'
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded'
import AccountBalanceWalletOutlined from '@mui/icons-material/AccountBalanceWalletOutlined'
import SettingsOutlined from '@mui/icons-material/SettingsOutlined'
import StarRounded from '@mui/icons-material/StarRounded'
import MoreVertRounded from '@mui/icons-material/MoreVertRounded'
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded'
import LogoutRounded from '@mui/icons-material/LogoutRounded'
import Avatar from './Avatar'
import { useT } from '../i18n'

interface Props {
  open: boolean
  onClose: () => void
  onOpenSettings: () => void
  onOpenContacts?: () => void
  onOpenSaved?: () => void
  onOpenPremium?: () => void
  onLogout?: () => void
}

function Row({
  icon,
  label,
  chevron,
  danger,
  onClick,
}: {
  icon: ReactNode
  label: string
  chevron?: boolean
  danger?: boolean
  onClick?: () => void
}) {
  const tg = useTheme().tg
  const color = danger ? '#ff595a' : undefined
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
      <Box sx={{ color: color ?? tg.textSecondary, display: 'flex', '& svg': { fontSize: 20 } }}>{icon}</Box>
      <Typography sx={{ flex: 1, fontSize: 14.5, color: color ?? tg.textPrimary }}>{label}</Typography>
      {chevron && <ChevronRightRounded sx={{ color: tg.textFaint, fontSize: 20 }} />}
    </Box>
  )
}

export default function MainMenu({
  open,
  onClose,
  onOpenSettings,
  onOpenContacts,
  onOpenSaved,
  onOpenPremium,
  onLogout,
}: Props) {
  const tg = useTheme().tg
  const t = useT()
  const divider = (
    <Box sx={{ height: '1px', background: tg.divider, mx: 0, my: 0.75 }} />
  )

  if (!open) return null

  return createPortal(
    <>
      <Box onClick={onClose} sx={{ position: 'fixed', inset: 0, zIndex: 2000 }} />
      <Box
        sx={{
          position: 'fixed',
          top: 68,
          left: 22,
          zIndex: 2001,
          width: 300,
              background: tg.menuBg,
              backdropFilter: 'blur(40px)',
              WebkitBackdropFilter: 'blur(40px)',
              borderRadius: '14px',
              boxShadow: tg.menuShadow,
              py: 0.75,
              transformOrigin: 'top left',
            }}
          >
            <Box
              component={motion.div}
              initial={{ opacity: 0, scale: 0.95, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              sx={{ transformOrigin: 'top left' }}
            >
              {/* Account */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 0.75 }}>
                <Box
                  sx={{
                    p: '2px',
                    borderRadius: '50%',
                    border: `2px solid ${tg.accent}`,
                    display: 'flex',
                  }}
                >
                  <Avatar background="linear-gradient(135deg,#ff8a5b,#ff6a3d)" text="Д" size={30} />
                </Box>
                <Typography sx={{ fontSize: 15, fontWeight: 600, color: tg.textPrimary }}>
                  Дн
                </Typography>
              </Box>
              <Row icon={<AddRounded />} label={t('Add Account')} onClick={onClose} />
              {divider}
              <Row
                icon={<BookmarkBorderRounded />}
                label={t('Saved Messages')}
                onClick={onOpenSaved ?? onClose}
              />
              <Row icon={<RadioButtonUncheckedRounded />} label={t('My Stories')} onClick={onClose} />
              <Row
                icon={<PersonOutlineRounded />}
                label={t('Contacts')}
                onClick={onOpenContacts ?? onClose}
              />
              {divider}
              <Row icon={<AccountBalanceWalletOutlined />} label={t('Wallet')} onClick={onClose} />
              <Row
                icon={<StarRounded sx={{ color: tg.accent }} />}
                label={t('Telegram Premium')}
                onClick={onOpenPremium ?? onClose}
              />
              {divider}
              <Row icon={<SettingsOutlined />} label={t('Settings')} onClick={onOpenSettings} />
              <Row icon={<MoreVertRounded />} label={t('More')} chevron onClick={onClose} />
              {onLogout && (
                <>
                  {divider}
                  <Row icon={<LogoutRounded />} label={t('Log Out')} danger onClick={onLogout} />
                </>
              )}
            </Box>
          </Box>
        </>,
    document.body
  )
}
