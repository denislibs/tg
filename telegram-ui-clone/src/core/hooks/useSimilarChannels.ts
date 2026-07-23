// src/core/hooks/useSimilarChannels.ts
//
// Похожие каналы для открытого канала (tweb chat/similarChannels + appChatsManager
// .getChannelRecommendations): один фетч на открытие канала, результат кэшируется в
// памяти по chatId. Скрытие блока крестиком запоминается в localStorage (аналог
// tweb hiddenSimilarChannels в app-state) — по одному ключу на канал.
import { useEffect, useState } from 'react'
import type { Managers } from '../../client/bootstrap'
import type { SearchResult } from '../managers/channelsManager'

export type SimilarChannel = SearchResult['chats'][number]

const cache = new Map<number, { chats: SimilarChannel[]; count: number }>()

function hiddenKey(chatId: number): string {
  return `similar-hidden:${chatId}`
}

export function isSimilarHidden(chatId: number): boolean {
  try {
    return localStorage.getItem(hiddenKey(chatId)) === '1'
  } catch {
    return false
  }
}

export function setSimilarHidden(chatId: number, hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(hiddenKey(chatId), '1')
    else localStorage.removeItem(hiddenKey(chatId))
  } catch {
    /* приватный режим/квота — скрытие просто не запоминается */
  }
}

interface UseSimilarChannelsArgs {
  isRealChat: boolean
  isChannel: boolean
  numericChatId: number
  managers: Managers
}

export function useSimilarChannels({ isRealChat, isChannel, numericChatId, managers }: UseSimilarChannelsArgs): {
  chats: SimilarChannel[]
  count: number
} {
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
