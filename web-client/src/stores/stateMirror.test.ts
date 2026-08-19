// Кросс-табовая синхронизация State: воркер после записи ключа рассылает зеркало
// во ВСЕ вкладки (порт tweb — `invokeVoid('mirror', …)` без указания порта уходит
// по всем sendPorts, superMessagePort.ts:379), а каждая вкладка применяет его
// молча (apiManagerProxy.ts:235-241).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStateStore, setAppState, setStateWriter, applyStateMirror } from './appState'
import { initialState } from '../core/state/state'
import { newPersistManager } from '../core/managers/persistManager'
import 'fake-indexeddb/auto'

const stateKey = vi.fn().mockResolvedValue(undefined)

const folder = {
  id: 7, title: 'Из соседней вкладки', pos: 0,
  contacts: false, nonContacts: false, groups: true, broadcasts: false,
  excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
}

beforeEach(() => {
  useAppStateStore.setState(initialState(), true)
  stateKey.mockClear()
  setStateWriter({ stateKey })
})

describe('applyStateMirror', () => {
  it('правка соседней вкладки доезжает в память', () => {
    applyStateMirror('folders', [folder])

    expect(useAppStateStore.getState().folders).toEqual([folder])
  })

  it('НЕ пишет обратно на диск — иначе цикл вкладка → воркер → вкладка', () => {
    applyStateMirror('folders', [folder])

    expect(stateKey).not.toHaveBeenCalled()
  })

  it('собственное эхо не пересоздаёт значение (после structured clone это другой объект)', () => {
    setAppState('folders', [folder])
    const before = useAppStateStore.getState().folders

    // тот же контент, но пришедший «по проводу» — новый объект
    applyStateMirror('folders', JSON.parse(JSON.stringify([folder])) as typeof before)

    expect(useAppStateStore.getState().folders).toBe(before)
  })

  it('соседние ключи не трогаются', () => {
    setAppState('drafts', [{ peerId: 1, text: 'мой', replyToId: null, updatedAt: '2026-08-10T00:00:00Z' }])
    const drafts = useAppStateStore.getState().drafts

    applyStateMirror('folders', [folder])

    expect(useAppStateStore.getState().drafts).toBe(drafts)
  })
})

describe('persistManager рассылает зеркало после записи', () => {
  it('ключ уходит в broadcast, и именно ПОСЛЕ сохранения', async () => {
    const order: string[] = []
    const mirror = vi.fn(() => { order.push('mirror') })
    const pm = newPersistManager(mirror)

    await pm.stateKey('recentSearch', ['1', '2'])
    order.push('after-await')

    expect(mirror).toHaveBeenCalledWith('recentSearch', ['1', '2'])
    // Зеркало должно уйти до того, как промис записи отдан вызывающему:
    // вкладка, поднявшаяся сразу после кадра, прочитает с диска уже актуальное.
    expect(order).toEqual(['mirror', 'after-await'])
  })

  it('без broadcaster-а не падает (тесты/воркер без портов)', async () => {
    const pm = newPersistManager()

    await expect(pm.stateKey('recentSearch', ['3'])).resolves.toBeUndefined()
  })
})
