import { memo, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
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
import { uiEvents } from '../core/hooks/uiEvents'
import TypingIndicator from './conversation/TypingIndicator'
import VerifiedBadge from './VerifiedBadge'
import type { Chat } from '../data'
import { useT } from '../i18n'
import { useTimeFormatter } from '../settings'
import MutePopup from './MutePopup'
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
  const t = useT()
  const managers = useManagers()
  const avatarSrc = useAvatarSrc(chat.avatarUrl)
  const typingLabel = useTypingLabel(Number(chat.id), chat.type === 'group')
  const presence = useChatsStore((s) => (chat.peerId != null ? s.presence[chat.peerId] : undefined))
  const setDialogMuted = useChatsStore((s) => s.setDialogMuted)
  const setDialogPinned = useChatsStore((s) => s.setDialogPinned)
  const setDialogArchived = useChatsStore((s) => s.setDialogArchived)
  const fmtTime = useTimeFormatter()
  const { onPointerDown, ripple } = useRipple()

  // Mute/Unmute (tweb dialogsContextMenu): Mute открывает попап длительности,
  // Unmute снимает сразу. null — попап ни разу не открывали (не монтируем).
  const [muteOpen, setMuteOpen] = useState<boolean | null>(null)
  const applyMute = (muted: boolean, seconds?: number | null) => {
    const chatId = Number(chat.id)
    setDialogMuted(chatId, muted) // оптимистично
    const until = muted && seconds ? Math.floor(Date.now() / 1000) + seconds : undefined
    void managers.groups.setMute(chatId, muted, until).catch(() => setDialogMuted(chatId, !muted))
  }

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
  // Pin/Unpin (tweb ChatList.Context.Pin): оптимистично + откат; лимит 5 → тост.
  const applyPin = (pinned: boolean) => {
    const chatId = Number(chat.id)
    setDialogPinned(chatId, pinned)
    void managers.groups.setPin(chatId, pinned).catch((e: unknown) => {
      setDialogPinned(chatId, !pinned)
      if (String(e).includes('pin limit')) {
        uiEvents.emit('ui:toast', t("Sorry, you can't pin any more chats to the top."))
      }
    })
  }
  // Archive/Unarchive (tweb editPeerFolders folder_id 0↔1)
  const applyArchive = (archived: boolean) => {
    const chatId = Number(chat.id)
    setDialogArchived(chatId, archived)
    void managers.groups.setArchive(chatId, archived).catch(() => setDialogArchived(chatId, !archived))
  }
  const destructive =
    chat.type === 'channel' ? 'Leave Channel' : chat.type === 'group' ? 'Delete Group' : 'Delete Chat'
  const menuItems: { icon: ReactNode; label: string; danger?: boolean; onClick?: () => void }[] = [
    { icon: <TgIcon name="newtab" size={20} />, label: 'Open in new tab' },
    { icon: <TgIcon name="eye" size={20} />, label: 'Preview' },
    { icon: <TgIcon name="messageunread" size={20} />, label: 'Mark as unread' },
    {
      icon: <TgIcon name={chat.pinned ? 'unpin' : 'pin'} size={20} />,
      label: chat.pinned ? 'Unpin' : 'Pin',
      onClick: () => applyPin(!chat.pinned),
    },
    {
      icon: <TgIcon name={chat.muted ? 'unmute' : 'mute'} size={20} />,
      label: chat.muted ? 'Unmute' : 'Mute',
      onClick: () => (chat.muted ? applyMute(false) : setMuteOpen(true)),
    },
    // «Избранное» не архивируется (tweb: verify peerId !== myId)
    ...(chat.type !== 'saved'
      ? [{
          icon: <TgIcon name={chat.archived ? 'unarchive' : 'archive'} size={20} />,
          label: chat.archived ? 'Unarchive' : 'Archive',
          onClick: () => applyArchive(!chat.archived),
        }]
      : []),
    { icon: <TgIcon name="delete" size={20} />, label: destructive, danger: true },
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
          ringColor="var(--cl-ring)"
        />

        <div className={s.body}>
          <div className={s.titleRow}>
            {/* секретный чат: замок + зелёное имя (tweb .is-secret) */}
            {chat.type === 'secret' && (
              <TgIcon name="lock" size={16} color="var(--tg-green)" style={{ flexShrink: 0, marginRight: 3 }} />
            )}
            <Text noWrap weight={500} size={16} color={chat.type === 'secret' ? 'var(--tg-green)' : 'var(--cl-title)'} style={{ flex: 1 }}>
              {chat.name}
            </Text>
            {chat.verified && (
              <VerifiedBadge size={20} color="var(--cl-accent)" checkColor="var(--cl-check)" />
            )}
            {chat.muted && <TgIcon name="muted" size={17} color="var(--cl-muted)" />}
            {/* tweb places the sent/read tick in the title row, just left of the time */}
            {chat.sent && (
              <TgIcon
                name={chat.read ? 'checks' : 'check'}
                size={18}
                color="var(--cl-accent)"
                style={{ marginLeft: 4, flexShrink: 0 }}
              />
            )}
            {/* tweb .dialog-title-details: .75rem, margin-inline-start .5rem */}
            <Text
              size={12}
              color="var(--cl-meta)"
              style={{ marginLeft: chat.sent ? '2px' : '8px', flexShrink: 0 }}
            >
              {fmtTime(chat.date)}
            </Text>
          </div>

          <div className={s.subtitleRow}>
            {typingLabel.active ? (
              <Text noWrap size={16} color="var(--cl-accent)" style={{ flex: 1 }}>
                <TypingIndicator kind={typingLabel.kind} color="var(--cl-accent)" />
                {typingLabel.label}
              </Text>
            ) : chat.draftPreview ? (
              /* Облачный черновик: красный «Черновик: » + текст (tweb .danger) */
              <Text noWrap size={16} color="var(--cl-subtitle)" style={{ flex: 1 }}>
                <span style={{ color: '#ff595a' }}>{t('Draft')}: </span>
                {chat.draftPreview}
              </Text>
            ) : (
              <>
                {chat.forwarded && (
                  <TgIcon
                    name="forward_filled"
                    size={18}
                    color="var(--cl-subtitle)"
                    style={{ flexShrink: 0, marginRight: 4 }}
                  />
                )}
                {chat.previewMediaId != null && <SidebarThumb id={chat.previewMediaId} />}
                <Text noWrap size={16} color="var(--cl-subtitle)" style={{ flex: 1 }}>
                  {chat.preview}
                </Text>
              </>
            )}
            {/* Непрочитанные упоминания: отдельный круглый бейдж «@» слева от
                счётчика непрочитанных (tweb .dialog-subtitle-badge.mention). */}
            {chat.unreadMentions ? <Badge muted={chat.muted}>@</Badge> : null}
            {chat.unread != null ? (
              <Badge muted={chat.muted}>{chat.unread}</Badge>
            ) : chat.pinned ? (
              /* tweb dialog-subtitle-badge-pinned: иконка пина вместо бейджа у прочитанного */
              <TgIcon name="chatspinned" size={19} color="var(--cl-muted)" style={{ flexShrink: 0 }} />
            ) : null}
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
            onClick={() => {
              setMenuPos(null)
              it.onClick?.()
            }}
          />
        ))}
      </Menu>

      {muteOpen != null && (
        <MutePopup
          open={muteOpen}
          onClose={() => setMuteOpen(false)}
          onExitComplete={() => setMuteOpen(null)}
          onMute={(seconds) => applyMute(true, seconds)}
        />
      )}
    </>
  )
}

export default memo(ChatListItem)
