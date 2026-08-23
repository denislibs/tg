// src/components/messages/MessageReactions.tsx
// Реакции сообщения (tweb ReactionsElement, layout Block). Вынесено из MessageRow,
// чтобы MessageContent сам рисовал строку чипов под контентом бабла и мог «вливать»
// время+тики в её конец (tweb appendBubbleTime: при наличии реакций timeSpan
// переезжает в reactions-элемент — одна wrap-строка «чипы … время»).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import classNames from '../../shared/lib/classNames'
import StarIcon from '../stars/StarIcon'
import ReactionIcon from './ReactionIcon'
import ReactionAroundEffect from './ReactionAroundEffect'
import StackedAvatars from './StackedAvatars'
import { useReactionEffectStore } from '../../stores/reactionEffectStore'
import {
  isChosen, myPaidStars, reactionKey, recentOf, totalReactions,
} from '../../core/reactions/messageReactions'
import type { MessageReactions as MessageReactionsAggregate, ReactionCount } from '../../core/models'
import s from './MessageRow.module.scss'

// Чипы реакций под сообщением (tweb ReactionsElement, layout Block): пилюля 30px
// с эмодзи + счётчиком; «моя» реакция — сплошной акцентный фон (is-chosen).
// trailing — время+тики, вливаемые в конец строки (tweb appendBubbleTime); align
// прижимает строку вправо у исходящих (tweb is-out is-message-empty flex-end).
export function MessageReactions({ msgId, reactions, rowLive, canSeeList, inside, trailing, onToggle, onShow, onStar }: {
  /** id сообщения — ключ reactionEffectStore (различает «свою только что
   * поставленную» реакцию у ЭТОГО сообщения от такой же реакции на другом) */
  msgId: number
  /** Агрегат ЦЕЛИКОМ — тот же конструктор, что на проводе. Платная ⭐-реакция
   * отдельным пропом не приходит: она чип того же вектора (`reactionPaid`), и
   * порядок чипов задаёт сам вектор, а не сборка на этой стороне. */
  reactions: MessageReactionsAggregate
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
  // порога (Block → 4). Порог считается по сумме, а не по одной реакции —
  // платный чип входит в неё наравне с остальными, потому что он в том же
  // векторе.
  const canRenderAvatars = !!canSeeList && totalReactions(reactions) < REACTIONS_DISPLAY_COUNTER_AT

  // tweb: `is-last` ставится последнему ЧИПУ по индексу, независимо от того,
  // что время едет следом (reactions.ts:319) — свой отступ время несёт само.
  const lastIndex = reactions.results.length - 1
  // Разметка tweb (живой DOM §3, _reactions.scss/_reaction.scss):
  //   reactions-element.reactions.reactions-block.reactions-like-block
  //     reaction-element.reaction.reaction-block.reaction-like-block[.is-chosen][.is-last][.forwards]
  //       div.reaction-sticker.is-regular.media-sticker-wrapper
  //       span.reaction-counter | div.stacked-avatars
  return (
    <reactions-element
      class={classNames('reactions', 'reactions-block', 'reactions-like-block', s.reactions, inside ? s.reactionsInside : '')}
    >
      {reactions.results.map((c, i) => (
        c.reaction._ === 'reactionPaid' ? (
          <StarReactionChip key="reactionPaid" total={c.count} mine={myPaidStars(reactions)} onClick={onStar} />
        ) : (
          <ReactionChip
            key={reactionKey(c.reaction)}
            msgId={msgId}
            c={c}
            recent={recentOf(reactions, c.reaction)}
            live={rowLive || liveRef.current}
            canRenderAvatars={canRenderAvatars}
            isLast={i === lastIndex}
            onToggle={onToggle}
            onShow={onShow}
          />
        )
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
export function ReactionChip({ msgId, c, recent, live, canRenderAvatars, isLast, onToggle, onShow }: {
  msgId: number
  /** Чип — элемент вектора `results` целиком: «моя» это НАЛИЧИЕ `chosen_order`,
   *  а вид реакции — конструктор внутри, а не строка эмодзи рядом. */
  c: ReactionCount
  /** Последние реагировавшие ЭТОЙ реакцией: вектор `recent_reactions` один на
   *  агрегат, поэтому выборку делает вызывающий. */
  recent: PeerId[]
  live: boolean
  /** список реагировавших доступен и реакций мало — можно показать аватары */
  canRenderAvatars: boolean
  /** последний чип в ряду — без правого зазора (tweb `.is-last`) */
  isLast: boolean
  onToggle: (emoji: string) => void
  onShow: (x: number, y: number) => void
}) {
  // Эмодзи-чип: до порта кастомных реакций (#47) сюда доходит только
  // `reactionEmoji`, платный отрисован отдельным чипом выше.
  const emoji = c.reaction._ === 'reactionEmoji' ? c.reaction.emoticon : ''
  const mine = isChosen(c)
  const [defer, setDefer] = useState(live && mine)
  useEffect(() => {
    if (!defer) return
    const raf = requestAnimationFrame(() => setDefer(false))
    return () => cancelAnimationFrame(raf)
  }, [defer])
  const chosen = mine && !defer
  // Эта реакция у ЭТОГО сообщения — та, что пользователь только что сам
  // поставил (см. toggleReaction в useMessageActions.tsx, единственный писатель
  // reactionEffectStore): играем select-анимацию иконки и эффект вокруг РОВНО
  // здесь, а не у той же реакции на другом сообщении и не у чужой, приехавшей
  // по WS (applyReaction — отдельный путь, этот стор не трогает).
  const justReacted = useReactionEffectStore((st) => st.active.has(`${msgId}:${emoji}`))
  // tweb reaction.ts:1013-1084 — счётчик рисуется при count >= порога ЛИБО когда
  // аватары показать нельзя; аватары — ровно в обратном случае.
  const showAvatars = canRenderAvatars && c.count < REACTIONS_DISPLAY_COUNTER_AT && !!recent.length
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
      onClick={(e) => { e.stopPropagation(); onToggle(emoji) }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onShow(e.clientX, e.clientY) }}
    >
      <div
        className={classNames(
          'reaction-sticker', 'is-regular', 'media-sticker-wrapper', s.reactionEmoji,
          justReacted ? s.reactionEmojiEffectActive : '',
        )}
      >
        {/* play — select-анимация играет один раз, ровно в момент постановки
            своей реакции; в покое (в т.ч. у чужих/старых реакций) — center/static
            кадром (tweb renderDoc: static:true). */}
        <ReactionIcon emoji={emoji} play={justReacted} />
        {justReacted && (
          <ReactionAroundEffect
            emoji={emoji}
            onDone={() => useReactionEffectStore.getState().clear(msgId, emoji)}
          />
        )}
      </div>
      {showAvatars ? (
        <StackedAvatars peerIds={recent} size={24} />
      ) : (
        <span className={classNames('reaction-counter', s.reactionCount)}>{c.count}</span>
      )}
    </reaction-element>
  )
}
