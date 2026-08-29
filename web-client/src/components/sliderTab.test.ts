import { describe, expect, it, vi } from 'vitest'
import SliderSuperTab, { SliderSuperTabEventable } from './sliderTab'
import { createSliderStub } from './sliderTab.testStub'

describe('SliderSuperTab', () => {
  it('строит разметку вкладки и регистрируется у слайдера', () => {
    const sliderStub = createSliderStub()
    const tab = new SliderSuperTab(sliderStub, true)

    expect(tab.container.classList.contains('tabs-tab')).toBe(true)
    expect(tab.container.classList.contains('sidebar-slider-item')).toBe(true)
    expect(tab.header.classList.contains('sidebar-header')).toBe(true)
    expect(tab.closeBtn.classList.contains('sidebar-close-button')).toBe(true)
    expect(tab.title.classList.contains('sidebar-header__title')).toBe(true)
    expect(tab.content.classList.contains('sidebar-content')).toBe(true)
    expect(tab.header.contains(tab.closeBtn)).toBe(true)
    expect(tab.header.contains(tab.title)).toBe(true)
    expect(tab.container.contains(tab.header)).toBe(true)
    expect(tab.container.contains(tab.content)).toBe(true)

    expect(sliderStub.addTab).toHaveBeenCalledWith(tab)
  })

  it('closeBtn собран с noRipple: true — без .c-ripple обёртки', () => {
    const sliderStub = createSliderStub()
    const tab = new SliderSuperTab(sliderStub, true)

    expect(tab.closeBtn.querySelector('.c-ripple')).toBeNull()
  })

  it('scrollable.attachBorderListeners навешивает классы бордера скролла на container', () => {
    const sliderStub = createSliderStub()
    const tab = new SliderSuperTab(sliderStub, true)

    expect(tab.container.classList.contains('scrollable-y-bordered')).toBe(true)
    expect(tab.container.classList.contains('scrolled-start')).toBe(true)
    expect(tab.container.classList.contains('scrolled-end')).toBe(true)
  })

  it('middlewareHelper вкладки — РЕБЁНОК миддлвари слайдера (slider.getMiddleware().create())', () => {
    const sliderStub = createSliderStub()
    const tab = new SliderSuperTab(sliderStub, true)
    const middleware = tab.middlewareHelper.get()

    expect(middleware()).toBe(true)
    sliderStub.rootMiddleware.destroy()
    expect(middleware()).toBe(false)
  })

  it('порядок разрушения — deleteTab → container.remove → scrollable.destroy → listenerSetter.removeAll → middlewareHelper.destroy', () => {
    const sliderStub = createSliderStub()
    const tab = new SliderSuperTab(sliderStub, true)
    document.body.append(tab.container)

    const order: string[] = []
    sliderStub.deleteTab.mockImplementation(() => order.push('deleteTab'))
    vi.spyOn(tab.container, 'remove').mockImplementation(() => order.push('container.remove'))
    vi.spyOn(tab.scrollable, 'destroy').mockImplementation(() => order.push('scrollable.destroy'))
    vi.spyOn(tab.listenerSetter, 'removeAll').mockImplementation(() => order.push('listenerSetter.removeAll'))
    vi.spyOn(tab.middlewareHelper, 'destroy').mockImplementation(() => order.push('middlewareHelper.destroy'))

    ;(tab as any).onCloseAfterTimeout()

    expect(order).toEqual([
      'deleteTab',
      'container.remove',
      'scrollable.destroy',
      'listenerSetter.removeAll',
      'middlewareHelper.destroy',
    ])
  })

  it('на закрытии снимает узел, слушателей и гасит миддлварь', () => {
    const sliderStub = createSliderStub()
    const tab = new SliderSuperTab(sliderStub, true)
    document.body.append(tab.container)

    const middleware = tab.middlewareHelper.get()
    const onClick = vi.fn()
    tab.listenerSetter.add(tab.closeBtn)('click', onClick)

    ;(tab as any).onCloseAfterTimeout()

    expect(tab.container.parentElement).toBeNull()
    tab.closeBtn.dispatchEvent(new MouseEvent('click'))
    expect(onClick).not.toHaveBeenCalled()
    expect(middleware()).toBe(false)
  })

  it('init отрабатывает один раз на несколько open (init объявлен ПОЛЕМ подкласса)', async () => {
    const init = vi.fn()
    class T extends SliderSuperTab {
      init = init
    }
    const sliderStub = createSliderStub()
    const tab = new T(sliderStub, true)
    await tab.open()
    await tab.open()
    expect(init).toHaveBeenCalledTimes(1)
  })

  it('init отрабатывает один раз на несколько open (init объявлен МЕТОДОМ подкласса — форма tweb)', async () => {
    // Форма, в которой tweb объявляет init почти везде (см. докблок файла —
    // 39 мест в src/components/). Раунд 0 объявлял базовый `init` полем —
    // такое поле, инициализируясь в конструкторе базы, шадоуило бы этот
    // прототипный метод подкласса, и spy ниже НЕ вызвался бы вовсе.
    const spy = vi.fn()
    class T extends SliderSuperTab {
      init(...args: any[]) {
        spy(...args)
      }
    }
    const sliderStub = createSliderStub()
    const tab = new T(sliderStub, true)
    await tab.open('x')
    await tab.open('y')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('x')
  })

  it('open() ждёт промис из init, прежде чем звать selectTab', async () => {
    const sliderStub = createSliderStub()
    const order: string[] = []
    sliderStub.selectTab.mockImplementation(() => order.push('selectTab'))

    let resolveInit!: () => void
    class T extends SliderSuperTab {
      init() {
        return new Promise<void>((resolve) => {
          resolveInit = () => {
            order.push('init-resolved')
            resolve()
          }
        })
      }
    }
    const tab = new T(sliderStub, true)

    const openPromise = tab.open()
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual([]) // init ещё не resolved — selectTab не должен звучать раньше времени

    resolveInit()
    await openPromise

    expect(order).toEqual(['init-resolved', 'selectTab'])
  })

  it('init, упавший синхронно, гасится try/catch — open() не падает, selectTab всё равно вызывается', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sliderStub = createSliderStub()
    class T extends SliderSuperTab {
      init() {
        throw new Error('boom')
      }
    }
    const tab = new T(sliderStub, true)

    await expect(tab.open()).resolves.toBeUndefined()

    expect(consoleErrorSpy).toHaveBeenCalledWith('open tab error', expect.any(Error))
    expect(sliderStub.selectTab).toHaveBeenCalledWith(tab)

    consoleErrorSpy.mockRestore()
  })

  it('close() делегирует слайдеру closeTab(this)', () => {
    const sliderStub = createSliderStub()
    const tab = new SliderSuperTab(sliderStub, true)

    tab.close()

    expect(sliderStub.closeTab).toHaveBeenCalledWith(tab)
  })

  it('open() зовёт slider.selectTab(this) после init', async () => {
    const sliderStub = createSliderStub()
    const tab = new SliderSuperTab(sliderStub, true)

    await tab.open()

    expect(sliderStub.selectTab).toHaveBeenCalledWith(tab)
  })

  it('destroyable=false — onCloseAfterTimeout ничего не сносит', () => {
    const sliderStub = createSliderStub()
    const tab = new SliderSuperTab(sliderStub, false)
    document.body.append(tab.container)

    ;(tab as any).onCloseAfterTimeout()

    expect(tab.container.parentElement).toBe(document.body)
    expect(sliderStub.deleteTab).not.toHaveBeenCalled()

    tab.container.remove()
  })

  it('setTitle кладёт переведённый текст в заголовок', () => {
    const sliderStub = createSliderStub()
    const tab = new SliderSuperTab(sliderStub, true)

    ;(tab as any).setTitle('Story.AddToProfile')

    const span = tab.title.querySelector('.i18n')
    expect(span).not.toBeNull()
    expect(span!.textContent).toBe('Post to Profile')
  })

  it('SliderSuperTabEventable.onCloseAfterTimeout — destroy → destroyAfter → cleanup → super (container.remove)', () => {
    const sliderStub = createSliderStub()
    const tab = new SliderSuperTabEventable(sliderStub)
    document.body.append(tab.container)

    const order: string[] = []
    const destroyListener = vi.fn(() => { order.push('destroy-listener') })
    tab.eventListener.addEventListener('destroy', destroyListener)

    const destroyAfterListener = vi.fn(() => { order.push('destroyAfter-listener') })
    tab.eventListener.addEventListener('destroyAfter', destroyAfterListener)

    vi.spyOn(tab.eventListener, 'cleanup').mockImplementation(() => order.push('cleanup'))
    vi.spyOn(tab.container, 'remove').mockImplementation(() => order.push('container.remove'))

    ;(tab as any).onCloseAfterTimeout()

    expect(order).toEqual(['destroy-listener', 'destroyAfter-listener', 'cleanup', 'container.remove'])
    expect(destroyAfterListener).toHaveBeenCalledWith(expect.any(Promise))
  })

  it('SliderSuperTabEventable.onClose — рассылает close подписчикам', () => {
    const sliderStub = createSliderStub()
    const tab = new SliderSuperTabEventable(sliderStub)

    const onClose = vi.fn()
    tab.eventListener.addEventListener('close', onClose)

    ;(tab as any).onClose()

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
