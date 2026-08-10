import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STATE_INIT, STATE_VERSION } from './state'

const loadStateAll = vi.fn()
vi.mock('../store/persist', () => ({ loadStateAll: () => loadStateAll() }))

const { loadStateOnce, resetStateCache, stateWasResetToDefaults } = await import('./loadState')

describe('loadStateOnce', () => {
  beforeEach(() => { resetStateCache(); loadStateAll.mockReset() })

  it('читает базу ОДИН раз даже при нескольких вызовах', async () => {
    loadStateAll.mockResolvedValue({ version: STATE_VERSION, recentSearch: ['1'] })

    const [a, b] = await Promise.all([loadStateOnce(), loadStateOnce()])

    expect(loadStateAll).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('недостающие ключи добираются из STATE_INIT', async () => {
    loadStateAll.mockResolvedValue({ version: STATE_VERSION, recentSearch: ['7'] })

    const state = await loadStateOnce()

    expect(state.recentSearch).toEqual(['7'])
    expect(state.folders).toEqual([])
    expect(state.hiddenPinnedMessages).toEqual({})
  })

  it('чужая версия схемы — стартуем с чистого STATE_INIT', async () => {
    loadStateAll.mockResolvedValue({ version: 0, recentSearch: ['1', '2', '3'] })

    expect(await loadStateOnce()).toEqual(STATE_INIT)
  })

  it('пустая база — STATE_INIT', async () => {
    loadStateAll.mockResolvedValue({})

    expect(await loadStateOnce()).toEqual(STATE_INIT)
  })

  // Регрессия: раньше дефолты добирались через `{ ...STATE_INIT }` — поверхностная
  // копия, при которой вложенные folders/hiddenPinnedMessages оставались ТЕМИ ЖЕ
  // объектами, что и в модульной константе. Первая мутация отравила бы дефолты на
  // весь сеанс. tweb по той же причине везде copy(STATE_INIT) (loadState.ts:122).
  it('вложенные дефолты — свежие объекты, не ссылки на STATE_INIT', async () => {
    loadStateAll.mockResolvedValue({})

    const state = await loadStateOnce()

    expect(state.folders).not.toBe(STATE_INIT.folders)
    expect(state.hiddenPinnedMessages).not.toBe(STATE_INIT.hiddenPinnedMessages)

    state.folders.push({ id: 1 } as never)
    expect(STATE_INIT.folders).toEqual([])
  })

  // Регрессия: boot записывает текущую версию схемы только по этому признаку.
  // Раньше он смотрел на `state.version` возвращённого объекта — а там версия уже
  // подставлена из дефолтов, поэтому условие не срабатывало НИКОГДА: ключ version
  // не попадал на диск, и следующий старт снова видел несовпадение и выбрасывал
  // весь прочитанный State. Папки и черновики терялись на каждой перезагрузке.
  it('сообщает, что состояние сброшено к дефолтам', async () => {
    loadStateAll.mockResolvedValue({ version: 0, recentSearch: ['1'] })

    await loadStateOnce()

    expect(stateWasResetToDefaults()).toBe(true)
  })

  it('версия сошлась — сброса не было', async () => {
    loadStateAll.mockResolvedValue({ version: STATE_VERSION, recentSearch: ['1'] })

    await loadStateOnce()

    expect(stateWasResetToDefaults()).toBe(false)
  })
})
