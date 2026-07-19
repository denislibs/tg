import { useRef, useState } from 'react'
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
  // Закрытие в два шага: пункт/клик-мимо гасят open (играет exit-анимация
  // ui-kit Menu), действие пункта и анмаунт владельца — после onExitComplete.
  const [open, setOpen] = useState(true)
  const pending = useRef<(() => void) | undefined>(undefined)
  const pick = (fn?: () => void) => () => { pending.current = fn; setOpen(false) }

  return (
    <Menu
      open={open}
      onClose={() => setOpen(false)}
      onExitComplete={() => { onClose(); pending.current?.() }}
      style={{ left: anchor.left, bottom: anchor.bottom, transformOrigin: 'bottom left' }}
    >
      <MenuItem icon={<TgIcon name="image" size={20} />} label={t('Photo or Video')} onClick={pick(onPhotoVideo)} />
      <MenuItem icon={<TgIcon name="document" size={20} />} label={t('Document')} onClick={pick(onFile)} />
      {onLocation && <MenuItem icon={<TgIcon name="location" size={20} />} label={t('Location')} onClick={pick(onLocation)} />}
      {onContact && <MenuItem icon={<TgIcon name="newprivate" size={20} />} label={t('Contact')} onClick={pick(onContact)} />}
      {onPoll && <MenuItem icon={<TgIcon name="poll" size={20} />} label={t('Poll')} onClick={pick(onPoll)} />}
    </Menu>
  )
}
