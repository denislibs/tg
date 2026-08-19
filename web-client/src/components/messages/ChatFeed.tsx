// src/components/messages/ChatFeed.tsx
// The chat message feed, extracted from Chat and memoized. It owns the
// per-day <section> sticky dividers, consecutive-message grouping (sticky avatar
// runs for incoming group chats), and the channel comments bar — and delegates
// each bubble to the memoized <MessageRow>. Because MessageRow is memo'd and the
// ConvMsg refs are stable, appending a message re-renders only the new row (plus
// the previous-last row whose group tail flips), not the whole list.
import { memo, useRef, useState, type ReactNode } from 'react'
import { useManagers } from '../../core/hooks/useManagers'
import Avatar from '../../shared/ui/Avatar'
import CommentsBar from '../CommentsBar'
import { peerColor } from '../peerColor'
import { gradientFor } from '../../core/dialogToChat'
import { useLang, useT } from '../../i18n'
import { startOfDayMs, dayLabel } from '../../core/format/dayLabel'
import { serviceMsgSegs, type ServiceSeg } from '../../core/serviceMsg'
import { useMediaUrl } from '../../core/hooks/useMediaUrl'
import MessageRow, { type FeedFns } from './MessageRow'
import type { ChatAutoDownload } from '../../core/hooks/useChatAutoDownload'
import type { ConvMsg } from '../../data'
import type { Message } from '../../core/models'
import type { CommentReplier } from '../../core/managers/channelsManager'
import classNames from '../../shared/lib/classNames'
import s from './ChatFeed.module.scss'

export interface ChatFeedProps {
  msgs: ConvMsg[]
  winMsgs: Message[]
  isRealChat: boolean
  isGroup: boolean
  /** можно ли ставить быструю реакцию по ховеру бабла (tweb: не в «Избранном») */
  canQuickReact: boolean
  discussionsEnabled: boolean
  commentCounts: Map<number, number>
  /** авторы последних комментариев по посту — стек аватаров в футере */
  commentRepliers: Map<number, CommentReplier[]>
  highlightSeq: number | null
  /** seq первого непрочитанного входящего — перед ним рисуется плашка
   * «Непрочитанные сообщения» (tweb is-first-unread); null — плашки нет */
  unreadDividerSeq: number | null
  selecting: boolean
  selected: Set<number>
  /** ключ дня прилипшей даты (tweb is-sticky) — считает Chat по скроллу */
  stickyDateKey: string | null
  feedFns: FeedFns
  // Автозагрузка медиа для этого чата (tweb chat.autoDownload)
  autoDownload?: ChatAutoDownload
  onOpenDiscussion: (postId: number, text?: string) => void
}

function ChatFeed({
  msgs, winMsgs, isRealChat, isGroup, canQuickReact, discussionsEnabled, commentCounts, commentRepliers,
  highlightSeq, unreadDividerSeq, selecting, selected, stickyDateKey,
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
  // tweb вешает на колонку чата `can-click-date` и по клику на дату-разделитель
  // открывает пикер (bubbles.ts:3058-3090) — у нас клик прокидывается наверх.
  // Дата-разделитель — бабл tweb `.bubble.service.is-date > .bubble-content >
  // .service-msg > span.i18n` (живой DOM §3, «service date»): обёртки
  // .bubble-content-wrapper у него НЕТ, в отличие от сервисных экшен-баблов.
  // Sticky и его top задаёт _chatBubble.scss (top: --chat-padding-top + overflow);
  // инлайн-top оставлен как страховка, пока --chat-padding-top не владеет фазой 3.
  // Клик по дате открывает пикер — в tweb он висит на .bubble-content под
  // классом `.can-click-date` на колонке чата (_chatBubble.scss:511-514).
  const dayPill = (key: string, label: ReactNode, dayMs: number) => (
    <div
      key={key}
      data-date={key}
      // tweb: прилипшая дата помечается `is-sticky` (у нас его считает Chat по
      // скроллу и отдаёт сюда, чтобы React не стирал императивный класс)
      className={classNames('bubble', 'service', 'is-date', stickyDateKey === key ? 'is-sticky' : '')}
    >
      <div
        className="bubble-content"
        onClick={isRealChat ? () => feedFns.openDatePicker(dayMs) : undefined}
      >
        <div className="service-msg">
          <span className="i18n">{label}</span>
        </div>
      </div>
    </div>
  )

  let buf: ReactNode[] = []
  let gm: { key: string; sender: string; senderId?: number; color: string } | null = null
  const flushGroup = () => {
    if (buf.length && gm) {
      const g = gm
      const rows = buf
      // Группа подряд идущих сообщений одного автора — дерево tweb
      // (_chatBubble.scss:45-88): контейнер аватара абсолютный, column-reverse,
      // сам аватар sticky и прижат к низу (`bottom: --chat-padding-bottom + …`),
      // а баблы лежат прямо в .bubbles-group без промежуточной колонки.
      body().push(
        <div key={`grp-${g.key}`} className="bubbles-group">
          {/* Аватар — САМ узел .avatar несёт `bubbles-group-avatar user-avatar`
              (tweb bubbleGroups.ts:137-146: контейнер без стилей, sticky/scale
              висят на самом аватаре). Клик по нему — открыть профиль. */}
          <div className="bubbles-group-avatar-container">
            <Avatar
              className="bubbles-group-avatar user-avatar"
              background={g.senderId != null ? gradientFor(g.senderId) : g.color}
              text={g.sender[0]}
              size="sm"
              onClick={g.senderId != null ? () => feedFns.openSender(g.senderId!, g.sender) : undefined}
            />
          </div>
          {rows}
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
  // Альбом группируется и во время аплоада (mediaId ещё нет — есть localUrl).
  const isAlbumMedia = (x: ConvMsg) => !!x.groupedId && (x.mediaId != null || !!x.localUrl) && (x.type === 'photo' || x.type === 'video')
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
        const dayMs = startOfDayMs(winMsgs[i].createdAt)
        const dayKey = `day-${dayMs}`
        startSection(dayKey, dayPill(dayKey, dayLabel(winMsgs[i].createdAt, lang), dayMs))
      }
    }
    // Граница «Непрочитанные сообщения» — не отдельный узел, а модификатор
    // самого бабла (tweb bubbles.ts:11609 `is-first-unread` + ::before на всю
    // ширину ленты, _chatBubble.scss:238-258). Текст берётся из
    // --unread-messages-text (ставит Chat из i18n).
    const isFirstUnread = isRealChat && unreadDividerSeq != null && winMsgs[i]?.seq === unreadDividerSeq
    if (isFirstUnread) flushGroup()
    if (m.type === 'date') {
      flushGroup()
      // у служебной дата-записи абсолютное время лежит в createdAt (time — «ЧЧ:ММ»)
      startSection(k, dayPill(k, m.text, m.createdAt ? startOfDayMs(m.createdAt) : Date.now()))
      return
    }

    if (m.type === 'service') {
      flushGroup()
      // Предложение фото профиля: получателю (не out, не принято) под превью —
      // кнопка «Установить фото» (tweb bubble-service-media-button).
      const canAccept = m.photoSuggestion != null && !m.out && !m.photoSuggestion.accepted && m.id != null
      // Фразу собираем из СЫРОГО JSON-экшена (winMsgs — тот же индекс, что и
      // msgs): в ConvMsg.text он уже сплющен в строку, а узлы .peer-title /
      // i[data-saved-from] нужны структурой. Демо-лента без winMsgs — строкой.
      const segs = serviceMsgSegs((isRealChat && winMsgs[i]?.text) || m.text || '', m.out)
      const ts = m.createdAt ? Math.floor(new Date(m.createdAt).getTime() / 1000) : undefined
      // Сервисный бабл tweb: `.bubble.service > .bubble-content-wrapper >
      // .bubble-content > .service-msg > span.i18n` (живой DOM §3, «service action
      // bubble») — в отличие от дата-разделителя обёртка тут есть. data-mid/
      // data-peer-id/data-timestamp несёт сам .bubble.
      body().push(
        <div
          key={k}
          className="bubble service is-group-first is-group-last"
          data-mid={m.id}
          data-peer-id={m.peerId}
          data-timestamp={Number.isFinite(ts) ? ts : undefined}
        >
          <div className="bubble-content-wrapper">
            <div className="bubble-content">
              <div className="service-msg">
                <span className="i18n">
                  {segs.map((sg, si) => serviceSeg(sg, si, m.peerId, feedFns))}
                </span>
              </div>
              {m.mediaId != null && <ServicePhoto mediaId={m.mediaId} onOpen={feedFns.openLightbox} />}
              {canAccept && <AcceptSuggestButton msgId={m.id!} />}
            </div>
          </div>
        </div>,
      )
      return
    }

    const out = !!m.out
    // Для альбома «конец группы» считается от последнего элемента прогона.
    const endIdx = albumRun ? albumRun[albumRun.length - 1] : i
    const firstInGroup = groupBreak(i - 1, i)
    const lastInGroup = groupBreak(endIdx, endIdx + 1)

    // Channel post with discussions on: the "N комментариев" replies-footer is
    // attached to the bottom of the post bubble (tweb .replies-footer), not a
    // detached card — so it's passed as a footer slot into the bubble itself.
    const postId = discussionsEnabled && lastInGroup ? (winMsgs[i]?.id ?? 0) : 0
    const footer =
      postId > 0 ? (
        <CommentsBar
          count={commentCounts.get(postId) ?? 0}
          recent={commentRepliers.get(postId)}
          onOpen={() => onOpenDiscussion(postId, m.text)}
        />
      ) : undefined

    const row = (
      <MessageRow
        canSeeReactionList={!isGroup}
        canQuickReact={canQuickReact}
        key={k}
        m={m}
        seq={isRealChat ? winMsgs[i]?.seq : undefined}
        out={out}
        firstInGroup={firstInGroup}
        lastInGroup={lastInGroup}
        selecting={selecting}
        isSelected={m.id != null && selected.has(m.id)}
        isHighlighted={isRealChat && highlightSeq != null && winMsgs[i]?.seq === highlightSeq}
        // Имя в бабле показывается там же, где раньше решал MessageContent:
        // групповой чат, входящее, первое сообщение серии.
        showName={isGroup && !out && !!m.sender && firstInGroup}
        isChannel={discussionsEnabled}
        isFirstUnread={isFirstUnread}
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
        <section key={sec.key} className="bubbles-date-group">
          {sec.date}
          {sec.body}
        </section>
      ))}
    </>
  )
}

// Кусок фразы сервисной пилюли узлом (tweb messageActionTextNewUnsafe строит её
// из элементов, не из строки): имя — `span.peer-title` с data-peer-id (клик →
// профиль, bubbles.ts:3360-3395), ссылка на сообщение — `i[data-saved-from]`
// (клик → переход к нему, там же). Остальное — обычный текст.
function serviceSeg(sg: ServiceSeg, key: number, peerId: number | undefined, feedFns: FeedFns) {
  if (sg.kind === 'peer') {
    const peerId = sg.peerId
    return (
      <span
        key={key}
        className="peer-title"
        data-peer-id={peerId}
        onClick={peerId != null ? () => feedFns.openSender(peerId, sg.text) : undefined}
      >
        {sg.text}
      </span>
    )
  }
  if (sg.kind === 'msg') {
    const seq = sg.seq
    return (
      <i
        key={key}
        data-saved-from={sg.msgId != null ? `${peerId ?? 0}_${sg.msgId}` : undefined}
        onClick={seq != null ? () => feedFns.jumpToSeq(seq) : undefined}
      >
        {sg.text}
      </i>
    )
  }
  return sg.text
}

// Круглая миниатюра нового фото группы под сервисной пилюлей (tweb bubble
// service .bubble-service-media-avatar-container: аватар-кружок, клик → просмотр).
function ServicePhoto({ mediaId, onOpen }: { mediaId: number; onOpen: FeedFns['openLightbox'] }) {
  // Task 7: URL — воркерным конвейером (useMediaUrl), синхронно из зеркала при
  // повторном рендере.
  const url = useMediaUrl(mediaId)
  const ref = useRef<HTMLDivElement>(null)
  if (!url) return null
  return (
    <div
      ref={ref}
      className={s.servicePhoto}
      onClick={() => ref.current && onOpen(mediaId, ref.current)}
      role="button"
      tabIndex={0}
    >
      <img src={url} alt="" loading="lazy" decoding="async" />
    </div>
  )
}

// Кнопка «Установить фото» под предложенным фото профиля (tweb
// bubble-service-media-button). Принятие ставит фото аватаром получателя; статус
// прилетает через edit_message и прячет кнопку на всех устройствах.
function AcceptSuggestButton({ msgId }: { msgId: number }) {
  const t = useT()
  const managers = useManagers()
  const [busy, setBusy] = useState(false)
  const accept = async () => {
    if (busy) return
    setBusy(true)
    try {
      await managers.contacts.acceptPhotoSuggestion(msgId)
    } catch {
      setBusy(false)
    }
  }
  return (
    <button className={s.serviceButton} onClick={accept} disabled={busy}>
      {t('Set Photo')}
    </button>
  )
}

export default memo(ChatFeed)
