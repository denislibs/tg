// Порт tweb `getMessageThreadId` (utils/messages/getMessageThreadId.ts:11-28) на
// трёх формах: тема форума, General, тред комментариев.
import { describe, expect, it } from 'vitest'
import { getMessageThreadId } from './models'
import { GENERAL_TOPIC_ID, generateMessageId } from './history/messageId'
import { makeMessage, makeServiceMessage } from './messages/testMessage'

const mid = (n: number) => generateMessageId(n)

describe('getMessageThreadId', () => {
  it('тема форума: `forum_topic` + `reply_to_msg_id` = номер темы', () => {
    const m = makeMessage({ id: mid(20), peerId: -5, replyToMsgId: mid(10), forumTopic: true })
    expect(getMessageThreadId(m, { isForum: true })).toBe(mid(10))
  })

  it('ответ внутри темы: `reply_to_top_id` важнее `reply_to_msg_id`', () => {
    const m = makeMessage({ id: mid(20), peerId: -5, replyToMsgId: mid(15), threadRootId: mid(10), forumTopic: true })
    expect(getMessageThreadId(m, { isForum: true })).toBe(mid(10))
  })

  it('форум без `forum_topic` — General, даже с ответом', () => {
    expect(getMessageThreadId(makeMessage({ id: mid(20), peerId: -5 }), { isForum: true })).toBe(GENERAL_TOPIC_ID)
    expect(getMessageThreadId(makeMessage({ id: mid(20), peerId: -5, replyToMsgId: mid(19) }), { isForum: true })).toBe(GENERAL_TOPIC_ID)
  })

  it('служебка создания темы — её собственный номер', () => {
    const m = makeServiceMessage({ id: mid(30), peerId: -5, action: { _: 'messageActionTopicCreate', title: 'T', icon_color: 0 } })
    expect(getMessageThreadId(m, { isForum: true })).toBe(mid(30))
  })

  it('тред комментариев (не форум): `top_id || msg_id`, флаг не нужен', () => {
    expect(getMessageThreadId(makeMessage({ id: mid(20), peerId: -7, replyToMsgId: mid(3) }))).toBe(mid(3))
    expect(getMessageThreadId(makeMessage({ id: mid(21), peerId: -7, replyToMsgId: mid(20), threadRootId: mid(3) }))).toBe(mid(3))
  })

  it('не форум без ответа — треда нет', () => {
    expect(getMessageThreadId(makeMessage({ id: mid(20), peerId: -7 }))).toBeUndefined()
  })
})
