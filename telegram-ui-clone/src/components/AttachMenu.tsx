import TgIcon from './TgIcon'
import Menu, { MenuItem } from '../shared/ui/Menu'
import { useT } from '../i18n'

export default function AttachMenu({
  anchor,
  onClose,
  onPhotoVideo,
  onFile,
  onPoll,
  onLocation,
  onContact,
}: {
  anchor: { left: number; bottom: number }
  onClose: () => void
  onPhotoVideo?: () => void
  onFile?: () => void
  onPoll?: () => void
  onLocation?: () => void
  onContact?: () => void
}) {
  const t = useT()

  return (
    <Menu
      open
      onClose={onClose}
      style={{ left: anchor.left, bottom: anchor.bottom, transformOrigin: 'bottom left' }}
    >
      <MenuItem icon={<TgIcon name="image" size={20} />} label={t('Photo or Video')} onClick={onPhotoVideo ?? onClose} />
      <MenuItem icon={<TgIcon name="document" size={20} />} label={t('Document')} onClick={onFile ?? onClose} />
      {onLocation && <MenuItem icon={<TgIcon name="location" size={20} />} label={t('Location')} onClick={onLocation} />}
      {onContact && <MenuItem icon={<TgIcon name="newprivate" size={20} />} label={t('Contact')} onClick={onContact} />}
      {onPoll && <MenuItem icon={<TgIcon name="poll" size={20} />} label={t('Poll')} onClick={onPoll} />}
    </Menu>
  )
}
