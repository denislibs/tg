import { useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Box, Typography, useTheme } from '@mui/material'
import { motion } from 'framer-motion'
import TgIcon from './TgIcon'
import type { Chat } from '../data'
import { useT } from '../i18n'

type Item = { icon: ReactNode; label: string; danger?: boolean; submenu?: boolean; onClick?: () => void }

interface Props {
  chat: Chat
  anchor: { top: number; right: number }
  onClose: () => void
  onToggleMute?: () => void
  onAddMember?: () => void
  onSelectMessages?: () => void
  onAddContact?: () => void
}

export default function HeaderMenu({ chat, anchor, onClose, onToggleMute, onAddMember, onSelectMessages, onAddContact }: Props) {
  const theme = useTheme()
  const tg = theme.tg
  const t = useT()
  const [autoOpen, setAutoOpen] = useState(false)
  const muted = !!chat.muted
  const owned = !!chat.owned
  const handleMute = onToggleMute
    ? () => { onToggleMute(); onClose() }
    : undefined
  const muteItem: Item = muted
    ? { icon: <TgIcon name="unmute" size={22} />, label: 'Unmute', onClick: handleMute }
    : { icon: <TgIcon name="mute" size={22} />, label: 'Mute', onClick: handleMute }

  let items: Item[]
  if (chat.type === 'private') {
    items = [
      { icon: <TgIcon name="timer" size={22} />, label: 'Auto-delete', submenu: true },
      muteItem,
      { icon: <TgIcon name="phone" size={22} />, label: 'Call' },
      { icon: <TgIcon name="videocamera" size={22} />, label: 'Video Call' },
      { icon: <TgIcon name="checkround" size={22} />, label: 'Select Messages', onClick: onSelectMessages ? () => { onSelectMessages(); onClose() } : undefined },
      { icon: <TgIcon name="adduser" size={22} />, label: 'Add to contacts', onClick: onAddContact ? () => { onAddContact(); onClose() } : undefined },
      { icon: <TgIcon name="gift" size={22} />, label: 'Send a Gift' },
      { icon: <TgIcon name="restrict" size={22} />, label: 'Block user' },
      { icon: <TgIcon name="deleteuser" size={22} />, label: 'Disable Sharing' },
      { icon: <TgIcon name="delete" size={22} />, label: 'Delete Chat', danger: true },
    ]
  } else if (chat.type === 'group') {
    items = [
      { icon: <TgIcon name="timer" size={22} />, label: 'Auto-delete', submenu: true },
      muteItem,
      ...(onAddMember
        ? [{ icon: <TgIcon name="adduser" size={22} />, label: 'Add member', onClick: () => { onAddMember(); onClose() } }]
        : []),
      { icon: <TgIcon name="checkround" size={22} />, label: 'Select Messages', onClick: onSelectMessages ? () => { onSelectMessages(); onClose() } : undefined },
      { icon: <TgIcon name="gift" size={22} />, label: 'Send a Gift' },
      { icon: <TgIcon name="delete" size={22} />, label: owned ? 'Delete Group' : 'Leave Group', danger: true },
    ]
  } else if (owned) {
    // owned channel
    items = [
      { icon: <TgIcon name="timer" size={22} />, label: 'Auto-delete', submenu: true },
      muteItem,
      { icon: <TgIcon name="livestream" size={22} />, label: 'Live Stream' },
      { icon: <TgIcon name="checkround" size={22} />, label: 'Select Messages', onClick: onSelectMessages ? () => { onSelectMessages(); onClose() } : undefined },
      { icon: <TgIcon name="gift" size={22} />, label: 'Send a Gift' },
      { icon: <TgIcon name="boost" size={22} />, label: 'Boost Channel' },
      { icon: <TgIcon name="delete" size={22} />, label: 'Delete Channel', danger: true },
    ]
  } else {
    // channel you don't own
    items = [
      muteItem,
      { icon: <TgIcon name="message" size={22} />, label: 'View discussion' },
      { icon: <TgIcon name="checkround" size={22} />, label: 'Select Messages', onClick: onSelectMessages ? () => { onSelectMessages(); onClose() } : undefined },
      { icon: <TgIcon name="gift" size={22} />, label: 'Send a Gift' },
      { icon: <TgIcon name="boost" size={22} />, label: 'Boost Channel' },
      { icon: <TgIcon name="delete" size={22} />, label: 'Leave Channel', danger: true },
    ]
  }

  const autoItems = ['Never', '1 day', '1 week', '1 month', 'Other']

  const rowSx = (danger?: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 1.75,
    px: 1.75,
    py: 0.7,
    mx: 0.5,
    borderRadius: '8px',
    cursor: 'pointer',
    '&:hover': { background: tg.hover },
    color: danger ? '#ff595a' : tg.textSecondary,
    '& svg': { fontSize: 22, color: danger ? '#ff595a' : tg.textSecondary },
  })

  return createPortal(
    <>
      <Box onClick={onClose} sx={{ position: 'fixed', inset: 0, zIndex: 2000 }} />
      <Box sx={{ position: 'fixed', top: anchor.top, right: anchor.right, zIndex: 2001 }}>
        {/* Auto-delete submenu (to the left) */}
        {autoOpen && (
          <Box
            component={motion.div}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            sx={{
              position: 'absolute',
              top: 0,
              right: 256,
              minWidth: 200,
              py: 0.75,
              borderRadius: '12px',
              background: tg.menuBg,
              backdropFilter: 'blur(40px)',
              WebkitBackdropFilter: 'blur(40px)',
              boxShadow: tg.menuShadow,
              transformOrigin: 'top right',
            }}
          >
            {autoItems.map((a) => (
              <Box key={a} onClick={onClose} sx={rowSx()}>
                {a === 'Other' ? <TgIcon name="tools" size={22} /> : a === 'Never' ? <TgIcon name="auto_delete_circle_off" size={22} /> : <TgIcon name="timer" size={22} />}
                <Typography sx={{ fontSize: 15, color: tg.textPrimary }}>{t(a)}</Typography>
              </Box>
            ))}
          </Box>
        )}

        {/* Main menu */}
        <Box
          component={motion.div}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          sx={{
            width: 244,
            py: 0.75,
            borderRadius: '12px',
            background: tg.menuBg,
            backdropFilter: 'blur(40px)',
            WebkitBackdropFilter: 'blur(40px)',
            boxShadow: tg.menuShadow,
            transformOrigin: 'top right',
          }}
        >
          {items.map((it) => (
            <Box
              key={it.label}
              onClick={() => (it.submenu ? setAutoOpen((o) => !o) : it.onClick ? it.onClick() : onClose())}
              sx={rowSx(it.danger)}
            >
              {it.icon}
              <Typography sx={{ flex: 1, fontSize: 15, color: it.danger ? '#ff595a' : tg.textPrimary }}>
                {t(it.label)}
              </Typography>
              {it.submenu && <TgIcon name="next" size={20} color={tg.textFaint} />}
            </Box>
          ))}
        </Box>
      </Box>
    </>,
    document.body
  )
}
