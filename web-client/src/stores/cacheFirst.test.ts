// Cache-first для баланса звёзд: событие логируется с плотным pts и попадает в
// /difference (backend wave2_updates_test.go:243-245), поэтому пропуски после
// оффлайна догоняются апдейт-логом и опрашивать сеть на каждом старте незачем
// (порт намерения tweb `getDialogFilters`, filters.ts:475-484). Черновики из
// этого файла ушли вместе со своим стором: они — параметр диалога
// (`dialog.draft`) и едут тем же ответом, что и он.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STATE_INIT } from '../core/state/state'
import { useAppStateStore, setStateWriter } from './appState'
import { loadStars } from './starsStore'
import { registerStoreProjection } from '../client/realtime/storeProjection'
import rootScope from '@lib/rootScope'
import { RT } from '../core/realtime/events'
import type { Managers } from '../client/bootstrap'

beforeEach(() => {
  useAppStateStore.setState({ ...STATE_INIT }, true)
  setStateWriter({ stateKey: vi.fn().mockResolvedValue(undefined) })
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
