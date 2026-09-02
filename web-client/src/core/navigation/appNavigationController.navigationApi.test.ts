/**
 * Тесты порта `appNavigationController.ts` — ветка **Navigation API**
 * (Chrome/Safari). Это ПОЛОВИНА подсистемы, которой у нас не было вовсе до
 * задачи #108, и именно она у оригинала несёт сериализацию мутаций истории.
 *
 * В happy-dom `navigation` в окне нет (`'navigation' in window === false`,
 * проверено), а `USE_NAVIGATION_API` считается ОДИН РАЗ на загрузке модуля —
 * поэтому обычным `vi.stubGlobal` после импорта ветку не включить. Тот же
 * приём, что у `core/workerCore.test.ts` с веткой `onconnect`: глобаль
 * подставляется ДО импорта, модуль подтягивается динамически после
 * `vi.resetModules()`.
 *
 * Без этого файла половина подсистемы жила бы без единого теста: полный прогон
 * в happy-dom исполняет только легаси-ветку и остался бы зелёным на любой её
 * порче.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppNavigationController as Ctrl, NavigationItem } from './appNavigationController'

type NavigateListener = (event: NavigateEvent) => void

/** Минимальный `navigation`: контроллер трогает у него ровно эти пять точек. */
function makeNavigationStub() {
  const listeners: NavigateListener[] = []
  const navigate = vi.fn()
  const back = vi.fn()
  return {
    listeners,
    navigate,
    back,
    stub: {
      currentEntry: { key: 'cur', url: 'https://localhost/', getState: () => undefined, sameDocument: true, index: 1 },
      entries: () => [],
      navigate,
      traverseTo: vi.fn(),
      back,
      addEventListener: (_type: 'navigate', listener: NavigateListener) => { listeners.push(listener) },
      removeEventListener: (_type: 'navigate', listener: NavigateListener) => {
        const i = listeners.indexOf(listener)
        if(i !== -1) listeners.splice(i, 1)
      },
    },
  }
}

let nav: ReturnType<typeof makeNavigationStub>
let ctrl: Ctrl
let USE_NAVIGATION_API: boolean

const flush = async(times = 4) => {
  for(let i = 0; i < times; ++i) {
    await new Promise((r) => setTimeout(r, 0))
  }
}

const item = (over: Partial<NavigationItem> = {}): NavigationItem => ({
  type: 'popup',
  onPop: vi.fn(),
  ...over,
})

/**
 * Подтверждение мутации браузером.
 *
 * Контроллер снимает «занято» ПЕРВОЙ же строкой обработчика
 * (`this.modificationResolve?.()`), до всякого разбора события, — поэтому для
 * пина на очередь важен сам факт события, а не его вид. Берём самый безобидный
 * (`replace`): он у оригинала уходит в ранний `return` и записей не касается,
 * то есть проверяется ровно очередь и ничего кроме.
 */
const confirmMutation = () => {
  const event = {
    navigationType: 'replace' as const,
    destination: { key: 'd', url: 'https://localhost/', getState: () => undefined, sameDocument: true, index: 0 },
    intercept: vi.fn(),
  }
  nav.listeners.forEach((listener) => listener(event as unknown as NavigateEvent))
}

beforeEach(async() => {
  nav = makeNavigationStub()
  vi.stubGlobal('navigation', nav.stub)
  vi.resetModules()

  const mod = await import('./appNavigationController')
  USE_NAVIGATION_API = mod.USE_NAVIGATION_API
  // Синглтон модуля тоже живой и слушает то же `navigation` — глушим, иначе
  // он отвечает на события теста (разбор — в соседнем файле тестов).
  const singleton = mod.default as unknown as { onNavigate: NavigateListener }
  nav.stub.removeEventListener('navigate', singleton.onNavigate)

  ctrl = new mod.AppNavigationController()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('ветка Navigation API включается наличием window.navigation', () => {
  it('USE_NAVIGATION_API === true при подставленной глобали', () => {
    expect(USE_NAVIGATION_API).toBe(true)
  })

  it('контроллер подписался на navigate, а не на popstate', () => {
    // Подписчиков двое (синглтон снят выше — остался наш) — важно, что
    // подписка вообще есть: без неё ветка мертва.
    expect(nav.listeners.length).toBeGreaterThan(0)
  })
})

describe('Navigation API: мутации идут через navigation, а не через history', () => {
  it('добавление записи зовёт navigation.navigate с history:push и своим состоянием', async() => {
    ctrl.pushItem(item())
    await flush()

    expect(nav.navigate).toHaveBeenCalledTimes(1)
    const options = nav.navigate.mock.calls[0][1] as { history: string; state: unknown }
    expect(options.history).toBe('push')
    expect(options.state).toBeTypeOf('number')
  })

  it('снятие записи зовёт navigation.back, а не history.back', async() => {
    const historyBack = vi.spyOn(history, 'back').mockImplementation(() => {})

    const first = ctrl.pushItem(item())
    await flush()
    confirmMutation() // иначе очередь занята и back не поедет

    ctrl.removeItem(first)
    await flush()

    expect(nav.back).toHaveBeenCalledTimes(1)
    expect(historyBack).not.toHaveBeenCalled()

    historyBack.mockRestore()
  })
})

describe('Navigation API: очередь ждёт подтверждения события navigate', () => {
  // Ровно то, ради чего очередь есть у самого оригинала: «browser will eat the
  // event if you do push and back together».
  it('второй мутации не даёт хода, пока первая не подтверждена', async() => {
    const order: string[] = []
    nav.navigate.mockImplementation(() => { order.push('navigate') })
    nav.back.mockImplementation(() => { order.push('back') })

    const first = ctrl.pushItem(item())
    await flush()
    expect(order).toEqual(['navigate'])
    confirmMutation()
    order.length = 0

    // Закрыть и тут же открыть следующий — та самая пара push+back.
    ctrl.removeItem(first)
    ctrl.pushItem(item())
    await flush()

    // Первая мутация ушла, вторая ЖДЁТ подтверждения.
    expect(order).toEqual(['back'])

    confirmMutation()
    await flush()
    expect(order).toEqual(['back', 'navigate'])
  })
})
