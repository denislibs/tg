import { useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Box, Typography, useTheme } from '@mui/material'
import { motion } from 'framer-motion'
import HistoryToggleOffRounded from '@mui/icons-material/HistoryToggleOffRounded'
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded'
import NotificationsOffOutlined from '@mui/icons-material/NotificationsOffOutlined'
import NotificationsNoneOutlined from '@mui/icons-material/NotificationsNoneOutlined'
import CallOutlined from '@mui/icons-material/CallOutlined'
import VideocamOutlined from '@mui/icons-material/VideocamOutlined'
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded'
import PersonAddAltOutlined from '@mui/icons-material/PersonAddAltOutlined'
import CardGiftcardOutlined from '@mui/icons-material/CardGiftcardOutlined'
import BlockRounded from '@mui/icons-material/BlockRounded'
import PersonOffOutlined from '@mui/icons-material/PersonOffOutlined'
import SensorsRounded from '@mui/icons-material/SensorsRounded'
import ChatOutlined from '@mui/icons-material/ChatOutlined'
import BoltOutlined from '@mui/icons-material/BoltOutlined'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import TuneRounded from '@mui/icons-material/TuneRounded'
import TimerOffOutlined from '@mui/icons-material/TimerOffOutlined'
import type { Chat } from '../data'
import { useT } from '../i18n'

type Item = { icon: ReactNode; label: string; danger?: boolean; submenu?: boolean }

interface Props {
  chat: Chat
  anchor: { top: number; right: number }
  onClose: () => void
}

export default function HeaderMenu({ chat, anchor, onClose }: Props) {
  const theme = useTheme()
  const tg = theme.tg
  const t = useT()
  const [autoOpen, setAutoOpen] = useState(false)
  const muted = !!chat.muted
  const owned = !!chat.owned
  const muteItem: Item = muted
    ? { icon: <NotificationsNoneOutlined />, label: 'Unmute' }
    : { icon: <NotificationsOffOutlined />, label: 'Mute' }

  let items: Item[]
  if (chat.type === 'private') {
    items = [
      { icon: <HistoryToggleOffRounded />, label: 'Auto-delete', submenu: true },
      muteItem,
      { icon: <CallOutlined />, label: 'Call' },
      { icon: <VideocamOutlined />, label: 'Video Call' },
      { icon: <CheckCircleOutlineRounded />, label: 'Select Messages' },
      { icon: <PersonAddAltOutlined />, label: 'Add to contacts' },
      { icon: <CardGiftcardOutlined />, label: 'Send a Gift' },
      { icon: <BlockRounded />, label: 'Block user' },
      { icon: <PersonOffOutlined />, label: 'Disable Sharing' },
      { icon: <DeleteOutlineRounded />, label: 'Delete Chat', danger: true },
    ]
  } else if (chat.type === 'group') {
    items = [
      { icon: <HistoryToggleOffRounded />, label: 'Auto-delete', submenu: true },
      muteItem,
      { icon: <CheckCircleOutlineRounded />, label: 'Select Messages' },
      { icon: <CardGiftcardOutlined />, label: 'Send a Gift' },
      { icon: <DeleteOutlineRounded />, label: owned ? 'Delete Group' : 'Leave Group', danger: true },
    ]
  } else if (owned) {
    // owned channel
    items = [
      { icon: <HistoryToggleOffRounded />, label: 'Auto-delete', submenu: true },
      muteItem,
      { icon: <SensorsRounded />, label: 'Live Stream' },
      { icon: <CheckCircleOutlineRounded />, label: 'Select Messages' },
      { icon: <CardGiftcardOutlined />, label: 'Send a Gift' },
      { icon: <BoltOutlined />, label: 'Boost Channel' },
      { icon: <DeleteOutlineRounded />, label: 'Delete Channel', danger: true },
    ]
  } else {
    // channel you don't own
    items = [
      muteItem,
      { icon: <ChatOutlined />, label: 'View discussion' },
      { icon: <CheckCircleOutlineRounded />, label: 'Select Messages' },
      { icon: <CardGiftcardOutlined />, label: 'Send a Gift' },
      { icon: <BoltOutlined />, label: 'Boost Channel' },
      { icon: <DeleteOutlineRounded />, label: 'Leave Channel', danger: true },
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
                {a === 'Other' ? <TuneRounded /> : a === 'Never' ? <TimerOffOutlined /> : <HistoryToggleOffRounded />}
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
              onClick={() => (it.submenu ? setAutoOpen((o) => !o) : onClose())}
              sx={rowSx(it.danger)}
            >
              {it.icon}
              <Typography sx={{ flex: 1, fontSize: 15, color: it.danger ? '#ff595a' : tg.textPrimary }}>
                {t(it.label)}
              </Typography>
              {it.submenu && <ChevronRightRounded sx={{ fontSize: 20, color: tg.textFaint }} />}
            </Box>
          ))}
        </Box>
      </Box>
    </>,
    document.body
  )
}
