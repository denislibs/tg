// src/core/hooks/useAnimatedEmoji.ts
// ViewModel-хук big-emoji бабла: для РОВНО одного эмодзи отдаёт mediaId
// лотти-стикера из сид-набора animated_emoji (tweb bubbles.ts: bigEmojis === 1 →
// getAnimatedEmojiSticker → сообщение рендерится стикером, не глифом).
// emoji=null — хук выключен (2-3 эмодзи остаются шрифтовыми).
import { useEffect, useState } from 'react'
import { getAnimatedEmoji, peekAnimatedEmoji } from '../animatedEmoji'

export function useAnimatedEmoji(emoji: string | null): { mediaId: number } | null {
  // Синхронный peek избегает мигания «глиф → стикер» у уже прогретого кэша.
  const [found, setFound] = useState(() => (emoji ? peekAnimatedEmoji(emoji) : null))
  useEffect(() => {
    if (!emoji) return
    let alive = true
    getAnimatedEmoji(emoji).then((r) => { if (alive) setFound(r) }, () => {})
    return () => { alive = false }
  }, [emoji])
  return emoji ? found : null
}
