import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Box, Typography, useTheme } from '@mui/material'
import { motion } from 'framer-motion'
import TgIcon from './TgIcon'
import Avatar from './Avatar'
import { useAvatarSrc } from './useAvatarSrc'
import { useChatsStore } from '../stores/chatsStore'
import { gradientFor } from '../core/dialogToChat'
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
      {chevron && <TgIcon name="next" size={20} color={tg.textFaint} />}
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
  const me = useChatsStore((s) => s.me)
  const meAvatar = useAvatarSrc(me?.avatarUrl)
  const meName = me?.displayName?.trim() || [me?.firstName, me?.lastName].filter(Boolean).join(' ').trim() || me?.username || 'Аккаунт'
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
                  <Avatar
                    background={gradientFor(me?.id ?? 0)}
                    text={meName.charAt(0).toUpperCase()}
                    src={meAvatar}
                    size={30}
                  />
                </Box>
                <Typography noWrap sx={{ fontSize: 15, fontWeight: 600, color: tg.textPrimary, maxWidth: 200 }}>
                  {meName}
                </Typography>
              </Box>
              <Row icon={<TgIcon name="add" size={20} />} label={t('Add Account')} onClick={onClose} />
              {divider}
              <Row
                icon={<TgIcon name="savedmessages" size={20} />}
                label={t('Saved Messages')}
                onClick={onOpenSaved ?? onClose}
              />
              <Row icon={<TgIcon name="radiooff" size={20} />} label={t('My Stories')} onClick={onClose} />
              <Row
                icon={<TgIcon name="user" size={20} />}
                label={t('Contacts')}
                onClick={onOpenContacts ?? onClose}
              />
              {divider}
              <Row icon={<TgIcon name="card_outline" size={20} />} label={t('Wallet')} onClick={onClose} />
              <Row
                icon={<TgIcon name="star_filled" size={20} color={tg.accent} />}
                label={t('Telegram Premium')}
                onClick={onOpenPremium ?? onClose}
              />
              {divider}
              <Row icon={<TgIcon name="settings" size={20} />} label={t('Settings')} onClick={onOpenSettings} />
              <Row icon={<TgIcon name="more" size={20} />} label={t('More')} chevron onClick={onClose} />
              {onLogout && (
                <>
                  {divider}
                  <Row icon={<TgIcon name="logout" size={20} />} label={t('Log Out')} danger onClick={onLogout} />
                </>
              )}
            </Box>
          </Box>
        </>,
    document.body
  )
}
