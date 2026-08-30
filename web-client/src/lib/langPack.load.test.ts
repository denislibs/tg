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

vi.mock('../client/bootstrap', () => ({ startClient: () => ({ managers: { langPack: owner } }) }))

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
    // В сеть холодный старт не ходит — свежесть догоняет фоновая проверка.
    expect(owner.getPack).not.toHaveBeenCalled()
    expect(owner.checkForUpdates).toHaveBeenCalled()
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
