// Presentational chat dialogs/popups extracted from ConversationView: delete
// confirm, forward target picker, "seen by" popup, add-member picker, and the
// discard-voice confirm. Each is dumb — it self-sources theme + i18n + motion
// constants and emits its actions via callbacks; the parent owns the state.
import { Box, Typography, useTheme } from '@mui/material'
import IconButton from '../../shared/ui/IconButton'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import { EASE, DUR } from '../../motion'
import { useT } from '../../i18n'
import Avatar from '../../shared/ui/Avatar'
import { peerColor } from '../peerColor'
import type { Dialog } from '../../core/models'

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
  const tg = useTheme().tg
  return createPortal(
    <Box
      onClick={onClose}
      sx={{ position: 'fixed', inset: 0, zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}
    >
      <Box
        onClick={(e) => e.stopPropagation()}
        component={motion.div}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: EASE_STD }}
        sx={{ width: 320, maxWidth: '90vw', p: 2.5, borderRadius: '12px', background: tg.menuBg, boxShadow: tg.menuShadow }}
      >
        <Typography sx={{ fontSize: 17, fontWeight: 600, color: tg.textPrimary, mb: 1 }}>{t('Delete message')}</Typography>
        <Typography sx={{ fontSize: 14.5, color: tg.textSecondary, mb: 2 }}>{t('Are you sure you want to delete this message?')}</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {canRevoke && (
            <Box
              onClick={onDeleteForEveryone}
              sx={{ px: 1.5, py: 1, borderRadius: '8px', cursor: 'pointer', color: '#ff595a', fontSize: 15, '&:hover': { background: tg.hover } }}
            >
              {t('Delete for everyone')}
            </Box>
          )}
          <Box
            onClick={onDeleteForMe}
            sx={{ px: 1.5, py: 1, borderRadius: '8px', cursor: 'pointer', color: '#ff595a', fontSize: 15, '&:hover': { background: tg.hover } }}
          >
            {t('Delete for me')}
          </Box>
          <Box
            onClick={onClose}
            sx={{ px: 1.5, py: 1, borderRadius: '8px', cursor: 'pointer', color: tg.textPrimary, fontSize: 15, '&:hover': { background: tg.hover } }}
          >
            {t('Cancel')}
          </Box>
        </Box>
      </Box>
    </Box>,
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
  const tg = useTheme().tg
  return createPortal(
    <Box
      onClick={onClose}
      sx={{ position: 'fixed', inset: 0, zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}
    >
      <Box
        onClick={(e) => e.stopPropagation()}
        component={motion.div}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: EASE_STD }}
        sx={{ width: 360, maxWidth: '92vw', maxHeight: '70vh', display: 'flex', flexDirection: 'column', borderRadius: '12px', background: tg.menuBg, boxShadow: tg.menuShadow, overflow: 'hidden' }}
      >
        <Typography sx={{ fontSize: 17, fontWeight: 600, color: tg.textPrimary, px: 2, py: 1.75 }}>{t('Forward to…')}</Typography>
        <Box sx={{ overflowY: 'auto', pb: 1 }}>
          {dialogs.map((d) => {
            const title = d.title || d.peer?.displayName || `Чат ${d.chatId}`
            return (
              <Box
                key={d.chatId}
                onClick={() => onPick(d.chatId)}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, cursor: 'pointer', '&:hover': { background: tg.hover } }}
              >
                <Avatar background={peerColor(title)} text={title[0] ?? '?'} size="sm" />
                <Typography noWrap sx={{ fontSize: 15, color: tg.textPrimary }}>{title}</Typography>
              </Box>
            )
          })}
        </Box>
      </Box>
    </Box>,
    document.body,
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
  const tg = useTheme().tg
  return createPortal(
    <Box onClick={onClose} sx={{ position: 'fixed', inset: 0, zIndex: 2100 }}>
      <Box
        onClick={(e) => e.stopPropagation()}
        component={motion.div}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18, ease: EASE_STD }}
        sx={{
          position: 'fixed', top: y, left: x, minWidth: 200, maxHeight: 300, overflowY: 'auto',
          py: 1, borderRadius: '12px', background: tg.menuBg, boxShadow: tg.menuShadow, transformOrigin: 'top left',
        }}
      >
        <Typography sx={{ px: 2, py: 0.5, fontSize: 13, color: tg.textFaint }}>
          {names.length ? t('Seen by') : t('No views yet')}
        </Typography>
        {names.map((n, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 0.75 }}>
            <Avatar background={peerColor(n)} text={n[0] ?? '?'} size={28} />
            <Typography noWrap sx={{ fontSize: 14.5, color: tg.textPrimary }}>{n}</Typography>
          </Box>
        ))}
      </Box>
    </Box>,
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
  const tg = useTheme().tg
  return createPortal(
    <>
      <Box onClick={onClose} sx={{ position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(0,0,0,0.45)' }} />
      <Box
        role="dialog"
        aria-label={t('Add member')}
        component={motion.div}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: DUR_IN, ease: EASE_STD }}
        sx={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 2101,
          width: 'min(360px, calc(100vw - 32px))', maxHeight: 'min(70vh, 520px)',
          display: 'flex', flexDirection: 'column', background: tg.menuBg,
          backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
          borderRadius: '14px', boxShadow: tg.menuShadow, overflow: 'hidden',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5 }}>
          <Typography sx={{ flex: 1, fontSize: 17, fontWeight: 600, color: tg.textPrimary }}>
            {t('Add member')}
          </Typography>
          <IconButton size="small" onClick={onClose} color={tg.textFaint}>
            <TgIcon name="close" size={20} />
          </IconButton>
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', pb: 1 }}>
          {contacts.length === 0 ? (
            <Typography sx={{ px: 2, py: 2, fontSize: 14.5, color: tg.textSecondary, textAlign: 'center' }}>
              {t('No contacts to add')}
            </Typography>
          ) : (
            contacts.map((p) => (
              <Box
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => onAdd(p.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onAdd(p.id)
                  }
                }}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 0.9, cursor: 'pointer',
                  '&:hover': { background: tg.hover },
                  '&:focus-visible': { outline: `2px solid ${tg.accent}`, outlineOffset: -2 },
                }}
              >
                <Avatar background={p.avatarUrl || tg.accent} text={p.displayName[0] ?? '?'} size="sm" />
                <Typography noWrap sx={{ flex: 1, fontSize: 15.5, color: tg.textPrimary }}>
                  {p.displayName}
                </Typography>
              </Box>
            ))
          )}
        </Box>
      </Box>
    </>,
    document.body,
  )
}

// Discard-voice-message confirm (shown when Esc is pressed mid-recording). Meant
// to be rendered inside the parent's <AnimatePresence> for the exit transition.
export function DiscardVoiceDialog({ onCancel, onDiscard }: { onCancel: () => void; onDiscard: () => void }) {
  const t = useT()
  const tg = useTheme().tg
  return (
    <Box
      component={motion.div}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onCancel}
      sx={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Box
        component={motion.div}
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        sx={{ width: 'min(92%, 360px)', borderRadius: '14px', background: tg.sidebarBg, p: 2.5 }}
      >
        <Typography sx={{ fontSize: 17, fontWeight: 600, color: tg.textPrimary, mb: 1 }}>
          {t('Discard voice message?')}
        </Typography>
        <Typography sx={{ fontSize: 14.5, color: tg.textSecondary, mb: 2 }}>
          {t('Are you sure you want to discard this voice message?')}
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Box onClick={onCancel} sx={{ px: 2, py: 1, borderRadius: '10px', cursor: 'pointer', fontSize: 15, fontWeight: 600, color: tg.accent, '&:hover': { background: tg.hover } }}>
            {t('Cancel')}
          </Box>
          <Box onClick={onDiscard} sx={{ px: 2, py: 1, borderRadius: '10px', cursor: 'pointer', fontSize: 15, fontWeight: 600, color: '#ff595a', '&:hover': { background: tg.hover } }}>
            {t('Discard')}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
