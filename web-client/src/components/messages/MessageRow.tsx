// src/components/messages/MessageRow.tsx
// ONE message bubble, memoized. Extracted from ConversationView's feed so that
// appending/sending a message re-renders only the new (and the previous-last,
// whose group tail flips) row — not all ~40 bubbles. memo() bails when its props
// are unchanged; this works because `m` (ConvMsg) is given a STABLE reference by
// the parent's conversion cache, and every other prop is a primitive or a stable
// callback object (feedFns). The media viewer is opened via context (useMediaViewer).
//
// Контент бабла по типу (media/sticker/poll/text/…) вынесен в MessageContent —
// здесь остаётся мемоизированная обёртка ряда (bands/checkbox/зона) и реакции.
// Стили — MessageRow.module.scss; палитра исходящих/входящих через CSS-переменные
// на .row ([data-out]); геометрия с рантайм-флагами (радиусы, textSize) — инлайн.
import { memo, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import classNames from '../../shared/lib/classNames'
import { BubbleAppear } from '../animations/bubbleAnimations'
import Checkbox from '../../shared/ui/Checkbox'
import StarIcon from '../stars/StarIcon'
import Emoji from '../emoji/Emoji'
import StackedAvatars from './StackedAvatars'
import { emojiOnlyCount } from '../RichText'
import MessageContent from './MessageContent'
import { useSettings } from '../../settings'
import type { ConvMsg } from '../../data'
import type { ChatAutoDownload } from '../../core/hooks/useChatAutoDownload'
import s from './MessageRow.module.scss'

// Обёртка контента .zone: без плавающих реакций — прозрачна; с ними — колонка
// «бабл + строка чипов под ним» (tweb reactions-out у стикеров/кружков/голосовых).
function ZoneBody({ chipsOutside, children }: { chipsOutside: ReactNode; children: ReactNode }) {
  if (!chipsOutside) return <>{children}</>
  return (
    <div className={s.zoneCol}>
      {children}
      <div className={s.reactionsOut}>{chipsOutside}</div>
    </div>
  )
}

// Stable handler bundle the feed/rows close over (identities never change — see
// ConversationView's useEvent wrappers), so passing it through doesn't bust memo.
export interface FeedFns {
  openSender: (senderId: number, fallbackName: string) => void
  playVoice: (mediaId: number) => void
  toggleSelect: (id: number) => void
  openMsgMenu: (e: MouseEvent, m: ConvMsg) => void
  jumpToSeq: (seq?: number) => void
  openLightbox: (mediaId: number, el: HTMLElement) => void
  /** перезвонить по клику на бабл звонка (tweb: клик по messageMediaCall) */
  recall: (video: boolean) => void
  /** кружок воспроизведён со звуком → снять media_unread (tweb readMessages) */
  mediaPlayed: (msgId: number) => void
  /** кружок заиграл со звуком → его <video> становится треком глобального плеера */
  roundPlaying: (msgId: number, el: HTMLMediaElement) => void
  /** клик по чипу реакции — поставить/снять свою (tweb sendReaction) */
  toggleReaction: (msgId: number, emoji: string) => void
  /** long-press / правый клик по чипу — показать, кто отреагировал */
  showReactedUsers: (msgId: number, x: number, y: number) => void
  /** клик по чипу ⭐-реакции — открыть попап платной реакции (tweb PopupStarReaction) */
  openStarReaction: (msgId: number) => void
  /** крестик на кольце прогресса — отменить аплоад и убрать оптимистичный бабл */
  cancelUpload: (clientId: string) => void
  /** разблокировать платное медиа за звёзды (Telegram paid media) */
  unlockPaid: (msgId: number) => Promise<void>
}

// Чипы реакций под сообщением (tweb ReactionsElement, layout Block): пилюля 30px
// с эмодзи + счётчиком; «моя» реакция — сплошной акцентный фон (is-chosen).
function MessageReactions({ reactions, star, rowLive, onToggle, onShow, onStar }: {
  reactions: NonNullable<ConvMsg['reactions']>
  /** платная ⭐-реакция сообщения (total>0) — отдельный чип-звезда перед эмодзи */
  star?: { total: number; mine: number }
  /** ряд уже был смонтирован, когда появились реакции (live-добавление) —
   * анимируем и первый чип сообщения, не только добавленные позже */
  rowLive: boolean
  onToggle: (emoji: string) => void
  onShow: (x: number, y: number) => void
  onStar: () => void
}) {
  // Отличаем чипы из первичного рендера (история — без анимации, tweb
  // isConnected=false → duration 0) от добавленных кликом (с анимацией).
  const liveRef = useRef(false)
  useEffect(() => { liveRef.current = true }, [])
  return (
    <div className={s.reactions}>
      {star && <StarReactionChip total={star.total} mine={star.mine} onClick={onStar} />}
      {reactions.map((r) => (
        <ReactionChip key={r.emoji} r={r} live={rowLive || liveRef.current} onToggle={onToggle} onShow={onShow} />
      ))}
    </div>
  )
}

// Чип платной ⭐-реакции (tweb .reaction.is-paid): звезда + суммарное число звёзд;
// подсвечен, если зритель вносил вклад (mine>0). Клик — попап выбора количества.
function StarReactionChip({ total, mine, onClick }: { total: number; mine: number; onClick: () => void }) {
  return (
    <div
      className={classNames(s.reactionChip, s.starChip, mine > 0 ? s.reactionChosen : '')}
      onClick={(e) => { e.stopPropagation(); onClick() }}
    >
      <span className={s.reactionEmoji}><StarIcon size={18} /></span>
      <span className={s.reactionCount}>{total}</span>
    </div>
  )
}

// Один чип. Свежедобавленная «моя» реакция монтируется без is-chosen и получает
// класс кадром позже — CSS-transition подложки играет как tweb SetTransition(300).
// Тап — тоггл своей реакции; long-press / правый клик — попап «кто отреагировал».
export function ReactionChip({ r, live, onToggle, onShow }: {
  r: { emoji: string; count: number; mine: boolean; recent?: { id: number; name: string; avatarUrl?: string }[] }
  live: boolean
  onToggle: (emoji: string) => void
  onShow: (x: number, y: number) => void
}) {
  const [defer, setDefer] = useState(live && r.mine)
  useEffect(() => {
    if (!defer) return
    const raf = requestAnimationFrame(() => setDefer(false))
    return () => cancelAnimationFrame(raf)
  }, [defer])
  const chosen = r.mine && !defer
  return (
    <div
      className={classNames(s.reactionChip, chosen ? s.reactionChosen : '')}
      onClick={(e) => { e.stopPropagation(); onToggle(r.emoji) }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onShow(e.clientX, e.clientY) }}
    >
      <span className={s.reactionEmoji}><Emoji e={r.emoji} size={22} /></span>
      {/* tweb reaction.ts renderAvatars/renderCounter: при count<4 и наличии
          списка реагировавших — аватары вместо числа; иначе счётчик. */}
      {r.recent?.length && r.count < 4 ? (
        <span className={s.reactionAvatars}><StackedAvatars peers={r.recent} size={24} /></span>
      ) : (
        <span className={s.reactionCount}>{r.count}</span>
      )}
    </div>
  )
}

export interface MessageRowProps {
  m: ConvMsg
  seq?: number           // raw window seq — the data-seq jump/scroll machinery targets
  out: boolean
  firstInGroup: boolean
  lastInGroup: boolean
  selecting: boolean
  isSelected: boolean
  isHighlighted: boolean
  ladderActive: boolean
  ladderDelay: number
  feedFns: FeedFns
  // Автозагрузка медиа для этого чата (tweb chat.autoDownload); 0 = по клику.
  autoDownload?: ChatAutoDownload
  // csv id выбранных элементов альбома (стабильная строка — memo не ломается
  // у остальных рядов; только для m.type === 'album')
  albumSelectedKey?: string
  // Optional slot rendered at the bottom of the bubble (channel post replies-footer).
  footer?: ReactNode
}

function MessageRow({
  m, seq, out, firstInGroup, lastInGroup,
  selecting, isSelected, isHighlighted, ladderActive, ladderDelay,
  feedFns, autoDownload, albumSelectedKey, footer,
}: MessageRowProps) {
  const textSize = useSettings((st) => st.textSize)
  const bigEmoji = m.type === 'text' && m.text ? emojiOnlyCount(m.text) : 0
  const rowStyle = { '--msg-text-size': `${textSize}px` } as CSSProperties

  // Реакции: внутри бабла у text/poll/media/album; у остальных типов (voice,
  // sticker, document, …) — плавающей строкой под баблом (tweb reactions-out).
  // rowLive: реакции появились у УЖЕ смонтированного ряда → анимируем вход.
  const rowLiveRef = useRef(false)
  useEffect(() => { rowLiveRef.current = true }, [])
  const hasStar = !!m.starReaction && m.starReaction.total > 0
  const chips =
    (m.reactions?.length || hasStar) && m.id != null && !selecting ? (
      <MessageReactions
        reactions={m.reactions ?? []}
        star={hasStar ? m.starReaction : undefined}
        rowLive={rowLiveRef.current}
        onToggle={(emoji) => feedFns.toggleReaction(m.id!, emoji)}
        onShow={(x, y) => feedFns.showReactedUsers(m.id!, x, y)}
        onStar={() => feedFns.openStarReaction(m.id!)}
      />
    ) : null
  const chipsInline =
    ((m.type === 'text' && !bigEmoji) || m.type === 'poll' || m.type === 'checklist' || m.type === 'album'
      || ((m.mediaId != null || !!m.localUrl) && m.type !== 'roundVideo' && m.type !== 'voice' && m.type !== 'sticker'))

  return (
    <BubbleAppear
      appear={ladderActive}
      delay={ladderDelay}
      className={s.row}
      data-out={out || undefined}
      data-last={lastInGroup || undefined}
      data-selecting={selecting || undefined}
      data-mid={m.id}
      data-seq={seq}
      onContextMenu={selecting ? undefined : (e: MouseEvent) => feedFns.openMsgMenu(e, m)}
      // Обычный клик по error-баблу открывает то же меню (Переотправить/Удалить).
      onClick={
        selecting && m.id != null && m.type !== 'album' // альбом тогглится по-элементно
          ? () => feedFns.toggleSelect(m.id!)
          : m.status === 'error'
            ? (e: MouseEvent) => feedFns.openMsgMenu(e, m)
            : undefined
      }
      style={rowStyle}
    >
      {/* Jump-to-message flash (fades in then out). */}
      {isHighlighted && (
        <motion.div
          className={s.band}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.5, 0.5, 0] }}
          transition={{ duration: 2, times: [0, 0.12, 0.5, 1] }}
        />
      )}
      {/* Full-width selection band (tweb: rgba(primary,.3), fades in). */}
      {selecting && m.id != null && isSelected && (
        <motion.div
          className={s.band}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        />
      )}
      {selecting && m.id != null && m.type !== 'album' && (
        <div className={s.check}>
          <Checkbox checked={isSelected} />
        </div>
      )}

      <div className={s.zone}>
        <ZoneBody chipsOutside={chipsInline ? null : chips}>
          <MessageContent
            m={m}
            out={out}
            firstInGroup={firstInGroup}
            lastInGroup={lastInGroup}
            selecting={selecting}
            autoDownload={autoDownload}
            albumSelectedKey={albumSelectedKey}
            footer={footer}
            chips={chips}
            feedFns={feedFns}
          />
        </ZoneBody>
      </div>
    </BubbleAppear>
  )
}

export default memo(MessageRow)
