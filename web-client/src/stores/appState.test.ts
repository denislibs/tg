import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STATE_INIT } from '../core/state/state'
import type { Folder } from '../core/managers/foldersManager'
import { useAppStateStore, setAppState, setAppStateSilent, setStateWriter } from './appState'

const stateKey = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  useAppStateStore.setState({ ...STATE_INIT }, true)
  stateKey.mockClear()
  setStateWriter({ stateKey })
})

describe('appState', () => {
  it('setAppState пишет в память И персистит (write-through)', () => {
    setAppState('recentSearch', [42])

    expect(useAppStateStore.getState().recentSearch).toEqual([42])
    expect(stateKey).toHaveBeenCalledWith('recentSearch', [42])
  })

  it('setAppStateSilent наполняет память БЕЗ записи (гидрация)', () => {
    setAppStateSilent({ recentSearch: [1], hiddenPinnedMessages: { 3: 9 } })

    expect(useAppStateStore.getState().recentSearch).toEqual([1])
    expect(useAppStateStore.getState().hiddenPinnedMessages).toEqual({ 3: 9 })
    expect(stateKey).not.toHaveBeenCalled()
  })

  it('запись одного ключа не меняет ссылки на соседние (нет лишних ре-рендеров)', () => {
    // Кладём СВОИ объекты, а не дефолты из STATE_INIT: иначе тест прошёл бы и на
    // реализации, которая пересобирает стор из STATE_INIT (ссылки там те же).
    const folders: Folder[] = []
    const hiddenPinnedMessages = { 3: 9 }
    setAppStateSilent({ folders, hiddenPinnedMessages })

    setAppState('recentSearch', [5])

    expect(useAppStateStore.getState().folders).toBe(folders)
    expect(useAppStateStore.getState().hiddenPinnedMessages).toBe(hiddenPinnedMessages)
  })

  it('без writer-а не падает (тесты/логаут)', () => {
    setStateWriter(null)

    expect(() => setAppState('recentSearch', [1])).not.toThrow()
  })
})
