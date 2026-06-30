import TgIcon from './TgIcon'
import Menu, { MenuItem } from '../shared/ui/Menu'
import { useT } from '../i18n'

interface Props {
  open: boolean
  onClose: () => void
  onNewGroup?: () => void
  onNewPrivate?: () => void
  onNewChannel?: () => void
}

export default function ComposeMenu({ open, onClose, onNewGroup, onNewPrivate, onNewChannel }: Props) {
  const t = useT()
  return (
    <Menu
      open={open}
      onClose={onClose}
      style={{ left: 116, bottom: 96, transformOrigin: 'bottom right' }}
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
    </Menu>
  )
}
