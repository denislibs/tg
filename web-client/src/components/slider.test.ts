// SidebarSlider — владелец вкладок и их истории (порт tweb
// `components/slider.ts`). Файл целиком написан вокруг ОДНОГО класса дефектов:
// слайдер трогает историю браузера, а `history.back()` асинхронна, тогда как
// `history.pushState` синхронен. В волне 1 это дало два боевых дефекта (один
// Escape закрывал и попап, и чат под ним, после чего чат переставал
// открываться), поэтому у нас на историю ровно один вход — очередь мутаций в
// `core/navigation/navigationStack.ts`, а слайдер обязан ходить через
// `pushLayer`/`removeLayer`.
//
// ПОЧЕМУ ЗДЕСЬ ЭМУЛИРУЕТСЯ ИСТОРИЯ. happy-dom считает `history.back()`
// ПОЛНОСТЬЮ СИНХРОННО (BrowserFrameNavigator: цель перехода вычисляется и
// popstate диспатчится внутри одного вызова). Тест, гоняющий настоящий
// `history.back()`, поэтому НИКОГДА не отличит корректный `removeLayer` от
// прямого `history.back()` — и был бы зелёным при сломанном поведении. Приём
// (и сама функция) взяты из волны 1 —
// `core/navigation/navigationStack.overlaySwap.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SidebarSlider from './slider'
import SliderSuperTab from './sliderTab'
import { pushLayer, setBaseHandler } from '@core/navigation/navigationStack'
import { NAVIGATION_TRANSITION_TIME } from '@core/dom/navigationTransition'

/**
 * Эмулирует РЕАЛЬНУЮ асинхронность `history.back()`: браузер фиксирует индекс
 * цели перехода в момент вызова, а сам переход (обновление `location` +
 * `popstate`) происходит позже, отдельной задачей. `history.pushState`
 * оставляем синхронным — как в настоящем браузере.
 */
function installAsyncBrowserHistory(delayMs: number) {
  let entries: Array<{ url: string; state: unknown }> = [{ url: location.href, state: history.state }]
  let current = 0
  const realReplaceState = history.replaceState.bind(history)

  function applyUrl(url: string): void {
    const u = new URL(url, location.href)
    realReplaceState(entries[current].state, '', u.pathname + u.search + u.hash)
  }

  const pushSpy = vi.spyOn(history, 'pushState').mockImplementation(((state: unknown, _title: string, url?: string | URL) => {
    const u = url ? new URL(String(url), location.href).href : location.href
    entries = entries.slice(0, current + 1)
    entries.push({ url: u, state })
    current = entries.length - 1
    applyUrl(u)
  }) as typeof history.pushState)

  const backSpy = vi.spyOn(history, 'back').mockImplementation(() => {
    const targetIndex = current - 1 // фиксация ЦЕЛИ — СЕЙЧАС, синхронно с вызовом
    setTimeout(() => {
      if (targetIndex < 0 || !entries[targetIndex]) return
      current = targetIndex
      applyUrl(entries[current].url)
      window.dispatchEvent(new PopStateEvent('popstate', { state: entries[current].state }))
    }, delayMs)
  })

  return {
    restore(): void { pushSpy.mockRestore(); backSpy.mockRestore() },
  }
}

/** Реальный Back (браузерная/аппаратная кнопка). */
const pop = () => window.dispatchEvent(new PopStateEvent('popstate'))

/** Разметка колонки: слайдер ищет в ней `.sidebar-slider` (tweb `_slider.scss`). */
function createSidebarEl() {
  const sidebarEl = document.createElement('div')
  const sliderEl = document.createElement('div')
  sliderEl.classList.add('sidebar-slider', 'tabs-container')
  sidebarEl.append(sliderEl)
  document.body.append(sidebarEl)
  return sidebarEl
}

/** Полный цикл закрытия вкладки: переход (250) + разрушение (250+30) + запас. */
const settle = () => vi.advanceTimersByTime(NAVIGATION_TRANSITION_TIME * 3 + 600)

let baseHandlerCalls = 0
let asyncHistory: ReturnType<typeof installAsyncBrowserHistory>

beforeEach(() => {
  vi.useFakeTimers()
  baseHandlerCalls = 0
  setBaseHandler(() => { ++baseHandlerCalls })
  asyncHistory = installAsyncBrowserHistory(20)
})

afterEach(() => {
  // Стек слоёв — модульный синглтон; недоснятые слои и невыполненный `back()`
  // достались бы следующему тесту. Сначала даём отложенным back'ам сработать,
  // потом сливаем остаток слоёв реальным Back'ом.
  vi.advanceTimersByTime(2000)
  for (let i = 0; i < 20 && !baseHandlerCalls; ++i) {
    pop()
    vi.advanceTimersByTime(600)
  }
  asyncHistory.restore()
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('SidebarSlider — закрытие вкладки и слой под ней', () => {
  it('снимает СВОЙ слой, не трогая слой под ним (чат остаётся открытым)', async () => {
    const underPop = vi.fn() // слой чата под вкладкой
    pushLayer(underPop)

    const slider = new SidebarSlider({ sidebarEl: createSidebarEl() })
    const tab = slider.createTab(SliderSuperTab)
    await tab.open()

    slider.onCloseBtnClick()
    settle() // отложенный back() слайдера подтверждается

    // Ни чат, ни базовый слой (навигация по хэшу) не тронуты.
    expect(underPop).not.toHaveBeenCalled()
    expect(baseHandlerCalls).toBe(0)

    // …и чат по-прежнему ВЕРХНИЙ слой: следующий Back достаётся именно ему.
    pop()
    expect(underPop).toHaveBeenCalledTimes(1)
  })

  it('вкладка закрывается ОДИН раз: своей записи истории она больше не откусит', async () => {
    const slider = new SidebarSlider({ sidebarEl: createSidebarEl() })
    const tab = slider.createTab(SliderSuperTab)
    await tab.open()

    const back = vi.spyOn(history, 'back')
    slider.onCloseBtnClick()
    settle()

    // Ровно один `back()` на одну закрытую вкладку. Повторный (например, из-за
    // того, что слой остался в стеке и его добил пришедший popstate) съел бы
    // ЧУЖУЮ запись — запись чата под вкладкой.
    expect(back).toHaveBeenCalledTimes(1)
    back.mockRestore()
  })
})

describe('SidebarSlider — программное закрытие (tab.close)', () => {
  it('снимает слой вкладки: забытый слой съел бы следующий Back вместо чата', async () => {
    const underPop = vi.fn()
    pushLayer(underPop)

    const slider = new SidebarSlider({ sidebarEl: createSidebarEl() })
    const tab = slider.createTab(SliderSuperTab)
    await tab.open()

    // Это НЕ навигационное закрытие (isNavigation не передан) — за снятие слоя
    // отвечает `onCloseTab` (tweb :218-222, `removeByType(type, true)`).
    tab.close()
    settle()
    expect(tab.container.parentElement).toBeNull()

    // Следующий Back обязан достаться чату, а не съеденному слою вкладки.
    pop()
    expect(underPop).toHaveBeenCalledTimes(1)
    expect(baseHandlerCalls).toBe(0)
  })
})

describe('SidebarSlider — вложенные вкладки', () => {
  it('Back закрывает верхнюю вкладку, оставляя нижнюю', async () => {
    const slider = new SidebarSlider({ sidebarEl: createSidebarEl() })
    const first = slider.createTab(SliderSuperTab)
    await first.open()
    const second = slider.createTab(SliderSuperTab)
    await second.open()

    slider.onCloseBtnClick()
    settle() // разрушение вкладки отложено на TRANSITION_TIME + 30

    expect(second.container.parentElement).toBeNull()
    expect(first.container.parentElement).not.toBeNull()
    expect(first.container.classList.contains('active')).toBe(true)
  })

  it('каждой вкладке — свой слой: два Back закрывают их по одной', async () => {
    const slider = new SidebarSlider({ sidebarEl: createSidebarEl() })
    const first = slider.createTab(SliderSuperTab)
    await first.open()
    const second = slider.createTab(SliderSuperTab)
    await second.open()

    pop() // реальный Back
    settle()
    expect(second.container.parentElement).toBeNull()
    expect(first.container.parentElement).not.toBeNull()
    expect(baseHandlerCalls).toBe(0)

    pop()
    settle()
    expect(first.container.parentElement).toBeNull()
    // Оба Back'а ушли во вкладки — до навигации чата ни один не дошёл.
    expect(baseHandlerCalls).toBe(0)
  })
})

describe('SidebarSlider — isConfirmationNeededOnClose', () => {
  it('не закрывает вкладку, пока подтверждение не разрешилось', async () => {
    const slider = new SidebarSlider({ sidebarEl: createSidebarEl() })
    const tab = slider.createTab(SliderSuperTab)
    await tab.open()

    let resolve!: () => void
    tab.isConfirmationNeededOnClose = () => new Promise<void>((r) => { resolve = r })

    slider.onCloseBtnClick()
    settle()
    expect(tab.container.parentElement).not.toBeNull()

    resolve()
    await vi.waitFor(() => {
      settle()
      expect(tab.container.parentElement).toBeNull()
    })
  })

  it('отказ от закрытия оставляет вкладке ЕЁ слой: следующий Back снова достаётся вкладке, а не чату под ней', async () => {
    const underPop = vi.fn()
    pushLayer(underPop)

    const slider = new SidebarSlider({ sidebarEl: createSidebarEl() })
    const tab = slider.createTab(SliderSuperTab)
    await tab.open()

    let reject!: () => void
    let asked = 0
    tab.isConfirmationNeededOnClose = () => {
      ++asked
      return new Promise<void>((_r, rj) => { reject = rj })
    }

    pop() // реальный Back — вето: слой обязан вернуться на место вместе с записью истории
    settle()
    expect(asked).toBe(1)
    expect(tab.container.parentElement).not.toBeNull()
    expect(underPop).not.toHaveBeenCalled()

    reject() // пользователь передумал закрывать
    await Promise.resolve()

    // Слой вкладки на месте — второй Back снова спрашивает ЕЁ, а не чат.
    pop()
    settle()
    expect(asked).toBe(2)
    expect(underPop).not.toHaveBeenCalled()
  })
})

describe('SidebarSlider — createTab', () => {
  it('проставляет вкладке managers (иначе она полезет к воркеру своим путём)', () => {
    const managers = { sessions: {} } as never
    const slider = new SidebarSlider({ sidebarEl: createSidebarEl(), managers })
    const tab = slider.createTab(SliderSuperTab)
    expect(tab.managers).toBe(managers)
  })

  it('doNotAppend отдаёт вкладку без слайдера — она не попадает в разметку колонки', () => {
    const sidebarEl = createSidebarEl()
    const slider = new SidebarSlider({ sidebarEl })
    const tab = slider.createTab(SliderSuperTab, true, true)
    expect(tab.slider).toBeUndefined()
    expect(sidebarEl.querySelector('.sidebar-slider')!.children).toHaveLength(0)
  })
})
