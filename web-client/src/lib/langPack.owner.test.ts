// ВЛАДЕЛЕЦ «ТЕКУЩЕГО ЯЗЫКА» (задача 8): факт один, живёт в ядре, между запусками
// лежит в `localStorage('tg-lang')`.
//
// До задачи 8 ответов на вопрос «какой язык» было два: ядро выводило его из
// `lang_code` пакета в кэше, React-стор — из `tg-lang`, который писал сам. Здесь
// проверяется, что владелец теперь один и что ЗЕРКАЛО (стор) поднимается на его
// значении, а не на своём.
//
// Каждый прогон поднимает модули ЗАНОВО (`vi.resetModules` + динамический
// импорт): «поднялся на сохранённом языке» — это про импорт модуля, и на уже
// импортированном его не проверить.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const owner = vi.hoisted(() => ({
  cachedPack: vi.fn(async () => null),
  getPack: vi.fn(async () => null),
  checkForUpdates: vi.fn(async () => null),
}))

vi.mock('../client/bootstrap', () => ({ startClient: () => ({ managers: { langPack: owner } }) }))

/** Свежий импорт ядра — то же, что новый запуск вкладки. */
async function boot() {
  vi.resetModules()
  return (await import('./langPack')).default
}

/** Свежий импорт стора вместе с ядром: стор читает язык на создании. */
async function bootStore() {
  vi.resetModules()
  const I18n = (await import('./langPack')).default
  const { useI18nStore } = await import('@/i18n')
  return { I18n, useI18nStore }
}

describe('владелец текущего языка', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('без сохранённого выбора поднимается на английском', async() => {
    const I18n = await boot()

    expect(I18n.getLastRequestedLangCode()).toBe('en')
  })

  it('ЯДРО языка браузера не угадывает — умолчание владельца это App.langPackCode', async() => {
    // Предложение браузера — не дело владельца: он хранит ВЫБОР. Предлагает
    // `i18n/index.tsx::suggestLangCode` (см. отдельный блок ниже, #117).
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU')

    const I18n = await boot()

    expect(I18n.getLastRequestedLangCode()).toBe('en')
    vi.restoreAllMocks()
  })

  it('«выбрано en» отличимо от «ничего не выбрано»', async() => {
    const first = await boot()
    expect(first.hasStoredLangCode()).toBe(false)

    first.setLangCode('en')
    const second = await boot()

    expect(second.hasStoredLangCode()).toBe(true)
    expect(second.getLastRequestedLangCode()).toBe('en')
  })

  it('сохранённый выбор поднимается следующим запуском', async() => {
    const first = await boot()
    first.setLangCode('ru')
    expect(localStorage.getItem('tg-lang')).toBe('ru')

    const second = await boot()

    expect(second.getLastRequestedLangCode()).toBe('ru')
    expect(second.getLastRequestedNormalizedLangCode()).toBe('ru')
  })

  it('код с регионом сохраняется целиком, а нормализованный — без него', async() => {
    const first = await boot()
    first.setLangCode('pt-br')

    const second = await boot()

    expect(second.getLastRequestedLangCode()).toBe('pt-br')
    expect(second.getLastRequestedNormalizedLangCode()).toBe('pt')
  })

  it('мусор в хранилище не роняет старт и не становится языком', async() => {
    // `new Intl.PluralRules('ru_RU')` бросает RangeError (подчёркивание —
    // POSIX-форма, тегом языка она не является) — и бросил бы на импорте
    // модуля, то есть до всякого экрана.
    localStorage.setItem('tg-lang', 'ru_RU')

    const I18n = await boot()

    expect(I18n.getLastRequestedLangCode()).toBe('en')
  })

  it('хранилища нет вовсе (приватное окно) — старт поднимается на английском', async() => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('SecurityError') })

    const I18n = await boot()
    expect(I18n.getLastRequestedLangCode()).toBe('en')
    // И запись выбора в таком окне тоже не роняет: язык живёт до конца сессии.
    expect(() => I18n.setLangCode('ru')).not.toThrow()
    expect(I18n.getLastRequestedLangCode()).toBe('ru')

    getItem.mockRestore()
    setItem.mockRestore()
  })
})

describe('React-стор ЗЕРКАЛИТ владельца, а не заводит свой язык', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('поднимается на языке ядра, а не на своём чтении хранилища', async() => {
    localStorage.setItem('tg-lang', 'ru')

    const { I18n, useI18nStore } = await bootStore()

    expect(I18n.getLastRequestedLangCode()).toBe('ru')
    expect(useI18nStore.getState().lang).toBe('ru')
  })

  it('выбор языка в интерфейсе доезжает до владельца и до хранилища', async() => {
    const { I18n, useI18nStore } = await bootStore()

    useI18nStore.getState().setLang('de')

    // Владелец узнаёт СРАЗУ (порт tweb `getLangPackAndApply`: `setLangCode`
    // стоит до загрузки), а зеркало — вместе со строками, поэтому его тут ещё
    // не сдвинуло: чанк словаря летит.
    expect(I18n.getLastRequestedLangCode()).toBe('de')
    expect(localStorage.getItem('tg-lang')).toBe('de')
    expect(useI18nStore.getState().lang).toBe('en')

    await (await import('@/i18n')).loadLang('de')

    expect(useI18nStore.getState().lang).toBe('de')
  })

  // MINOR ревью задачи 8: зеркало и строки — один факт с двух сторон. Раньше
  // `lang` двигал `setLang` до загрузки чанка, и на отказе загрузки кружок
  // выбранного языка переезжал, а интерфейс оставался на прежнем — навсегда.
  it('чанк словаря не доехал — зеркало не сдвинулось вместе с кружком', async() => {
    const { useI18nStore } = await bootStore()

    // Язык, чей чанк не существует в природе: тот же исход, что у отказа сети.
    useI18nStore.getState().setLang('ru')
    vi.spyOn(useI18nStore, 'setState').mockImplementation(() => {}) // применение «не доехало»

    await (await import('@/i18n')).loadLang('ru')

    expect(useI18nStore.getState().lang).toBe('en')
    expect(useI18nStore.getState().t('ArchivedChats')).toBe('Archived Chats')
    vi.restoreAllMocks()
  })

  it('язык без словаря-чанка (код с сервера) остаётся языком, а строки — английскими', async() => {
    const { I18n, useI18nStore } = await bootStore()

    await (await import('@/i18n')).loadLang('it')

    expect(I18n.getLastRequestedLangCode()).toBe('it')
    expect(useI18nStore.getState().t('ArchivedChats')).toBe('Archived Chats')
  })
})

// Половина механизма tweb, ЗАДАЧА #117: язык браузера у оригинала не умолчание,
// а ПРЕДЛОЖЕНИЕ (`system_lang_code` → `config.suggested_lang_code` → кнопка
// «Continue in Russian» на экране входа). Кнопки у нас нет, поэтому предложение
// применяется молча — и обязано быть СЛАБЕЕ выбора.
describe('предложение языка по браузеру (#117)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('без выбора берётся язык браузера — и он же объявлен владельцу', async() => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU')

    const { I18n, useI18nStore } = await bootStore()

    expect(I18n.getLastRequestedLangCode()).toBe('ru')
    expect(useI18nStore.getState().lang).toBe('ru')
  })

  it('язык браузера, которого нет ни у нас, ни у сервера, не берётся', async() => {
    // Итальянского нет ни в наших чанках, ни в выдаче `getLanguages` (список
    // сервера сгенерирован из тех же файлов) — взяв его, экран выбора языка
    // остался бы без отмеченной строки.
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('it-IT')

    const { I18n, useI18nStore } = await bootStore()

    expect(I18n.getLastRequestedLangCode()).toBe('en')
    expect(useI18nStore.getState().lang).toBe('en')
  })

  it('ВЫБОР сильнее предложения: выбранный английский не перебивается русским браузером', async() => {
    localStorage.setItem('tg-lang', 'en')
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU')

    const { I18n, useI18nStore } = await bootStore()

    expect(I18n.getLastRequestedLangCode()).toBe('en')
    expect(useI18nStore.getState().lang).toBe('en')
  })
})
