// src/components/conversation/ChatHeader.tsx
// The floating chat header (avatar + title/status + call/search/menu actions, with
// an animated search-mode swap). Extracted from ConversationView and memoized so
// transient parent state (composer text, context menu, media viewer) never
// re-renders it — only its own data (chat, presence/typing, search) does.
import { memo, useEffect, useState } from 'react'
import { Box, InputBase, Typography, useTheme } from '@mui/material'
import IconButton from '../../shared/ui/IconButton'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon, { type IconName } from '../TgIcon'
import Avatar from '../../shared/ui/Avatar'
import VerifiedBadge from '../VerifiedBadge'
import TypingIndicator from './TypingIndicator'
import { useCall } from '../call/CallProvider'
import { useManagers } from '../../core/hooks/useManagers'
import { useChatSearch } from '../../core/hooks/useChatSearch'
import { usePeers } from '../../core/hooks/usePeers'
import { useChatsStore } from '../../stores/chatsStore'
import { gradientFor } from '../../core/dialogToChat'
import { friendlyMsgTime } from '../../core/friendlyTime'
import { useT, useLang } from '../../i18n'
import { useMemo } from 'react'
import { EASE, DUR } from '../../motion'
import type { Chat } from '../../data'
import type { TypingKind } from '../../core/hooks/useTypingLabel'

const EASE_STD = EASE
const DUR_IN = DUR.in

// Split a preview string into runs, marking the parts that match the query so the
// result row can bold them (tweb shows the matched word dark, the rest grey).
function splitMatch(text: string, q: string): { t: string; m: boolean }[] {
  const query = q.trim()
  if (!query) return [{ t: text, m: false }]
  const lower = text.toLowerCase()
  const ql = query.toLowerCase()
  const out: { t: string; m: boolean }[] = []
  let i = 0
  while (i < text.length) {
    const idx = lower.indexOf(ql, i)
    if (idx < 0) { out.push({ t: text.slice(i), m: false }); break }
    if (idx > i) out.push({ t: text.slice(i, idx), m: false })
    out.push({ t: text.slice(idx, idx + query.length), m: true })
    i = idx + query.length
  }
  return out
}

// Preview line of a search result: text hits show the matched message text (with
// the query bolded); media hits show a type icon + the file name (fetched) or a
// type label — e.g. 🎵 song.mp3, 📄 report.pdf, 🖼 Фото.
function ResultPreview({ row, query }: { row: SearchResultRow; query: string }) {
  const managers = useManagers()
  const tg = useTheme().tg
  const { text, mediaId, mediaType } = row
  const isMedia = !text.trim() && mediaId != null
  // Only audio/document carry a meaningful file name worth fetching; the rest use
  // a static type label.
  const wantsName = isMedia && (mediaType === 'audio' || mediaType === 'document')
  const [meta, setMeta] = useState<{ fileName: string; mime: string } | null>(null)
  useEffect(() => {
    if (!wantsName || mediaId == null) return
    let alive = true
    void managers.media.meta(mediaId).then((m) => { if (alive) setMeta({ fileName: m.fileName || '', mime: m.mime || '' }) })
    return () => { alive = false }
  }, [wantsName, mediaId, managers])
  const fileName = meta?.fileName || ''

  if (!isMedia) {
    return (
      <>
        {splitMatch(text, query).map((p, j) => (
          <Box key={j} component="span" sx={p.m ? { color: tg.textPrimary, fontWeight: 600 } : undefined}>{p.t}</Box>
        ))}
      </>
    )
  }

  const byType: Record<string, { icon: IconName; label: string }> = {
    audio: { icon: 'music', label: fileName || 'Аудио' },
    document: { icon: 'document', label: fileName || 'Файл' },
    photo: { icon: 'image', label: 'Фото' },
    video: { icon: 'videocamera_filled', label: 'Видео' },
    roundVideo: { icon: 'videocamera_filled', label: 'Видеосообщение' },
    voice: { icon: 'microphone_filled', label: 'Голосовое сообщение' },
  }
  // The message type may be "document" while the file is actually audio/video/an
  // image (sent as a file) — the mime is the source of truth for the icon.
  const mime = meta?.mime ?? ''
  const kind = mime.startsWith('audio/') ? 'audio'
    : mime.startsWith('video/') ? 'video'
    : mime.startsWith('image/') ? 'photo'
    : (mediaType ?? '')
  const { icon, label } = byType[kind] ?? { icon: 'document' as IconName, label: fileName || 'Файл' }
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, verticalAlign: 'middle', minWidth: 0 }}>
      <TgIcon name={icon} size={16} color={tg.textFaint} style={{ flexShrink: 0 }} />
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {splitMatch(label, query).map((p, j) => (
          <Box key={j} component="span" sx={p.m ? { color: tg.textPrimary, fontWeight: 600 } : undefined}>{p.t}</Box>
        ))}
      </Box>
    </Box>
  )
}

// Display-ready in-chat search hit (sender name + time already resolved by the
// parent, so the header needs no peers/meId/lang knowledge).
export interface SearchResultRow {
  id: number
  seq: number
  sender: string
  avatar: string // gradient background for the sender's avatar
  time: string
  text: string
  mediaId?: number // for media hits: show a type icon + file name as the preview
  mediaType?: string // photo | video | audio | voice | document | roundVideo | …
}

export interface ChatHeaderProps {
  chat: Chat
  avatarSrc?: string
  peerOnline?: boolean
  typingActive: boolean
  typingText: string
  typingKind: TypingKind
  status: string
  online: boolean
  playerOffset: number
  // The only thing the header needs from the parent for search: jump the feed to a
  // result's seq (the scroll machine lives in useChatScroll). Everything else about
  // search — open state, query, the backend fetch, the result rows — the header owns.
  onJumpToSeq: (seq: number) => void
  onBack?: () => void
  onToggleInfo: () => void
  onOpenMenu: (rect: DOMRect) => void
}

function ChatHeader({
  chat, avatarSrc, peerOnline, typingActive, typingText, typingKind, status, online,
  playerOffset, onJumpToSeq, onBack, onToggleInfo, onOpenMenu,
}: ChatHeaderProps) {
  const theme = useTheme()
  const tg = theme.tg
  const mode = theme.palette.mode
  const t = useT()
  const [lang] = useLang()
  const { start: startCall } = useCall()
  const managers = useManagers()

  // The header owns in-chat search: open/query (single-sourced in searchStore, so the
  // pinned bar / sticky-date offset can read it), the debounced fetch, and the result
  // rows (sender name + time resolved here from peers/me/lang).
  const numericChatId = Number(chat.id)
  const isRealChat = Number.isFinite(numericChatId) && String(numericChatId) === chat.id
  const search = useChatSearch(numericChatId, isRealChat, managers)
  const searchOpen = search.open
  const searchQuery = search.query
  const onSearchChange = search.setQuery
  const onSearchOpen = () => search.setOpen(true)
  const onSearchClear = () => search.setQuery('')
  const onSearchClose = () => search.setOpen(false)
  const onPickResult = (seq: number) => { search.reset(); onJumpToSeq(seq) }

  const meId = useChatsStore((s) => s.meId)
  // usePeers keys its fetch on peersKey(ids) internally, so a fresh array each render is fine.
  const resultPeers = usePeers(useMemo(() => search.results.map((m) => m.senderId), [search.results]))
  const searchResults: SearchResultRow[] = useMemo(
    () =>
      search.results.map((m) => ({
        id: m.id,
        seq: m.seq,
        sender: m.senderId === meId ? 'Вы' : resultPeers.get(m.senderId)?.displayName || chat.name,
        avatar: gradientFor(m.senderId),
        time: friendlyMsgTime(m.createdAt, lang),
        text: m.text ?? '',
        mediaId: m.mediaId ?? undefined,
        mediaType: m.type,
      })),
    [search.results, resultPeers, meId, chat.name, lang],
  )

  // Active result for the ↑/↓ navigation in the search bar (tweb): the arrows
  // step through hits and jump the feed to each; the active row is highlighted.
  const [activeIdx, setActiveIdx] = useState(0)
  useEffect(() => { setActiveIdx(0) }, [searchQuery])
  const jumpTo = (i: number) => {
    const n = Math.max(0, Math.min(searchResults.length - 1, i))
    setActiveIdx(n)
    const r = searchResults[n]
    if (r) onPickResult(r.seq)
  }

  // The search card is one continuous surface: the input is its top, the results
  // grow out below within the same rounded box (white on light, grey on dark, with
  // a soft shadow) — tweb.
  const searchBg = mode === 'dark' ? '#2c2c2e' : '#ffffff'
  const cardShadow = mode === 'dark' ? '0 6px 28px -4px rgba(0,0,0,0.6)' : '0 6px 28px -6px rgba(0,0,0,0.22)'
  const cardDivider = mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'

  const barPos = {
    position: 'absolute' as const,
    top: `${16 + playerOffset}px`,
    transition: 'top 0.22s ease',
    left: 0,
    right: 0,
    zIndex: 6,
    width: '100%',
    maxWidth: 688,
    mx: 'auto',
  }

  return (
    <AnimatePresence initial={false}>
      {searchOpen ? (
        // ── Unified search card: input row + (growing) results list as ONE rounded
        //    surface. The list grows the card's height as you type. ──
        <Box
          key="search"
          component={motion.div}
          initial={{ opacity: 0, y: -6, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.985 }}
          transition={{ duration: DUR_IN, ease: EASE_STD }}
          style={{ transformOrigin: 'top center' }}
          sx={{ ...barPos, zIndex: 7, background: searchBg, borderRadius: '24px', overflow: 'hidden', boxShadow: cardShadow }}
        >
          {/* input row (the "input" — the card grows out of it) */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, height: 48 }}>
            <TgIcon name="search" size={22} color={tg.textFaint} />
            <InputBase
              autoFocus
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onSearchClose() } }}
              placeholder={t('Search')}
              sx={{ flex: 1, fontSize: 16, color: tg.textPrimary, '& input::placeholder': { color: tg.textFaint, opacity: 1 } }}
            />
            {searchQuery.trim() && searchResults.length > 0 && (
              <>
                <IconButton size="small" onClick={() => jumpTo(activeIdx - 1)} disabled={activeIdx <= 0} color={tg.textFaint}>
                  <TgIcon name="up" />
                </IconButton>
                <IconButton size="small" onClick={() => jumpTo(activeIdx + 1)} disabled={activeIdx >= searchResults.length - 1} color={tg.textFaint}>
                  <TgIcon name="down" />
                </IconButton>
              </>
            )}
            <IconButton size="small" onClick={() => { if (searchQuery) onSearchClear(); else onSearchClose() }} color={tg.textFaint}>
              <TgIcon name="close" />
            </IconButton>
          </Box>

          {/* results grow out of the input (height animates as you type) */}
          <AnimatePresence initial={false}>
            {searchQuery.trim() && (
              <Box
                key="results"
                component={motion.div}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: DUR_IN, ease: EASE_STD }}
                sx={{ overflow: 'hidden' }}
              >
                <Box sx={{ borderTop: `1px solid ${cardDivider}` }} />
                <Box sx={{ maxHeight: '60vh', overflowY: 'auto' }}>
                  {searchResults.length === 0 ? (
                    <Typography sx={{ fontSize: 15, color: tg.textSecondary, px: 2, py: 2, textAlign: 'center' }}>
                      {t('There were no results for')}{' '}
                      <Box component="span" sx={{ fontWeight: 700, color: tg.textPrimary }}>“{searchQuery}”</Box>
                      {t('. Try a new search.')}
                    </Typography>
                  ) : (
                    searchResults.map((r, i) => (
                      <Box
                        key={r.id}
                        onClick={() => { setActiveIdx(i); onPickResult(r.seq) }}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 0.75, cursor: 'pointer', background: i === activeIdx ? tg.hover : 'transparent', '&:hover': { background: tg.hover } }}
                      >
                        <Avatar background={r.avatar} text={r.sender.charAt(0)} size="sm" />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                            <Typography noWrap sx={{ flex: 1, fontSize: 14.5, fontWeight: 600, color: tg.textPrimary }}>{r.sender}</Typography>
                            <Typography sx={{ fontSize: 12, color: tg.textFaint, flexShrink: 0 }}>{r.time}</Typography>
                          </Box>
                          <Typography noWrap component="div" sx={{ fontSize: 14, color: tg.textSecondary, mt: 0.1 }}>
                            <ResultPreview row={r} query={searchQuery} />
                          </Typography>
                        </Box>
                      </Box>
                    ))
                  )}
                </Box>
              </Box>
            )}
          </AnimatePresence>
        </Box>
      ) : (
        // ── Normal header: floating rounded pill ──
        <Box
          key="normal"
          component={motion.div}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR_IN, ease: EASE_STD }}
          sx={{
            ...barPos,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 0.5,
            py: 0.5,
            height: 48,
            borderRadius: '24px',
            background: tg.bubble,
            boxShadow: mode === 'dark' ? '0 1px 6px -1px rgba(0,0,0,0.5)' : '0 1px 5px -1px rgba(0,0,0,0.16)',
          }}
        >
          {onBack && (
            <IconButton onClick={onBack} color={tg.textSecondary} style={{ marginLeft: '-4px' }}>
              <TgIcon name="back" />
            </IconButton>
          )}
          <Box onClick={onToggleInfo} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0, cursor: 'pointer' }}>
            <Avatar
              background={chat.avatar}
              text={chat.avatarText}
              emoji={chat.avatarEmoji}
              src={avatarSrc}
              size="sm"
              online={chat.online || peerOnline}
              ringColor={tg.bubble}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 500, fontSize: 16, lineHeight: 1.2, color: tg.textPrimary }}>
                  {chat.name}
                </Typography>
                {chat.verified && <VerifiedBadge size={18} />}
              </Box>
              <Typography noWrap sx={{ fontSize: 13.5, lineHeight: 1.2, color: typingActive || online ? tg.accent : tg.textSecondary }}>
                {typingActive && <TypingIndicator kind={typingKind} color={tg.accent} />}
                {typingActive ? typingText : status}
              </Typography>
            </Box>
          </Box>
          {chat.type === 'private' && (
            <>
              <IconButton onClick={() => startCall(false)} color={tg.textSecondary}>
                <TgIcon name="phone" />
              </IconButton>
              <IconButton onClick={() => startCall(true)} color={tg.textSecondary}>
                <TgIcon name="videocamera" />
              </IconButton>
            </>
          )}
          <IconButton onClick={onSearchOpen} color={tg.textSecondary}>
            <TgIcon name="search" />
          </IconButton>
          <IconButton onClick={(e) => onOpenMenu(e.currentTarget.getBoundingClientRect())} color={tg.textSecondary}>
            <TgIcon name="more" />
          </IconButton>
        </Box>
      )}
    </AnimatePresence>
  )
}

export default memo(ChatHeader)
