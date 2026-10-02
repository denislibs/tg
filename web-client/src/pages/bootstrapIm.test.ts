// Порядок старта мессенджера — порт tweb `pages/bootstrapIm.ts`. Замоканы
// границы: владелец списка (его `start()` — предмет `lib/appDialogsManager`),
// остров оверлеев, снятие экрана входа и сеть шрифтов.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => [] as string[])
const start = vi.hoisted(() => vi.fn(() => { calls.push('start') }))
const disposeActiveAuthFlow = vi.hoisted(() => vi.fn())
const mountGlobalOverlays = vi.hoisted(() => vi.fn())

vi.mock('@lib/appDialogsManager', () => ({ default: { start } }))
vi.mock('@components/shell/mountGlobalOverlays', () => ({ mountGlobalOverlays }))
vi.mock('@components/auth/mountAuthFlow.solid', () => ({ disposeActiveAuthFlow }))
vi.mock('@core/dom/loadFonts', () => ({ loadFonts: vi.fn(async() => {}) }))
vi.mock('@/client/bootstrap', () => ({ getProxiedManagers: () => ({}) }))

let bootstrapIm: typeof import('./bootstrapIm').bootstrapIm
let pageChats: HTMLElement

beforeEach(async() => {
  vi.resetModules()
  calls.length = 0
  start.mockClear()
  disposeActiveAuthFlow.mockClear()
  ;({ bootstrapIm } = await import('./bootstrapIm'))
  // статика `index.html` (`test/staticMarkup.ts`): `#page-chats` скрыт, `has-auth-pages` на body
  pageChats = document.getElementById('page-chats')!
  pageChats.style.display = 'none'
  document.body.classList.add('has-auth-pages')
})

afterEach(() => {
  vi.useRealTimers()
  document.body.classList.remove('has-auth-pages')
})

describe('bootstrapIm', () => {
  it('показывает #page-chats до start(), has-auth-pages снимает только после doubleRaf (tweb :27-28, :51, :60-61)', async() => {
    start.mockImplementationOnce(() => {
      calls.push(`start:display=${pageChats.style.display}:auth=${document.body.classList.contains('has-auth-pages')}`)
    })

    await bootstrapIm()

    expect(calls).toEqual(['start:display=:auth=true'])
    expect(document.body.classList.contains('has-auth-pages')).toBe(false)
    expect(mountGlobalOverlays).toHaveBeenCalledTimes(1)
  })

  it('идемпотентен: второй вызов — пустой ход (tweb :9, :22-23)', async() => {
    await Promise.all([bootstrapIm(), bootstrapIm()])
    await bootstrapIm()

    expect(start).toHaveBeenCalledTimes(1)
  })

  it('экран входа снимается через секунду после показа (tweb :65-67)', async() => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    await bootstrapIm()

    expect(disposeActiveAuthFlow).not.toHaveBeenCalled()
    vi.advanceTimersByTime(999)
    expect(disposeActiveAuthFlow).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(disposeActiveAuthFlow).toHaveBeenCalledTimes(1)
  })
})
