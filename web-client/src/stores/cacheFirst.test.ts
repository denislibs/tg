// Cache-first для черновиков и баланса звёзд: оба события логируются с плотным
// pts и попадают в /difference (backend wave2_updates_test.go:221-224,243-245),
// поэтому пропуски после оффлайна догоняются апдейт-логом и опрашивать сеть на
// каждом старте незачем (порт намерения tweb `getDialogFilters`, filters.ts:475-484).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STATE_INIT } from '../core/state/state'
import { useAppStateStore, setStateWriter } from './appState'
import { loadDrafts } from './draftsStore'
import { loadStars } from './starsStore'
import { registerStoreProjection } from '../client/realtime/storeProjection'
import rootScope from '@lib/rootScope'
import { RT } from '../core/realtime/events'
import type { Managers } from '../client/bootstrap'
import type { Draft } from '../core/models'

const draft: Draft = { peerId: 3, text: 'привет', replyToId: null, date: 1786233600 }

beforeEach(() => {
  useAppStateStore.setState({ ...STATE_INIT }, true)
  setStateWriter({ stateKey: vi.fn().mockResolvedValue(undefined) })
})

describe('черновики: cache-first', () => {
  it('черновики есть в State — в сеть не идём', async () => {
    useAppStateStore.setState({ drafts: [draft] })
    const list = vi.fn()

    await loadDrafts({ drafts: { list } })

    expect(list).not.toHaveBeenCalled()
  })

  it('черновиков нет — запрашиваем', async () => {
    const list = vi.fn().mockResolvedValue([draft])

    await loadDrafts({ drafts: { list } })

    expect(list).toHaveBeenCalledTimes(1)
    expect(useAppStateStore.getState().drafts).toEqual([draft])
  })
})

describe('звёзды: cache-first', () => {
  it('баланс уже известен — в сеть не идём', async () => {
    useAppStateStore.setState({ starsBalance: 42 })
    const balance = vi.fn()

    await loadStars({ stars: { balance } })

    expect(balance).not.toHaveBeenCalled()
  })

  it('баланс никогда не грузился (null) — запрашиваем', async () => {
    const balance = vi.fn().mockResolvedValue(7)

    await loadStars({ stars: { balance } })

    expect(balance).toHaveBeenCalledTimes(1)
    expect(useAppStateStore.getState().starsBalance).toBe(7)
  })

  it('нулевой баланс — это ЗНАЧЕНИЕ, повторно не запрашиваем', async () => {
    useAppStateStore.setState({ starsBalance: 0 })
    const balance = vi.fn()

    await loadStars({ stars: { balance } })

    expect(balance).not.toHaveBeenCalled()
  })

  it('сеть упала — баланс остаётся не загруженным (null), фича мягко отключается', async () => {
    const balance = vi.fn().mockRejectedValue(new Error('offline'))

    await loadStars({ stars: { balance } })

    expect(useAppStateStore.getState().starsBalance).toBeNull()
  })

  // Cache-first означает, что единственный живой источник обновления баланса —
  // событие balance_update. Если проекция перестанет писать в State, баланс
  // застынет на значении первого старта, и никакой тест выше этого не поймает.
  it('live-фрейм balance_update пишет баланс в State', () => {
    // Managers обработчику balanceUpdate не нужны (нужны только рефетчу чатов).
    registerStoreProjection({} as unknown as Managers)

    rootScope.dispatchEventSingle(RT.balanceUpdate, { _: 'updateStarsBalance', balance: { _: 'starsAmount', amount: 15, nanos: 0 } })

    expect(useAppStateStore.getState().starsBalance).toBe(15)
  })
})
