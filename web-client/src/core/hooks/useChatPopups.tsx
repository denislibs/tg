// useChatPopups — фасад открытия всех императивных попапов колонки чата через
// popupStore (порт tweb PopupManager). Заменяет булевый реестр useConversationPopups
// и мегапропсы ConversationOverlays: каждый попап открывается по месту действия
// со своими пропсами, а не рендерится «на всякий случай» в компоненте-реестре.
//
// Контракты закрытия (см. popupStore.PopupApi):
//   • self-animating (HeaderMenu/AttachMenu/пикеры): onClose={p.destroy}
//   • open-controlled (MutePopup/ChatThemesPicker/LocationPicker): open/requestClose/onExitComplete
//   • presence (слайд-ины AddContact/EditContact): <AnimatePresence onExitComplete=…>
//   • instant (ConfirmDialog и пр.): onClose={p.destroy}
import { AnimatePresence } from 'framer-motion'
import { openPopup } from '../../stores/popupStore'
import { useT } from '../../i18n'
import { useManagers } from './useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import { useMessagesStore } from '../../stores/messagesStore'
import type { Chat, OpenPeer } from '../../data'
import type { Message } from '../models'
import type { ThreadInfo } from '../../components/Chat'
import HeaderMenu from '../../components/HeaderMenu'
import AttachMenu from '../../components/AttachMenu'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import Avatar from '../../shared/ui/Avatar'
import { useAvatarSrc } from '../../components/useAvatarSrc'
import TgIcon from '../../components/TgIcon'
import { TopicIcon as _TopicIcon } from '../../components/TopicsPanel'
import ConfirmDialog from '../../components/settings/ConfirmDialog'
import MutePopup from '../../components/MutePopup'
import ChatThemesPicker from '../../components/ChatThemesPicker'
import AddContactView from '../../components/AddContactView'
import EditContactView from '../../components/EditContactView'
import LocationPicker from '../../components/LocationPicker'
import { ContactPicker } from '../../components/messages/ChatDialogs'
import SendGiftPopup from '../../components/stars/SendGiftPopup'
import PinnedMessagesScreen from '../../components/conversation/PinnedMessagesScreen'
import ScheduledView from '../../components/ScheduledView'
import BoostPopup from '../../components/BoostPopup'
import StreamSettingsPopup from '../../components/StreamSettingsPopup'
import CreateGiveawayPopup from '../../components/CreateGiveawayPopup'
import SuggestPostPopup from '../../components/SuggestPostPopup'
import SuggestedPostsView from '../../components/SuggestedPostsView'
import CreatePollPopup from '../../components/CreatePollPopup'
import CreateChecklistPopup from '../../components/CreateChecklistPopup'

// TopicIcon импортируется на случай будущего использования в тред-меню (аватар темы).
void _TopicIcon

export interface ChatPopupDeps {
  chat: Chat
  numericChatId: number
  isRealChat: boolean
  isChannel: boolean
  activeThemeId?: string
  muted: boolean
  owned: boolean
  thread?: ThreadInfo
  canManageTopic: boolean
  canAddMember: boolean
  canCreateGiveaway: boolean
  canUnpinAll: boolean
  pins: Message[]
  deleteLabels: { title: string; text: string; action: string }
  livestreamActive: boolean
  /** инфо-панель живёт локальным стейтом в Chat (toggle + сосуществует с gift) */
  setInfoOpen: (v: boolean | ((o: boolean) => boolean)) => void
  applyMute: (next: boolean, seconds?: number | null) => void
  toggleMute: () => void
  startSelectMode: () => void
  setSelectionMode: (v: boolean) => void
  doDeleteChat: () => void
  doClearHistory: () => void
  openPicker: (accept: string, asFile: boolean) => void
  sendGeo: (lat: number, lng: number, opts?: { title?: string; address?: string; livePeriod?: number; heading?: number }) => void
  sendContact: (userId: number, name: string) => void
  setPendingMedia: (v: { files: File[]; asFile: boolean } | null) => void
  slowmodeMarkSent: () => void
  jumpToSeq: (seq: number) => void
  setScheduledCount: (n: number) => void
  onOpenPeer?: (peer: OpenPeer) => void
  onCloseThread?: () => void
}

export function useChatPopups(d: ChatPopupDeps) {
  const t = useT()
  const managers = useManagers()
  const meId = useChatsStore((s) => s.meId)
  const meName = useChatsStore((s) => s.me?.displayName)
  const allDialogs = useChatsStore((s) => s.dialogs)
  const { chat, numericChatId, isRealChat, isChannel } = d

  const openGift = () => {
    if (chat.type !== 'private' || chat.peerId == null) return
    const toUserId = chat.peerId
    openPopup((p) => (
      <SendGiftPopup open={p.open} onClose={p.requestClose} onExitComplete={p.onExitComplete} toUserId={toUserId} toName={chat.name} />
    ))
  }

  const openThemePicker = () => openPopup((p) => (
    <ChatThemesPicker open={p.open} onClose={p.requestClose} onExitComplete={p.onExitComplete} chatId={numericChatId} currentThemeId={d.activeThemeId} />
  ))

  // Аватар чата для хедера MutePopup (tweb PopupMute → PopupPeer peerId → avatarNew 32)
  const chatAvatarSrc = useAvatarSrc(chat.avatarUrl)
  const openMute = () => openPopup((p) => (
    <MutePopup
      open={p.open}
      onClose={p.requestClose}
      onExitComplete={p.onExitComplete}
      onMute={(seconds) => d.applyMute(true, seconds)}
      avatar={<Avatar background={chat.avatar} text={chat.avatarText} emoji={chat.avatarEmoji} src={chatAvatarSrc} size={32} />}
    />
  ))

  const openConfirmDelete = () => openPopup((p) => (
    <ConfirmDialog
      title={t(d.deleteLabels.title)}
      text={t(d.deleteLabels.text)}
      action={t(d.deleteLabels.action)}
      danger
      onConfirm={d.doDeleteChat}
      onClose={p.destroy}
    />
  ))

  const openConfirmClear = () => openPopup((p) => (
    <ConfirmDialog
      title={t('Clear History')}
      text={t('Are you sure you want to clear history?')}
      action={t('Clear')}
      danger
      onConfirm={d.doClearHistory}
      onClose={p.destroy}
    />
  ))

  const openAddContact = () => openPopup((p) => (
    <AnimatePresence onExitComplete={p.onExitComplete}>
      {p.open && <AddContactView chat={chat} onClose={p.requestClose} />}
    </AnimatePresence>
  ))

  const openEditContact = () => openPopup((p) => (
    <AnimatePresence onExitComplete={p.onExitComplete}>
      {p.open && <EditContactView chat={chat} onClose={p.requestClose} />}
    </AnimatePresence>
  ))

  const openPinned = () => {
    if (!isRealChat || d.pins.length === 0) return
    openPopup((p) => (
      <PinnedMessagesScreen
        chatId={numericChatId}
        pins={d.pins}
        meId={meId}
        meName={meName}
        canUnpinAll={d.canUnpinAll}
        onJump={(seq) => { p.destroy(); d.jumpToSeq(seq) }}
        onClose={p.destroy}
      />
    ))
  }

  const openScheduled = () => {
    if (!isRealChat) return
    openPopup((p) => (
      <ScheduledView chatId={numericChatId} onClose={p.destroy} onChanged={d.setScheduledCount} />
    ))
  }

  const openBoost = () => openPopup((p) => (
    <BoostPopup chatId={numericChatId} onClose={p.destroy} />
  ))

  const openStream = () => openPopup((p) => (
    <StreamSettingsPopup chatId={numericChatId} active={d.livestreamActive} onClose={p.destroy} />
  ))

  const openGiveaway = () => openPopup((p) => (
    <CreateGiveawayPopup
      onClose={p.destroy}
      onCreate={(a) => {
        p.destroy()
        void managers.boosts
          .createGiveaway(numericChatId, { ...a, clientMsgId: crypto.randomUUID() })
          .then((msg) => useMessagesStore.getState().applyIncoming(numericChatId, msg))
      }}
    />
  ))

  const openSuggest = () => openPopup((p) => (
    <SuggestPostPopup chatId={numericChatId} onClose={p.destroy} />
  ))

  const openSuggested = () => openPopup((p) => (
    <SuggestedPostsView chatId={numericChatId} mode="admin" onClose={p.destroy} />
  ))

  const openPoll = () => openPopup((p) => (
    <CreatePollPopup
      onClose={p.destroy}
      onCreate={(poll) => {
        p.destroy()
        void managers.messages
          .sendPoll(numericChatId, { ...poll, clientMsgId: crypto.randomUUID() })
          .then((msg) => useMessagesStore.getState().applyIncoming(numericChatId, msg))
      }}
    />
  ))

  const openChecklist = () => openPopup((p) => (
    <CreateChecklistPopup
      onClose={p.destroy}
      onCreate={(c) => {
        p.destroy()
        void managers.messages
          .sendChecklist(numericChatId, { ...c, clientMsgId: crypto.randomUUID() })
          .then((msg) => useMessagesStore.getState().applyIncoming(numericChatId, msg))
      }}
    />
  ))

  const openLocation = () => openPopup((p) => (
    <LocationPicker open={p.open} onClose={p.requestClose} onExitComplete={p.onExitComplete} onSend={(lat, lng, opts) => d.sendGeo(lat, lng, opts)} />
  ))

  const openContactPicker = () => openPopup((p) => (
    <ContactPicker
      dialogs={allDialogs}
      onPick={(userId, name) => { p.destroy(); d.sendContact(userId, name) }}
      onClose={p.destroy}
    />
  ))

  const openAttach = (anchor: { left: number; bottom: number }) => openPopup((p) => (
    <AttachMenu
      anchor={anchor}
      onClose={p.destroy}
      onPhotoVideo={isRealChat ? () => d.openPicker('image/*,video/*', false) : undefined}
      onFile={isRealChat ? () => d.openPicker('*/*', true) : undefined}
      onPoll={isRealChat && (chat.type === 'group' || chat.type === 'channel') ? openPoll : undefined}
      onChecklist={isRealChat ? openChecklist : undefined}
      onLocation={isRealChat ? openLocation : undefined}
      onContact={isRealChat ? openContactPicker : undefined}
    />
  ))

  const openHeaderMenu = (anchor: { top: number; right: number }) => openPopup((p) => (
    <HeaderMenu
      chat={isRealChat ? { ...chat, muted: d.muted || undefined } : chat}
      anchor={anchor}
      onClose={p.destroy}
      onToggleMute={isRealChat ? d.toggleMute : undefined}
      onAddMember={d.canAddMember ? () => d.setInfoOpen(true) : undefined}
      onSelectMessages={d.startSelectMode}
      onAddContact={chat.type === 'private' && chat.peerId != null ? openAddContact : undefined}
      onDeleteChat={isRealChat ? openConfirmDelete : undefined}
      onClearHistory={isRealChat && chat.type !== 'channel' ? openConfirmClear : undefined}
      onChangeTheme={isRealChat && (chat.type === 'private' || chat.type === 'group') ? openThemePicker : undefined}
      onSendGift={chat.type === 'private' && chat.peerId != null && chat.peerId !== meId ? openGift : undefined}
      onBoost={isChannel && isRealChat ? openBoost : undefined}
      onCreateGiveaway={d.canCreateGiveaway ? openGiveaway : undefined}
      onStartStream={isChannel && isRealChat && d.owned ? openStream : undefined}
      onOpenSuggested={d.canCreateGiveaway ? openSuggested : undefined}
    />
  ))

  const openThreadMenu = (anchor: { top: number; right: number }) => {
    const thread = d.thread
    if (!thread) return
    openPopup((p) => (
      <Menu
        open={p.open}
        onClose={p.requestClose}
        onExitComplete={p.onExitComplete}
        style={{ top: anchor.top, right: anchor.right, transformOrigin: 'top right' }}
      >
        <MenuItem
          icon={<TgIcon name="checkround" size={20} />}
          label={t('Select Messages')}
          onClick={() => { p.requestClose(); d.setSelectionMode(true) }}
        />
        <MenuItem
          icon={<TgIcon name={d.muted ? 'unmute' : 'mute'} size={20} />}
          label={t(d.muted ? 'Unmute' : 'Mute')}
          onClick={() => { p.requestClose(); d.applyMute(!d.muted) }}
        />
        {thread.kind === 'topic' && thread.topicId != null && d.canManageTopic && (
          <MenuItem
            icon={<TgIcon name="lock" size={20} />}
            label={t(thread.closed ? 'Reopen Topic' : 'Close Topic')}
            onClick={() => {
              p.requestClose()
              void managers.groups.closeTopic(numericChatId, thread.topicId!, !thread.closed).then(() => d.onCloseThread?.())
            }}
          />
        )}
      </Menu>
    ))
  }

  return {
    openHeaderMenu, openThreadMenu, openAttach,
    openAddContact, openEditContact, openMute, openThemePicker, openGift,
    openPinned, openScheduled, openBoost, openStream, openGiveaway,
    openSuggest, openSuggested, openPoll, openChecklist, openLocation, openContactPicker,
    openConfirmDelete, openConfirmClear,
  }
}
