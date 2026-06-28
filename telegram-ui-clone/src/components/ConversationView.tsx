import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Typography, useMediaQuery, useTheme } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from './TgIcon'
import { useAvatarSrc } from './useAvatarSrc'
import { gradientFor } from '../core/dialogToChat'
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
import { startClient } from '../client/bootstrap'
import { useMessageWindow } from '../core/hooks/useMessageWindow'
import { useEvent } from '../core/hooks/useEvent'
import { useDragSelect } from '../core/hooks/useDragSelect'
import Composer from './Composer'
import ChatFeed from './messages/ChatFeed'
import ChatHeader, { type SearchResultRow } from './conversation/ChatHeader'
import PinnedBar from './conversation/PinnedBar'
import ScrollDownFab from './conversation/ScrollDownFab'
import SelectionBar from './conversation/SelectionBar'
import MessageContextMenu from './conversation/MessageContextMenu'
import { messageToConvMsg } from '../core/messageToConvMsg'
import { usePeers, peersKey } from '../core/hooks/usePeers'
import { useChatsStore, loadChats } from '../stores/chatsStore'
import { uiEvents } from '../core/hooks/uiEvents'
import { RT, type NewMessageEvt, type AckEvt, type MessageErrorEvt, type PresenceEvt, type EditMessageEvt, type DeleteMessageEvt } from '../core/realtime/events'
import { mapMessage, type Message, type MessageEntity } from '../core/models'
import { splitRich } from '../core/markdown'

// Max characters per message (matches the backend's maxMessageRunes / Telegram 4096).
// Longer drafts are split into several messages on send.
const MAX_MESSAGE_LEN = 4096
import { smoothCenterElement, afterScrollSettles } from '../core/dom/smoothScrollToElement'
import { useVoiceRecorder, fmtDur } from '../core/hooks/useVoiceRecorder'
import { useChatSearch } from '../core/hooks/useChatSearch'
import { peerColor } from './peerColor'
import { DeleteMessageDialog, ForwardPicker, ViewersPopup, AddMemberDialog } from './messages/ChatDialogs'
import SendMediaPopup from './messages/SendMediaPopup'
import MediaLightbox, { type LightboxItem } from './messages/MediaLightbox'


// tweb's exact bubbles-scrollable fade: a pure alpha mask on the scroll viewport
// (no blur, no colour) so messages simply fade out to a 0.24 floor behind the
// floating header/composer, eased iOS-style (cubic-bezier sampled at 0/.2/.4/.6/.8/1).
const FADE_TOP = 76 // clear the floating header
const FADE_BOTTOM = 84 // clear the floating composer

// "Сегодня в 08:17" / "Вчера в 08:17" / "12.06 в 08:17" for the now-playing subtitle.
function friendlyMsgTime(iso: string, lang: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  const isYest = d.toDateString() === yest.toDateString()
  const ru = lang === 'ru'
  if (sameDay) return ru ? `Сегодня в ${hhmm}` : `Today at ${hhmm}`
  if (isYest) return ru ? `Вчера в ${hhmm}` : `Yesterday at ${hhmm}`
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
  return ru ? `${date} в ${hhmm}` : `${date} at ${hhmm}`
}
// Local start-of-day in ms (the date "bucket"), and a friendly day label for the
// date divider — tweb shows Today / Yesterday / "14 June" (with year if not this year).
const FLOOR = 'rgba(255,255,255,0.24)'
// Bottom keeps a faint floor (messages melt behind the composer); the TOP fades
// fully to transparent so nothing bleeds above the floating header.
const mixB = (k: number) => `color-mix(in srgb, #000 ${k}%, ${FLOOR})`
const mixT = (k: number) => `color-mix(in srgb, #000 ${k}%, transparent)`
const FEED_MASK = `linear-gradient(to bottom, transparent 0, ${mixT(8.6)} ${FADE_TOP * 0.2}px, ${mixT(33.4)} ${FADE_TOP * 0.4}px, ${mixT(66.6)} ${FADE_TOP * 0.6}px, ${mixT(91.4)} ${FADE_TOP * 0.8}px, #000 ${FADE_TOP}px, #000 calc(100% - ${FADE_BOTTOM}px), ${mixB(91.4)} calc(100% - ${FADE_BOTTOM * 0.8}px), ${mixB(66.6)} calc(100% - ${FADE_BOTTOM * 0.6}px), ${mixB(33.4)} calc(100% - ${FADE_BOTTOM * 0.4}px), ${mixB(8.6)} calc(100% - ${FADE_BOTTOM * 0.2}px), ${FLOOR} 100%)`

const replies = [
  'ахах да', 'ну ты даёшь 😄', 'согласен', 'хахаха', 'ладно', 'ок 👌', 'и не говори',
  'позже наберу', '🔥', 'да ну? серьёзно?', 'интересно', 'понятно', 'ну такое',
  'договорились 😌', 'я уже почти сплю 😴',
]

function nowTime() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

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
  // On narrow screens the chat is full-width; give the header/feed/composer a
  // side gutter so the floating pills don't sit flush against the screen edges.
  const narrow = useMediaQuery('(max-width:900px)')
  const incomingBg = tg.bubble
  const isChannel = chat.type === 'channel'
  const isGroup = chat.type === 'group'

  const numericChatId = Number(chat.id)
  const isRealChat = Number.isFinite(numericChatId) && String(numericChatId) === chat.id
  // Draft private chat ("draft:<peerId>"): no server chat yet — it's created on
  // the first send. isRealChat is false here, so history/markRead stay disabled.
  const draftPeerId = chat.id.startsWith('draft:') ? Number(chat.id.slice('draft:'.length)) : null
  const meId = useChatsStore((s) => s.meId)
  const me = useChatsStore((s) => s.me)
  const allDialogs = useChatsStore((s) => s.dialogs)
  // Live typing label (real chats) + peer presence (private chats) for the header.
  const typingLabel = useTypingLabel(numericChatId, isGroup)
  const peerPresence = useChatsStore((s) => (chat.peerId != null ? s.presence[chat.peerId] : undefined))
  const setDialogMuted = useChatsStore((s) => s.setDialogMuted)
  // Live muted state for real chats: read from the store dialog so an optimistic
  // toggle re-renders the menu; fall back to the chat prop.
  const dialogMuted = useChatsStore((s) =>
    isRealChat ? s.dialogs.find((d) => d.chatId === numericChatId)?.muted : undefined,
  )
  const muted = dialogMuted ?? !!chat.muted
  const { managers } = startClient()
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

  // throttle for outgoing `typing` frames
  const lastTypingRef = useRef(0)

  // Mock chats (local group/channel stubs) keep the old in-memory message list;
  // real chats render the windowed history mapped to ConvMsg.
  const [mockMsgs, setMockMsgs] = useState<ConvMsg[]>(chat.messages ?? [])
  // Real group/channel header counts: card (memberCount + type) and, for groups,
  // the member set + a live online set driven by rt:presence frames.
  const [card, setCard] = useState<{ type: string; memberCount: number; myRole: string; myRights: number; discussionChatId: number } | null>(null)
  const memberIds = useRef<Set<number>>(new Set())
  const [onlineIds, setOnlineIds] = useState<Set<number>>(new Set())
  // Peer's read horizon (real chats): out messages with seq<=peerReadSeq render the
  // double-check (read). Read straight from the store dialog — it's seeded from
  // GET /chats (peer_read_seq) on load and advanced by applyRead on live rt:read,
  // so ticks are correct immediately on open and after switching chats (no longer
  // a local state that resets to 0).
  const peerReadSeq = useChatsStore((s) =>
    isRealChat ? s.dialogs.find((d) => d.chatId === numericChatId)?.peerReadSeq ?? 0 : 0,
  )
  // Channel discussions: comment counts per post id + the open thread overlay.
  const discussionChatId = card?.discussionChatId ?? 0
  const discussionsEnabled = isRealChat && isChannel && discussionChatId > 0
  const [commentCounts, setCommentCounts] = useState<Map<number, number>>(new Map())
  const [discussion, setDiscussion] = useState<{ postId: number; post: { text?: string } } | null>(null)
  // Channel control plate (mirrors tweb input.ts): an admin who may post sees the
  // composer; a subscriber without POST_MESSAGES sees the Mute bar. The post
  // permission comes from the fetched card (creator, or the POST_MESSAGES rights bit = 1).
  const canPostChannel = card?.myRole === 'creator' || ((card?.myRights ?? 0) & 1) === 1
  // Groups/private unchanged (canType true); channels only type for posters.
  const canType = !isChannel || canPostChannel
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
  const setMsgs = setMockMsgs

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
  const [reply, setReply] = useState<{ msgId?: number; name: string; text: string; color: string } | null>(null)
  // Editing an existing message (composer switches to edit mode).
  const [editing, setEditing] = useState<{ msgId: number; text: string; entities?: MessageEntity[] } | null>(null)
  // Pending delete confirmation: message ids + whether "for everyone" is offered.
  const [delIds, setDelIds] = useState<{ ids: number[]; canRevoke: boolean } | null>(null)
  // Pending forward: message ids to forward (opens the chat picker).
  const [forwardIds, setForwardIds] = useState<number[] | null>(null)
  // Pinned messages in this chat (newest pin first) — drives the pinned bar.
  const [pins, setPins] = useState<Message[]>([])
  // "Seen by" popup: the resolved viewers of a message.
  const [viewers, setViewers] = useState<{ x: number; y: number; names: string[] } | null>(null)
  // Briefly highlighted message (jump-to target), by seq.
  const [highlightSeq, setHighlightSeq] = useState<number | null>(null)
  // Multi-select: a set of selected message ids; non-empty ⇒ selection mode.
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // Selection mode can be on with nothing yet selected (entered from the header
  // menu's "Select Messages" / a message's "Select"), so it's an explicit flag —
  // not just `selected.size > 0`. Cleared by the selection bar's ✕ (or Escape).
  const [selectionMode, setSelectionMode] = useState(false)
  const selecting = selectionMode || selected.size > 0
  // Latest selection in a ref so the drag-select handler reads it without a stale
  // closure; suppressClickRef makes the trailing click after a drag a no-op.
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const dragSuppressClickRef = useRef(false)
  const toggleSelect = (id: number) => {
    if (dragSuppressClickRef.current) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const clearSelection = () => { setSelected(new Set()); setSelectionMode(false) }
  // Enter selection mode from the header menu with nothing selected yet.
  const startSelectMode = () => { setSelectionMode(true); setHeaderMenu(null) }
  const search = useChatSearch(numericChatId, isRealChat, managers)
  const [headerMenu, setHeaderMenu] = useState<{ top: number; right: number } | null>(null)
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [addContactOpen, setAddContactOpen] = useState(false)
  const [showScrollDown, setShowScrollDown] = useState(false)
  // Count of new messages that arrived below the viewport while scrolled up
  // (shown as a badge on the scroll-to-bottom button, like tweb).
  const [unreadBelow, setUnreadBelow] = useState(0)
  const [attachAnchor, setAttachAnchor] = useState<{ left: number; bottom: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastScrollTopRef = useRef(0)
  // Press-and-drag multi-select across the feed (tweb): active only in selection mode.
  const dragSelect = useDragSelect({
    scrollRef,
    enabled: selecting,
    selectedRef,
    setSelected,
    suppressClickRef: dragSuppressClickRef,
  })

  // Real-node rendering (tweb model): we render the loaded window directly — no
  // estimated spacers — so scrollHeight is REAL and stable. Scroll position is
  // owned by a single scrolledDown state machine (the only place
  // that corrects scrollTop); see the scroll effects below. Lazy window trimming
  // (cull) keeps the loaded set bounded.

  const canSendVoice = isRealChat || draftPeerId != null

  // Voice-recording mechanics live in useVoiceRecorder; here we only decide what to
  // do with a finished clip: upload + send on a real/draft chat, else a mock bubble.
  const pingVoiceTyping = () => { if (isRealChat) void managers.realtime.sendTyping({ chatId: numericChatId, action: 'voice' }) }
  const rec = useVoiceRecorder({
    capture: canSendVoice,
    onStart: pingVoiceTyping,
    onSecond: pingVoiceTyping,
    onComplete: async (r) => {
      if (!r) return
      const { secs, blob, mime } = r
      if (canSendVoice && blob) {
        const bytes = await blob.arrayBuffer()
        const mediaId = await managers.media.upload({ bytes, mime, size: blob.size, duration: secs })
        const clientMsgId = `c-${chat.id}-${performance.now()}-${Math.random().toString(36).slice(2)}`
        let cid = numericChatId
        if (draftPeerId != null) cid = await managers.chats.createPrivate(draftPeerId)
        atBottomRef.current = true; userScrolledUpRef.current = false
        if (isRealChat) win.appendOptimistic('', meId ?? -1, clientMsgId, mediaId, 'voice')
        void managers.realtime.sendMessage({ chatId: cid, text: '', clientMsgId, mediaId, type: 'voice' })
        window.dispatchEvent(new Event('tg-send'))
        if (draftPeerId != null) onChatCreated?.(cid)
        return
      }
      // mock chat: keep the design-time bubble + canned reply
      const waveform = Array.from({ length: 28 }, () => 0.25 + Math.random() * 0.75)
      setMsgs((prev) => [
        ...prev,
        { type: 'voice', out: true, time: nowTime(), status: 'sent', duration: fmtDur(secs), waveform },
      ])
      window.dispatchEvent(new Event('tg-send'))
      setTyping(true)
      window.setTimeout(() => {
        const canned = replies[Math.floor(Math.random() * replies.length)]
        setMsgs((prev) => [...prev, { type: 'text', out: false, text: canned, time: nowTime() }])
        setTyping(false)
      }, 1100 + Math.random() * 900)
    },
  })

  // Esc exits multi-select.
  useEffect(() => {
    if (!selecting) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); clearSelection() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selecting])

  // Show the "scroll to bottom" button once the user scrolls up away from the latest messages
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const st = el.scrollTop
      const dist = el.scrollHeight - st - el.clientHeight
      // A genuine upward scroll away from the bottom means the user is now browsing
      // history — release the open-time bottom anchor.
      if (st < lastScrollTopRef.current - 1 && dist > 240) userScrolledUpRef.current = true
      // Show the down-arrow when scrolled up OR when we jumped mid-history and the
      // true bottom of the chat isn't loaded yet (tweb: visible while !loadedAll.bottom).
      setShowScrollDown(dist > 240 || (isRealChat && win.msgs.length > 0 && !win.reachedBottom))
      // Track whether we're pinned to the bottom — the content ResizeObserver
      // re-pins while this holds (so async media/height growth never strands the
      // view in the middle or jitters it on incoming messages). For a real chat,
      // require the REAL chat bottom to be loaded (tweb: scrolledDown needs
      // loadedAll.bottom): otherwise a short mid-history window (e.g. a jump near
      // the chat top) sits within 240px of the LOADED bottom, flips this true, and
      // the re-pin + loadNewer feed each other into a cascade that loads the whole
      // history. While a real chat is still loading (no msgs yet) leave atBottomRef
      // at its open-time default so the initial scroll-to-bottom isn't cancelled.
      if (!isRealChat) {
        atBottomRef.current = dist < 240
        if (dist < 240) setUnreadBelow(0)
      } else if (win.msgs.length > 0) {
        const atRealBottom = dist < 240 && win.reachedBottom
        // Stay pinned to the bottom from open until the user scrolls up. Once they
        // have, fall back to the strict real-bottom gate (prevents a mid-history
        // jump from false-pinning + cascading loadNewer).
        atBottomRef.current = !userScrolledUpRef.current || atRealBottom
        if (atRealBottom) {
          setUnreadBelow(0)
          if (document.hasFocus()) {
            void managers.realtime.markRead({ chatId: numericChatId, upToSeq: win.msgs[win.msgs.length - 1].seq })
          }
        }
      }
      // Only page on genuine USER scrolls: programmatic bottom-pinning scrolls
      // DOWN (st increases), so requiring an upward delta prevents the open-time
      // cascade that would otherwise load the whole history and strand the view.
      const goingUp = st < lastScrollTopRef.current - 1
      lastScrollTopRef.current = st
      if (!isRealChat || win.msgs.length === 0) return
      if (goingUp && st < 300 && !win.reachedTop && !win.loadingOlder) {
        // Preserve the user's place across the prepend: record distance-from-bottom
        // now; the layout effect restores it after the new chunk commits, and the
        // content observer keeps restoring it while the prepended media settles
        // (single rAF restore landed before the DOM/heights were final → the view
        // jumped onto the freshly-loaded older messages).
        pendingRestore.current = el.scrollHeight - el.scrollTop
        if (restoreTimer.current) clearTimeout(restoreTimer.current)
        restoreTimer.current = window.setTimeout(() => { pendingRestore.current = null }, 1500)
        void win.loadOlder()
      }
      // Load newer when within ~a viewport of the loaded bottom, in EITHER scroll
      // direction. We must NOT require a downward delta here: at the exact loaded
      // bottom scrollTop is maxed, so wheeling down fires no scroll event and the
      // user gets stranded (the "scroll up a bit then back down to load" bug).
      // Triggering a viewport early also keeps content ready ahead of the read.
      // reachedBottom (+ atBottomRef gating) already prevents an open-time cascade.
      if (dist < el.clientHeight * 0.75 && !win.reachedBottom && !win.loadingNewer) {
        void win.loadNewer()
      }
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [msgs, isRealChat, win])
  // Screen-size safety net: if the loaded window doesn't overflow the viewport
  // there's nothing to scroll, so the scroll-driven loadNewer above can never
  // fire — on a very tall screen a single page can fit entirely. Pull more until
  // the feed is scrollable (or the real bottom is reached) so reading forward
  // always works, independent of viewport height. Bounded: each fetch adds a page.
  useEffect(() => {
    if (!isRealChat || win.loading || win.reachedBottom || win.loadingNewer) return
    const el = scrollRef.current
    if (el && el.scrollHeight <= el.clientHeight + 4) void win.loadNewer()
  }, [isRealChat, win])
  const scrollToBottom = () =>
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })

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
  // Jump to a message by seq: scroll to it if loaded, else load a window around
  // it (win.jumpTo) and scroll once it mounts (pendingJumpSeq). Briefly highlights.
  const pendingJumpSeq = useRef<number | null>(null)
  // Set by the down-arrow escape: the next window commit (reloadNewest) must land
  // pinned to the bottom. A layout effect (below) does the pin synchronously so it
  // beats the passive onScroll effect, which would otherwise reset atBottomRef from
  // the still-at-top scroll position the instant the new page renders.
  const pinBottomNext = useRef(false)
  const flashSeq = (seq: number) => {
    setHighlightSeq(seq)
    window.setTimeout(() => setHighlightSeq((s) => (s === seq ? null : s)), 2000)
  }
  // Glide the target bubble to the vertical center (tweb fastSmoothScroll, see
  // smoothCenterElement) and flash it once the scroll settles — flashing immediately
  // would play the highlight out mid-travel, gone before the target arrives.
  const smoothCenterToSeq = (el: HTMLElement, seq: number) => {
    const sc = scrollRef.current
    if (!sc) { el.scrollIntoView({ block: 'center' }); flashSeq(seq); return }
    atBottomRef.current = false
    userScrolledUpRef.current = true // a jump leaves the bottom anchor
    smoothCenterElement(sc, el)
    afterScrollSettles(sc, () => {
      // Guarantee the target actually ended up on screen. A competing scroll write
      // during the smooth glide (window fill, media settling, layout shift) can land
      // the view somewhere else — if the target is off-screen now, glide it back to
      // center (smooth, not an instant snap, so the correction reads cleanly). Only
      // re-assert when fully off-screen, so a user who scrolled away isn't yanked.
      const cur = document.querySelector(`[data-seq="${seq}"]`) as HTMLElement | null
      if (cur) {
        const r = cur.getBoundingClientRect(), scR = sc.getBoundingClientRect()
        if (r.bottom <= scR.top || r.top >= scR.bottom) cur.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      flashSeq(seq)
    })
  }
  const jumpToSeq = (seq?: number) => {
    if (seq == null || !isRealChat) return
    const el = document.querySelector(`[data-seq="${seq}"]`) as HTMLElement | null
    if (el) {
      // Target already in the rendered window → glide to it.
      smoothCenterToSeq(el, seq)
      return
    }
    // Fresh load: drop the bottom-pin NOW (before the new window commits), or the
    // content ResizeObserver pins the swapped-in window to its bottom while
    // atBottomRef is still true — a visible jerk (bottom → then the jump effect
    // yanks to the target) on the first jump after a reload.
    atBottomRef.current = false
    userScrolledUpRef.current = true // a jump leaves the bottom anchor
    pendingJumpSeq.current = seq
    void win.jumpTo(seq)
  }
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

  // reset when switching chats (the Composer is keyed by chat, so it remounts and
  // clears its own draft + autofocuses).
  useEffect(() => {
    setMockMsgs(chat.messages ?? [])
    setTyping(false)
    setInfoOpen(false)
    search.reset()
    setReply(null)
    setEditing(null)
    setDelIds(null)
    setForwardIds(null)
    setViewers(null)
    setSelected(new Set())
    setDiscussion(null)
    setCommentCounts(new Map())
    lastScrollTopRef.current = 0
  }, [chat, canType])

  // `atBottomRef` is the SINGLE source of truth for scroll intent (tweb's
  // `scrolledDown`): true = follow the bottom, false = the user is browsing
  // history. Reset to true on chat change (keyed on the stable id, NOT the chat
  // object whose identity changes on every dialog update).
  const atBottomRef = useRef(true)
  // Whether the user has scrolled up away from the open-time bottom. Until they do,
  // we stay anchored to the bottom even if the loaded window's bottom isn't yet
  // confirmed as the REAL chat bottom (a cache re-open can report reachedBottom=false
  // when messages arrived between sessions) — loadNewer chases the latest while the
  // pin follows it. Set on a real upward scroll / a jump; reset on chat change.
  const userScrolledUpRef = useRef(false)
  const contentRef = useRef<HTMLDivElement>(null)
  // Distance-from-bottom to hold across a loadOlder prepend (null = not prepending).
  const pendingRestore = useRef<number | null>(null)
  const restoreTimer = useRef<number | undefined>(undefined)
  useEffect(() => { atBottomRef.current = true; userScrolledUpRef.current = false; pendingRestore.current = null }, [numericChatId])

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

  // The single scroll corrector. Real nodes ⇒ real scrollHeight ⇒ stable, no
  // spacers/anchor math, no competing writers:
  //   • atBottomRef (tweb scrolledDown) → follow the bottom as content grows
  //     (open, live/sent messages, async media reserving its box);
  //   • else if a prepend is settling → hold distance-from-bottom so the user's
  //     place (e.g. the image they were viewing) stays put while the older chunk
  //     and its media finish laying out.
  // Runs on every content resize AND right after a prepend commits (layout effect).
  const correctScroll = () => {
    const el = scrollRef.current
    if (!el) return
    if (atBottomRef.current) el.scrollTop = el.scrollHeight
    else if (pendingRestore.current != null) el.scrollTop = el.scrollHeight - pendingRestore.current
  }
  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver(() => correctScroll())
    obs.observe(content)
    correctScroll()
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericChatId])
  // Restore the prepend position synchronously after the new chunk commits.
  useLayoutEffect(() => {
    if (pendingRestore.current != null) correctScroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.msgs])

  // After a jump-to-message window loads, scroll to the target + flash it.
  useLayoutEffect(() => {
    const seq = pendingJumpSeq.current
    if (seq == null) return
    const el = document.querySelector(`[data-seq="${seq}"]`) as HTMLElement | null
    if (el) {
      // Window mounted → glide to the target (tweb fastSmoothScroll). The bubble is
      // in the DOM now, so the distance-capped smooth scroll animates a short stretch
      // even when the jump spans the whole chat. (onScroll keeps lastScrollTopRef in
      // sync as the animation runs.)
      smoothCenterToSeq(el, seq)
      pendingJumpSeq.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.msgs])

  // After the down-arrow escape (reloadNewest) commits the newest page, pin to the
  // bottom synchronously. Doing it in a layout effect beats the passive onScroll
  // effect's re-run (which reads the still-at-top scroll and would clear
  // atBottomRef); the content ResizeObserver then keeps it pinned as media settles.
  useLayoutEffect(() => {
    if (!pinBottomNext.current) return
    const el = scrollRef.current
    if (el) { atBottomRef.current = true; userScrolledUpRef.current = false; el.scrollTop = el.scrollHeight }
    pinBottomNext.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.msgs])

  // Disarm the open-chat ladder once the first loaded batch has committed (it
  // already mounted with the cascade); subsequent appends then insert plainly.
  useEffect(() => {
    if (ladderActive) ladderArmedRef.current = false
  }, [ladderActive])

  // Opening/closing the player changes the feed's top padding by playerOffset.
  // Compensate scrollTop by the delta so the viewport stays put (no jump up),
  // unless we're pinned to the bottom (the resize observer re-pins there).
  const prevPlayerOffset = useRef(playerOffset)
  useLayoutEffect(() => {
    const el = scrollRef.current
    const delta = playerOffset - prevPlayerOffset.current
    prevPlayerOffset.current = playerOffset
    // Unconditional: the feed's top padding changed by `delta`, so shift
    // scrollTop by the same amount — keeps the viewport fixed whether the user
    // is mid-history or pinned to the bottom (no jump on play).
    if (el && delta !== 0) el.scrollTop += delta
  }, [playerOffset])

  const replyToId = reply?.msgId ?? null
  const mkClientMsgId = (k = 0) => `c-${chat.id}-${performance.now()}-${k}-${Math.random().toString(36).slice(2)}`
  const sendReal = (text: string, entities?: MessageEntity[], replyTo: number | null = replyToId) => {
    const clientMsgId = mkClientMsgId()
    atBottomRef.current = true; userScrolledUpRef.current = false // sending pins to bottom
    win.appendOptimistic(text, meId ?? -1, clientMsgId, undefined, 'text', entities)
    void managers.realtime.sendMessage({ chatId: numericChatId, text, entities, clientMsgId, replyToId: replyTo })
  }

  const fileInputRef = useRef<HTMLInputElement>(null)
  // Set by the attach menu before opening the picker: send the chosen files as
  // raw documents (true) or with media treatment (false). The accept filter is
  // applied imperatively right before .click().
  const pickAsFileRef = useRef(false)
  const openPicker = (accept: string, asFile: boolean) => {
    pickAsFileRef.current = asFile
    const el = fileInputRef.current
    if (el) { el.accept = accept; el.click() }
    setAttachAnchor(null)
  }

  const readImageSize = (file: File): Promise<{ width: number; height: number }> =>
    new Promise((resolve) => {
      if (!file.type.startsWith('image/')) return resolve({ width: 0, height: 0 })
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url) }
      img.onerror = () => { resolve({ width: 0, height: 0 }); URL.revokeObjectURL(url) }
      img.src = url
    })

  // asFile=true sends without "media" treatment (a photo/video becomes a
  // downloadable document). Otherwise the type is inferred from the mime.
  // caption (optional) is attached as the message text.
  const onPickFile = async (file: File, asFile = false, caption = '') => {
    if (!isRealChat) return
    const mime = file.type || 'application/octet-stream'
    const type = asFile
      ? 'document'
      : mime.startsWith('image/') ? 'photo'
      : mime.startsWith('video/') ? 'video'
      : mime.startsWith('audio/') ? 'audio'
      : 'document'
    const bytes = await file.arrayBuffer()
    const { width, height } = type === 'photo' ? await readImageSize(file) : { width: 0, height: 0 }
    const mediaId = await managers.media.upload({ bytes, mime, size: file.size, width, height, fileName: file.name })
    const clientMsgId = `c-${chat.id}-${performance.now()}-${Math.random().toString(36).slice(2)}`
    atBottomRef.current = true; userScrolledUpRef.current = false
    win.appendOptimistic(caption, meId ?? -1, clientMsgId, mediaId, type)
    void managers.realtime.sendMessage({ chatId: numericChatId, text: caption, clientMsgId, mediaId, type })
  }
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
  // Picked files awaiting the compose popup (caption + as-media/as-file choice).
  const [pendingMedia, setPendingMedia] = useState<{ files: File[]; asFile: boolean } | null>(null)
  const sendPendingMedia = async (caption: string, asFile: boolean) => {
    const pm = pendingMedia
    setPendingMedia(null)
    if (!pm) return
    // The caption goes on the first item only (albums come in Phase 3).
    for (let i = 0; i < pm.files.length; i++) {
      await onPickFile(pm.files[i], asFile, i === 0 ? caption : '')
    }
  }

  // Reconcile optimistic sends with the server ack (real chats only).
  useEffect(() => {
    if (!isRealChat) return
    return uiEvents.on(RT.ack, (a) => {
      const ack = a as AckEvt
      win.reconcileAck(ack.client_msg_id, { msgId: ack.msg_id, seq: ack.seq, createdAt: ack.created_at })
    })
  }, [isRealChat, win])

  // Server rejected one of our sends (e.g. too long) — drop the optimistic bubble
  // so it doesn't linger as if delivered. The composer already blocks over-limit
  // sends; this covers the rejection path defensively.
  useEffect(() => {
    if (!isRealChat) return
    return uiEvents.on(RT.messageError, (e) => {
      win.failOptimistic((e as MessageErrorEvt).client_msg_id)
    })
  }, [isRealChat, win])

  // Step 3: incoming new_message for this chat — append, mark read, conditional scroll.
  useEffect(() => {
    if (!isRealChat) return
    return uiEvents.on(RT.newMessage, (raw) => {
      const m = raw as NewMessageEvt
      if (m.chat_id !== numericChatId) return
      // Live new_message carries reply_to_id but no preview — resolve it from the
      // loaded window so a reply shows its quote immediately (history hydrates the rest).
      const rt = m.reply_to_id != null ? win.msgs.find((x) => x.id === m.reply_to_id) : undefined
      const replyTo = rt ? { msg_id: rt.id, seq: rt.seq, sender_id: rt.senderId, text: rt.text, type: rt.type } : null
      win.applyIncoming(mapMessage({ id: m.msg_id, chat_id: m.chat_id, seq: m.seq, sender_id: m.sender_id, type: m.type, text: m.text, entities: m.entities ?? null, reply_to_id: m.reply_to_id ?? null, media_id: m.media_id, created_at: m.created_at, fwd_from_user_id: m.fwd_from_user_id ?? null, fwd_from_chat_id: m.fwd_from_chat_id ?? null, fwd_from_msg_id: m.fwd_from_msg_id ?? null, fwd_date: m.fwd_date ?? null, reply_to: replyTo }))
      // The content observer follows the bottom when atBottomRef is set; here we
      // only decide read vs. the unread-below counter (tweb: read only what's seen).
      if (atBottomRef.current && document.hasFocus()) {
        void managers.realtime.markRead({ chatId: numericChatId, upToSeq: m.seq })
      } else {
        setUnreadBelow((c) => c + 1)
      }
    })
  }, [isRealChat, numericChatId, win, managers])

  // Live edit/delete for this chat → patch/drop the message in the window.
  useEffect(() => {
    if (!isRealChat) return
    const offE = uiEvents.on(RT.editMessage, (raw) => {
      const e = raw as EditMessageEvt
      if (e.chat_id !== numericChatId) return
      win.applyEdit(e.msg_id, e.text, e.edited_at, e.entities ?? undefined)
    })
    const offD = uiEvents.on(RT.deleteMessage, (raw) => {
      const e = raw as DeleteMessageEvt
      if (e.chat_id !== numericChatId) return
      win.applyDelete(e.msg_id, e.for_me)
    })
    return () => { offE(); offD() }
  }, [isRealChat, numericChatId, win])

  // Pinned messages: load on open, refresh on live pin_message for this chat.
  useEffect(() => {
    if (!isRealChat) { setPins([]); return }
    let alive = true
    const refresh = () => { void managers.messages.listPins(numericChatId).then((p) => { if (alive) setPins(p) }) }
    refresh()
    const off = uiEvents.on(RT.pinMessage, (raw) => {
      const e = raw as { chat_id: number }
      if (e.chat_id === numericChatId) refresh()
    })
    return () => { alive = false; off() }
  }, [isRealChat, numericChatId, managers])

  // Step 4: mark read on open — when the newest is loaded and the window is
  // focused, read up to max seq (clears the unread badge). Gated on focus like
  // tweb (a background tab shouldn't mark a chat read).
  useEffect(() => {
    if (!isRealChat || !win.reachedBottom || win.msgs.length === 0) return
    if (!document.hasFocus()) return
    const maxSeq = win.msgs[win.msgs.length - 1].seq
    void managers.realtime.markRead({ chatId: numericChatId, upToSeq: maxSeq })
  }, [isRealChat, win.reachedBottom, win.msgs, numericChatId, managers])

  // Mark read when the window regains focus while we're at the bottom of this chat.
  useEffect(() => {
    if (!isRealChat) return
    const onFocus = () => {
      const el = scrollRef.current
      if (!el || win.msgs.length === 0) return
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) {
        setUnreadBelow(0)
        void managers.realtime.markRead({ chatId: numericChatId, upToSeq: win.msgs[win.msgs.length - 1].seq })
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [isRealChat, numericChatId, win.msgs, managers])

  // Incoming typing for real chats is centralized in the store (see realtimeBridge
  // + useTypingLabel below); the local `typing` boolean is only used by mock chats.

  // Header counts for real group/channel chats: fetch the card (type + memberCount)
  // and, for groups, the member snapshot (seeds memberIds + the initial online set).
  // Reset everything when the chat changes so a stale count never leaks across chats.
  useEffect(() => {
    setCard(null)
    memberIds.current = new Set()
    setOnlineIds(new Set())
    if (!isRealChat) return
    let alive = true
    void managers.groups.card(numericChatId).then((c) => {
      if (!alive) return
      setCard({ type: c.type, memberCount: c.memberCount, myRole: c.myRole, myRights: c.myRights, discussionChatId: c.discussionChatId })
      if (c.type === 'group') {
        void managers.groups.members(numericChatId).then((mem) => {
          if (!alive) return
          memberIds.current = new Set(mem.map((m) => m.userId))
          setOnlineIds(new Set(mem.filter((m) => m.online).map((m) => m.userId)))
        })
      }
    })
    return () => { alive = false }
  }, [isRealChat, numericChatId, managers])

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

  // Live online updates: a presence frame for a known member toggles the online set.
  useEffect(() => {
    if (!isRealChat) return
    return uiEvents.on(RT.presence, (raw) => {
      const ev = raw as PresenceEvt
      if (!memberIds.current.has(ev.user_id)) return
      setOnlineIds((prev) => {
        const has = prev.has(ev.user_id)
        if (ev.online === has) return prev
        const next = new Set(prev)
        if (ev.online) next.add(ev.user_id)
        else next.delete(ev.user_id)
        return next
      })
    })
  }, [isRealChat])

  // (Peer read horizon now comes straight from the store dialog — see peerReadSeq
  // above. chatsStore.applyRead advances it on every live rt:read, so no local
  // listener is needed here.)

  // Called by the Composer with the trimmed draft text (the Composer owns the
  // text state + clears itself afterwards); we route by chat kind / edit / reply.
  const send = (text: string, entities?: MessageEntity[]) => {
    if (!text || !canType) return
    // Edit mode: PATCH the existing message instead of sending a new one.
    if (editing && isRealChat) {
      const { msgId } = editing
      setEditing(null)
      void managers.messages.editMessage(numericChatId, msgId, text, entities)
      return
    }
    // Over the message limit → split into multiple messages (tweb splitStringByLength).
    // A span crossing a boundary (e.g. a long code block) becomes one per chunk.
    const parts = splitRich(text, entities ?? [], MAX_MESSAGE_LEN)
    const entOf = (p: { entities: MessageEntity[] }) => (p.entities.length ? p.entities : undefined)
    if (draftPeerId != null) {
      // First message in a draft: create the private chat, send all parts, then let
      // the shell switch to the now-real chat (and surface it in the sidebar).
      setReply(null)
      window.dispatchEvent(new Event('tg-send'))
      void (async () => {
        const id = await managers.chats.createPrivate(draftPeerId)
        for (let k = 0; k < parts.length; k++) {
          await managers.realtime.sendMessage({ chatId: id, text: parts[k].text, entities: entOf(parts[k]), clientMsgId: mkClientMsgId(k) })
        }
        onChatCreated?.(id)
      })()
      return
    }
    if (isRealChat && isChannel) {
      // Channels post through the REST channel endpoint (not the group WS send);
      // optimistic append (sender is the posting admin = me), reusing the existing
      // optimistic + scroll-to-bottom pattern. Live echo arrives via rt:new_message.
      // (Channel posts are plain text — no entities on this path yet.)
      setReply(null)
      window.dispatchEvent(new Event('tg-send'))
      atBottomRef.current = true; userScrolledUpRef.current = false
      for (let k = 0; k < parts.length; k++) {
        const clientMsgId = mkClientMsgId(k)
        win.appendOptimistic(parts[k].text, meId ?? -1, clientMsgId)
        void managers.channels.post(numericChatId, parts[k].text, clientMsgId)
      }
      return
    }
    if (isRealChat) {
      setReply(null)
      window.dispatchEvent(new Event('tg-send'))
      // reply attaches to the first message only (Telegram behaviour)
      parts.forEach((p, k) => sendReal(p.text, entOf(p), k === 0 ? replyToId : null))
      return
    }
    setMsgs((prev) => [
      ...prev,
      ...parts.map((p, k) => ({ type: 'text' as const, out: true, text: p.text, entities: entOf(p), time: nowTime(), status: 'sent' as const, reply: k === 0 ? reply ?? undefined : undefined })),
    ])
    setReply(null)
    setTyping(true)
    window.dispatchEvent(new Event('tg-send')) // shift the wallpaper gradient
    window.setTimeout(() => {
      const r = replies[Math.floor(Math.random() * replies.length)]
      const botReply: ConvMsg = { type: 'text', out: false, text: r, time: nowTime() }
      if (isGroup) {
        const senders = [
          { n: 'Аня', c: '#ee7aae' },
          { n: 'Макс', c: '#65aadd' },
          { n: 'Лёха', c: '#7bc862' },
        ]
        const s = senders[Math.floor(Math.random() * senders.length)]
        botReply.sender = s.n
        botReply.senderColor = s.c
      }
      setMsgs((prev) => [...prev, botReply])
      setTyping(false)
    }, 1100 + Math.random() * 900)
  }

  const sendSticker = (emoji: string) => {
    if (!canType) return
    setMsgs((prev) => [...prev, { type: 'sticker', out: true, emoji, time: nowTime(), status: 'sent' }])
    window.dispatchEvent(new Event('tg-send'))
  }
  const sendGif = (gradient: string) => {
    if (!canType) return
    setMsgs((prev) => [
      ...prev,
      { type: 'video', out: true, media: { gradient, emoji: '🎬' }, videoDuration: 'GIF', time: nowTime(), status: 'sent' },
    ])
    window.dispatchEvent(new Event('tg-send'))
  }

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

  // Throttled outgoing typing frame (real chats); called by the Composer on each
  // keystroke. Kept here so the Composer needs no chat/managers knowledge.
  const onComposerTyping = useEvent(() => {
    if (!isRealChat) return
    const now = performance.now()
    if (now - lastTypingRef.current > 3000) {
      lastTypingRef.current = now
      void managers.realtime.sendTyping({ chatId: numericChatId })
    }
  })

  // Header subtitle for real group/channel chats: derive a member/online (or
  // subscriber) count from the card + live online set. Private chats and mock
  // chats keep the existing chat.status text (returned as null here).
  const onlineCount = onlineIds.size
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

  // Floating "scroll to bottom" button (tweb .bubbles-go-down), shown above the composer
  // If we jumped into mid-history (true bottom not loaded), reload the newest page
  // and pin to it — scrolling the loaded window alone would strand us in old
  // messages (tweb onGoDownClick → setMessageId()).
  const onScrollDownClick = useEvent(() => {
    setUnreadBelow(0)
    if (isRealChat && !win.reachedBottom) {
      atBottomRef.current = true; userScrolledUpRef.current = false
      pendingJumpSeq.current = null
      pinBottomNext.current = true
      void win.reloadNewest()
    } else {
      scrollToBottom()
    }
  })
  const scrollDownFab = (
    <ScrollDownFab show={showScrollDown} unreadBelow={unreadBelow} onClick={onScrollDownClick} />
  )

  // Sticky date-pill offset: below the floating header, plus the player plate
  // and the pinned-message bar when shown.
  const dateStickyTop = playerOffset + (pins.length > 0 && !search.open ? 122 : 66)
  // Stable callback for the memoized feed to open a channel post's discussion.
  const onOpenDiscussion = useEvent((postId: number, text?: string) => setDiscussion({ postId, post: { text } }))

  // Stable handlers for the extracted header/pinned bars so their memo holds
  // across the parent's transient re-renders.
  const onToggleInfo = useEvent(() => setInfoOpen((o) => !o))
  const onOpenHeaderMenu = useEvent((r: DOMRect) => setHeaderMenu({ top: r.bottom + 6, right: window.innerWidth - r.right }))
  const onSearchOpen = useEvent(() => search.setOpen(true))
  const onSearchClose = useEvent(() => search.setOpen(false))
  const onSearchClear = useEvent(() => search.setQuery(''))
  const onUnpin = useEvent((id: number) => { void managers.messages.unpin(numericChatId, id) })
  const onPickSearchResult = useEvent((seq: number) => { search.reset(); jumpToSeq(seq) })
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
  // Display-ready search hits (sender name + time resolved here) — memoized so the
  // header's memo only busts when results/peers actually change.
  const searchRows: SearchResultRow[] = useMemo(
    () =>
      search.results.map((m) => ({
        id: m.id,
        seq: m.seq,
        sender: m.senderId === meId ? 'Вы' : peers.get(m.senderId)?.displayName || chat.name,
        avatar: gradientFor(m.senderId),
        time: friendlyMsgTime(m.createdAt, lang),
        text: m.text ?? '',
        mediaId: m.mediaId ?? undefined,
        mediaType: m.type,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search.results, peers, meId, chat.name, lang],
  )

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
          searchOpen={search.open}
          searchQuery={search.query}
          searchResults={searchRows}
          onSearchChange={search.setQuery}
          onSearchOpen={onSearchOpen}
          onSearchClear={onSearchClear}
          onSearchClose={onSearchClose}
          onPickResult={onPickSearchResult}
          onBack={onBack}
          onToggleInfo={onToggleInfo}
          onOpenMenu={onOpenHeaderMenu}
        />

        <PinnedBar
          pins={pins}
          searchOpen={search.open}
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
          onPhotoVideo={isRealChat ? () => openPicker('image/*,video/*', false) : undefined}
          onFile={isRealChat ? () => openPicker('*/*', true) : undefined}
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
