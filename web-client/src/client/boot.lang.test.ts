// ── СТАРТ ЯЗЫКА: строки на месте ДО первого кадра ─────────────────────────────
//
// Ради этого утверждения задача 9 и переставляла загрузку. Держалось оно раньше
// побочным эффектом импорта (`i18n/index.tsx` наполнял ядро английским прямо на
// создании стора), и проверял его файл `i18n/coreOnImport.test.ts`. Побочного
// эффекта больше нет — строки приезжают с сервера, — поэтому гарантию даёт САМ
// СТАРТ: `bootstrap()` дожидается `I18n.getCacheLangPackAndApply()` в том же
// `Promise.all`, что и чтение State, и только потом отдаёт управление рендеру.
//
// Пропуск не теоретический: ванильные подписи (`Button`, `Row`, `ButtonMenuItem`,
// кнопки попапов) строятся `i18n()` в момент создания узла, и на пустом ядре
// пользователь прочитал бы имя ключа — «ChatList.Context.Mute» вместо «Без звука».
//
// Проверяется ВЫДАЧА `i18n()`, а не размер карты: карту можно наполнить и не тем
// языком, и не теми формами.
import { describe, expect, it, vi, beforeEach } from 'vitest'

// Владелец пакета ОТКАЗЫВАЕТ на всех вопросах — это и есть худший случай, который
// обязан пережить старт: воркер не поднялся / сети нет / кэш пуст. Под пакетом
// остаётся локальный английский (`applyServerLangPack`), и вкладка поднимается со
// строками, а не с ключами.
const langPack = vi.hoisted(() => ({
  cachedPack: vi.fn<() => Promise<null>>(async () => null),
  getPack: vi.fn<(code: string) => Promise<null>>(async () => null),
  checkForUpdates: vi.fn(async () => null),
  getLanguages: vi.fn(async () => { throw new Error('offline') }),
}))

vi.mock('./bootstrap', () => ({
  startClient: () => ({
    managers: {
      auth: { me: vi.fn(async () => null) },
      persist: { stateKey: vi.fn(async () => {}) },
      dialogs: { fillMirror: vi.fn(async () => null), refresh: vi.fn(async () => null) },
      langPack,
    },
    ep: {},
  }),
}))
vi.mock('./dnpBridgeHandoff', () => ({ installBridgeHandoff: vi.fn() }))
vi.mock('../core/pwa', () => ({ initPwaInstall: vi.fn() }))
vi.mock('../core/preventDeadlock', () => ({ preventCrossTabDynamicImportDeadlock: vi.fn(async () => {}) }))
vi.mock('../core/state/migrateRecentSearch', () => ({ migrateRecentSearchFromLocalStorage: vi.fn() }))
vi.mock('../core/store/idbKv', () => ({ idbGet: vi.fn(async () => 'TOKEN') }))
vi.mock('../core/store/persist', () => ({ persistScope: vi.fn(async () => {}) }))
vi.mock('../core/state/loadState', async () => {
  const { initialState } = await import('../core/state/state')
  return {
    loadStateOnce: vi.fn(async () => initialState()),
    resetStateCache: vi.fn(),
    stateWasResetToDefaults: () => false,
  }
})

import I18n, { i18n } from '@lib/langPack'
import rootScope from '@lib/rootScope'
import { bootstrap } from './boot'

beforeEach(() => {
  I18n.strings.clear()
  I18n.setLangCode('en')
  // `bootstrap()` вешает подписку на смену языка, и в прогоне он зовётся в
  // каждом тесте — накопленные подписки снимаются целиком (`cleanup` вендорной
  // шины), иначе «второй поход в сеть» ловился бы их числом, а не сверкой в
  // самом обработчике.
  rootScope.cleanup()
  vi.clearAllMocks()
})

describe('boot: язык поднят до первого кадра', () => {
  it('после bootstrap() узел ядра несёт текст, а не имя ключа', async () => {
    // До старта карта пуста — иначе проверка ниже зеленела бы на чужом наполнении.
    expect(i18n('ArchivedChats').textContent).toBe('ArchivedChats')

    await bootstrap()

    expect(langPack.cachedPack).toHaveBeenCalled()
    expect(i18n('ArchivedChats').textContent).toBe('Archived Chats')
  })

  // БЛОКЕР финального ревью: первый кадр держался СЕТЕВЫМ запросом. На промахе
  // кэша `getCacheLangPackAndApply` уходил за пакетом в сеть, а `RestClient` не
  // знает ни таймаута, ни `AbortSignal` — при ВИСЯЩЕЙ сети (не отказе)
  // `bootstrap()` не возвращался вовсе, и пользователь смотрел на пустую
  // страницу до таймаута браузера. Отказ владельца (тест выше) этого не ловит:
  // отказ — быстрый, и живая проверка волны прошла именно на нём (бэкенд был
  // ОСТАНОВЛЕН).
  //
  // Здесь сеть именно ВИСИТ. Если старт снова начнёт её ждать, тест не «упадёт
  // по значению», а истечёт по таймауту — то же, что видит пользователь.
  it('ВИСЯЩАЯ сеть не отнимает первый кадр', async () => {
    langPack.cachedPack.mockResolvedValueOnce(null) // промах кэша: первый заход
    langPack.getPack.mockReturnValueOnce(new Promise(() => {})) // сеть висит

    await bootstrap()

    // Кадр есть и строки в нём настоящие.
    expect(i18n('ArchivedChats').textContent).toBe('Archived Chats')
    // А догон всё-таки запущен — просто его никто не ждёт.
    expect(langPack.getPack).toHaveBeenCalledWith('en')
  })

  it('отказ ВЛАДЕЛЬЦА не оставляет вкладку без строк', async () => {
    // Воркер не поднялся вовсе: каждый прыжок к нему реджектится. `askOwner`
    // обязан прочитать это как «пакета нет», а не как «строк нет».
    langPack.cachedPack.mockRejectedValueOnce(new Error('no worker'))
    langPack.getPack.mockRejectedValueOnce(new Error('no worker'))

    await bootstrap()

    expect(i18n('ArchivedChats').textContent).toBe('Archived Chats')
  })
})

// ── ПРИЁМНИК КРОСС-ТАБОВОЙ СМЕНЫ ЯЗЫКА (порт tweb index.ts:519-521) ─────────────
//
// Цепочка из ТРЁХ звеньев: отправка (`langPack.ts::applyLangPack` →
// `dispatchEvent('language_change')`), перенос (`realtimeBridge::WORKER_EVENTS`) и
// приём — вот он. Живая проверка задачи 9 нашла обрыв в среднем звене, и первый
// заход запинил только его: удаление отправки ИЛИ этой подписки оставляло всю
// сюиту зелёной (4223 из 4223), то есть обрыв возвращался бы молча. Отправку
// пинит `lib/langPack.load.test.ts`, приём — здесь.
describe('boot: смена языка в соседней вкладке применяется', () => {
  it('событие шины ведёт к загрузке пакета объявленного языка', async () => {
    await bootstrap()
    langPack.getPack.mockClear()

    // `dispatchEventSingle`, а не `dispatchEvent`: так это событие и приходит от
    // соседа — насос вкладки ре-эмитит принятое СТРОГО локально, иначе оно ушло
    // бы обратно в воркер и закольцевалось.
    rootScope.dispatchEventSingle('language_change', 'ru')
    await Promise.resolve()

    expect(langPack.getPack).toHaveBeenCalledWith('ru')
    expect(I18n.getLastRequestedLangCode()).toBe('ru')
  })

  it('СВОЁ событие второго похода в сеть не делает', async () => {
    // Шина шлёт порождённое этой вкладкой и локальным подписчикам тоже, а язык к
    // этому моменту уже применён. Без сверки каждая смена языка стоила бы двух
    // запросов пакета, а у tweb на этом месте прямо стоит оговорка «will occur
    // extra time in the original tab though» — сверка её и снимает.
    await bootstrap()
    langPack.getPack.mockClear()

    rootScope.dispatchEventSingle('language_change', I18n.getLastRequestedLangCode())
    await Promise.resolve()

    expect(langPack.getPack).not.toHaveBeenCalled()
  })
})
