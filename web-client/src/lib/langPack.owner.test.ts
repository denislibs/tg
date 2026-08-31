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
  // Список языков сервера — им проверяется предложение по браузеру (см. третий
  // блок). Пустым его оставлять нельзя: «предложение не взялось» тогда значило бы
  // «сервер молчит», а не «языка у сервера нет».
  getLanguages: vi.fn(async () => [
    { _: 'langPackLanguage', name: 'English', native_name: 'English', lang_code: 'en' },
    { _: 'langPackLanguage', name: 'Russian', native_name: 'Русский', lang_code: 'ru' },
  ]),
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
  // Свежий модульный граф — своё ядро, и оно ПУСТО (общий сетап наполнял
  // предыдущее). Наполняем локальным английским напрямую, минуя `setLangCode`:
  // предмет этого файла — владелец кода языка, и лишняя запись в хранилище
  // исказила бы его.
  const lang = (await import('@/lang')).default
  I18n.applyLangPack({
    _: 'langPackDifference',
    lang_code: I18n.getLastRequestedLangCode(),
    from_version: 0,
    version: 0,
    strings: I18n.formatLocalStrings(lang),
  })
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
    // Предложение браузера — не дело ИМПОРТА: он поднимает ВЫБОР. Предлагает
    // отдельный вызов `suggestBrowserLangCode` (см. блок ниже, #117), и он
    // асинхронный — спрашивает список языков у сервера.
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
    // не сдвинуло: пакет летит.
    expect(I18n.getLastRequestedLangCode()).toBe('de')
    expect(localStorage.getItem('tg-lang')).toBe('de')
    expect(useI18nStore.getState().lang).toBe('en')

    await I18n.getLangPackAndApply('de')

    expect(useI18nStore.getState().lang).toBe('de')
  })

  // MINOR ревью задачи 8: зеркало и строки — один факт с двух сторон. Раньше
  // `lang` двигал `setLang` до загрузки, и на отказе загрузки кружок выбранного
  // языка переезжал, а интерфейс оставался на прежнем — навсегда. Задача 9
  // сделала это структурным: `lang` в сторе кладёт ТОЛЬКО обработчик
  // `language_apply`, то есть ровно то же событие, что меняет строки.
  it('пакет ещё летит — кружок не переехал вперёд строк', async() => {
    const { I18n, useI18nStore } = await bootStore()
    let release: () => void = () => {}
    owner.getPack.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(null) }))

    const flying = I18n.getLangPackAndApply('ru')

    // Владелец языка уже сдвинут (порт tweb: `setLangCode` стоит до загрузки), а
    // зеркало — нет: строки на экране всё ещё английские.
    expect(I18n.getLastRequestedLangCode()).toBe('ru')
    expect(useI18nStore.getState().lang).toBe('en')
    expect(useI18nStore.getState().t('ArchivedChats')).toBe('Archived Chats')

    release()
    await flying
    expect(useI18nStore.getState().lang).toBe('ru')
  })

  // Пакета у сервера нет (или сети нет вовсе) — это НЕ повод остаться без строк:
  // под пакетом всегда лежит локальный английский, и вкладка поднимается.
  it('язык, пакета для которого нет, остаётся языком, а строки — английскими', async() => {
    const { I18n, useI18nStore } = await bootStore()

    await I18n.getLangPackAndApply('it')

    expect(owner.getPack).toHaveBeenCalledWith('it')
    expect(I18n.getLastRequestedLangCode()).toBe('it')
    expect(useI18nStore.getState().lang).toBe('it')
    expect(useI18nStore.getState().t('ArchivedChats')).toBe('Archived Chats')
  })
})

// Половина механизма tweb, ЗАДАЧА #117: язык браузера у оригинала не умолчание,
// а ПРЕДЛОЖЕНИЕ (`system_lang_code` → `config.suggested_lang_code` → кнопка
// «Continue in Russian» на экране входа). Кнопки у нас нет, поэтому предложение
// применяется молча — и обязано быть СЛАБЕЕ выбора.
//
// Задача 9 сменила ИСТОЧНИК ответа «умеем ли мы показать этот язык»: раньше им
// был список чанков словарей в бандле, теперь — список языков СЕРВЕРА, потому
// что строки приезжают оттуда же.
describe('предложение языка по браузеру (#117)', () => {
  beforeEach(() => {
    localStorage.clear()
    // Счётчик вызовов — часть утверждений ниже («список не спрашивали вовсе»),
    // поэтому чистится: мок владельца общий на весь файл.
    owner.getLanguages.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Свежий импорт ядра вместе со стором + само предложение. */
  async function suggest() {
    vi.resetModules()
    const langPack = await import('./langPack')
    const { useI18nStore } = await import('@/i18n')
    await langPack.suggestBrowserLangCode()
    return { I18n: langPack.default, useI18nStore }
  }

  it('без выбора берётся язык браузера — и он же объявлен владельцу', async() => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU')

    const { I18n, useI18nStore } = await suggest()

    expect(I18n.getLastRequestedLangCode()).toBe('ru')
    expect(useI18nStore.getState().lang).toBe('ru')
  })

  it('язык браузера, которого нет У СЕРВЕРА, не берётся', async() => {
    // Итальянского нет в выдаче `getLanguages` — взяв его, экран выбора языка
    // остался бы без отмеченной строки, а строки на экране всё равно были бы
    // английскими: пакета для него у сервера нет.
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('it-IT')

    const { I18n, useI18nStore } = await suggest()

    expect(owner.getLanguages).toHaveBeenCalled()
    expect(I18n.getLastRequestedLangCode()).toBe('en')
    expect(useI18nStore.getState().lang).toBe('en')
  })

  it('ВЫБОР сильнее предложения: выбранный английский не перебивается русским браузером', async() => {
    localStorage.setItem('tg-lang', 'en')
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU')

    const { I18n, useI18nStore } = await suggest()

    // Спрашивать список незачем: выбор уже есть, и он сильнее.
    expect(owner.getLanguages).not.toHaveBeenCalled()
    expect(I18n.getLastRequestedLangCode()).toBe('en')
    expect(useI18nStore.getState().lang).toBe('en')
  })

  // Выбор, сделанный ПОКА ЛЕТЕЛ СПИСОК, тоже сильнее: `hasStoredLangCode`
  // отвечает по снимку хранилища, снятому на импорте, и о выборе этой же сессии
  // не знает — без сверки предложение перебило бы его.
  it('язык, выбранный пока летел список, предложением не перебивается', async() => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU')
    vi.resetModules()
    const langPack = await import('./langPack')
    let release: () => void = () => {}
    owner.getLanguages.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve([
        { _: 'langPackLanguage', name: 'Russian', native_name: 'Русский', lang_code: 'ru' },
      ])
    }))

    const flying = langPack.suggestBrowserLangCode()
    langPack.default.setLangCode('de') // пользователь выбрал сам
    release()
    await flying

    expect(langPack.default.getLastRequestedLangCode()).toBe('de')
  })
})
