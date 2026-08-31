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
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('язык браузера не угадывается — паритет с App.langPackCode оригинала', async() => {
    // Прежний `getInitial` брал `navigator.language`; у tweb такого нет вовсе.
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU')

    const I18n = await boot()

    expect(I18n.getLastRequestedLangCode()).toBe('en')
    vi.restoreAllMocks()
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

    expect(I18n.getLastRequestedLangCode()).toBe('de')
    expect(localStorage.getItem('tg-lang')).toBe('de')
    expect(useI18nStore.getState().lang).toBe('de')
    // Чанк словаря `setLang` запускает через `void`; дожидаемся его тем же
    // вызовом, иначе он догрузится уже после сноса тестового окружения.
    await (await import('@/i18n')).loadLang('de')
  })

  it('язык без словаря-чанка (код с сервера) остаётся языком, а строки — английскими', async() => {
    const { I18n, useI18nStore } = await bootStore()

    await (await import('@/i18n')).loadLang('it')

    expect(I18n.getLastRequestedLangCode()).toBe('it')
    expect(useI18nStore.getState().t('ArchivedChats')).toBe('Archived Chats')
  })
})
