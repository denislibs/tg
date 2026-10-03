// Порядок старта мессенджера — порт tweb `pages/bootstrapIm.ts`. Замоканы
// границы: владелец списка (его `start()` — предмет `lib/appDialogsManager`),
// остров оверлеев, снятие экрана входа, сеть шрифтов и загрузка опус-рекордера.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => [] as string[])
const start = vi.hoisted(() => vi.fn(() => { calls.push('start') }))
const disposeActiveAuthFlow = vi.hoisted(() => vi.fn())
const mountGlobalOverlays = vi.hoisted(() => vi.fn())
const nativeVoice = vi.hoisted(() => ({ supported: true }))
const loadScript = vi.hoisted(() => vi.fn(async() => { calls.push('recorder') }))

vi.mock('@lib/appDialogsManager', () => ({ default: { start } }))
vi.mock('@components/shell/mountGlobalOverlays', () => ({ mountGlobalOverlays }))
vi.mock('@components/auth/mountAuthFlow.solid', () => ({ disposeActiveAuthFlow }))
vi.mock('@core/dom/loadFonts', () => ({ loadFonts: vi.fn(async() => {}) }))
vi.mock('@/client/bootstrap', () => ({ getProxiedManagers: () => ({}) }))
vi.mock('@helpers/voiceRecorder/isNativeSupported', () => ({ default: () => nativeVoice.supported }))
vi.mock('@helpers/dom/loadScript', () => ({ default: loadScript }))

let bootstrapIm: typeof import('./bootstrapIm').bootstrapIm
let pageChats: HTMLElement

beforeEach(async() => {
  vi.resetModules()
  calls.length = 0
  start.mockClear()
  loadScript.mockClear()
  nativeVoice.supported = true
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

  it('опус-рекордер не грузится там, где есть WebCodecs-рекордер (tweb :31-37)', async() => {
    await bootstrapIm()
    expect(loadScript).not.toHaveBeenCalled()
  })

  it('без WebCodecs вендорный рекордер грузится ДО start() (tweb :35-41, расхождение 2)', async() => {
    nativeVoice.supported = false
    await bootstrapIm()
    expect(loadScript).toHaveBeenCalledWith('/opus/recorder.min.js')
    expect(calls).toEqual(['recorder', 'start'])
  })
})
