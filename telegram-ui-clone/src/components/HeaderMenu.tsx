import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import TgIcon from './TgIcon'
import { joinGroupCall } from '../core/calls/groupCallEngine'
import Menu, { MenuItem } from '../shared/ui/Menu'
import { useCall } from './call/CallProvider'
import { SERVICE_USER_ID } from '../core/dialogToChat'
import { useSearchStore } from '../stores/searchStore'
import useMediaQuery from '../shared/lib/useMediaQuery'
import type { Chat } from '../data'
import { useT } from '../i18n'
import { useManagers } from '../core/hooks/useManagers'
import { loadChats } from '../stores/chatsStore'
import { usePrivacyStore } from '../stores/privacyStore'
import { useReportStore } from '../stores/reportStore'

type Item = { icon: ReactNode; label: string; danger?: boolean; submenu?: boolean; onClick?: () => void }

interface Props {
  chat: Chat
  anchor: { top: number; right: number }
  onClose: () => void
  onToggleMute?: () => void
  onAddMember?: () => void
  onSelectMessages?: () => void
  onAddContact?: () => void
  /** удалить чат / покинуть группу-канал (владелец удаляет для всех) */
  onDeleteChat?: () => void
  /** очистить историю у себя (Telegram deleteHistory just_clear) */
  onClearHistory?: () => void
  /** открыть пикер темы оформления чата (messages.setChatTheme) */
  onChangeTheme?: () => void
  /** открыть попап буста канала */
  onBoost?: () => void
  /** открыть попап создания розыгрыша (владелец канала) */
  onCreateGiveaway?: () => void
}

export default function HeaderMenu({ chat, anchor, onClose, onToggleMute, onAddMember, onSelectMessages, onAddContact, onDeleteChat, onClearHistory, onChangeTheme, onBoost, onCreateGiveaway }: Props) {
  const t = useT()
  const managers = useManagers()
  const { start: startCall } = useCall()
  const setSearchOpen = useSearchStore((s) => s.setOpen)
  const [autoOpen, setAutoOpen] = useState(false)
  // Меню закрывается с exit-анимацией ui-kit Menu: сначала open=false, владелец
  // размонтирует нас в onExitComplete (иначе выход обрубается мгновенным unmount).
  const [open, setOpen] = useState(true)
  const close = () => { setAutoOpen(false); setOpen(false) }
  const muted = !!chat.muted
  const owned = !!chat.owned
  const handleMute = onToggleMute
    ? () => { onToggleMute(); close() }
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
      ? [{ icon: <TgIcon name="search" size={20} />, label: 'Search', onClick: () => { setSearchOpen(numericChatId, true); close() } }]
      : []

  // Блокировка собеседника живёт в ⋮-меню чата, как в tweb (topbar.ts:
  // icon lock 'BlockUser' / lockoff 'Unblock'); в профиле её нет.
  const peerId = chat.peerId
  const canBlock = chat.type === 'private' && peerId != null && peerId !== SERVICE_USER_ID
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    if (!canBlock || peerId == null) return
    let alive = true
    void managers.privacy.profile(peerId).then((p) => { if (alive) setBlocked(p.isBlocked) }).catch(() => {})
    return () => { alive = false }
  }, [canBlock, peerId, managers])
  const toggleBlock = () => {
    if (peerId == null) return
    void (blocked ? managers.privacy.unblock(peerId) : managers.privacy.block(peerId))
      .then(() => managers.privacy.blocked(0, 1))
      .then((r) => usePrivacyStore.getState().setBlockedTotal(r.total))
      .catch(() => {})
    close()
  }

  // «Очистить историю» у себя (tweb PeerInfo.Action.ClearHistory): приватные чаты
  // и группы, где ты участник. Глиф broom в наш tgico-набор не портирован — берём
  // корзину delete, как остальные деструктивные действия.
  // «Изменить тему оформления» (Telegram messages.setChatTheme) — пикер тем чата.
  const themeItem: Item | null = onChangeTheme
    ? { icon: <TgIcon name="darkmode" size={20} />, label: 'Change Theme', onClick: () => { onChangeTheme(); close() } }
    : null

  const clearItem: Item | null = onClearHistory
    ? { icon: <TgIcon name="delete" size={20} />, label: 'Clear History', danger: true, onClick: () => { onClearHistory(); close() } }
    : null

  // «Пожаловаться» на чат целиком (tweb reportPeer): открывает глобальный
  // ReportPopup через reportStore без id сообщения.
  const reportItem: Item = {
    icon: <TgIcon name="hand" size={20} />,
    label: 'Report',
    danger: true,
    onClick: () => {
      if (Number.isFinite(numericChatId)) useReportStore.getState().open({ chatId: numericChatId })
      close()
    },
  }

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
            { icon: <TgIcon name="phone" size={20} />, label: 'Call', onClick: () => { startCall(false); close() } },
            { icon: <TgIcon name="videocamera" size={20} />, label: 'Video Call', onClick: () => { startCall(true); close() } },
          ]
        : []),
      { icon: <TgIcon name="checkround" size={20} />, label: 'Select Messages', onClick: onSelectMessages ? () => { onSelectMessages(); close() } : undefined },
      ...(!isService
        ? [
            { icon: <TgIcon name="adduser" size={20} />, label: 'Add to contacts', onClick: onAddContact ? () => { onAddContact(); close() } : undefined },
            { icon: <TgIcon name="gift" size={20} />, label: 'Send a Gift' },
            blocked
              ? { icon: <TgIcon name="lockoff" size={20} />, label: 'Unblock user', onClick: toggleBlock }
              : { icon: <TgIcon name="lock" size={20} />, label: 'Block user', onClick: toggleBlock },
            { icon: <TgIcon name="deleteuser" size={20} />, label: 'Disable Sharing' },
          ]
        : []),
      ...(themeItem ? [themeItem] : []),
      ...(clearItem ? [clearItem] : []),
      ...(!isService ? [reportItem] : []),
      { icon: <TgIcon name="delete" size={20} />, label: 'Delete Chat', danger: true, onClick: onDeleteChat ? () => { onDeleteChat(); close() } : undefined },
    ]
  } else if (chat.type === 'group') {
    items = [
      // Видеочат (tweb PeerInfo.Action.VoiceChat, иконка videochat)
      {
        icon: <TgIcon name="videochat" size={20} />,
        label: 'Video Chat',
        onClick: () => { void joinGroupCall(Number(chat.id)); close() },
      },
      { icon: <TgIcon name="timer" size={20} />, label: 'Auto-delete', submenu: true },
      ...searchItems,
      muteItem,
      ...(onAddMember
        ? [{ icon: <TgIcon name="adduser" size={20} />, label: 'Add member', onClick: () => { onAddMember(); close() } }]
        : []),
      { icon: <TgIcon name="checkround" size={20} />, label: 'Select Messages', onClick: onSelectMessages ? () => { onSelectMessages(); close() } : undefined },
      { icon: <TgIcon name="gift" size={20} />, label: 'Send a Gift' },
      ...(themeItem ? [themeItem] : []),
      ...(clearItem ? [clearItem] : []),
      reportItem,
      { icon: <TgIcon name="delete" size={20} />, label: owned ? 'Delete Group' : 'Leave Group', danger: true, onClick: onDeleteChat ? () => { onDeleteChat(); close() } : undefined },
    ]
  } else if (owned) {
    // owned channel
    items = [
      { icon: <TgIcon name="timer" size={20} />, label: 'Auto-delete', submenu: true },
      ...searchItems,
      muteItem,
      { icon: <TgIcon name="livestream" size={20} />, label: 'Live Stream' },
      { icon: <TgIcon name="checkround" size={20} />, label: 'Select Messages', onClick: onSelectMessages ? () => { onSelectMessages(); close() } : undefined },
      { icon: <TgIcon name="gift" size={20} />, label: 'Send a Gift' },
      { icon: <TgIcon name="boost" size={20} />, label: 'Boost Channel', onClick: onBoost ? () => { onBoost(); close() } : undefined },
      { icon: <TgIcon name="gift_premium" size={20} />, label: 'Create Giveaway', onClick: onCreateGiveaway ? () => { onCreateGiveaway(); close() } : undefined },
      { icon: <TgIcon name="delete" size={20} />, label: 'Delete Channel', danger: true, onClick: onDeleteChat ? () => { onDeleteChat(); close() } : undefined },
    ]
  } else {
    // channel you don't own
    items = [
      ...searchItems,
      muteItem,
      { icon: <TgIcon name="message" size={20} />, label: 'View discussion' },
      { icon: <TgIcon name="checkround" size={20} />, label: 'Select Messages', onClick: onSelectMessages ? () => { onSelectMessages(); close() } : undefined },
      { icon: <TgIcon name="gift" size={20} />, label: 'Send a Gift' },
      { icon: <TgIcon name="boost" size={20} />, label: 'Boost Channel', onClick: onBoost ? () => { onBoost(); close() } : undefined },
      reportItem,
      { icon: <TgIcon name="delete" size={20} />, label: 'Leave Channel', danger: true, onClick: onDeleteChat ? () => { onDeleteChat(); close() } : undefined },
    ]
  }

  // Per-chat автоудаление (Telegram messages.setHistoryTTL): применяется к
  // НОВЫМ сообщениям чата; сервер объявляет смену сервисной пилюлей set_ttl.
  const DAY = 86400
  const autoItems: { label: string; period: number }[] = [
    { label: 'Never', period: 0 },
    { label: '1 day', period: DAY },
    { label: '1 week', period: 7 * DAY },
    { label: '1 month', period: 30 * DAY },
  ]
  const currentPeriod = chat.autoDeletePeriod ?? 0
  const setChatTtl = (period: number) => {
    if (Number.isFinite(numericChatId)) {
      void managers.privacy.setChatAutoDelete(numericChatId, period).then(() => loadChats(managers)).catch(() => {})
    }
    close()
  }

  return (
    <>
      {/* Auto-delete submenu (to the left of the main menu) */}
      <Menu
        open={autoOpen && open}
        onClose={close}
        style={{ top: anchor.top, right: anchor.right + 256, transformOrigin: 'top right' }}
      >
        {autoItems.map((a) => (
          <MenuItem
            key={a.label}
            icon={a.period === 0 ? <TgIcon name="auto_delete_circle_off" size={20} /> : <TgIcon name="timer" size={20} />}
            label={t(a.label)}
            right={currentPeriod === a.period ? <TgIcon name="check" size={20} /> : undefined}
            onClick={() => setChatTtl(a.period)}
          />
        ))}
      </Menu>

      {/* Main menu */}
      <Menu
        open={open}
        onClose={close}
        onExitComplete={onClose}
        style={{ top: anchor.top, right: anchor.right, width: 244, transformOrigin: 'top right' }}
      >
        {items.map((it) => (
          <MenuItem
            key={it.label}
            icon={it.icon}
            label={t(it.label)}
            danger={it.danger}
            right={it.submenu ? <TgIcon name="next" size={20} /> : undefined}
            onClick={() => (it.submenu ? setAutoOpen((o) => !o) : it.onClick ? it.onClick() : close())}
          />
        ))}
      </Menu>
    </>
  )
}
