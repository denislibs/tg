// src/core/hooks/useChannelExtras.ts
//
// Channel-only wiring for the conversation: live subscription + catch-up (tweb's
// getChannelDifference on open), persisting the current max seq as pts, and
// per-post comment counts. No-ops for non-channels. (Сам тред комментариев —
// обычный ConversationView в thread-режиме; открытие — через App.openThread.)
import { useEffect, useState } from 'react'
import { useMessagesStore } from '../../stores/messagesStore'
import type { Managers } from '../../client/bootstrap'
import type { MessageWindow } from './useMessageWindow'

interface UseChannelExtrasArgs {
  isRealChat: boolean
  isChannel: boolean
  numericChatId: number
  win: MessageWindow
  managers: Managers
  discussionsEnabled: boolean
}

export function useChannelExtras({ isRealChat, isChannel, numericChatId, win, managers, discussionsEnabled }: UseChannelExtrasArgs): {
  commentCounts: Map<number, number>
} {
  const [commentCounts, setCommentCounts] = useState<Map<number, number>>(new Map())

  // Channel live + catch-up (mirrors tweb's getChannelDifference on open): subscribe
  // to the channel topic so live posts arrive via rt:new_message (existing path), and
  // fetch posts missed while away, applying them through the same window.
  useEffect(() => {
    if (!isRealChat || !isChannel) return
    let alive = true
    void managers.realtime.subscribeChannel({ chatId: numericChatId })
    void managers.channels.getDifference(numericChatId).then((missed) => {
      if (alive) missed.forEach((m) => win.applyIncoming(m))
    })
    return () => { alive = false; void managers.realtime.unsubscribeChannel({ chatId: numericChatId }) }
  }, [isRealChat, isChannel, numericChatId, managers, win])

  // Persist the channel's current max seq as pts once the newest posts are loaded so
  // future getChannelDifference starts there. pts ≈ seq is an approximation that holds
  // for our single-stream channels (one monotonic seq per channel).
  useEffect(() => {
    if (!isRealChat || !isChannel || !win.reachedBottom || win.msgs.length === 0) return
    const maxSeq = win.msgs[win.msgs.length - 1].seq
    void managers.channels.setPts(numericChatId, maxSeq)
  }, [isRealChat, isChannel, win.reachedBottom, win.msgs, numericChatId, managers])

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
