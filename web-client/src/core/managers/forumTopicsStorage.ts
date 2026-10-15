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
//  5. Удалённая тема (`deletedTopics`): у оригинала метку ставит только явный
//     `forumTopicDeleted` в ответе `getForumTopicsByID` — отсутствие там может
//     быть отставанием реплики. Наш сервер `forumTopicDeleted` не производит, а
//     ответ — ПОЛНЫЙ список тем без отставания, поэтому удалённой считается тема,
//     которой нет в успешном ответе. Метка гасит перечитывание по каждому кадру
//     такой темы; служебка создания и появление в ответе её снимают.
import type { RestClient } from '../net/restClient'
import type { Chat, UserReal } from '../peers/peer'
import type { DraftMessage, DraftMessageReal, MyMessage, RawMyMessage } from '../models'
import { getMessageThreadId } from '../models'
import { isForum } from '../peers/predicates'
import { MESSAGE_ID_OFFSET } from '../history/messageId'
import type { PeerNotifySettings } from '../dialogs/notifySettings'
import isMentionUnread from '../messages/isMentionUnread'
import getUnreadReactions from '../messages/getUnreadReactions'
import {
  createForumTopicFromAction,
  toForumTopic,
  topicIndex,
  type ForumTopic,
  type ForumTopicOp,
  type ForumTopicWire,
  type ForumUnreadCount,
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

export type { ForumUnreadCount }

/** Прочтение треда — `updateReadChannelDiscussionInbox/Outbox` в клиентском пространстве. */
export type ReadDiscussion = { peerId: PeerId; topicId: number; maxId: number; out: boolean }

type TopicsCache = {
  topics: Map<number, ForumTopic>
  pinnedOrder: number[]
  loaded: boolean
  loadPromise?: Promise<ForumTopic[]>
  /** `deletedTopics` (`dialogs.ts:109`, `:2066-2068`, `:2084-2096`) — расхождение 5 */
  deletedTopics: Set<number>
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
  /** Черновик темы из ответа списка — словарь черновиков (`appDraftsManager.saveDraft`
   *  без `notify`, `dialogs.ts:1692-1697`): ответ — черновик в клиентских номерах. */
  saveTopicDraft?: (peerId: PeerId, topicId: number, draft: DraftMessage | undefined) => DraftMessageReal | undefined
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
    if (!cache) caches.set(peerId, cache = { topics: new Map(), pinnedOrder: [], loaded: false, deletedTopics: new Set() })
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
      for (const topic of topics) {
        cache.deletedTopics.delete(topic.id)
        // `dialogs.ts:1692-1697`
        const draft = deps.saveTopicDraft ? deps.saveTopicDraft(peerId, topic.id, topic.draft) : undefined
        if (draft) topic.draft = draft
        else delete topic.draft
        saveTopic(cache, topic)
      }
      cache.loaded = true
      const ops: ForumTopicOp[] = dropped.map((id) => ({ op: 'drop', peerId, id }))
      ops.push({ op: 'update', peerId, topics: sorted(cache) }, forumUnreadOp(peerId))
      onOps(ops)
      return sorted(cache)
    })()
    cache.loadPromise = promise
    void promise.finally(() => { if (cache.loadPromise === promise) cache.loadPromise = undefined }).catch(() => {})
    return promise
  }

  /**
   * Тему, которой нет в кэше, — перечитать список (`getForumTopicById`,
   * `dialogs.ts:2053-2180`, расхождение 1); нет и в успешном ответе — метка
   * `deletedTopics` (расхождение 5), отказ сети метку не ставит (`:2084-2096`).
   */
  async function reloadForTopic(peerId: PeerId, topicId: number): Promise<ForumTopic | undefined> {
    const cache = getCache(peerId)
    if (cache.deletedTopics.has(topicId)) return undefined
    await load(peerId)
    const topic = caches.get(peerId)?.topics.get(topicId)
    if (!topic && caches.get(peerId) === cache) cache.deletedTopics.add(topicId)
    return topic
  }

  /** tweb `getForumUnreadCount` (`dialogs.ts:2229-2258`) по загруженному списку. */
  function forumUnread(cache: TopicsCache): ForumUnreadCount {
    const top = sorted(cache).slice(0, FORUM_UNREAD_LIMIT).filter((t) => t.unread_count)
    return { count: top.length, unreadNotifySettings: top.map((t) => t.notify_settings) }
  }

  /** `forumUnread` со значением — счётчикам папок вкладки (`core/dialogs/forumUnreadMirror.ts`). */
  function forumUnreadOp(peerId: PeerId): ForumTopicOp {
    const cache = caches.get(peerId)
    return cache?.loaded ? { op: 'forumUnread', peerId, unread: forumUnread(cache) } : { op: 'forumUnread', peerId }
  }

  /** Объявить изменённую тему (`scheduleHandleNewDialogs` → `dialogs_multiupdate`). */
  function emitUpdate(topic: ForumTopic, extra: ForumTopicOp[] = []): void {
    onOps([{ op: 'update', peerId: topic.peerId, topics: [topic] }, ...extra])
  }

  /** `dialog_unread` темы + пересчёт бейджа форума (`dialogs.ts:968-985`). */
  const unreadOps = (topic: ForumTopic): ForumTopicOp[] =>
    [{ op: 'unread', topic }, forumUnreadOp(topic.peerId)]

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

  /**
   * Прочтение треда темы — ветка темы `onUpdateReadHistory`
   * (`appMessagesManager.ts:10795-10990`).
   * Перебираются сообщения треда, которые знает хранилище сообщений, между
   * прежним и новым горизонтом; упоминания уходят и из бейджа форума
   * (`:10969-10980`). Ничего не нашли, а тема всё ещё непрочитана —
   * перечитать (`getForumTopicById`, `:10955-10958`, расхождение 1).
   *
   * Не переносятся (предметов нет): снятие `pFlags.unread` с сообщений
   * (`:10872-10874` — у нашего сообщения флага нет, прочитанность считается по
   * горизонту) и `notification_cancel` (`:10900` — события снятия уведомления
   * вкладки у нас нет).
   *
   * Зовут своё прочтение (`threadReads.readHistory` — местный
   * `processLocalUpdate`, `:9203-9209`) и кадры `updateReadChannelDiscussionInbox/
   * Outbox` (`workerCore.ts::dispatch` → `threadReads.applyReadDiscussion`).
   */
  function applyReadDiscussion({ peerId, topicId, maxId, out }: ReadDiscussion): void {
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
    topic.read_inbox_max_id = maxId // `:10928-10929` — присваивание, как у оригинала
    if (newUnreadCount < 0 || maxId >= topic.top_message || !readMaxId) topic.unread_count = 0
    else if (newUnreadCount && topic.top_message > maxId) topic.unread_count = newUnreadCount
    if (newUnreadMentionsCount < 0 || !topic.unread_count) topic.unread_mentions_count = 0
    onOps(unreadOps(topic))
    if (!foundAffected && topic.unread_count) void load(peerId).catch(() => {})
    if (parentMentionDecrement > 0) deps.onParentMentionsRead?.(peerId, parentMentionDecrement)
  }

  /** `modifyCachedMentionsAndSave` для одного счётчика темы: `true` — +1, `false` — −1 (не ниже нуля). */
  function modifyBadge(peerId: PeerId, topicId: number, key: 'unread_reactions_count' | 'unread_mentions_count', add: boolean): void {
    const topic = caches.get(peerId)?.topics.get(topicId)
    if (!topic) return
    topic[key] = add ? topic[key] + 1 : Math.max(0, topic[key] - 1)
    onOps(unreadOps(topic))
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
      return caches.get(peerId)?.topics.get(topicId) ?? reloadForTopic(peerId, topicId)
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
      return forumUnread(cache)
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

      const topic = cache.topics.get(threadId)
      if (!topic) {
        if (m._ === 'messageService' && topicCreate) {
          const created = createForumTopicFromAction(m)
          if (created) {
            cache.deletedTopics.delete(created.id)
            saveTopic(cache, created)
            emitUpdate(created, [forumUnreadOp(peerId)])
          }
        } else {
          void reloadForTopic(peerId, threadId).catch(() => {})
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
        if (title || icon) edit = { op: 'edit', topic, title, icon }
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
     * `updateNotifySettings{peer: notifyForumTopic}` — `onUpdateNotifySettings`
     * (`appMessagesManager.ts:11751-11770`) для темы, и пересчёт бейджа форума
     * (`dialog_notify_settings` → `processChangedUnreadOrUnmuted`, `dialogs.ts:174-176`).
     * Тот же вход — своё действие после ответа сети.
     */
    applyNotifySettings(peerId: PeerId, topicId: number, settings: PeerNotifySettings): void {
      const topic = caches.get(peerId)?.topics.get(topicId)
      if (!topic) return
      topic.notify_settings = settings
      onOps([{ op: 'notify', topic }, forumUnreadOp(peerId)])
    },

    applyReadDiscussion,

    /**
     * Бейдж ❤ темы ±1 — `modifyCachedMentionsAndSave({threadId, addReaction})`
     * (`appMessagesManager.ts:9330-9363`, вызов из `onUpdateMessageReactions`
     * :10568-10575). Темы нет в кэше — ничего, как `if(!dialog) return` там.
     */
    modifyUnreadReactions(peerId: PeerId, topicId: number, add: boolean): void {
      modifyBadge(peerId, topicId, 'unread_reactions_count', add)
    },

    /** Бейдж «@» темы ±1 — тот же `modifyCachedMentionsAndSave` с `addMention`. */
    modifyUnreadMentions(peerId: PeerId, topicId: number, add: boolean): void {
      modifyBadge(peerId, topicId, 'unread_mentions_count', add)
    },

    /**
     * Ответ `readMentions`/`readReactions` в теме обнуляет её счётчик
     * (`modifyCachedMentionsAndSave({addMention|addReaction: -dialog.count})`,
     * :9636-9644). Темы нет в кэше — ничего.
     */
    clearUnread(peerId: PeerId, topicId: number, isReaction: boolean): void {
      const topic = caches.get(peerId)?.topics.get(topicId)
      if (!topic) return
      topic[isReaction ? 'unread_reactions_count' : 'unread_mentions_count'] = 0
      onOps(unreadOps(topic))
    },

    /** Счётчики тем форума устарели (кадр коснулся сообщения, которого нет в памяти) — список перечитывается, если он уже загружен. */
    reload(peerId: PeerId): void {
      if (caches.get(peerId)?.loaded) void load(peerId).catch(() => {})
    },

    /** Счётчики «@» и ❤ темы — часть `getAnyDialog(peerId, threadId)`, которую читает `readMessages` (:9564-9566). */
    getUnreadBadge(peerId: PeerId, topicId: number): { mentions: number; reactions: number } | undefined {
      const topic = caches.get(peerId)?.topics.get(topicId)
      return topic ? { mentions: topic.unread_mentions_count, reactions: topic.unread_reactions_count } : undefined
    },

    /**
     * Черновик треда изменился — ветка темы слушателя `draft_updated`
     * (`appMessagesManager.ts:858-901`): черновик в строку, индекс (дата
     * черновика двигает тему, `getDialogActivityDate`), `dialog_draft` списку.
     * Темы нет в загруженном списке — перечитать (`getForumTopicById`,
     * расхождение 1); список ни разу не грузили — первый показ возьмёт его с
     * сервера уже с черновиком. Ветки `drop` (`:876-878`) у темы нет: тема всегда
     * держит служебку создания (`top_message`).
     */
    applyDraft(peerId: PeerId, topicId: number, draft: DraftMessageReal | undefined): void {
      const cache = caches.get(peerId)
      if (!cache?.loaded) return
      const topic = cache.topics.get(topicId)
      if (!topic) {
        if (isForumPeer(peerId)) void reloadForTopic(peerId, topicId).catch(() => {})
        return
      }
      if (draft) topic.draft = draft
      else delete topic.draft
      reindex(cache, topic)
      emitUpdate(topic)
    },

    /**
     * Удаление сообщений — ветка темы `onUpdateDeleteMessages`
     * (`appMessagesManager.ts:11493-11592`): удалённое непрочитанное снимается
     * со счётчиков своей темы (упоминания — только пока непрочитанное есть,
     * реакции — у своих), бейдж темы и форума пересчитываются. Удалено
     * последнее сообщение темы — список перечитывается (`getForumTopicById`,
     * расхождение 1; низа окна треда владелец тем не держит). Номер — по
     * сообщениям, которые знало хранилище: неизвестные удалённые не считаются,
     * как и у оригинала.
     */
    applyDeletedMessages(peerId: PeerId, deleted: readonly MyMessage[]): void {
      const cache = caches.get(peerId)
      if (!cache?.loaded || !deleted.length) return
      const byTopic = new Map<number, MyMessage[]>()
      for (const m of deleted) {
        const threadId = getMessageThreadId(m, { isForum: true })
        if (threadId === undefined) continue
        const list = byTopic.get(threadId)
        if (list) list.push(m)
        else byTopic.set(threadId, [m])
      }
      const ops: ForumTopicOp[] = []
      let reload = false
      for (const [threadId, list] of byTopic) {
        const topic = cache.topics.get(threadId)
        if (!topic) continue
        let unread = 0
        let unreadMentions = 0
        let unreadReactions = 0
        for (const m of list) {
          if (!m.pFlags?.out && m.id > topic.read_inbox_max_id) {
            ++unread
            if (isMentionUnread(m)) ++unreadMentions
          }
          if (m.pFlags?.out && getUnreadReactions(m)) ++unreadReactions
        }
        if (unread) topic.unread_count = Math.max(0, topic.unread_count - unread)
        if (unreadMentions) topic.unread_mentions_count = !topic.unread_count ? 0 : Math.max(0, topic.unread_mentions_count - unreadMentions)
        if (unreadReactions) topic.unread_reactions_count = Math.max(0, topic.unread_reactions_count - unreadReactions)
        if (unread || unreadMentions || unreadReactions) ops.push({ op: 'unread', topic })
        if (list.some((m) => m.id === topic.top_message)) reload = true
      }
      if (ops.length) {
        ops.push(forumUnreadOp(peerId))
        onOps(ops)
      }
      if (reload) void load(peerId).catch(() => {})
    },

    /**
     * `chat_toggle_forum` (`dialogs.ts:186-192`): форум выключили — кэш тем
     * сбрасывается молча (`flushForumTopicsCache`, `:1981-2005`, событий не
     * шлёт); в обоих случаях строка форума пересчитывает бейдж
     * (`processChangedUnreadOrUnmuted`).
     */
    onChatToggleForum(peerId: PeerId, enabled: boolean): void {
      if (!enabled) caches.delete(peerId)
      onOps([forumUnreadOp(peerId)])
    },

    /** Смена сессии — всё хранилище в памяти (у оригинала — новый воркер). */
    reset(): void {
      caches.clear()
    },
  }
}

export type ForumTopicsStorage = ReturnType<typeof newForumTopicsStorage>
