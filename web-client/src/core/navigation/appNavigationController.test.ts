/**
 * Тесты порта `appNavigationController.ts` — ЛЕГАСИ-ВЕТКА (`history.pushState`/
 * `popstate`). Именно она достижима в happy-dom: `'navigation' in window` там
 * `false` (проверено), поэтому `USE_NAVIGATION_API === false`. Ветку Navigation
 * API проверяет отдельный файл — `appNavigationController.navigationApi.test.ts`
 * (тот же приём, что у `workerCore.test.ts` с веткой `onconnect`).
 *
 * Главное, ради чего порт затевался (#108), и что проверяется здесь: ОДИН
 * список отвечает и на Back, и на Esc. До порта их было два — стек слоёв и
 * `hotkeys.pushEsc`, — и они расходились.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import singleton, { AppNavigationController, type NavigationItem } from './appNavigationController'

let ctrl: AppNavigationController
let dispose: () => void
let backSpy: ReturnType<typeof vi.spyOn>
let pushSpy: ReturnType<typeof vi.spyOn>

/**
 * Контроллер вешает слушатели на `window` в конструкторе и снимать их не умеет:
 * у оригинала он синглтон и живёт столько же, сколько вкладка. Тесту нужен
 * СВОЙ экземпляр на каждый прогон, поэтому слушатели снимаются по тем же
 * ссылкам — это поля-стрелки, доступные по имени. Заводить ради тестов
 * публичный `destroy()` в продакшн-коде не стали: в бою у него не было бы ни
 * одного вызывающего.
 *
 * ── Синглгон модуля тоже приходится глушить, и это не мелочь ───────────────
 * `appNavigationController.ts` создаёт свой экземпляр на ИМПОРТЕ (как
 * оригинал), поэтому он живой и слушает то же самое `window`. Пока его
 * слушатели висели, разосланный тестом `popstate` доходил и до него — а у
 * него список записей пуст, и он в ответ делал СВОЙ `history.pushState`
 * (`_onPopState`: чужая запись истории → вернуть свою). В общий шпион
 * `history.pushState` прилетал лишний вызов, и пин на ПОРЯДОК мутаций
 * («back, потом push») краснел на исправном коде. Снимаем его слушатели один
 * раз на файл — окном в тестах владеем мы.
 */
function unbind(instance: AppNavigationController) {
  const priv = instance as unknown as { onPopState: EventListener; onKeyDown: EventListener }
  window.removeEventListener('popstate', priv.onPopState)
  window.removeEventListener('keydown', priv.onKeyDown, { capture: true })
}

beforeAll(() => {
  unbind(singleton)
})

function create() {
  const instance = new AppNavigationController()
  return { instance, dispose: () => unbind(instance) }
}

/** Настоящий Back пользователя: `popstate` с ЧУЖИМ state (не наш id). */
const userBack = () => window.dispatchEvent(new PopStateEvent('popstate', { state: null }))

/** Подтверждение НАШЕГО `history.back()` (тот замокан и события не рождает). */
const settleOwnBack = () => window.dispatchEvent(new PopStateEvent('popstate', { state: null }))

const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

/** Очередь мутаций истории работает через `setTimeout(…, 0)` — даём ей пройти. */
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

beforeEach(() => {
  backSpy = vi.spyOn(history, 'back').mockImplementation(() => {})
  pushSpy = vi.spyOn(history, 'pushState')
  const made = create()
  ctrl = made.instance
  dispose = made.dispose
})

afterEach(() => {
  dispose()
  backSpy.mockRestore()
  pushSpy.mockRestore()
})

describe('appNavigationController — Back снимает верхнюю запись', () => {
  it('LIFO: Back закрывает последнюю добавленную, потом предыдущую', async() => {
    const first = item()
    const second = item()
    ctrl.pushItem(first)
    ctrl.pushItem(second)
    await flush()

    userBack()
    expect(second.onPop).toHaveBeenCalledTimes(1)
    expect(first.onPop).not.toHaveBeenCalled()

    userBack()
    expect(first.onPop).toHaveBeenCalledTimes(1)
  })

  it('запись, снятая Back-ом, свою запись истории НЕ съедает второй раз', async() => {
    ctrl.pushItem(item())
    await flush()
    backSpy.mockClear()

    userBack() // браузер уже отмотал историю сам
    await flush()

    expect(backSpy).not.toHaveBeenCalled()
  })

  it('onPop → false: ВЕТО, запись остаётся и получает следующий Back', async() => {
    let veto = true
    const onPop = vi.fn(() => (veto ? false : undefined))
    ctrl.pushItem(item({ onPop }))
    await flush()

    userBack()
    expect(onPop).toHaveBeenCalledTimes(1)

    veto = false
    userBack()
    expect(onPop).toHaveBeenCalledTimes(2)

    // Снята — третий Back до неё уже не доходит.
    userBack()
    expect(onPop).toHaveBeenCalledTimes(2)
  })
})

describe('appNavigationController — Esc и Back это ОДИН список', () => {
  it('Esc закрывает ту же верхнюю запись, что закрыл бы Back', async() => {
    const first = item()
    const second = item()
    ctrl.pushItem(first)
    ctrl.pushItem(second)
    await flush()

    esc()
    expect(second.onPop).toHaveBeenCalledTimes(1)
    expect(first.onPop).not.toHaveBeenCalled()

    esc()
    expect(first.onPop).toHaveBeenCalledTimes(1)
  })

  // Ровно это и разъезжалось до порта: закрытие по Esc снимало запись из одного
  // стека, а второй стек про неё не знал, и следующий Back доставался призраку.
  it('после Esc следующий Back достаётся СЛЕДУЮЩЕЙ записи, а не закрытой', async() => {
    const first = item()
    const second = item()
    ctrl.pushItem(first)
    ctrl.pushItem(second)
    await flush()

    esc()
    userBack()

    expect(second.onPop).toHaveBeenCalledTimes(1)
    expect(first.onPop).toHaveBeenCalledTimes(1)
  })

  it('пустой список — Esc не делает ничего', () => {
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
  })

  it('onEscape → false: Esc не закрывает, а Back закрывает', async() => {
    const onPop = vi.fn()
    ctrl.pushItem(item({ onPop, onEscape: () => false }))
    await flush()

    esc()
    expect(onPop).not.toHaveBeenCalled()

    userBack()
    expect(onPop).toHaveBeenCalledTimes(1)
  })

  it('registerEscapeHandler — глобальное вето на Esc, снимается возвращённой функцией', async() => {
    const onPop = vi.fn()
    ctrl.pushItem(item({ onPop }))
    await flush()

    const unregister = ctrl.registerEscapeHandler(() => false)
    esc()
    expect(onPop).not.toHaveBeenCalled()

    unregister()
    esc()
    expect(onPop).toHaveBeenCalledTimes(1)
  })
})

describe('appNavigationController — адресация по типу', () => {
  it('findItemByType находит ПОСЛЕДНЮЮ запись своего типа', async() => {
    const a = item({ type: 'right' })
    const b = item({ type: 'popup' })
    const c = item({ type: 'right' })
    ctrl.pushItem(a); ctrl.pushItem(b); ctrl.pushItem(c)
    await flush()

    expect(ctrl.findItemByType('right')?.item).toBe(c)
    expect(ctrl.findItemByType('popup')?.item).toBe(b)
    expect(ctrl.findItemByType('media')).toBeUndefined()
  })

  // Ручка НАРУЖУ, которой у стека слоёв не было вовсе (пункт 1 задачи #108):
  // у оригинала ею правая колонка снимает все свои записи разом в `hide()`.
  it('removeByType снимает ВСЕ записи типа и закрывает каждую', async() => {
    const a = item({ type: 'right' })
    const b = item({ type: 'popup' })
    const c = item({ type: 'right' })
    ctrl.pushItem(a); ctrl.pushItem(b); ctrl.pushItem(c)
    await flush()

    ctrl.removeByType('right')

    expect(ctrl.findItemByType('right')).toBeUndefined()
    expect(ctrl.findItemByType('popup')?.item).toBe(b)
  })

  it('removeByType(single) снимает только верхнюю запись типа', async() => {
    const a = item({ type: 'right' })
    const c = item({ type: 'right' })
    ctrl.pushItem(a); ctrl.pushItem(c)
    await flush()

    ctrl.removeByType('right', true)

    expect(ctrl.findItemByType('right')?.item).toBe(a)
  })

  it('back(type) закрывает запись своего типа, даже если она НЕ верхняя', async() => {
    const under = item({ type: 'right' })
    const over = item({ type: 'popup' })
    ctrl.pushItem(under)
    ctrl.pushItem(over)
    await flush()

    ctrl.back('right')

    expect(under.onPop).toHaveBeenCalledTimes(1)
    expect(over.onPop).not.toHaveBeenCalled()
  })
})

describe('appNavigationController — записи истории', () => {
  it('добавление записи пушит состояние, снятие — съедает его', async() => {
    const it1 = ctrl.pushItem(item())
    await flush()
    expect(pushSpy).toHaveBeenCalled()

    backSpy.mockClear()
    ctrl.removeItem(it1)
    await flush()

    expect(backSpy).toHaveBeenCalledTimes(1)
  })

  // Пункт 3 задачи #108: снятие НЕ верхней записи обязано съедать свою запись
  // истории. У стека слоёв этого не было — оставалась ничейная запись и один
  // холостой Back.
  it('снятие НЕ верхней записи тоже съедает свою запись истории', async() => {
    const under = ctrl.pushItem(item({ type: 'right' }))
    ctrl.pushItem(item({ type: 'popup' }))
    await flush()

    backSpy.mockClear()
    ctrl.removeItem(under)
    await flush()

    expect(backSpy).toHaveBeenCalledTimes(1)
  })

  it('noHistory: записи истории нет ни при добавлении, ни при снятии, но Esc закрывает', async() => {
    pushSpy.mockClear()
    const onPop = vi.fn()
    ctrl.pushItem(item({ onPop, noHistory: true }))
    await flush()
    expect(pushSpy).not.toHaveBeenCalled()

    backSpy.mockClear()
    esc()
    await flush()

    expect(onPop).toHaveBeenCalledTimes(1)
    expect(backSpy).not.toHaveBeenCalled()
  })
})

describe('appNavigationController — очередь мутаций истории', () => {
  // Отступление от оригинала (см. докблок файла): очередь обслуживает и
  // легаси-ветку. Дефект, ради которого: `history.back()` асинхронна, и
  // `pushState` следующего оверлея, выполненный до её перехода, разъезжается
  // с моделью. Проверяется ПОРЯДОК реальных вызовов истории.
  it('закрытие и следующее открытие не обгоняют друг друга', async() => {
    const order: string[] = []
    backSpy.mockImplementation(() => { order.push('back') })
    pushSpy.mockImplementation(() => { order.push('push') })

    const first = ctrl.pushItem(item())
    await flush()
    order.length = 0

    // Типичный сценарий: меню закрывается и тут же открывается попап.
    ctrl.removeItem(first)
    ctrl.pushItem(item())

    await flush(2)
    // `back` ушёл, `push` ЖДЁТ его подтверждения — очереди ещё нечего брать.
    expect(order).toEqual(['back'])

    settleOwnBack()
    await flush()
    expect(order).toEqual(['back', 'push'])
  })

  it('подтверждение собственного back НЕ снимает запись', async() => {
    const onPop = vi.fn()
    const first = ctrl.pushItem(item())
    ctrl.pushItem(item({ onPop }))
    await flush()

    ctrl.removeItem(first)
    await flush(2)

    settleOwnBack() // это подтверждение, а не Back пользователя
    expect(onPop).not.toHaveBeenCalled()

    userBack() // а вот это уже настоящий Back
    expect(onPop).toHaveBeenCalledTimes(1)
  })
})

describe('appNavigationController — хэш', () => {
  it('popstate со СМЕНОЙ хэша уходит в onHashChange, записи не трогает', async() => {
    const onPop = vi.fn()
    ctrl.pushItem(item({ onPop }))
    await flush()

    const onHashChange = vi.fn()
    ctrl.onHashChange = onHashChange

    location.hash = '#12345'
    userBack()

    expect(onHashChange).toHaveBeenCalledTimes(1)
    expect(onPop).not.toHaveBeenCalled()

    location.hash = ''
  })
})
