// Порт tweb renderMediaWithFadeIn: вставка полного медиа поверх превью.
//
// Пиним именно порядок операций — то, чем эта функция и отличается от наивного
// `container.append(img)`:
//   • медиа встаёт в аспектер ПОСЛЕ декодирования (иначе первый кадр пустой);
//   • превью снимается ПО СОБЫТИЮ animationend, а не по таймеру: длительность
//     живёт в CSS, таймер разъехался бы с ней на первой же правке стилей;
//   • без fade-in (liteMode / медиа уже скачано) превью снимается сразу, без
//     ожидания события, которого никто не пришлёт.
//
// happy-dom не декодирует картинки и не играет CSS-анимации: decode стабится,
// animationend диспатчится руками — ровно то, что сделал бы браузер.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import renderMediaWithFadeIn from './renderMediaWithFadeIn'

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true, writable: true, value: () => Promise.resolve(),
  })
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

// sequentialDom батчит записи через fastRaf — доводим кадр.
const settle = async (p: Promise<void>) => {
  await vi.advanceTimersByTimeAsync(32)
  await p
}

function scene({ inDOM = true } = {}) {
  const container = document.createElement('div')
  container.className = 'media-container'
  const aspecter = document.createElement('div')
  aspecter.className = 'media-container-aspecter'
  container.append(aspecter)

  const thumbImage = document.createElement('canvas')
  thumbImage.className = 'thumbnail'
  aspecter.append(thumbImage)

  if (inDOM) document.body.append(container)

  const media = new Image()
  media.className = 'media-photo'
  return { container, aspecter, thumbImage, media }
}

describe('renderMediaWithFadeIn', () => {
  it('полное медиа встаёт в аспектер поверх превью, превью пока на месте', async () => {
    const { container, aspecter, thumbImage, media } = scene()

    await settle(renderMediaWithFadeIn({
      container, media, aspecter, thumbImage, url: 'blob:full', needFadeIn: true,
    }))

    expect(media.parentElement).toBe(aspecter)
    // порядок по DOM: превью раньше медиа → медиа рисуется поверх
    expect([...aspecter.children]).toEqual([thumbImage, media])
    expect(media.classList.contains('fade-in')).toBe(true)
    expect(thumbImage.isConnected).toBe(true)
    expect(container.classList.contains('no-background')).toBe(false)
  })

  it('превью снимается по событию animationend, а не по таймеру', async () => {
    const { container, thumbImage, media } = scene()
    const aspecter = container.firstElementChild as HTMLElement

    const onRender = vi.fn()
    const onRenderFinish = vi.fn()
    await settle(renderMediaWithFadeIn({
      container, media, aspecter, thumbImage, url: 'blob:full', needFadeIn: true, onRender, onRenderFinish,
    }))

    expect(onRender).toHaveBeenCalledTimes(1)
    expect(onRenderFinish).not.toHaveBeenCalled()

    // сколько бы времени ни прошло — без события ничего не снимается
    await vi.advanceTimersByTimeAsync(5000)
    expect(thumbImage.isConnected).toBe(true)
    expect(onRenderFinish).not.toHaveBeenCalled()

    media.dispatchEvent(new Event('animationend'))
    await vi.advanceTimersByTimeAsync(32)

    expect(thumbImage.isConnected).toBe(false)
    expect(media.classList.contains('fade-in')).toBe(false)
    expect(container.classList.contains('no-background')).toBe(true)
    expect(onRenderFinish).toHaveBeenCalledTimes(1)
  })

  it('без fade-in превью снимается сразу — события ждать не от кого', async () => {
    const { container, thumbImage, media } = scene()
    const aspecter = container.firstElementChild as HTMLElement

    const onRenderFinish = vi.fn()
    await settle(renderMediaWithFadeIn({
      container, media, aspecter, thumbImage, url: 'blob:full', needFadeIn: false, onRenderFinish,
    }))

    expect(media.classList.contains('fade-in')).toBe(false)
    expect(thumbImage.isConnected).toBe(false)
    expect(container.classList.contains('no-background')).toBe(true)
    expect(onRenderFinish).toHaveBeenCalledTimes(1)
  })

  it('fadeInElement отдельно от media: класс анимации и её событие — на нём', async () => {
    const { container, thumbImage, media } = scene()
    const aspecter = container.firstElementChild as HTMLElement
    const fadeInElement = container // tweb: анимируется обёртка (wrapVideo/gif)

    await settle(renderMediaWithFadeIn({
      container, media, aspecter, thumbImage, fadeInElement, url: 'blob:full', needFadeIn: true,
    }))

    expect(fadeInElement.classList.contains('fade-in')).toBe(true)
    expect(media.classList.contains('fade-in')).toBe(false)

    fadeInElement.dispatchEvent(new Event('animationend'))
    await vi.advanceTimersByTimeAsync(32)
    expect(thumbImage.isConnected).toBe(false)
  })

  // Бабл ленты собирается ДО вставки в документ: sequentialDom.mutateElement
  // обязан отработать синхронно, иначе первый кадр ленты уезжает на rAF позже.
  it('контейнер вне документа — вставка синхронная, без ожидания кадра', async () => {
    const { container, aspecter, thumbImage, media } = scene({ inDOM: false })

    const promise = renderMediaWithFadeIn({
      container, media, aspecter, thumbImage, url: 'blob:full', needFadeIn: false,
    })
    // ждём только decode (микротаски), НЕ прокручивая rAF
    await promise

    expect(media.parentElement).toBe(aspecter)
    // isConnected здесь ничего не значит (весь контейнер вне документа) —
    // смотрим на факт снятия узла
    expect(thumbImage.parentElement).toBeNull()
  })
})
