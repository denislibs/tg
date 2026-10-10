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

  it('`updatePinnedForumTopics{order}` → порядок закрепа', async () => {
    const { core, ops } = await boot()
    capturedConnDeps!.onFrame('pinned_forum_topics', { _: 'updatePinnedForumTopics', peer: { _: 'peerChannel', channel_id: 50 }, order: [10, 1] })
    await vi.waitFor(() => expect(ops.some((op) => op.op === 'update')).toBe(true))
    const page = await core.registry.forumTopics.getForumTopics(FORUM)
    expect(page.dialogs.map((t) => t.id)).toEqual([generateMessageId(10), generateMessageId(1)])
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

  it('`updateReadChannelDiscussionInbox` → горизонт темы и её счётчик', async () => {
    const { core, ops } = await boot()
    capturedConnDeps!.onFrame('read_discussion', { _: 'updateReadChannelDiscussionInbox', channel_id: 50, top_msg_id: 10, read_max_id: 12 })
    expect(ops.map((op) => op.op)).toEqual(['unread', 'forumUnread'])
    expect(core.registry.forumTopics.getForumTopic(FORUM, generateMessageId(10))!.read_inbox_max_id).toBe(generateMessageId(12))
  })

  // tweb chat_toggle_forum (appChatsManager.ts:304-306 → dialogs.ts:186-192)
  it('карточка чата без `forum` → `flush` тем', async () => {
    const { core, ops } = await boot()
    core.registry.peers.saveApiPeers({ chats: [forumChat(false)] })
    expect(ops).toEqual([{ op: 'flush', peerId: FORUM }, { op: 'forumUnread', peerId: FORUM }])
    expect(core.registry.forumTopics.getForumTopic(FORUM, generateMessageId(10))).toBeUndefined()
  })
})
