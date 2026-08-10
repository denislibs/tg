// src/core/realtime/channelFunnel.test.ts
import { describe, it, expect, vi } from 'vitest'
import { newChannelFunnel, type ChannelDiff } from './channelFunnel'

// Тестовый жгут: записываем dispatch(t,pts?), храним курсоры в памяти, difference —
// программируемая очередь ответов.
function harness(diffs: ChannelDiff[] = []) {
  const dispatched: { t: string; d: unknown; pts?: number; catchUp?: boolean }[] = []
  const saved = new Map<number, number>()
  const stored = new Map<number, number>()
  let diffIdx = 0
  const getDifference = vi.fn(async (_chatId: number, _since: number): Promise<ChannelDiff> => {
    return diffs[diffIdx++] ?? { updates: [], pts: _since, slice: false }
  })
  const funnel = newChannelFunnel({
    dispatch: (t, d, meta) => dispatched.push({ t, d, pts: meta?.pts, catchUp: meta?.catchUp }),
    getDifference,
    loadPts: async (id) => stored.get(id) ?? null,
    savePts: (id, pts) => saved.set(id, pts),
  })
  return { funnel, dispatched, saved, stored, getDifference }
}

const post = (chatId: number, pts: number) => ({ t: 'new_message', pts, d: { chat_id: chatId, channel_pts: pts, msg_id: pts } })

describe('channelFunnel.applyLive', () => {
  it('первый живой кадр сидирует курсор и применяется без реплея', () => {
    const h = harness()
    h.funnel.applyLive(1, 'new_message', 5, post(1, 5).d)
    expect(h.dispatched).toHaveLength(1)
    expect(h.saved.get(1)).toBe(5)
    // ни одного difference-запроса — историю грузит окно, не funnel
    expect(h.getDifference).not.toHaveBeenCalled()
  })

  it('next применяется и двигает курсор; dup отбрасывается', () => {
    const h = harness()
    h.funnel.applyLive(1, 'new_message', 5, {})   // seed
    h.funnel.applyLive(1, 'new_message', 6, {})   // next
    h.funnel.applyLive(1, 'new_message', 6, {})   // dup
    h.funnel.applyLive(1, 'new_message', 4, {})   // dup (позади)
    expect(h.dispatched).toHaveLength(2)
    expect(h.saved.get(1)).toBe(6)
  })

  it('gap придерживается и дренажится, когда дыру закрывает следующий кадр', () => {
    const h = harness()
    h.funnel.applyLive(1, 'new_message', 5, {})   // seed → cursor 5
    h.funnel.applyLive(1, 'new_message', 7, { hole: true }) // gap → буфер
    expect(h.dispatched).toHaveLength(1)          // 7 придержан
    h.funnel.applyLive(1, 'new_message', 6, {})   // next закрывает дыру → 6, затем дренаж 7
    expect(h.dispatched).toHaveLength(3)
    expect(h.saved.get(1)).toBe(7)
  })

  it('курсоры per-channel независимы', () => {
    const h = harness()
    h.funnel.applyLive(1, 'new_message', 5, {})
    h.funnel.applyLive(2, 'new_message', 100, {})
    expect(h.saved.get(1)).toBe(5)
    expect(h.saved.get(2)).toBe(100)
  })
})

describe('channelFunnel.open', () => {
  it('со stored pts добирает пропущенное через типизированный difference', async () => {
    const h = harness([{ updates: [
      { t: 'new_message', pts: 4, d: {} },
      { t: 'chat_update', pts: 5, d: {} },
    ], pts: 5, slice: false }])
    h.stored.set(1, 3)
    await h.funnel.open(1)
    await Promise.resolve()
    expect(h.getDifference).toHaveBeenCalledWith(1, 3)
    expect(h.dispatched.map((x) => x.t)).toEqual(['new_message', 'chat_update'])
    expect(h.saved.get(1)).toBe(5)
  })

  it('без stored pts не ходит в difference (первый live сидирует)', async () => {
    const h = harness()
    await h.funnel.open(1)
    expect(h.getDifference).not.toHaveBeenCalled()
  })
})

describe('channelFunnel meta', () => {
  it('живой кадр помечается catchUp:false, кадр из difference — catchUp:true', async () => {
    const seen: Array<{ t: string; catchUp?: boolean }> = []
    const funnel = newChannelFunnel({
      dispatch: (t, _d, meta) => { seen.push({ t, catchUp: meta?.catchUp }) },
      getDifference: async () => ({ updates: [{ t: 'new_message', pts: 2, d: {} }], pts: 2, slice: false }),
      loadPts: async () => 1,
      savePts: () => {},
    })
    funnel.applyLive(1, 'new_message', 5, {})
    expect(seen).toEqual([{ t: 'new_message', catchUp: false }])
    seen.length = 0
    await funnel.open(2)
    expect(seen.some((x) => x.catchUp === true)).toBe(true)
  })
})

describe('channelFunnel gap → difference', () => {
  it('по таймауту недобранной дыры уходит в difference', async () => {
    vi.useFakeTimers()
    try {
      const h = harness([{ updates: [{ t: 'new_message', pts: 6, d: {} }], pts: 6, slice: false }])
      h.funnel.applyLive(1, 'new_message', 5, {})   // seed
      h.funnel.applyLive(1, 'new_message', 7, {})   // gap, дыру никто не закрыл
      expect(h.getDifference).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(300)         // SYNC_DELAY прошёл
      expect(h.getDifference).toHaveBeenCalledWith(1, 5)
    } finally {
      vi.useRealTimers()
    }
  })
})

// Добор пропусков (ревью Этапа 1A): meta-тест выше проверял только seed-ветку и
// difference; основная ветка applyLive (курсор уже сидирован) и drainPending
// оставались непокрытыми — мутация catchUp в них проскакивала бы мимо тестов.
describe('channelFunnel meta — основная ветка и drainPending', () => {
  it('основная ветка applyLive (курсор сидирован, pts===cursor+1) помечает catchUp:false', () => {
    const h = harness()
    h.funnel.applyLive(1, 'new_message', 5, {})   // seed — отдельная ветка, не эта
    h.funnel.applyLive(1, 'new_message', 6, {})   // основная ветка: pts===cursor+1
    expect(h.dispatched[1]).toMatchObject({ t: 'new_message', pts: 6, catchUp: false })
  })

  it('drainPending: придержанный из-за дыры кадр после её закрытия применяется с catchUp:false', () => {
    const h = harness()
    h.funnel.applyLive(1, 'new_message', 5, {})            // seed → cursor 5
    h.funnel.applyLive(1, 'new_message', 7, { hole: true }) // gap → буфер, не применён
    h.funnel.applyLive(1, 'new_message', 6, {})             // next закрывает дыру → дренаж 7
    expect(h.dispatched[2]).toMatchObject({ t: 'new_message', pts: 7, catchUp: false })
  })
})
