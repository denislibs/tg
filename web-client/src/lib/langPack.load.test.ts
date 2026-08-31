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

import rootScope from './rootScope'
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
    // Язык ВЫБРАН (владелец — ядро, задача 8), и кэш про него же.
    I18n.setLangCode('ru')
    owner.cachedPack.mockResolvedValue(RU_V4)

    await I18n.getCacheLangPackAndApply()

    expect(I18n.getLastRequestedLangCode()).toBe('ru')
    expect(i18n('CurrentSession').textContent).toBe('Это устройство')
    // Английский лежит СНИЗУ: ключ, которого нет в серверном пакете, показывает
    // английский ТЕКСТ, а не символическое имя.
    //
    // КЛЮЧ ВЫБРАН ТАК, ЧТОБЫ ОТСУТСТВИЕ НИЖНЕГО СЛОЯ БЫЛО ВЫРАЗИМО. Здесь стоял
    // `Delete`, и проверка была тавтологией: английское значение этого ключа —
    // буквально «Delete», то есть «упало на английский» и «вернуло имя ключа»
    // давали один и тот же текст. Таких ключей в `lang.ts` шестьдесят один, и
    // мутация «снять английский нижний слой» на них зеленеет. У `ArchivedChats`
    // текст («Archived Chats») с именем не совпадает — на нём она краснеет.
    expect(i18n('ArchivedChats').textContent).toBe('Archived Chats')
    // В сеть холодный старт не ходит — свежесть догоняет фоновая проверка,
    // и владельцу передан ИМЕННО поднятый язык: по нему он делает первую из
    // двух сверок «язык не сменили, пока летела разница».
    expect(owner.getPack).not.toHaveBeenCalled()
    expect(owner.checkForUpdates).toHaveBeenCalledWith('ru')
  })

  // ЗАДАЧА 8, «второй источник текущего языка обязан исчезнуть». Раньше холодный
  // старт ВЫВОДИЛ язык из того пакета, что оказался в кэше (`setLangCode(pack.lang_code)`),
  // и кэш чужого языка молча переопределял выбор пользователя. Воспроизводится
  // это ровно тем, чем и в жизни: выбран русский, а кэша про него нет —
  // приватное окно, чистый IndexedDB, кэш от прежнего языка.
  it('кэш ЧУЖОГО языка не переопределяет выбор — ядро идёт за пакетом выбранного', async() => {
    I18n.setLangCode('ru')
    owner.cachedPack.mockResolvedValue(pack('en', 3, [str('CurrentSession', 'This device (server)')]))
    owner.getPack.mockImplementation(async (langCode: string) => (langCode === 'ru' ? RU_V4 : null))

    const applied = await I18n.getCacheLangPackAndApply()

    expect(applied.lang_code).toBe('ru')
    expect(I18n.getLastRequestedLangCode()).toBe('ru')
    expect(i18n('CurrentSession').textContent).toBe('Это устройство')
    expect(owner.getPack).toHaveBeenCalledWith('ru')
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
    I18n.setLangCode('ru') // выбран русский, кэш про него же
    owner.cachedPack.mockResolvedValue(RU_V4)
    await I18n.getCacheLangPackAndApply()

    const el = i18n('CurrentSession')
    document.body.append(el)
    expect(el.textContent).toBe('Это устройство')

    owner.checkForUpdates.mockResolvedValue(RU_V9)
    await checkLangPackForUpdates()

    expect(el.textContent).toBe('Это устройство (обновлено)')
    // Английский снизу от обновления не пострадал (ключ с текстом, отличным от
    // своего имени, — см. разбор выше).
    expect(i18n('ArchivedChats').textContent).toBe('Archived Chats')
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
    expect(i18n('ArchivedChats').textContent).toBe('Archived Chats')
  })

  it('владелец отказал на смене языка — применяется английский, а не символические ключи', async() => {
    owner.getPack.mockRejectedValue(new Error('worker gone'))

    await I18n.getLangPackAndApply('ru')

    expect(I18n.getLastRequestedLangCode()).toBe('ru')
    expect(i18n('CurrentSession').textContent).toBe('This device')
  })

  it('язык переключили, пока летела проверка — доехавшая разница наружу не уезжает', async() => {
    I18n.setLangCode('ru') // выбран русский, кэш про него же
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
    I18n.setLangCode('ru') // выбран русский, кэш про него же
    owner.cachedPack.mockResolvedValue(RU_V4)
    await I18n.getCacheLangPackAndApply()

    const el = i18n('CurrentSession')
    document.body.append(el)

    owner.checkForUpdates.mockResolvedValue(null)
    await expect(checkLangPackForUpdates()).resolves.toBeUndefined()

    expect(el.textContent).toBe('Это устройство')
  })
})

// ── ОТПРАВКА КРОСС-ТАБОВОГО СОБЫТИЯ (порт tweb langPack.ts:325) ────────────────
//
// Первое из трёх звеньев цепочки «сменил язык в одной вкладке — перевелись все».
// Перенос пинит `client/realtimeBridge.test.ts`, приём — `client/boot.lang.test.ts`,
// а вот отправку не пинило НИЧЕГО: её удаление оставляло всю сюиту зелёной, то
// есть дефект, который нашла живая проверка задачи 9, возвращался бы молча.
//
// Событие ШИРОКОВЕЩАТЕЛЬНОЕ (`dispatchEvent`, а не `dispatchEventSingle`) — в
// этом весь его смысл: соседняя вкладка узнаёт о выборе только через воркер.
// Поэтому проверяется не только факт доставки, но и КАКОЙ метод шины вызван:
// подмена на местный `dispatchEventSingle` в этой вкладке не изменила бы ничего
// и снова оставила бы соседей на прежнем языке.
describe('applyLangPack объявляет смену языка соседним вкладкам', () => {
  beforeEach(async () => {
    rootScope.cleanup()
    // ПРИМЕНЁННЫЙ язык приводится к английскому, а не только запрошенный:
    // событие уходит на СМЕНУ применённого (`lastAppliedLangCode`), и соседний
    // тест этого же файла, оставивший применённым русский, сделал бы
    // переключение на русский ниже не сменой вовсе.
    owner.getPack.mockResolvedValue(null)
    await I18n.getLangPackAndApply('en')
    rootScope.cleanup()
  })

  it('язык сменился — уходит широковещательное language_change с его кодом', async() => {
    const seen: unknown[] = []
    const spy = vi.spyOn(rootScope, 'dispatchEvent')
    rootScope.addEventListener('language_change', (code) => seen.push(code))
    owner.getPack.mockResolvedValue(RU_V4)

    await I18n.getLangPackAndApply('ru')

    expect(seen).toEqual(['ru'])
    expect(spy).toHaveBeenCalledWith('language_change', 'ru')
    spy.mockRestore()
  })

  it('переприменение ТОГО ЖЕ языка соседей не будит', async() => {
    // Фоновая проверка обновлений применяет пакет заново по нескольку раз за
    // сессию. Ушедшее на каждое такое применение событие заставляло бы каждую
    // соседнюю вкладку лезть за пакетом — при том, что язык у неё не менялся.
    // Условие у оригинала стоит там же: внутри ветки «применённый язык другой».
    owner.getPack.mockResolvedValue(RU_V4)
    await I18n.getLangPackAndApply('ru')

    const seen: unknown[] = []
    rootScope.addEventListener('language_change', (code) => seen.push(code))
    owner.checkForUpdates.mockResolvedValue(RU_V9)
    await checkLangPackForUpdates()

    expect(seen).toEqual([])
  })
})
