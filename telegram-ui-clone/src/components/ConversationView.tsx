import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Typography, useMediaQuery, useTheme } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from './TgIcon'
import { useAvatarSrc } from './useAvatarSrc'
import UserInfoPanel from './UserInfoPanel'
import AddContactView from './AddContactView'
import DiscussionView from './DiscussionView'
import HeaderMenu from './HeaderMenu'
import AttachMenu from './AttachMenu'
import { CallProvider } from './call/CallProvider'
import NowPlayingBar from './NowPlayingBar'
import Preloader from './Preloader'
import { useAudioStore, type AudioTrack } from '../stores/audioStore'
import type { Chat, ConvMsg, OpenPeer } from '../data'
import { useT, useLang } from '../i18n'
import { useTypingLabel } from '../core/hooks/useTypingLabel'
import { lastSeenLabel } from '../core/presence'
import { useManagers } from '../core/hooks/useManagers'
import { useMessageWindow } from '../core/hooks/useMessageWindow'
import { useEvent } from '../core/hooks/useEvent'
import { useChatSelection } from '../core/hooks/useChatSelection'
import { useChatInfoCard } from '../core/hooks/useChatInfoCard'
import { usePinnedBar } from '../core/hooks/usePinnedBar'
import { useChatSend } from '../core/hooks/useChatSend'
import { useChatScroll } from '../core/hooks/useChatScroll'
import Composer from './Composer'
import ChatFeed from './messages/ChatFeed'
import ChatHeader from './conversation/ChatHeader'
import PinnedBar from './conversation/PinnedBar'
import ScrollDownFab from './conversation/ScrollDownFab'
import SelectionBar from './conversation/SelectionBar'
import MessageContextMenu from './conversation/MessageContextMenu'
import { messageToConvMsg } from '../core/messageToConvMsg'
import { usePeers, peersKey } from '../core/hooks/usePeers'
import { useChatsStore, loadChats } from '../stores/chatsStore'
import { type MessageEntity } from '../core/models'
import { friendlyMsgTime } from '../core/friendlyTime'
import { useSearchStore } from '../stores/searchStore'
import { peerColor } from './peerColor'
import { DeleteMessageDialog, ForwardPicker, ViewersPopup, AddMemberDialog } from './messages/ChatDialogs'
import SendMediaPopup from './messages/SendMediaPopup'
import MediaLightbox, { type LightboxItem } from './messages/MediaLightbox'


// tweb's exact bubbles-scrollable fade: a pure alpha mask on the scroll viewport
// (no blur, no colour) so messages simply fade out to a 0.24 floor behind the
// floating header/composer, eased iOS-style (cubic-bezier sampled at 0/.2/.4/.6/.8/1).
const FADE_TOP = 76 // clear the floating header
const FADE_BOTTOM = 84 // clear the floating composer

// Local start-of-day in ms (the date "bucket"), and a friendly day label for the
// date divider — tweb shows Today / Yesterday / "14 June" (with year if not this year).
const FLOOR = 'rgba(255,255,255,0.24)'
// Bottom keeps a faint floor (messages melt behind the composer); the TOP fades
// fully to transparent so nothing bleeds above the floating header.
const mixB = (k: number) => `color-mix(in srgb, #000 ${k}%, ${FLOOR})`
const mixT = (k: number) => `color-mix(in srgb, #000 ${k}%, transparent)`
const FEED_MASK = `linear-gradient(to bottom, transparent 0, ${mixT(8.6)} ${FADE_TOP * 0.2}px, ${mixT(33.4)} ${FADE_TOP * 0.4}px, ${mixT(66.6)} ${FADE_TOP * 0.6}px, ${mixT(91.4)} ${FADE_TOP * 0.8}px, #000 ${FADE_TOP}px, #000 calc(100% - ${FADE_BOTTOM}px), ${mixB(91.4)} calc(100% - ${FADE_BOTTOM * 0.8}px), ${mixB(66.6)} calc(100% - ${FADE_BOTTOM * 0.6}px), ${mixB(33.4)} calc(100% - ${FADE_BOTTOM * 0.4}px), ${mixB(8.6)} calc(100% - ${FADE_BOTTOM * 0.2}px), ${FLOOR} 100%)`

// Telegram's per-peer color palette (used to tint reply previews by their author)

interface Props {
  chat: Chat
  onBack?: () => void
  onOpenPeer?: (peer: OpenPeer) => void
  onChatCreated?: (chatId: number) => void
}

export default function ConversationView({ chat, onBack, onOpenPeer, onChatCreated }: Props) {
  const t = useT()
  const theme = useTheme()
  const tg = theme.tg
  const headerAvatarSrc = useAvatarSrc(chat.avatarUrl)
  const [lang] = useLang()

  const narrow = useMediaQuery('(max-width:900px)')
  const incomingBg = tg.bubble
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
  const win = useMessageWindow(isRealChat ? numericChatId : -1, managers, 40)

  // ── Open-chat ladder (tweb animateAsLadder) ──────────────────────────────
  // The first loaded batch cascades in (scale .8→1, staggered) — but ONLY when
  // the chat came over the network. A cache hit renders instantly with no
  // animation (tweb's `noTransition = setPeerCached`). `armed` stays true from
  // chat-switch until the first revealed batch has mounted, then the effect
  // below disarms it so live appends don't ladder. `ladderActive` is computed
  // lower down (it needs `feedLoading`/`loadedFromCache`).
  const ladderArmedRef = useRef(true)
  const ladderChatRef = useRef(numericChatId)
  if (ladderChatRef.current !== numericChatId) {
    ladderChatRef.current = numericChatId
    ladderArmedRef.current = true
  }

  // Register the active chat so chatsStore suppresses unread bumps while it's open.
  const setActiveChat = useChatsStore((s) => s.setActiveChat)
  useEffect(() => {
    if (isRealChat) setActiveChat(numericChatId)
    return () => setActiveChat(null)
  }, [isRealChat, numericChatId, setActiveChat])

  // Mock chats (local group/channel stubs) keep the old in-memory message list;
  // real chats render the windowed history mapped to ConvMsg.
  const [mockMsgs, setMockMsgs] = useState<ConvMsg[]>(chat.messages ?? [])
  // Real group/channel header card (type/counts/rights) + member presence seeding +
  // post/type permission + discussion wiring + live online count — view-model hook.
  const { card, canType, discussionChatId, discussionsEnabled, onlineCount } =
    useChatInfoCard({ isRealChat, isChannel, numericChatId, managers })
  // Peer's read horizon (real chats): out messages with seq<=peerReadSeq render the
  // double-check (read). Read straight from the store dialog — it's seeded from
  // GET /chats (peer_read_seq) on load and advanced by applyRead on live rt:read,
  // so ticks are correct immediately on open and after switching chats (no longer
  // a local state that resets to 0).
  const peerReadSeq = useChatsStore((s) =>
    isRealChat ? s.dialogs.find((d) => d.chatId === numericChatId)?.peerReadSeq ?? 0 : 0,
  )
  // Channel discussions: comment counts per post id + the open thread overlay.
  const [commentCounts, setCommentCounts] = useState<Map<number, number>>(new Map())
  const [discussion, setDiscussion] = useState<{ postId: number; post: { text?: string } } | null>(null)
  // For real group chats, resolve incoming sender ids -> display names so bubbles
  // can show the author. Private chats never pass a senderName (unchanged).
  const resolveSenders = isRealChat && isGroup
  const senderIds = useMemo(
    () => {
      if (!isRealChat) return []
      const ids = resolveSenders ? win.msgs.filter((m) => m.senderId !== meId).map((m) => m.senderId) : []
      // Forward attribution ("Переслано от X") in ANY chat needs the origin's name.
      for (const m of win.msgs) if (m.fwdFromUserId != null) ids.push(m.fwdFromUserId)
      // Reply previews need the replied-to author's name (any chat).
      for (const m of win.msgs) if (m.replyTo && m.replyTo.senderId !== meId) ids.push(m.replyTo.senderId)
      return ids
    },
    // peersKey gives a stable dep that ignores ordering/duplicates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolveSenders, isRealChat, meId, peersKey(win.msgs.map((m) => m.senderId)), peersKey(win.msgs.map((m) => m.fwdFromUserId ?? 0)), peersKey(win.msgs.map((m) => m.replyTo?.senderId ?? 0))],
  )
  const peers = usePeers(senderIds)
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
  // Per-message conversion cache: returns the SAME ConvMsg reference when the
  // converted value is unchanged (compared by its JSON), so unchanged rows keep a
  // stable identity → the memoized <MessageRow> bails out. Appending/sending then
  // re-renders only the new row (and the previous-last, whose group tail flips).
  const convCacheRef = useRef<Map<string | number, { json: string; conv: ConvMsg }>>(new Map())
  const msgs: ConvMsg[] = useMemo(() => {
    if (!isRealChat) return mockMsgs
    const cache = convCacheRef.current
    const seen = new Set<string | number>()
    const next = win.msgs.map((m) => {
      const conv = messageToConvMsg(m, meId, {
        senderName: resolveSenders ? peers.get(m.senderId)?.displayName : undefined,
        readUpToSeq: peerReadSeq,
        forwardFromName: m.fwdFromUserId != null ? peers.get(m.fwdFromUserId)?.displayName : undefined,
        replyToName: m.replyTo ? peers.get(m.replyTo.senderId)?.displayName : undefined,
      })
      const key = m.clientId ?? m.id ?? m.seq
      seen.add(key)
      const json = JSON.stringify(conv)
      const hit = cache.get(key)
      if (hit && hit.json === json) return hit.conv // value-identical → reuse stable ref
      cache.set(key, { json, conv })
      return conv
    })
    for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key)
    return next
  }, [isRealChat, win.msgs, mockMsgs, meId, resolveSenders, peers, peerReadSeq])

  // Voice/audio queue for the global player (chat order); play one and the
  // now-playing bar can step prev/next through the rest.
  const playQueue = useAudioStore((s) => s.playQueue)
  const voiceTracks: AudioTrack[] = useMemo(
    () =>
      (isRealChat ? win.msgs : [])
        .filter((m) => m.type === 'voice' && m.mediaId)
        .map((m) => ({
          mediaId: m.mediaId as number,
          title:
            m.senderId === meId
              ? me?.displayName || 'Вы'
              : peers.get(m.senderId)?.displayName || chat.name,
          subtitle: friendlyMsgTime(m.createdAt, lang),
          chatId: numericChatId,
          msgId: m.id,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [win.msgs, isRealChat, chat.name, numericChatId, meId, me, peersKey(win.msgs.map((m) => m.senderId)), lang],
  )
  const playVoice = (mediaId: number) => {
    const idx = voiceTracks.findIndex((t) => t.mediaId === mediaId)
    if (idx >= 0) playQueue(voiceTracks, idx)
  }
  // When the global player is showing, push the floating header + feed down so it
  // slides in above the conversation instead of overlapping it.
  const nowPlayingActive = useAudioStore((s) => !!s.track)
  const playerOffset = nowPlayingActive ? 56 : 0 // plate height (48) + gap (8)
  const [typing, setTyping] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [msgMenu, setMsgMenu] = useState<{ x: number; y: number; idx: number; originX: 'left' | 'right'; originY: 'top' | 'bottom' } | null>(null)
  // Pending delete confirmation: message ids + whether "for everyone" is offered.
  const [delIds, setDelIds] = useState<{ ids: number[]; canRevoke: boolean } | null>(null)
  // Pending forward: message ids to forward (opens the chat picker).
  const [forwardIds, setForwardIds] = useState<number[] | null>(null)
  // Pinned messages in this chat (newest pin first) — drives the pinned bar.
  const pins = usePinnedBar(numericChatId, isRealChat, managers)
  // "Seen by" popup: the resolved viewers of a message.
  const [viewers, setViewers] = useState<{ x: number; y: number; names: string[] } | null>(null)
  // Search is owned by ChatHeader now; here we only read whether it's open (single-sourced
  // in searchStore) to hide the pinned bar + adjust the sticky-date offset.
  const searchOpen = useSearchStore((s) => s.byChat[numericChatId]?.open ?? false)
  const [headerMenu, setHeaderMenu] = useState<{ top: number; right: number } | null>(null)
  const [addMemberOpen, setAddMemberOpen] = useState(false)
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

  // Takes the message itself (not its index) so MessageRow needs no `index` prop —
  // that prop shifts on every loadOlder prepend and would re-render every row. We
  // resolve the index here, at click time, against the current msgs.
  const openMsgMenu = (e: React.MouseEvent, m: ConvMsg) => {
    e.preventDefault()
    const idx = msgs.indexOf(m)
    if (idx < 0) return
    // Anchor a corner of the menu at the click point and grow from there (tweb):
    // flip to the left/upward when near the right/bottom edge so it stays on-screen.
    const MW = 256, MH = 440
    const openLeft = e.clientX + MW > window.innerWidth
    const openUp = e.clientY + MH > window.innerHeight
    setMsgMenu({
      x: e.clientX,
      y: e.clientY,
      idx,
      originX: openLeft ? 'right' : 'left',
      originY: openUp ? 'bottom' : 'top',
    })
  }
  const startReply = () => {
    const m = msgMenu && msgs[msgMenu.idx]
    if (m && m.type !== 'date') {
      const name = m.out ? 'Дн' : m.sender ?? chat.name
      const color = m.out ? tg.accent : m.senderColor ?? peerColor(name)
      setReply({ msgId: menuRawMsg()?.id, name, text: m.text ?? m.emoji ?? '', color })
      setEditing(null)
      // Composer focuses itself when `reply` becomes set.
    }
    setMsgMenu(null)
  }
  // The selected message's raw window entry (real id/seq) for actions.
  const menuRawMsg = () => (msgMenu && isRealChat ? win.msgs[msgMenu.idx] : undefined)

  const startEdit = () => {
    const m = msgMenu && msgs[msgMenu.idx]
    const raw = menuRawMsg()
    if (m && raw?.id != null) {
      setEditing({ msgId: raw.id, text: m.text ?? '', entities: raw.entities })
      setReply(null)
      // Composer prefills its draft + focuses when `editing` becomes set.
    }
    setMsgMenu(null)
  }
  const copyMsg = () => {
    const m = msgMenu && msgs[msgMenu.idx]
    if (m?.text) void navigator.clipboard?.writeText(m.text).catch(() => {})
    setMsgMenu(null)
  }
  // "Delete for everyone" is offered when every target is the author's own or the
  // chat is private (Telegram). Backend re-checks; group admins handled server-side.
  const canRevokeAll = (ids: number[]) =>
    chat.type === 'private' || ids.every((id) => win.msgs.find((m) => m.id === id)?.senderId === meId)
  const openDelete = () => {
    const raw = menuRawMsg()
    if (raw?.id != null) setDelIds({ ids: [raw.id], canRevoke: canRevokeAll([raw.id]) })
    setMsgMenu(null)
  }
  const doDelete = (revoke: boolean) => {
    if (!delIds || !isRealChat) return setDelIds(null)
    for (const id of delIds.ids) {
      win.applyDelete(id, !revoke) // optimistic — gone immediately
      void managers.messages.deleteMessage(numericChatId, id, revoke)
    }
    setDelIds(null)
    clearSelection()
  }
  const openForward = () => {
    const raw = menuRawMsg()
    if (raw?.id != null) setForwardIds([raw.id])
    setMsgMenu(null)
  }
  const doForward = (toChatId: number) => {
    if (!forwardIds?.length || !isRealChat) return setForwardIds(null)
    void managers.messages.forwardMessages(toChatId, numericChatId, forwardIds)
    setForwardIds(null)
    clearSelection()
    onChatCreated?.(toChatId) // switch to the target chat (Telegram behavior)
  }
  // Enter selection mode from the context menu, pre-selecting that message.
  const startSelect = () => {
    const raw = menuRawMsg()
    setSelectionMode(true)
    if (raw?.id != null) setSelected(new Set([raw.id]))
    setMsgMenu(null)
  }
  const togglePin = () => {
    const raw = menuRawMsg()
    if (raw?.id != null && isRealChat) {
      const pinned = pins.some((p) => p.id === raw.id)
      void (pinned ? managers.messages.unpin(numericChatId, raw.id) : managers.messages.pin(numericChatId, raw.id))
    }
    setMsgMenu(null)
  }
  // Download the original media bytes (the context-menu "Загрузить" action). The
  // content endpoint is same-origin, so the <a download> forces a save.
  const downloadMsg = async () => {
    const raw = menuRawMsg()
    setMsgMenu(null)
    if (raw?.mediaId == null) return
    const [meta, url] = await Promise.all([
      managers.media.meta(raw.mediaId),
      managers.media.contentUrl(raw.mediaId),
    ])
    const a = document.createElement('a')
    a.href = url
    a.download = meta.fileName || `media-${raw.mediaId}`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  const showViewers = async (e: React.MouseEvent) => {
    const raw = menuRawMsg()
    const x = e.clientX, y = e.clientY
    setMsgMenu(null)
    if (raw?.id == null || !isRealChat) return
    const ids = await managers.messages.viewers(numericChatId, raw.id)
    const users = ids.length ? await managers.peers.getUsers(ids) : []
    const byId = new Map(users.map((u) => [u.id, u.displayName]))
    const names = ids.map((id) => byId.get(id) ?? `ID ${id}`)
    setViewers({ x: Math.min(x, window.innerWidth - 240), y: Math.min(y, window.innerHeight - 320), names })
  }
  // (jumpToSeq — glide-to-or-load-around a target seq + flash — lives in useChatScroll.)
  const msgMenuItems: { icon: ReactNode; label: string; danger?: boolean; onClick?: (e: React.MouseEvent) => void }[] = [
    { icon: <TgIcon name="reply" size={20} />, label: 'Reply', onClick: startReply },
    ...(isRealChat && (msgs[msgMenu?.idx ?? -1]?.out ?? false)
      ? [{ icon: <TgIcon name="edit" size={20} />, label: 'Edit', onClick: startEdit }]
      : []),
    { icon: <TgIcon name="copy" size={20} />, label: 'Copy', onClick: copyMsg },
    { icon: <TgIcon name="language" size={20} />, label: 'Translate' },
    ...(isRealChat
      ? [{
          icon: <TgIcon name="pin" size={20} />,
          label: pins.some((p) => p.id === menuRawMsg()?.id) ? 'Unpin' : 'Pin',
          onClick: togglePin,
        }]
      : []),
    ...(isRealChat && menuRawMsg()?.mediaId != null
      ? [{ icon: <TgIcon name="download" size={20} />, label: 'Download', onClick: downloadMsg }]
      : []),
    ...(isRealChat ? [{ icon: <TgIcon name="reply" size={20} style={{ transform: 'scaleX(-1)' }} />, label: 'Forward', onClick: openForward }] : []),
    ...(isRealChat ? [{ icon: <TgIcon name="checkround" size={20} />, label: 'Select', onClick: startSelect }] : []),
    ...(isRealChat && (msgs[msgMenu?.idx ?? -1]?.out ?? false)
      ? [{ icon: <TgIcon name="checks" size={20} />, label: 'Viewers', onClick: showViewers }]
      : []),
    ...(isRealChat ? [{ icon: <TgIcon name="delete" size={20} />, label: 'Delete', danger: true, onClick: openDelete }] : []),
  ]

  // No chat-switch reset effect needed: App renders <ConversationView key={selectedId}>,
  // so switching chats fully remounts this component and every useState/useRef (here and
  // in useChatSend/useChatSelection/useChatSearch) re-initialises to its default. A manual
  // reset effect keyed on `chat` was not only redundant but harmful — `chat` gets a new
  // object identity on every dialog update (e.g. a message arriving in the open chat),
  // which would wipe the reply draft / selection / open discussion mid-session.

  // Outgoing side (text/sticker/gif/media/voice + optimistic + draft creation +
  // typing throttle) and the reply/editing composer state — extracted view-model
  // hook. Scroll intent (atBottomRef/userScrolledUpRef) is owned here and passed in.
  const {
    reply, setReply, editing, setEditing,
    rec,
    send, sendSticker, sendGif,
    onComposerTyping,
    pendingMedia, setPendingMedia, sendPendingMedia,
    openPicker, fileInputRef, pickAsFileRef,
  } = useChatSend({
    chat, numericChatId, isRealChat, isChannel, isGroup, draftPeerId, canType,
    meId, win, managers, atBottomRef, userScrolledUpRef,
    setMockMsgs, setTyping, onChatCreated,
  })

  // Loader policy: don't show the spinner for a cached/instant open. Only reveal
  // it if the load is still going after a short grace period; once shown, keep
  // it for a minimum so it can't flash. Cache hit ⇒ resolves < grace ⇒ no spinner.
  const SPINNER_GRACE = 250 // ms before the spinner is allowed to appear
  const SPINNER_MIN = 1000 // ms minimum on screen once it has appeared
  const [showSpinner, setShowSpinner] = useState(false)
  const showSpinnerRef = useRef(false)
  const spinnerShownAt = useRef(0)
  const setSpinner = (v: boolean) => { showSpinnerRef.current = v; setShowSpinner(v) }
  useEffect(() => {
    let t: number | undefined
    if (isRealChat && win.loading) {
      t = window.setTimeout(() => { spinnerShownAt.current = Date.now(); setSpinner(true) }, SPINNER_GRACE)
    } else if (showSpinnerRef.current) {
      const remain = Math.max(0, SPINNER_MIN - (Date.now() - spinnerShownAt.current))
      t = window.setTimeout(() => setSpinner(false), remain)
    } else {
      setSpinner(false)
    }
    return () => { if (t) window.clearTimeout(t) }
  }, [isRealChat, win.loading])
  // Hide the feed (and show the spinner) only while actually loading or while the
  // spinner is on screen; a cache hit skips both → content appears instantly.
  const feedLoading = isRealChat && (win.loading || showSpinner)

  // Ladder fires when the content is revealed (!feedLoading) for the FIRST time
  // after a NETWORK load. A cache hit (win.loadedFromCache — the history was in
  // the in-memory cache) reveals instantly with NO cascade, matching tweb's
  // `noTransition = setPeerCached`. This is timing-independent (a fast localhost
  // fetch still cascades; only a true cache hit skips it). The list is gated on
  // !feedLoading (below) so rows mount exactly at reveal — the cascade is seen,
  // not played hidden behind the spinner.
  const ladderActive =
    isRealChat && !feedLoading && win.msgs.length > 0 && ladderArmedRef.current && !win.loadedFromCache

  // Disarm the open-chat ladder once the first loaded batch has committed (it
  // already mounted with the cascade); subsequent appends then insert plainly.
  useEffect(() => {
    if (ladderActive) ladderArmedRef.current = false
  }, [ladderActive])

  // (Scroll correction, prepend-restore, jump-scroll, down-arrow pin, and player-offset
  // compensation all live in useChatScroll.)

  // Full-screen media viewer: the list of photo/video media currently loaded in
  // this chat, the index to open at, and the clicked thumbnail's rect (zoom origin).
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number; originRect: { top: number; left: number; width: number; height: number }; originSrc?: string; originEl: HTMLElement } | null>(null)
  const openLightbox = (mediaId: number, el: HTMLElement) => {
    if (!isRealChat) return
    const items: LightboxItem[] = win.msgs
      .filter((m) => m.mediaId != null && (m.type === 'photo' || m.type === 'video'))
      .map((m) => ({
        mediaId: m.mediaId as number,
        type: m.type,
        sender: m.senderId === meId ? (me?.displayName || 'Вы') : (peers.get(m.senderId)?.displayName || chat.name),
        date: friendlyMsgTime(m.createdAt, lang),
      }))
    const index = Math.max(0, items.findIndex((it) => it.mediaId === mediaId))
    const r = el.getBoundingClientRect()
    const img = el.querySelector('img')
    // Hide the source thumbnail while the viewer is open so only the growing
    // clone is visible (no "ghost" of the original behind it — tweb does this).
    el.style.visibility = 'hidden'
    setLightbox({ items, index, originRect: { top: r.top, left: r.left, width: r.width, height: r.height }, originSrc: img?.currentSrc || img?.src, originEl: el })
  }
  const closeLightbox = () => {
    if (lightbox) lightbox.originEl.style.visibility = ''
    setLightbox(null)
  }

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
  const feedFns = useMemo(
    () => ({
      openSender: openSenderE,
      playVoice: playVoiceE,
      toggleSelect: toggleSelectE,
      openMsgMenu: openMsgMenuE,
      jumpToSeq: jumpToSeqE,
      openLightbox: openLightboxE,
    }),
    [openSenderE, playVoiceE, toggleSelectE, openMsgMenuE, jumpToSeqE, openLightboxE],
  )

  // (Ack reconcile + send-rejection run in realtimeBridge → messagesStore; live
  // edit/delete keyed by chat_id; pinned-bar state in usePinnedBar. The read-marker
  // for a live/open chat — markRead vs unread-below pill — and mark-read-on-open /
  // on-refocus all live in useChatScroll (they need scroll/focus state).)

  // Incoming typing for real chats is centralized in the store (see realtimeBridge
  // + useTypingLabel below); the local `typing` boolean is only used by mock chats.

  // (Header card + member presence seeding now live in useChatInfoCard.)

  // Channel live + catch-up (mirrors tweb's getChannelDifference on open): subscribe
  // to the channel topic so live posts arrive via rt:new_message (existing path), and
  // fetch posts missed while away, applying them through the same window.
  useEffect(() => {
    if (!isRealChat || !isChannel) return
    let alive = true
    void managers.realtime.subscribeChannel({ chatId: numericChatId })
    void managers.channels.getDifference(numericChatId).then((missed) => {
      if (alive) missed.forEach((m) => win.applyIncoming(m))
    })
    return () => { alive = false; void managers.realtime.unsubscribeChannel({ chatId: numericChatId }) }
  }, [isRealChat, isChannel, numericChatId, managers, win])

  // Persist the channel's current max seq as pts once the newest posts are loaded so
  // future getChannelDifference starts there. pts ≈ seq is an approximation that holds
  // for our single-stream channels (one monotonic seq per channel).
  useEffect(() => {
    if (!isRealChat || !isChannel || !win.reachedBottom || win.msgs.length === 0) return
    const maxSeq = win.msgs[win.msgs.length - 1].seq
    void managers.channels.setPts(numericChatId, maxSeq)
  }, [isRealChat, isChannel, win.reachedBottom, win.msgs, numericChatId, managers])

  // Channel discussions: fetch comment counts for the loaded post ids (debounced on
  // msgs change). Only real channel posts with discussions enabled get a count.
  useEffect(() => {
    if (!discussionsEnabled) { setCommentCounts(new Map()); return }
    const ids = win.msgs.map((m) => m.id).filter((id) => id > 0)
    if (ids.length === 0) return
    let alive = true
    const timer = window.setTimeout(() => {
      void managers.channels.commentCounts(numericChatId, ids).then((counts) => {
        if (!alive) return
        setCommentCounts(new Map(Object.entries(counts).map(([k, v]) => [Number(k), v])))
      })
    }, 300)
    return () => { alive = false; window.clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discussionsEnabled, numericChatId, win.msgs.length, managers])

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

  // Add-member (real group chats only): candidate contacts are the user's existing
  // private-chat peers. Picking one adds them to this group, then reloads dialogs.
  const canAddMember = isRealChat && isGroup
  const dialogs = useChatsStore((s) => s.dialogs)
  const contactPeers = useMemo(
    () =>
      dialogs
        .filter((d) => d.type === 'private' && d.peer)
        .map((d) => d.peer!)
        .filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i),
    [dialogs],
  )
  const addMember = (userId: number) => {
    setAddMemberOpen(false)
    void managers.groups.addMember(numericChatId, userId).then(() => loadChats(managers))
  }

  // Header subtitle for real group/channel chats: derive a member/online (or
  // subscriber) count from the card + live online count. Private chats and mock
  // chats keep the existing chat.status text (returned as null here).
  const realSubtitle: string | null = (() => {
    if (!isRealChat || !card) return null
    if (card.type === 'channel') return `${card.memberCount} подписчиков`
    if (card.type === 'group')
      return `${card.memberCount} участников${onlineCount > 0 ? `, ${onlineCount} онлайн` : ''}`
    return null
  })()

  // Header status line: typing/recording wins; then group member counts; then
  // private online / last-seen; then any static status.
  const headerTypingActive = isRealChat ? typingLabel.active : typing
  const headerTypingText = isRealChat ? typingLabel.label : t('typing…')
  const headerTypingKind = isRealChat ? typingLabel.kind : 'text'
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
  // and the pinned-message bar when shown.
  const dateStickyTop = playerOffset + (pins.length > 0 && !searchOpen ? 122 : 66)
  // Stable callback for the memoized feed to open a channel post's discussion.
  const onOpenDiscussion = useEvent((postId: number, text?: string) => setDiscussion({ postId, post: { text } }))

  // Stable handlers for the extracted header/pinned bars so their memo holds
  // across the parent's transient re-renders.
  const onToggleInfo = useEvent(() => setInfoOpen((o) => !o))
  const onOpenHeaderMenu = useEvent((r: DOMRect) => setHeaderMenu({ top: r.bottom + 6, right: window.innerWidth - r.right }))
  const onUnpin = useEvent((id: number) => { void managers.messages.unpin(numericChatId, id) })
  // Stable composer callbacks so the memoized <Composer> doesn't re-render on
  // unrelated parent renders (e.g. the scroll handler toggling showScrollDown).
  const onComposerSend = useEvent((text: string, entities?: MessageEntity[]) => send(text, entities))
  const onComposerSticker = useEvent((emoji: string) => sendSticker(emoji))
  const onComposerGif = useEvent((gradient: string) => sendGif(gradient))
  const onComposerCancelReply = useEvent(() => setReply(null))
  const onComposerCancelEdit = useEvent(() => setEditing(null))
  const onComposerOpenAttach = useEvent((r: DOMRect) => setAttachAnchor({ left: r.left, bottom: window.innerHeight - r.top + 8 }))
  // Files pasted/dropped into the composer → open the same media-preview popup as
  // the attach button (lets the user add a caption + choose media/file).
  const onComposerPasteFiles = useEvent((files: File[]) => setPendingMedia({ files, asFile: false }))

  return (
    <CallProvider chat={chat}>
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'flex-start',
        position: 'relative',
        background: 'transparent',
      }}
    >
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          height: '100dvh',
          position: 'relative',
          overflow: 'hidden',
          px: narrow ? 1 : 0,
        }}
      >
        {/* Global "now playing" plate — a floating pill above the header (tweb:
            the topbar slides down to make room). Matches the header geometry. */}
        <Box sx={{ position: 'absolute', top: 16, left: 0, right: 0, zIndex: 25, display: 'flex', justifyContent: 'center', px: narrow ? 1 : 1.5 }}>
          <Box sx={{ width: '100%', maxWidth: 688 }}>
            <NowPlayingBar />
          </Box>
        </Box>

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
            <Box
              component={motion.div}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              sx={{ position: 'absolute', inset: 0, zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}
            >
              <Box sx={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Preloader size={30} stroke={2.5} color="#fff" />
              </Box>
            </Box>
          )}
        </AnimatePresence>

        {/* Conversation — own scroll container, masked like tweb's bubbles-scrollable */}
        <Box
          ref={scrollRef}
          onMouseDown={dragSelect.onMouseDown}
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            maskImage: FEED_MASK,
            WebkitMaskImage: FEED_MASK,
          }}
        >
          <Box
            ref={contentRef}
            sx={{
              width: '100%',
              maxWidth: 688,
              px: 0.5,
              // fade messages in once the first page has loaded (tweb-like)
              opacity: feedLoading ? 0 : 1,
              transition: 'opacity 0.2s ease',
              // push content to the bottom when short; clear the floating header/composer
              mt: 'auto',
              pt: `${FADE_TOP + playerOffset}px`,
              pb: `${FADE_BOTTOM}px`,
              display: 'flex',
              flexDirection: 'column',
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
                onOpenDiscussion={onOpenDiscussion}
              />
            )}

            {typing && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    px: 1.5,
                    py: 1.1,
                    background: incomingBg,
                    borderRadius: '15px 15px 15px 0',
                  }}
                >
                  {[0, 1, 2].map((d) => (
                    <Box
                      key={d}
                      component={motion.span}
                      animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                      transition={{ duration: 1, repeat: Infinity, delay: d * 0.18 }}
                      sx={{ width: 7, height: 7, borderRadius: '50%', background: tg.textSecondary }}
                    />
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        </Box>

        {/* Footer */}
        {selecting ? (
          <SelectionBar
            count={selected.size}
            onClear={clearSelection}
            onForward={() => setForwardIds([...selected])}
            onDelete={() => setDelIds({ ids: [...selected], canRevoke: canRevokeAll([...selected]) })}
          />
        ) : canType ? (
          <Box
            sx={{
              position: 'absolute',
              bottom: '16px',
              left: 0,
              right: 0,
              zIndex: 6,
              display: 'flex',
              alignItems: 'flex-end',
              gap: 1,
              width: '100%',
              maxWidth: 688,
              mx: 'auto',
            }}
          >
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
              onSticker={onComposerSticker}
              onGif={onComposerGif}
              onPasteFiles={isRealChat ? onComposerPasteFiles : undefined}
            />
          </Box>
        ) : (
          <Box
            sx={{
              position: 'absolute',
              bottom: '16px',
              left: 0,
              right: 0,
              zIndex: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              width: '100%',
              maxWidth: 688,
              mx: 'auto',
              py: 0,
            }}
          >
            {scrollDownFab}
            <Box
              component={motion.div}
              whileTap={{ scale: 0.995 }}
              sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                background: tg.bubble,
                borderRadius: '14px',
                py: 1.5,
                cursor: 'pointer',
                color: tg.textPrimary,
              }}
            >
              <TgIcon name="volume_off" size={20} color={tg.textSecondary} />
              <Typography sx={{ fontWeight: 600, fontSize: 15.5 }}>{t('Mute')}</Typography>
            </Box>
            <Box
              sx={{
                width: 52,
                height: 52,
                borderRadius: '14px',
                background: tg.bubble,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <TgIcon name="gift" color={tg.textSecondary} />
            </Box>
          </Box>
        )}
      </Box>

      {/* Info panel (private / group / channel) */}
      <AnimatePresence>
        {infoOpen && <UserInfoPanel chat={chat} onClose={() => setInfoOpen(false)} onOpenPeer={onOpenPeer} />}
      </AnimatePresence>

      {/* Add-contact screen (private chats) */}
      <AnimatePresence>
        {addContactOpen && <AddContactView chat={chat} onClose={() => setAddContactOpen(false)} />}
      </AnimatePresence>

      {/* Channel post discussion thread (real comments + composer + live) */}
      <AnimatePresence>
        {discussion && discussionsEnabled && (
          <DiscussionView
            key={discussion.postId}
            channelId={numericChatId}
            postId={discussion.postId}
            discussionChatId={discussionChatId}
            post={discussion.post}
            onBack={() => setDiscussion(null)}
          />
        )}
      </AnimatePresence>

      {/* Header "⋮" menu */}
      {headerMenu && (
        <HeaderMenu
          chat={isRealChat ? { ...chat, muted: muted || undefined } : chat}
          anchor={headerMenu}
          onClose={() => setHeaderMenu(null)}
          onToggleMute={isRealChat ? toggleMute : undefined}
          onAddMember={canAddMember ? () => setAddMemberOpen(true) : undefined}
          onSelectMessages={startSelectMode}
          onAddContact={chat.type === 'private' && chat.peerId != null ? () => setAddContactOpen(true) : undefined}
        />
      )}

      {/* Add-member picker (real group chats): a simple selectable list of contacts */}
      {addMemberOpen && (
        <AddMemberDialog contacts={contactPeers} onAdd={addMember} onClose={() => setAddMemberOpen(false)} />
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
        <MessageContextMenu menu={msgMenu} items={msgMenuItems} onClose={() => setMsgMenu(null)} />
      )}

      {/* "Seen by" popup */}
      {viewers && (
        <ViewersPopup x={viewers.x} y={viewers.y} names={viewers.names} onClose={() => setViewers(null)} />
      )}

      {/* Forward target picker */}
      {forwardIds != null && (
        <ForwardPicker dialogs={allDialogs} onPick={doForward} onClose={() => setForwardIds(null)} />
      )}

      {/* Delete confirmation (for me / for everyone) */}
      {delIds && (
        <DeleteMessageDialog
          canRevoke={delIds.canRevoke}
          onDeleteForEveryone={() => doDelete(true)}
          onDeleteForMe={() => doDelete(false)}
          onClose={() => setDelIds(null)}
        />
      )}
    </Box>
    </CallProvider>
  )
}
