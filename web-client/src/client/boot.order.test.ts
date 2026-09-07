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
import { useNavigationStore } from '../stores/navigationStore'
import { resetHashBootstrap } from '../core/hooks/useUrlSync'

beforeEach(() => {
  calls.length = 0
  vi.clearAllMocks()
  location.hash = ''
  useNavigationStore.getState().selectChat(null)
  // Защёлка «первое применение хэша» — модульная и одна на жизнь страницы;
  // между прогонами её надо снимать, иначе второй bootstrap() её не увидит.
  resetHashBootstrap()
})

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

// ── Открытие по ссылке стоит ДО списка диалогов ─────────────────────────────
// Порядок оригинала: `appImManager.construct` зовёт `onHashChange(true)`
// (tweb `appImManager.ts:834`), и только ПОТОМ `appDialogsManager` берётся за
// чатлист (`appDialogsManager.ts:726`). У нас первое применение хэша жило на
// эффекте смонтированного React (`App.tsx` → `useUrlSync`), то есть стояло
// после `await dialogsOp` и после всего маунта: под нагрузкой ссылка на канал
// начинала открываться последней из всего старта.
//
// Пин смотрит на ПОРЯДОК, а не на факт вызова: ответ владельца про диалоги
// держится неотвеченным, и чат обязан быть выбран ДО того, как он приедет.
// Верни применение хэша обратно за `await dialogsOp` — и `waitFor` ниже
// никогда не дождётся.
describe('boot: хэш применяется до загрузки списка диалогов', () => {
  it('чат из хэша выбран ещё до ответа fillMirror()', async () => {
    let release!: () => void
    dialogs.fillMirror.mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve({ op: 'reset' as const, items: [] }) }),
    )
    location.hash = '#-42'

    const booted = bootstrap()

    await vi.waitFor(() => {
      expect(useNavigationStore.getState().selectedId).toBe('-42')
    })
    // ...и это действительно ДО чатлиста: ни ответа владельца, ни сетевого догона.
    expect(calls).not.toContain('dialogs.refresh')

    release()
    await booted
  })

  // Без токена IM не поднимается вовсе (Shell рендерится под `authed`), и у
  // оригинала `bootstrapIm()` тоже зовётся только под авторизацией
  // (tweb `index.ts:628`/`:641`). Открывать по хэшу чат на экране входа значило
  // бы получить 401 и тост поверх формы логина.
  it('без токена boot хэш НЕ применяет — это делает монтирование Shell', async () => {
    const { idbGet } = await import('../core/store/idbKv')
    vi.mocked(idbGet).mockResolvedValueOnce(undefined as never)
    location.hash = '#-42'

    await bootstrap()

    expect(useNavigationStore.getState().selectedId).toBeNull()
  })

  it('под passcode-локом хэш не применяется — RPC под локом не летят', async () => {
    const { useSettingsStore } = await import('../settings')
    const before = useSettingsStore.getState().passcodeEnabled
    useSettingsStore.setState({ passcodeEnabled: true })
    location.hash = '#-42'
    try {
      await bootstrap()
      expect(useNavigationStore.getState().selectedId).toBeNull()
    } finally {
      useSettingsStore.setState({ passcodeEnabled: before })
    }
  })
})
