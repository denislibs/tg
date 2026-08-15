// src/components/messages/ReactionIcon.tsx
// Иконка чипа реакции (tweb reaction.ts:807-820, renderDoc): в покое рисуем
// `center_icon ?? static_icon`, при выборе (`play`) — `select_animation`
// (одноразовое проигрывание без loop, как renderDoc: static:true у покоящегося
// чипа — там даже center_icon рендерится статичным первым кадром).
// Проигрыванием по видимости владеет animationIntersector — StickerMedia сам
// в нём регистрируется, второй такой механизм здесь не заводим.
//
// Реакция может быть неизвестна каталогу (старое сообщение с реакцией, которую
// сервер больше не отдаёт в /reactions, либо каталог ещё не успел загрузиться,
// см. useReactions) — тогда рисуем текстовый эмодзи, как рисовали чипы раньше
// (до этой задачи — components/emoji/Emoji), а не оставляем пустоту.
import { useMemo } from 'react'
import { useReactions } from '../../core/hooks/useReactions'
import StickerMedia from '../StickerMedia'

// tweb `.reaction-sticker` — бокс 22px (--reaction-size: 1.375rem в
// MessageRow.module.scss), под него сверстан весь чип; величина фиксирована,
// не проп — иконка не должна ломать раскладку строки чипов.
const ICON_SIZE = 22

export default function ReactionIcon({ emoji, play }: { emoji: string; play: boolean }) {
  const reactions = useReactions()
  const reaction = useMemo(() => reactions.find((r) => r.emoji === emoji), [reactions, emoji])

  const mediaId = reaction
    ? play
      // выбор — select_animation; если у реакции его почему-то нет, не проваливаемся
      // в пустоту, а падаем на тот же ряд, что и в покое.
      ? (reaction.selectMediaId ?? reaction.centerMediaId ?? reaction.staticMediaId)
      : (reaction.centerMediaId ?? reaction.staticMediaId)
    : undefined

  if (mediaId === undefined) {
    return (
      <span style={{ fontSize: ICON_SIZE * 0.95, lineHeight: 1, userSelect: 'none' }}>{emoji}</span>
    )
  }

  return <StickerMedia mediaId={mediaId} width={ICON_SIZE} height={ICON_SIZE} autoplay={play} loop={false} />
}
