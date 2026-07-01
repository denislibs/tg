import TgIcon from './TgIcon'
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
  const t = useT()
  const me = useChatsStore((s) => s.me)
  const meAvatar = useAvatarSrc(me?.avatarUrl)
  const meName = me?.displayName?.trim() || [me?.firstName, me?.lastName].filter(Boolean).join(' ').trim() || me?.username || 'Аккаунт'
  const divider = (
    <div style={{ height: '1px', background: 'var(--tg-divider)', margin: '6px 0' }} />
  )

  return (
    <Menu
      open={open}
      onClose={onClose}
      style={{ top: 68, left: 22, transformOrigin: 'top left' }}
    >
      {/* Account row — same height as items, small ringed avatar in the icon slot (tweb) */}
      <MenuItem
        icon={
          <span style={{ padding: 2, borderRadius: '50%', border: '2px solid var(--tg-accent)', display: 'flex' }}>
            <Avatar background={gradientFor(me?.id ?? 0)} text={meName.charAt(0).toUpperCase()} src={meAvatar} size={26} />
          </span>
        }
        label={meName}
        onClick={onClose}
      />
      <MenuItem icon={<TgIcon name="add" size={20} />} label={t('Add Account')} onClick={onClose} />
      {divider}
      <MenuItem icon={<TgIcon name="savedmessages" size={20} />} label={t('Saved Messages')} onClick={onOpenSaved ?? onClose} />
      <MenuItem icon={<TgIcon name="radiooff" size={20} />} label={t('My Stories')} onClick={onClose} />
      <MenuItem icon={<TgIcon name="user" size={20} />} label={t('Contacts')} onClick={onOpenContacts ?? onClose} />
      {divider}
      <MenuItem icon={<TgIcon name="card_outline" size={20} />} label={t('Wallet')} onClick={onClose} />
      <MenuItem
        icon={<TgIcon name="star_filled" size={20} color="var(--tg-accent)" />}
        label={t('Telegram Premium')}
        onClick={onOpenPremium ?? onClose}
      />
      {divider}
      <MenuItem icon={<TgIcon name="settings" size={20} />} label={t('Settings')} onClick={onOpenSettings} />
      <MenuItem
        icon={<TgIcon name="more" size={20} />}
        label={t('More')}
        right={<TgIcon name="next" size={20} color="var(--tg-textFaint)" />}
        onClick={onClose}
      />
      {onLogout && (
        <>
          {divider}
          <MenuItem icon={<TgIcon name="logout" size={20} />} label={t('Log Out')} danger onClick={onLogout} />
        </>
      )}
    </Menu>
  )
}
