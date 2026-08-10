// Перенос «недавних» из localStorage в State. Данные пользователя терять нельзя
// (та же конвенция, что у миграций IndexedDB), но и затирать более свежее
// значение старьём — тоже.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStateStore, setStateWriter } from '../../stores/appState'
import { initialState } from './state'
import { migrateRecentSearchFromLocalStorage } from './migrateRecentSearch'

beforeEach(() => {
  useAppStateStore.setState(initialState(), true)
  setStateWriter({ stateKey: vi.fn().mockResolvedValue(undefined) })
  localStorage.clear()
})

describe('migrateRecentSearchFromLocalStorage', () => {
  it('переносит накопленное и убирает старый ключ', () => {
    localStorage.setItem('recentSearch', JSON.stringify(['5', '7']))

    migrateRecentSearchFromLocalStorage()

    expect(useAppStateStore.getState().recentSearch).toEqual(['5', '7'])
    expect(localStorage.getItem('recentSearch')).toBeNull()
  })

  it('не затирает уже непустой State (могло приехать зеркалом из соседней вкладки)', () => {
    useAppStateStore.setState({ recentSearch: ['99'] })
    localStorage.setItem('recentSearch', JSON.stringify(['5', '7']))

    migrateRecentSearchFromLocalStorage()

    expect(useAppStateStore.getState().recentSearch).toEqual(['99'])
    expect(localStorage.getItem('recentSearch')).toBeNull() // но ключ всё равно убран
  })

  it('битый JSON не роняет старт', () => {
    localStorage.setItem('recentSearch', '{не json')

    expect(() => migrateRecentSearchFromLocalStorage()).not.toThrow()
    expect(useAppStateStore.getState().recentSearch).toEqual([])
    expect(localStorage.getItem('recentSearch')).toBeNull()
  })

  it('мусор вместо массива игнорируется', () => {
    localStorage.setItem('recentSearch', JSON.stringify({ a: 1 }))

    migrateRecentSearchFromLocalStorage()

    expect(useAppStateStore.getState().recentSearch).toEqual([])
  })

  it('нечего переносить — ничего не делаем', () => {
    migrateRecentSearchFromLocalStorage()

    expect(useAppStateStore.getState().recentSearch).toEqual([])
  })

  it('обрезает до 20 (cap как в tweb)', () => {
    localStorage.setItem('recentSearch', JSON.stringify(Array.from({ length: 30 }, (_, i) => String(i))))

    migrateRecentSearchFromLocalStorage()

    expect(useAppStateStore.getState().recentSearch).toHaveLength(20)
  })
})
