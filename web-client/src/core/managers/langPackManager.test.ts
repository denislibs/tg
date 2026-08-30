// Владелец языкового пакета: кэш, сеть и АРИФМЕТИКА ВЕРСИИ.
//
// Фикстуры нарочно РАЗЛИЧАЮТ правильное поведение и неправильное — этим уже
// дважды промахивались в волне. Поэтому здесь: версии у языков разные (ru 3,
// en 11), номера версий не совпадают ни с длиной вектора, ни с единицей,
// разница непустая и несёт ВСЕ ТРИ вида изменения (правка, новый ключ, снятый
// ключ). Подмена версии литералом или «взять первую строку» на таких данных
// краснеет, а на снимке из одинаковых единиц прошла бы молча.
import { describe, it, expect, vi } from 'vitest'

import type { LangPackDifference, LangPackString } from '@layer'
import { newLangPackManager, type LangPackKV } from './langPackManager'
import type { RestClient } from '../net/restClient'

const str = (key: string, value: string): LangPackString => ({ _: 'langPackString', key, value })
const deleted = (key: string): LangPackString => ({ _: 'langPackStringDeleted', key })

const pack = (langCode: string, version: number, strings: LangPackString[], fromVersion = 0): LangPackDifference => ({
  _: 'langPackDifference',
  lang_code: langCode,
  from_version: fromVersion,
  version,
  strings,
})

/** Русский пакет версии 3 — то, что уже лежит в кэше в большинстве случаев. */
const RU_V3 = pack('ru', 3, [
  str('CurrentSession', 'Это устройство'),
  str('Archive', 'Архив'),
  str('Cancel', 'Отмена'),
])

/** Английский версии 11 — ДРУГОЙ язык с ДРУГОЙ версией: подмена кода или
 *  версии константой на таком соседе видна. */
const EN_V11 = pack('en', 11, [str('CurrentSession', 'This device')])

/** Разница 3 → 5: правка, новый ключ, снятый ключ. */
const RU_DIFF_3_5 = pack('ru', 5, [
  str('Archive', 'Архив чатов'),
  str('Delete', 'Удалить'),
  deleted('Cancel'),
], 3)

function kv(initial?: LangPackDifference) {
  const store = new Map<string, unknown>()
  if (initial) store.set('langpack', initial)
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key)) as unknown as LangPackKV['get'],
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value) }),
  }
}

const restOf = (get: ReturnType<typeof vi.fn>) => ({ get } as unknown as RestClient)

describe('LangPackManager', () => {
  it('пустой кэш — пакет тянется с сервера по коду языка и ложится в кэш', async() => {
    const get = vi.fn(async () => RU_V3)
    const store = kv()
    const mgr = newLangPackManager({ rest: restOf(get), kv: store })

    await expect(mgr.getPack('ru')).resolves.toEqual(RU_V3)

    expect(get).toHaveBeenCalledWith('/langpack/ru')
    expect(store.store.get('langpack')).toEqual(RU_V3)
  })

  it('кэш того же языка отдаётся БЕЗ сети', async() => {
    const get = vi.fn(async () => EN_V11)
    const mgr = newLangPackManager({ rest: restOf(get), kv: kv(RU_V3) })

    await expect(mgr.getPack('ru')).resolves.toEqual(RU_V3)
    expect(get).not.toHaveBeenCalled()
  })

  it('кэш ЧУЖОГО языка не годится — идём в сеть за запрошенным', async() => {
    const get = vi.fn(async () => EN_V11)
    const store = kv(RU_V3)
    const mgr = newLangPackManager({ rest: restOf(get), kv: store })

    await expect(mgr.getPack('en')).resolves.toEqual(EN_V11)
    expect(get).toHaveBeenCalledWith('/langpack/en')
    // Кэш перезаписан целиком: пакет хранится для ТЕКУЩЕГО языка.
    expect(store.store.get('langpack')).toEqual(EN_V11)
  })

  it('cachedPack не ходит в сеть никогда — это путь холодного старта', async() => {
    const get = vi.fn(async () => EN_V11)
    const mgr = newLangPackManager({ rest: restOf(get), kv: kv(RU_V3) })

    await expect(mgr.cachedPack()).resolves.toEqual(RU_V3)
    expect(get).not.toHaveBeenCalled()
  })

  it('офлайн без кэша — null, а не падение', async() => {
    const get = vi.fn(async () => { throw new Error('offline') })
    const mgr = newLangPackManager({ rest: restOf(get), kv: kv() })

    await expect(mgr.getPack('ru')).resolves.toBeNull()
    await expect(mgr.cachedPack()).resolves.toBeNull()
  })

  it('разница спрашивается ОТ ВЕРСИИ КЭША и применяется: правка, новый ключ, снятый ключ', async() => {
    const get = vi.fn(async () => RU_DIFF_3_5)
    const store = kv(RU_V3)
    const mgr = newLangPackManager({ rest: restOf(get), kv: store })

    const updated = await mgr.checkForUpdates()

    expect(get).toHaveBeenCalledWith('/langpack/ru/difference', { from_version: 3 })
    expect(updated?.version).toBe(5)
    expect(updated?.from_version).toBe(3)
    // Правка легла на место, новый ключ дописан, снятый УДАЛЁН (а не оставлен
    // конструктором `langPackStringDeleted`, который перекрыл бы английский
    // снизу и вывел бы на экран символический ключ).
    expect(updated?.strings).toEqual([
      str('CurrentSession', 'Это устройство'),
      str('Archive', 'Архив чатов'),
      str('Delete', 'Удалить'),
    ])
    expect(store.store.get('langpack')).toEqual(updated)
  })

  it('версия НЕ БОЛЬШЕ нашей — разница не применяется и кэш не трогается', async() => {
    // Сервер откатили: он отдаёт версию 2 при нашей 3 (и то же самое ровно на
    // равной версии 3 — проверяется вторым прогоном ниже).
    for (const version of [2, 3]) {
      const get = vi.fn(async () => pack('ru', version, [str('Archive', 'ЧУЖОЕ')], 3))
      const store = kv(RU_V3)
      const mgr = newLangPackManager({ rest: restOf(get), kv: store })

      await expect(mgr.checkForUpdates()).resolves.toBeNull()
      expect(store.store.get('langpack')).toEqual(RU_V3)
    }
  })

  it('разница ЧУЖОГО языка не применяется', async() => {
    const get = vi.fn(async () => pack('en', 12, [str('Archive', 'Archive')], 11))
    const store = kv(RU_V3)
    const mgr = newLangPackManager({ rest: restOf(get), kv: store })

    await expect(mgr.checkForUpdates()).resolves.toBeNull()
    expect(store.store.get('langpack')).toEqual(RU_V3)
  })

  it('дыра в версиях (from_version не наш) — весь пакет заново, а не наложение разницы', async() => {
    const RU_V7 = pack('ru', 7, [str('CurrentSession', 'Это устройство'), str('Delete', 'Удалить')])
    // Разница объявляет себя как «от версии 4», а у нас 3 — класть не на что.
    const get = vi.fn(async (path: string) => (
      path === '/langpack/ru' ? RU_V7 : pack('ru', 7, [str('Delete', 'Удалить')], 4)
    ))
    const store = kv(RU_V3)
    const mgr = newLangPackManager({ rest: restOf(get), kv: store })

    await expect(mgr.checkForUpdates()).resolves.toEqual(RU_V7)
    expect(get).toHaveBeenCalledWith('/langpack/ru')
    expect(store.store.get('langpack')).toEqual(RU_V7)
  })

  it('проверка без кэша — сравнивать не с чем, в сеть не идём', async() => {
    const get = vi.fn(async () => RU_DIFF_3_5)
    const mgr = newLangPackManager({ rest: restOf(get), kv: kv() })

    await expect(mgr.checkForUpdates()).resolves.toBeNull()
    expect(get).not.toHaveBeenCalled()
  })

  it('отказ сети на проверке — остаёмся на том, что в кэше', async() => {
    const get = vi.fn(async () => { throw new Error('offline') })
    const store = kv(RU_V3)
    const mgr = newLangPackManager({ rest: restOf(get), kv: store })

    await expect(mgr.checkForUpdates()).resolves.toBeNull()
    expect(store.store.get('langpack')).toEqual(RU_V3)
  })

  it('две вкладки за пакетом одного языка — один запрос на всех', async() => {
    let resolve: (p: LangPackDifference) => void = () => {}
    const get = vi.fn(() => new Promise<LangPackDifference>((r) => { resolve = r }))
    const mgr = newLangPackManager({ rest: restOf(get), kv: kv() })

    const both = Promise.all([mgr.getPack('ru'), mgr.getPack('ru')])
    // Оба обращения успели дойти до сети до того, как ответ пришёл.
    await Promise.resolve()
    await Promise.resolve()
    resolve(RU_V3)

    await expect(both).resolves.toEqual([RU_V3, RU_V3])
    expect(get).toHaveBeenCalledTimes(1)
  })
})
