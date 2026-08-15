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

  // Не у каждой реакции каталога есть роль `around` (5 из 7 медиа-ролей на
  // штуку) — рисовать нечего, но вызывающая сторона (MessageReactions) ждёт
  // сигнал о завершении, чтобы снять этот узел из дерева.
  useEffect(() => {
    if (mediaId === undefined) onDone()
  }, [mediaId, onDone])

  if (mediaId === undefined) return null

  return (
    <div className={s.effect} aria-hidden="true">
      <StickerMedia mediaId={mediaId} width={EFFECT_SIZE} height={EFFECT_SIZE} autoplay loop={false} onComplete={onDone} />
    </div>
  )
}
