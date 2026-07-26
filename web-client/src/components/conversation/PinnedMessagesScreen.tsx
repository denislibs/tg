// Экран «Закреплённые сообщения» (tweb ChatType.Pinned: topbar.openPinned →
// фейковый чат из пинов; здесь — оверлей-панель в колонке чата по образцу
// ScheduledView). Шапка «N закреплённых сообщений» + крестик; компактные ряды
// (аватар + имя + текст/медиа-превью + время); клик — закрыть и прыгнуть к
// сообщению; кнопка на ряду — «Открепить»; внизу для тех, кто может пинить, —
// «Открепить все» (tweb chat input: Chat.Input.UnpinAll) с подтверждением.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import IconButton from '../../shared/ui/IconButton'
import UserAvatar from '../UserAvatar'
import ConfirmDialog from '../settings/ConfirmDialog'
import { useManagers } from '../../core/hooks/useManagers'
import { replyMediaLabel } from '../../core/messageToConvMsg'
import type { Message } from '../../core/models'
import type { Peer } from '../../core/managers/peersManager'
import { useT } from '../../i18n'
import { EASE } from '../../motion'
import s from './PinnedMessagesScreen.module.scss'

// Русские формы числительного (идиома проекта: UserInfoPanel.plural)
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

const hhmm = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function PinnedMessagesScreen({ chatId, pins, meId, meName, canUnpinAll, onJump, onClose }: {
  chatId: number
  /** пины чата (новейший первым) — live из pinsStore через родителя */
  pins: Message[]
  meId: number | null
  meName?: string
  /** право «Открепить все» (tweb canPinMessage) */
  canUnpinAll: boolean
  /** клик по ряду: родитель закрывает экран и прыгает к сообщению */
  onJump: (seq: number) => void
  onClose: () => void
}) {
  const t = useT()
  const managers = useManagers()
  const [peers, setPeers] = useState<Map<number, Peer>>(new Map())
  const [confirmAll, setConfirmAll] = useState(false)

  // Имена/аватары отправителей: пины могут быть вне окна истории, резолвим сами.
  useEffect(() => {
    const ids = [...new Set(pins.map((p) => p.senderId))].filter((id) => id > 0)
    if (!ids.length) return
    let alive = true
    void managers.peers.getUsers(ids).then((users) => {
      if (alive) setPeers(new Map(users.map((u) => [u.id, u])))
    }).catch(() => {})
    return () => { alive = false }
  }, [pins, managers])

  const unpin = (id: number) => { void managers.messages.unpin(chatId, id) }
  // «Открепить все»: цикл unpin по списку (rt:pin_message обновит pinsStore,
  // родитель закроет экран, когда пинов не останется).
  const unpinAll = async () => {
    for (const p of pins) {
      try { await managers.messages.unpin(chatId, p.id) } catch { /* нет права/гонка — пропускаем */ }
    }
  }

  const title = `${pins.length} ${plural(pins.length, 'закреплённое сообщение', 'закреплённых сообщения', 'закреплённых сообщений')}`

  return createPortal(
    <div className={s.overlay} onClick={onClose}>
      <motion.div
        className={s.card}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: EASE }}
      >
        <div className={s.header}>
          <Text size={17} weight={600} color="var(--tg-textPrimary)" style={{ flex: 1 }}>
            {title}
          </Text>
          <IconButton onClick={onClose} color="var(--tg-textSecondary)" aria-label={t('Close')}>
            <TgIcon name="close" size={22} />
          </IconButton>
        </div>
        <div className={s.list}>
          {pins.map((m) => {
            const mine = meId != null && m.senderId === meId
            const peer = peers.get(m.senderId)
            const name = mine ? (meName || t('You')) : (peer?.displayName || `ID ${m.senderId}`)
            return (
              <div key={m.id} className={s.row} onClick={() => onJump(m.seq)}>
                <UserAvatar id={m.senderId} name={name} avatarUrl={peer?.avatarUrl} size="sm" />
                <div className={s.rowBody}>
                  <div className={s.rowTop}>
                    <Text noWrap size={14} weight={600} color="var(--tg-textPrimary)" style={{ flex: 1 }}>
                      {name}
                    </Text>
                    <Text size={12} color="var(--tg-textFaint)">{hhmm(m.createdAt)}</Text>
                  </div>
                  <Text noWrap size={13.5} color={m.text ? 'var(--tg-textSecondary)' : 'var(--tg-accent)'}>
                    {m.text || replyMediaLabel(m.type) || t('Message')}
                  </Text>
                </div>
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); unpin(m.id) }}
                  color="var(--tg-textFaint)"
                  title={t('Unpin')}
                  aria-label={t('Unpin')}
                >
                  <TgIcon name="unpin" size={20} />
                </IconButton>
              </div>
            )
          })}
        </div>
        {canUnpinAll && (
          <div className={s.footer}>
            <button type="button" className={s.unpinAll} onClick={() => setConfirmAll(true)}>
              {t('Unpin All Messages')}
            </button>
          </div>
        )}
        {confirmAll && (
          <ConfirmDialog
            title={t('Unpin All Messages')}
            text={t('Are you sure you want to unpin all messages?')}
            action={t('Unpin')}
            danger
            onConfirm={() => { void unpinAll() }}
            onClose={() => setConfirmAll(false)}
          />
        )}
      </motion.div>
    </div>,
    document.body,
  )
}
