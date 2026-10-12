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
// Тред комментариев, как у tweb, правит и диалог ГРУППЫ: у не-форума
// `foundDialog = getDialogOnly(peerId)` (:10814-10816) — сообщения треда
// снимаются со счётчика группы, группа получает горизонт треда (:10876-10880,
// :10928-10929); делает это владелец диалогов (`dialogs.applyThreadRead`).
//
// Расхождение с оригиналом: `notification_reset`/`notification_cancel` и
// `threadsToReplies` (счётчик непрочитанных комментариев у поста,
// `replies_updated`) — предметов нет.
import type { RestClient } from '../net/restClient'
import type { MyMessage } from '../models'
import { getMessageThreadId } from '../models'
import { getServerMessageId } from '../history/messageId'
import { isAnyChat } from '../peers/peerId'
import type { ForumTopic } from '../dialogs/forumTopic'
import type { ReadDiscussion } from './forumTopicsStorage'

/** Состояние треда комментариев — `historyStorage(peerId, threadId)` оригинала в нужном объёме. */
type ThreadState = { maxId: number; readMaxId: number; readOutboxMaxId: number; unreadCount: number }

/** Горизонт треда для ленты — то, что лента спрашивает у `dialogs.getDialogReadState`.
 *  `merged` — тред комментариев: его горизонт сводится с горизонтом группы
 *  (`isMergedReadCursorThread`, :5107-5113, :5122-5127) — сводит владелец диалогов. */
export type ThreadReadState = { read_inbox_max_id: number; read_outbox_max_id?: number; unread_count: number; top_message: number; merged?: true }

export interface ThreadReadsDeps {
  rest: Pick<RestClient, 'post'>
  isForumPeer: (peerId: PeerId) => boolean
  forumTopics: {
    getForumTopic(peerId: PeerId, topicId: number): ForumTopic | undefined
    applyReadDiscussion(update: ReadDiscussion): void
  }
  getMeId: () => number | null
  /** Прочтение треда комментариев на диалоге группы — `dialogs.applyThreadRead`
   *  (до сдвига горизонта треда). Опционален: тестам без диалогов не нужен. */
  onCommentThreadRead?: (peerId: PeerId, threadId: number, maxId: number, out: boolean) => void
  /** Горизонт исходящих треда сдвинут — ленте треда (`dialog_unread`, :10950 →
   *  bubbles.ts:2318-2326 → `historyStorage(peerId, threadId).readOutboxMaxId`, :4860). */
  onReadOutbox?: (peerId: PeerId, threadId: number, maxId: number) => void
}

export function newThreadReads({ rest, isForumPeer, forumTopics, getMeId, onCommentThreadRead, onReadOutbox }: ThreadReadsDeps) {
  const states = new Map<string, ThreadState>()
  /** `historyStorage.triedToReadMaxId` (:9165-9170, :9248-9252) */
  const tried = new Map<string, number>()
  /** `historyStorage.readPromise` (:9165, :9256-9280) */
  const readPromises = new Map<string, Promise<unknown>>()
  /** треды, чей последний запрос отказал (расхождение у `readHistory`) */
  const failed = new Set<string>()
  const key = (peerId: PeerId, threadId: number) => peerId + '_' + threadId

  const topicOf = (peerId: PeerId, threadId: number) =>
    isForumPeer(peerId) ? forumTopics.getForumTopic(peerId, threadId) : undefined

  /** Местное прочтение треда — `onUpdateReadHistory` (:10795-10990), ветки темы и треда. */
  function apply(update: ReadDiscussion): void {
    const { peerId, topicId, maxId, out } = update
    if (isForumPeer(peerId)) forumTopics.applyReadDiscussion(update)
    else applyCommentThread(peerId, topicId, maxId, out)
    // горизонт треда у оригинала — его `historyStorage` (:10916), есть ли тема
    // в кэше или нет; лента треда узнаёт его из `dialog_unread` (:10950)
    if (out) onReadOutbox?.(peerId, topicId, maxId)
  }

  function applyCommentThread(peerId: PeerId, topicId: number, maxId: number, out: boolean): void {
    // диалог группы (:10814-10816) — до сдвига горизонта треда
    onCommentThreadRead?.(peerId, topicId, maxId, out)
    const state = states.get(key(peerId, topicId))
    if (!state) return
    // :10916 — горизонт треда присваивается
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
    // своё последнее сообщение треда непрочитанным его не делает (:5135-5137)
    // горизонт исходящих треда — `historyStorage.readOutboxMaxId` (:8851), не сводится с группой
    return state && { read_inbox_max_id: state.readMaxId, read_outbox_max_id: state.readOutboxMaxId, unread_count: state.readMaxId < state.maxId ? state.unreadCount : 0, top_message: state.maxId, merged: true }
  }

  /**
   * Ветка `threadId` у `readHistory` (:9107-9280): гейт «уже прочитано»
   * (:9133-9157), местный `updateReadChannelDiscussionInbox` сразу
   * (:9203-9209), сервер — `messages.readDiscussion` (:9186-9193): не чаще
   * одного запроса в полёте (`readPromise`) и один раз на рубеж
   * (`triedToReadMaxId`, :9165), по окончании — дочитать то, что набежало за
   * полёт (:9267-9277). Промис запроса — вызывающему (лента повторяет отказ
   * один раз, `bubbles.ts::readUnreaded`). Горизонт чата эта ветка не двигает.
   *
   * Расхождение: отказ сети снимает рубеж (`triedToReadMaxId`) и помечает
   * тред, и гейт «уже прочитано» пропускает повтор, пока запрос не пройдёт, —
   * у tweb местный горизонт уже сдвинут, повтор ленты гасится гейтом, и
   * сервер так и не узнаёт прочтения.
   */
  function readHistory(peerId: PeerId, threadId: number, maxId: number): Promise<unknown> {
    if (!maxId) return Promise.resolve()
    const k = key(peerId, threadId)
    const read = getReadState(peerId, threadId)
    const was = tried.get(k) ?? 0
    if (read && !read.unread_count && maxId <= read.read_inbox_max_id && !failed.has(k)) return Promise.resolve()
    apply({ peerId, topicId: threadId, maxId, out: false })
    const pending = readPromises.get(k)
    if (was >= maxId || pending) {
      if (!(was >= maxId)) tried.set(k, maxId)
      return pending ?? Promise.resolve()
    }
    tried.set(k, maxId)
    const promise = rest.post(`/chats/${peerId}/threads/${getServerMessageId(threadId)}/read`, { read_max_id: getServerMessageId(maxId) })
      .then((r) => { failed.delete(k); return r }, (err: unknown) => {
        // отказ — рубеж снова «не отправлен»
        if (tried.get(k) === maxId) tried.set(k, was)
        failed.add(k)
        throw err
      })
      .finally(() => {
        readPromises.delete(k)
        // :9267-9277 — за полёт рубеж вырос: дочитать
        const next = tried.get(k) ?? 0
        if (next > maxId) {
          tried.set(k, maxId)
          void readHistory(peerId, threadId, next).catch(() => {})
        }
      })
    readPromises.set(k, promise)
    return promise
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

    readHistory,

    /**
     * Кадры `updateReadChannelDiscussionInbox/Outbox` (:777-778) — номера уже
     * клиентские. Горизонт не ниже уже известного — пропуск: сервер шлёт inbox и
     * устройству, которое само читало (у tweb эха своего прочтения нет, местный
     * кадр — только `processLocalUpdate`, :9203-9209), и эхо не должно ни
     * откатывать горизонт, ни перечитывать список тем.
     */
    applyReadDiscussion(update: ReadDiscussion): void {
      const read = update.out ? undefined : getReadState(update.peerId, update.topicId)
      if (read && update.maxId <= read.read_inbox_max_id) return
      if (update.out) {
        const topic = topicOf(update.peerId, update.topicId)
        const state = states.get(key(update.peerId, update.topicId))
        const outMax = topic?.read_outbox_max_id ?? state?.readOutboxMaxId ?? 0
        if (update.maxId <= outMax) return
      }
      apply(update)
    },

    /** Смена сессии — всё в памяти (у оригинала — новый воркер). */
    reset(): void {
      states.clear()
      tried.clear()
      readPromises.clear()
      failed.clear()
    },
  }
}

export type ThreadReads = ReturnType<typeof newThreadReads>
