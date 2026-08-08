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
import { memo, useEffect, useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { BubbleAppear } from '../animations/bubbleAnimations'
import Checkbox from '../../shared/ui/Checkbox'
import MessageContent from './MessageContent'
import { useSettings } from '../../settings'
import type { ConvMsg } from '../../data'
import type { ChatAutoDownload } from '../../core/hooks/useChatAutoDownload'
import s from './MessageRow.module.scss'

// Stable handler bundle the feed/rows close over (identities never change — see
// ConversationView's useEvent wrappers), so passing it through doesn't bust memo.
export interface FeedFns {
  openSender: (senderId: number, fallbackName: string) => void
  playVoice: (mediaId: number) => void
  toggleSelect: (id: number) => void
  openMsgMenu: (e: MouseEvent, m: ConvMsg) => void
  jumpToSeq: (seq?: number) => void
  /** клик по дате-разделителю — открыть пикер даты на этом дне (мс) */
  openDatePicker: (dayMs: number) => void
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
  // Виден ли список реагировавших (tweb reactions.pFlags.can_see_list ||
  // peerId.isUser()): от этого зависит, показывать в чипе аватары или число.
  // Флага can_see_list бэк пока не отдаёт, поэтому берём приватность чата.
  canSeeReactionList: boolean
}

function MessageRow({
  m, seq, out, firstInGroup, lastInGroup,
  selecting, isSelected, isHighlighted, ladderActive, ladderDelay,
  feedFns, autoDownload, albumSelectedKey, footer, canSeeReactionList,
}: MessageRowProps) {
  const textSize = useSettings((st) => st.textSize)
  const rowStyle = { '--messages-text-size': `${textSize}px` } as CSSProperties

  // Реакции — единый Block-ряд под контентом бабла у ВСЕХ типов (tweb: reactions
  // всегда крепятся внутрь структуры бабла, не выносятся наружу). Само размещение
  // и «вливание» времени в строку — в MessageContent. rowLive: реакции появились
  // у УЖЕ смонтированного ряда → анимируем вход.
  const rowLiveRef = useRef(false)
  useEffect(() => { rowLiveRef.current = true }, [])
  const showReactions =
    ((m.reactions?.length ?? 0) > 0 || (!!m.starReaction && m.starReaction.total > 0)) &&
    m.id != null && !selecting

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
        <MessageContent
          m={m}
          out={out}
          firstInGroup={firstInGroup}
          lastInGroup={lastInGroup}
          selecting={selecting}
          autoDownload={autoDownload}
          albumSelectedKey={albumSelectedKey}
          footer={footer}
          showReactions={showReactions}
          canSeeReactionList={canSeeReactionList}
          rowLive={rowLiveRef.current}
          feedFns={feedFns}
        />
      </div>
    </BubbleAppear>
  )
}

export default memo(MessageRow)
