import { describe, expect, it, vi } from 'vitest'
import { getMiddleware } from '@helpers/middleware'
import SliderSuperTab, { SliderSuperTabEventable, type SliderSuperTabSlider } from './sliderTab'

function createSliderStub(): SliderSuperTabSlider {
  return {
    getMiddleware: vi.fn(() => getMiddleware().get()),
    addTab: vi.fn(),
    deleteTab: vi.fn(),
    closeTab: vi.fn(),
    selectTab: vi.fn(),
  }
}

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

  it('init отрабатывает один раз на несколько open', async () => {
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

  it('SliderSuperTabEventable — close/destroy рассылаются подписчикам, а сама вкладка всё равно сносится', async () => {
    const sliderStub = createSliderStub()
    const tab = new SliderSuperTabEventable(sliderStub)
    document.body.append(tab.container)

    const onClose = vi.fn()
    const onDestroy = vi.fn()
    tab.eventListener.addEventListener('close', onClose)
    tab.eventListener.addEventListener('destroy', onDestroy)

    ;(tab as any).onClose()
    expect(onClose).toHaveBeenCalledTimes(1)

    ;(tab as any).onCloseAfterTimeout()

    expect(onDestroy).toHaveBeenCalledTimes(1)
    expect(tab.container.parentElement).toBeNull()
  })
})
