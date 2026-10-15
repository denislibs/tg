// Ф-6, задача 18: бейджи ❤ и «@» тем форума гаснут живьём. Проводка
// `workerCore.ts::dispatch`: кадр `updateMessageReactions{top_msg_id}` ведёт
// бейдж ТЕМЫ (и родителя при прочтении, tweb onUpdateMessageReactions
// :10552-10620), кадр `updateReadPeerMessagesContents` с вектором номеров
// снимает «@» по каждому известному сообщению (onUpdateReadMessagesContents
// :10996-11079), а ответ `readMentions` в теме гасит ТОЛЬКО тему.
//
// Приём — тот же, что в workerCore.forumTopics.test.ts: перехват onFrame
// connectionManager; кадры без `pts` funnel пропускает безусловно.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { CMDeps } from './realtime/connectionManager'
import { saveDialogs } from './store/persist'
import { makeDialog } from './dialogs/testDialog'

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
import { GENERAL_TOPIC_ID, generateMessageId } from './history/messageId'
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
const cid = generateMessageId
const forumChat = { _: 'channel', id: 50, title: 'Форум', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true, forum: true } } as unknown as Chat
const topic = (id: number, over: Record<string, unknown> = {}) => ({
  _: 'forumTopic', id, date: 1, peer: { _: 'peerChannel', channel_id: 50 }, title: 'T' + id, icon_color: 0,
  from_id: { _: 'peerUser', user_id: 2 }, top_message: id, read_inbox_max_id: id, read_outbox_max_id: 0,
  unread_count: 0, unread_mentions_count: 0, notify_settings: { _: 'peerNotifySettings' }, ...over,
})
const unreadReaction = {
  _: 'messagePeerReaction', pFlags: { unread: true }, peer_id: { _: 'peerUser', user_id: 9 }, date: 0,
  reaction: { _: 'reactionEmoji', emoticon: '👍' },
}
const reactions = (unread: boolean) => ({
  _: 'messageReactions',
  results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1 }],
  recent_reactions: [{ ...unreadReaction, pFlags: unread ? { unread: true } : {} }],
})
const mention = { mentioned: true, media_unread: true }

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedConnDeps = null
})

async function boot() {
  await saveDialogs([makeDialog({ peerId: FORUM, unreadMentions: 3, unreadReactions: 2 })])
  const history = [
    // моё сообщение в теме 10 с непрочитанной реакцией, и ещё одно моё, прочитанное
    { ...makeRawMessage({ id: 20, peerId: FORUM, fromId: 1, out: true, text: 'моё', replyToMsgId: 10, forumTopic: true }), pFlags: { out: true }, reactions: reactions(true) },
    { ...makeRawMessage({ id: 21, peerId: FORUM, fromId: 1, out: true, text: 'моё 2', replyToMsgId: 10, forumTopic: true }), pFlags: { out: true } },
    // упоминания: 5 в теме 10, 7 в General
    { ...makeRawMessage({ id: 5, peerId: FORUM, fromId: 9, text: '@я', replyToMsgId: 10, forumTopic: true }), pFlags: mention },
    { ...makeRawMessage({ id: 7, peerId: FORUM, fromId: 9, text: '@я' }), pFlags: mention },
  ]
  const fetchMock = vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes('/drafts')) return new Response(JSON.stringify({ _: 'updates', updates: [] }), { status: 200 })
    if (u.includes('/chats/-50/topics')) {
      return new Response(JSON.stringify({
        _: 'messages.forumTopics', count: 3, messages: [], chats: [], users: [],
        topics: [topic(1, { unread_mentions_count: 1 }), topic(10, { unread_mentions_count: 2, unread_reactions_count: 2 }), topic(11, { unread_reactions_count: 1 })],
      }), { status: 200 })
    }
    if (u.includes('/chats/-50/history')) return new Response(JSON.stringify({ messages: history, count: history.length }), { status: 200 })
    if (u.includes('/peer_dialogs')) return new Response(JSON.stringify({ _: 'messages.peerDialogs', dialogs: [], messages: [], chats: [], users: [] }), { status: 200 })
    if (u.includes('/mentions/read') || u.includes('/reactions/read')) {
      return new Response(JSON.stringify({ _: 'messages.affectedHistory', pts: 13, pts_count: 3, offset: 0 }), { status: 200 })
    }
    throw new Error('unexpected fetch ' + u)
  })
  vi.stubGlobal('fetch', fetchMock)
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  const tab = new SuperMessagePort(epTab)
  core.registry.peers.saveApiPeers({ chats: [forumChat] })
  core.start()
  await tab.invoke('manager', { name: 'dialogs', method: 'fillMirror', args: [] })
  await tab.invoke('manager', { name: 'forumTopics', method: 'getForumTopics', args: [FORUM] })
  await core.registry.messages.getHistory({ peerId: FORUM, offsetId: 0, addOffset: 0, limit: 40 })
  expect(capturedConnDeps).not.toBeNull()
  const badge = (threadId?: number) => threadId
    ? core.registry.forumTopics.getUnreadBadge(FORUM, threadId)
    : core.registry.dialogs.getUnreadBadge(FORUM)
  return { core, fetchMock, badge }
}

const reactionFrame = (msg: number, unread: boolean, topMsgId?: number) => ({
  _: 'updateMessageReactions',
  peer: { _: 'peerChannel', channel_id: 50 },
  msg_id: msg,
  ...(topMsgId ? { top_msg_id: topMsgId } : {}),
  reactions: reactions(unread),
})
const mediaRead = (messages: number[]) => ({ _: 'updateReadPeerMessagesContents', peer: { _: 'peerChannel', channel_id: 50 }, messages })

describe('createWorkerCore(): ❤ темы форума по кадру реакции', () => {
  it('прочитанная реакция с top_msg_id: тема −1 и родитель −1', async () => {
    const { badge } = await boot()
    capturedConnDeps!.onFrame('reaction', reactionFrame(20, false, 10))
    expect(badge(cid(10))).toMatchObject({ reactions: 1 })
    expect(badge()).toMatchObject({ reactions: 1 })
    expect(badge(cid(11))).toMatchObject({ reactions: 1 }) // другая тема не тронута
  })

  it('новая непрочитанная реакция с top_msg_id: тема +1, родитель без изменений', async () => {
    const { badge } = await boot()
    capturedConnDeps!.onFrame('reaction', reactionFrame(21, true, 10))
    expect(badge(cid(10))).toMatchObject({ reactions: 3 })
    expect(badge()).toMatchObject({ reactions: 2 })
  })

  it('без top_msg_id — строка диалога, как раньше', async () => {
    const { badge } = await boot()
    capturedConnDeps!.onFrame('reaction', reactionFrame(20, false))
    expect(badge()).toMatchObject({ reactions: 1 })
    expect(badge(cid(10))).toMatchObject({ reactions: 2 })
  })
})

describe('createWorkerCore(): «@» по кадру media_read с вектором номеров', () => {
  it('оба в памяти: «@» минус по каждому — у его темы и у форума', async () => {
    const { badge } = await boot()
    capturedConnDeps!.onFrame('media_read', mediaRead([5, 7]))
    expect(badge(cid(10))).toMatchObject({ mentions: 1 })
    expect(badge(GENERAL_TOPIC_ID)).toMatchObject({ mentions: 0 })
    expect(badge()).toMatchObject({ mentions: 1 })
  })

  it('номер вне памяти: «@» минус за известный, строка форума перечитывается', async () => {
    const { badge, fetchMock } = await boot()
    capturedConnDeps!.onFrame('media_read', mediaRead([5, 50]))
    expect(badge(cid(10))).toMatchObject({ mentions: 1 })
    expect(badge()).toMatchObject({ mentions: 2 })
    await vi.waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/peer_dialogs'))).toBe(true))
  })

  it('кадр с top_msg_id (readMentions в теме): тема из кадра; номер вне памяти — список тем перечитывается', async () => {
    const { badge, fetchMock } = await boot()
    const before = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/chats/-50/topics')).length
    capturedConnDeps!.onFrame('media_read', { ...mediaRead([5, 50]), top_msg_id: 10 })
    expect(badge(cid(10))).toMatchObject({ mentions: 1 })
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/chats/-50/topics')).length).toBe(before + 1))
  })

  it('повтор кадра ничего не меняет (сообщение уже прочитано)', async () => {
    const { badge } = await boot()
    capturedConnDeps!.onFrame('media_read', mediaRead([5]))
    capturedConnDeps!.onFrame('media_read', mediaRead([5]))
    expect(badge(cid(10))).toMatchObject({ mentions: 1 })
    expect(badge()).toMatchObject({ mentions: 2 })
  })
})

describe('createWorkerCore(): readMessages / readMentions в теме', () => {
  it('ответ readMentions в теме гасит тему, родитель — только за увиденное локально', async () => {
    const { core, fetchMock, badge } = await boot()
    await core.registry.messages.readMessages(FORUM, [cid(5)])
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/mentions/read'))
    expect(String(call?.[0])).toContain('/chats/-50/mentions/read?top_msg_id=10')
    // локальное прочтение 5: тема 2→1 и форум 3→2; ответ readMentions: тема → 0
    expect(badge(cid(10))).toMatchObject({ mentions: 0 })
    expect(badge()).toMatchObject({ mentions: 2 })
  })

  // Порт :11053-11070: увиденное сообщение с непрочитанной реакцией отдаёт
  // местный кадр реакции — тема −1 и родитель −1 сразу, не по приходу кадров
  // сервера (ответ HTTP двигает курсор и выбрасывает их как дубли).
  it('увиденная непрочитанная реакция в теме: родитель −1 локально, тема — в ноль ответом', async () => {
    const { core, badge } = await boot()
    await core.registry.messages.readMessages(FORUM, [cid(20)])
    expect(badge()).toMatchObject({ reactions: 1 })
    expect(badge(cid(10))).toMatchObject({ reactions: 0 })
    expect(badge(cid(11))).toMatchObject({ reactions: 1 })
  })

  it('readMentions(…, isReaction) в теме: ❤ темы в ноль, ❤ форума не трогается', async () => {
    const { core, fetchMock, badge } = await boot()
    await core.registry.messages.readMentions(FORUM, cid(10), true)
    expect(String(fetchMock.mock.calls.find((c) => String(c[0]).includes('/reactions/read'))?.[0])).toContain('?top_msg_id=10')
    expect(badge(cid(10))).toMatchObject({ reactions: 0 })
    expect(badge()).toMatchObject({ reactions: 2 })
  })
})
