// Проводка хранилища тем в воркере (Б-54): createWorkerCore() РЕАЛЬНО отдаёт
// хранилищу тем живые кадры — новое сообщение темы, закреп, мьют
// `notifyForumTopic`, прочтение треда, выключение форума — и вкладка получает
// операции `rt:forum_topic_op`. Само хранилище покрыто
// `managers/forumTopicsStorage.test.ts`; здесь — строки проводки
// (`workerCore.ts::dispatch`, `routeNewMessage`, `onChatToggleForum`).
//
// Приём — тот же, что в workerCore.dialogFrames.test.ts: перехватываем onFrame
// connectionManager и зовём его как WS-транспорт; кадры без `pts` funnel
// пропускает безусловно.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { CMDeps } from './realtime/connectionManager'
import type { ForumTopicOp } from './dialogs/forumTopic'
import type { DialogOp } from './dialogs/dialogOps'

let capturedConnDeps: CMDeps | null = null
vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: CMDeps) => {
      capturedConnDeps = deps
      return actual.newConnectionManager(deps)
    },
  }
})

// Счётчик разборов кадра (независимое ревью КЛ-1 М5): обёртка пропускает вызов насквозь.
const mapMessageSpy = vi.hoisted(() => ({ calls: 0 }))
vi.mock('./models', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./models')>()
  return {
    ...actual,
    mapMessage: (...args: Parameters<typeof actual.mapMessage>) => { ++mapMessageSpy.calls; return actual.mapMessage(...args) },
  }
})

import { createWorkerCore } from './workerCore'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { makeRawMessage } from './messages/testMessage'
import { generateMessageId } from './history/messageId'
import type { Chat } from './peers/peer'

function pair(): [Endpoint, Endpoint] {
  const listenersA: Array<(ev: MessageEvent) => void> = []
  const listenersB: Array<(ev: MessageEvent) => void> = []
  const epA: Endpoint = {
    postMessage: (m) => { for (const l of listenersB) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersA.push(l) },
  }
  const epB: Endpoint = {
    postMessage: (m) => { for (const l of listenersA) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersB.push(l) },
  }
  return [epA, epB]
}

const FORUM = -50
const forumChat = (forum: boolean) => ({ _: 'channel', id: 50, title: 'Форум', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true, ...(forum ? { forum: true } : {}) } }) as unknown as Chat
const topic = (id: number, over: Record<string, unknown> = {}) => ({
  _: 'forumTopic', id, date: 1, peer: { _: 'peerChannel', channel_id: 50 }, title: 'T' + id, icon_color: 0,
  from_id: { _: 'peerUser', user_id: 2 }, top_message: id, read_inbox_max_id: id, read_outbox_max_id: 0,
  unread_count: 0, unread_mentions_count: 0, notify_settings: { _: 'peerNotifySettings' }, ...over,
})

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedConnDeps = null
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    if (String(url).endsWith('/auth/logout')) return new Response('{}', { status: 200 })
    if (String(url).endsWith('/auth/sign_in')) {
      return new Response(JSON.stringify({ _: 'auth.authorization', token: 'session-b', user: { _: 'user', pFlags: { self: true }, id: 5, phone: '+79990000005' } }), { status: 200 })
    }
    if (String(url).includes('/channels/-3/posts/9/discussion')) {
      return new Response(JSON.stringify({ _: 'messages.discussionMessage', messages: [makeRawMessage({ id: 200, peerId: -70, fromId: -3, text: 'пост' })], max_id: 230, read_inbox_max_id: 225, unread_count: 2, chats: [], users: [] }), { status: 200 })
    }
    if (String(url).includes('/chats/-70/threads/')) return new Response('true', { status: 200 })
    if (String(url).includes('/chats/-50/topics')) {
      return new Response(JSON.stringify({ _: 'messages.forumTopics', count: 2, topics: [topic(1), topic(10)], messages: [], chats: [], users: [] }), { status: 200 })
    }
    throw new Error('unexpected fetch ' + String(url))
  }))
})

async function boot() {
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  const tab = new SuperMessagePort(epTab)
  const ops: ForumTopicOp[] = []
  const dialogOps: DialogOp[] = []
  tab.on('rt:forum_topic_op', (p) => ops.push(...(p as { ops: ForumTopicOp[] }).ops))
  tab.on('rt:dialog_op', (p) => dialogOps.push(...(p as { ops: DialogOp[] }).ops))
  core.registry.peers.saveApiPeers({ chats: [forumChat(true)] })
  // Сообщения контейнера ждут гидрации личности (гейт `meReady`) — без `start()`
  // промис не резолвится (тот же приём, что workerCore.dialogFrames.test.ts).
  core.start()
  // список тем — через RPC вкладки, как его берёт форум-таб
  await tab.invoke('manager', { name: 'forumTopics', method: 'getForumTopics', args: [FORUM] })
  ops.length = 0
  expect(capturedConnDeps).not.toBeNull()
  return { core, ops, dialogOps }
}

describe('createWorkerCore(): кадры тем применяет хранилище тем', () => {
  it('новое сообщение темы → `update` + `unread` + `forumUnread`', async () => {
    const { ops } = await boot()
    const raw = makeRawMessage({ id: 15, peerId: FORUM, fromId: 2, text: 'в теме', replyToMsgId: 10, forumTopic: true })
    capturedConnDeps!.onFrame('new_message', { _: 'updateNewChannelMessage', message: raw })
    await vi.waitFor(() => expect(ops.map((op) => op.op)).toEqual(['update', 'unread', 'forumUnread']))
    const update = ops[0] as Extract<ForumTopicOp, { op: 'update' }>
    expect(update.topics[0]).toMatchObject({ id: generateMessageId(10), unread_count: 1, top_message: generateMessageId(15) })
  })

  it('`updatePinnedForumTopic` → тема закреплена (номер — клиентский)', async () => {
    const { ops } = await boot()
    capturedConnDeps!.onFrame('pinned_forum_topic', { _: 'updatePinnedForumTopic', pFlags: { pinned: true }, peer: { _: 'peerChannel', channel_id: 50 }, topic_id: 10 })
    const update = ops.find((op) => op.op === 'update') as Extract<ForumTopicOp, { op: 'update' }>
    expect(update.topics[0]).toMatchObject({ id: generateMessageId(10), pFlags: { pinned: true } })
  })

  it('`updateNotifySettings{notifyForumTopic}` → мьют темы, а не диалога', async () => {
    const { ops, dialogOps } = await boot()
    capturedConnDeps!.onFrame('dialog_mute', {
      _: 'updateNotifySettings',
      peer: { _: 'notifyForumTopic', peer: { _: 'peerChannel', channel_id: 50 }, top_msg_id: 10 },
      notify_settings: { _: 'peerNotifySettings', mute_until: 1_900_000_000 },
    })
    expect(ops.map((op) => op.op)).toEqual(['notify', 'forumUnread'])
    expect((ops[0] as Extract<ForumTopicOp, { op: 'notify' }>).topic.notify_settings.mute_until).toBe(1_900_000_000)
    expect(dialogOps).toEqual([])
  })

  // tweb chat_toggle_forum (appChatsManager.ts:304-306 → dialogs.ts:186-192,
  // appMessagesManager.ts:921-932)
  it('карточка чата без `forum` → кэш тем и окна тредов сброшены, бейдж форума пересчитан', async () => {
    const { core, ops } = await boot()
    const flush = vi.spyOn(core.registry.messages, 'flushThreadWindows')
    core.registry.peers.saveApiPeers({ chats: [forumChat(false)] })
    expect(ops).toEqual([{ op: 'forumUnread', peerId: FORUM }])
    expect(core.registry.forumTopics.getForumTopic(FORUM, generateMessageId(10))).toBeUndefined()
    expect(flush).toHaveBeenCalledWith(FORUM)
  })

  // `realtime.markRead` с `threadId` (лента темы) → `threadReads`: местное
  // прочтение сразу и `messages.readDiscussion` на сервер (tweb readHistory :9186-9210)
  it('прочтение в теме → `unread` с нулём + `forumUnread`, readDiscussion серверными номерами', async () => {
    const { core, ops } = await boot()
    const raw = makeRawMessage({ id: 15, peerId: FORUM, fromId: 2, text: 'в теме', replyToMsgId: 10, forumTopic: true })
    capturedConnDeps!.onFrame('new_message', { _: 'updateNewChannelMessage', message: raw })
    await vi.waitFor(() => expect(ops.map((op) => op.op)).toContain('unread'))
    ops.length = 0
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementationOnce(async () => new Response('true', { status: 200 }))
    await core.registry.realtime.markRead({ peerId: FORUM, upToId: generateMessageId(15), threadId: generateMessageId(10) })
    expect(ops.map((op) => op.op)).toEqual(['unread', 'forumUnread'])
    expect((ops[0] as Extract<ForumTopicOp, { op: 'unread' }>).topic.unread_count).toBe(0)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/chats/-50/threads/10/read'), expect.objectContaining({ method: 'POST', body: JSON.stringify({ read_max_id: 15 }) }))
  })

  // Ревью КЛ-1 В4: смена сессии (onLoggingOut/onLoggedIn, workerCore.ts) — темы
  // прошлого аккаунта не переживают переход (у tweb — новый воркер)
  it('выход и вход сбрасывают хранилище тем', async () => {
    const { core } = await boot()
    expect(core.registry.forumTopics.getForumTopic(FORUM, generateMessageId(10))).toBeDefined()
    await core.registry.auth.logout()
    expect(core.registry.forumTopics.getForumTopic(FORUM, generateMessageId(10))).toBeUndefined()

    await core.registry.forumTopics.getForumTopics(FORUM)
    expect(core.registry.forumTopics.getForumTopic(FORUM, generateMessageId(10))).toBeDefined()
    await core.registry.auth.signIn('+79990000005', '12345', 'dev', 'web')
    expect(core.registry.forumTopics.getForumTopic(FORUM, generateMessageId(10))).toBeUndefined()
  })

  // Ревью КЛ-1 В4: мьют темы из своего действия (groups.updateTopicNotifySettings)
  // применяет хранилище тем после ответа сети (workerCore.ts → groups.forumTopics)
  it('свой мьют темы → `notify` хранилища тем с тем же сроком', async () => {
    const { core, ops } = await boot()
    vi.mocked(fetch).mockImplementationOnce(async () => new Response('true', { status: 200 }))
    await core.registry.groups.updateTopicNotifySettings(FORUM, generateMessageId(10), 0)
    expect(ops.map((op) => op.op)).toEqual(['notify', 'forumUnread'])
    expect((ops[0] as Extract<ForumTopicOp, { op: 'notify' }>).topic.notify_settings).toEqual({ _: 'peerNotifySettings', mute_until: 0 })
  })

  // Ревью КЛ-1 (независимое) В1 — проводка `onMessagesDeleted` к хранилищу тем
  // (tweb onUpdateDeleteMessages :11493-11592, ветка темы)
  it('удаление непрочитанного сообщения темы → `unread` с нулём + `forumUnread`', async () => {
    const { core, ops } = await boot()
    const raw = makeRawMessage({ id: 15, peerId: FORUM, fromId: 2, text: 'в теме', replyToMsgId: 10, forumTopic: true })
    capturedConnDeps!.onFrame('new_message', { _: 'updateNewChannelMessage', message: raw })
    await vi.waitFor(() => expect(ops.map((op) => op.op)).toContain('unread'))
    await core.registry.messages.saveApiMessages([raw])
    ops.length = 0
    core.registry.messages.cacheDelete({ _: 'updateDeletePeerMessages', peer: { _: 'peerChannel', channel_id: 50 }, messages: [15] } as never)
    expect(ops.map((op) => op.op)).toEqual(['unread', 'forumUnread'])
    expect((ops[0] as Extract<ForumTopicOp, { op: 'unread' }>).topic.unread_count).toBe(0)
  })

  // tweb onUpdateNewMessage (appMessagesManager.ts:10243-10253): кадр разбирается
  // один раз, история, диалог и тема читают тот же объект
  it('новое сообщение разбирается один раз на кадр', async () => {
    const { core, ops } = await boot()
    const cacheLive = vi.spyOn(core.registry.messages, 'cacheLive')
    const applyNewMessage = vi.spyOn(core.registry.dialogs, 'applyNewMessage')
    mapMessageSpy.calls = 0
    const raw = makeRawMessage({ id: 16, peerId: FORUM, fromId: 2, text: 'раз', replyToMsgId: 10, forumTopic: true })
    capturedConnDeps!.onFrame('new_message', { _: 'updateNewChannelMessage', message: raw })
    await vi.waitFor(() => expect(ops.map((op) => op.op)).toContain('update'))
    expect(mapMessageSpy.calls).toBe(1)
    // и история, и диалог получили ТОТ ЖЕ разобранный объект — своего разбора у них нет
    const mapped = cacheLive.mock.calls[0][1]
    expect(mapped).toMatchObject({ id: generateMessageId(16) })
    expect(applyNewMessage.mock.calls[0][1]).toBe(mapped)
  })

  // tweb :777-778 → onUpdateReadHistory: кадр с другого устройства гасит тему
  it('`updateReadChannelDiscussionInbox` → тема прочитана (номера клиентские)', async () => {
    const { ops } = await boot()
    const raw = makeRawMessage({ id: 17, peerId: FORUM, fromId: 2, text: 'ещё', replyToMsgId: 10, forumTopic: true })
    capturedConnDeps!.onFrame('new_message', { _: 'updateNewChannelMessage', message: raw })
    await vi.waitFor(() => expect(ops.map((op) => op.op)).toContain('unread'))
    ops.length = 0
    capturedConnDeps!.onFrame('read_discussion', { _: 'updateReadChannelDiscussionInbox', channel_id: 50, top_msg_id: 10, read_max_id: 17 })
    const unread = ops.find((op) => op.op === 'unread') as Extract<ForumTopicOp, { op: 'unread' }>
    expect(unread.topic).toMatchObject({ id: generateMessageId(10), unread_count: 0, read_inbox_max_id: generateMessageId(17) })
  })

  // Тред комментариев: состояние из discussionMessage → `threadReads` (tweb :8843-8846),
  // прочтение — `readDiscussion` номером зеркала, горизонт группы не уходит (:9186-9210)
  it('тред комментариев: горизонт треда для ленты и readDiscussion номером зеркала', async () => {
    const { core } = await boot()
    await core.registry.messages.getDiscussionMessage(-3, generateMessageId(9))
    expect(core.registry.dialogs.getDialogReadState(-70, generateMessageId(200))).toEqual({ readInboxMaxSeq: generateMessageId(225), unreadCount: 2 })
    expect(core.registry.dialogs.getHistoryMaxSeq(-70, generateMessageId(200))).toBe(generateMessageId(230))
    const fetchMock = vi.mocked(fetch)
    await core.registry.realtime.markRead({ peerId: -70, upToId: generateMessageId(230), threadId: generateMessageId(200) })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/chats/-70/threads/200/read'), expect.objectContaining({ body: JSON.stringify({ read_max_id: 230 }) }))
    expect(core.registry.dialogs.getDialogReadState(-70, generateMessageId(200))).toEqual({ readInboxMaxSeq: generateMessageId(230), unreadCount: 0 })
  })
})

