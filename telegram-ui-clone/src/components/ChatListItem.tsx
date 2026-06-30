import { memo, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useTheme } from '@mui/material'
import Text from '../shared/ui/Text'
import Avatar from '../shared/ui/Avatar'
import Badge from '../shared/ui/Badge'
import Menu, { MenuItem } from '../shared/ui/Menu'
import { useRipple } from '../shared/ui/Ripple/useRipple'
import TgIcon from './TgIcon'
import { useManagers } from '../core/hooks/useManagers'
import { useAvatarSrc } from './useAvatarSrc'
import { useChatsStore } from '../stores/chatsStore'
import { useTypingLabel } from '../core/hooks/useTypingLabel'
import TypingIndicator from './conversation/TypingIndicator'
import VerifiedBadge from './VerifiedBadge'
import type { Chat } from '../data'
import { useT } from '../i18n'
import { useTimeFormatter } from '../settings'
import s from './ChatListItem.module.scss'

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
  return <div className={s.thumb} style={{ backgroundImage: url ? `url(${url})` : undefined }} />
}

function ChatListItem({ chat, selected, onSelect }: Props) {
  const onClick = () => onSelect(chat.id)
  const tg = useTheme().tg
  const t = useT()
  const avatarSrc = useAvatarSrc(chat.avatarUrl)
  const typingLabel = useTypingLabel(Number(chat.id), chat.type === 'group')
  const presence = useChatsStore((s) => (chat.peerId != null ? s.presence[chat.peerId] : undefined))
  const fmtTime = useTimeFormatter()
  const onAccent = selected
  const { onPointerDown, ripple } = useRipple()

  // Anchor a corner of the menu AT the click point and grow toward free space
  // (right/bottom edges flip via right/bottom CSS so it stays exactly at the cursor).
  const [menuPos, setMenuPos] = useState<CSSProperties | null>(null)
  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const MW = 220, MH = 320 // rough size, only to decide the grow direction
    const flipLeft = e.clientX + MW > window.innerWidth
    const flipUp = e.clientY + MH > window.innerHeight
    const pos: CSSProperties = { transformOrigin: `${flipUp ? 'bottom' : 'top'} ${flipLeft ? 'right' : 'left'}` }
    if (flipLeft) pos.right = window.innerWidth - e.clientX
    else pos.left = e.clientX
    if (flipUp) pos.bottom = window.innerHeight - e.clientY
    else pos.top = e.clientY
    setMenuPos(pos)
  }
  const destructive =
    chat.type === 'channel' ? 'Leave Channel' : chat.type === 'group' ? 'Delete Group' : 'Delete Chat'
  const menuItems: { icon: ReactNode; label: string; danger?: boolean }[] = [
    { icon: <TgIcon name="newtab" size={24} />, label: 'Open in new tab' },
    { icon: <TgIcon name="eye" size={24} />, label: 'Preview' },
    { icon: <TgIcon name="messageunread" size={24} />, label: 'Mark as unread' },
    { icon: <TgIcon name="pin" size={24} />, label: 'Pin' },
    {
      icon: <TgIcon name={chat.muted ? 'unmute' : 'mute'} size={24} />,
      label: chat.muted ? 'Unmute' : 'Mute',
    },
    { icon: <TgIcon name="archive" size={24} />, label: 'Archive' },
    { icon: <TgIcon name="delete" size={24} />, label: destructive, danger: true },
  ]

  return (
    <>
      <div
        className={s.row}
        data-selected={selected || undefined}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onContextMenu={openMenu}
      >
        {ripple}
        <Avatar
          background={chat.avatar}
          text={chat.avatarText}
          emoji={chat.avatarEmoji}
          src={avatarSrc}
          size="dialog"
          online={chat.online || presence?.online}
          ringColor={selected ? tg.accent : tg.sidebarBg}
        />

        <div className={s.body}>
          <div className={s.titleRow}>
            <Text noWrap weight={500} size={16} color={onAccent ? '#fff' : tg.textPrimary} style={{ flex: 1 }}>
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
          </div>

          <div className={s.subtitleRow}>
            {typingLabel.active ? (
              <Text noWrap size={16} color={onAccent ? '#fff' : tg.accent} style={{ flex: 1 }}>
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
                <Text noWrap size={16} color={onAccent ? 'rgba(255,255,255,0.9)' : tg.textSecondary} style={{ flex: 1 }}>
                  {chat.preview}
                </Text>
              </>
            )}
            {chat.unread != null && <Badge muted={chat.muted}>{chat.unread}</Badge>}
          </div>
        </div>
      </div>

      <Menu open={!!menuPos} onClose={() => setMenuPos(null)} style={menuPos ?? undefined}>
        {menuItems.map((it) => (
          <MenuItem
            key={it.label}
            icon={it.icon}
            label={t(it.label)}
            danger={it.danger}
            onClick={() => setMenuPos(null)}
          />
        ))}
      </Menu>
    </>
  )
}

export default memo(ChatListItem)
