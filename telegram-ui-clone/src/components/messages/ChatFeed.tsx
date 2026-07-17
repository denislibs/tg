// src/components/messages/ChatFeed.tsx
// The chat message feed, extracted from ConversationView and memoized. It owns the
// per-day <section> sticky dividers, consecutive-message grouping (sticky avatar
// runs for incoming group chats), and the channel comments bar — and delegates
// each bubble to the memoized <MessageRow>. Because MessageRow is memo'd and the
// ConvMsg refs are stable, appending a message re-renders only the new row (plus
// the previous-last row whose group tail flips), not the whole list.
import { memo, type ReactNode } from 'react'
import Avatar from '../../shared/ui/Avatar'
import CommentsBar from '../CommentsBar'
import { peerColor } from '../peerColor'
import { useLang } from '../../i18n'
import { startOfDayMs, dayLabel } from '../../core/dayLabel'
import MessageRow, { type FeedFns } from './MessageRow'
import type { ChatAutoDownload } from '../../core/hooks/useChatAutoDownload'
import type { ConvMsg } from '../../data'
import type { Message } from '../../core/models'
import s from './ChatFeed.module.scss'

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
  // Автозагрузка медиа для этого чата (tweb chat.autoDownload)
  autoDownload?: ChatAutoDownload
  onOpenDiscussion: (postId: number, text?: string) => void
}

function ChatFeed({
  msgs, winMsgs, isRealChat, isGroup, discussionsEnabled, commentCounts,
  highlightSeq, selecting, selected, ladderActive, dateStickyTop,
  feedFns, autoDownload, onOpenDiscussion,
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
  // Flat translucent capsule (tweb .bubble.service .service-msg — только
  // background-color, без backdrop-filter: блюр sticky-элемента пересэмплирует
  // движущийся фон каждый кадр скролла и роняет FPS).
  const dayPill = (key: string, label: ReactNode) => (
    <header key={key} className={s.dayPill} style={{ top: `${dateStickyTop}px` }}>
      <div className={s.pill}>{label}</div>
    </header>
  )

  let buf: ReactNode[] = []
  let gm: { key: string; sender: string; senderId?: number; color: string } | null = null
  const flushGroup = () => {
    if (buf.length && gm) {
      const g = gm
      const rows = buf
      body().push(
        <div key={`grp-${g.key}`} className={s.group}>
          <div className={s.groupAvatarCol}>
            <div
              className={s.groupAvatar}
              onClick={g.senderId != null ? () => feedFns.openSender(g.senderId!, g.sender) : undefined}
              style={{ cursor: g.senderId != null ? 'pointer' : 'default' }}
            >
              <Avatar background={g.color} text={g.sender[0]} size="sm" />
            </div>
          </div>
          <div className={s.groupBody}>{rows}</div>
        </div>,
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

  // Альбомы (Telegram grouped_id): подряд идущие фото/видео одного отправителя
  // с одинаковым groupedId рендерятся ОДНИМ грид-баблом. Пре-пасс собирает
  // прогоны: startIdx → индексы; не-стартовые индексы пропускаются в цикле.
  const isAlbumMedia = (x: ConvMsg) => !!x.groupedId && x.mediaId != null && (x.type === 'photo' || x.type === 'video')
  const albumRuns = new Map<number, number[]>()
  const inAlbumTail = new Set<number>()
  for (let i = 0; i < msgs.length; ) {
    const m = msgs[i]
    if (!isAlbumMedia(m)) { i++; continue }
    const run = [i]
    let j = i + 1
    while (j < msgs.length && isAlbumMedia(msgs[j]) && msgs[j].groupedId === m.groupedId && !!msgs[j].out === !!m.out) {
      run.push(j); j++
    }
    if (run.length > 1) {
      albumRuns.set(i, run)
      for (const idx of run.slice(1)) inAlbumTail.add(idx)
    }
    i = j
  }
  // Сводный ConvMsg альбома: подпись — первое сообщение с текстом, время/статус
  // — последнего элемента (id первого — для data-mid/меню).
  const albumMsgOf = (run: number[]): ConvMsg => {
    const items = run.map((idx) => msgs[idx])
    const first = items[0]
    const last = items[items.length - 1]
    const captioned = items.find((x) => x.text)
    return {
      ...first,
      type: 'album',
      albumItems: items,
      text: captioned?.text ?? '',
      entities: captioned?.entities,
      time: last.time,
      status: items.some((x) => x.status === 'sending') ? 'sending' : last.status,
      mediaId: undefined,
    }
  }

  msgs.forEach((m, i) => {
    if (inAlbumTail.has(i)) return // элемент альбома — отрисован в сводном бабле
    const albumRun = albumRuns.get(i)
    if (albumRun) m = albumMsgOf(albumRun)
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
        <div key={k} className={s.service}>
          <div className={`${s.pill} ${s.serviceMsg}`}>{m.text}</div>
        </div>,
      )
      return
    }

    const out = !!m.out
    // Для альбома «конец группы» считается от последнего элемента прогона.
    const endIdx = albumRun ? albumRun[albumRun.length - 1] : i
    const firstInGroup = groupBreak(i - 1, i)
    const lastInGroup = groupBreak(endIdx, endIdx + 1)
    // Open-chat ladder: only the first loaded batch animates (cascade from the
    // bottom up, capped). Live appends mount with ladderActive=false → plain insert.
    const ladderDelay = ladderActive ? Math.min(msgs.length - 1 - i, 12) * 0.03 : 0

    // Channel post with discussions on: the "N комментариев" replies-footer is
    // attached to the bottom of the post bubble (tweb .replies-footer), not a
    // detached card — so it's passed as a footer slot into the bubble itself.
    const postId = discussionsEnabled && lastInGroup ? (winMsgs[i]?.id ?? 0) : 0
    const footer =
      postId > 0 ? (
        <CommentsBar count={commentCounts.get(postId) ?? 0} onOpen={() => onOpenDiscussion(postId, m.text)} />
      ) : undefined

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
        autoDownload={autoDownload}
        albumSelectedKey={
          albumRun
            ? albumRun.map((idx) => msgs[idx].id).filter((id) => id != null && selected.has(id)).join(',')
            : undefined
        }
        footer={footer}
      />
    )

    // route incoming group-chat runs through the sticky-avatar wrapper
    if (isGroup && !out && m.sender) {
      if (!gm || gm.sender !== m.sender || firstInGroup) {
        flushGroup()
        gm = { key: k, sender: m.sender, senderId: m.senderId, color: m.senderColor ?? peerColor(m.sender) }
      }
      buf.push(row)
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
        <section key={sec.key} className={s.section}>
          {sec.date}
          {sec.body}
        </section>
      ))}
    </>
  )
}

export default memo(ChatFeed)
