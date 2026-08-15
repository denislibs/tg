// src/components/messages/ReactionAroundEffect.tsx
// Эффект «вокруг» при выборе реакции (tweb reaction.ts:1183, fireAroundAnimation:
// `doc: genericEffect || availableReaction?.around_animation`) — оверлей поверх
// чипа, отдельный от самой иконки чипа (ReactionIcon). Играется РОВНО один раз,
// когда пользователь только что поставил свою реакцию (см. useMessageActions
// toggleReaction + reactionEffectStore); чужие реакции, приехавшие по WS, этот
// компонент не монтируют.
//
// Не портируем целиком tweb-механику fireAroundAnimation (генерик-маска
// custom-emoji реакций, полёт через глобальный emojiAnimationContainer с
// пересчётом позиции по скроллу) — вне периметра задачи, у нас overlay лежит
// внутри самого чипа как обычный абсолютно спозиционированный узел.
import { useEffect, useMemo } from 'react'
import { useReactions } from '../../core/hooks/useReactions'
import { useEvent } from '../../core/hooks/useEvent'
import StickerMedia from '../StickerMedia'
import s from './ReactionAroundEffect.module.scss'

// tweb reaction.ts fireAroundAnimation: sizes.effectSize = 80 — фиксированный
// размер эффекта, крупнее самой иконки (REACTIONS_SIZE[Block] = 22) вне
// зависимости от типа макета реакции.
const EFFECT_SIZE = 80

export default function ReactionAroundEffect({ emoji, onDone }: { emoji: string; onDone: () => void }) {
  const reactions = useReactions()
  const reaction = useMemo(() => reactions.find((r) => r.emoji === emoji), [reactions, emoji])
  const mediaId = reaction?.aroundMediaId
  // Стабильная обёртка: `onDone` у вызывающей стороны (ReactionChip) — новое
  // замыкание на каждый ЕЁ рендер (`() => store.clear(msgId, r.emoji)`); без
  // этого cleanup ниже срабатывал бы на каждый чужой ре-рендер родителя
  // (изменился defer/count/live — что угодно), а не только на настоящий unmount.
  const onDoneEvent = useEvent(onDone)

  useEffect(() => {
    if (mediaId === undefined) {
      // Не у каждой реакции каталога есть роль `around` (5 из 7 медиа-ролей на
      // штуку) — рисовать нечего, но вызывающая сторона ждёт сигнал о
      // завершении, чтобы снять этот узел из дерева.
      onDoneEvent()
      return
    }
    // Компонент может размонтироваться раньше, чем StickerMedia.onComplete сам
    // позовёт onDone: переключили чат сразу после клика, лента реконсилировалась
    // и чип пересобрался, реакция откатилась по сетевой ошибке. Без этой
    // страховки пара msgId:emoji зависает в reactionEffectStore НАВСЕГДА — при
    // следующем маунте ТОГО ЖЕ чипа select-анимация иконки и эффект вокруг
    // проигрываются заново без единого клика (ревью R6, Important 1).
    // clear() идемпотентен — повторный вызов после штатного завершения (когда
    // onComplete уже сам вызвал onDone и родитель уже готовится размонтировать
    // этот узел) не рождает лишнего обновления стора.
    return () => onDoneEvent()
  }, [mediaId, onDoneEvent])

  if (mediaId === undefined) return null

  return (
    <div className={s.effect} aria-hidden="true">
      <StickerMedia mediaId={mediaId} width={EFFECT_SIZE} height={EFFECT_SIZE} autoplay loop={false} onComplete={onDoneEvent} />
    </div>
  )
}
