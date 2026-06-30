import { Box, useTheme } from '@mui/material'
import TgIcon from './TgIcon'
import Text from '../shared/ui/Text'
import Avatar from '../shared/ui/Avatar'
import Menu, { MenuItem } from '../shared/ui/Menu'
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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1 }}>
        <Box sx={{ p: '2px', borderRadius: '50%', border: `2px solid ${tg.accent}`, display: 'flex' }}>
          <Avatar background={gradientFor(me?.id ?? 0)} text={meName.charAt(0).toUpperCase()} src={meAvatar} size={30} />
        </Box>
        <Text noWrap size={15} weight={600} color={tg.textPrimary} style={{ maxWidth: 200 }}>
          {meName}
        </Text>
      </Box>
      <MenuItem icon={<TgIcon name="add" size={24} />} label={t('Add Account')} onClick={onClose} />
      {divider}
      <MenuItem icon={<TgIcon name="savedmessages" size={24} />} label={t('Saved Messages')} onClick={onOpenSaved ?? onClose} />
      <MenuItem icon={<TgIcon name="radiooff" size={24} />} label={t('My Stories')} onClick={onClose} />
      <MenuItem icon={<TgIcon name="user" size={24} />} label={t('Contacts')} onClick={onOpenContacts ?? onClose} />
      {divider}
      <MenuItem icon={<TgIcon name="card_outline" size={24} />} label={t('Wallet')} onClick={onClose} />
      <MenuItem
        icon={<TgIcon name="star_filled" size={24} color={tg.accent} />}
        label={t('Telegram Premium')}
        onClick={onOpenPremium ?? onClose}
      />
      {divider}
      <MenuItem icon={<TgIcon name="settings" size={24} />} label={t('Settings')} onClick={onOpenSettings} />
      <MenuItem
        icon={<TgIcon name="more" size={24} />}
        label={t('More')}
        right={<TgIcon name="next" size={20} color={tg.textFaint} />}
        onClick={onClose}
      />
      {onLogout && (
        <>
          {divider}
          <MenuItem icon={<TgIcon name="logout" size={24} />} label={t('Log Out')} danger onClick={onLogout} />
        </>
      )}
    </Menu>
  )
}
