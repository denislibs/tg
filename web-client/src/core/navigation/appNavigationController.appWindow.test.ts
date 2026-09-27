/**
 * Esc следует за активным окном приложения (tweb `appNavigationController.ts:77-79`,
 * 812502980: `bindActiveWindowListener((w) => w, 'keydown', …)`). Когда клиент
 * вынесен в Document PiP (`core/pip.ts`), нажатия приходят в окно PiP, а не во
 * вкладку, — слушатель на `window` вкладки там мёртв, и Esc не закрывал бы ни
 * одного попапа. Отдельный файл: смена окна перевешивает слушатели ВСЕХ
 * экземпляров в модуле (их подписки на смену окна не снимаются — у оригинала
 * контроллер живёт столько же, сколько вкладка), и соседним тестам контроллера
 * это ни к чему.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAppWindow } from '@helpers/appWindow'
import { AppNavigationController } from './appNavigationController'

let backSpy: ReturnType<typeof vi.spyOn>

const esc = () => new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })

/** Очередь мутаций истории работает через `setTimeout(…, 0)` — даём ей пройти. */
const flush = async(times = 4) => {
  for(let i = 0; i < times; ++i) {
    await new Promise((r) => setTimeout(r, 0))
  }
}

/** Окно выноса: свой документ и своя цель событий `keydown`. */
function fakePipWindow(): Window {
  const target = new EventTarget()
  return Object.assign(target, { document: document.implementation.createHTMLDocument('pip') }) as unknown as Window
}

beforeEach(() => {
  backSpy = vi.spyOn(history, 'back').mockImplementation(() => {})
})

afterEach(() => {
  setAppWindow(window)
  backSpy.mockRestore()
})

describe('appNavigationController — Esc в окне выноса (tweb :79)', () => {
  it('в выносе Esc из окна PiP снимает верхнюю запись, из фоновой вкладки — нет', async() => {
    const ctrl = new AppNavigationController()
    const onPop = vi.fn()
    ctrl.pushItem({ type: 'popup', onPop })
    await flush()

    const pip = fakePipWindow()
    setAppWindow(pip)

    const inTab = esc()
    window.dispatchEvent(inTab)
    expect(onPop).not.toHaveBeenCalled()
    expect(inTab.defaultPrevented).toBe(false)

    const inPip = esc()
    pip.dispatchEvent(inPip)
    expect(onPop).toHaveBeenCalledOnce()
    expect(inPip.defaultPrevented).toBe(true)
  })

  it('после возврата во вкладку Esc снова слушается на вкладке', async() => {
    const ctrl = new AppNavigationController()
    const onPop = vi.fn()
    ctrl.pushItem({ type: 'popup', onPop })
    await flush()

    const pip = fakePipWindow()
    setAppWindow(pip)
    setAppWindow(window)

    pip.dispatchEvent(esc())
    expect(onPop).not.toHaveBeenCalled()
    window.dispatchEvent(esc())
    expect(onPop).toHaveBeenCalledOnce()
  })
})
