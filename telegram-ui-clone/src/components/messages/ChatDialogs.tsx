import { useRef, useState } from 'react'
// Presentational chat dialogs/popups extracted from ConversationView: delete
// confirm, forward target picker, "seen by" popup, add-member picker, and the
// discard-voice confirm. Each is dumb — it self-sources i18n + motion constants
// and emits its actions via callbacks; the parent owns the state.
import Text from '../../shared/ui/Text'
import IconButton from '../../shared/ui/IconButton'
import classNames from '../../shared/lib/classNames'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import { EASE, DUR } from '../../motion'
import { useT } from '../../i18n'
import Avatar from '../../shared/ui/Avatar'
import Popup from '../../shared/ui/Popup'
import { peerColor } from '../peerColor'
import type { Dialog } from '../../core/models'
import s from './ChatDialogs.module.scss'

// Only the fields the add-member list renders (Dialog.peer is narrower than the
// full Peer type, so we keep this minimal and structurally compatible).
type Contact = { id: number; displayName: string; avatarUrl: string }

const EASE_STD = EASE
const DUR_IN = DUR.in

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

// Forward target picker: pick a dialog to forward the selected messages into.
export function ForwardPicker({ dialogs, onPick, onClose }: {
  dialogs: Dialog[]
  onPick: (chatId: number) => void
  onClose: () => void
}) {
  const t = useT()
  const [q, setQ] = useState('')
  // exit-анимация: закрытие/выбор сначала гасят open; колбэк владельцу (который
  // размонтирует пикер) — только из onExitComplete, когда карточка уехала.
  const [open, setOpen] = useState(true)
  const picked = useRef<number | null>(null)
  const pick = (chatId: number) => { picked.current = chatId; setOpen(false) }
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
      onExitComplete={() => { if (picked.current != null) onPick(picked.current); else onClose() }}
      width={440}
    >
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
          <div key={r.chatId} className={s.listRow} onClick={() => pick(r.chatId)}>
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

// Add-member picker (real group chats): a selectable list of contacts.
export function AddMemberDialog({ contacts, onAdd, onClose }: {
  contacts: Contact[]
  onAdd: (userId: number) => void
  onClose: () => void
}) {
  const t = useT()
  return createPortal(
    <>
      <div className={s.scrim} onClick={onClose} />
      <motion.div
        className={classNames(s.card, s.addCard)}
        role="dialog"
        aria-label={t('Add member')}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: DUR_IN, ease: EASE_STD }}
      >
        <div className={s.addHeader}>
          <Text size={17} weight={600} color="var(--tg-textPrimary)" style={{ flex: 1 }}>
            {t('Add member')}
          </Text>
          <IconButton size="small" onClick={onClose} color="var(--tg-textFaint)">
            <TgIcon name="close" size={20} />
          </IconButton>
        </div>
        <div className={s.addList}>
          {contacts.length === 0 ? (
            <Text size={14.5} color="var(--tg-textSecondary)" className={s.addEmpty}>
              {t('No contacts to add')}
            </Text>
          ) : (
            contacts.map((p) => (
              <div
                key={p.id}
                className={s.addRow}
                role="button"
                tabIndex={0}
                onClick={() => onAdd(p.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onAdd(p.id)
                  }
                }}
              >
                <Avatar background={p.avatarUrl || 'var(--tg-accent)'} text={p.displayName[0] ?? '?'} size="sm" />
                <Text noWrap size={15.5} color="var(--tg-textPrimary)" style={{ flex: 1 }}>
                  {p.displayName}
                </Text>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </>,
    document.body,
  )
}

// Discard-voice-message confirm (shown when Esc is pressed mid-recording). Meant
// to be rendered inside the parent's <AnimatePresence> for the exit transition.
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
