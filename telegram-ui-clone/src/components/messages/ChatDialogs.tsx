import { useRef, useState } from 'react'
// Presentational chat dialogs/popups extracted from ConversationView: delete
// confirm, forward target picker, "seen by" popup, add-member picker, and the
// discard-voice confirm. Each is dumb — it self-sources i18n + motion constants
// and emits its actions via callbacks; the parent owns the state.
import Text from '../../shared/ui/Text'
import classNames from '../../shared/lib/classNames'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import { EASE } from '../../motion'
import { useT } from '../../i18n'
import Avatar from '../../shared/ui/Avatar'
import Checkbox from '../../shared/ui/Checkbox'
import Popup from '../../shared/ui/Popup'
import { peerColor } from '../peerColor'
import type { Dialog } from '../../core/models'
import s from './ChatDialogs.module.scss'

// Only the fields the add-member list renders (Dialog.peer is narrower than the
// full Peer type, so we keep this minimal and structurally compatible).

const EASE_STD = EASE

// Delete confirmation (for me / for everyone).
export function DeleteMessageDialog({ canRevoke, onDeleteForEveryone, onDeleteForMe, onClose }: {
  canRevoke: boolean
  onDeleteForEveryone: () => void
  onDeleteForMe: () => void
  onClose: () => void
}) {
  const t = useT()
  return createPortal(
    <div className={s.overlay} onClick={onClose}>
      <motion.div
        className={classNames(s.card, s.confirm)}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: EASE_STD }}
      >
        <Text size={17} weight={600} color="var(--tg-textPrimary)" style={{ marginBottom: '8px' }}>{t('Delete message')}</Text>
        <Text size={14.5} color="var(--tg-textSecondary)" style={{ marginBottom: '16px' }}>{t('Are you sure you want to delete this message?')}</Text>
        <div className={s.confirmActions}>
          {canRevoke && (
            <div className={classNames(s.action, s.danger)} onClick={onDeleteForEveryone}>{t('Delete for everyone')}</div>
          )}
          <div className={classNames(s.action, s.danger)} onClick={onDeleteForMe}>{t('Delete for me')}</div>
          <div className={s.action} onClick={onClose}>{t('Cancel')}</div>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}

// Forward target picker: multi-select dialogs to forward the selected messages
// into. Rows toggle a checkbox; the accent «Переслать (N)» button forwards to all
// selected chats at once (tweb popup-forward allows multiple targets).
export function ForwardPicker({ dialogs, hasCaption, onPick, onClose }: {
  dialogs: Dialog[]
  // Среди пересылаемых есть медиа с подписью — показывать тумблер «Убрать подпись».
  hasCaption?: boolean
  onPick: (chatIds: number[], opts: { dropAuthor: boolean; dropCaption: boolean }) => void
  onClose: () => void
}) {
  const t = useT()
  const [q, setQ] = useState('')
  // exit-анимация: закрытие/выбор сначала гасят open; колбэк владельцу (который
  // размонтирует пикер) — только из onExitComplete, когда карточка уехала.
  const [open, setOpen] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // Опции пересылки (tweb forwardElements): скрыть отправителя / убрать подпись.
  // Каждый тумблер — два состояния; лейбл описывает действие, которое выполнит клик.
  const [dropAuthor, setDropAuthor] = useState(false)
  const [dropCaption, setDropCaption] = useState(false)
  // Подтверждённый выбор фиксируем в ref: onExitComplete отработает уже после
  // того, как selected сбросится размонтированием, поэтому берём снимок здесь.
  const confirmed = useRef<{ chatIds: number[]; dropAuthor: boolean; dropCaption: boolean } | null>(null)
  const toggle = (chatId: number) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(chatId)) next.delete(chatId); else next.add(chatId)
    return next
  })
  const confirm = () => {
    if (selected.size) { confirmed.current = { chatIds: [...selected], dropAuthor, dropCaption }; setOpen(false) }
  }
  const query = q.trim().toLowerCase()
  const rows = dialogs
    .map((d) => ({
      chatId: d.chatId,
      title: d.title || d.peer?.displayName || `Чат ${d.chatId}`,
      sub: d.type === 'channel' ? t('Channel') : d.type === 'group' ? t('Group') : t('Private Chat'),
    }))
    .filter((r) => !query || r.title.toLowerCase().includes(query))
  return (
    <Popup
      open={open}
      title={t('Send')}
      onClose={() => setOpen(false)}
      onExitComplete={() => { const c = confirmed.current; if (c) onPick(c.chatIds, { dropAuthor: c.dropAuthor, dropCaption: c.dropCaption }); else onClose() }}
      action={selected.size ? { label: `${t('Forward')} (${selected.size})`, onClick: confirm } : undefined}
      width={440}
    >
      {/* Опции пересылки (tweb): скрыть/показать отправителя и убрать/показать подпись */}
      <div className={s.pickerList} style={{ marginBottom: 10 }}>
        <div className={s.listRow} onClick={() => setDropAuthor((v) => !v)}>
          <TgIcon name={dropAuthor ? 'author_hidden' : 'person'} size={22} color="var(--tg-accent)" />
          <div className={s.pickerBody}>
            <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">
              {dropAuthor ? t('Show sender name') : t('Hide sender name')}
            </Text>
          </div>
        </div>
        {hasCaption && (
          <div className={s.listRow} onClick={() => setDropCaption((v) => !v)}>
            <TgIcon name="captiondown" size={22} color="var(--tg-accent)" />
            <div className={s.pickerBody}>
              <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">
                {dropCaption ? t('Show caption') : t('Hide caption')}
              </Text>
            </div>
          </div>
        )}
      </div>
      {/* поиск (tweb popup-forward: серое поле сверху) */}
      <div className={s.pickerSearch}>
        <TgIcon name="search" size={20} color="var(--tg-textFaint)" />
        <input
          className={s.pickerSearchInput}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('Search')}
        />
      </div>
      <div className={s.pickerList}>
        {rows.map((r) => (
          <div key={r.chatId} className={s.listRow} onClick={() => toggle(r.chatId)}>
            <Checkbox checked={selected.has(r.chatId)} size={22} />
            <Avatar background={peerColor(r.title)} text={r.title[0] ?? '?'} size="md" />
            <div className={s.pickerBody}>
              <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">{r.title}</Text>
              <Text noWrap size={13.5} color="var(--tg-textSecondary)">{r.sub}</Text>
            </div>
          </div>
        ))}
      </div>
    </Popup>
  )
}

// Пикер контакта для attach-меню: список собеседников приватных чатов;
// выбор — отправить сообщение-контакт (та же карточка, что и ForwardPicker).
export function ContactPicker({ dialogs, onPick, onClose }: {
  dialogs: Dialog[]
  onPick: (userId: number, name: string) => void
  onClose: () => void
}) {
  const t = useT()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(true)
  const picked = useRef<{ userId: number; name: string } | null>(null)
  const pick = (userId: number, name: string) => { picked.current = { userId, name }; setOpen(false) }
  const query = q.trim().toLowerCase()
  const rows = dialogs
    .filter((d) => d.type === 'private' && d.peer)
    .map((d) => ({ userId: d.peer!.id, name: d.peer!.displayName || `#${d.peer!.id}` }))
    .filter((r) => !query || r.name.toLowerCase().includes(query))
  return (
    <Popup
      open={open}
      title={t('Contact')}
      onClose={() => setOpen(false)}
      onExitComplete={() => { const p = picked.current; if (p) onPick(p.userId, p.name); else onClose() }}
      width={440}
    >
      <div className={s.pickerSearch}>
        <TgIcon name="search" size={20} color="var(--tg-textFaint)" />
        <input
          className={s.pickerSearchInput}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('Search')}
        />
      </div>
      <div className={s.pickerList}>
        {rows.map((r) => (
          <div key={r.userId} className={s.listRow} onClick={() => pick(r.userId, r.name)}>
            <Avatar background={peerColor(r.name)} text={r.name[0] ?? '?'} size="md" />
            <div className={s.pickerBody}>
              <Text noWrap size={15.5} weight={500} color="var(--tg-textPrimary)">{r.name}</Text>
            </div>
          </div>
        ))}
      </div>
    </Popup>
  )
}

// "Seen by" popup anchored at (x, y).
export function ViewersPopup({ x, y, names, onClose }: {
  x: number
  y: number
  names: string[]
  onClose: () => void
}) {
  const t = useT()
  return createPortal(
    <div className={s.overlayBare} onClick={onClose}>
      <motion.div
        className={classNames(s.card, s.viewers)}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18, ease: EASE_STD }}
        style={{ top: y, left: x }}
      >
        <Text size={13} color="var(--tg-textFaint)" className={s.viewersTitle}>
          {names.length ? t('Seen by') : t('No views yet')}
        </Text>
        {names.map((n, i) => (
          <div key={i} className={s.viewersRow}>
            <Avatar background={peerColor(n)} text={n[0] ?? '?'} size={28} />
            <Text noWrap size={14.5} color="var(--tg-textPrimary)">{n}</Text>
          </div>
        ))}
      </motion.div>
    </div>,
    document.body,
  )
}
// Кто отреагировал: как ViewersPopup, но в каждой строке — эмодзи реакции справа.
export function ReactedUsersPopup({ x, y, rows, onClose }: {
  x: number
  y: number
  rows: { name: string; avatarUrl: string; emoji: string }[]
  onClose: () => void
}) {
  const t = useT()
  return createPortal(
    <div className={s.overlayBare} onClick={onClose}>
      <motion.div
        className={classNames(s.card, s.viewers)}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18, ease: EASE_STD }}
        style={{ top: y, left: x }}
      >
        <Text size={13} color="var(--tg-textFaint)" className={s.viewersTitle}>
          {rows.length ? t('Reactions') : t('No reactions yet')}
        </Text>
        {rows.map((r, i) => (
          <div key={i} className={s.viewersRow}>
            <Avatar background={peerColor(r.name)} text={r.name[0] ?? '?'} src={r.avatarUrl || undefined} size={28} />
            <Text noWrap size={14.5} color="var(--tg-textPrimary)" style={{ flex: 1 }}>{r.name}</Text>
            <span style={{ fontSize: 18 }}>{r.emoji}</span>
          </div>
        ))}
      </motion.div>
    </div>,
    document.body,
  )
}
export function DiscardVoiceDialog({ onCancel, onDiscard }: { onCancel: () => void; onDiscard: () => void }) {
  const t = useT()
  return (
    <motion.div
      className={classNames(s.overlay, s.overlayTop)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onCancel}
    >
      <motion.div
        className={s.discardCard}
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
      >
        <Text size={17} weight={600} color="var(--tg-textPrimary)" style={{ marginBottom: '8px' }}>
          {t('Discard voice message?')}
        </Text>
        <Text size={14.5} color="var(--tg-textSecondary)" style={{ marginBottom: '16px' }}>
          {t('Are you sure you want to discard this voice message?')}
        </Text>
        <div className={s.discardActions}>
          <div className={classNames(s.btnText, s.accent)} onClick={onCancel}>{t('Cancel')}</div>
          <div className={classNames(s.btnText, s.danger)} onClick={onDiscard}>{t('Discard')}</div>
        </div>
      </motion.div>
    </motion.div>
  )
}
