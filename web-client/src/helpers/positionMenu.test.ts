// Тесты порта tweb `helpers/positionMenu.ts` (см. шапку файла рядом) — ветка
// `positionMenu` (позиционирование от точки события).
//
// happy-dom не считает layout: `scrollWidth`/`scrollHeight`/`offsetLeft` всегда 0,
// а `body.getBoundingClientRect()` — нули. Поэтому размеры меню и «окна» задаём
// через `defineProperty`/стаб — ровно те величины, из которых считает оригинал.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import positionMenu from './positionMenu'

const WINDOW_WIDTH = 1000
const WINDOW_HEIGHT = 800

function makeMenu(width: number, height: number): HTMLElement {
  const elem = document.createElement('div')
  elem.classList.add('btn-menu')
  document.body.append(elem)
  Object.defineProperty(elem, 'scrollWidth', { value: width, configurable: true })
  Object.defineProperty(elem, 'scrollHeight', { value: height, configurable: true })
  Object.defineProperty(elem, 'offsetLeft', { value: 0, configurable: true })
  return elem
}

function pointerEvent(pageX: number, pageY: number): MouseEvent {
  const e = new MouseEvent('contextmenu')
  Object.defineProperty(e, 'pageX', { value: pageX, configurable: true })
  Object.defineProperty(e, 'pageY', { value: pageY, configurable: true })
  return e
}

beforeEach(() => {
  vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  } as DOMRect)
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('positionMenu', () => {
  it('десктоп: меню раскрывается вправо-вниз от точки события', () => {
    const elem = makeMenu(200, 300)

    const size = positionMenu(pointerEvent(100, 150), elem)

    // side = 'left' (десктоп) → x берётся как `pageX`, y как `pageY`
    expect(elem.style.left).toBe('100px')
    expect(elem.style.top).toBe('150px')
    // класс transform-origin: side 'left' переворачивается в 'right'
    expect(elem.classList.contains('bottom-right')).toBe(true)
    expect(size).toEqual({ width: 200, height: 300 })
  })

  it('ширина берётся с внутреннего .btn-menu-items и растёт на offsetLeft * 2', () => {
    const elem = makeMenu(200, 300)
    const items = document.createElement('div')
    items.classList.add('btn-menu-items')
    Object.defineProperty(items, 'scrollWidth', { value: 150, configurable: true })
    Object.defineProperty(items, 'offsetLeft', { value: 10, configurable: true })
    elem.append(items)

    const size = positionMenu(pointerEvent(100, 150), elem)

    expect(size.width).toBe(150 + 10 * 2)
  })

  it('не влезает по горизонтали → сторона center и прижатие к правому краю', () => {
    const elem = makeMenu(400, 100)

    // 700 + 400 + 8 > 1000 — 'left' не помещается
    positionMenu(pointerEvent(700, 100), elem)

    // intermediateX = maxLeft = 1000 - 400 - 8
    expect(elem.style.left).toBe(WINDOW_WIDTH - 400 - 8 + 'px')
    expect(elem.classList.contains('bottom-center')).toBe(true)
  })

  it('не влезает по вертикали → верт. сторона center и прижатие к нижнему краю', () => {
    const elem = makeMenu(200, 400)

    // 600 + 400 + 8 > 800 — 'top' не помещается
    positionMenu(pointerEvent(100, 600), elem)

    // intermediateY = maxTop = 800 - 400 - 8
    expect(elem.style.top).toBe(WINDOW_HEIGHT - 400 - 8 + 'px')
    expect(elem.classList.contains('center-right')).toBe(true)
  })

  it('прошлый класс transform-origin снимается перед новым', () => {
    const elem = makeMenu(200, 300)
    elem.classList.add('center-left')

    positionMenu(pointerEvent(100, 150), elem)

    expect(elem.classList.contains('center-left')).toBe(false)
    expect(elem.classList.contains('bottom-right')).toBe(true)
    // класс-носитель самого меню регулярка не трогает
    expect(elem.classList.contains('btn-menu')).toBe(true)
  })

  it('additionalPadding увеличивает отступы, по которым проверяется помещаемость', () => {
    const elem = makeMenu(400, 100)

    // без паддинга 592 + 400 + 8 = 1000 — влезает ровно
    positionMenu(pointerEvent(592, 100), elem)
    expect(elem.classList.contains('bottom-right')).toBe(true)

    const elem2 = makeMenu(400, 100)
    // с right: 50 → 592 + 400 + 58 > 1000 — фолбэк в center
    positionMenu(pointerEvent(592, 100), elem2, undefined, { right: 50 })
    expect(elem2.classList.contains('bottom-center')).toBe(true)
    expect(elem2.style.left).toBe(WINDOW_WIDTH - 400 - 58 + 'px')
  })

  it('TouchEvent нормализуется в первое касание', () => {
    const elem = makeMenu(200, 300)
    const e = new Event('touchstart') as unknown as TouchEvent
    Object.defineProperty(e, 'touches', {
      value: [{ pageX: 300, pageY: 250 }],
      configurable: true,
    })

    positionMenu(e, elem)

    expect(elem.style.left).toBe('300px')
    expect(elem.style.top).toBe('250px')
  })
})
