// src/core/hooks/useChannelExtras.ts
//
// Channel-only wiring for the conversation: live subscription (which also drives
// the worker's per-channel pts funnel — cursor seed + catch-up via typed
// /difference), plus per-post comment/view counts. No-ops for non-channels. (Сам
// тред комментариев — обычный ConversationView в thread-режиме; открытие — через
// App.openThread.)
import { useEffect, useState } from 'react'
import { useMessagesStore } from '../../stores/messagesStore'
import { useManagers } from './useManagers'
import type { MessageWindow } from './useMessageWindow'

interface UseChannelExtrasArgs {
  isRealChat: boolean
  isChannel: boolean
  numericChatId: number
  win: MessageWindow
  discussionsEnabled: boolean
}

export function useChannelExtras({ isRealChat, isChannel, numericChatId, win, discussionsEnabled }: UseChannelExtrasArgs): {
  commentCounts: Map<number, number>
} {
  const managers = useManagers()
  const [commentCounts, setCommentCounts] = useState<Map<number, number>>(new Map())

  // Channel live + catch-up: subscribeChannel подписывает на топик (живые посты и
  // метаданные приходят через per-channel funnel воркера) и открывает канал в
  // funnel — сид курсора из IDB + добор пропущенного через типизированный
  // /difference. Пропущенное едет тем же путём, что живое (dispatch → стор), поэтому
  // окно рендерит его из стора — отдельного applyIncoming здесь больше нет.
  useEffect(() => {
    if (!isRealChat || !isChannel) return
    void managers.realtime.subscribeChannel({ chatId: numericChatId })
    return () => { void managers.realtime.unsubscribeChannel({ chatId: numericChatId }) }
  }, [isRealChat, isChannel, numericChatId, managers])

  // Channel discussions: fetch comment counts for the loaded post ids (debounced on
  // msgs change). Only real channel posts with discussions enabled get a count.
  useEffect(() => {
    if (!discussionsEnabled) { setCommentCounts(new Map()); return }
    const ids = win.msgs.map((m) => m.id).filter((id) => id > 0)
    if (ids.length === 0) return
    let alive = true
    const timer = window.setTimeout(() => {
      void managers.channels.commentCounts(numericChatId, ids).then((counts) => {
        if (!alive) return
        setCommentCounts(new Map(Object.entries(counts).map(([k, v]) => [Number(k), v])))
      })
    }, 300)
    return () => { alive = false; window.clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discussionsEnabled, numericChatId, win.msgs.length, managers])

  // Channel post view counts ("9.2K 👁"): fetch fresh per open for the loaded post
  // ids (debounced on msgs change) and patch them onto the messages in the store, so
  // the meta line renders a current count. Any channel post has views (independent of
  // discussions). Mirrors the comment-counts fetch above.
  useEffect(() => {
    if (!isRealChat || !isChannel) return
    const ids = win.msgs.map((m) => m.id).filter((id) => id > 0)
    if (ids.length === 0) return
    let alive = true
    const timer = window.setTimeout(() => {
      void managers.channels.viewCounts(numericChatId, ids).then((counts) => {
        if (!alive) return
        useMessagesStore.getState().patchViews(numericChatId, new Map(Object.entries(counts).map(([k, v]) => [Number(k), v])))
      })
    }, 300)
    return () => { alive = false; window.clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRealChat, isChannel, numericChatId, win.msgs.length, managers])

  return { commentCounts }
}
