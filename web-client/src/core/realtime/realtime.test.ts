// src/core/realtime/realtime.test.ts
//
// Регрессия (финальное ревью feat/remaining-ops, Regression 1): markMediaRead —
// RPC-путь клика по голосовому/кружку (useVoiceQueue/SearchView/SharedMedia/
// mediaBubbles → core/mediaRead.ts → realtime.markMediaRead). Stage 1B.3 убрала
// [RT.mediaRead] из реестра APPLY проектора (storeProjection.ts) — окно теперь
// правит ТОЛЬКО applyOps(RT.messageOp). messages.cacheMediaRead уже отдаёт
// MessageOp[], но markMediaRead их выбрасывал (тип зависимости был `void`),
// поэтому точка «не прослушано» не гасла ни в одной вкладке до перезагрузки.
import { describe, it, expect, vi } from 'vitest'
import { newRealtime } from './realtime'
import { RT } from './events'
import type { MessageOp } from './messageOps'

describe('realtime.markMediaRead', () => {
  it('broadcasts the MessageOp[] returned by cacheMediaRead as rt:message_op', async () => {
    const ops: MessageOp[] = [{ op: 'patch', key: '1', msgId: 7, fields: { mediaUnread: false } }]
    const conn = { markMediaRead: vi.fn() } as unknown as Parameters<typeof newRealtime>[0]['conn']
    const messages = { cacheMediaRead: vi.fn(() => ops) }
    const broadcast = vi.fn()
    const rt = newRealtime({
      conn,
      tokens: { load: async () => undefined },
      messages,
      broadcast,
      channelFunnel: { open: async () => undefined, close: () => undefined } as unknown as Parameters<typeof newRealtime>[0]['channelFunnel'],
    })

    await rt.markMediaRead({ chatId: 1, msgId: 7 })

    expect(broadcast).toHaveBeenCalledWith(RT.messageOp, { ops })
  })

  it('does not broadcast rt:message_op when cacheMediaRead produces no ops (idempotent replay)', async () => {
    const conn = { markMediaRead: vi.fn() } as unknown as Parameters<typeof newRealtime>[0]['conn']
    const messages = { cacheMediaRead: vi.fn(() => []) }
    const broadcast = vi.fn()
    const rt = newRealtime({
      conn,
      tokens: { load: async () => undefined },
      messages,
      broadcast,
      channelFunnel: { open: async () => undefined, close: () => undefined } as unknown as Parameters<typeof newRealtime>[0]['channelFunnel'],
    })

    await rt.markMediaRead({ chatId: 1, msgId: 7 })

    expect(broadcast).not.toHaveBeenCalledWith(RT.messageOp, expect.anything())
  })
})
