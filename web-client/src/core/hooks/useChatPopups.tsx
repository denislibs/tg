// useChatPopups — фасад открытия всех императивных попапов колонки чата через
// popupStore (порт tweb PopupManager). Заменяет булевый реестр useConversationPopups
// и мегапропсы ConversationOverlays: каждый попап открывается по месту действия
// со своими пропсами, а не рендерится «на всякий случай» в компоненте-реестре.
//
// Контракты закрытия (см. popupStore.PopupApi):
//   • self-animating (HeaderMenu/AttachMenu/пикеры): onClose={p.destroy}
//   • open-controlled (MutePopup/ChatThemesPicker/LocationPicker): open/requestClose/onExitComplete
//   • instant (ConfirmDialog, слайд-ины AddContact/EditContact и пр.): onClose={p.destroy}
import { useEffect, useRef } from 'react'
import { openPopup } from '../../stores/popupStore'
import { useT } from '../../i18n'
import { useManagers } from './useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import type { Chat, OpenPeer } from '../../data'
import type { MyMessage } from '../models'
import type { ThreadInfo } from '../../components/Chat'
import type { MessageSendingParams } from '../managers/messages/sendingParams'
import HeaderMenu from '../../components/HeaderMenu'
import AttachMenu from '../../components/AttachMenu'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import TgIcon from '../../components/TgIcon'
import { TopicIcon as _TopicIcon } from '../../components/TopicsPanel'
import ConfirmDialog from '../../components/settings/ConfirmDialog'
import PopupElement from '../../components/popups/popupElement'
import PopupMute from '../../components/popups/popupMute'
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
import { getUserTitle } from '../peers/getPeerTitle'

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
  pins: MyMessage[]
  deleteLabels: { title: string; text: string; action: string }
  livestreamActive: boolean
  /** инфо-панель живёт локальным стейтом в Chat (toggle + сосуществует с gift) */
  setInfoOpen: (v: boolean | ((o: boolean) => boolean)) => void
  applyMute: (next: boolean, seconds?: number | null) => void
  toggleMute: () => void
  /** Вход в режим выделения — порт tweb topbar.ts:560
   *  (`selection.toggleSelection(true, true)`): режимом владеет лента. */
  startSelectMode: () => void
  doDeleteChat: () => void
  doClearHistory: () => void
  openPicker: (accept: string, asFile: boolean) => void
  sendGeo: (lat: number, lng: number, opts?: { title?: string; address?: string; livePeriod?: number; heading?: number }) => void
  sendContact: (userId: number, name: string) => void
  /** Пакет параметров отправки (`useChatSend.getMessageSendingParams`, порт tweb
   *  `Chat.getMessageSendingParams`) — опрос уходит своим REST-путём, но поля
   *  отправки собирает не сам, а получает пакетом, как и все остальные пути. */
  getMessageSendingParams: () => MessageSendingParams
  /** Сброс плашки ответа после отправки (порт tweb `ChatInput.onMessageSent`). */
  onMessageSent: () => void
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
  // Имя собирает клиент: `display_name` с провода убран.
  const meName = useChatsStore((s) => (s.me ? getUserTitle(s.me.user) : undefined))
  const allDialogs = useChatsStore((s) => s.dialogs)
  const { chat, numericChatId, isRealChat, isChannel } = d

  const openGift = () => {
    // Ключ приватного диалога И ЕСТЬ id собеседника — второго поля рядом с `id`
    // больше нет.
    if (chat.type !== 'private') return
    const toUserId = Number(chat.id)
    openPopup((p) => (
      <SendGiftPopup open={p.open} onClose={p.requestClose} onExitComplete={p.onExitComplete} toUserId={toUserId} toName={chat.name} />
    ))
  }

  const openThemePicker = () => openPopup((p) => (
    <ChatThemesPicker open={p.open} onClose={p.requestClose} onExitComplete={p.onExitComplete} chatId={numericChatId} currentThemeId={d.activeThemeId} />
  ))

  // PopupMute — теперь vanilla-попап (задача 3 плана solid-wave-1): не идёт
  // через React-реестр `openPopup`, а создаётся и показывается напрямую, как
  // и в оригинале (`PopupElement.createPopup(PopupMute, …)`, mute.ts:51 —
  // `this.show()` в конце конструктора). Аватар строит сам `PopupPeer` из
  // `peerId` (зеркало пиров), а не React `<Avatar>` — второго источника
  // карточки чата тут больше нет.
  // Инстанс держим в ref, чтобы снять его на размонтирование хука (см. эффект
  // ниже) — владелец сам снимает то, что создал (правило шва,
  // web-client/CLAUDE.md). PopupMute — vanilla-попап вне popupStore, поэтому
  // `clearPopups()` (Chat.tsx, useEffect(() => () => clearPopups(), [])) его
  // не видит: без этого ref мьют-попап пережил бы размонтирование Chat при
  // смене чата (колонка ремаунтится по `key`) — найдено финальным ревью
  // solid-wave-1, тот же класс дефекта, что у delete-конфирма
  // (`ChatMsgActionPopups.tsx`).
  const mutePopupRef = useRef<PopupMute | undefined>(undefined)
  const openMute = () => {
    mutePopupRef.current = PopupElement.createPopup(PopupMute, numericChatId, managers, (seconds) => d.applyMute(true, seconds))
  }
  useEffect(() => () => mutePopupRef.current?.forceHide(), [])

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
      title={t('Calendar.ClearHistory')}
      text={t('Chat.ClearHistory.Text')}
      action={t('Clear')}
      danger
      onConfirm={d.doClearHistory}
      onClose={p.destroy}
    />
  ))

  // Слайд-ины карточек контакта — вкладки слайдера правой колонки (tweb
  // `SidebarSlider.createTab`/`closeTab`, `components/slider.ts:41-46`): узел
  // создаётся на открытии и снимается самим экраном по концу перехода, поэтому
  // попапу достаточно instant-контракта (`onClose={p.destroy}`).
  const openAddContact = () => openPopup((p) => (
    <AddContactView chat={chat} onClose={p.destroy} />
  ))

  const openEditContact = () => openPopup((p) => (
    <EditContactView chat={chat} onClose={p.destroy} />
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
          .then(() => {})
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
        const sendingParams = d.getMessageSendingParams()
        d.onMessageSent()
        void managers.messages
          .sendPoll(numericChatId, { ...poll, clientMsgId: crypto.randomUUID(), ...sendingParams })
          .then(() => {})
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
          .then(() => {})
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
      onAddContact={chat.type === 'private' ? openAddContact : undefined}
      onDeleteChat={isRealChat ? openConfirmDelete : undefined}
      onClearHistory={isRealChat && chat.type !== 'channel' ? openConfirmClear : undefined}
      onChangeTheme={isRealChat && (chat.type === 'private' || chat.type === 'group') ? openThemePicker : undefined}
      onSendGift={chat.type === 'private' && Number(chat.id) !== meId ? openGift : undefined}
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
        corner="bottom-left"
        style={{ top: anchor.top, right: anchor.right }}
      >
        <MenuItem
          icon={<TgIcon name="checkround" size={20} />}
          label={t('Chat.Menu.SelectMessages')}
          onClick={() => { p.requestClose(); d.startSelectMode() }}
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
