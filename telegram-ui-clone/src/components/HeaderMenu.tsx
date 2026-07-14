import { useState } from 'react'
import type { ReactNode } from 'react'
import TgIcon from './TgIcon'
import Menu, { MenuItem } from '../shared/ui/Menu'
import { useCall } from './call/CallProvider'
import { SERVICE_USER_ID } from '../core/dialogToChat'
import { useSearchStore } from '../stores/searchStore'
import useMediaQuery from '../shared/lib/useMediaQuery'
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
  const t = useT()
  const { start: startCall } = useCall()
  const setSearchOpen = useSearchStore((s) => s.setOpen)
  const [autoOpen, setAutoOpen] = useState(false)
  const muted = !!chat.muted
  const owned = !!chat.owned
  const handleMute = onToggleMute
    ? () => { onToggleMute(); onClose() }
    : undefined
  const muteItem: Item = muted
    ? { icon: <TgIcon name="unmute" size={20} />, label: 'Unmute', onClick: handleMute }
    : { icon: <TgIcon name="mute" size={20} />, label: 'Mute', onClick: handleMute }

  // На мобилке лупа скрыта из шапки — поиск живёт пунктом меню
  // (tweb topbar.ts: menuButton 'Search', verify: mediaSizes.isMobile).
  const narrow = useMediaQuery('(max-width:900px)')
  const numericChatId = Number(chat.id)
  const searchItems: Item[] =
    narrow && Number.isFinite(numericChatId) && String(numericChatId) === chat.id
      ? [{ icon: <TgIcon name="search" size={20} />, label: 'Search', onClick: () => { setSearchOpen(numericChatId, true); onClose() } }]
      : []

  let items: Item[]
  if (chat.type === 'private') {
    // Сервисному аккаунту «Telegram» нельзя позвонить, заблокировать его или
    // добавить в контакты — этих пунктов в меню нет (как в Telegram).
    const isService = chat.peerId === SERVICE_USER_ID
    items = [
      { icon: <TgIcon name="timer" size={20} />, label: 'Auto-delete', submenu: true },
      ...searchItems,
      muteItem,
      ...(!isService
        ? [
            { icon: <TgIcon name="phone" size={20} />, label: 'Call', onClick: () => { startCall(false); onClose() } },
            { icon: <TgIcon name="videocamera" size={20} />, label: 'Video Call', onClick: () => { startCall(true); onClose() } },
          ]
        : []),
      { icon: <TgIcon name="checkround" size={20} />, label: 'Select Messages', onClick: onSelectMessages ? () => { onSelectMessages(); onClose() } : undefined },
      ...(!isService
        ? [
            { icon: <TgIcon name="adduser" size={20} />, label: 'Add to contacts', onClick: onAddContact ? () => { onAddContact(); onClose() } : undefined },
            { icon: <TgIcon name="gift" size={20} />, label: 'Send a Gift' },
            { icon: <TgIcon name="restrict" size={20} />, label: 'Block user' },
            { icon: <TgIcon name="deleteuser" size={20} />, label: 'Disable Sharing' },
          ]
        : []),
      { icon: <TgIcon name="delete" size={20} />, label: 'Delete Chat', danger: true },
    ]
  } else if (chat.type === 'group') {
    items = [
      { icon: <TgIcon name="timer" size={20} />, label: 'Auto-delete', submenu: true },
      ...searchItems,
      muteItem,
      ...(onAddMember
        ? [{ icon: <TgIcon name="adduser" size={20} />, label: 'Add member', onClick: () => { onAddMember(); onClose() } }]
        : []),
      { icon: <TgIcon name="checkround" size={20} />, label: 'Select Messages', onClick: onSelectMessages ? () => { onSelectMessages(); onClose() } : undefined },
      { icon: <TgIcon name="gift" size={20} />, label: 'Send a Gift' },
      { icon: <TgIcon name="delete" size={20} />, label: owned ? 'Delete Group' : 'Leave Group', danger: true },
    ]
  } else if (owned) {
    // owned channel
    items = [
      { icon: <TgIcon name="timer" size={20} />, label: 'Auto-delete', submenu: true },
      ...searchItems,
      muteItem,
      { icon: <TgIcon name="livestream" size={20} />, label: 'Live Stream' },
      { icon: <TgIcon name="checkround" size={20} />, label: 'Select Messages', onClick: onSelectMessages ? () => { onSelectMessages(); onClose() } : undefined },
      { icon: <TgIcon name="gift" size={20} />, label: 'Send a Gift' },
      { icon: <TgIcon name="boost" size={20} />, label: 'Boost Channel' },
      { icon: <TgIcon name="delete" size={20} />, label: 'Delete Channel', danger: true },
    ]
  } else {
    // channel you don't own
    items = [
      ...searchItems,
      muteItem,
      { icon: <TgIcon name="message" size={20} />, label: 'View discussion' },
      { icon: <TgIcon name="checkround" size={20} />, label: 'Select Messages', onClick: onSelectMessages ? () => { onSelectMessages(); onClose() } : undefined },
      { icon: <TgIcon name="gift" size={20} />, label: 'Send a Gift' },
      { icon: <TgIcon name="boost" size={20} />, label: 'Boost Channel' },
      { icon: <TgIcon name="delete" size={20} />, label: 'Leave Channel', danger: true },
    ]
  }

  const autoItems = ['Never', '1 day', '1 week', '1 month', 'Other']

  return (
    <>
      {/* Auto-delete submenu (to the left of the main menu) */}
      <Menu
        open={autoOpen}
        onClose={onClose}
        style={{ top: anchor.top, right: anchor.right + 256, transformOrigin: 'top right' }}
      >
        {autoItems.map((a) => (
          <MenuItem
            key={a}
            icon={
              a === 'Other' ? <TgIcon name="tools" size={20} /> : a === 'Never' ? <TgIcon name="auto_delete_circle_off" size={20} /> : <TgIcon name="timer" size={20} />
            }
            label={t(a)}
            onClick={onClose}
          />
        ))}
      </Menu>

      {/* Main menu */}
      <Menu
        open
        onClose={onClose}
        style={{ top: anchor.top, right: anchor.right, width: 244, transformOrigin: 'top right' }}
      >
        {items.map((it) => (
          <MenuItem
            key={it.label}
            icon={it.icon}
            label={t(it.label)}
            danger={it.danger}
            right={it.submenu ? <TgIcon name="next" size={20} /> : undefined}
            onClick={() => (it.submenu ? setAutoOpen((o) => !o) : it.onClick ? it.onClick() : onClose())}
          />
        ))}
      </Menu>
    </>
  )
}
