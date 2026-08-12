// Тесты порта tweb `helpers/dom/getVisibleRect.ts` (см. шапку модуля рядом).
// В tweb собственных тестов у этого хелпера нет — сценарии наши: полностью
// видимый элемент, частичная обрезка сверху/снизу скролл-контейнером,
// полностью вне контейнера, sticky-заголовок. Реальные элементы happy-dom
// с замоканным getBoundingClientRect (layout happy-dom не считает).
import { describe, expect, it, vi } from 'vitest'
import getVisibleRect from './getVisibleRect'

function makeElement(rect: { top: number, right: number, bottom: number, left: number }): HTMLElement {
  const el = document.createElement('div')
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    ...rect,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    x: rect.left,
    y: rect.top,
    toJSON: () => rect,
  } as DOMRect)
  return el
}

// Границы контейнера намеренно НЕ совпадают с краями окна (в happy-dom
// 1024×768): совпадающая с окном граница по логике tweb не считается
// обрезкой без ignoreBoundaries.
const container = () => makeElement({ top: 100, right: 900, bottom: 600, left: 50 })

describe('getVisibleRect', () => {
  it('полностью видимый элемент: rect как есть, overflow пуст', () => {
    const el = makeElement({ top: 200, right: 500, bottom: 400, left: 100 })
    const visible = getVisibleRect(el, container())

    expect(visible).toEqual({
      rect: { top: 200, right: 500, bottom: 400, left: 100 },
      overflow: { top: false, right: false, bottom: false, left: false, vertical: 0, horizontal: 0 },
    })
  })

  it('обрезан сверху скролл-контейнером: top прижат к контейнеру, overflow.top', () => {
    const el = makeElement({ top: 20, right: 500, bottom: 400, left: 100 })
    const visible = getVisibleRect(el, container())

    expect(visible).toEqual({
      rect: { top: 100, right: 500, bottom: 400, left: 100 },
      overflow: { top: true, right: false, bottom: false, left: false, vertical: 1, horizontal: 0 },
    })
  })

  it('обрезан снизу скролл-контейнером: bottom прижат к контейнеру, overflow.bottom', () => {
    const el = makeElement({ top: 200, right: 500, bottom: 700, left: 100 })
    const visible = getVisibleRect(el, container())

    expect(visible).toEqual({
      rect: { top: 200, right: 500, bottom: 600, left: 100 },
      overflow: { top: false, right: false, bottom: true, left: false, vertical: 1, horizontal: 0 },
    })
  })

  it('полностью вне контейнера (уехал ниже) — null', () => {
    const el = makeElement({ top: 650, right: 500, bottom: 800, left: 100 })
    expect(getVisibleRect(el, container())).toBe(null)
  })

  it('полностью вне контейнера (уехал выше) — null', () => {
    const el = makeElement({ top: 0, right: 500, bottom: 100, left: 100 })
    expect(getVisibleRect(el, container())).toBe(null)
  })

  it('lookForSticky: верхняя граница опускается до низа .sticky', () => {
    const overflowEl = container()
    const sticky = makeElement({ top: 100, right: 900, bottom: 150, left: 50 })
    sticky.classList.add('sticky')
    overflowEl.append(sticky)

    const el = makeElement({ top: 120, right: 500, bottom: 400, left: 100 })
    const visible = getVisibleRect(el, overflowEl, true)

    expect(visible).toEqual({
      rect: { top: 150, right: 500, bottom: 400, left: 100 },
      overflow: { top: true, right: false, bottom: false, left: false, vertical: 1, horizontal: 0 },
    })
  })
})
