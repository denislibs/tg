// BluffSpoilerController — порт tweb `components/bluffSpoilerController.ts`.
// Пиним то, ради чего он существует:
//   • маска РИСУЕТСЯ: кадр симуляции уезжает элементу в `mask-image`, и только
//     после этого обёртка становится видимой (`is-visible`); без этого адрес
//     почты либо невидим (`opacity: 0` из `_spoiler.scss`), либо превращается в
//     сплошные плашки;
//   • одинаковый кадр не переставляется второй раз — иначе инвалидация стиля
//     шла бы на каждом кадре впустую;
//   • `observeReconnection` возвращает к жизни элемент, который вынули из DOM и
//     вернули обратно (React так делает при перемонтировании).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// createImageBitmap нет → кодируем кадр на месте, `canvas.toDataURL()`
// (в tweb это legacy-ветка `encodeMaskFrame`). Так тест не трогает воркер,
// которого в happy-dom всё равно нет.
vi.stubGlobal('createImageBitmap', undefined)

const { default: BluffSpoilerController } = await import('./bluffSpoilerController')

const MASK_URL = 'data:image/png;base64,AAAA'

const makeFrame = (url = MASK_URL) => {
  const canvas = document.createElement('canvas')
  canvas.toDataURL = () => url
  return canvas
}

const maskOf = (element: HTMLElement) =>
  element.style.getPropertyValue('mask-image') || element.style.getPropertyValue('-webkit-mask-image')

// Кадр перекодируется не чаще раза в 4 кадра (`DRAW_INTERVAL`), а счётчик у
// контроллера один на модуль — ждём окно, иначе соседний тест «съест» наше.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 70))

const makeTarget = () => {
  const element = document.createElement('span')
  element.className = 'bluff-spoiler'
  document.body.append(element)
  return element
}

beforeEach(() => {
  BluffSpoilerController.instancesCount = 1
})

afterEach(() => {
  BluffSpoilerController.destroy()
  BluffSpoilerController.instancesCount = 0
  document.body.replaceChildren()
})

describe('BluffSpoilerController.draw', () => {
  it('кладёт кадр симуляции элементу в mask-image и показывает его', async () => {
    await settle()
    const element = makeTarget()

    BluffSpoilerController.draw(element, makeFrame())

    expect(maskOf(element)).toContain(MASK_URL)
    expect(element.classList.contains('is-visible')).toBe(true)
  })

  it('без держателей маска не применяется (instancesCount === 0)', async () => {
    await settle()
    BluffSpoilerController.instancesCount = 0
    const element = makeTarget()

    BluffSpoilerController.draw(element, makeFrame('data:image/png;base64,BBBB'))

    expect(maskOf(element)).toBe('')
    expect(element.classList.contains('is-visible')).toBe(false)
  })

  it('второй элемент получает УЖЕ посчитанный кадр — симуляция одна на всех', async () => {
    await settle()
    const first = makeTarget()
    BluffSpoilerController.draw(first, makeFrame())

    const second = makeTarget()
    // троттлинг `DRAW_INTERVAL` не даст перекодировать кадр — но применить его обязан
    BluffSpoilerController.draw(second, makeFrame('data:image/png;base64,CCCC'))

    expect(maskOf(second)).toContain(MASK_URL)
    expect(second.classList.contains('is-visible')).toBe(true)
  })
})

describe('BluffSpoilerController.observeReconnection', () => {
  it('переподключает элемент, который вернулся в DOM', () => {
    vi.useFakeTimers()
    try {
      const element = makeTarget()
      const onReconnect = vi.fn()

      BluffSpoilerController.observeReconnection(element, onReconnect)

      // анимаций у элемента нет, а сам он в документе — значит его надо поднять заново
      vi.advanceTimersByTime(300)
      expect(onReconnect).toHaveBeenCalledWith(element)

      element.remove()
      onReconnect.mockClear()
      vi.advanceTimersByTime(300)
      expect(onReconnect).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
