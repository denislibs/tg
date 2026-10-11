// src/core/managers/threadReads.ts
//
// Прочтение ТРЕДОВ — темы форума и треда комментариев — порт ветки `threadId`
// tweb `readHistory` (appMessagesManager.ts:9107-9270) и её пары на приёме —
// `onUpdateReadHistory` для `updateReadChannelDiscussionInbox/Outbox`
// (:777-778, :10795-10990).
//
// Тред у tweb — своё хранилище истории (`getHistoryStorage(peerId, threadId)`):
// горизонты `readMaxId`/`readOutboxMaxId` и последнее `maxId`. У темы форума их
// держит хранилище тем (`forumTopicsStorage`, `forumTopic.read_inbox_max_id`/
// `top_message`), у треда комментариев — здесь (`states`), наполняет их
// `getDiscussionMessage` (:8843-8846) и новые сообщения треда (:10430-10437).
//
// Расхождения с оригиналом:
//  1. Тред комментариев НЕ трогает диалог группы. У tweb для не-форума
//     `foundDialog = getDialogOnly(peerId)` (:10814-10816), и прочтение треда
//     снимает его сообщения со счётчика ГРУППЫ и присваивает ей горизонт треда
//     (:10876-10880, :10928-10929). Наш сервер `readDiscussion` горизонт и
//     счётчик группы не двигает (контракт БЭК-1b), и местная правка разошлась бы
//     с ним до первого снимка списка.
//  2. `notification_reset`/`notification_cancel` и `threadsToReplies` (счётчик
//     непрочитанных комментариев у поста, `replies_updated`) — предметов нет.
import type { RestClient } from '../net/restClient'
import type { MyMessage } from '../models'
import { getMessageThreadId } from '../models'
import { getServerMessageId } from '../history/messageId'
import { isAnyChat } from '../peers/peerId'
import type { ForumTopic } from '../dialogs/forumTopic'
import type { ReadDiscussion } from './forumTopicsStorage'

/** Состояние треда комментариев — `historyStorage(peerId, threadId)` оригинала в нужном объёме. */
type ThreadState = { maxId: number; readMaxId: number; readOutboxMaxId: number; unreadCount: number }

/** Горизонт треда для ленты — то, что лента спрашивает у `dialogs.getDialogReadState`. */
export type ThreadReadState = { read_inbox_max_id: number; unread_count: number; top_message: number }

export interface ThreadReadsDeps {
  rest: Pick<RestClient, 'post'>
  isForumPeer: (peerId: PeerId) => boolean
  forumTopics: {
    getForumTopic(peerId: PeerId, topicId: number): ForumTopic | undefined
    applyReadDiscussion(update: ReadDiscussion): void
  }
  getMeId: () => number | null
}

export function newThreadReads({ rest, isForumPeer, forumTopics, getMeId }: ThreadReadsDeps) {
  const states = new Map<string, ThreadState>()
  /** `historyStorage.triedToReadMaxId` (:9165-9170, :9248-9252) */
  const tried = new Map<string, number>()
  const key = (peerId: PeerId, threadId: number) => peerId + '_' + threadId

  const topicOf = (peerId: PeerId, threadId: number) =>
    isForumPeer(peerId) ? forumTopics.getForumTopic(peerId, threadId) : undefined

  /** Местное прочтение треда — `onUpdateReadHistory` (:10795-10990), ветки темы и треда. */
  function apply(update: ReadDiscussion): void {
    const { peerId, topicId, maxId, out } = update
    if (isForumPeer(peerId)) {
      forumTopics.applyReadDiscussion(update)
      return
    }
    const state = states.get(key(peerId, topicId))
    if (!state) return
    // :10925-10926 — горизонт треда присваивается
    if (out) {
      state.readOutboxMaxId = maxId
      return
    }
    state.readMaxId = maxId
    if (maxId >= state.maxId) state.unreadCount = 0
  }

  /**
   * Горизонт треда для ленты — `getInboxReadMaxId`/`getReadMaxIdIfUnread`
   * с `threadId` (:5122-5140): у темы — тема, у треда комментариев — его
   * состояние; не знаем — `undefined` (лента спросит диалог).
   */
  function getReadState(peerId: PeerId, threadId: number): ThreadReadState | undefined {
    const topic = topicOf(peerId, threadId)
    if (topic) return topic
    const state = states.get(key(peerId, threadId))
    return state && { read_inbox_max_id: state.readMaxId, unread_count: state.readMaxId < state.maxId ? state.unreadCount || 1 : 0, top_message: state.maxId }
  }

  return {
    /**
     * Ответ `getDiscussionMessage` (:8843-8846): горизонты и последнее сообщение
     * треда комментариев. Номера — клиентские.
     */
    saveDiscussion(peerId: PeerId, threadId: number, s: { maxId: number; readMaxId: number; readOutboxMaxId: number; unreadCount: number }): void {
      states.set(key(peerId, threadId), { ...s })
    },

    getReadState,

    /** Новое сообщение треда комментариев — `historyStorage._maxId` треда (:10435-10437). */
    applyNewMessage(m: MyMessage): void {
      if (!isAnyChat(m.peerId) || isForumPeer(m.peerId)) return
      const threadId = getMessageThreadId(m, { isForum: false })
      const state = threadId ? states.get(key(m.peerId, threadId)) : undefined
      if (!state || m.id <= state.maxId) return
      state.maxId = m.id
      if (!m.pFlags.out && m.fromId !== getMeId() && m.id > state.readMaxId) ++state.unreadCount
    },

    /**
     * Ветка `threadId` у `readHistory` (:9107-9270): гейт «уже прочитано»
     * (:9133-9157), местный `updateReadChannelDiscussionInbox` сразу
     * (:9203-9209), сервер — `messages.readDiscussion` один раз на рубеж
     * (:9186-9193, `triedToReadMaxId`). Горизонт чата эта ветка не двигает.
     */
    readHistory(peerId: PeerId, threadId: number, maxId: number): void {
      if (!maxId) return
      const k = key(peerId, threadId)
      const read = getReadState(peerId, threadId)
      if (read && !read.unread_count && maxId <= read.read_inbox_max_id) return
      apply({ peerId, topicId: threadId, maxId, out: false })
      const was = tried.get(k) ?? 0
      if (was >= maxId) return
      tried.set(k, maxId)
      void rest.post(`/chats/${peerId}/threads/${getServerMessageId(threadId)}/read`, { read_max_id: getServerMessageId(maxId) }).catch(() => {
        // отказ — рубеж снова «не отправлен», следующий круг ленты повторит
        if (tried.get(k) === maxId) tried.set(k, was)
      })
    },

    /** Кадры `updateReadChannelDiscussionInbox/Outbox` (:777-778) — номера уже клиентские. */
    applyReadDiscussion: apply,

    /** Смена сессии — всё в памяти (у оригинала — новый воркер). */
    reset(): void {
      states.clear()
      tried.clear()
    },
  }
}

export type ThreadReads = ReturnType<typeof newThreadReads>
