// src/core/managers/messages/pollMethods.sendingParams.test.ts
//
// Опрос — единственный путь отправки, который у нас идёт СВОИМ REST-эндпоинтом
// (POST /chats/{id}/polls), а не кадром send_message. В tweb такого разделения
// нет: опрос уезжает `sendOther({...sendingParams, inputMedia: inputMediaPoll})`
// и потому несёт пакет параметров наравне с текстом. Здесь пинится то же самое —
// пакет разворачивается в проводные поля тела запроса.
//
// Что ломается без этого: «Ответить» + «Опрос» создаёт опрос БЕЗ ответа, и
// висящая плашка уводит в ответ уже следующее сообщение.
import { describe, it, expect, vi } from 'vitest'
import { newPollMethods } from './pollMethods'

function ctx() {
  const post = vi.fn(async (_url: string, _body: Record<string, unknown>) => ({
    id: 1, peer_id: 1, seq: 1, sender_id: 5, type: 'poll', text: '',
    reply_to_id: null, media_id: null, created_at: '2026-01-01T00:00:00Z',
  }))
  return {
    post,
    ctx: { rest: { post } as never, patchMsg: () => {}, getMeId: () => 5, opWindowsFor: () => [] } as never,
  }
}

const poll = { question: 'Q', options: ['a', 'b'], anonymous: true, multiple: false, quiz: false }

describe('sendPoll: пакет параметров разворачивается в тело REST-запроса', () => {
  it('ответ, цитата, тред, тихо и send-as доезжают', async () => {
    const h = ctx()
    const m = newPollMethods(h.ctx)

    await m.sendPoll(1, {
      ...poll, clientMsgId: 'c1',
      replyToMsgId: 77, replyToQuote: { text: 'риг', offset: 1 }, threadId: 3,
      silent: true, sendAsPeerId: 9,
    })

    expect(h.post.mock.calls[0][1]).toMatchObject({
      reply_to_id: 77, reply_quote_text: 'риг', reply_quote_offset: 1,
      thread_root_id: 3, silent: true, send_as_peer_id: 9,
    })
  })

  it('без пакета поля уходят пустыми, а не отсутствуют', async () => {
    const h = ctx()
    const m = newPollMethods(h.ctx)

    await m.sendPoll(1, { ...poll, clientMsgId: 'c1' })

    expect(h.post.mock.calls[0][1]).toMatchObject({
      reply_to_id: null, reply_quote_text: null, thread_root_id: null,
      silent: false, send_as_peer_id: null,
    })
  })
})
