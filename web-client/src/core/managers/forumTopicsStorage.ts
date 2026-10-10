// src/core/managers/forumTopicsStorage.ts
//
// Хранилище тем форумов в воркере — порт раздела «FORUMS SECTION» хранилища
// диалогов tweb (`lib/storages/dialogs.ts:1979-2272`, поле `forumTopics`) и
// его обработчиков в `appMessagesManager` (новое сообщение темы, служебка
// `TopicEdit`, закреп, мьют, прочтение треда). Бэклог Б-54.
//
// Владелец тем — воркер: он сводит ответ `GET /chats/{p}/topics` и живые кадры
// в одно значение и объявляет вкладкам ОПЕРАЦИИ (`rt:forum_topic_op`, типы —
// `core/dialogs/forumTopic.ts::ForumTopicOp`) — те же события, которыми
// хранилище оригинала говорит со списком тем. Список на главном потоке
// (`components/autonomousDialogList/forumTopics.ts`) берёт страницу у владельца
// и дальше живёт этими операциями; «перечитать список по кадру» нет.
//
// Расхождения с оригиналом:
//  1. Страница одна: сервер отдаёт темы целиком (пагинации `getForumTopics` и
//     `getForumTopicsByID` нет — П-4 спеки Ф-5). Поэтому «тема по номеру, которой
//     нет в кэше» (`getForumTopicById`, `dialogs.ts:2053-2180`) перечитывает
//     список целиком.
//  2. Порядок закреплённых тем живёт в памяти и на диск не пишется: офлайн-кэша
//     тем нет вовсе (у оригинала `pinnedOrders[peerId]` уходит в State).
//  3. Скрытия тем нет (`CAN_HIDE_TOPIC` выключен) — General не поднимается
//     вверх индексом (`dialogs.ts:1001`).
//  4. «Не заглушена ли тема» для бейджа форума (`hasUnmuted`,
//     `dialogs.ts:2252-2255`) считает вкладка: правило мьюта типа чатов живёт в
//     её зеркале (`stores/notifyStore.ts`), поэтому владелец отдаёт настройки
//     непрочитанных тем, а не готовый ответ.
import type { RestClient } from '../net/restClient'
import type { Chat, UserReal } from '../peers/peer'
import type { MyMessage, RawMyMessage } from '../models'
import { getMessageThreadId } from '../models'
import { isForum } from '../peers/predicates'
import { MESSAGE_ID_OFFSET } from '../history/messageId'
import type { PeerNotifySettings } from '../dialogs/notifySettings'
import isMentionUnread from '../messages/isMentionUnread'
import {
  createForumTopicFromAction,
  toForumTopic,
  topicIndex,
  type ForumTopic,
  type ForumTopicOp,
  type ForumTopicWire,
} from '../dialogs/forumTopic'

/** `messages.forumTopics` — контейнер списка тем. */
export interface MessagesForumTopics {
  _: 'messages.forumTopics'
  count: number
  topics: ForumTopicWire[]
  messages: RawMyMessage[]
  chats: Chat[]
  users: UserReal[]
}

/** Ответ `getForumTopics` — форма страницы списка (`DialogsPage`). */
export type ForumTopicsPage = { dialogs: ForumTopic[]; count: number; isEnd: boolean }

/**
 * Непрочитанное форума — `getForumUnreadCount` (`dialogs.ts:2229-2258`):
 * сколько тем из первых двадцати непрочитаны. Настройки уведомлений этих тем
 * едут рядом — `hasUnmuted` считает вкладка (расхождение 4).
 */
export type ForumUnreadCount = { count: number; unreadNotifySettings: PeerNotifySettings[] }

/** Прочтение треда — `updateReadChannelDiscussionInbox/Outbox` в клиентском пространстве. */
export type ReadDiscussion = { peerId: PeerId; topicId: number; maxId: number; out: boolean }

type TopicsCache = {
  topics: Map<number, ForumTopic>
  pinnedOrder: number[]
  loaded: boolean
  loadPromise?: Promise<ForumTopic[]>
}

export interface ForumTopicsDeps {
  rest: Pick<RestClient, 'get'>
  peers: { saveApiPeers(o: { chats?: Chat[]; users?: UserReal[] }): void; cachedPeer(peerId: PeerId): unknown }
  messages: {
    saveApiMessages(list: RawMyMessage[] | undefined): Promise<unknown>
    getMessageByPeer(peerId: number, id: number): MyMessage | undefined
  }
  getMeId: () => number | null
  onOps: (ops: ForumTopicOp[]) => void
  /** Упоминания темы, прочитанные в треде, уходят и из бейджа форума
   *  (`appMessagesManager.ts:10969-10980`) — владелец строки форума. */
  onParentMentionsRead?: (peerId: PeerId, count: number) => void
}

/** tweb `getForumUnreadCount` берёт первые 20 тем папки (`dialogs.ts:2244-2247`). */
const FORUM_UNREAD_LIMIT = 20

export function newForumTopicsStorage(deps: ForumTopicsDeps) {
  const { rest, peers, messages, getMeId, onOps } = deps
  const caches = new Map<PeerId, TopicsCache>()

  const isForumPeer = (peerId: PeerId) => isForum(peers.cachedPeer(peerId) as Chat | undefined)

  /** tweb `getForumTopicsCache` (`dialogs.ts:2032-2047`) */
  function getCache(peerId: PeerId): TopicsCache {
    let cache = caches.get(peerId)
    if (!cache) caches.set(peerId, cache = { topics: new Map(), pinnedOrder: [], loaded: false })
    return cache
  }

  /** Отсортированные темы — порядок папки форума (`getFolderDialogs`). */
  function sorted(cache: TopicsCache): ForumTopic[] {
    return [...cache.topics.values()].sort((a, b) => b.index - a.index)
  }

  /** `generateIndexForDialog` для темы. */
  function reindex(cache: TopicsCache, topic: ForumTopic): void {
    topic.index = topicIndex(topic, cache.pinnedOrder)
  }

  /**
   * Тема из ответа сети — `saveDialog` (`dialogs.ts:1550-1779`) в части темы:
   * последнее сообщение по `top_message`, защита от отката прочтения
   * (`:1636-1670` — местный горизонт ушёл дальше снимка, значит счётчики
   * снимка старее), индекс.
   */
  function saveTopic(cache: TopicsCache, topic: ForumTopic): void {
    const was = cache.topics.get(topic.id)
    topic.lastMessage = messages.getMessageByPeer(topic.peerId, topic.top_message)
    if (was) {
      if (was.read_inbox_max_id > topic.read_inbox_max_id) {
        topic.read_inbox_max_id = was.read_inbox_max_id
        topic.unread_count = Math.min(topic.unread_count, was.unread_count)
        topic.unread_mentions_count = Math.min(topic.unread_mentions_count, was.unread_mentions_count)
        topic.unread_reactions_count = Math.min(topic.unread_reactions_count, was.unread_reactions_count)
      }
      if (was.read_outbox_max_id > topic.read_outbox_max_id) topic.read_outbox_max_id = was.read_outbox_max_id
    }
    reindex(cache, topic)
    cache.topics.set(topic.id, topic)
  }

  /**
   * Сеть: список тем форума. Порядок оригинала (`applyDialogs`,
   * `dialogs.ts:1340-1440`): сначала в хранилища втекают пиры и сообщения,
   * потом темы разрешают на них ссылки. Закреплённые идут в ответе первыми и
   * в своём порядке — он и становится порядком закрепа форума.
   */
  function load(peerId: PeerId): Promise<ForumTopic[]> {
    const cache = getCache(peerId)
    if (cache.loadPromise) return cache.loadPromise
    const promise = (async () => {
      const r = await rest.get<MessagesForumTopics>(`/chats/${peerId}/topics`)
      peers.saveApiPeers({ chats: r.chats, users: r.users })
      await messages.saveApiMessages(r.messages)
      // Кэш могли сбросить (форум выключили), пока шёл запрос.
      if (caches.get(peerId) !== cache) return []
      const topics = (r.topics ?? []).filter((t) => t._ === 'forumTopic').map((t) => toForumTopic(t, peerId))
      cache.pinnedOrder = topics.filter((t) => t.pFlags.pinned).map((t) => t.id)
      const ids = new Set(topics.map((t) => t.id))
      const dropped = [...cache.topics.keys()].filter((id) => !ids.has(id))
      for (const id of dropped) cache.topics.delete(id)
      for (const topic of topics) saveTopic(cache, topic)
      cache.loaded = true
      const ops: ForumTopicOp[] = dropped.map((id) => ({ op: 'drop', peerId, id }))
      ops.push({ op: 'update', peerId, topics: sorted(cache) }, { op: 'forumUnread', peerId })
      onOps(ops)
      return sorted(cache)
    })()
    cache.loadPromise = promise
    void promise.finally(() => { if (cache.loadPromise === promise) cache.loadPromise = undefined }).catch(() => {})
    return promise
  }

  /** Объявить изменённую тему (`scheduleHandleNewDialogs` → `dialogs_multiupdate`). */
  function emitUpdate(topic: ForumTopic, extra: ForumTopicOp[] = []): void {
    onOps([{ op: 'update', peerId: topic.peerId, topics: [topic] }, ...extra])
  }

  /** `dialog_unread` темы + пересчёт бейджа форума (`dialogs.ts:968-985`). */
  const unreadOps = (topic: ForumTopic): ForumTopicOp[] =>
    [{ op: 'unread', topic }, { op: 'forumUnread', peerId: topic.peerId }]

  /**
   * `handleDialogTogglePinned` (`dialogs.ts:2354-2366`) с
   * `handleDialogUnpinning` (`:391-395`) для темы.
   */
  function togglePinned(cache: TopicsCache, topic: ForumTopic, pinned: boolean): void {
    if (!pinned) {
      delete topic.pFlags.pinned
      const idx = cache.pinnedOrder.indexOf(topic.id)
      if (idx !== -1) cache.pinnedOrder.splice(idx, 1)
    } else {
      topic.pFlags.pinned = true
      // `generateDialogPinnedDate` (`:1084-1096`): новой закреплённой место
      // первой в порядке
      if (!cache.pinnedOrder.includes(topic.id)) cache.pinnedOrder.unshift(topic.id)
    }
    reindex(cache, topic)
  }

  /** `handleDialogsPinned` (`dialogs.ts:2368-2411`) для форума. */
  function setPinnedOrder(cache: TopicsCache, peerId: PeerId, order: number[]): void {
    cache.pinnedOrder = order.slice()
    const changed = new Map<number, ForumTopic>()
    const pinned = new Set(order)
    for (const id of order) {
      const topic = cache.topics.get(id)
      if (!topic) continue
      topic.pFlags.pinned = true
      reindex(cache, topic)
      changed.set(id, topic)
    }
    for (const topic of cache.topics.values()) {
      if (topic.pFlags.pinned && !pinned.has(topic.id)) {
        delete topic.pFlags.pinned
        reindex(cache, topic)
        changed.set(topic.id, topic)
      }
    }
    if (changed.size) onOps([{ op: 'update', peerId, topics: [...changed.values()] }])
  }

  return {
    /**
     * Темы форума страницей — `getDialogs({filterId: peerId})` для форума.
     * Из памяти, если список уже загружен (cache-first), иначе — сеть.
     * Расхождение 1: страница одна.
     */
    async getForumTopics(peerId: PeerId, offsetIndex?: number): Promise<ForumTopicsPage> {
      const cache = getCache(peerId)
      if (offsetIndex !== undefined) return { dialogs: [], count: cache.topics.size, isEnd: true }
      const dialogs = cache.loaded ? sorted(cache) : await load(peerId)
      return { dialogs, count: dialogs.length, isEnd: true }
    },

    /** tweb `getForumTopic` (`dialogs.ts:2191-2194`) */
    getForumTopic(peerId: PeerId, topicId: number): ForumTopic | undefined {
      return caches.get(peerId)?.topics.get(topicId)
    },

    /** tweb `getForumTopicOrReload` (`dialogs.ts:2196-2204`) — расхождение 1. */
    async getForumTopicOrReload(peerId: PeerId, topicId: number): Promise<ForumTopic | undefined> {
      const found = caches.get(peerId)?.topics.get(topicId)
      if (found) return found
      await load(peerId)
      return caches.get(peerId)?.topics.get(topicId)
    },

    /**
     * tweb `getForumUnreadCount` (`dialogs.ts:2229-2258`). Список ещё не
     * загружен — ответа нет, загрузка запускается, и по её окончании уходит
     * `forumUnread` (у оригинала — `acknowledged`-вызов и повторный
     * `setUnreadMessagesN`, `appDialogsManager.ts:2711-2721`).
     */
    getForumUnreadCount(peerId: PeerId): ForumUnreadCount | undefined {
      if (!isForumPeer(peerId)) return undefined
      const cache = getCache(peerId)
      if (!cache.loaded) {
        void load(peerId).catch(() => {})
        return undefined
      }
      const top = sorted(cache).slice(0, FORUM_UNREAD_LIMIT).filter((t) => t.unread_count)
      return { count: top.length, unreadNotifySettings: top.map((t) => t.notify_settings) }
    },

    /**
     * Новое сообщение форума — ветка темы `onUpdateNewMessage`
     * (`appMessagesManager.ts:10242-10365`, `:10495-10520`): тема, созданная
     * служебкой, строится сразу (`createBotforumTopicFromAction`); неизвестная —
     * перечитывается (`getForumTopicById`, расхождение 1); известная — счётчики и
     * последнее сообщение; `TopicEdit` правит поля темы (`:10342-10365`).
     */
    applyNewMessage(m: MyMessage): void {
      const peerId = m.peerId
      const forum = isForumPeer(peerId)
      const topicCreate = m._ === 'messageService' && m.action._ === 'messageActionTopicCreate'
      if (!forum && !topicCreate) return
      let threadId = getMessageThreadId(m, { isForum: forum })
      if (topicCreate && !threadId) threadId = m.id
      if (!threadId) return
      const cache = caches.get(peerId)
      // Список ни разу не грузили — хранить нечего: первый показ возьмёт его
      // с сервера уже с этим сообщением.
      if (!cache?.loaded) return

      let topic = cache.topics.get(threadId)
      if (!topic) {
        if (m._ === 'messageService' && topicCreate) {
          const created = createForumTopicFromAction(m)
          if (created) {
            saveTopic(cache, created)
            emitUpdate(created, [{ op: 'forumUnread', peerId }])
          }
        } else {
          void load(peerId).catch(() => {})
        }
        return
      }

      // местный апдейт треда (`updateNewDiscussionMessage`, `:10495-10520`)
      const meId = getMeId()
      const inboxUnread = m.fromId !== meId && !m.pFlags.out
      const isPastReadCursor = m.id <= topic.read_inbox_max_id
      let unreadChanged = false
      if (inboxUnread && m.id > topic.top_message && !isPastReadCursor) {
        ++topic.unread_count
        if (isMentionUnread(m)) ++topic.unread_mentions_count
        unreadChanged = true
      }
      if (m.id >= topic.top_message) {
        topic.top_message = m.id
        topic.lastMessage = m
      }

      // `messageActionTopicEdit` (`:10342-10365`) + `processTopicUpdate` (`dialogs.ts:1781-1797`)
      let edit: ForumTopicOp | undefined
      if (m._ === 'messageService' && m.action._ === 'messageActionTopicEdit') {
        const action = m.action
        const oldTitle = topic.title
        const oldIcon = topic.icon_emoji
        if (action.title !== undefined) topic.title = action.title
        if (action.closed !== undefined) {
          if (action.closed) topic.pFlags.closed = true
          else delete topic.pFlags.closed
        }
        if (action.hidden !== undefined) {
          if (action.hidden) topic.pFlags.hidden = true
          else delete topic.pFlags.hidden
        }
        if (action.icon_emoji_emoticon !== undefined) {
          if (action.icon_emoji_emoticon) topic.icon_emoji = action.icon_emoji_emoticon
          else delete topic.icon_emoji
        }
        const title = topic.title !== oldTitle
        const icon = topic.icon_emoji !== oldIcon
        if (title || icon) edit = { op: 'edit', peerId, id: topic.id, title, icon }
      }

      reindex(cache, topic)
      const extra: ForumTopicOp[] = unreadChanged ? unreadOps(topic) : []
      if (edit) extra.push(edit)
      emitUpdate(topic, extra)
    },

    /** `updatePinnedForumTopic` — `onUpdatePinnedForumTopic` (`dialogs.ts:2480-2490`). */
    applyPinnedTopic(peerId: PeerId, topicId: number, pinned: boolean): void {
      const cache = caches.get(peerId)
      const topic = cache?.topics.get(topicId)
      if (!cache || !topic) return
      togglePinned(cache, topic, pinned)
      emitUpdate(topic)
    },

    /**
     * `updatePinnedForumTopics` — `onUpdatePinnedForumTopics`
     * (`dialogs.ts:2601-2638`): порядок есть — он и есть порядок закрепа; нет
     * — закреплённые перечитываются с сервера.
     */
    async applyPinnedTopics(peerId: PeerId, order?: number[]): Promise<void> {
      const cache = caches.get(peerId)
      if (!cache) return
      if (order) { setPinnedOrder(cache, peerId, order); return }
      cache.loaded = false
      await load(peerId).catch(() => {})
    },

    /**
     * `updateNotifySettings{peer: notifyForumTopic}` — `onUpdateNotifySettings`
     * (`appMessagesManager.ts:11751-11770`) для темы, и пересчёт бейджа форума
     * (`dialog_notify_settings` → `processChangedUnreadOrUnmuted`, `dialogs.ts:174-176`).
     * Тот же вход — своё действие после ответа сети.
     */
    applyNotifySettings(peerId: PeerId, topicId: number, settings: PeerNotifySettings): void {
      const topic = caches.get(peerId)?.topics.get(topicId)
      if (!topic) return
      topic.notify_settings = settings
      onOps([{ op: 'notify', topic }, { op: 'forumUnread', peerId }])
    },

    /**
     * Прочтение треда темы — ветка темы `onUpdateReadHistory`
     * (`appMessagesManager.ts:10795-10990`), волна 2 Ф-5 (`readDiscussion`).
     * Перебираются сообщения треда, которые знает хранилище сообщений, между
     * прежним и новым горизонтом; упоминания уходят и из бейджа форума
     * (`:10969-10980`). Ничего не нашли, а тема всё ещё непрочитана —
     * перечитать (`getForumTopicById`, `:10955-10958`, расхождение 1).
     */
    applyReadDiscussion({ peerId, topicId, maxId, out }: ReadDiscussion): void {
      const topic = caches.get(peerId)?.topics.get(topicId)
      if (!topic) return
      const forum = isForumPeer(peerId)
      const readMaxId = out ? topic.read_outbox_max_id : topic.read_inbox_max_id
      if (out) {
        if (maxId > topic.read_outbox_max_id) topic.read_outbox_max_id = maxId
        emitUpdate(topic)
        return
      }
      let newUnreadCount = 0
      let newUnreadMentionsCount = 0
      let foundAffected = false
      let parentMentionDecrement = 0
      // Номера плотные, перебор ограничен прежним горизонтом либо началом
      // клиентского пространства (горизонта не было).
      const from = Math.max(readMaxId, MESSAGE_ID_OFFSET)
      for (let mid = maxId; mid > from; --mid) {
        const message = messages.getMessageByPeer(peerId, mid)
        if (!message || !!message.pFlags.out) continue
        if (getMessageThreadId(message, { isForum: forum }) !== topicId) continue
        foundAffected = true
        newUnreadCount = --topic.unread_count
        if (isMentionUnread(message)) {
          newUnreadMentionsCount = --topic.unread_mentions_count
          ++parentMentionDecrement
        }
      }
      topic.read_inbox_max_id = Math.max(topic.read_inbox_max_id, maxId)
      if (newUnreadCount < 0 || maxId >= topic.top_message || !readMaxId) topic.unread_count = 0
      else if (newUnreadCount && topic.top_message > maxId) topic.unread_count = newUnreadCount
      if (newUnreadMentionsCount < 0 || !topic.unread_count) topic.unread_mentions_count = 0
      onOps(unreadOps(topic))
      if (!foundAffected && topic.unread_count) void load(peerId).catch(() => {})
      if (parentMentionDecrement > 0) deps.onParentMentionsRead?.(peerId, parentMentionDecrement)
    },

    /**
     * `chat_toggle_forum` (`dialogs.ts:186-192`): форум выключили — кэш тем
     * сбрасывается (`flushForumTopicsCache`, `:1981-2005`); в обоих случаях
     * строка форума пересчитывает бейдж (`processChangedUnreadOrUnmuted`).
     */
    onChatToggleForum(peerId: PeerId, enabled: boolean): void {
      const ops: ForumTopicOp[] = []
      if (!enabled && caches.delete(peerId)) ops.push({ op: 'flush', peerId })
      ops.push({ op: 'forumUnread', peerId })
      onOps(ops)
    },

    /** Смена сессии — всё хранилище в памяти (у оригинала — новый воркер). */
    reset(): void {
      caches.clear()
    },
  }
}

export type ForumTopicsStorage = ReturnType<typeof newForumTopicsStorage>
