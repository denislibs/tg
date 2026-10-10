// Хранилище тем в воркере — порт `dialogsStorage.forumTopics` (Б-54). Пины
// поведений оригинала с адресами tweb у каждого теста.
import { describe, expect, it, vi } from 'vitest'
import { newForumTopicsStorage, type MessagesForumTopics } from './forumTopicsStorage'
import type { ForumTopicOp, ForumTopicWire } from '../dialogs/forumTopic'
import type { MyMessage } from '../models'
import type { Chat } from '../peers/peer'
import { GENERAL_TOPIC_ID, generateMessageId } from '../history/messageId'
import { makeMessage, makeServiceMessage } from '../messages/testMessage'

const FORUM: PeerId = -50
const ME = 1
const OTHER = 2
const forumChat = { _: 'channel', id: 50, title: 'Форум', pFlags: { megagroup: true, forum: true } } as unknown as Chat
const mid = (n: number) => generateMessageId(n)

const wire = (id: number, over: Partial<ForumTopicWire> = {}): ForumTopicWire => ({
  _: 'forumTopic',
  id,
  date: 1_700_000_000,
  peer: { _: 'peerChannel', channel_id: 50 },
  title: 'Тема ' + id,
  icon_color: 1,
  from_id: { _: 'peerUser', user_id: OTHER },
  top_message: id,
  read_inbox_max_id: id,
  read_outbox_max_id: 0,
  unread_count: 0,
  unread_mentions_count: 0,
  notify_settings: { _: 'peerNotifySettings' },
  ...over,
})

function setup(topics: ForumTopicWire[], opts: { forum?: boolean } = {}) {
  const ops: ForumTopicOp[] = []
  const store = new Map<number, MyMessage>()
  const response = (): MessagesForumTopics => ({ _: 'messages.forumTopics', count: topics.length, topics, messages: [], chats: [], users: [] })
  const get = vi.fn(async (_path: string) => response())
  const onParentMentionsRead = vi.fn()
  const storage = newForumTopicsStorage({
    rest: { get } as never,
    peers: { saveApiPeers: vi.fn(), cachedPeer: () => (opts.forum === false ? undefined : forumChat) },
    messages: {
      saveApiMessages: vi.fn(async () => []),
      getMessageByPeer: (_peerId, id) => store.get(id),
    },
    getMeId: () => ME,
    onOps: (o) => { ops.push(...o) },
    onParentMentionsRead,
  })
  return { storage, ops, get, store, onParentMentionsRead }
}

const msgInTopic = (id: number, topic: number, over: Partial<Parameters<typeof makeMessage>[0]> = {}) =>
  makeMessage({ id: mid(id), peerId: FORUM, fromId: OTHER, replyToMsgId: mid(topic), forumTopic: true, date: 1_800_000_000 + id, ...over })

describe('forumTopicsStorage: страница и номера', () => {
  // tweb processTopics (dialogs.ts:2219): id темы → клиентский номер; General — GENERAL_TOPIC_ID
  it('номера тем и горизонтов — клиентские, General — GENERAL_TOPIC_ID', async () => {
    const { storage, get } = setup([wire(1, { title: 'General' }), wire(10)])
    const page = await storage.getForumTopics(FORUM)
    expect(get).toHaveBeenCalledWith('/chats/-50/topics')
    const ids = page.dialogs.map((t) => t.id).sort()
    expect(ids).toEqual([GENERAL_TOPIC_ID, mid(10)])
    const t10 = storage.getForumTopic(FORUM, mid(10))!
    expect(t10.top_message).toBe(mid(10))
    expect(t10.read_inbox_max_id).toBe(mid(10))
    expect(t10.peerId).toBe(FORUM)
  })

  it('загруженный список — из памяти, повторной сети нет (cache-first)', async () => {
    const { storage, get } = setup([wire(10)])
    await storage.getForumTopics(FORUM)
    await storage.getForumTopics(FORUM)
    expect(get).toHaveBeenCalledTimes(1)
  })

  // generateIndexForDialog (dialogs.ts:997-1020): закреплённые — выше, в порядке закрепа
  it('порядок: закреплённые по порядку ответа, затем по дате последнего', async () => {
    const { storage, store } = setup([wire(20, { pFlags: { pinned: true } }), wire(30, { pFlags: { pinned: true } }), wire(10), wire(40)])
    store.set(mid(10), makeMessage({ id: mid(10), peerId: FORUM, date: 2_000_000_000 }))
    store.set(mid(40), makeMessage({ id: mid(40), peerId: FORUM, date: 1_000_000_000 }))
    const page = await storage.getForumTopics(FORUM)
    expect(page.dialogs.map((t) => t.id)).toEqual([mid(20), mid(30), mid(10), mid(40)])
  })

  // getForumUnreadCount (dialogs.ts:2229-2258): число непрочитанных ТЕМ
  it('getForumUnreadCount: не загружен — ответа нет и загрузка с `forumUnread`, загружен — число тем', async () => {
    const { storage, ops } = setup([wire(10, { unread_count: 5 }), wire(20, { unread_count: 1, notify_settings: { _: 'peerNotifySettings', mute_until: 2_000_000_000 } }), wire(30)])
    expect(storage.getForumUnreadCount(FORUM)).toBeUndefined()
    await vi.waitFor(() => expect(ops.some((op) => op.op === 'forumUnread' && op.peerId === FORUM)).toBe(true))
    const r = storage.getForumUnreadCount(FORUM)!
    expect(r.count).toBe(2)
    expect(r.unreadNotifySettings.map((s) => s.mute_until)).toContain(2_000_000_000)
  })

  it('getForumUnreadCount: не форум — ответа нет и в сеть не ходит', () => {
    const { storage, get } = setup([wire(10)], { forum: false })
    expect(storage.getForumUnreadCount(FORUM)).toBeUndefined()
    expect(get).not.toHaveBeenCalled()
  })
})

describe('forumTopicsStorage: новое сообщение (onUpdateNewMessage, appMessagesManager.ts:10242-10520)', () => {
  it('чужое в теме: +1 непрочитанное, последнее, индекс; `update` + `unread` + `forumUnread`', async () => {
    const { storage, ops } = setup([wire(10)])
    await storage.getForumTopics(FORUM)
    ops.length = 0
    const m = msgInTopic(15, 10)
    storage.applyNewMessage(m)
    const t = storage.getForumTopic(FORUM, mid(10))!
    expect(t.unread_count).toBe(1)
    expect(t.top_message).toBe(mid(15))
    expect(t.lastMessage).toBe(m)
    expect(ops.map((op) => op.op)).toEqual(['update', 'unread', 'forumUnread'])
  })

  it('своё сообщение счётчик не двигает; повтор старого — тоже (`m.id > top_message`)', async () => {
    const { storage } = setup([wire(10)])
    await storage.getForumTopics(FORUM)
    storage.applyNewMessage(msgInTopic(15, 10, { fromId: ME, out: true }))
    storage.applyNewMessage(msgInTopic(12, 10))
    expect(storage.getForumTopic(FORUM, mid(10))!.unread_count).toBe(0)
    expect(storage.getForumTopic(FORUM, mid(10))!.top_message).toBe(mid(15))
  })

  // getMessageThreadId (getMessageThreadId.ts:17-24): без forum_topic — General
  it('сообщение без `forum_topic` — в General', async () => {
    const { storage } = setup([wire(1, { title: 'General' }), wire(10)])
    await storage.getForumTopics(FORUM)
    storage.applyNewMessage(makeMessage({ id: mid(20), peerId: FORUM, fromId: OTHER }))
    expect(storage.getForumTopic(FORUM, GENERAL_TOPIC_ID)!.unread_count).toBe(1)
    expect(storage.getForumTopic(FORUM, mid(10))!.unread_count).toBe(0)
  })

  it('упоминание: +1 к упоминаниям темы', async () => {
    const { storage } = setup([wire(10)])
    await storage.getForumTopics(FORUM)
    const m = msgInTopic(15, 10, { mediaUnread: true })
    m.pFlags.mentioned = true
    storage.applyNewMessage(m)
    expect(storage.getForumTopic(FORUM, mid(10))!.unread_mentions_count).toBe(1)
  })

  // :10307-10319 + createBotforumTopicFromAction — тема строится из служебки
  it('служебка создания: тема строится сразу, без сети', async () => {
    const { storage, get, ops } = setup([wire(10)])
    await storage.getForumTopics(FORUM)
    ops.length = 0
    storage.applyNewMessage(makeServiceMessage({ id: mid(30), peerId: FORUM, fromId: OTHER, date: 1_900_000_000, action: { _: 'messageActionTopicCreate', title: 'Новая', icon_color: 2 } }))
    const t = storage.getForumTopic(FORUM, mid(30))!
    expect(t).toMatchObject({ title: 'Новая', icon_color: 2, top_message: mid(30), unread_count: 1 })
    expect(get).toHaveBeenCalledTimes(1)
    expect(ops[0]).toMatchObject({ op: 'update', peerId: FORUM })
  })

  // getForumTopicById (dialogs.ts:2053-2180) — у нас перечитывание списка (расхождение 1)
  it('сообщение неизвестной темы — список перечитывается', async () => {
    const { storage, get } = setup([wire(10)])
    await storage.getForumTopics(FORUM)
    storage.applyNewMessage(msgInTopic(50, 40))
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  })

  it('список ни разу не грузили — ничего не делает и в сеть не ходит', () => {
    const { storage, get, ops } = setup([wire(10)])
    storage.applyNewMessage(msgInTopic(15, 10))
    expect(get).not.toHaveBeenCalled()
    expect(ops).toEqual([])
  })

  // :10342-10365 — `TopicEdit` правит тему; processTopicUpdate (dialogs.ts:1781-1797) — `edit`
  it('`TopicEdit`: название, закрытие, значок; операция `edit` с тем, что сменилось', async () => {
    const { storage, ops } = setup([wire(10)])
    await storage.getForumTopics(FORUM)
    ops.length = 0
    const edit = (action: Record<string, unknown>, id: number) => makeServiceMessage({
      id: mid(id), peerId: FORUM, fromId: OTHER, replyToMsgId: mid(10), forumTopic: true,
      action: { _: 'messageActionTopicEdit', ...action } as never,
    })
    storage.applyNewMessage(edit({ title: 'Переименована' }, 11))
    let t = storage.getForumTopic(FORUM, mid(10))!
    expect(t.title).toBe('Переименована')
    expect(ops).toContainEqual({ op: 'edit', peerId: FORUM, id: mid(10), title: true, icon: false })

    storage.applyNewMessage(edit({ closed: true }, 12))
    t = storage.getForumTopic(FORUM, mid(10))!
    expect(t.pFlags.closed).toBe(true)
    storage.applyNewMessage(edit({ closed: false }, 13))
    expect(storage.getForumTopic(FORUM, mid(10))!.pFlags.closed).toBeUndefined()

    storage.applyNewMessage(edit({ icon_emoji_emoticon: '🔥' }, 14))
    expect(storage.getForumTopic(FORUM, mid(10))!.icon_emoji).toBe('🔥')
    expect(ops).toContainEqual({ op: 'edit', peerId: FORUM, id: mid(10), title: false, icon: true })
  })

  it('`TopicEdit` General (без `reply_to`) — скрытие General', async () => {
    const { storage } = setup([wire(1, { title: 'General' })])
    await storage.getForumTopics(FORUM)
    storage.applyNewMessage(makeServiceMessage({ id: mid(5), peerId: FORUM, fromId: OTHER, action: { _: 'messageActionTopicEdit', hidden: true } }))
    expect(storage.getForumTopic(FORUM, GENERAL_TOPIC_ID)!.pFlags.hidden).toBe(true)
  })
})

describe('forumTopicsStorage: закреп, мьют, форум', () => {
  // onUpdatePinnedForumTopic (dialogs.ts:2480-2490) → handleDialogTogglePinned (:2354-2366)
  it('`updatePinnedForumTopic`: закреп поднимает тему наверх, открепление — возвращает', async () => {
    const { storage, ops } = setup([wire(10), wire(20)])
    const page = await storage.getForumTopics(FORUM)
    const before = page.dialogs.map((t) => t.id)
    ops.length = 0
    storage.applyPinnedTopic(FORUM, before[1], true)
    expect(storage.getForumTopic(FORUM, before[1])!.pFlags.pinned).toBe(true)
    expect((await storage.getForumTopics(FORUM)).dialogs[0].id).toBe(before[1])
    expect(ops).toEqual([{ op: 'update', peerId: FORUM, topics: [storage.getForumTopic(FORUM, before[1])] }])

    storage.applyPinnedTopic(FORUM, before[1], false)
    expect(storage.getForumTopic(FORUM, before[1])!.pFlags.pinned).toBeUndefined()
    expect((await storage.getForumTopics(FORUM)).dialogs.map((t) => t.id)).toEqual(before)
  })

  // onUpdatePinnedForumTopics (dialogs.ts:2601-2638): порядок — handleDialogsPinned; без порядка — перечитать
  it('`updatePinnedForumTopics`: порядок задаёт закреп, отсутствующие в нём открепляются', async () => {
    const { storage } = setup([wire(10, { pFlags: { pinned: true } }), wire(20), wire(30)])
    await storage.getForumTopics(FORUM)
    await storage.applyPinnedTopics(FORUM, [mid(30), mid(20)])
    const page = await storage.getForumTopics(FORUM)
    expect(page.dialogs.slice(0, 2).map((t) => t.id)).toEqual([mid(30), mid(20)])
    expect(storage.getForumTopic(FORUM, mid(10))!.pFlags.pinned).toBeUndefined()
  })

  it('`updatePinnedForumTopics` без порядка — перечитывает список', async () => {
    const { storage, get } = setup([wire(10)])
    await storage.getForumTopics(FORUM)
    await storage.applyPinnedTopics(FORUM)
    expect(get).toHaveBeenCalledTimes(2)
  })

  // onUpdateNotifySettings (appMessagesManager.ts:11751-11770) для `notifyForumTopic`
  it('мьют темы со сроком: `notify` + `forumUnread`', async () => {
    const { storage, ops } = setup([wire(10)])
    await storage.getForumTopics(FORUM)
    ops.length = 0
    storage.applyNotifySettings(FORUM, mid(10), { _: 'peerNotifySettings', mute_until: 1_900_000_000 })
    expect(storage.getForumTopic(FORUM, mid(10))!.notify_settings.mute_until).toBe(1_900_000_000)
    expect(ops.map((op) => op.op)).toEqual(['notify', 'forumUnread'])
  })

  // chat_toggle_forum (dialogs.ts:186-192) → flushForumTopicsCache (:1981-2005)
  it('форум выключили — кэш тем сброшен (`flush`), включили — только `forumUnread`', async () => {
    const { storage, ops, get } = setup([wire(10)])
    await storage.getForumTopics(FORUM)
    ops.length = 0
    storage.onChatToggleForum(FORUM, false)
    expect(storage.getForumTopic(FORUM, mid(10))).toBeUndefined()
    expect(ops).toEqual([{ op: 'flush', peerId: FORUM }, { op: 'forumUnread', peerId: FORUM }])
    await storage.getForumTopics(FORUM)
    expect(get).toHaveBeenCalledTimes(2)
  })
})

describe('forumTopicsStorage: прочтение треда (onUpdateReadHistory, appMessagesManager.ts:10795-10990)', () => {
  it('inbox: гасит прочитанные сообщения темы, упоминания уходят и из бейджа форума', async () => {
    const { storage, store, onParentMentionsRead } = setup([wire(10, { read_inbox_max_id: 10, top_message: 13, unread_count: 3, unread_mentions_count: 1 })])
    await storage.getForumTopics(FORUM)
    store.set(mid(11), msgInTopic(11, 10))
    const mention = msgInTopic(12, 10, { mediaUnread: true })
    mention.pFlags.mentioned = true
    store.set(mid(12), mention)
    store.set(mid(13), msgInTopic(13, 10))
    storage.applyReadDiscussion({ peerId: FORUM, topicId: mid(10), maxId: mid(12), out: false })
    const t = storage.getForumTopic(FORUM, mid(10))!
    expect(t.read_inbox_max_id).toBe(mid(12))
    expect(t.unread_count).toBe(1)
    expect(t.unread_mentions_count).toBe(0)
    expect(onParentMentionsRead).toHaveBeenCalledWith(FORUM, 1)
  })

  it('inbox до последнего — непрочитанных ноль', async () => {
    const { storage } = setup([wire(10, { read_inbox_max_id: 10, top_message: 13, unread_count: 3 })])
    await storage.getForumTopics(FORUM)
    storage.applyReadDiscussion({ peerId: FORUM, topicId: mid(10), maxId: mid(13), out: false })
    expect(storage.getForumTopic(FORUM, mid(10))!.unread_count).toBe(0)
  })

  it('outbox: двигает горизонт исходящих', async () => {
    const { storage } = setup([wire(10)])
    await storage.getForumTopics(FORUM)
    storage.applyReadDiscussion({ peerId: FORUM, topicId: mid(10), maxId: mid(9), out: true })
    expect(storage.getForumTopic(FORUM, mid(10))!.read_outbox_max_id).toBe(mid(9))
  })
})
