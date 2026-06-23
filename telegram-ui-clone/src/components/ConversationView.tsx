import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Box, IconButton, InputBase, Typography, useMediaQuery, useTheme } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE, DUR } from '../motion'
import CallOutlined from '@mui/icons-material/CallOutlined'
import VideocamOutlined from '@mui/icons-material/VideocamOutlined'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import AttachFileRounded from '@mui/icons-material/AttachFileRounded'
import SentimentSatisfiedAltRounded from '@mui/icons-material/SentimentSatisfiedAltRounded'
import KeyboardVoiceRounded from '@mui/icons-material/KeyboardVoiceRounded'
import SendRounded from '@mui/icons-material/SendRounded'
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded'
import VolumeOffRounded from '@mui/icons-material/VolumeOffRounded'
import CardGiftcardRounded from '@mui/icons-material/CardGiftcardRounded'
import DoneRounded from '@mui/icons-material/DoneRounded'
import DoneAllRounded from '@mui/icons-material/DoneAllRounded'
import ReplyRounded from '@mui/icons-material/ReplyRounded'
import EditRounded from '@mui/icons-material/EditRounded'
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded'
import TranslateRounded from '@mui/icons-material/TranslateRounded'
import PushPinOutlined from '@mui/icons-material/PushPinOutlined'
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import KeyboardArrowDownRounded from '@mui/icons-material/KeyboardArrowDownRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined'
import Avatar from './Avatar'
import UserInfoPanel from './UserInfoPanel'
import HeaderMenu from './HeaderMenu'
import EmojiPicker from './EmojiPicker'
import AttachMenu from './AttachMenu'
import CallScreen from './CallScreen'
import RichText, { emojiOnlyCount } from './RichText'
import Emoji from './emoji/Emoji'
import MediaViewer from './MediaViewer'
import {
  MediaBubble,
  DocumentBubble,
  AudioBubble,
  RoundVideoBubble,
  WebPagePreview,
  BubbleTail,
} from './messages/MessageBubbles'
import type { Chat, ConvMsg, MsgStatus, MediaItem } from '../data'
import { useT } from '../i18n'
import { useSettings, useTimeFormatter } from '../settings'

const REACTIONS = ['❤️', '👍', '👎', '🔥', '🥰', '👏', '😁']

// tweb's exact bubbles-scrollable fade: a pure alpha mask on the scroll viewport
// (no blur, no colour) so messages simply fade out to a 0.24 floor behind the
// floating header/composer, eased iOS-style (cubic-bezier sampled at 0/.2/.4/.6/.8/1).
const FADE_TOP = 76 // clear the floating header
const FADE_BOTTOM = 84 // clear the floating composer
const FLOOR = 'rgba(255,255,255,0.24)'
const mix = (k: number) => `color-mix(in srgb, #000 ${k}%, ${FLOOR})`
const FEED_MASK = `linear-gradient(to bottom, ${FLOOR} 0, ${mix(8.6)} ${FADE_TOP * 0.2}px, ${mix(33.4)} ${FADE_TOP * 0.4}px, ${mix(66.6)} ${FADE_TOP * 0.6}px, ${mix(91.4)} ${FADE_TOP * 0.8}px, #000 ${FADE_TOP}px, #000 calc(100% - ${FADE_BOTTOM}px), ${mix(91.4)} calc(100% - ${FADE_BOTTOM * 0.8}px), ${mix(66.6)} calc(100% - ${FADE_BOTTOM * 0.6}px), ${mix(33.4)} calc(100% - ${FADE_BOTTOM * 0.4}px), ${mix(8.6)} calc(100% - ${FADE_BOTTOM * 0.2}px), ${FLOOR} 100%)`

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
const PEER_COLORS = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774']
function peerColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PEER_COLORS[h % PEER_COLORS.length]
}

// Standard easing/durations come from the central motion module
const EASE_STD = EASE
const DUR_IN = DUR.in
const DUR_OUT = DUR.out

function Ticks({ status, color }: { status?: MsgStatus; color: string }) {
  if (!status) return null
  const Icon = status === 'read' ? DoneAllRounded : DoneRounded
  return <Icon sx={{ fontSize: 16, color }} />
}

interface Props {
  chat: Chat
  onBack?: () => void
}

export default function ConversationView({ chat, onBack }: Props) {
  const t = useT()
  const theme = useTheme()
  const tg = theme.tg
  const mode = theme.palette.mode
  const { textSize } = useSettings()
  const fmtTime = useTimeFormatter()
  // On narrow screens the chat is full-width; give the header/feed/composer a
  // side gutter so the floating pills don't sit flush against the screen edges.
  const narrow = useMediaQuery('(max-width:900px)')
  const incomingBg = tg.bubble
  const isChannel = chat.type === 'channel'
  const isGroup = chat.type === 'group'
  const canType = !isChannel

  const [msgs, setMsgs] = useState<ConvMsg[]>(chat.messages ?? [])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [msgMenu, setMsgMenu] = useState<{ x: number; y: number; idx: number } | null>(null)
  const [reply, setReply] = useState<{ name: string; text: string; color: string } | null>(null)
  const [chatSearch, setChatSearch] = useState(false)
  const [chatSearchQuery, setChatSearchQuery] = useState('')
  const [viewerMedia, setViewerMedia] = useState<MediaItem | null>(null)
  const [headerMenu, setHeaderMenu] = useState<{ top: number; right: number } | null>(null)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [attachAnchor, setAttachAnchor] = useState<{ left: number; bottom: number } | null>(null)
  const [recording, setRecording] = useState(false)
  const [recSecs, setRecSecs] = useState(0)
  const [call, setCall] = useState<{ video: boolean } | null>(null)
  const recTimer = useRef<number | undefined>(undefined)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const startRec = () => {
    setRecording(true)
    setRecSecs(0)
    recTimer.current = window.setInterval(() => setRecSecs((s) => s + 1), 1000)
  }
  const stopRec = (sendIt: boolean) => {
    window.clearInterval(recTimer.current)
    setRecording(false)
    const secs = recSecs
    setRecSecs(0)
    if (!sendIt || secs < 1) return
    const waveform = Array.from({ length: 28 }, () => 0.25 + Math.random() * 0.75)
    setMsgs((prev) => [
      ...prev,
      { type: 'voice', out: true, time: nowTime(), status: 'sent', duration: fmtDur(secs), waveform },
    ])
    window.dispatchEvent(new Event('tg-send'))
    setTyping(true)
    window.setTimeout(() => {
      const r = replies[Math.floor(Math.random() * replies.length)]
      setMsgs((prev) => [...prev, { type: 'text', out: false, text: r, time: nowTime() }])
      setTyping(false)
    }, 1100 + Math.random() * 900)
  }
  useEffect(() => () => window.clearInterval(recTimer.current), [])

  // Show the "scroll to bottom" button once the user scrolls up away from the latest messages
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowScrollDown(dist > 240)
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [msgs])
  const scrollToBottom = () =>
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })

  const openMsgMenu = (e: React.MouseEvent, idx: number) => {
    e.preventDefault()
    setMsgMenu({
      x: Math.min(e.clientX, window.innerWidth - 250),
      y: Math.min(e.clientY, window.innerHeight - 470),
      idx,
    })
  }
  const startReply = () => {
    const m = msgMenu && msgs[msgMenu.idx]
    if (m && m.type !== 'date') {
      const name = m.out ? 'Дн' : m.sender ?? chat.name
      const color = m.out ? tg.accent : m.senderColor ?? peerColor(name)
      setReply({ name, text: m.text ?? m.emoji ?? '', color })
      inputRef.current?.focus()
    }
    setMsgMenu(null)
  }
  const msgMenuItems: { icon: ReactNode; label: string; danger?: boolean; onClick?: () => void }[] = [
    { icon: <ReplyRounded />, label: 'Reply', onClick: startReply },
    { icon: <EditRounded />, label: 'Edit' },
    { icon: <ContentCopyRounded />, label: 'Copy' },
    { icon: <TranslateRounded />, label: 'Translate' },
    { icon: <PushPinOutlined />, label: 'Pin' },
    { icon: <ReplyRounded sx={{ transform: 'scaleX(-1)' }} />, label: 'Forward' },
    { icon: <CheckCircleOutlineRounded />, label: 'Select' },
    { icon: <DoneAllRounded />, label: 'Nobody viewed' },
    { icon: <DeleteOutlineRounded />, label: 'Delete', danger: true },
  ]

  // reset + focus input when switching chats
  useEffect(() => {
    setMsgs(chat.messages ?? [])
    setInput('')
    setTyping(false)
    setInfoOpen(false)
    setChatSearch(false)
    setChatSearchQuery('')
    setReply(null)
    if (canType) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => window.clearTimeout(id)
    }
  }, [chat, canType])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // scroll after layout — content height isn't final synchronously on open
    let r2 = 0
    const r1 = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
      r2 = requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight
      })
    })
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
    }
  }, [msgs, typing])

  const send = () => {
    const text = input.trim()
    if (!text || !canType) return
    setMsgs((prev) => [
      ...prev,
      { type: 'text', out: true, text, time: nowTime(), status: 'sent', reply: reply ?? undefined },
    ])
    setInput('')
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

  const hasText = input.trim().length > 0

  // Floating "scroll to bottom" button (tweb .bubbles-go-down), shown above the composer
  const scrollDownFab = (
    <AnimatePresence>
      {showScrollDown && (
        <Box
          key="scroll-down"
          component={motion.div}
          onClick={scrollToBottom}
          whileTap={{ scale: 0.92 }}
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.34, 1.56, 0.64, 1] }}
          sx={{
            position: 'absolute',
            right: 0,
            top: -64,
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: tg.bubble,
            boxShadow:
              mode === 'dark' ? '0 2px 12px rgba(0,0,0,0.5)' : '0 2px 12px rgba(0,0,0,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: tg.textSecondary,
            zIndex: 7,
          }}
        >
          <KeyboardArrowDownRounded />
        </Box>
      )}
    </AnimatePresence>
  )

  return (
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
        {/* Header */}
        <Box
          sx={{
            position: 'absolute',
            top: '16px',
            left: 0,
            right: 0,
            zIndex: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            width: '100%',
            maxWidth: 688,
            mx: 'auto',
            px: 1.5,
            py: 0.5,
            height: 48,
            borderRadius: '24px',
            background: tg.bubble,
            boxShadow:
              mode === 'dark' ? '0 1px 6px -1px rgba(0,0,0,0.5)' : '0 1px 5px -1px rgba(0,0,0,0.16)',
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {chatSearch ? (
              <Box
                key="search"
                component={motion.div}
                initial={{ opacity: 0, x: 26 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 26 }}
                transition={{ duration: DUR_IN, ease: EASE_STD }}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}
              >
                <Avatar background={chat.avatar} text={chat.avatarText} emoji={chat.avatarEmoji} size={32} />
                <Box
                  sx={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    background: mode === 'dark' ? '#181818' : '#f0f0f2',
                    borderRadius: '9999px',
                    height: 38,
                    px: 1.5,
                  }}
                >
                  <SearchRoundedIcon sx={{ color: tg.textFaint, fontSize: 20 }} />
                  <InputBase
                    autoFocus
                    value={chatSearchQuery}
                    onChange={(e) => setChatSearchQuery(e.target.value)}
                    placeholder={t('Search')}
                    sx={{
                      flex: 1,
                      fontSize: 16,
                      color: tg.textPrimary,
                      '& input::placeholder': { color: tg.textFaint, opacity: 1 },
                    }}
                  />
                  <IconButton
                    size="small"
                    onClick={() => {
                      if (chatSearchQuery) setChatSearchQuery('')
                      else setChatSearch(false)
                    }}
                    sx={{ color: tg.textFaint }}
                  >
                    <CloseRounded fontSize="small" />
                  </IconButton>
                </Box>
                <IconButton sx={{ color: tg.textSecondary }}>
                  <CalendarMonthOutlined />
                </IconButton>
              </Box>
            ) : (
              <Box
                key="normal"
                component={motion.div}
                initial={{ opacity: 0, x: -26 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -26 }}
                transition={{ duration: DUR_IN, ease: EASE_STD }}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}
              >
                {onBack && (
                  <IconButton onClick={onBack} sx={{ color: tg.textSecondary, ml: -0.5 }}>
                    <ArrowBackRoundedIcon />
                  </IconButton>
                )}
                <Box
                  onClick={() => setInfoOpen((o) => !o)}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0, cursor: 'pointer' }}
                >
                  <Avatar
                    background={chat.avatar}
                    text={chat.avatarText}
                    emoji={chat.avatarEmoji}
                    size={40}
                    online={chat.online}
                    ringColor={tg.bubble}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography noWrap sx={{ fontWeight: 500, fontSize: 16, color: tg.textPrimary }}>
                      {chat.name}
                    </Typography>
                    <Typography
                      noWrap
                      sx={{
                        fontSize: 13.5,
                        color:
                          typing || chat.status === 'online' ? tg.accent : tg.textSecondary,
                      }}
                    >
                      {typing ? t('typing…') : chat.status ? t(chat.status) : ''}
                    </Typography>
                  </Box>
                </Box>
                {chat.type === 'private' && (
                  <>
                    <IconButton onClick={() => setCall({ video: false })} sx={{ color: tg.textSecondary }}>
                      <CallOutlined />
                    </IconButton>
                    <IconButton onClick={() => setCall({ video: true })} sx={{ color: tg.textSecondary }}>
                      <VideocamOutlined />
                    </IconButton>
                  </>
                )}
                <IconButton onClick={() => setChatSearch(true)} sx={{ color: tg.textSecondary }}>
                  <SearchRoundedIcon />
                </IconButton>
                <IconButton
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setHeaderMenu({ top: r.bottom + 6, right: window.innerWidth - r.right })
                  }}
                  sx={{ color: tg.textSecondary }}
                >
                  <MoreVertRoundedIcon />
                </IconButton>
              </Box>
            )}
          </AnimatePresence>
        </Box>

        {/* In-chat search "no results" dropdown */}
        <AnimatePresence initial={false}>
          {chatSearch && chatSearchQuery.trim() && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: DUR_IN, ease: EASE_STD }}
              style={{ overflow: 'hidden', position: 'absolute', top: 72, left: 0, right: 0, zIndex: 7, width: '100%', maxWidth: 688, margin: '0 auto' }}
            >
              <Box
                sx={{
                  background: tg.bubble,
                  borderRadius: '14px',
                  px: 2,
                  py: 2,
                  textAlign: 'center',
                }}
              >
                <Typography sx={{ fontSize: 15, color: tg.textSecondary }}>
                  {t('There were no results for')}{' '}
                  <Box component="span" sx={{ fontWeight: 700, color: tg.textPrimary }}>
                    “{chatSearchQuery}”
                  </Box>
                  {t('. Try a new search.')}
                </Typography>
              </Box>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Conversation — own scroll container, masked like tweb's bubbles-scrollable */}
        <Box
          ref={scrollRef}
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
            sx={{
              width: '100%',
              maxWidth: 688,
              px: 0.5,
              // push content to the bottom when short; clear the floating header/composer
              mt: 'auto',
              pt: `${FADE_TOP}px`,
              pb: `${FADE_BOTTOM}px`,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {(() => {
              // Group consecutive incoming messages from one sender so a single
              // sticky avatar can ride the scroll alongside the whole run (tweb).
              const nodes: ReactNode[] = []
              let buf: ReactNode[] = []
              let gm: { key: number; sender: string; color: string } | null = null
              const flushGroup = () => {
                if (buf.length && gm) {
                  const g = gm
                  const rows = buf
                  nodes.push(
                    <Box
                      key={`grp-${g.key}`}
                      sx={{ position: 'relative', display: 'flex', gap: '10px', alignItems: 'stretch' }}
                    >
                      <Box
                        sx={{
                          width: 40,
                          flexShrink: 0,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'flex-end',
                          // the last bubble carries a 6px group margin; match it so the
                          // avatar aligns to the bubble's bottom, not the margin's
                          pb: '6px',
                        }}
                      >
                        {/* pin above the floating composer (≈64px tall incl. its 16px offset) */}
                        <Box sx={{ position: 'sticky', bottom: '72px', width: 40, height: 40 }}>
                          <Avatar background={g.color} text={g.sender[0]} size={40} />
                        </Box>
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>{rows}</Box>
                    </Box>,
                  )
                }
                buf = []
                gm = null
              }
              msgs.forEach((m, i) => {
              if (m.type === 'date') {
                flushGroup()
                nodes.push(
                  <Box
                    key={i}
                    sx={{
                      display: 'flex',
                      justifyContent: 'center',
                      my: 1,
                      position: 'sticky',
                      top: 66,
                      zIndex: 4,
                      pointerEvents: 'none',
                    }}
                  >
                    <Box
                      sx={{
                        px: 1.5,
                        py: 0.4,
                        borderRadius: '14px',
                        background: 'rgba(0,0,0,0.45)',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)',
                        color: '#fff',
                        fontSize: 15,
                        fontWeight: 500,
                      }}
                    >
                      {m.text}
                    </Box>
                  </Box>,
                )
                return
              }

              if (m.type === 'service') {
                flushGroup()
                nodes.push(
                  <Box key={i} sx={{ display: 'flex', justifyContent: 'center', my: 0.5 }}>
                    <Box
                      sx={{
                        maxWidth: '80%',
                        px: 1.25,
                        py: 0.4,
                        borderRadius: '14px',
                        background: 'rgba(0,0,0,0.45)',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)',
                        color: '#fff',
                        fontSize: 14.5,
                        fontWeight: 500,
                        textAlign: 'center',
                      }}
                    >
                      {m.text}
                    </Box>
                  </Box>,
                )
                return
              }

              const out = !!m.out
              const tickColor = 'rgba(255,255,255,0.85)'

              // Group consecutive messages from the same author (tweb: 2px within group, 6px between)
              const prev = msgs[i - 1]
              const next = msgs[i + 1]
              const authorKey = m.out ? '__out__' : m.sender ?? '__in__'
              const prevKey = prev && prev.type !== 'date' ? (prev.out ? '__out__' : prev.sender ?? '__in__') : null
              const nextKey = next && next.type !== 'date' ? (next.out ? '__out__' : next.sender ?? '__in__') : null
              const firstInGroup = prevKey !== authorKey
              const lastInGroup = nextKey !== authorKey
              // 1–3 emoji-only text -> render big (like a sticker), transparent bubble
              const bigEmoji = m.type === 'text' && m.text ? emojiOnlyCount(m.text) : 0

              const row = (
                <Box
                  key={i}
                  onContextMenu={(e) => openMsgMenu(e, i)}
                  sx={{
                    display: 'flex',
                    justifyContent: out ? 'flex-end' : 'flex-start',
                    mb: lastInGroup ? '6px' : '2px',
                  }}
                >
                  {m.type === 'sticker' || bigEmoji ? (
                    <Box sx={{ position: 'relative', display: 'inline-block', px: 0.5 }}>
                      <Box
                        sx={{
                          fontSize: bigEmoji ? (bigEmoji === 1 ? 56 : bigEmoji === 2 ? 46 : 38) : 64,
                          lineHeight: 1.1,
                          userSelect: 'none',
                          py: bigEmoji ? 0.25 : 0,
                        }}
                      >
                        {m.type === 'sticker' ? <Emoji e={m.emoji ?? ''} size={104} /> : m.text}
                      </Box>
                      <Box
                        sx={{
                          position: 'absolute',
                          right: 6,
                          bottom: 4,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.25,
                          px: 0.75,
                          py: 0.2,
                          borderRadius: '11px',
                          background: 'rgba(0,0,0,0.45)',
                        }}
                      >
                        <Typography sx={{ fontSize: 12.5, color: '#fff' }}>{fmtTime(m.time)}</Typography>
                        <Ticks status={m.status} color={tickColor} />
                      </Box>
                    </Box>
                  ) : m.type === 'voice' ? (
                    <Box
                      sx={{
                        position: 'relative',
                        maxWidth: 'min(320px, 82%)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.25,
                        px: 1.25,
                        py: 1,
                        background: out ? tg.accent : incomingBg,
                        color: out ? '#fff' : tg.textPrimary,
                        borderRadius: out
                          ? `15px 15px ${lastInGroup ? 0 : 5}px 15px`
                          : `15px 15px 15px ${lastInGroup ? 0 : 5}px`,
                      }}
                    >
                      {lastInGroup && <BubbleTail out={out} color={out ? tg.accent : incomingBg} />}
                      <Box
                        sx={{
                          width: 40,
                          height: 40,
                          flexShrink: 0,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: out ? 'rgba(255,255,255,0.22)' : tg.accent,
                          color: '#fff',
                          cursor: 'pointer',
                        }}
                      >
                        <PlayArrowRounded />
                      </Box>
                      <Box sx={{ minWidth: 150 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px', height: 22 }}>
                          {(m.waveform ?? []).map((h, wi) => (
                            <Box
                              key={wi}
                              sx={{
                                width: '2.5px',
                                flexShrink: 0,
                                borderRadius: '2px',
                                height: `${Math.round(6 + h * 16)}px`,
                                background: out ? 'rgba(255,255,255,0.75)' : tg.textFaint,
                              }}
                            />
                          ))}
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                          <Typography sx={{ fontSize: 12.5, color: out ? 'rgba(255,255,255,0.85)' : tg.textSecondary }}>
                            {m.duration}
                          </Typography>
                          <Box sx={{ flex: 1 }} />
                          <Typography sx={{ fontSize: 12, color: out ? 'rgba(255,255,255,0.8)' : tg.textFaint }}>
                            {fmtTime(m.time)}
                          </Typography>
                          <Ticks status={m.status} color={tickColor} />
                        </Box>
                      </Box>
                    </Box>
                  ) : m.type === 'photo' || m.type === 'video' || m.type === 'album' ? (
                    <MediaBubble
                      m={m}
                      out={out}
                      firstInGroup={firstInGroup}
                      lastInGroup={lastInGroup}
                      onOpen={(it) => setViewerMedia(it)}
                    />
                  ) : m.type === 'document' ? (
                    <DocumentBubble m={m} out={out} firstInGroup={firstInGroup} lastInGroup={lastInGroup} />
                  ) : m.type === 'audio' ? (
                    <AudioBubble m={m} out={out} firstInGroup={firstInGroup} lastInGroup={lastInGroup} />
                  ) : m.type === 'roundVideo' ? (
                    <RoundVideoBubble m={m} out={out} firstInGroup={firstInGroup} lastInGroup={lastInGroup} />
                  ) : (
                    <Box
                      sx={{
                        position: 'relative',
                        maxWidth: 'min(420px, 80%)',
                        display: 'flex',
                        flexDirection: 'column',
                        px: 1.25,
                        py: 0.65,
                        background: out ? tg.accent : incomingBg,
                        color: out ? '#fff' : tg.textPrimary,
                        borderRadius: out
                          ? `15px ${firstInGroup ? 15 : 5}px ${lastInGroup ? 0 : 5}px 15px`
                          : `${firstInGroup ? 15 : 5}px 15px 15px ${lastInGroup ? 0 : 5}px`,
                      }}
                    >
                      {lastInGroup && <BubbleTail out={out} color={out ? tg.accent : incomingBg} />}
                      {!out && m.sender && firstInGroup && (
                        <Typography sx={{ fontSize: 14, fontWeight: 600, color: m.senderColor ?? peerColor(m.sender) }}>
                          {m.sender}
                        </Typography>
                      )}
                      {m.reply && (
                        <Box
                          sx={{
                            mb: 0.5,
                            px: 1,
                            py: 0.5,
                            borderRadius: '6px',
                            borderLeft: `3px solid ${out ? '#fff' : m.reply.color ?? tg.accent}`,
                            background: out ? 'rgba(255,255,255,0.15)' : `${m.reply.color ?? tg.accent}1f`,
                          }}
                        >
                          <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 600, color: out ? '#fff' : m.reply.color ?? tg.accent }}>
                            {m.reply.name}
                          </Typography>
                          <Typography noWrap sx={{ fontSize: 13.5, color: out ? 'rgba(255,255,255,0.85)' : tg.textSecondary, maxWidth: 240 }}>
                            {m.reply.text}
                          </Typography>
                        </Box>
                      )}
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 0.75 }}>
                        <Typography component="span" sx={{ fontSize: textSize, lineHeight: 1.35 }}>
                          <RichText text={m.text ?? ''} linkColor={out ? '#fff' : tg.link} />
                        </Typography>
                        <Box
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 0.25,
                            ml: 'auto',
                            transform: 'translateY(2px)',
                          }}
                        >
                          <Typography
                            component="span"
                            sx={{
                              fontSize: 12,
                              color: out ? 'rgba(255,255,255,0.8)' : tg.textFaint,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {fmtTime(m.time)}
                          </Typography>
                          <Ticks status={m.status} color={tickColor} />
                        </Box>
                      </Box>
                      {m.webPage && (
                        <WebPagePreview wp={m.webPage} out={out} linkColor={out ? '#fff' : tg.link} />
                      )}
                    </Box>
                  )}
                </Box>
              )

              // route incoming group-chat runs through the sticky-avatar wrapper
              if (isGroup && !out && m.sender) {
                if (!gm || gm.sender !== m.sender) {
                  flushGroup()
                  gm = { key: i, sender: m.sender, color: m.senderColor ?? peerColor(m.sender) }
                }
                buf.push(row)
              } else {
                flushGroup()
                nodes.push(row)
              }
            })
              flushGroup()
              return nodes
            })()}

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
        {canType ? (
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
            {/* Composer container: reply section + input row in ONE box */}
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                background: tg.bubble,
                borderRadius: '24px',
                overflow: 'hidden',
                boxShadow:
                  mode === 'dark'
                    ? '0 1px 8px 1px rgba(0,0,0,0.35)'
                    : '0 1px 8px 1px rgba(0,0,0,0.12)',
              }}
            >
              {/* Animated reply bar (inside the container) */}
              <AnimatePresence initial={false}>
                {reply && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: DUR_OUT, ease: EASE_STD }}
                    style={{ overflow: 'hidden' }}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        px: 1.5,
                        py: 1,
                        background: `${reply.color}1f`,
                      }}
                    >
                      <ReplyRounded sx={{ color: reply.color, fontSize: 22 }} />
                      <Box sx={{ flex: 1, minWidth: 0, borderLeft: `2px solid ${reply.color}`, pl: 1.25 }}>
                        <Typography sx={{ fontSize: 14, fontWeight: 600, color: reply.color }}>
                          {t('Reply to')} {reply.name}
                        </Typography>
                        <Typography noWrap sx={{ fontSize: 14, color: tg.textSecondary }}>
                          {reply.text}
                        </Typography>
                      </Box>
                      <IconButton size="small" onClick={() => setReply(null)} sx={{ color: tg.textFaint }}>
                        <CloseRounded fontSize="small" />
                      </IconButton>
                    </Box>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Input row */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 48, pl: 0.5, pr: 0.5, py: 0.5 }}>
                {recording ? (
                  <>
                    <IconButton onClick={() => stopRec(false)} sx={{ width: 40, height: 40, color: '#ff5a5a' }}>
                      <DeleteOutlineRounded />
                    </IconButton>
                    <Box
                      component={motion.span}
                      animate={{ opacity: [1, 0.25, 1] }}
                      transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                      sx={{ width: 10, height: 10, borderRadius: '50%', background: '#ff3b30', flexShrink: 0, ml: 0.5 }}
                    />
                    <Typography sx={{ ml: 1.25, fontSize: 16, color: tg.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtDur(recSecs)}
                    </Typography>
                    <Typography sx={{ flex: 1, textAlign: 'center', fontSize: 14, color: tg.textFaint, pr: 1 }}>
                      {t('Recording…')}
                    </Typography>
                  </>
                ) : (
                  <>
                    <IconButton
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect()
                        setAttachAnchor({ left: r.left, bottom: window.innerHeight - r.top + 8 })
                      }}
                      sx={{ width: 40, height: 40, color: tg.textSecondary }}
                    >
                      <AttachFileRounded sx={{ transform: 'rotate(45deg)' }} />
                    </IconButton>
                    <InputBase
                      inputRef={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          send()
                        }
                      }}
                      placeholder={t('Message')}
                      sx={{
                        flex: 1,
                        fontSize: 16,
                        lineHeight: '21px',
                        color: tg.textPrimary,
                        '& input::placeholder': { color: tg.textFaint, opacity: 1 },
                      }}
                    />
                    <IconButton
                      onClick={() => setEmojiOpen((o) => !o)}
                      sx={{ width: 40, height: 40, color: emojiOpen ? tg.accent : tg.textSecondary }}
                    >
                      <SentimentSatisfiedAltRounded />
                    </IconButton>
                  </>
                )}
                {/* Mic / Send — 48×40 rounded pill inside the bar (1:1 with TG .btn-send) */}
                <Box
                  component={motion.div}
                  onClick={() => (hasText ? send() : recording ? stopRec(true) : startRec())}
                  whileTap={{ scale: 0.92 }}
                  sx={{
                    width: 48,
                    height: 40,
                    flexShrink: 0,
                    borderRadius: '20px',
                    background: tg.accentGradient,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={hasText || recording ? 'send' : 'mic'}
                      initial={{ scale: 0.5, opacity: 0.8 }}
                      animate={{ scale: [0.5, 1.1, 1], opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      transition={{ duration: 0.4, ease: 'easeInOut' }}
                      style={{ display: 'inline-flex' }}
                    >
                      {hasText || recording ? <SendRounded /> : <KeyboardVoiceRounded />}
                    </motion.span>
                  </AnimatePresence>
                </Box>
              </Box>
            </Box>
            <AnimatePresence>
              {emojiOpen && (
                <EmojiPicker
                  onPick={(em) => setInput((v) => (em === '\b' ? v.slice(0, -1) : v + em))}
                  onSticker={sendSticker}
                  onGif={sendGif}
                  onClose={() => setEmojiOpen(false)}
                />
              )}
            </AnimatePresence>
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
              <VolumeOffRounded sx={{ fontSize: 20, color: tg.textSecondary }} />
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
              <CardGiftcardRounded sx={{ color: tg.textSecondary }} />
            </Box>
          </Box>
        )}
      </Box>

      {/* Info panel (private / group / channel) */}
      <AnimatePresence>
        {infoOpen && <UserInfoPanel chat={chat} onClose={() => setInfoOpen(false)} />}
      </AnimatePresence>

      {/* Header "⋮" menu */}
      {headerMenu && (
        <HeaderMenu chat={chat} anchor={headerMenu} onClose={() => setHeaderMenu(null)} />
      )}

      {/* Attach menu */}
      {attachAnchor && <AttachMenu anchor={attachAnchor} onClose={() => setAttachAnchor(null)} />}

      {/* Media viewer (photos / videos / albums) */}
      {viewerMedia && (
        <MediaViewer
          media={{ gradient: viewerMedia.gradient, emoji: viewerMedia.emoji, title: chat.name }}
          onClose={() => setViewerMedia(null)}
        />
      )}

      {/* Call screen */}
      <AnimatePresence>
        {call && <CallScreen chat={chat} video={call.video} onClose={() => setCall(null)} />}
      </AnimatePresence>

      {/* Message context menu — reactions strip + actions */}
      {msgMenu &&
        createPortal(
          <>
            <Box
              onClick={() => setMsgMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMsgMenu(null)
              }}
              sx={{ position: 'fixed', inset: 0, zIndex: 2000 }}
            />
            <Box sx={{ position: 'fixed', top: msgMenu.y, left: msgMenu.x, zIndex: 2001, display: 'flex', flexDirection: 'column', gap: 1, transformOrigin: 'top left' }}>
              {/* Reactions */}
              <Box
                component={motion.div}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2, ease: EASE_STD }}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  alignSelf: 'flex-start',
                  px: 1,
                  py: 0.5,
                  borderRadius: '24px',
                  background: tg.menuBg,
                  backdropFilter: 'blur(40px)',
                  WebkitBackdropFilter: 'blur(40px)',
                  boxShadow: tg.menuShadow,
                }}
              >
                {REACTIONS.map((r) => (
                  <Box
                    key={r}
                    component={motion.div}
                    whileHover={{ scale: 1.25 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setMsgMenu(null)}
                    sx={{ fontSize: 24, lineHeight: 1, cursor: 'pointer', px: 0.25 }}
                  >
                    {r}
                  </Box>
                ))}
                <KeyboardArrowDownRounded sx={{ color: tg.textSecondary, fontSize: 22, ml: 0.25 }} />
              </Box>

              {/* Actions */}
              <Box
                component={motion.div}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2, ease: EASE_STD }}
                sx={{
                  minWidth: 220,
                  py: 0.75,
                  borderRadius: '12px',
                  background: tg.menuBg,
                  backdropFilter: 'blur(40px)',
                  WebkitBackdropFilter: 'blur(40px)',
                  boxShadow: tg.menuShadow,
                  transformOrigin: 'top left',
                }}
              >
                {msgMenuItems.map((it) => (
                  <Box
                    key={it.label}
                    onClick={() => (it.onClick ? it.onClick() : setMsgMenu(null))}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      px: 1.5,
                      py: 0.65,
                      mx: 0.5,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      '&:hover': { background: tg.hover },
                    }}
                  >
                    <Box sx={{ display: 'flex', color: it.danger ? '#ff595a' : tg.textSecondary, '& svg': { fontSize: 20 } }}>
                      {it.icon}
                    </Box>
                    <Typography sx={{ fontSize: 15, color: it.danger ? '#ff595a' : tg.textPrimary }}>
                      {t(it.label)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          </>,
          document.body
        )}
    </Box>
  )
}
