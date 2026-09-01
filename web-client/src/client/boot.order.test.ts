// Fix (финальное ревью, Important #1): гидрация владельца диалогов обязана быть
// УПОРЯДОЧЕНА относительно `persistScope(token)`.
//
// `persistScope` (core/store/persist.ts) при смене одного непустого токена на
// другой СТИРАЕТ офлайн-данные прошлого аккаунта — в том числе стор диалогов
// (S_DIALOGS) и State. Именно поэтому чтение State в boot стоит строго после
// него. Воркерный владелец (`core/managers/dialogsManager.ts::hydrate`) своего
// scope-гейта не имеет: воркерный `persistScope` зовётся один раз за жизнь
// воркера (`core/workerCore.ts::start`) и на переключении аккаунта не
// переигрывается, а сам SharedWorker переживает `location.reload()` вкладки.
//
// Сценарий дефекта: два аккаунта → «Переключить аккаунт» (migrateTo →
// location.reload()) → boot нового. Пока `fillDialogsMirror()` стартовал ДО
// `await persistScope(...)`, транзакция чтения воркера гонялась с транзакцией
// очистки main: выиграв гонку, воркер отдавал список ПРОШЛОГО аккаунта, boot
// применял его к зеркалу до первого рендера, а дебаунс владельца увозил его
// обратно на диск — уже под скоупом нового аккаунта (офлайн — навсегда).
//
// Тест гоняет НАСТОЯЩУЮ bootstrap() на фейковом окружении: сам порядок двух
// строк — это и есть поведение, и никакой юнит fillDialogsMirror/
// applyDialogsMirror (см. boot.dialogs.test.ts) его не выражает.
import { describe, expect, it, vi, beforeEach } from 'vitest'

const calls: string[] = []

const dialogs = {
  fillMirror: vi.fn(async () => { calls.push('dialogs.fillMirror'); return { op: 'reset' as const, items: [] } }),
  // Сетевой догон холодного старта — ПОЛНЫЙ refresh(), а не страница
  // (см. докблок applyDialogsMirror в boot.ts).
  refresh: vi.fn(async () => { calls.push('dialogs.refresh'); return null }),
}

vi.mock('./bootstrap', () => ({
  startClient: () => ({
    managers: { auth: { me: vi.fn(async () => null) }, persist: { stateKey: vi.fn(async () => {}) }, dialogs },
    ep: {},
  }),
}))
vi.mock('./dnpBridgeHandoff', () => ({ installBridgeHandoff: vi.fn() }))
vi.mock('../core/pwa', () => ({ initPwaInstall: vi.fn() }))
vi.mock('../core/preventDeadlock', () => ({ preventCrossTabDynamicImportDeadlock: vi.fn(async () => {}) }))
// Язык здесь не мокается вовсе: у фейкового `startClient` менеджера `langPack`
// нет, значит каждый прыжок к владельцу отказывает — и ядро поднимается на
// локальном английском (`askOwner` → `applyServerLangPack(null)`). Ровно то, что
// нужно шву: настоящий `await` в том же `Promise.all`, никакой сети. Сам старт
// языка пинит `boot.lang.test.ts`.
vi.mock('../core/state/migrateRecentSearch', () => ({ migrateRecentSearchFromLocalStorage: vi.fn() }))
vi.mock('../core/store/idbKv', () => ({ idbGet: vi.fn(async () => 'TOKEN-НОВОГО-АККАУНТА') }))
vi.mock('../core/store/persist', () => ({
  persistScope: vi.fn(async () => { calls.push('persistScope') }),
}))
vi.mock('../core/state/loadState', async () => {
  const { initialState } = await import('../core/state/state')
  return {
    loadStateOnce: vi.fn(async () => { calls.push('loadStateOnce'); return initialState() }),
    resetStateCache: vi.fn(),
    stateWasResetToDefaults: () => false,
  }
})

import { bootstrap } from './boot'
import { persistScope } from '../core/store/persist'

beforeEach(() => { calls.length = 0; vi.clearAllMocks() })

describe('boot: гидрация владельца диалогов упорядочена относительно persistScope', () => {
  it('fillMirror() владельца стартует ПОСЛЕ await persistScope(token)', async () => {
    await bootstrap()

    expect(persistScope).toHaveBeenCalledWith('TOKEN-НОВОГО-АККАУНТА')
    expect(calls.indexOf('persistScope')).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('dialogs.fillMirror')).toBeGreaterThan(calls.indexOf('persistScope'))
  })

  // Параллельность, ради которой RPC вообще стартует до `await` чтения State,
  // сохранена: fillMirror() уходит ДО того, как разрешится чтение State/словаря.
  it('но параллельность с чтением State сохранена — fillMirror() уходит до его ответа', async () => {
    await bootstrap()

    expect(calls.indexOf('dialogs.fillMirror')).toBeLessThan(calls.indexOf('loadStateOnce'))
  })
})
