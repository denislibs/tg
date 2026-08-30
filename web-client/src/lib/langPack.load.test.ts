// Вкладочная половина загрузки: слияние «локальный английский ПОД серверным
// пакетом», холодный старт без сети и перерисовка ЖИВЫХ узлов.
//
// Владелец пакета (менеджер воркера) здесь подменён — его собственная
// арифметика версий проверяется в `core/managers/langPackManager.test.ts`.
// Проверяется ровно то, чего владелец сделать не может: что строки доехали до
// `I18n.strings` и до уже вставленного в документ `.i18n`-узла.
import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { LangPackDifference, LangPackString } from '@layer'

const owner = vi.hoisted(() => ({
  cachedPack: vi.fn<() => Promise<unknown>>(),
  getPack: vi.fn<(langCode: string) => Promise<unknown>>(),
  checkForUpdates: vi.fn<() => Promise<unknown>>(),
}))

// Отдельный рубильник на САМ ПРЫЖОК через границу контекстов: чанк воркера не
// отдался после выкладки, `SharedWorker` недоступен — `startClient()` бросает
// синхронно, ещё до всякого RPC. Второй вид того же отказа (метод не
// зарегистрирован, воркер умер) — реджект вызова, он моками ниже.
const bootstrap = vi.hoisted(() => ({ unavailable: false }))

vi.mock('../client/bootstrap', () => ({
  startClient: () => {
    if (bootstrap.unavailable) throw new Error('SharedWorker недоступен')
    return { managers: { langPack: owner } }
  },
}))

import I18n, { i18n, checkLangPackForUpdates } from './langPack'

const str = (key: string, value: string): LangPackString => ({ _: 'langPackString', key, value })

const pack = (langCode: string, version: number, strings: LangPackString[], fromVersion = 0): LangPackDifference => ({
  _: 'langPackDifference',
  lang_code: langCode,
  from_version: fromVersion,
  version,
  strings,
})

// Русский версии 4 переводит ДВА ключа из тысячи с лишним английских: этого
// достаточно, чтобы отличить «серверный пакет лёг поверх» от «серверный пакет
// заменил собой всё» — второй случай оставил бы `Archive` без перевода вовсе.
const RU_V4 = pack('ru', 4, [str('CurrentSession', 'Это устройство'), str('Archive', 'Архив')])
const RU_V9 = pack('ru', 9, [str('CurrentSession', 'Это устройство (обновлено)'), str('Archive', 'Архив')], 4)

describe('I18n: загрузка пакета и применение', () => {
  beforeEach(() => {
    owner.cachedPack.mockReset().mockResolvedValue(null)
    owner.getPack.mockReset().mockResolvedValue(null)
    owner.checkForUpdates.mockReset().mockResolvedValue(null)
    document.body.replaceChildren()
    I18n.setLangCode('en')
    bootstrap.unavailable = false
  })

  it('без сети берёт локальный английский и не падает', async() => {
    // Ни кэша, ни сервера — путь первого запуска в самолётном режиме.
    await I18n.getCacheLangPackAndApply()

    expect(i18n('CurrentSession').textContent).toBe('This device')
  })

  it('холодный старт применяет пакет из кэша, а не английский', async() => {
    owner.cachedPack.mockResolvedValue(RU_V4)

    await I18n.getCacheLangPackAndApply()

    expect(I18n.getLastRequestedLangCode()).toBe('ru')
    expect(i18n('CurrentSession').textContent).toBe('Это устройство')
    // Английский лежит СНИЗУ: ключ, которого нет в серверном пакете, показывает
    // английский текст, а не символическое имя.
    expect(i18n('Delete').textContent).toBe('Delete')
    // В сеть холодный старт не ходит — свежесть догоняет фоновая проверка,
    // и владельцу передан ИМЕННО поднятый язык: по нему он делает первую из
    // двух сверок «язык не сменили, пока летела разница».
    expect(owner.getPack).not.toHaveBeenCalled()
    expect(owner.checkForUpdates).toHaveBeenCalledWith('ru')
  })

  it('живой узел перерисовывается при смене языка', async() => {
    // Сервер отвечает ПО КОДУ ЯЗЫКА: у английского серверного пакета нет вовсе
    // (его строки и есть локальный источник), у русского — версия 4.
    owner.getPack.mockImplementation(async (langCode: string) => (langCode === 'ru' ? RU_V4 : null))

    await I18n.getLangPackAndApply('en')
    const el = i18n('CurrentSession')
    document.body.append(el)
    expect(el.textContent).toBe('This device')

    await I18n.getLangPackAndApply('ru')

    expect(el.textContent).toBe('Это устройство') // тот же УЗЕЛ, не пересозданный
    expect(el.isConnected).toBe(true)
    expect(owner.getPack).toHaveBeenLastCalledWith('ru')
  })

  it('фоновая проверка обновлений докатывает новую версию до живого узла', async() => {
    owner.cachedPack.mockResolvedValue(RU_V4)
    await I18n.getCacheLangPackAndApply()

    const el = i18n('CurrentSession')
    document.body.append(el)
    expect(el.textContent).toBe('Это устройство')

    owner.checkForUpdates.mockResolvedValue(RU_V9)
    await checkLangPackForUpdates()

    expect(el.textContent).toBe('Это устройство (обновлено)')
    // Английский снизу от обновления не пострадал.
    expect(i18n('Delete').textContent).toBe('Delete')
  })

  it('владелец недоступен целиком (нет воркера) — старт поднимается на английском', async() => {
    // Класс отказа, которого у tweb нет: у него запасной путь `import('../lang')`
    // лежит в том же контексте. Чанк воркера не отдался после выкладки —
    // `startClient()` бросает синхронно, и без защиты старт реджектился бы
    // целиком: вкладка без строк, на экране символические ключи.
    bootstrap.unavailable = true

    const pack = await I18n.getCacheLangPackAndApply()

    expect(pack.lang_code).toBe('en')
    expect(i18n('CurrentSession').textContent).toBe('This device')
    // И фоновая проверка тем же отказом не роняет старт: её зовут через `void`,
    // реджект стал бы unhandled rejection.
    await expect(checkLangPackForUpdates()).resolves.toBeUndefined()
  })

  it('владелец отказал на кэше (метода нет, воркер умер) — тоже английский, а не пусто', async() => {
    // Ровно тот отказ, что воспроизводится в жизни: `no manager method:
    // langPack.cachedPack`. Реджект RPC — не «нет строк», а «нет пакета».
    owner.cachedPack.mockRejectedValue(new Error('no manager method: langPack.cachedPack'))
    owner.checkForUpdates.mockRejectedValue(new Error('no manager method: langPack.checkForUpdates'))

    await expect(I18n.getCacheLangPackAndApply()).resolves.toMatchObject({ lang_code: 'en' })
    expect(i18n('CurrentSession').textContent).toBe('This device')
    expect(i18n('Delete').textContent).toBe('Delete')
  })

  it('владелец отказал на смене языка — применяется английский, а не символические ключи', async() => {
    owner.getPack.mockRejectedValue(new Error('worker gone'))

    await I18n.getLangPackAndApply('ru')

    expect(I18n.getLastRequestedLangCode()).toBe('ru')
    expect(i18n('CurrentSession').textContent).toBe('This device')
  })

  it('язык переключили, пока летела проверка — доехавшая разница наружу не уезжает', async() => {
    owner.cachedPack.mockResolvedValue(RU_V4)
    await I18n.getCacheLangPackAndApply()

    const el = i18n('CurrentSession')
    document.body.append(el)
    expect(el.textContent).toBe('Это устройство')

    // Проверка ушла на русском и ещё летит.
    let release: (p: LangPackDifference) => void = () => {}
    owner.checkForUpdates.mockReturnValue(new Promise((r) => { release = r }))
    const checking = checkLangPackForUpdates()

    // Пользователь переключился на английский: серверного пакета у английского
    // нет вовсе, его строки и есть локальный источник.
    await I18n.getLangPackAndApply('en')
    expect(el.textContent).toBe('This device')

    release(RU_V9)
    const applied = await checking

    // Экран не откатывается на прежний язык — это держит сверка внутри
    // `applyLangPack` (порт tweb :275-277), и она обязана продолжать держать.
    expect(el.textContent).toBe('This device')
    expect(I18n.strings.get('CurrentSession' as never)).toMatchObject({ value: 'This device' })
    // А это держит сверка в `checkLangPackForUpdates`: НЕ ПРИМЕНЁННЫЙ пакет не
    // должен уезжать вызывающему как применённый.
    expect(applied).toBeUndefined()
  })

  it('владелец сказал «применять нечего» — язык остаётся как был', async() => {
    owner.cachedPack.mockResolvedValue(RU_V4)
    await I18n.getCacheLangPackAndApply()

    const el = i18n('CurrentSession')
    document.body.append(el)

    owner.checkForUpdates.mockResolvedValue(null)
    await expect(checkLangPackForUpdates()).resolves.toBeUndefined()

    expect(el.textContent).toBe('Это устройство')
  })
})
