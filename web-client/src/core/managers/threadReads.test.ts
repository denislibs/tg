// Прочтение тредов — ветка `threadId` tweb `readHistory` (appMessagesManager.ts:9107-9270)
// и `updateReadChannelDiscussionInbox/Outbox` (:777-778, :10795-10990).
import { describe, expect, it, vi } from 'vitest'
import { newThreadReads } from './threadReads'
import type { ForumTopic } from '../dialogs/forumTopic'
import type { ReadDiscussion } from './forumTopicsStorage'
import { GENERAL_TOPIC_ID, generateMessageId } from '../history/messageId'
import { makeMessage } from '../messages/testMessage'

const FORUM = -50
const GROUP = -70
const mid = (n: number) => generateMessageId(n)
const flush = () => new Promise((r) => setTimeout(r, 0))

function setup(topics: Partial<ForumTopic>[] = []) {
  const post = vi.fn(async (_path: string, _body: unknown): Promise<unknown> => true)
  const map = new Map(topics.map((t) => [t.id!, { unread_count: 0, read_inbox_max_id: 0, top_message: 0, ...t } as ForumTopic]))
  const applyReadDiscussion = vi.fn((u: ReadDiscussion) => {
    const t = map.get(u.topicId)
    if (t && !u.out) { t.read_inbox_max_id = u.maxId; if (u.maxId >= t.top_message) t.unread_count = 0 }
  })
  const reads = newThreadReads({
    rest: { post } as never,
    isForumPeer: (peerId) => peerId === FORUM,
    forumTopics: { getForumTopic: (_p, id) => map.get(id), applyReadDiscussion },
    getMeId: () => 1,
  })
  return { reads, post, applyReadDiscussion }
}

describe('threadReads: тема форума', () => {
  it('местное прочтение сразу (хранилище тем) и `readDiscussion` серверными номерами', () => {
    const { reads, post, applyReadDiscussion } = setup([{ id: mid(10), read_inbox_max_id: mid(10), top_message: mid(13), unread_count: 3 }])
    reads.readHistory(FORUM, mid(10), mid(13))
    expect(applyReadDiscussion).toHaveBeenCalledWith({ peerId: FORUM, topicId: mid(10), maxId: mid(13), out: false })
    expect(post).toHaveBeenCalledWith('/chats/-50/threads/10/read', { read_max_id: 13 })
  })

  it('General — номер 1 на проводе', () => {
    const { reads, post } = setup([{ id: GENERAL_TOPIC_ID, read_inbox_max_id: mid(1), top_message: mid(5), unread_count: 2 }])
    reads.readHistory(FORUM, GENERAL_TOPIC_ID, mid(5))
    expect(post).toHaveBeenCalledWith('/chats/-50/threads/1/read', { read_max_id: 5 })
  })

  it('прочитанная тема — ничего не делает (:9133-9157)', () => {
    const { reads, post, applyReadDiscussion } = setup([{ id: mid(10), read_inbox_max_id: mid(13), top_message: mid(13), unread_count: 0 }])
    reads.readHistory(FORUM, mid(10), mid(13))
    expect(post).not.toHaveBeenCalled()
    expect(applyReadDiscussion).not.toHaveBeenCalled()
  })

  it('рубеж уже отправлен — сервер второй раз не зовётся (`triedToReadMaxId`, :9165-9170)', async () => {
    const { reads, post } = setup([{ id: mid(10), read_inbox_max_id: mid(10), top_message: mid(20), unread_count: 10 }])
    const first = reads.readHistory(FORUM, mid(10), mid(15))
    void reads.readHistory(FORUM, mid(10), mid(14))
    expect(post).toHaveBeenCalledTimes(1)
    // запрос в полёте — новый рубеж ждёт его (`readPromise`, :9165) и дочитывается по окончании (:9267-9277)
    expect(reads.readHistory(FORUM, mid(10), mid(18))).toBe(first)
    expect(post).toHaveBeenCalledTimes(1)
    await first
    await flush()
    expect(post).toHaveBeenCalledTimes(2)
    expect(post).toHaveBeenLastCalledWith('/chats/-50/threads/10/read', { read_max_id: 18 })
  })

  it('отказ сервера — рубеж снова не отправлен, следующий круг повторяет', async () => {
    const { reads, post } = setup([{ id: mid(10), read_inbox_max_id: mid(10), top_message: mid(20), unread_count: 10 }])
    post.mockRejectedValueOnce(new Error('net'))
    await expect(reads.readHistory(FORUM, mid(10), mid(15))).rejects.toThrow('net')
    await reads.readHistory(FORUM, mid(10), mid(15))
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('getReadState темы — сама тема; кадр прочтения уходит хранилищу тем', () => {
    const { reads, applyReadDiscussion } = setup([{ id: mid(10), read_inbox_max_id: mid(10), top_message: mid(13), unread_count: 3 }])
    expect(reads.getReadState(FORUM, mid(10))).toMatchObject({ read_inbox_max_id: mid(10), unread_count: 3, top_message: mid(13) })
    reads.applyReadDiscussion({ peerId: FORUM, topicId: mid(10), maxId: mid(12), out: true })
    expect(applyReadDiscussion).toHaveBeenCalledWith({ peerId: FORUM, topicId: mid(10), maxId: mid(12), out: true })
  })
})

describe('threadReads: тред комментариев (не форум)', () => {
  const discussion = { maxId: mid(30), readMaxId: mid(25), readOutboxMaxId: mid(20), unreadCount: 5 }

  it('состояние из `discussionMessage` (:8843-8846) — горизонт треда для ленты', () => {
    const { reads } = setup()
    expect(reads.getReadState(GROUP, mid(7))).toBeUndefined()
    reads.saveDiscussion(GROUP, mid(7), discussion)
    expect(reads.getReadState(GROUP, mid(7))).toEqual({ read_inbox_max_id: mid(25), read_outbox_max_id: mid(20), unread_count: 5, top_message: mid(30), merged: true })
  })

  it('прочтение: горизонт треда сразу, `readDiscussion` номером зеркала; хранилище тем не зовётся', () => {
    const { reads, post, applyReadDiscussion } = setup()
    reads.saveDiscussion(GROUP, mid(7), discussion)
    reads.readHistory(GROUP, mid(7), mid(30))
    expect(post).toHaveBeenCalledWith('/chats/-70/threads/7/read', { read_max_id: 30 })
    expect(applyReadDiscussion).not.toHaveBeenCalled()
    expect(reads.getReadState(GROUP, mid(7))).toEqual({ read_inbox_max_id: mid(30), read_outbox_max_id: mid(20), unread_count: 0, top_message: mid(30), merged: true })
  })

  it('тред, состояния которого нет (не открывали `discussionMessage`), — всё равно читается на сервере', () => {
    const { reads, post } = setup()
    reads.readHistory(GROUP, mid(7), mid(9))
    expect(post).toHaveBeenCalledWith('/chats/-70/threads/7/read', { read_max_id: 9 })
  })

  it('новое чужое сообщение треда двигает `maxId` и непрочитанное (:10435-10437); своё — только `maxId`', () => {
    const { reads } = setup()
    reads.saveDiscussion(GROUP, mid(7), { maxId: mid(30), readMaxId: mid(30), readOutboxMaxId: 0, unreadCount: 0 })
    reads.applyNewMessage(makeMessage({ id: mid(31), peerId: GROUP, fromId: 2, replyToMsgId: mid(7) }))
    expect(reads.getReadState(GROUP, mid(7))).toEqual({ read_inbox_max_id: mid(30), read_outbox_max_id: 0, unread_count: 1, top_message: mid(31), merged: true })
    reads.applyNewMessage(makeMessage({ id: mid(32), peerId: GROUP, fromId: 1, out: true, replyToMsgId: mid(7) }))
    expect(reads.getReadState(GROUP, mid(7))).toMatchObject({ unread_count: 1, top_message: mid(32) })
  })

  it('кадры inbox/outbox двигают горизонты треда', () => {
    const { reads } = setup()
    reads.saveDiscussion(GROUP, mid(7), discussion)
    reads.applyReadDiscussion({ peerId: GROUP, topicId: mid(7), maxId: mid(28), out: false })
    expect(reads.getReadState(GROUP, mid(7))).toMatchObject({ read_inbox_max_id: mid(28), unread_count: 5 })
    reads.applyReadDiscussion({ peerId: GROUP, topicId: mid(7), maxId: mid(30), out: false })
    expect(reads.getReadState(GROUP, mid(7))).toMatchObject({ unread_count: 0 })
  })

  it('reset — смена сессии', () => {
    const { reads } = setup()
    reads.saveDiscussion(GROUP, mid(7), discussion)
    reads.reset()
    expect(reads.getReadState(GROUP, mid(7))).toBeUndefined()
  })
})

// Эхо своего прочтения и порядок кадров (независимое ревью КЛ-1b п. 1)
describe('threadReads: кадры прочтения', () => {
  it('inbox не выше известного горизонта — пропуск (эхо своего прочтения не откатывает и не перечитывает)', () => {
    const { reads, applyReadDiscussion } = setup([{ id: mid(10), read_inbox_max_id: mid(15), top_message: mid(20), unread_count: 5 }])
    reads.applyReadDiscussion({ peerId: FORUM, topicId: mid(10), maxId: mid(15), out: false })
    reads.applyReadDiscussion({ peerId: FORUM, topicId: mid(10), maxId: mid(12), out: false })
    expect(applyReadDiscussion).not.toHaveBeenCalled()
    reads.applyReadDiscussion({ peerId: FORUM, topicId: mid(10), maxId: mid(18), out: false })
    expect(applyReadDiscussion).toHaveBeenCalledTimes(1)
  })

  it('своё последнее сообщение не делает тред непрочитанным (:5135-5137)', () => {
    const { reads } = setup()
    reads.saveDiscussion(GROUP, mid(7), { maxId: mid(30), readMaxId: mid(30), readOutboxMaxId: 0, unreadCount: 0 })
    reads.applyNewMessage(makeMessage({ id: mid(31), peerId: GROUP, fromId: 1, out: true, replyToMsgId: mid(7) }))
    expect(reads.getReadState(GROUP, mid(7))).toMatchObject({ unread_count: 0, top_message: mid(31) })
  })
})

// tweb :10814-10816 — у обычного треда прочтение правит и диалог группы (через владельца диалогов)
describe('threadReads: диалог группы', () => {
  it('прочтение треда комментариев зовёт `onCommentThreadRead` ДО сдвига горизонта треда; у темы — нет', () => {
    const seen: unknown[] = []
    const post = vi.fn(async () => true)
    const reads: ReturnType<typeof newThreadReads> = newThreadReads({
      rest: { post } as never,
      isForumPeer: (p) => p === FORUM,
      forumTopics: { getForumTopic: () => undefined, applyReadDiscussion: vi.fn() },
      getMeId: () => 1,
      onCommentThreadRead: (...args) => { seen.push([...args, reads.getReadState(GROUP, mid(7))?.read_inbox_max_id]); return true },
    })
    reads.saveDiscussion(GROUP, mid(7), { maxId: mid(30), readMaxId: mid(25), readOutboxMaxId: 0, unreadCount: 5 })
    reads.readHistory(GROUP, mid(7), mid(30))
    reads.applyReadDiscussion({ peerId: GROUP, topicId: mid(7), maxId: mid(29), out: true })
    reads.readHistory(FORUM, mid(10), mid(13))
    expect(seen).toEqual([[GROUP, mid(7), mid(30), false, mid(25)], [GROUP, mid(7), mid(29), true, mid(30)]])
  })
})

// tweb :10916 → `dialog_unread` внутри `if(foundDialog)` (:10919-10950) →
// bubbles.ts:2318-2326/:4860 — горизонт исходящих треда уходит ленте треда, только
// если диалог найден: у темы — тема в кэше, у треда комментариев — диалог группы
describe('threadReads: горизонт исходящих треда — ленте', () => {
  it('объявляет `onReadOutbox` после отсева эха при найденном диалоге; входящие — нет', () => {
    const out: unknown[] = []
    const topic = { id: mid(10), read_inbox_max_id: mid(10), read_outbox_max_id: mid(12), top_message: mid(13), unread_count: 3 } as ForumTopic
    let groupDialog = false
    const reads = newThreadReads({
      rest: { post: vi.fn(async () => true) } as never,
      isForumPeer: (p) => p === FORUM,
      forumTopics: { getForumTopic: (_p, id) => (id === mid(10) ? topic : undefined), applyReadDiscussion: vi.fn() },
      getMeId: () => 1,
      onCommentThreadRead: () => groupDialog,
      onReadOutbox: (...args) => { out.push(args) },
    })
    reads.saveDiscussion(GROUP, mid(7), { maxId: mid(30), readMaxId: mid(25), readOutboxMaxId: mid(20), unreadCount: 5 })
    groupDialog = true
    // эхо (не выше известного) — тишина
    reads.applyReadDiscussion({ peerId: FORUM, topicId: mid(10), maxId: mid(12), out: true })
    reads.applyReadDiscussion({ peerId: GROUP, topicId: mid(7), maxId: mid(20), out: true })
    // входящие — не горизонт исходящих
    reads.applyReadDiscussion({ peerId: GROUP, topicId: mid(7), maxId: mid(28), out: false })
    expect(out).toEqual([])
    reads.applyReadDiscussion({ peerId: FORUM, topicId: mid(10), maxId: mid(13), out: true }) // тема в кэше
    reads.applyReadDiscussion({ peerId: FORUM, topicId: mid(11), maxId: mid(14), out: true }) // темы нет в кэше — тишина
    reads.applyReadDiscussion({ peerId: GROUP, topicId: mid(7), maxId: mid(29), out: true })
    expect(out).toEqual([[FORUM, mid(10), mid(13)], [GROUP, mid(7), mid(29)]])
    // диалога группы нет — горизонт треда записан, ленте не объявлен
    groupDialog = false
    reads.applyReadDiscussion({ peerId: GROUP, topicId: mid(7), maxId: mid(30), out: true })
    expect(out).toHaveLength(2)
    expect(reads.getReadState(GROUP, mid(7))?.read_outbox_max_id).toBe(mid(30))
  })
})
