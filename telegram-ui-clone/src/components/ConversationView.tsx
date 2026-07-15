import { useEffect, useMemo, useState } from 'react'
import Text from '../shared/ui/Text'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from './TgIcon'
import { useAvatarSrc } from './useAvatarSrc'
import UserInfoPanel from './UserInfoPanel'
import AddContactView from './AddContactView'
import DiscussionView from './DiscussionView'
import HeaderMenu from './HeaderMenu'
import AttachMenu from './AttachMenu'
import { CallProvider } from './call/CallProvider'
import { startOutgoing } from '../core/calls/callEngine'
import NowPlayingBar from './NowPlayingBar'
import Preloader from './Preloader'
import type { Chat, OpenPeer } from '../data'
import { useT, useLang } from '../i18n'
import { useTypingLabel } from '../core/hooks/useTypingLabel'
import { lastSeenLabel } from '../core/presence'
import { useManagers } from '../core/hooks/useManagers'
import { useMessageWindow } from '../core/hooks/useMessageWindow'
import { useEvent } from '../core/hooks/useEvent'
import { markMediaPlayed } from '../core/mediaRead'
import { useChatSelection } from '../core/hooks/useChatSelection'
import { useChatInfoCard } from '../core/hooks/useChatInfoCard'
import { usePinnedBar } from '../core/hooks/usePinnedBar'
import { useChatSend } from '../core/hooks/useChatSend'
import { useChatScroll } from '../core/hooks/useChatScroll'
import { useConvMessages } from '../core/hooks/useConvMessages'
import { useVoiceQueue } from '../core/hooks/useVoiceQueue'
import { useLightbox } from '../core/hooks/useLightbox'
import { useMessageActions } from '../core/hooks/useMessageActions'
import { useChannelExtras } from '../core/hooks/useChannelExtras'
import { useFeedReveal } from '../core/hooks/useFeedReveal'
import Composer from './Composer'
import ChatFeed from './messages/ChatFeed'
import ChatHeader from './conversation/ChatHeader'
import PinnedBar from './conversation/PinnedBar'
import ScrollDownFab from './conversation/ScrollDownFab'
import SelectionBar from './conversation/SelectionBar'
import MessageContextMenu from './conversation/MessageContextMenu'
import { useChatsStore } from '../stores/chatsStore'
import { type MessageEntity } from '../core/models'
import { useSearchStore } from '../stores/searchStore'
import { DeleteMessageDialog, ForwardPicker, ViewersPopup } from './messages/ChatDialogs'
import SendMediaPopup from './messages/SendMediaPopup'
import MediaLightbox from './messages/MediaLightbox'
import classNames from '../shared/lib/classNames'
import s from './ConversationView.module.scss'
import useMediaQuery from '../shared/lib/useMediaQuery'



// tweb's exact bubbles-scrollable fade: a pure alpha mask on the scroll viewport
// (no blur, no colour) so messages simply fade out to a 0.24 floor behind the
// floating header/composer, eased iOS-style (cubic-bezier sampled at 0/.2/.4/.6/.8/1).
// tweb: fade = 3.5rem + page-chats-padding, контент-паддинг ленты =
// chat-input-height + page-chats-padding; page-chats-padding = 16px desktop /
// 8px handheld — см. _chat.scss:447,1104 и updateColumnWidths.ts.
const padTop = (narrow: boolean) => (narrow ? 68 : 76) // real clearance under the header
// Верхний фейд глубже клиренса: приглушение начинается заранее, ещё до того как
// сообщение уйдёт под хедер (как в tweb — верх ленты приглушён уже в статике).
const fadeTop = (narrow: boolean) => (narrow ? 100 : 108)
const fadeBottom = (narrow: boolean) => (narrow ? 64 : 72) // mask only
const padBottom = (narrow: boolean) => (narrow ? 56 : 64) // real feed padding

// Local start-of-day in ms (the date "bucket"), and a friendly day label for the
// date divider — tweb shows Today / Yesterday / "14 June" (with year if not this year).
const FLOOR = 'rgba(255,255,255,0.24)'
// Both edges keep the same faint floor (tweb --bubbles-scrollable-fade-color):
// messages stay slightly visible behind the floating header AND composer.
const mix = (k: number) => `color-mix(in srgb, #000 ${k}%, ${FLOOR})`
const feedMask = (fadeT: number, fadeB: number) => `linear-gradient(to bottom, ${FLOOR} 0, ${mix(8.6)} ${fadeT * 0.2}px, ${mix(33.4)} ${fadeT * 0.4}px, ${mix(66.6)} ${fadeT * 0.6}px, ${mix(91.4)} ${fadeT * 0.8}px, #000 ${fadeT}px, #000 calc(100% - ${fadeB}px), ${mix(91.4)} calc(100% - ${fadeB * 0.8}px), ${mix(66.6)} calc(100% - ${fadeB * 0.6}px), ${mix(33.4)} calc(100% - ${fadeB * 0.4}px), ${mix(8.6)} calc(100% - ${fadeB * 0.2}px), ${FLOOR} 100%)`

// Telegram's per-peer color palette (used to tint reply previews by their author)

interface Props {
  chat: Chat
  onBack?: () => void
  onOpenPeer?: (peer: OpenPeer) => void
  onChatCreated?: (chatId: number) => void
}

export default function ConversationView({ chat, onBack, onOpenPeer, onChatCreated }: Props) {
  const t = useT()
  const headerAvatarSrc = useAvatarSrc(chat.avatarUrl)
  const [lang] = useLang()

  // Реальное значение accent (нужно как цвет в JS: reply.color → hex, не var()).
  // Читаем из CSS-переменной темы (как ChatBackground); обновляется при смене темы.
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--tg-accent').trim() || '#3390ec'

  const narrow = useMediaQuery('(max-width:900px)')
  const isChannel = chat.type === 'channel'
  const isGroup = chat.type === 'group'

  const numericChatId = Number(chat.id)
  const isRealChat = Number.isFinite(numericChatId) && String(numericChatId) === chat.id

  const draftPeerId = chat.id.startsWith('draft:') ? Number(chat.id.slice('draft:'.length)) : null
  const meId = useChatsStore((s) => s.meId)
  const me = useChatsStore((s) => s.me)
  const allDialogs = useChatsStore((s) => s.dialogs)

  const typingLabel = useTypingLabel(numericChatId, isGroup)
  const peerPresence = useChatsStore((s) => (chat.peerId != null ? s.presence[chat.peerId] : undefined))
  const setDialogMuted = useChatsStore((s) => s.setDialogMuted)
  // toggle re-renders the menu; fall back to the chat prop.
  const dialogMuted = useChatsStore((s) =>
    isRealChat ? s.dialogs.find((d) => d.chatId === numericChatId)?.muted : undefined,
  )
  const muted = dialogMuted ?? !!chat.muted
  const managers = useManagers()
  const win = useMessageWindow(isRealChat ? numericChatId : -1, 40)

  // Register the active chat so chatsStore suppresses unread bumps while it's open.
  const setActiveChat = useChatsStore((s) => s.setActiveChat)
  useEffect(() => {
    if (isRealChat) setActiveChat(numericChatId)
    return () => setActiveChat(null)
  }, [isRealChat, numericChatId, setActiveChat])

  // Real group/channel header card (type/counts/rights) + member presence seeding +
  // post/type permission + discussion wiring + live online count — view-model hook.
  const { card, canType, discussionChatId, discussionsEnabled, onlineCount } =
    useChatInfoCard({ isRealChat, isChannel, numericChatId, managers })
  // Message read-model: window Message[] → ConvMsg[] (sender/forward/reply names +
  // stable-ref cache) plus the resolved peers map (reused below for voice/lightbox).
  const { msgs, peers } = useConvMessages({ numericChatId, isRealChat, isGroup, win, meId })
  // Open a private chat with a group message's sender (avatar/name click).
  const openSender = (senderId: number, fallbackName: string) => {
    const p = peers.get(senderId)
    onOpenPeer?.({
      id: senderId,
      displayName: p?.displayName || fallbackName,
      username: p?.username,
      avatarUrl: p?.avatarUrl,
    })
  }
  // Voice/audio play queue for the global player + the player plate offset.
  const { playVoice, attachRound, playerOffset } = useVoiceQueue({
    win, isRealChat, meId, meName: me?.displayName, peers, chatName: chat.name, numericChatId, lang,
  })
  const [infoOpen, setInfoOpen] = useState(false)
  // Pinned messages in this chat (newest pin first) — drives the pinned bar.
  const pins = usePinnedBar(numericChatId, isRealChat, managers)
  // Search is owned by ChatHeader now; here we only read whether it's open (single-sourced
  // in searchStore) to hide the pinned bar + adjust the sticky-date offset.
  const searchOpen = useSearchStore((s) => s.byChat[numericChatId]?.open ?? false)
  const [headerMenu, setHeaderMenu] = useState<{ top: number; right: number } | null>(null)
  const [addContactOpen, setAddContactOpen] = useState(false)
  const [attachAnchor, setAttachAnchor] = useState<{ left: number; bottom: number } | null>(null)
  // Scroll state machine (refs + bottom-pin intent + history pagination + scroll-restore
  // + jump-to-message + scroll-to-bottom + read-marker) — extracted view-model hook.
  // Owns atBottomRef/userScrolledUpRef (passed into useChatSend so a send pins to bottom).
  const {
    scrollRef, contentRef, atBottomRef, userScrolledUpRef,
    highlightSeq, showScrollDown, unreadBelow, jumpToSeq, onScrollDownClick,
  } = useChatScroll({ numericChatId, isRealChat, win, managers, playerOffset })
  // Multi-select state + press-and-drag selection (extracted view-model hook).
  const { selected, setSelected, setSelectionMode, selecting, toggleSelect, clearSelection, dragSelect } =
    useChatSelection(scrollRef)
  // Enter selection mode from the header menu with nothing selected yet.
  const startSelectMode = () => { setSelectionMode(true); setHeaderMenu(null) }

  // (Scroll state machine — pagination, scroll-restore, pin-to-bottom, jump-to-message,
  // read-marker — lives in useChatScroll; see the hook call above.)

  // No chat-switch reset effect needed: App renders <ConversationView key={selectedId}>,
  // so switching chats fully remounts this component and every useState/useRef (here and
  // in useChatSend/useChatSelection/useChatSearch) re-initialises to its default. A manual
  // reset effect keyed on `chat` was not only redundant but harmful — `chat` gets a new
  // object identity on every dialog update (e.g. a message arriving in the open chat),
  // which would wipe the reply draft / selection / open discussion mid-session.

  // Outgoing side (text/media/voice + optimistic + draft creation + typing throttle)
  // and the reply/editing composer state — extracted view-model hook. Scroll intent
  // (atBottomRef/userScrolledUpRef) is owned here and passed in. Declared before
  // useMessageActions, which needs setReply/setEditing for its reply/edit actions.
  const {
    reply, setReply, editing, setEditing,
    rec,
    send,
    onComposerTyping,
    pendingMedia, setPendingMedia, sendPendingMedia,
    openPicker, fileInputRef, pickAsFileRef,
  } = useChatSend({
    chat, numericChatId, isRealChat, isChannel, draftPeerId, canType,
    meId, win, managers, atBottomRef, userScrolledUpRef,
    onChatCreated,
  })

  // Message context menu + its actions (reply/edit/copy/pin/delete/forward/select/
  // download/viewers) and the delete-confirm / forward-picker / viewers-popup state.
  const {
    msgMenu, openMsgMenu, closeMsgMenu, msgMenuItems,
    delIds, doDelete, closeDelete, openDeleteFor,
    forwardIds, doForward, closeForward, openForwardFor,
    viewers, closeViewers,
  } = useMessageActions({
    chat, numericChatId, isRealChat, win, msgs, meId, pins, managers, accent: accentColor,
    setReply, setEditing, setSelectionMode, setSelected, clearSelection, onChatCreated,
  })

  // First-load reveal policy: grace-delayed spinner (no flash on cache hits),
  // `feedLoading` to gate the list, and the open-chat ladder arming.
  const { showSpinner, feedLoading, ladderActive } = useFeedReveal({ isRealChat, win, numericChatId })

  // (Scroll correction, prepend-restore, jump-scroll, down-arrow pin, and player-offset
  // compensation all live in useChatScroll.)

  // Full-screen media viewer (collect loaded photos/videos, zoom from the thumb).
  const { lightbox, openLightbox, closeLightbox } = useLightbox({
    win, isRealChat, meId, meName: me?.displayName, peers, chatName: chat.name, lang,
  })

  // Channel-only wiring: live subscribe + catch-up, pts persistence, the open
  // discussion-thread overlay, and per-post comment counts.
  const { commentCounts, discussion, openDiscussion, closeDiscussion } = useChannelExtras({
    isRealChat, isChannel, numericChatId, win, managers, discussionsEnabled,
  })

  // Stable handler identities for the memoized feed: the feed closes over
  // `feedFns`, whose members never change reference, so toggling transient state
  // (context menu, viewer, composer text, hover) doesn't bust the feed's useMemo —
  // while each handler still reads fresh state via useEvent.
  const openSenderE = useEvent(openSender)
  const playVoiceE = useEvent(playVoice)
  const toggleSelectE = useEvent(toggleSelect)
  const openMsgMenuE = useEvent(openMsgMenu)
  const jumpToSeqE = useEvent(jumpToSeq)
  const openLightboxE = useEvent(openLightbox)
  const roundPlayingE = useEvent(attachRound)
  // Перезвон по клику на бабл звонка (tweb: клик по messageMediaCall → startCall)
  const recallE = useEvent((video: boolean) => {
    if (chat.type !== 'private' || chat.peerId == null) return
    startOutgoing(
      { id: chat.peerId, name: chat.name, avatar: chat.avatar, avatarText: chat.avatarText, avatarUrl: chat.avatarUrl },
      video,
      isRealChat ? numericChatId : null,
    )
  })
  // Кружок воспроизведён со звуком → снять media_unread (сервер разошлёт media_read)
  const mediaPlayedE = useEvent((msgId: number) => {
    if (isRealChat) markMediaPlayed(numericChatId, msgId)
  })
  const feedFns = useMemo(
    () => ({
      openSender: openSenderE,
      playVoice: playVoiceE,
      toggleSelect: toggleSelectE,
      openMsgMenu: openMsgMenuE,
      jumpToSeq: jumpToSeqE,
      openLightbox: openLightboxE,
      recall: recallE,
      mediaPlayed: mediaPlayedE,
      roundPlaying: roundPlayingE,
    }),
    [openSenderE, playVoiceE, toggleSelectE, openMsgMenuE, jumpToSeqE, openLightboxE, recallE, mediaPlayedE, roundPlayingE],
  )

  // (Ack reconcile + send-rejection run in realtimeBridge → messagesStore; live
  // edit/delete keyed by chat_id; pinned-bar state in usePinnedBar. The read-marker
  // for a live/open chat — markRead vs unread-below pill — and mark-read-on-open /
  // on-refocus all live in useChatScroll (they need scroll/focus state).)

  // Incoming typing is centralized in the store (see realtimeBridge + useTypingLabel).

  // (Header card + member presence seeding now live in useChatInfoCard.)

  // (Live online updates need no local listener: realtimeBridge writes every
  // presence frame into chatsStore.presence, and onlineCount below derives from it.)

  // (Peer read horizon now comes straight from the store dialog — see peerReadSeq
  // above. chatsStore.applyRead advances it on every live rt:read, so no local
  // listener is needed here.)

  const toggleMute = () => {
    if (!isRealChat) return
    const next = !muted
    setDialogMuted(numericChatId, next) // optimistic
    void managers.groups.setMute(numericChatId, next).catch(() => setDialogMuted(numericChatId, !next))
  }

  // Добавление участников: полноценный под-экран живёт в UserInfoPanel
  const canAddMember = isRealChat && isGroup

  // Header subtitle for real group/channel chats: derive a member/online (or
  // subscriber) count from the card + live online count. Private and draft chats
  // keep the existing chat.status text (returned as null here).
  const realSubtitle: string | null = (() => {
    if (!isRealChat || !card) return null
    if (card.type === 'channel') return `${card.memberCount} подписчиков`
    if (card.type === 'group')
      return `${card.memberCount} участников${onlineCount > 0 ? `, ${onlineCount} онлайн` : ''}`
    return null
  })()

  // Header status line: typing/recording wins; then group member counts; then
  // private online / last-seen; then any static status.
  const headerTypingActive = typingLabel.active
  const headerTypingText = typingLabel.label
  const headerTypingKind = typingLabel.kind
  const presenceLabel =
    chat.type === 'private' && peerPresence
      ? peerPresence.online
        ? t('online')
        : lastSeenLabel(peerPresence.lastSeen, lang)
      : null
  const headerStatus = realSubtitle ?? presenceLabel ?? (chat.status ? t(chat.status) : '')
  const headerOnline = !!peerPresence?.online || chat.status === 'online'

  // Floating "scroll to bottom" button (tweb .bubbles-go-down), shown above the composer.
  // onScrollDownClick (reload-newest + pin, or smooth scroll) lives in useChatScroll.
  const scrollDownFab = (
    <ScrollDownFab show={showScrollDown} unreadBelow={unreadBelow} onClick={onScrollDownClick} />
  )

  // Sticky date-pill offset: below the floating header, plus the player plate
  // and the pinned-message bar when shown. На мобилке хедер на 8px выше (top 8 vs 16).
  const dateStickyTop = playerOffset + (pins.length > 0 && !searchOpen ? 122 : 66) - (narrow ? 8 : 0)

  // Stable handlers for the extracted header/pinned bars so their memo holds
  // across the parent's transient re-renders.
  const onToggleInfo = useEvent(() => setInfoOpen((o) => !o))
  const onOpenHeaderMenu = useEvent((r: DOMRect) => setHeaderMenu({ top: r.bottom + 6, right: window.innerWidth - r.right }))
  const onUnpin = useEvent((id: number) => { void managers.messages.unpin(numericChatId, id) })
  // Stable composer callbacks so the memoized <Composer> doesn't re-render on
  // unrelated parent renders (e.g. the scroll handler toggling showScrollDown).
  const onComposerSend = useEvent((text: string, entities?: MessageEntity[]) => send(text, entities))
  const onComposerCancelReply = useEvent(() => setReply(null))
  const onComposerCancelEdit = useEvent(() => setEditing(null))
  const onComposerOpenAttach = useEvent((r: DOMRect) => setAttachAnchor({ left: r.left, bottom: window.innerHeight - r.top + 8 }))
  // Files pasted/dropped into the composer → open the same media-preview popup as
  // the attach button (lets the user add a caption + choose media/file).
  const onComposerPasteFiles = useEvent((files: File[]) => setPendingMedia({ files, asFile: false }))

  // Channel post discussion thread: render it IN PLACE OF the channel column (not as
  // an overlay) so the channel feed isn't mounted underneath and can't bleed through
  // the thread's transparent (wallpaper-showing) background.
  if (discussion && discussionsEnabled) {
    return (
      <div className={s.root}>
        <div className={classNames(s.column, narrow ? s.columnNarrow : '')}>
          <DiscussionView
            channelId={numericChatId}
            postId={discussion.postId}
            discussionChatId={discussionChatId}
            post={discussion.post}
            onBack={closeDiscussion}
          />
        </div>
      </div>
    )
  }

  return (
    <CallProvider chat={chat}>
    <div className={s.root}>
      <div className={classNames(s.column, narrow ? s.columnNarrow : '')}>
        {/* Global "now playing" plate — a floating pill above the header (tweb:
            the topbar slides down to make room). Matches the header geometry. */}
        <div className={classNames(s.nowPlaying, narrow ? s.nowPlayingNarrow : '')}>
          <div className={s.nowPlayingInner}>
            <NowPlayingBar />
          </div>
        </div>

        <ChatHeader
          chat={chat}
          avatarSrc={headerAvatarSrc}
          peerOnline={peerPresence?.online}
          typingActive={headerTypingActive}
          typingText={headerTypingText}
          typingKind={headerTypingKind}
          status={headerStatus}
          online={headerOnline}
          playerOffset={playerOffset}
          onJumpToSeq={jumpToSeqE}
          onBack={onBack}
          onToggleInfo={onToggleInfo}
          onOpenMenu={onOpenHeaderMenu}
        />

        <PinnedBar
          pins={pins}
          searchOpen={searchOpen}
          playerOffset={playerOffset}
          onJump={jumpToSeqE}
          onUnpin={onUnpin}
        />

        {/* First-load spinner — only after the grace delay (skipped on cache hits) */}
        <AnimatePresence>
          {showSpinner && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={s.spinnerOverlay}
            >
              <div className={s.spinnerBox}>
                <Preloader size={30} stroke={2.5} color="#fff" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Conversation — own scroll container, masked like tweb's bubbles-scrollable */}
        <div
          ref={scrollRef}
          onMouseDown={dragSelect.onMouseDown}
          className={s.scroll}
          style={{ maskImage: feedMask(fadeTop(narrow), fadeBottom(narrow)), WebkitMaskImage: feedMask(fadeTop(narrow), fadeBottom(narrow)) }}
        >
          <div
            ref={contentRef}
            className={s.content}
            style={{
              // fade messages in once the first page has loaded (tweb-like)
              opacity: feedLoading ? 0 : 1,
              // clear the floating header/composer
              paddingTop: `${padTop(narrow) + playerOffset}px`,
              paddingBottom: `${padBottom(narrow)}px`,
            }}
          >
            {/* Render the list only once revealed, so rows mount at reveal time
                and the ladder is seen (not played hidden behind the spinner). */}
            {!feedLoading && (
              <ChatFeed
                msgs={msgs}
                winMsgs={win.msgs}
                isRealChat={isRealChat}
                isGroup={isGroup}
                discussionsEnabled={discussionsEnabled}
                commentCounts={commentCounts}
                highlightSeq={highlightSeq}
                selecting={selecting}
                selected={selected}
                ladderActive={ladderActive}
                dateStickyTop={dateStickyTop}
                feedFns={feedFns}
                onOpenDiscussion={openDiscussion}
              />
            )}

          </div>
        </div>

        {/* Footer */}
        {selecting ? (
          <SelectionBar
            count={selected.size}
            onClear={clearSelection}
            onForward={() => openForwardFor([...selected])}
            onDelete={() => openDeleteFor([...selected])}
          />
        ) : canType ? (
          <div className={classNames(s.footer, s.footerCompose)}>
            {scrollDownFab}
            {/* Hidden file picker — triggered by the attach menu (openPicker). */}
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.currentTarget.value = ''
                if (files.length) setPendingMedia({ files, asFile: pickAsFileRef.current })
              }}
            />
            {/* Composer: owns the draft text locally so typing re-renders only it. */}
            <Composer
              key={chat.id}
              reply={reply}
              editing={editing}
              rec={rec}
              onSend={onComposerSend}
              onTyping={onComposerTyping}
              onCancelReply={onComposerCancelReply}
              onCancelEdit={onComposerCancelEdit}
              onOpenAttach={onComposerOpenAttach}
              onPasteFiles={isRealChat ? onComposerPasteFiles : undefined}
            />
          </div>
        ) : (
          <div className={classNames(s.footer, s.footerMuted)}>
            {scrollDownFab}
            <motion.div whileTap={{ scale: 0.995 }} className={s.muteBtn}>
              <TgIcon name="volume_off" size={20} color="var(--tg-textSecondary)" />
              <Text weight={600} size={15.5}>{t('Mute')}</Text>
            </motion.div>
            <div className={s.giftBtn}>
              <TgIcon name="gift" color="var(--tg-textSecondary)" />
            </div>
          </div>
        )}
      </div>

      {/* Info panel (private / group / channel) */}
      <AnimatePresence>
        {infoOpen && (
          <UserInfoPanel
            chat={chat}
            onClose={() => setInfoOpen(false)}
            onOpenPeer={onOpenPeer}
            canAddMembers={canAddMember}
          />
        )}
      </AnimatePresence>

      {/* Add-contact screen (private chats) */}
      <AnimatePresence>
        {addContactOpen && <AddContactView chat={chat} onClose={() => setAddContactOpen(false)} />}
      </AnimatePresence>

      {/* Header "⋮" menu */}
      {headerMenu && (
        <HeaderMenu
          chat={isRealChat ? { ...chat, muted: muted || undefined } : chat}
          anchor={headerMenu}
          onClose={() => setHeaderMenu(null)}
          onToggleMute={isRealChat ? toggleMute : undefined}
          onAddMember={canAddMember ? () => setInfoOpen(true) : undefined}
          onSelectMessages={startSelectMode}
          onAddContact={chat.type === 'private' && chat.peerId != null ? () => setAddContactOpen(true) : undefined}
        />
      )}

      {/* Attach menu */}
      {attachAnchor && (
        <AttachMenu
          anchor={attachAnchor}
          onClose={() => setAttachAnchor(null)}
          onPhotoVideo={isRealChat ? () => { setAttachAnchor(null); openPicker('image/*,video/*', false) } : undefined}
          onFile={isRealChat ? () => { setAttachAnchor(null); openPicker('*/*', true) } : undefined}
        />
      )}

      {pendingMedia && (
        <SendMediaPopup
          files={pendingMedia.files}
          initialAsFile={pendingMedia.asFile}
          onClose={() => setPendingMedia(null)}
          onSend={(caption, asFile) => { void sendPendingMedia(caption, asFile) }}
        />
      )}

      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          originRect={lightbox.originRect}
          originSrc={lightbox.originSrc}
          onClosingStart={() => { lightbox.originEl.style.visibility = '' }}
          onClose={closeLightbox}
        />
      )}

      {/* Discard-recording confirm (Esc) */}
      {/*<AnimatePresence>*/}
      {/*  {cancelRecOpen && (*/}
      {/*    <DiscardVoiceDialog*/}
      {/*      onCancel={() => setCancelRecOpen(false)}*/}
      {/*      onDiscard={() => { setCancelRecOpen(false); rec.stop(false) }}*/}
      {/*    />*/}
      {/*  )}*/}
      {/*</AnimatePresence>*/}

      {/* Message context menu — reactions strip + actions */}
      {msgMenu && (
        <MessageContextMenu menu={msgMenu} items={msgMenuItems} onClose={closeMsgMenu} />
      )}

      {/* "Seen by" popup */}
      {viewers && (
        <ViewersPopup x={viewers.x} y={viewers.y} names={viewers.names} onClose={closeViewers} />
      )}

      {/* Forward target picker */}
      {forwardIds != null && (
        <ForwardPicker dialogs={allDialogs} onPick={doForward} onClose={closeForward} />
      )}

      {/* Delete confirmation (for me / for everyone) */}
      {delIds && (
        <DeleteMessageDialog
          canRevoke={delIds.canRevoke}
          onDeleteForEveryone={() => doDelete(true)}
          onDeleteForMe={() => doDelete(false)}
          onClose={closeDelete}
        />
      )}
    </div>
    </CallProvider>
  )
}
