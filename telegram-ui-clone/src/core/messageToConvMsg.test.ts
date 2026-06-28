import { describe, it, expect } from 'vitest'
import { messageToConvMsg } from './messageToConvMsg'
import type { Message } from './models'

const base: Message = {
  id: 1, chatId: 1, seq: 1, senderId: 2, type: 'text', text: 'hi',
  replyToId: null, mediaId: null, createdAt: '2026-06-24T10:00:00Z', threadRootId: null,
}

describe('messageToConvMsg', () => {
  it('marks messages from me as out with sent status', () => {
    const c = messageToConvMsg({ ...base, senderId: 7 }, 7)
    expect(c.out).toBe(true)
    expect(c.status).toBe('sent')
    expect(c.text).toBe('hi')
  })

  it('formats time as local HH:MM, not the raw ISO string', () => {
    const c = messageToConvMsg(base, 7)
    expect(c.time).toMatch(/^\d{2}:\d{2}$/)
    expect(c.time).not.toBe(base.createdAt)
  })

  it('marks messages from others as incoming with no status', () => {
    const c = messageToConvMsg(base, 7)
    expect(c.out).toBe(false)
    expect(c.status).toBeUndefined()
  })

  it('marks an outgoing message as read once the peer has read up to its seq', () => {
    const c = messageToConvMsg({ ...base, senderId: 7, seq: 5 }, 7, { readUpToSeq: 5 })
    expect(c.status).toBe('read')
  })

  it('marks an outgoing message as read when readUpToSeq is past its seq', () => {
    const c = messageToConvMsg({ ...base, senderId: 7, seq: 5 }, 7, { readUpToSeq: 9 })
    expect(c.status).toBe('read')
  })

  it('keeps an outgoing message as sent when readUpToSeq is below its seq', () => {
    const c = messageToConvMsg({ ...base, senderId: 7, seq: 5 }, 7, { readUpToSeq: 4 })
    expect(c.status).toBe('sent')
  })

  it('keeps an outgoing message as sent when readUpToSeq is not provided', () => {
    const c = messageToConvMsg({ ...base, senderId: 7, seq: 5 }, 7)
    expect(c.status).toBe('sent')
  })

  it('never sets read status on incoming messages regardless of readUpToSeq', () => {
    const c = messageToConvMsg({ ...base, seq: 5 }, 7, { readUpToSeq: 9 })
    expect(c.out).toBe(false)
    expect(c.status).toBeUndefined()
  })

  it('always produces a text-type ConvMsg for now', () => {
    expect(messageToConvMsg(base, 7).type).toBe('text')
  })

  it('carries mediaId when the message has media', () => {
    const c = messageToConvMsg({ ...base, mediaId: 42, text: '' }, 7)
    expect(c.mediaId).toBe(42)
  })

  it('sets sender from opts.senderName on incoming messages', () => {
    const c = messageToConvMsg(base, 7, { senderName: 'Bob' })
    expect(c.out).toBe(false)
    expect(c.sender).toBe('Bob')
  })

  it('never sets sender on outgoing messages even with senderName', () => {
    const c = messageToConvMsg({ ...base, senderId: 7 }, 7, { senderName: 'Bob' })
    expect(c.out).toBe(true)
    expect(c.sender).toBeUndefined()
  })
})

describe('messageToConvMsg — actions', () => {
  it('flags edited when editedAt is set', () => {
    const c = messageToConvMsg({ ...base, editedAt: '2026-06-24T11:00:00Z' }, 7)
    expect(c.edited).toBe(true)
  })

  it('flags deleted', () => {
    const c = messageToConvMsg({ ...base, deleted: true }, 7)
    expect(c.deleted).toBe(true)
  })

  it('maps forward attribution with the resolved name', () => {
    const c = messageToConvMsg({ ...base, fwdFromUserId: 42 }, 7, { forwardFromName: 'Игорь' })
    expect(c.forwardFrom).toEqual({ name: 'Игорь' })
  })

  it('no forwardFrom when not forwarded', () => {
    expect(messageToConvMsg(base, 7).forwardFrom).toBeUndefined()
  })
})
