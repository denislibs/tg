import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Box, useTheme } from '@mui/material'
import Text from '../shared/ui/Text'
import { useManagers } from '../core/hooks/useManagers'
import TgIcon from './TgIcon'
import { motion } from 'framer-motion'
import Avatar from '../shared/ui/Avatar'
import Badge from '../shared/ui/Badge'
import { useAvatarSrc } from './useAvatarSrc'
import { useChatsStore } from '../stores/chatsStore'
import { useTypingLabel } from '../core/hooks/useTypingLabel'
import TypingIndicator from './conversation/TypingIndicator'
import VerifiedBadge from './VerifiedBadge'
import type { Chat } from '../data'
import { useT } from '../i18n'
import { useTimeFormatter } from '../settings'

const MotionBox = motion(Box)

interface Props {
  chat: Chat
  selected: boolean
  // Stable across the whole list (the row passes its own id) so memo() holds and
  // a sidebar re-render (scroll-fold, overlay toggle) doesn't re-render every row.
  onSelect: (id: string) => void
  index?: number
}

// Small rounded thumbnail of the last message's photo, shown before the preview
// text (tweb's dialog-subtitle media). Resolves the content URL via the worker.
function SidebarThumb({ id }: { id: number }) {
  const managers = useManagers()
  const [url, setUrl] = useState('')
  useEffect(() => {
    let alive = true
    void managers.media.contentUrl(id).then((u) => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [id, managers])
  return (
    <Box
      sx={{
        width: 18,
        height: 18,
        borderRadius: '4px',
        flexShrink: 0,
        backgroundColor: 'rgba(0,0,0,0.08)',
        backgroundImage: url ? `url(${url})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    />
  )
}

function ChatListItem({ chat, selected, onSelect }: Props) {
  const onClick = () => onSelect(chat.id)
  const theme = useTheme()
  const tg = theme.tg
  const t = useT()
  const avatarSrc = useAvatarSrc(chat.avatarUrl)
  const typingLabel = useTypingLabel(Number(chat.id), chat.type === 'group')
  const presence = useChatsStore((s) => (chat.peerId != null ? s.presence[chat.peerId] : undefined))
  const fmtTime = useTimeFormatter()
  const mode = theme.palette.mode
  const hoverBg = mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)'
  const rippleColor = selected
    ? 'rgba(255,255,255,0.25)'
    : mode === 'dark'
      ? 'rgba(255,255,255,0.10)'
      : 'rgba(0,0,0,0.07)'
  const onAccent = selected

  const [ripples, setRipples] = useState<{ key: number; x: number; y: number; size: number }[]>([])
  const rippleId = useRef(0)
  const addRipple = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const size =
      2 *
      Math.max(
        Math.hypot(x, y),
        Math.hypot(rect.width - x, y),
        Math.hypot(x, rect.height - y),
        Math.hypot(rect.width - x, rect.height - y)
      )
    const key = rippleId.current++
    setRipples((r) => [...r, { key, x, y, size }])
  }

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 246),
      y: Math.min(e.clientY, window.innerHeight - 360),
    })
  }
  const destructive =
    chat.type === 'channel' ? 'Leave Channel' : chat.type === 'group' ? 'Delete Group' : 'Delete Chat'
  const menuItems: { icon: ReactNode; label: string; danger?: boolean }[] = [
    { icon: <TgIcon name="newtab" size={20} />, label: 'Open in new tab' },
    { icon: <TgIcon name="eye" size={20} />, label: 'Preview' },
    { icon: <TgIcon name="messageunread" size={20} />, label: 'Mark as unread' },
    { icon: <TgIcon name="pin" size={20} />, label: 'Pin' },
    {
      icon: <TgIcon name={chat.muted ? 'unmute' : 'mute'} size={20} />,
      label: chat.muted ? 'Unmute' : 'Mute',
    },
    { icon: <TgIcon name="archive" size={20} />, label: 'Archive' },
    { icon: <TgIcon name="delete" size={20} />, label: destructive, danger: true },
  ]

  return (
    <>
    <MotionBox
      onClick={onClick}
      onMouseDown={addRipple}
      onContextMenu={openMenu}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        gap: 1.5,
        alignItems: 'center',
        px: 1.5,
        py: 1.15,
        mx: 0.75,
        borderRadius: '16px',
        cursor: 'pointer',
        color: onAccent ? '#fff' : tg.textPrimary,
        background: selected ? tg.accentGradient : 'transparent',
        transition: 'background .18s ease',
        '&:hover': {
          background: selected ? tg.accentGradient : hoverBg,
        },
        '& > div': { position: 'relative', zIndex: 1 },
      }}
    >
      {ripples.map((r) => (
        <Box
          key={r.key}
          component={motion.span}
          initial={{ scale: 0, opacity: 1 }}
          animate={{ scale: 1, opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          onAnimationComplete={() => setRipples((rs) => rs.filter((x) => x.key !== r.key))}
          sx={{
            position: 'absolute',
            left: r.x - r.size / 2,
            top: r.y - r.size / 2,
            width: r.size,
            height: r.size,
            borderRadius: '50%',
            background: rippleColor,
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
      ))}
      <Avatar
        background={chat.avatar}
        text={chat.avatarText}
        emoji={chat.avatarEmoji}
        src={avatarSrc}
        size="dialog"
        online={chat.online || presence?.online}
        ringColor={selected ? tg.accent : tg.sidebarBg}
      />

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Text
            noWrap
            weight={500}
            size={16}
            color={onAccent ? '#fff' : tg.textPrimary}
            style={{ flex: 1 }}
          >
            {chat.name}
          </Text>
          {chat.verified && (
            <VerifiedBadge
              size={20}
              color={onAccent ? '#fff' : tg.accent}
              checkColor={onAccent ? tg.accent : '#fff'}
            />
          )}
          {chat.muted && (
            <TgIcon name="muted" size={17} color={onAccent ? 'rgba(255,255,255,0.7)' : tg.textFaint} />
          )}
          {/* tweb places the sent/read tick in the title row, just left of the time */}
          {chat.sent && (
            <TgIcon
              name={chat.read ? 'checks' : 'check'}
              size={18}
              color={onAccent ? '#fff' : tg.accent}
              style={{ marginLeft: 4, flexShrink: 0 }}
            />
          )}
          <Text
            size={14}
            color={onAccent ? 'rgba(255,255,255,0.85)' : tg.textFaint}
            style={{ marginLeft: chat.sent ? '2px' : '4px', flexShrink: 0 }}
          >
            {fmtTime(chat.date)}
          </Text>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
          {typingLabel.active ? (
            <Text
              noWrap
              size={16}
              color={onAccent ? '#fff' : tg.accent}
              style={{ flex: 1 }}
            >
              <TypingIndicator kind={typingLabel.kind} color={onAccent ? '#fff' : tg.accent} />
              {typingLabel.label}
            </Text>
          ) : (
            <>
              {chat.forwarded && (
                <TgIcon
                  name="forward_filled"
                  size={18}
                  color={onAccent ? 'rgba(255,255,255,0.9)' : tg.textSecondary}
                  style={{ flexShrink: 0, marginRight: 4 }}
                />
              )}
              {chat.previewMediaId != null && <SidebarThumb id={chat.previewMediaId} />}
              <Text
                noWrap
                size={16}
                color={onAccent ? 'rgba(255,255,255,0.9)' : tg.textSecondary}
                style={{ flex: 1 }}
              >
                {chat.preview}
              </Text>
            </>
          )}
          {chat.unread != null && <Badge muted={chat.muted}>{chat.unread}</Badge>}
        </Box>
      </Box>
    </MotionBox>

    {menu &&
      createPortal(
        <>
          <Box
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
            sx={{ position: 'fixed', inset: 0, zIndex: 2000 }}
          />
          <Box
            sx={{
              position: 'fixed',
              top: menu.y,
              left: menu.x,
              zIndex: 2001,
              minWidth: 200,
              py: 0.75,
              borderRadius: '12px',
              background: tg.menuBg,
              backdropFilter: 'blur(40px)',
              WebkitBackdropFilter: 'blur(40px)',
              boxShadow: tg.menuShadow,
              transformOrigin: 'top left',
            }}
          >
           <Box
             component={motion.div}
             initial={{ opacity: 0, scale: 0.92 }}
             animate={{ opacity: 1, scale: 1 }}
             transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
             sx={{ transformOrigin: 'top left' }}
           >
            {menuItems.map((it) => (
              <Box
                key={it.label}
                onClick={() => setMenu(null)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  px: 1.5,
                  py: 0.6,
                  mx: 0.5,
                  borderRadius: '8px',
                  '&:hover': { background: tg.hover },
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    color: it.danger ? '#ff595a' : tg.textSecondary,
                    '& svg': { fontSize: 20 },
                  }}
                >
                  {it.icon}
                </Box>
                <Text size={14.5} color={it.danger ? '#ff595a' : tg.textPrimary}>
                  {t(it.label)}
                </Text>
              </Box>
            ))}
           </Box>
          </Box>
        </>,
        document.body
      )}
    </>
  )
}

export default memo(ChatListItem)
