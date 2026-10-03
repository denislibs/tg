// Пин `messages.getFirstMessageToEdit` (порт tweb `appMessagesManager.getFirstMessageToEdit`,
// :7728-7792): правка последнего своего сообщения по ↑ и ответ на соседнее по Ctrl/Cmd+↑↓
// (Б-80). Ищется в свежем срезе окна воркера; права — `core/messages/canEditMessage.ts`.
import { describe, expect, it } from 'vitest'
import { newMessagesManager } from './messagesManager'
import type { RestClient } from '../net/restClient'
import type { RawMessage } from '../models'
import { generateMessageId as cid } from '../history/messageId'
import { makeRawMessage } from '../messages/testMessage'

const ME = 1
const BOB = 2

function restWith(page: RawMessage[]) {
  return {
    get: async(_path: string, q?: Record<string, string | number>) => (q?.offset_id ? { messages: [], count: page.length } : { messages: page, count: page.length }),
    post: async() => ({}),
  } as unknown as RestClient
}

async function managerWith(rows: { id: number, fromId: number, out?: boolean, sticker?: boolean }[]) {
  const page = rows.map(({ id, fromId, out }) => makeRawMessage({ id, peerId: BOB, fromId, out, text: `m${id}` }) as RawMessage)
  const mgr = newMessagesManager({ rest: restWith(page), getMeId: () => ME, getPeer: () => undefined })
  await mgr.getHistory({ peerId: BOB, offsetId: 0, addOffset: 0, limit: 40 })
  return mgr
}

describe('messages.getFirstMessageToEdit', () => {
  it('↑ — последнее СВОЁ сообщение (чужое свежее пропускается)', async() => {
    const mgr = await managerWith([
      { id: 5, fromId: BOB },
      { id: 4, fromId: ME, out: true },
      { id: 3, fromId: ME, out: true },
    ])
    const message = await mgr.getFirstMessageToEdit({ peerId: BOB, up: true })
    expect(message?.id).toBe(cid(4))
  })

  it('своих нет — ничего', async() => {
    const mgr = await managerWith([{ id: 2, fromId: BOB }, { id: 1, fromId: BOB }])
    expect(await mgr.getFirstMessageToEdit({ peerId: BOB, up: true })).toBeUndefined()
  })

  it('Ctrl+↑ от ответа — следующее (более старое) сообщение любого автора; Ctrl+↓ — более новое', async() => {
    const mgr = await managerWith([
      { id: 5, fromId: BOB },
      { id: 4, fromId: ME, out: true },
      { id: 3, fromId: BOB },
    ])
    expect((await mgr.getFirstMessageToEdit({ peerId: BOB, forReply: true, mid: cid(4), up: true }))?.id).toBe(cid(3))
    expect((await mgr.getFirstMessageToEdit({ peerId: BOB, forReply: true, mid: cid(4), up: false }))?.id).toBe(cid(5))
    // без текущего ответа Ctrl+↑ берёт самое свежее
    expect((await mgr.getFirstMessageToEdit({ peerId: BOB, forReply: true, up: true }))?.id).toBe(cid(5))
  })

  it('окна нет (чат не открывали) — ничего', async() => {
    const mgr = newMessagesManager({ rest: restWith([]), getMeId: () => ME })
    expect(await mgr.getFirstMessageToEdit({ peerId: BOB, up: true })).toBeUndefined()
  })
})
