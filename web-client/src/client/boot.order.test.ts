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
import { installFakeCanvas } from '@/test/fakeCanvas'

// Старт ставит фон страницы (`appChatBackground`, tweb index.ts:458, :567) — он
// рисует холсты по-настоящему, а в happy-dom нет 2D-контекста.
installFakeCanvas()

const calls: string[] = []

const dialogs = {
  fillMirror: vi.fn(async () => { calls.push('dialogs.fillMirror'); return { op: 'reset' as const, items: [] } }),
  // Сетевой догон холодного старта — ПОЛНЫЙ refresh(), а не страница
  // (см. докблок applyDialogsMirror в boot.ts).
  refresh: vi.fn(async () => { calls.push('dialogs.refresh'); return null }),
}

// Скоуп по токену делает воркер (`persist.scopeToSession`, S10): вкладка токен
// не читает. Ответ — «сессия есть».
const scopeToSession = vi.fn(async () => { calls.push('scopeToSession'); return true })
const me = vi.fn(async () => { calls.push('auth.me'); return null })
// Канал код-пароля (`client/passcodeClient.ts` → smp.invoke('passcode', …)).
const passcodeInvoke = vi.fn(async (_type: string, _task: { method: string }) => ({ isUsingPasscode: false, isLocked: false }))
const passcodeListeners: ((e: unknown) => void)[] = []
const smp = {
  on: vi.fn((_event: string, cb: (e: unknown) => void) => { passcodeListeners.push(cb) }),
  invoke: passcodeInvoke,
}

vi.mock('./bootstrap', () => ({
  startClient: () => ({
    managers: { auth: { me }, persist: { stateKey: vi.fn(async () => {}), scopeToSession }, dialogs },
    ep: {},
    smp,
  }),
}))
// Экран блокировки в этом шве — заглушка: предмет теста — что старт ЖДЁТ, а не разметка.
vi.mock('../components/passcodeLock/passcodeLockScreen.solid', () => ({ default: () => null }))
vi.mock('./dnpBridgeHandoff', () => ({ installBridgeHandoff: vi.fn() }))
vi.mock('../core/pwa', () => ({ initPwaInstall: vi.fn() }))
vi.mock('../core/preventDeadlock', () => ({ preventCrossTabDynamicImportDeadlock: vi.fn(async () => {}) }))
// Язык здесь не мокается вовсе: у фейкового `startClient` менеджера `langPack`
// нет, значит каждый прыжок к владельцу отказывает — и ядро поднимается на
// локальном английском (`askOwner` → `applyServerLangPack(null)`). Ровно то, что
// нужно шву: настоящий `await` в том же `Promise.all`, никакой сети. Сам старт
// языка пинит `boot.lang.test.ts`.
vi.mock('../core/state/migrateRecentSearch', () => ({ migrateRecentSearchFromLocalStorage: vi.fn() }))
vi.mock('../core/state/loadState', async () => {
  const { initialState } = await import('../core/state/state')
  return {
    loadStateOnce: vi.fn(async () => { calls.push('loadStateOnce'); return initialState() }),
    resetStateCache: vi.fn(),
    stateWasResetToDefaults: () => false,
  }
})

import { bootstrap } from './boot'
import { useSettingsStore } from '../settings'
import backgroundStyles from '../components/chat/bubbles/chatBackground.module.scss'

beforeEach(() => {
  calls.length = 0
  vi.clearAllMocks()
  location.hash = ''
})

describe('boot: гидрация владельца диалогов упорядочена относительно persistScope', () => {
  it('fillMirror() владельца стартует ПОСЛЕ await scopeToSession() (persistScope в воркере)', async () => {
    await bootstrap()

    expect(scopeToSession).toHaveBeenCalledTimes(1)
    expect(calls.indexOf('scopeToSession')).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('dialogs.fillMirror')).toBeGreaterThan(calls.indexOf('scopeToSession'))
  })

  // Параллельность, ради которой RPC вообще стартует до `await` чтения State,
  // сохранена: fillMirror() уходит ДО того, как разрешится чтение State/словаря.
  it('но параллельность с чтением State сохранена — fillMirror() уходит до его ответа', async () => {
    await bootstrap()

    expect(calls.indexOf('dialogs.fillMirror')).toBeLessThan(calls.indexOf('loadStateOnce'))
  })
})

// ── Фон страницы (tweb index.ts:567-568) ────────────────────────────────────
// Старт ставит `appChatBackground` до ветвления по authState и заводит
// перерисовку по смене обоев в настройках (`watchWallPaperSettings`, О-11).
describe('boot: фон страницы', () => {
  it('первым потомком body; смена обоев в сторе перерисовывает его', async () => {
    await bootstrap()
    const background = document.body.firstElementChild as HTMLElement
    expect(background.getAttribute('aria-hidden')).toBe('true')
    const shownColors = () => (background.querySelector(`.${backgroundStyles.SlotActive} canvas`) as HTMLCanvasElement | null)?.dataset.colors
    await vi.waitFor(() => expect(shownColors()).toBeDefined())

    const colors = ['#aac8ea', '#cfe0f2', '#c2d9ee', '#b3d0ea']
    useSettingsStore.getState().update({ wallpaper: { kind: 'preset', colors } })
    await vi.waitFor(() => expect(shownColors()).toBe(colors.join(',')))
    useSettingsStore.getState().update({ wallpaper: { kind: 'default' } })
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
