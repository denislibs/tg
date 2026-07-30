// ConversationOverlays — «реестр попапов» колонки чата: весь хвост оверлеев,
// вынесенный из ConversationView, чтобы контроллер остался тонким. Здесь только
// монтаж/рендер попапов по флагам из useConversationPopups + бэгу действий над
// сообщениями (useMessageActions). Никакой новой логики — блоки перенесены 1:1,
// значения/хендлеры приходят пропсами (t/managers берём контекстом внутри).
import { lazy, Suspense } from 'react'
import { AnimatePresence } from 'framer-motion'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import AddContactView from '../AddContactView'
import EditContactView from '../EditContactView'
import HeaderMenu from '../HeaderMenu'
import ChatThemesPicker from '../ChatThemesPicker'
import ConfirmDialog from '../settings/ConfirmDialog'
import MutePopup from '../MutePopup'
import AttachMenu from '../AttachMenu'
import CreatePollPopup from '../CreatePollPopup'
import CreateChecklistPopup from '../CreateChecklistPopup'
import BoostPopup from '../BoostPopup'
import CreateGiveawayPopup from '../CreateGiveawayPopup'
import ScheduledView from '../ScheduledView'
import SuggestPostPopup from '../SuggestPostPopup'
import SuggestedPostsView from '../SuggestedPostsView'
import StreamSettingsPopup from '../StreamSettingsPopup'
import LocationPicker from '../LocationPicker'
import SendMediaPopup from '../messages/SendMediaPopup'
import PinnedMessagesScreen from './PinnedMessagesScreen'
import MessageContextMenu from './MessageContextMenu'
import FactCheckEditor from './FactCheckEditor'
import StarReactionPopup from '../stars/StarReactionPopup'
import SendGiftPopup from '../stars/SendGiftPopup'
import { ChatPicker, ContactPicker, DeleteMessageDialog, ForwardPicker, ViewersPopup, ReactedUsersPopup } from '../messages/ChatDialogs'
import TranslatePopup from '../messages/TranslatePopup'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { useMessagesStore } from '../../stores/messagesStore'
import { joinGroupCall } from '../../core/calls/groupCallEngine'
import { watchLivestream } from '../../core/calls/livestreamEngine'
import type { Chat, OpenPeer } from '../../data'
import type { Dialog, Message } from '../../core/models'
import type { ConversationPopups } from '../../core/hooks/useConversationPopups'
import type { useMessageActions } from '../../core/hooks/useMessageActions'
import type { useLightbox } from '../../core/hooks/useLightbox'
import type { ThreadInfo } from '../ConversationView'
import s from '../ConversationView.module.scss'

// MediaLightbox (просмотрщик медиа) грузится лениво — только при открытии.
const MediaLightbox = lazy(() => import('../messages/MediaLightbox'))
// Инфо-панель (открывается по клику) и статистика поста (slide-in сабвью) — не
// первый кадр; их поддерево (+ ChannelStats внутри панели) уводим в ленивые чанки.
const UserInfoPanel = lazy(() => import('../UserInfoPanel'))
const PostStats = lazy(() => import('../PostStats'))

type MsgActions = ReturnType<typeof useMessageActions>
type Lightbox = ReturnType<typeof useLightbox>['lightbox']

interface Props {
  chat: Chat
  numericChatId: number
  isRealChat: boolean
  isChannel: boolean
  meId: number | null
  meName?: string
  allDialogs: Dialog[]
  activeThemeId?: string
  muted: boolean
  owned: boolean
  thread?: ThreadInfo
  canManageTopic: boolean
  canAddMember: boolean
  canCreateGiveaway: boolean
  canUnpinAll: boolean
  pins: Message[]
  lightbox: Lightbox
  deleteLabels: { title: string; text: string; action: string }
  livestreamActive: boolean
  groupCallActive: number[]
  myGroupCallChat: number | null
  myWatchingChat: number | null
  pendingMedia: { files: File[]; asFile: boolean } | null
  popups: ConversationPopups
  msgActions: MsgActions
  onOpenPeer?: (peer: OpenPeer) => void
  onCloseThread?: () => void
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
  sendPendingMedia: (caption: string, asFile: boolean, paidPrice?: number | null) => void | Promise<void>
  slowmodeMarkSent: () => void
  closeLightbox: () => void
  jumpToSeq: (seq: number) => void
  setScheduledCount: (n: number) => void
}

export default function ConversationOverlays(props: Props) {
  const t = useT()
  const managers = useManagers()
  const {
    chat, numericChatId, isRealChat, isChannel, meId, meName,
    allDialogs, activeThemeId, muted, owned, thread, canManageTopic,
    canAddMember, canCreateGiveaway, canUnpinAll, pins, lightbox, deleteLabels,
    livestreamActive, groupCallActive, myGroupCallChat, myWatchingChat,
    pendingMedia, popups, msgActions,
    onOpenPeer, onCloseThread, applyMute, toggleMute, startSelectMode, setSelectionMode,
    doDeleteChat, doClearHistory, openPicker, sendGeo, sendContact,
    setPendingMedia, sendPendingMedia, slowmodeMarkSent, closeLightbox, jumpToSeq,
    setScheduledCount,
  } = props

  return (
    <>
      {/* Info panel (private / group / channel) */}
      <Suspense fallback={null}>
      <AnimatePresence>
        {popups.infoOpen && (
          <UserInfoPanel
            chat={chat}
            onClose={() => popups.setInfoOpen(false)}
            onOpenPeer={onOpenPeer}
            canAddMembers={canAddMember}
            onEditContact={() => { popups.setInfoOpen(false); popups.setEditContactOpen(true) }}
            onSendGift={chat.type === 'private' && chat.peerId != null && chat.peerId !== meId ? () => popups.setGiftPopupOpen(true) : undefined}
          />
        )}
      </AnimatePresence>
      </Suspense>

      {/* Add-contact screen (private chats) */}
      <AnimatePresence>
        {popups.addContactOpen && <AddContactView chat={chat} onClose={() => popups.setAddContactOpen(false)} />}
      </AnimatePresence>

      {/* Edit-contact screen (private chats): все редактируемые поля контакта */}
      <AnimatePresence>
        {popups.editContactOpen && <EditContactView chat={chat} onClose={() => popups.setEditContactOpen(false)} />}
      </AnimatePresence>

      {/* Попап длительности mute (tweb PopupMute) */}
      {popups.muteOpen != null && (
        <MutePopup
          open={popups.muteOpen}
          onClose={() => popups.setMuteOpen(false)}
          onExitComplete={() => popups.setMuteOpen(null)}
          onMute={(seconds) => applyMute(true, seconds)}
        />
      )}

      {/* ⋮-меню тред-шапки (tweb topbar в треде): Select / Mute / Закрыть тему */}
      {thread && (
        <Menu
          open={popups.threadMenu != null}
          onClose={() => popups.setThreadMenu(null)}
          style={popups.threadMenu ? { top: popups.threadMenu.top, right: popups.threadMenu.right, transformOrigin: 'top right' } : undefined}
        >
          <MenuItem
            icon={<TgIcon name="checkround" size={20} />}
            label={t('Select Messages')}
            onClick={() => { popups.setThreadMenu(null); setSelectionMode(true) }}
          />
          <MenuItem
            icon={<TgIcon name={muted ? 'unmute' : 'mute'} size={20} />}
            label={t(muted ? 'Unmute' : 'Mute')}
            onClick={() => { popups.setThreadMenu(null); applyMute(!muted) }}
          />
          {thread.kind === 'topic' && thread.topicId != null && canManageTopic && (
            <MenuItem
              icon={<TgIcon name="lock" size={20} />}
              label={t(thread.closed ? 'Reopen Topic' : 'Close Topic')}
              onClick={() => {
                popups.setThreadMenu(null)
                void managers.groups.closeTopic(numericChatId, thread.topicId!, !thread.closed).then(() => onCloseThread?.())
              }}
            />
          )}
        </Menu>
      )}

      {/* Header "⋮" menu */}
      {popups.headerMenu && (
        <HeaderMenu
          chat={isRealChat ? { ...chat, muted: muted || undefined } : chat}
          anchor={popups.headerMenu}
          onClose={() => popups.setHeaderMenu(null)}
          onToggleMute={isRealChat ? toggleMute : undefined}
          onAddMember={canAddMember ? () => popups.setInfoOpen(true) : undefined}
          onSelectMessages={startSelectMode}
          onAddContact={chat.type === 'private' && chat.peerId != null ? () => popups.setAddContactOpen(true) : undefined}
          onDeleteChat={isRealChat ? () => popups.setConfirmDelete(true) : undefined}
          onClearHistory={isRealChat && chat.type !== 'channel' ? () => popups.setConfirmClear(true) : undefined}
          onChangeTheme={isRealChat && (chat.type === 'private' || chat.type === 'group') ? () => popups.setThemePickerOpen(true) : undefined}
          onSendGift={chat.type === 'private' && chat.peerId != null && chat.peerId !== meId ? () => popups.setGiftPopupOpen(true) : undefined}
          onBoost={isChannel && isRealChat ? () => popups.setBoostOpen(true) : undefined}
          onCreateGiveaway={canCreateGiveaway ? () => popups.setCreateGiveawayOpen(true) : undefined}
          onStartStream={isChannel && isRealChat && owned ? () => popups.setStreamOpen(true) : undefined}
          onOpenSuggested={canCreateGiveaway ? () => popups.setSuggestedOpen(true) : undefined}
        />
      )}

      {/* Отправка подарка собеседнику (Chat.Menu.SendGift) — из «…»-меню шапки,
          независимо от открытой инфо-панели */}
      {chat.type === 'private' && chat.peerId != null && (
        <SendGiftPopup
          open={popups.giftPopupOpen}
          onClose={() => popups.setGiftPopupOpen(false)}
          toUserId={chat.peerId}
          toName={chat.name}
        />
      )}

      {/* Пикер темы оформления чата (messages.setChatTheme) */}
      {isRealChat && (
        <ChatThemesPicker
          open={popups.themePickerOpen}
          onClose={() => popups.setThemePickerOpen(false)}
          chatId={numericChatId}
          currentThemeId={activeThemeId}
        />
      )}

      {popups.confirmDelete && (
        <ConfirmDialog
          title={t(deleteLabels.title)}
          text={t(deleteLabels.text)}
          action={t(deleteLabels.action)}
          danger
          onConfirm={doDeleteChat}
          onClose={() => popups.setConfirmDelete(false)}
        />
      )}

      {popups.confirmClear && (
        <ConfirmDialog
          title={t('Clear History')}
          text={t('Are you sure you want to clear history?')}
          action={t('Clear')}
          danger
          onConfirm={doClearHistory}
          onClose={() => popups.setConfirmClear(false)}
        />
      )}

      {/* Attach menu */}
      {popups.attachAnchor && (
        <AttachMenu
          anchor={popups.attachAnchor}
          onClose={() => popups.setAttachAnchor(null)}
          onPhotoVideo={isRealChat ? () => openPicker('image/*,video/*', false) : undefined}
          onFile={isRealChat ? () => openPicker('*/*', true) : undefined}
          onPoll={isRealChat && (chat.type === 'group' || chat.type === 'channel') ? () => popups.setCreatePollOpen(true) : undefined}
          onChecklist={isRealChat ? () => popups.setCreateChecklistOpen(true) : undefined}
          onLocation={isRealChat ? () => popups.setLocationPickerOpen(true) : undefined}
          onContact={isRealChat ? () => popups.setContactPickerOpen(true) : undefined}
        />
      )}

      {/* Пикер геолокации (attach-меню → Локация): карта + venue + live */}
      <LocationPicker
        open={popups.locationPickerOpen}
        onClose={() => popups.setLocationPickerOpen(false)}
        onSend={(lat, lng, opts) => sendGeo(lat, lng, opts)}
      />

      {/* Пикер контакта (attach-меню → Контакт) */}
      {popups.contactPickerOpen && (
        <ContactPicker
          dialogs={allDialogs}
          onPick={(userId, name) => { popups.setContactPickerOpen(false); sendContact(userId, name) }}
          onClose={() => popups.setContactPickerOpen(false)}
        />
      )}

      {/* Баннер идущего видеочата (tweb topbar-call): Join, пока сам не в звонке */}
      {isRealChat && !thread && groupCallActive.length > 0 && myGroupCallChat !== numericChatId && (
        <div className={s.groupCallBanner} onClick={() => void joinGroupCall(numericChatId)}>
          <TgIcon name="videochat" size={18} color="#fff" />
          <Text size={14} weight={600} color="#fff" style={{ flex: 1 }}>
            {t('Video Chat')} · {groupCallActive.length} {t('participants')}
          </Text>
          <Text size={14} weight={700} color="#fff">{t('Join')}</Text>
        </div>
      )}

      {/* Баннер идущей RTMP-трансляции (tweb topbarLive): смотреть, пока сам не смотришь */}
      {isRealChat && !thread && livestreamActive && myWatchingChat !== numericChatId && (
        <div className={s.groupCallBanner} onClick={() => watchLivestream(numericChatId)}>
          <TgIcon name="livestream" size={18} color="#fff" />
          <Text size={14} weight={600} color="#fff" style={{ flex: 1 }}>
            {t('Live Stream')}
          </Text>
          <Text size={14} weight={700} color="#fff">{t('Join')}</Text>
        </div>
      )}

      {/* «Закреплённые сообщения» (tweb ChatType.Pinned): открепление последнего
          пина убирает pins → оверлей сам закрывается (tweb закрывает pinned-таб) */}
      {popups.pinnedOpen && isRealChat && pins.length > 0 && (
        <PinnedMessagesScreen
          chatId={numericChatId}
          pins={pins}
          meId={meId}
          meName={meName}
          canUnpinAll={canUnpinAll}
          onJump={(seq) => { popups.setPinnedOpen(false); jumpToSeq(seq) }}
          onClose={() => popups.setPinnedOpen(false)}
        />
      )}

      {/* «Запланированные сообщения» (tweb ChatType.Scheduled) */}
      {popups.scheduledOpen && isRealChat && (
        <ScheduledView
          chatId={numericChatId}
          onClose={() => popups.setScheduledOpen(false)}
          onChanged={setScheduledCount}
        />
      )}

      {/* Буст канала (tweb popupBoost) */}
      {popups.boostOpen && isChannel && isRealChat && (
        <BoostPopup chatId={numericChatId} onClose={() => popups.setBoostOpen(false)} />
      )}

      {/* Настройки RTMP-трансляции (tweb RtmpStartStreamPopup) — владелец канала */}
      {popups.streamOpen && isChannel && isRealChat && (
        <StreamSettingsPopup chatId={numericChatId} active={livestreamActive} onClose={() => popups.setStreamOpen(false)} />
      )}

      {/* Создание розыгрыша (tweb popupBoostsViaGifts) */}
      {popups.createGiveawayOpen && (
        <CreateGiveawayPopup
          onClose={() => popups.setCreateGiveawayOpen(false)}
          onCreate={(a) => {
            popups.setCreateGiveawayOpen(false)
            void managers.boosts
              .createGiveaway(numericChatId, { ...a, clientMsgId: crypto.randomUUID() })
              .then((msg) => useMessagesStore.getState().applyIncoming(numericChatId, msg))
          }}
        />
      )}

      {/* Предложить пост (tweb suggestPostPopup) — не-постер канала */}
      {popups.suggestOpen && isChannel && isRealChat && (
        <SuggestPostPopup chatId={numericChatId} onClose={() => popups.setSuggestOpen(false)} />
      )}

      {/* Предложенные посты — админ канала (список pending с действиями) */}
      {popups.suggestedOpen && isChannel && isRealChat && (
        <SuggestedPostsView chatId={numericChatId} mode="admin" onClose={() => popups.setSuggestedOpen(false)} />
      )}

      {/* «Новый опрос» (tweb popupCreatePoll) */}
      {popups.createPollOpen && (
        <CreatePollPopup
          onClose={() => popups.setCreatePollOpen(false)}
          onCreate={(p) => {
            popups.setCreatePollOpen(false)
            void managers.messages
              .sendPoll(numericChatId, { ...p, clientMsgId: crypto.randomUUID() })
              .then((msg) => useMessagesStore.getState().applyIncoming(numericChatId, msg))
          }}
        />
      )}

      {/* «Новый чек-лист» (tweb popups/checklist.tsx) */}
      {popups.createChecklistOpen && (
        <CreateChecklistPopup
          onClose={() => popups.setCreateChecklistOpen(false)}
          onCreate={(c) => {
            popups.setCreateChecklistOpen(false)
            void managers.messages
              .sendChecklist(numericChatId, { ...c, clientMsgId: crypto.randomUUID() })
              .then((msg) => useMessagesStore.getState().applyIncoming(numericChatId, msg))
          }}
        />
      )}

      {pendingMedia && (
        <SendMediaPopup
          files={pendingMedia.files}
          initialAsFile={pendingMedia.asFile}
          onClose={() => setPendingMedia(null)}
          onSend={(caption, asFile, paidPrice) => { void sendPendingMedia(caption, asFile, paidPrice); slowmodeMarkSent() }}
        />
      )}

      {lightbox && (
        <Suspense fallback={null}>
          <MediaLightbox
            items={lightbox.items}
            index={lightbox.index}
            originRect={lightbox.originRect}
            originSrc={lightbox.originSrc}
            originEl={lightbox.originEl}
            onClosingStart={() => { lightbox.originEl.style.visibility = '' }}
            onClose={closeLightbox}
          />
        </Suspense>
      )}

      {/* Message context menu — reactions strip + actions */}
      {msgActions.msgMenu && (
        <MessageContextMenu menu={msgActions.msgMenu} items={msgActions.msgMenuItems} onClose={msgActions.closeMsgMenu} onExited={msgActions.destroyMsgMenu} onReaction={isRealChat ? msgActions.reactToMenuMsg : undefined} />
      )}

      {/* Статистика поста канала (slide-in сабвью, tweb messageStatistics) */}
      <Suspense fallback={null}>
        <AnimatePresence>
          {msgActions.postStats && (
            <PostStats chatId={numericChatId} msgId={msgActions.postStats.msgId} onBack={msgActions.closePostStats} />
          )}
        </AnimatePresence>
      </Suspense>

      {/* Редактор «проверки фактов» (канал, автор/админ) */}
      {msgActions.factCheckEdit && (
        <FactCheckEditor
          initial={msgActions.factCheckEdit.initial}
          onClose={msgActions.closeFactCheckEditor}
          onSubmit={msgActions.submitFactCheck}
        />
      )}

      {/* "Seen by" popup */}
      {msgActions.viewers && (
        <ViewersPopup x={msgActions.viewers.x} y={msgActions.viewers.y} names={msgActions.viewers.names} onClose={msgActions.closeViewers} />
      )}

      {/* Кто отреагировал (long-press/правый клик по чипу реакции) */}
      {msgActions.reacted && (
        <ReactedUsersPopup x={msgActions.reacted.x} y={msgActions.reacted.y} rows={msgActions.reacted.rows} onClose={msgActions.closeReacted} />
      )}

      {/* Платная ⭐-реакция: попап выбора количества звёзд (tweb PopupStarReaction) */}
      {msgActions.starReact && isRealChat && (
        <StarReactionPopup open chatId={numericChatId} msgId={msgActions.starReact.msgId} onClose={msgActions.closeStarReaction} />
      )}

      {/* Forward target picker */}
      {msgActions.forwardIds != null && (
        <ForwardPicker dialogs={allDialogs} onPick={msgActions.doForward} onClose={msgActions.closeForward} />
      )}

      {/* «Ответить в другом чате» (tweb ReplyToAnotherChat): выбор целевого чата */}
      {msgActions.replyAnother && (
        <ChatPicker
          dialogs={allDialogs}
          title={t('Reply in Another Chat')}
          onPick={msgActions.pickReplyAnotherChat}
          onClose={msgActions.closeReplyAnother}
        />
      )}

      {/* Delete confirmation (for me / for everyone) */}
      {msgActions.delIds && (
        <DeleteMessageDialog
          canRevoke={msgActions.delIds.canRevoke}
          onDeleteForEveryone={() => msgActions.doDelete(true)}
          onDeleteForMe={() => msgActions.doDelete(false)}
          onClose={msgActions.closeDelete}
        />
      )}

      {/* Перевод сообщения (контекстное меню → Translate) */}
      <TranslatePopup
        open={msgActions.translateText != null}
        text={msgActions.translateText ?? ''}
        managers={managers}
        onClose={msgActions.closeTranslate}
      />
    </>
  )
}
