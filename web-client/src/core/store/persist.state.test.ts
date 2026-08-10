// Стор `state` — единый объект персистентного состояния (порт tweb StateStorage
// поверх стора `session`). Ключевое требование: ВСЕ ключи читаются одной
// транзакцией, чтобы на старте был ровно один поход в базу.
import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { saveStateKey, loadStateAll } from './persist'

// Каждый тест — своя база: fake-indexeddb держит соединение в модуле persist,
// поэтому чистим содержимое стора, а не удаляем БД (иначе повиснет versionchange).
beforeEach(async () => {
  await saveStateKey('folders', [])
  await saveStateKey('drafts', [])
  await saveStateKey('recentSearch', [])
  await saveStateKey('hiddenPinnedMessages', {})
})

describe('persist: стор state', () => {
  it('пишет и читает ключи State', async () => {
    await saveStateKey('recentSearch', ['1', '2', '3'])
    await saveStateKey('hiddenPinnedMessages', { 5: 42 })

    const all = await loadStateAll()
    expect(all.recentSearch).toEqual(['1', '2', '3'])
    expect(all.hiddenPinnedMessages).toEqual({ 5: 42 })
  })

  it('читает ВСЕ записанные ключи (один батч)', async () => {
    await saveStateKey('version', 1)
    await saveStateKey('folders', [])
    await saveStateKey('recentSearch', ['7'])

    const all = await loadStateAll()
    expect(Object.keys(all).sort()).toEqual(
      ['drafts', 'folders', 'hiddenPinnedMessages', 'recentSearch', 'version'],
    )
    expect(all.version).toBe(1)
  })

  it('перезапись ключа отдаёт последнее значение', async () => {
    await saveStateKey('recentSearch', ['1'])
    await saveStateKey('recentSearch', ['9', '8'])

    expect((await loadStateAll()).recentSearch).toEqual(['9', '8'])
  })
})
