// Логаут БЕЗ перезагрузки страницы (ветка без мультиаккаунта в useAuthGate):
// `boot.ts` второй раз не отработает, а он единственное место, где State
// поднимается с диска в память. Без сброса конфиг прошлого аккаунта доживал бы
// до входа под следующим — и, что хуже, cache-first ОТМЕНЯЕТ запрос к сети при
// непустой памяти, то есть чужие папки/черновики/баланс были бы показаны и
// записаны под скоуп нового аккаунта.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStateStore, setAppState, setStateWriter, resetAppState } from './appState'
import { initialState } from '../core/state/state'
import { loadFolders } from './foldersStore'
import { loadDrafts } from './draftsStore'
import { loadStars } from './starsStore'

const stateKey = vi.fn().mockResolvedValue(undefined)

const folder = {
  id: 7, title: 'Папка прошлого аккаунта', pos: 0,
  contacts: false, nonContacts: false, groups: true, broadcasts: false,
  excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
}

beforeEach(() => {
  useAppStateStore.setState(initialState(), true)
  stateKey.mockClear()
  setStateWriter({ stateKey })
})

describe('resetAppState', () => {
  it('стирает конфиг прошлого аккаунта из памяти', () => {
    setAppState('folders', [folder])
    setAppState('drafts', [{ chatId: 1, text: 'чужой черновик', replyToId: null, updatedAt: '2026-08-09T00:00:00Z' }])
    setAppState('starsBalance', 500)
    setAppState('recentSearch', ['1', '2', '3'])

    resetAppState()

    expect(useAppStateStore.getState()).toEqual(initialState())
  })

  it('не пишет сброс на диск: персист чистит logout отдельно (clearDialogsPersist)', () => {
    setAppState('folders', [folder])
    stateKey.mockClear()

    resetAppState()

    expect(stateKey).not.toHaveBeenCalled()
  })

  it('вложенные значения после сброса — свежие, а не ссылки на дефолты', () => {
    setAppState('folders', [folder])

    resetAppState()
    useAppStateStore.getState().folders.push(folder)

    expect(initialState().folders).toEqual([])
  })
})

// Ради этого всё и делается: после сброса cache-first снова обязан идти в сеть.
// Без resetAppState непустая память отменила бы запрос, и новый аккаунт увидел
// бы данные предыдущего.
describe('после сброса cache-first снова запрашивает данные', () => {
  it('папки', async () => {
    setAppState('folders', [folder])
    resetAppState()
    const list = vi.fn().mockResolvedValue([])

    await loadFolders({ folders: { list }, contacts: { list: vi.fn().mockResolvedValue([]) } })

    expect(list).toHaveBeenCalledTimes(1)
  })

  it('черновики', async () => {
    setAppState('drafts', [{ chatId: 1, text: 'x', replyToId: null, updatedAt: '2026-08-09T00:00:00Z' }])
    resetAppState()
    const list = vi.fn().mockResolvedValue([])

    await loadDrafts({ drafts: { list } })

    expect(list).toHaveBeenCalledTimes(1)
  })

  it('баланс звёзд', async () => {
    setAppState('starsBalance', 500)
    resetAppState()
    const balance = vi.fn().mockResolvedValue(0)

    await loadStars({ stars: { balance } })

    expect(balance).toHaveBeenCalledTimes(1)
  })
})
