// src/components/messages/MessageReactions.tsx
// Реакции сообщения (tweb ReactionsElement, layout Block). Вынесено из MessageRow,
// чтобы MessageContent сам рисовал строку чипов под контентом бабла и мог «вливать»
// время+тики в её конец (tweb appendBubbleTime: при наличии реакций timeSpan
// переезжает в reactions-элемент — одна wrap-строка «чипы … время»).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import classNames from '../../shared/lib/classNames'
import StarIcon from '../stars/StarIcon'
import Emoji from '../emoji/Emoji'
import StackedAvatars from './StackedAvatars'
import type { ConvMsg } from '../../data'
import s from './MessageRow.module.scss'

// Чипы реакций под сообщением (tweb ReactionsElement, layout Block): пилюля 30px
// с эмодзи + счётчиком; «моя» реакция — сплошной акцентный фон (is-chosen).
// trailing — время+тики, вливаемые в конец строки (tweb appendBubbleTime); align
// прижимает строку вправо у исходящих (tweb is-out is-message-empty flex-end).
export function MessageReactions({ reactions, star, rowLive, trailing, onToggle, onShow, onStar }: {
  reactions: NonNullable<ConvMsg['reactions']>
  /** платная ⭐-реакция сообщения (total>0) — отдельный чип-звезда перед эмодзи */
  star?: { total: number; mine: number }
  /** ряд уже был смонтирован, когда появились реакции (live-добавление) —
   * анимируем и первый чип сообщения, не только добавленные позже */
  rowLive: boolean
  /** время+тики в конце строки (tweb appendBubbleTime → reactionsElement, order:100) */
  trailing?: ReactNode
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
      {trailing}
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
