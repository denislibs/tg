// src/components/conversation/ChatHeader.tsx
// The floating chat header (avatar + title/status + call/search/menu actions, with
// an animated search-mode swap). Extracted from ConversationView and memoized so
// transient parent state (composer text, context menu, media viewer) never
// re-renders it — only its own data (chat, presence/typing, search) does.
import { memo, useEffect, useState } from 'react'
import Text from '../../shared/ui/Text'
import IconButton from '../../shared/ui/IconButton'
import classNames from '../../shared/lib/classNames'
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
import s from './ChatHeader.module.scss'

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
          <span key={j} className={p.m ? s.match : undefined}>{p.t}</span>
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
    <span className={s.mediaPreview}>
      <TgIcon name={icon} size={16} color="var(--tg-textFaint)" style={{ flexShrink: 0 }} />
      <span className={s.mediaLabel}>
        {splitMatch(label, query).map((p, j) => (
          <span key={j} className={p.m ? s.match : undefined}>{p.t}</span>
        ))}
      </span>
    </span>
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

  const barTop = { top: `${16 + playerOffset}px` }

  return (
    <AnimatePresence initial={false}>
      {searchOpen ? (
        // ── Unified search card: input row + (growing) results list as ONE rounded
        //    surface. The list grows the card's height as you type. ──
        <motion.div
          key="search"
          className={classNames(s.bar, s.searchCard)}
          initial={{ opacity: 0, y: -6, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.985 }}
          transition={{ duration: DUR_IN, ease: EASE_STD }}
          style={{ ...barTop, transformOrigin: 'top center' }}
        >
          {/* input row (the "input" — the card grows out of it) */}
          <div className={s.searchInputRow}>
            <TgIcon name="search" size={22} color="var(--tg-textFaint)" />
            <input
              className={s.searchInput}
              autoFocus
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onSearchClose() } }}
              placeholder={t('Search')}
            />
            {searchQuery.trim() && searchResults.length > 0 && (
              <>
                <IconButton size="small" onClick={() => jumpTo(activeIdx - 1)} disabled={activeIdx <= 0} color="var(--tg-textFaint)">
                  <TgIcon name="up" />
                </IconButton>
                <IconButton size="small" onClick={() => jumpTo(activeIdx + 1)} disabled={activeIdx >= searchResults.length - 1} color="var(--tg-textFaint)">
                  <TgIcon name="down" />
                </IconButton>
              </>
            )}
            <IconButton size="small" onClick={() => { if (searchQuery) onSearchClear(); else onSearchClose() }} color="var(--tg-textFaint)">
              <TgIcon name="close" />
            </IconButton>
          </div>

          {/* results grow out of the input (height animates as you type) */}
          <AnimatePresence initial={false}>
            {searchQuery.trim() && (
              <motion.div
                key="results"
                className={s.resultsWrap}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: DUR_IN, ease: EASE_STD }}
              >
                <div className={s.divider} />
                <div className={s.resultsScroll}>
                  {searchResults.length === 0 ? (
                    <Text size={15} color="var(--tg-textSecondary)" className={s.noResults}>
                      {t('There were no results for')}{' '}
                      <span className={s.bold}>“{searchQuery}”</span>
                      {t('. Try a new search.')}
                    </Text>
                  ) : (
                    searchResults.map((r, i) => (
                      <div
                        key={r.id}
                        className={s.resultRow}
                        data-active={i === activeIdx || undefined}
                        onClick={() => { setActiveIdx(i); onPickResult(r.seq) }}
                      >
                        <Avatar background={r.avatar} text={r.sender.charAt(0)} size="sm" />
                        <div className={s.resultBody}>
                          <div className={s.resultTop}>
                            <Text noWrap size={14.5} weight={600} color="var(--tg-textPrimary)" className={s.resultName}>{r.sender}</Text>
                            <Text size={12} color="var(--tg-textFaint)" className={s.resultTime}>{r.time}</Text>
                          </div>
                          <div className={s.resultPreview}>
                            <ResultPreview row={r} query={searchQuery} />
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ) : (
        // ── Normal header: floating rounded pill ──
        <motion.div
          key="normal"
          className={classNames(s.bar, s.header)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR_IN, ease: EASE_STD }}
          style={barTop}
        >
          {onBack && (
            <IconButton onClick={onBack} color="var(--tg-textSecondary)" style={{ marginLeft: '-4px' }}>
              <TgIcon name="back" />
            </IconButton>
          )}
          <div className={s.peer} onClick={onToggleInfo}>
            <Avatar
              background={chat.avatar}
              text={chat.avatarText}
              emoji={chat.avatarEmoji}
              src={avatarSrc}
              size="sm"
              online={chat.online || peerOnline}
              ringColor="var(--tg-bubble)"
            />
            <div className={s.peerBody}>
              <div className={s.peerTitle}>
                <Text noWrap weight={500} size={16} color="var(--tg-textPrimary)" style={{ lineHeight: 1.2 }}>
                  {chat.name}
                </Text>
                {chat.verified && <VerifiedBadge size={18} />}
              </div>
              <Text noWrap size={13.5} color={typingActive || online ? 'var(--tg-accent)' : 'var(--tg-textSecondary)'} style={{ lineHeight: 1.2 }}>
                {typingActive && <TypingIndicator kind={typingKind} color="var(--tg-accent)" />}
                {typingActive ? typingText : status}
              </Text>
            </div>
          </div>
          {chat.type === 'private' && (
            <>
              <IconButton onClick={() => startCall(false)} color="var(--tg-textSecondary)">
                <TgIcon name="phone" />
              </IconButton>
              <IconButton onClick={() => startCall(true)} color="var(--tg-textSecondary)">
                <TgIcon name="videocamera" />
              </IconButton>
            </>
          )}
          <IconButton onClick={onSearchOpen} color="var(--tg-textSecondary)">
            <TgIcon name="search" />
          </IconButton>
          <IconButton onClick={(e) => onOpenMenu(e.currentTarget.getBoundingClientRect())} color="var(--tg-textSecondary)">
            <TgIcon name="more" />
          </IconButton>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default memo(ChatHeader)
