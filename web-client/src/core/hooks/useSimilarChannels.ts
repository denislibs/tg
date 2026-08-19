// src/core/hooks/useSimilarChannels.ts
//
// Похожие каналы для открытого канала (tweb chat/similarChannels + appChatsManager
// .getChannelRecommendations): один фетч на открытие канала, результат кэшируется в
// памяти по ключу пира. Скрытие блока крестиком запоминается в localStorage (аналог
// tweb hiddenSimilarChannels в app-state) — по одному ключу на канал.
import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import type { Chat } from '../peers/peer'

/** Похожий канал — КОНСТРУКТОР `Chat` схемы (имя собирает клиент, аватарка это
 *  `photo.photo_id`), а не плоский снимок витрины. */
export type SimilarChannel = Chat

const cache = new Map<PeerId, { chats: SimilarChannel[]; count: number }>()

function hiddenKey(peerId: PeerId): string {
  return `similar-hidden:${peerId}`
}

export function isSimilarHidden(peerId: PeerId): boolean {
  try {
    return localStorage.getItem(hiddenKey(peerId)) === '1'
  } catch {
    return false
  }
}

export function setSimilarHidden(peerId: PeerId, hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(hiddenKey(peerId), '1')
    else localStorage.removeItem(hiddenKey(peerId))
  } catch {
    /* приватный режим/квота — скрытие просто не запоминается */
  }
}

interface UseSimilarChannelsArgs {
  isRealChat: boolean
  isChannel: boolean
  numericChatId: number
}

export function useSimilarChannels({ isRealChat, isChannel, numericChatId }: UseSimilarChannelsArgs): {
  chats: SimilarChannel[]
  count: number
} {
  const managers = useManagers()
  const [data, setData] = useState<{ chats: SimilarChannel[]; count: number }>(
    () => cache.get(numericChatId) ?? { chats: [], count: 0 },
  )

  useEffect(() => {
    if (!isRealChat || !isChannel) return
    const cached = cache.get(numericChatId)
    if (cached) { setData(cached); return }
    let alive = true
    void managers.channels.similar(numericChatId).then((r) => {
      cache.set(numericChatId, r)
      if (alive) setData(r)
    }).catch(() => { /* нет похожих / ошибка — блок просто не покажется */ })
    return () => { alive = false }
  }, [isRealChat, isChannel, numericChatId, managers])

  return data
}
