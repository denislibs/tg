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
// см. useReactions) — тогда рисуем ТЕМ ЖЕ компонентом, что рисовали чипы до
// этой задачи (components/emoji/Emoji: нативный глиф на Apple, иначе PNG с CDN),
// а не оставляем пустоту и не теряем его фолбэк-цепочку для не-Apple систем.
import { useMemo } from 'react'
import { useReactions } from '../../core/hooks/useReactions'
import StickerMedia from '../StickerMedia'
import Emoji from '../emoji/Emoji'

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
    return <Emoji e={emoji} size={ICON_SIZE} />
  }

  return <StickerMedia mediaId={mediaId} width={ICON_SIZE} height={ICON_SIZE} autoplay={play} loop={false} />
}
