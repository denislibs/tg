// Ф7-Г2: платная ⭐-реакция несёт random_id — ключ идемпотентности TL
// `messages.sendPaidReaction` (tweb `appReactionsManager.ts:960-970`): long
// `(unix-секунды << 32) | случайные 32 бита`, на проводе — десятичная строка (JS не держит
// int64 числом). Повтор с тем же ключом сервер не списывает второй раз.
import { describe, expect, it, vi } from 'vitest'
import { newReactionMethods } from './reactionMethods'

function setup() {
  const post = vi.fn(async (_url: string, _body: Record<string, unknown>) => ({ _: 'updates', updates: [], users: [], chats: [], date: 0, seq: 0 }))
  const m = newReactionMethods({
    rest: { post } as never, patchMsg: () => {}, getMeId: () => 5, opWindowsFor: () => [], emitOps: () => {}, readMsg: () => undefined,
  } as never)
  return { m, post }
}

describe('sendStarReaction: random_id', () => {
  it('кладёт random_id строкой формата tweb (секунды << 32 | случайные 32 бита), на каждый вызов новый', async () => {
    const { m, post } = setup()
    const before = Math.floor(Date.now() / 1000)
    await m.sendStarReaction(-100, 3, 5, false)
    await m.sendStarReaction(-100, 3, 5, false)
    const ids = post.mock.calls.map(([, b]) => (b as { random_id: string }).random_id)
    expect(ids.every((id) => typeof id === 'string' && /^\d+$/.test(id))).toBe(true)
    const secs = Number(BigInt(ids[0]) >> 32n)
    expect(secs).toBeGreaterThanOrEqual(before)
    expect(secs).toBeLessThanOrEqual(before + 5)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('повтор вызывающего с тем же randomId уезжает с тем же ключом', async () => {
    const { m, post } = setup()
    await m.sendStarReaction(-100, 3, 5, false, '7000000000000000009')
    await m.sendStarReaction(-100, 3, 5, false, '7000000000000000009')
    expect(post.mock.calls.map(([, b]) => (b as { random_id: string }).random_id)).toEqual(['7000000000000000009', '7000000000000000009'])
  })
})
