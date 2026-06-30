// src/components/messages/ChatFeed.tsx
// The chat message feed, extracted from ConversationView and memoized. It owns the
// per-day <section> sticky dividers, consecutive-message grouping (sticky avatar
// runs for incoming group chats), and the channel comments bar — and delegates
// each bubble to the memoized <MessageRow>. Because MessageRow is memo'd and the
// ConvMsg refs are stable, appending a message re-renders only the new row (plus
// the previous-last row whose group tail flips), not the whole list.
import { memo, type ReactNode } from 'react'
import { Box } from '@mui/material'
import Avatar from '../Avatar'
import CommentsBar from '../CommentsBar'
import { peerColor } from '../peerColor'
import { useLang } from '../../i18n'
import { startOfDayMs, dayLabel } from '../../core/dayLabel'
import MessageRow, { type FeedFns } from './MessageRow'
import type { ConvMsg } from '../../data'
import type { Message } from '../../core/models'

export interface ChatFeedProps {
  msgs: ConvMsg[]
  winMsgs: Message[]
  isRealChat: boolean
  isGroup: boolean
  discussionsEnabled: boolean
  commentCounts: Map<number, number>
  highlightSeq: number | null
  selecting: boolean
  selected: Set<number>
  ladderActive: boolean
  // top offset for the sticky date pill (header + player plate + pinned bar)
  dateStickyTop: number
  feedFns: FeedFns
  onOpenDiscussion: (postId: number, text?: string) => void
}

function ChatFeed({
  msgs, winMsgs, isRealChat, isGroup, discussionsEnabled, commentCounts,
  highlightSeq, selecting, selected, ladderActive, dateStickyTop,
  feedFns, onOpenDiscussion,
}: ChatFeedProps) {
  const [lang] = useLang()

  // Group consecutive incoming messages from one sender so a single sticky avatar
  // can ride the scroll alongside the whole run (tweb). Per-day sections: each
  // day's divider + its messages live in one wrapper, and the divider is
  // position:sticky WITHIN that wrapper — so it pins under the header while the day
  // is in view, then the next day's wrapper pushes it out (no two pills overlapping).
  const sections: { key: string; date: ReactNode | null; body: ReactNode[] }[] = []
  const startSection = (key: string, date: ReactNode | null) => { sections.push({ key, date, body: [] }) }
  const body = (): ReactNode[] => {
    if (!sections.length) startSection('sec-top', null)
    return sections[sections.length - 1].body
  }
  const dayPill = (key: string, label: ReactNode) => (
    <Box
      key={key}
      component="header"
      sx={{ display: 'flex', justifyContent: 'center', my: 1, position: 'sticky', top: `${dateStickyTop}px`, transition: 'top 0.22s ease', zIndex: 4, pointerEvents: 'none' }}
    >
      {/* Flat translucent capsule (tweb: .bubble.service .service-msg uses only a
          background-color — no backdrop-filter; blurring a sticky element re-samples
          the moving backdrop every scroll frame, which tanked FPS). */}
      <Box sx={{ px: 1.5, py: 0.4, borderRadius: '14px', background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 15, fontWeight: 500 }}>
        {label}
      </Box>
    </Box>
  )

  let buf: ReactNode[] = []
  let gm: { key: string; sender: string; senderId?: number; color: string } | null = null
  const flushGroup = () => {
    if (buf.length && gm) {
      const g = gm
      const rows = buf
      body().push(
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
            <Box
              onClick={g.senderId != null ? () => feedFns.openSender(g.senderId!, g.sender) : undefined}
              sx={{ position: 'sticky', bottom: '72px', width: 40, height: 40, cursor: g.senderId != null ? 'pointer' : 'default' }}
            >
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

  const authorOf = (x?: ConvMsg) => (!x || x.type === 'date' || x.type === 'service' ? null : x.out ? '__out__' : x.sender ?? '__in__')
  const groupBreak = (aIdx: number, bIdx: number): boolean => {
    const a = msgs[aIdx]
    const b = msgs[bIdx]
    if (!a || !b) return true
    if (authorOf(a) === null || authorOf(b) === null) return true
    if (authorOf(a) !== authorOf(b)) return true
    if (isRealChat) {
      const am = winMsgs[aIdx]
      const bm = winMsgs[bIdx]
      if (am && bm) {
        if (startOfDayMs(am.createdAt) !== startOfDayMs(bm.createdAt)) return true
        if (Math.abs(new Date(bm.createdAt).getTime() - new Date(am.createdAt).getTime()) > 121_000) return true
      }
    }
    return false
  }

  msgs.forEach((m, i) => {
    // Stable React key: prefer the optimistic clientId (survives the ack that
    // rewrites id/seq), else the backend message id, else the index (last resort).
    const k = m.clientId ?? (m.id != null ? `m-${m.id}` : `i-${i}`)
    // Real chats: inject a per-day date divider when the calendar day changes.
    if (isRealChat && winMsgs[i]) {
      const prevReal = i > 0 ? winMsgs[i - 1] : undefined
      if (i === 0 || (prevReal && startOfDayMs(winMsgs[i].createdAt) !== startOfDayMs(prevReal.createdAt))) {
        flushGroup()
        // Key the section by the DAY bucket, not the first-loaded message — so a
        // loadOlder prepend (which changes which message is first in the window)
        // doesn't change the section key and remount the whole day's bubbles.
        const dayKey = `day-${startOfDayMs(winMsgs[i].createdAt)}`
        startSection(dayKey, dayPill(dayKey, dayLabel(winMsgs[i].createdAt, lang)))
      }
    }
    if (m.type === 'date') {
      flushGroup()
      startSection(k, dayPill(k, m.text))
      return
    }

    if (m.type === 'service') {
      flushGroup()
      body().push(
        <Box key={k} sx={{ display: 'flex', justifyContent: 'center', my: 0.5 }}>
          <Box
            sx={{
              maxWidth: '80%',
              px: '0.625rem',
              py: '0.28125rem',
              borderRadius: '14px',
              background: 'rgba(0,0,0,0.45)',
              color: '#fff',
              fontSize: 14.5,
              fontWeight: 500,
              lineHeight: '19.5px',
              textAlign: 'center',
              wordBreak: 'break-word',
              whiteSpace: 'break-spaces',
              userSelect: 'none',
            }}
          >
            {m.text}
          </Box>
        </Box>,
      )
      return
    }

    const out = !!m.out
    const firstInGroup = groupBreak(i - 1, i)
    const lastInGroup = groupBreak(i, i + 1)
    // Open-chat ladder: only the first loaded batch animates (cascade from the
    // bottom up, capped). Live appends mount with ladderActive=false → plain insert.
    const ladderDelay = ladderActive ? Math.min(msgs.length - 1 - i, 12) * 0.03 : 0

    const row = (
      <MessageRow
        key={k}
        m={m}
        seq={isRealChat ? winMsgs[i]?.seq : undefined}
        out={out}
        firstInGroup={firstInGroup}
        lastInGroup={lastInGroup}
        selecting={selecting}
        isSelected={m.id != null && selected.has(m.id)}
        isHighlighted={isRealChat && highlightSeq != null && winMsgs[i]?.seq === highlightSeq}
        ladderActive={ladderActive}
        ladderDelay={ladderDelay}
        feedFns={feedFns}
      />
    )

    // route incoming group-chat runs through the sticky-avatar wrapper
    if (isGroup && !out && m.sender) {
      if (!gm || gm.sender !== m.sender || firstInGroup) {
        flushGroup()
        gm = { key: k, sender: m.sender, senderId: m.senderId, color: m.senderColor ?? peerColor(m.sender) }
      }
      buf.push(row)
    } else if (discussionsEnabled && lastInGroup) {
      // Channel post with discussions on: bubble + per-post "Комментарии (N)" bar.
      flushGroup()
      const postId = winMsgs[i]?.id ?? 0
      body().push(
        <Box key={`post-${k}`} sx={{ display: 'flex', flexDirection: 'column' }}>
          {row}
          {postId > 0 && (
            <Box sx={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' }}>
              <CommentsBar
                count={commentCounts.get(postId) ?? 0}
                onOpen={() => onOpenDiscussion(postId, m.text)}
              />
            </Box>
          )}
        </Box>,
      )
    } else {
      flushGroup()
      body().push(row)
    }
  })
  flushGroup()

  // Each section wraps its (sticky) date pill + that day's messages, so the pill
  // is bounded by its day and the next day pushes it out.
  return (
    <>
      {sections.map((sec) => (
        <Box key={sec.key} component="section" sx={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
          {sec.date}
          {sec.body}
        </Box>
      ))}
    </>
  )
}

export default memo(ChatFeed)
