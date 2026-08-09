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
export function MessageReactions({ reactions, star, rowLive, canSeeList, inside, trailing, onToggle, onShow, onStar }: {
  reactions: NonNullable<ConvMsg['reactions']>
  /** платная ⭐-реакция сообщения (total>0) — отдельный чип-звезда перед эмодзи */
  star?: { total: number; mine: number }
  /** ряд уже был смонтирован, когда появились реакции (live-добавление) —
   * анимируем и первый чип сообщения, не только добавленные позже */
  rowLive: boolean
  /** список реагировавших доступен (tweb can_see_list || приватный чат) */
  canSeeList?: boolean
  /** чипы лежат внутри тела сообщения (tweb `.message .reaction`) — светлая
   * заливка акцентом вместо тёмной подложки из обоев */
  inside?: boolean
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

  // tweb reactions.ts:304-307: аватары вместо счётчика показываются, только если
  // список реагировавших вообще доступен и ВСЕГО реакций на сообщении меньше
  // порога (Block → 4). Порог считается по сумме, а не по одной реакции.
  const total = reactions.reduce((acc, r) => acc + r.count, 0) + (star?.total ?? 0)
  const canRenderAvatars = !!canSeeList && total < REACTIONS_DISPLAY_COUNTER_AT

  // tweb: `is-last` ставится последнему ЧИПУ по индексу, независимо от того,
  // что время едет следом (reactions.ts:319) — свой отступ время несёт само.
  const lastIndex = reactions.length - 1
  // Разметка tweb (живой DOM §3, _reactions.scss/_reaction.scss):
  //   reactions-element.reactions.reactions-block.reactions-like-block
  //     reaction-element.reaction.reaction-block.reaction-like-block[.is-chosen][.is-last][.forwards]
  //       div.reaction-sticker.is-regular.media-sticker-wrapper
  //       span.reaction-counter | div.stacked-avatars
  return (
    <reactions-element
      class={classNames('reactions', 'reactions-block', 'reactions-like-block', s.reactions, inside ? s.reactionsInside : '')}
    >
      {star && <StarReactionChip total={star.total} mine={star.mine} onClick={onStar} />}
      {reactions.map((r, i) => (
        <ReactionChip
          key={r.emoji}
          r={r}
          live={rowLive || liveRef.current}
          canRenderAvatars={canRenderAvatars}
          isLast={i === lastIndex}
          onToggle={onToggle}
          onShow={onShow}
        />
      ))}
      {trailing}
    </reactions-element>
  )
}

// tweb REACTIONS_DISPLAY_COUNTER_AT[Block] (reaction.ts:49-52).
const REACTIONS_DISPLAY_COUNTER_AT = 4

// Чип платной ⭐-реакции (tweb .reaction.is-paid): звезда + суммарное число звёзд;
// подсвечен, если зритель вносил вклад (mine>0). Клик — попап выбора количества.
function StarReactionChip({ total, mine, onClick }: { total: number; mine: number; onClick: () => void }) {
  return (
    <reaction-element
      class={classNames(
        'reaction', 'reaction-block', 'reaction-like-block', 'is-paid',
        mine > 0 ? 'is-chosen forwards' : '',
        s.reactionChip, s.starChip, mine > 0 ? s.reactionChosen : '',
      )}
      onClick={(e) => { e.stopPropagation(); onClick() }}
    >
      <div className={classNames('reaction-sticker', s.reactionEmoji)}><StarIcon size={18} /></div>
      <span className={classNames('reaction-counter', s.reactionCount)}>{total}</span>
    </reaction-element>
  )
}

// Один чип. Свежедобавленная «моя» реакция монтируется без is-chosen и получает
// класс кадром позже — CSS-transition подложки играет как tweb SetTransition(300).
// Тап — тоггл своей реакции; long-press / правый клик — попап «кто отреагировал».
export function ReactionChip({ r, live, canRenderAvatars, isLast, onToggle, onShow }: {
  r: { emoji: string; count: number; mine: boolean; recent?: { id: number; name: string; avatarUrl?: string }[] }
  live: boolean
  /** список реагировавших доступен и реакций мало — можно показать аватары */
  canRenderAvatars: boolean
  /** последний чип в ряду — без правого зазора (tweb `.is-last`) */
  isLast: boolean
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
  // tweb reaction.ts:1013-1084 — счётчик рисуется при count >= порога ЛИБО когда
  // аватары показать нельзя; аватары — ровно в обратном случае.
  const showAvatars = canRenderAvatars && r.count < REACTIONS_DISPLAY_COUNTER_AT && !!r.recent?.length
  return (
    <reaction-element
      class={classNames(
        'reaction', 'reaction-block', 'reaction-like-block',
        chosen ? 'is-chosen forwards' : '',
        live ? 'animating' : '',
        isLast ? 'is-last' : '',
        s.reactionChip,
        chosen ? s.reactionChosen : '',
        isLast ? s.isLast : '',
      )}
      onClick={(e) => { e.stopPropagation(); onToggle(r.emoji) }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onShow(e.clientX, e.clientY) }}
    >
      <div className={classNames('reaction-sticker', 'is-regular', 'media-sticker-wrapper', s.reactionEmoji)}>
        <Emoji e={r.emoji} size={22} />
      </div>
      {showAvatars ? (
        <StackedAvatars peers={r.recent!} size={24} />
      ) : (
        <span className={classNames('reaction-counter', s.reactionCount)}>{r.count}</span>
      )}
    </reaction-element>
  )
}
