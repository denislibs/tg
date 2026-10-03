// Точка входа — порт tweb `src/index.ts` (развилка `:613-673`) и выход
// перезагрузкой (`apiManagerProxy.ts:619-634`, `:676-704`). Замоканы границы:
// холодный старт (`client/boot.ts`), экран входа, подъём мессенджера,
// перезагрузка контроллера навигации.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from './client/bootstrap'
import { RT } from './core/realtime/events'

const boot = vi.hoisted(() => ({ hasToken: false }))
const clearAll = vi.hoisted(() => vi.fn(async() => {}))
const me = vi.hoisted(() => vi.fn(async(): Promise<unknown> => ({ user: { id: 1 } })))
const managers = vi.hoisted(() => ({ persist: { clearAll }, auth: { me } }))
const mountAuthFlow = vi.hoisted(() => vi.fn())
const bootstrapIm = vi.hoisted(() => vi.fn(async() => {}))
const reload = vi.hoisted(() => vi.fn())
const saveKey = vi.hoisted(() => vi.fn(async() => {}))

vi.mock('./client/boot', () => ({
  bootstrap: vi.fn(async() => ({ managers, hasToken: boot.hasToken })),
}))
vi.mock('./client/bootData', () => ({ bootPrefetch: () => null, invalidateBootPrefetch: vi.fn() }))
vi.mock('./components/auth/mountAuthFlow.solid', () => ({ mountAuthFlow }))
vi.mock('./pages/bootstrapIm', () => ({ bootstrapIm }))
vi.mock('./core/navigation/appNavigationController', () => ({ default: { reload } }))
vi.mock('@lib/passcode/keyHandoff', () => ({ saveEncryptionKeyForHandoff: saveKey }))

let index: typeof import('./index')
let rootScope: typeof import('@lib/rootScope').default

beforeEach(async() => {
  vi.resetModules()
  ;[mountAuthFlow, bootstrapIm, reload, clearAll, saveKey].forEach((fn) => fn.mockClear())
  me.mockReset().mockResolvedValue({ user: { id: 1 } })
  boot.hasToken = false
  localStorage.clear()
  index = await import('./index')
  rootScope = (await import('@lib/rootScope')).default
})

afterEach(() => {
  document.getElementById('page-chats')!.classList.remove('main-screen-enter', 'main-screen-entering')
})

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('развилка старта (tweb :613-673)', () => {
  it('без сессии — mountAuthFlow, мессенджер не поднимается', async() => {
    await index.start()

    expect(mountAuthFlow).toHaveBeenCalledWith({ managers })
    expect(bootstrapIm).not.toHaveBeenCalled()
  })

  it('с сессией — bootstrapIm один раз, экран входа не монтируется', async() => {
    boot.hasToken = true
    await index.start()

    expect(bootstrapIm).toHaveBeenCalledTimes(1)
    expect(mountAuthFlow).not.toHaveBeenCalled()
  })

  it('should_animate_main: main-screen-enter до bootstrapIm, по окончании классы сняты, флаг стёрт (tweb :650-669)', async() => {
    boot.hasToken = true
    localStorage.setItem('msgr_animate_main', '1')
    const pageChats = document.getElementById('page-chats')!
    bootstrapIm.mockImplementationOnce(async() => {
      expect(pageChats.classList.contains('main-screen-enter')).toBe(true)
    })

    await index.start()

    expect(bootstrapIm).toHaveBeenCalledTimes(1)
    expect(pageChats.classList.contains('main-screen-enter')).toBe(false)
    expect(pageChats.classList.contains('main-screen-entering')).toBe(false)
    expect(localStorage.getItem('msgr_animate_main')).toBeNull()
  })

  it('истёкшая сессия (me → null): персист стёрт, перезагрузка без хэша', async() => {
    boot.hasToken = true
    me.mockResolvedValue(null)
    await index.start()
    await flush()

    expect(clearAll).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledTimes(1)
    expect((reload.mock.calls[0][0] as URL).hash).toBe('')
  })

  it('офлайн (me бросает) — остаёмся, перезагрузки нет', async() => {
    boot.hasToken = true
    me.mockRejectedValue(new Error('offline'))
    await index.start()
    await flush()

    expect(reload).not.toHaveBeenCalled()
  })
})

describe('выход и смена сессии — перезагрузка (В4-1)', () => {
  beforeEach(() => {
    index.listenSessionTransitions(managers as unknown as Managers)
  })

  it('logging_out без остающегося аккаунта: clearAll, затем reload без хэша и query', async() => {
    location.hash = '#@durov'
    rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: null })
    await flush()

    expect(clearAll).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledTimes(1)
    const url = reload.mock.calls[0][0] as URL
    expect(url.hash).toBe('')
    expect(url.search).toBe('')
  })

  it('logging_out с переездом: ключ код-пароля передан, reload без очистки персиста', async() => {
    rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: 2 })
    await flush()

    expect(saveKey).toHaveBeenCalledTimes(1)
    expect(clearAll).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('logged_in: новая сессия под страницей — reload', async() => {
    rootScope.dispatchEventSingle(RT.loggedIn, { userId: 3 })
    await flush()

    expect(reload).toHaveBeenCalledTimes(1)
  })
})
