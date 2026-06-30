import type { ReactNode } from 'react'
import { Box, useTheme } from '@mui/material'
import TgIcon from './TgIcon'
import Text from '../shared/ui/Text'
import Avatar from '../shared/ui/Avatar'
import Menu from '../shared/ui/Menu'
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
      <Text size={14.5} color={color ?? tg.textPrimary} style={{ flex: 1 }}>{label}</Text>
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

  return (
    <Menu
      open={open}
      onClose={onClose}
      style={{ top: 68, left: 22, width: 300, borderRadius: '14px', transformOrigin: 'top left' }}
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
                <Text noWrap size={15} weight={600} color={tg.textPrimary} style={{ maxWidth: 200 }}>
                  {meName}
                </Text>
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
    </Menu>
  )
}
