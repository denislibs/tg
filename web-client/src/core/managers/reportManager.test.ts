// MC-05: жалоба несёт id — ВЕКТОР серверных номеров (TL messages.report{id:
// Vector<int>}, tweb appMessagesManager.ts:7807-7827); пустой вектор — жалоба на
// чат (reportAd.tsx:372). Менеджер получает КЛИЕНТСКИЕ mid и переводит их сам.
import { describe, expect, it, vi } from 'vitest'

import { newReportManager } from './reportManager'
import { generateMessageId } from '../history/messageId'

function fakeRest() {
  const post = vi.fn().mockResolvedValue(undefined)
  return { rest: { post } as never, post }
}

describe('ReportManager.report', () => {
  it('клиентские mid уходят серверными номерами в id', async () => {
    const { rest, post } = fakeRest()
    await newReportManager({ rest }).report({
      peerId: -5, mids: [generateMessageId(12), generateMessageId(14)], reason: 'spam', comment: 'x',
    })

    expect(post).toHaveBeenCalledWith('/report', { peer_id: -5, id: [12, 14], reason: 'spam', comment: 'x' })
  })

  it('без сообщений — id: [] (жалоба на чат), прежнего msg_id нет', async () => {
    const { rest, post } = fakeRest()
    await newReportManager({ rest }).report({ peerId: 7, mids: [], reason: 'other' })

    const body = post.mock.calls[0][1] as Record<string, unknown>
    expect(body).toEqual({ peer_id: 7, id: [], reason: 'other', comment: '' })
    expect(body).not.toHaveProperty('msg_id')
  })
})
