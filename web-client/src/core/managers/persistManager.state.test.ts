// RPC-фасад writer'а: main-thread пишет ключ State через воркер (один writer на
// все вкладки). Проверяем сквозной путь stateKey → стор `state` в IndexedDB —
// именно его дёргает setAppState на каждое изменение.
import { describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { newPersistManager } from './persistManager'
import { loadStateAll } from '../store/persist'

describe('persistManager.stateKey', () => {
  it('пишет ключ State, и он читается общим батч-ридером', async () => {
    const pm = newPersistManager()

    await pm.stateKey('recentSearch', [4, 5, 6])

    expect((await loadStateAll()).recentSearch).toEqual([4, 5, 6])
  })

  it('повторная запись того же ключа перекрывает предыдущую', async () => {
    const pm = newPersistManager()

    await pm.stateKey('hiddenPinnedMessages', { 1: 10 })
    await pm.stateKey('hiddenPinnedMessages', { 2: 20 })

    expect((await loadStateAll()).hiddenPinnedMessages).toEqual({ 2: 20 })
  })
})
