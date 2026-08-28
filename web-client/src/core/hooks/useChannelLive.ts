// src/core/hooks/useChannelLive.ts
//
// Живая подписка канала на время открытого чата: подписка на топик (живые посты
// и метаданные приходят через per-channel funnel воркера) плюс открытие канала в
// funnel — сид курсора из IDB и добор пропущенного через типизированный
// /difference. Пропущенное едет тем же путём, что живое (операция → зеркало),
// поэтому применять его здесь нечего. Для не-каналов — no-op.
//
// Счётчиков поста хук БОЛЬШЕ НЕ СПРАШИВАЕТ (прежнее имя `useChannelExtras`):
// просмотры (`views`) и тред комментариев (`replies`) — параметры самого
// сообщения и приезжают внутри пачки истории, а рисуются из окна зеркала.
// Опрос двух ручек на каждое изменение окна был вторым чтением тех же данных
// (docs/contracts.md:473).
//
// Сам тред комментариев — обычный Chat в thread-режиме; открытие — через
// chatStackStore.setInnerPeer, см. Chat.tsx onOpenThread.
import { useEffect } from 'react'
import { useManagers } from './useManagers'

interface UseChannelLiveArgs {
  isRealChat: boolean
  isChannel: boolean
  numericChatId: number
}

export function useChannelLive({ isRealChat, isChannel, numericChatId }: UseChannelLiveArgs): void {
  const managers = useManagers()

  useEffect(() => {
    if (!isRealChat || !isChannel) return
    void managers.realtime.subscribeChannel({ peerId: numericChatId })
    return () => { void managers.realtime.unsubscribeChannel({ peerId: numericChatId }) }
  }, [isRealChat, isChannel, numericChatId, managers])
}
