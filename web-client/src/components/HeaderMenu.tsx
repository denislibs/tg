import type { LangPackKey } from '@/lang'
import { useState } from 'react'
import type { ReactNode } from 'react'
import TgIcon from './TgIcon'
import { joinGroupCall } from '../core/calls/groupCallEngine'
import Menu, { MenuItem } from '../shared/ui/Menu'
import { startCallForChat } from './call/CallProvider'
import { SERVICE_USER_ID } from '../core/dialogToChat'
import { useSearchStore } from '../stores/searchStore'
import useMediaQuery from '../shared/lib/useMediaQuery'
import type { Chat } from '../data'
import { useT } from '../i18n'
import { useHeaderMenuActions } from '../core/hooks/useHeaderMenuActions'
import { useReportStore } from '../stores/reportStore'

type Item = { icon: ReactNode; label: LangPackKey; danger?: boolean; submenu?: boolean; onClick?: () => void }

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
  /** открыть попап отправки подарка собеседнику (Chat.Menu.SendGift) */
  onSendGift?: () => void
  /** открыть попап буста канала */
  onBoost?: () => void
  /** открыть попап создания розыгрыша (владелец канала) */
  onCreateGiveaway?: () => void
  /** открыть попап настроек RTMP-трансляции (владелец канала) */
  onStartStream?: () => void
  /** открыть список предложенных постов (админ канала) */
  onOpenSuggested?: () => void
}

export default function HeaderMenu({ chat, anchor, onClose, onToggleMute, onAddMember, onSelectMessages, onAddContact, onDeleteChat, onClearHistory, onChangeTheme, onSendGift, onBoost, onCreateGiveaway, onStartStream, onOpenSuggested }: Props) {
  const t = useT()
  const initSearch = useSearchStore((s) => s.initSearch)
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
    ? { icon: <TgIcon name="unmute" size={20} />, label: 'ChatList.Context.Unmute', onClick: handleMute }
    : { icon: <TgIcon name="mute" size={20} />, label: 'ChatList.Context.Mute', onClick: handleMute }

  // На мобилке лупа скрыта из шапки — поиск живёт пунктом меню
  // (tweb topbar.ts: menuButton 'Search', verify: mediaSizes.isMobile).
  const narrow = useMediaQuery('(max-width:900px)')
  const numericChatId = Number(chat.id)
  const searchItems: Item[] =
    narrow && Number.isFinite(numericChatId) && String(numericChatId) === chat.id
      ? [{ icon: <TgIcon name="search" size={20} />, label: 'Search', onClick: () => { initSearch(numericChatId); close() } }]
      : []

  // Блокировка собеседника живёт в ⋮-меню чата, как в tweb (topbar.ts:
  // icon lock 'BlockUser' / lockoff 'Unblock'); в профиле её нет.
  // Ключ пира — сам `chat.id` (знаковый): у приватного диалога он и есть id
  // собеседника, отдельного поля рядом больше нет.
  const peerId = numericChatId
  const canBlock = chat.type === 'private' && peerId !== SERVICE_USER_ID
  const { blocked, toggleBlock, setChatTtl } = useHeaderMenuActions({ peerId, canBlock, close })

  // «Очистить историю» у себя (tweb PeerInfo.Action.ClearHistory): приватные чаты
  // и группы, где ты участник. Глиф broom в наш tgico-набор не портирован — берём
  // корзину delete, как остальные деструктивные действия.
  // «Изменить тему оформления» (Telegram messages.setChatTheme) — пикер тем чата.
  const themeItem: Item | null = onChangeTheme
    ? { icon: <TgIcon name="darkmode" size={20} />, label: 'Chat.Menu.ChangeTheme', onClick: () => { onChangeTheme(); close() } }
    : null

  const clearItem: Item | null = onClearHistory
    ? { icon: <TgIcon name="delete" size={20} />, label: 'Calendar.ClearHistory', danger: true, onClick: () => { onClearHistory(); close() } }
    : null

  // «Предложенные посты» (Telegram suggested posts) — админ канала.
  const suggestedItem: Item | null = onOpenSuggested
    ? { icon: <TgIcon name="add_chat" size={20} />, label: 'SuggestedPosts.Title', onClick: () => { onOpenSuggested(); close() } }
    : null

  // «Пожаловаться» на чат целиком (tweb reportPeer): открывает глобальный
  // ReportPopup через reportStore без id сообщения.
  const reportItem: Item = {
    icon: <TgIcon name="hand" size={20} />,
    label: 'ReportChat',
    danger: true,
    onClick: () => {
      if (Number.isFinite(numericChatId)) useReportStore.getState().open({ peerId: numericChatId })
      close()
    },
  }

  let items: Item[]
  if (chat.type === 'private') {
    // Сервисному аккаунту «Telegram» нельзя позвонить, заблокировать его или
    // добавить в контакты — этих пунктов в меню нет (как в Telegram).
    const isService = peerId === SERVICE_USER_ID
    items = [
      { icon: <TgIcon name="timer" size={20} />, label: 'AutoDeleteMessagesShort', submenu: true },
      ...searchItems,
      muteItem,
      ...(!isService
        ? ([
            { icon: <TgIcon name="phone" size={20} />, label: 'Call', onClick: () => { startCallForChat(chat, false); close() } },
            { icon: <TgIcon name="videocamera" size={20} />, label: 'VideoCall', onClick: () => { startCallForChat(chat, true); close() } },
          ] satisfies Item[])
        : []),
      { icon: <TgIcon name="checkround" size={20} />, label: 'Chat.Menu.SelectMessages', onClick: onSelectMessages ? () => { onSelectMessages(); close() } : undefined },
      ...(!isService
        ? ([
            { icon: <TgIcon name="adduser" size={20} />, label: 'AddContact', onClick: onAddContact ? () => { onAddContact(); close() } : undefined },
            { icon: <TgIcon name="gift" size={20} />, label: 'Chat.Menu.SendGift', onClick: onSendGift ? () => { onSendGift(); close() } : undefined },
            blocked
              ? { icon: <TgIcon name="lockoff" size={20} />, label: 'UnblockUser', onClick: toggleBlock }
              : { icon: <TgIcon name="lock" size={20} />, label: 'BlockUser', onClick: toggleBlock },
            { icon: <TgIcon name="deleteuser" size={20} />, label: 'DisableSharing' },
          ] satisfies Item[])
        : []),
      ...(themeItem ? [themeItem] : []),
      ...(clearItem ? [clearItem] : []),
      ...(!isService ? [reportItem] : []),
      { icon: <TgIcon name="delete" size={20} />, label: 'ChatList.Context.DeleteChat', danger: true, onClick: onDeleteChat ? () => { onDeleteChat(); close() } : undefined },
    ]
  } else if (chat.type === 'saved') {
    // «Избранное» (Saved Messages, self-peer): нет уведомлений/звонков/жалоб/
    // удаления — только поиск (на узком экране) и выбор сообщений.
    items = [
      ...searchItems,
      { icon: <TgIcon name="checkround" size={20} />, label: 'Chat.Menu.SelectMessages', onClick: onSelectMessages ? () => { onSelectMessages(); close() } : undefined },
    ]
  } else if (chat.type === 'secret') {
    // Секретный чат (E2E): минимальное меню. Нет поиска (сервер не ищет по
    // шифртексту), подарка/обсуждения/буста (это каналы/группы). Удаление и
    // очистка истории объединены в одно действие «Покинуть диалог» (удаляет
    // секретный чат у себя целиком).
    items = [
      { icon: <TgIcon name="timer" size={20} />, label: 'AutoDeleteMessagesShort', submenu: true },
      muteItem,
      { icon: <TgIcon name="checkround" size={20} />, label: 'Chat.Menu.SelectMessages', onClick: onSelectMessages ? () => { onSelectMessages(); close() } : undefined },
      { icon: <TgIcon name="delete" size={20} />, label: 'Chat.LeaveChat', danger: true, onClick: onDeleteChat ? () => { onDeleteChat(); close() } : undefined },
    ]
  } else if (chat.type === 'group') {
    items = [
      // Видеочат (tweb PeerInfo.Action.VoiceChat, иконка videochat)
      {
        icon: <TgIcon name="videochat" size={20} />,
        label: 'PeerInfo.Action.VoiceChat',
        onClick: () => { void joinGroupCall(Number(chat.id)); close() },
      },
      { icon: <TgIcon name="timer" size={20} />, label: 'AutoDeleteMessagesShort', submenu: true },
      ...searchItems,
      muteItem,
      ...(onAddMember
        ? ([{ icon: <TgIcon name="adduser" size={20} />, label: 'AddOneMemberAlertTitle', onClick: () => { onAddMember(); close() } }] satisfies Item[])
        : []),
      { icon: <TgIcon name="checkround" size={20} />, label: 'Chat.Menu.SelectMessages', onClick: onSelectMessages ? () => { onSelectMessages(); close() } : undefined },
      { icon: <TgIcon name="gift" size={20} />, label: 'Chat.Menu.SendGift' },
      ...(themeItem ? [themeItem] : []),
      ...(clearItem ? [clearItem] : []),
      reportItem,
      { icon: <TgIcon name="delete" size={20} />, label: owned ? 'DeleteMega' : 'ChatList.Context.LeaveGroup', danger: true, onClick: onDeleteChat ? () => { onDeleteChat(); close() } : undefined },
    ]
  } else if (owned) {
    // owned channel
    items = [
      { icon: <TgIcon name="timer" size={20} />, label: 'AutoDeleteMessagesShort', submenu: true },
      ...searchItems,
      muteItem,
      { icon: <TgIcon name="livestream" size={20} />, label: 'Rtmp.Topbar.Title', onClick: onStartStream ? () => { onStartStream(); close() } : undefined },
      { icon: <TgIcon name="checkround" size={20} />, label: 'Chat.Menu.SelectMessages', onClick: onSelectMessages ? () => { onSelectMessages(); close() } : undefined },
      { icon: <TgIcon name="gift" size={20} />, label: 'Chat.Menu.SendGift' },
      { icon: <TgIcon name="boost" size={20} />, label: 'BoostChannel', onClick: onBoost ? () => { onBoost(); close() } : undefined },
      { icon: <TgIcon name="gift_premium" size={20} />, label: 'Giveaway.Create', onClick: onCreateGiveaway ? () => { onCreateGiveaway(); close() } : undefined },
      ...(suggestedItem ? [suggestedItem] : []),
      { icon: <TgIcon name="delete" size={20} />, label: 'PeerInfo.DeleteChannel', danger: true, onClick: onDeleteChat ? () => { onDeleteChat(); close() } : undefined },
    ]
  } else {
    // channel you don't own
    items = [
      ...searchItems,
      muteItem,
      { icon: <TgIcon name="message" size={20} />, label: 'ViewDiscussion' },
      { icon: <TgIcon name="checkround" size={20} />, label: 'Chat.Menu.SelectMessages', onClick: onSelectMessages ? () => { onSelectMessages(); close() } : undefined },
      { icon: <TgIcon name="gift" size={20} />, label: 'Chat.Menu.SendGift' },
      { icon: <TgIcon name="boost" size={20} />, label: 'BoostChannel', onClick: onBoost ? () => { onBoost(); close() } : undefined },
      reportItem,
      { icon: <TgIcon name="delete" size={20} />, label: 'ChatList.Context.LeaveChannel', danger: true, onClick: onDeleteChat ? () => { onDeleteChat(); close() } : undefined },
    ]
  }

  // Per-chat автоудаление (Telegram messages.setHistoryTTL): применяется к
  // НОВЫМ сообщениям чата; сервер объявляет смену сервисной пилюлей set_ttl.
  const DAY = 86400
  const autoItems: { label: LangPackKey; period: number }[] = [
    { label: 'Never', period: 0 },
    { label: 'Duration.Days1', period: DAY },
    { label: 'Duration.Weeks1', period: 7 * DAY },
    { label: 'Duration.Months1', period: 30 * DAY },
  ]
  const currentPeriod = chat.autoDeletePeriod ?? 0

  return (
    <>
      {/* Auto-delete submenu (to the left of the main menu) */}
      <Menu
        open={autoOpen && open}
        onClose={close}
        corner="bottom-left"
        style={{ top: anchor.top, right: anchor.right + 256 }}
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
        corner="bottom-left"
        style={{ top: anchor.top, right: anchor.right, width: 244 }}
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
