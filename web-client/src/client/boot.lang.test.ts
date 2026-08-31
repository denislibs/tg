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
import { bootstrap } from './boot'

beforeEach(() => {
  I18n.strings.clear()
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

  it('отказ ВЛАДЕЛЬЦА не оставляет вкладку без строк', async () => {
    // Воркер не поднялся вовсе: каждый прыжок к нему реджектится. `askOwner`
    // обязан прочитать это как «пакета нет», а не как «строк нет».
    langPack.cachedPack.mockRejectedValueOnce(new Error('no worker'))
    langPack.getPack.mockRejectedValueOnce(new Error('no worker'))

    await bootstrap()

    expect(i18n('ArchivedChats').textContent).toBe('Archived Chats')
  })
})
