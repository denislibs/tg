// Ряд «Архив» вверху списка чатов (tweb archiveDialog.tsx — псевдо-закреплённый
// элемент с index 0): градиентный аватар с иконкой архива, имена архивных чатов
// через запятую (непрочитанные — жирным), серый бейдж суммарного непрочитанного.
import { memo } from 'react'
import Text from '../shared/ui/Text'
import Badge from '../shared/ui/Badge'
import TgIcon from './TgIcon'
import type { Chat } from '../data'
import { useT } from '../i18n'
import s from './ArchiveRow.module.scss'

function ArchiveRow({ chats, onOpen }: { chats: Chat[]; onOpen: () => void }) {
  const t = useT()
  const unread = chats.reduce((sum, c) => sum + (c.unread ?? 0), 0)
  // tweb: до 10 имён, каждое обрезается до 20 символов
  const names = chats.slice(0, 10).map((c) => ({
    id: c.id,
    name: c.name.length > 20 ? c.name.slice(0, 20) + '…' : c.name,
    unread: !!c.unread,
  }))
  return (
    <div className={s.row} onClick={onOpen}>
      <div className={s.avatar}>
        <TgIcon name="archive" size={28} color="#fff" />
      </div>
      <div className={s.body}>
        <Text noWrap weight={500} size={16} color="var(--cl-title)">
          {t('Archived Chats')}
        </Text>
        <div className={s.subtitleRow}>
          <Text noWrap size={16} color="var(--cl-subtitle)" style={{ flex: 1 }}>
            {names.map((n, i) => (
              <span key={n.id} style={n.unread ? { color: 'var(--cl-title)' } : undefined}>
                {i > 0 && ', '}
                {n.name}
              </span>
            ))}
          </Text>
          {unread > 0 && <Badge muted>{unread}</Badge>}
        </div>
      </div>
    </div>
  )
}

export default memo(ArchiveRow)
