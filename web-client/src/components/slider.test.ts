// SidebarSlider — владелец вкладок и их истории (порт tweb
// `components/slider.ts`). Файл целиком написан вокруг ОДНОГО класса дефектов:
// слайдер трогает историю браузера, а `history.back()` асинхронна, тогда как
// `history.pushState` синхронен. В волне 1 это дало два боевых дефекта (один
// Escape закрывал и попап, и чат под ним, после чего чат переставал
// открываться), поэтому на историю ровно один вход — очередь мутаций внутри
// `core/navigation/appNavigationController.ts`, а слайдер обязан ходить через
// `pushItem`/`removeByType`/`back(type)`.
//
// «Слой чата под вкладкой» здесь — обычная запись навигации типа `chat`, как в
// оригинале: у tweb чат тоже живёт в общей очереди (`appImManager` пушит
// запись при переходе вглубь). Проверка «Back не провалился мимо вкладки» —
// это `onPop` той записи, а не отдельный базовый обработчик.
//
// ПОЧЕМУ ЗДЕСЬ ЭМУЛИРУЕТСЯ ИСТОРИЯ. happy-dom считает `history.back()`
// ПОЛНОСТЬЮ СИНХРОННО (BrowserFrameNavigator: цель перехода вычисляется и
// popstate диспатчится внутри одного вызова). Тест, гоняющий настоящий
// `history.back()`, поэтому НИКОГДА не отличит корректный `removeLayer` от
// прямого `history.back()` — и был бы зелёным при сломанном поведении. Приём
// (и сама функция) взяты из волны 1 —
// `core/navigation/navigationStack.overlaySwap.test.ts` (снесён вместе со
// стеком слоёв задачей #108; сам приём остался здесь).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SidebarSlider from './slider'
import SliderSuperTab from './sliderTab'
import appNavigationController from '@core/navigation/appNavigationController'
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

  function schedulePop(): void {
    const targetIndex = current - 1 // фиксация ЦЕЛИ — СЕЙЧАС, синхронно с вызовом
    setTimeout(() => {
      if (targetIndex < 0 || !entries[targetIndex]) return
      current = targetIndex
      applyUrl(entries[current].url)
      window.dispatchEvent(new PopStateEvent('popstate', { state: entries[current].state }))
    }, delayMs)
  }

  const backSpy = vi.spyOn(history, 'back').mockImplementation(schedulePop)

  return {
    /**
     * Реальный Back (браузерная/аппаратная кнопка) — ТОТ ЖЕ путь, что и наш
     * программный `history.back()`: тот же учёт индекса, та же отложенность.
     * Голый `dispatchEvent(new PopStateEvent(...))` мимо эмулятора уводил бы
     * его `current` от реального стека слоёв, и счётные проверки ниже стали бы
     * слабее, чем выглядят.
     */
    userBack: schedulePop,
    restore(): void { pushSpy.mockRestore(); backSpy.mockRestore() },
  }
}

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

/** Задержка эмулятора: столько живёт «в полёте» уже вызванный back(). */
const BACK_DELAY = 20

let asyncHistory: ReturnType<typeof installAsyncBrowserHistory>

/** Запись «чат под вкладкой» — то, куда Back обязан провалиться ПОСЛЕДНИМ. */
function pushChatItem(onPop: () => void) {
  appNavigationController.pushItem({ type: 'chat', onPop })
}

/** Реальный Back, доехавший до приложения (popstate уже доставлен). */
function pop() {
  asyncHistory.userBack()
  vi.advanceTimersByTime(BACK_DELAY + 1)
}

beforeEach(() => {
  vi.useFakeTimers()
  asyncHistory = installAsyncBrowserHistory(BACK_DELAY)
})

afterEach(() => {
  // Контроллер навигации — модульный синглтон: недоснятые записи и
  // невыполненный `back()` достались бы следующему тесту. Сначала даём
  // отложенным мутациям сработать, потом чистим очередь целиком.
  vi.advanceTimersByTime(2000)
  appNavigationController.spliceItems(0, Infinity)
  vi.advanceTimersByTime(2000)

  asyncHistory.restore()
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('SidebarSlider — закрытие вкладки и слой под ней', () => {
  it('снимает СВОЙ слой, не трогая слой под ним (чат остаётся открытым)', async () => {
    const underPop = vi.fn() // слой чата под вкладкой
    pushChatItem(underPop)

    const slider = new SidebarSlider({ sidebarEl: createSidebarEl(), navigationType: 'left' })
    const tab = slider.createTab(SliderSuperTab)
    await tab.open()

    slider.onCloseBtnClick()
    settle() // отложенный back() слайдера подтверждается

    // Чат не тронут.
    expect(underPop).not.toHaveBeenCalled()

    // …и чат по-прежнему ВЕРХНИЙ слой: следующий Back достаётся именно ему.
    pop()
    expect(underPop).toHaveBeenCalledTimes(1)
  })

  it('вкладка закрывается ОДИН раз: своей записи истории она больше не откусит', async () => {
    const slider = new SidebarSlider({ sidebarEl: createSidebarEl(), navigationType: 'left' })
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

describe('SidebarSlider — реальный Back закрывает вкладку С АНИМАЦИЕЙ', () => {
  // В оригинале анимацию гасит НЕ Back, а edge-свайп iOS: `canAnimate` считается
  // как `!this.manual ? false : undefined`, а `manual = !this.isPossibleSwipe`
  // (`appNavigationController.ts:291`, :209), и `isPossibleSwipe` взводит только
  // `onTouchStart`/`isSwipingBackSafari` (:229-236). Читать одно выражение :291
  // недостаточно — вывод получается обратным.
  it('браузерный Back играет переход, а не подменяет вкладку мгновенно', async () => {
    const sidebarEl = createSidebarEl()
    const sliderEl = sidebarEl.querySelector('.sidebar-slider')!
    const slider = new SidebarSlider({ sidebarEl, navigationType: 'left' })
    const first = slider.createTab(SliderSuperTab)
    await first.open()
    const second = slider.createTab(SliderSuperTab)
    await second.open()
    vi.advanceTimersByTime(NAVIGATION_TRANSITION_TIME + 200) // прошлый переход доехал

    pop() // реальный Back — вкладка закрывается

    // Переход играет: контейнер в `animating`, уходящая вкладка помечена `from`.
    expect(sliderEl.classList.contains('animating')).toBe(true)
    expect(sliderEl.classList.contains('backwards')).toBe(true)
    expect(second.container.classList.contains('from')).toBe(true)
    expect(first.container.classList.contains('active')).toBe(true)
  })
})

describe('SidebarSlider — гонка истории (эмулятор обязан быть асинхронным)', () => {
  // happy-dom резолвит `history.back()` СИНХРОННО, и на синхронном back'е гонки
  // push/back не существует в принципе — все тесты выше остались бы зелёными,
  // даже если бы эмуляцию упростили обратно. Этот тест ловит именно упрощение.
  it('popstate от нашего back() приходит ОТДЕЛЬНОЙ задачей, а не внутри вызова', async () => {
    const slider = new SidebarSlider({ sidebarEl: createSidebarEl(), navigationType: 'left' })
    const tab = slider.createTab(SliderSuperTab)
    await tab.open()

    let popstates = 0
    const count = () => { ++popstates }
    window.addEventListener('popstate', count)

    slider.onCloseBtnClick()
    expect(popstates).toBe(0) // синхронный back() дал бы 1 уже здесь

    vi.advanceTimersByTime(BACK_DELAY + 1)
    expect(popstates).toBe(1)

    window.removeEventListener('popstate', count)
  })

  it('следующая вкладка, открытая ДО подтверждения back предыдущей, не сдвигает стек: Back закрывает только её', async () => {
    const underPop = vi.fn() // слой чата
    pushChatItem(underPop)

    const slider = new SidebarSlider({ sidebarEl: createSidebarEl(), navigationType: 'left' })
    const first = slider.createTab(SliderSuperTab)
    await first.open()

    // Закрыли одну и СРАЗУ открыли другую — back первой ещё в полёте. Это
    // ровно та пара push+back, что дала дефекты волны 1.
    slider.onCloseBtnClick()
    const second = slider.createTab(SliderSuperTab)
    await second.open()
    settle()

    pop() // Back по второй вкладке
    settle()
    expect(second.container.parentElement).toBeNull()
    expect(underPop).not.toHaveBeenCalled()

    pop() // теперь очередь чата
    expect(underPop).toHaveBeenCalledTimes(1)
  })
})

describe('SidebarSlider — программное закрытие (tab.close)', () => {
  it('снимает слой вкладки: забытый слой съел бы следующий Back вместо чата', async () => {
    const underPop = vi.fn()
    pushChatItem(underPop)

    const slider = new SidebarSlider({ sidebarEl: createSidebarEl(), navigationType: 'left' })
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
  })
})

describe('SidebarSlider — вложенные вкладки', () => {
  it('Back закрывает верхнюю вкладку, оставляя нижнюю', async () => {
    const slider = new SidebarSlider({ sidebarEl: createSidebarEl(), navigationType: 'left' })
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

  it('каждой вкладке — своя запись: два Back закрывают их по одной', async () => {
    const underPop = vi.fn()
    pushChatItem(underPop)

    const slider = new SidebarSlider({ sidebarEl: createSidebarEl(), navigationType: 'left' })
    const first = slider.createTab(SliderSuperTab)
    await first.open()
    const second = slider.createTab(SliderSuperTab)
    await second.open()
    settle() // записи истории обеих вкладок доехали (очередь мутаций — на таймере)

    pop() // реальный Back
    settle()
    expect(second.container.parentElement).toBeNull()
    expect(first.container.parentElement).not.toBeNull()
    expect(underPop).not.toHaveBeenCalled()

    pop()
    settle()
    expect(first.container.parentElement).toBeNull()
    // Оба Back'а ушли во вкладки — до чата ни один не дошёл.
    expect(underPop).not.toHaveBeenCalled()
  })
})

describe('SidebarSlider — isConfirmationNeededOnClose', () => {
  it('не закрывает вкладку, пока подтверждение не разрешилось', async () => {
    const slider = new SidebarSlider({ sidebarEl: createSidebarEl(), navigationType: 'left' })
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
    pushChatItem(underPop)

    const slider = new SidebarSlider({ sidebarEl: createSidebarEl(), navigationType: 'left' })
    const tab = slider.createTab(SliderSuperTab)
    await tab.open()

    settle() // запись истории вкладки доехала

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

describe('SidebarSlider — onOpenTab', () => {
  it('вкладка не появляется, пока не доехал хук раскрытия колонки', async () => {
    const slider = new SidebarSlider({ sidebarEl: createSidebarEl(), navigationType: 'left' })
    // tweb `slider.ts:127` — `await this.onOpenTab()`: правая колонка этим
    // хуком ВЫЕЗЖАЕТ, и вкладка не имеет права появиться раньше неё.
    //
    // Хук намеренно на таймере, а не на одном микротаске: разрешись он за
    // микротаск — порядок совпал бы и с `await`, и без него, и мутация
    // «не ждать хук» прошла бы зелёной (так и было в раунде 1).
    let opened = false
    slider.onOpenTab = () => new Promise<void>((resolve) => {
      setTimeout(() => { opened = true; resolve() }, 50)
    })

    const tab = slider.createTab(SliderSuperTab)
    void tab.open()

    // Хук ещё в полёте — вкладка активной быть НЕ ДОЛЖНА.
    await Promise.resolve()
    await Promise.resolve()
    expect(opened).toBe(false)
    expect(tab.container.classList.contains('active')).toBe(false)

    await vi.advanceTimersByTimeAsync(60)
    expect(opened).toBe(true)
    expect(tab.container.classList.contains('active')).toBe(true)
  })
})

describe('SidebarSlider — createTab', () => {
  it('проставляет вкладке managers (иначе она полезет к воркеру своим путём)', () => {
    const managers = { sessions: {} } as never
    const slider = new SidebarSlider({ sidebarEl: createSidebarEl(), managers, navigationType: 'left' })
    const tab = slider.createTab(SliderSuperTab)
    expect(tab.managers).toBe(managers)
  })

  it('doNotAppend отдаёт вкладку без слайдера — она не попадает в разметку колонки', () => {
    const sidebarEl = createSidebarEl()
    const slider = new SidebarSlider({ sidebarEl, navigationType: 'left' })
    const tab = slider.createTab(SliderSuperTab, true, true)
    expect(tab.slider).toBeUndefined()
    expect(sidebarEl.querySelector('.sidebar-slider')!.children).toHaveLength(0)
  })
})
