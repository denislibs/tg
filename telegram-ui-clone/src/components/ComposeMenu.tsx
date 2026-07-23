import TgIcon from './TgIcon'
import Menu, { MenuItem } from '../shared/ui/Menu'
import { useT } from '../i18n'

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
      style={{ right: anchor?.right ?? 20, bottom: anchor?.bottom ?? 96, transformOrigin: 'bottom right' }}
    >
      <MenuItem
        icon={<TgIcon name="newchannel" size={20} />}
        label={t('New Channel')}
        onClick={() => {
          onClose()
          onNewChannel?.()
        }}
      />
      <MenuItem
        icon={<TgIcon name="newgroup" size={20} />}
        label={t('New Group')}
        onClick={() => {
          onClose()
          onNewGroup?.()
        }}
      />
      <MenuItem
        icon={<TgIcon name="newprivate" size={20} />}
        label={t('New Private Chat')}
        onClick={() => {
          onClose()
          onNewPrivate?.()
        }}
      />
      <MenuItem
        icon={<TgIcon name="lock" size={20} />}
        label={t('New Secret Chat')}
        onClick={() => {
          onClose()
          onNewSecret?.()
        }}
      />
    </Menu>
  )
}
