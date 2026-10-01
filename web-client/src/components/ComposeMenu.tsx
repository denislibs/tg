import TgIcon from './TgIcon'
import Menu, { MenuItem } from '../shared/ui/Menu'
import { useT } from '../i18n'
import { SECRET_CHATS_ENABLED } from '../config/app'

interface Props {
  open: boolean
  /** позиция от FAB (right/bottom в px от краёв вьюпорта); null до первого открытия */
  anchor: { right: number; bottom: number } | null
  onClose: () => void
  onNewGroup?: () => void
  onNewPrivate?: () => void
  onNewChannel?: () => void
  onNewSecret?: () => void
}

export default function ComposeMenu({ open, anchor, onClose, onNewGroup, onNewPrivate, onNewChannel, onNewSecret }: Props) {
  const t = useT()
  return (
    <Menu
      open={open}
      onClose={onClose}
      corner="top-left"
      style={{ right: anchor?.right ?? 20, bottom: anchor?.bottom ?? 96 }}
    >
      <MenuItem
        icon={<TgIcon name="newchannel" size={20} />}
        label={t('NewChannel')}
        onClick={() => {
          onClose()
          onNewChannel?.()
        }}
      />
      <MenuItem
        icon={<TgIcon name="newgroup" size={20} />}
        label={t('NewGroup')}
        onClick={() => {
          onClose()
          onNewGroup?.()
        }}
      />
      <MenuItem
        icon={<TgIcon name="newprivate" size={20} />}
        label={t('NewPrivateChat')}
        onClick={() => {
          onClose()
          onNewPrivate?.()
        }}
      />
      {/* Отступление В7-1: секретных чатов у tweb нет; вход скрыт флагом
          `SECRET_CHATS_ENABLED` (решение пользователя 2026-10-01, `config/app.ts`). */}
      {SECRET_CHATS_ENABLED && (
        <MenuItem
          icon={<TgIcon name="lock" size={20} />}
          label={t('SecretChat.New')}
          onClick={() => {
            onClose()
            onNewSecret?.()
          }}
        />
      )}
    </Menu>
  )
}
