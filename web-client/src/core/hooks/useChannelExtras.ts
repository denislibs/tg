// src/core/hooks/useChannelExtras.ts
//
// Channel-only wiring for the conversation: live subscription (which also drives
// the worker's per-channel pts funnel — cursor seed + catch-up via typed
// /difference), plus per-post comment/view counts. No-ops for non-channels. (Сам
// тред комментариев — обычный Chat в thread-режиме; открытие — через
// chatStackStore.setInnerPeer, см. Chat.tsx onOpenThread.)
import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import { useMirrorWindow } from './useMirrorWindow'
import type { CommentReplier } from '../managers/channelsManager'

interface UseChannelExtrasArgs {
  isRealChat: boolean
  isChannel: boolean
  numericChatId: number
  /** ключ окна (`winKey(peerId, threadRootId)`) — по нему хук читает ЗЕРКАЛО
   *  окон, а не zustand-копию: номера постов ему нужны те же, что рисует живая
   *  лента, а живой лентой под флагом `VITE_VANILLA_FEED` работает
   *  `chat/bubbles.ts`, у которой zustand-копии нет вовсе. `null` — читать
   *  нечего. */
  windowKey: string | null
  discussionsEnabled: boolean
}

export function useChannelExtras({ isRealChat, isChannel, numericChatId, windowKey, discussionsEnabled }: UseChannelExtrasArgs): {
  commentCounts: Map<number, number>
  /** авторы последних комментариев по посту — стек аватаров в футере */
  commentRepliers: Map<number, CommentReplier[]>
} {
  const managers = useManagers()
  const msgs = useMirrorWindow(windowKey)
  const [commentCounts, setCommentCounts] = useState<Map<number, number>>(new Map())
  const [commentRepliers, setCommentRepliers] = useState<Map<number, CommentReplier[]>>(new Map())

  // Channel live + catch-up: subscribeChannel подписывает на топик (живые посты и
  // метаданные приходят через per-channel funnel воркера) и открывает канал в
  // funnel — сид курсора из IDB + добор пропущенного через типизированный
  // /difference. Пропущенное едет тем же путём, что живое (dispatch → стор), поэтому
  // окно рендерит его из стора — отдельного applyIncoming здесь больше нет.
  useEffect(() => {
    if (!isRealChat || !isChannel) return
    void managers.realtime.subscribeChannel({ peerId: numericChatId })
    return () => { void managers.realtime.unsubscribeChannel({ peerId: numericChatId }) }
  }, [isRealChat, isChannel, numericChatId, managers])

  // Channel discussions: fetch comment counts for the loaded post ids (debounced on
  // msgs change). Only real channel posts with discussions enabled get a count.
  useEffect(() => {
    if (!discussionsEnabled) { setCommentCounts(new Map()); setCommentRepliers(new Map()); return }
    const ids = msgs.map((m) => m.id).filter((id) => id > 0)
    if (ids.length === 0) return
    let alive = true
    const timer = window.setTimeout(() => {
      void managers.channels.commentCounts(numericChatId, ids).then(({ counts, recent }) => {
        if (!alive) return
        setCommentCounts(new Map(Object.entries(counts).map(([k, v]) => [Number(k), v])))
        setCommentRepliers(new Map(Object.entries(recent).map(([k, v]) => [Number(k), v])))
      })
    }, 300)
    return () => { alive = false; window.clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discussionsEnabled, numericChatId, msgs.length, managers])

  // Channel post view counts ("9.2K 👁"): просим свежие числа на каждое открытие
  // для загруженных постов (дебаунс по изменению окна). В ОКНО их кладёт не этот
  // хук, а владелец: `channels.viewCounts` в воркере отдаёт разобранный ответ
  // `messages.cacheViews`, тот патчит SSOT и объявляет операцию `rt:message_op`
  // (см. web-client/CLAUDE.md, «один писатель окна — операции»). Прежде здесь
  // стоял `messagesStore.patchViews` — второй писатель окна мимо операций, из-за
  // которого счётчик не доезжал до зеркала императивной ленты.
  useEffect(() => {
    if (!isRealChat || !isChannel) return
    const ids = msgs.map((m) => m.id).filter((id) => id > 0)
    if (ids.length === 0) return
    const timer = window.setTimeout(() => { void managers.channels.viewCounts(numericChatId, ids) }, 300)
    return () => { window.clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRealChat, isChannel, numericChatId, msgs.length, managers])

  return { commentCounts, commentRepliers }
}
