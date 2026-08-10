// ScrollSaver (порт tweb helpers/scrollSaver.ts) — тесты на голом классе, без
// useChatScroll/React: happy-dom не считает layout (getBoundingClientRect,
// scrollHeight, clientHeight всегда 0), поэтому вся геометрия здесь —
// стабы, вручную выставленные под конкретный сценарий (offsetHeight в этом
// файле не участвует — ScrollSaver меряет только getBoundingClientRect).
//
// Эти тесты доказывают ТОЛЬКО арифметику restore()/_restore() поверх заданной
// геометрии — они НЕ доказывают, что useChatScroll.ts реально вызывает
// save()/restore() в нужных местах (никакого рендера хука здесь нет). Это
// осознанный пробел, см. task-3-report.md.
import { describe, it, expect, beforeEach } from 'vitest'
import ScrollSaver, { type ScrollSaverTarget } from './scrollSaver'

function rect(top: number, bottom: number, left = 0, right = 300): DOMRect {
  return {
    top, bottom, left, right,
    width: right - left,
    height: bottom - top,
    x: left, y: top,
    toJSON() { return this },
  } as DOMRect
}

// container сам выступает вьюпортом (как наш scrollRef — реальный скролл-див,
// не обёрнутый в Scrollable), поэтому его getBoundingClientRect фиксирован на
// весь тест: экран не двигается, двигается только content внутри через scrollTop.
function makeContainer(scrollHeight: number, clientHeight: number, scrollTop: number) {
  const container = document.createElement('div')
  document.body.append(container)
  container.getBoundingClientRect = () => rect(0, clientHeight)
  Object.defineProperty(container, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(container, 'clientHeight', { value: clientHeight, configurable: true })
  container.scrollTop = scrollTop
  return container
}

function setScrollHeight(container: HTMLElement, value: number) {
  Object.defineProperty(container, 'scrollHeight', { value, configurable: true })
}

function addMessage(container: HTMLElement, seq: number, r: DOMRect) {
  const el = document.createElement('div')
  el.dataset.seq = String(seq)
  el.getBoundingClientRect = () => r
  container.append(el)
  return el
}

// Тот же адаптер, что useChatScroll.ts заводит поверх scrollRef (см. его шапку
// про ScrollSaverTarget) — здесь напрямую поверх тестового `container`.
function targetOf(container: HTMLElement): ScrollSaverTarget {
  return {
    get container() { return container },
    get scrollPosition() { return container.scrollTop },
    get scrollSize() { return container.scrollHeight },
    onSizeChange() {},
    setScrollPositionSilently(value: number) { container.scrollTop = value },
  }
}

beforeEach(() => { document.body.innerHTML = '' })

describe('ScrollSaver', () => {
  it('вставка сообщений сверху: вьюпорт остаётся на том же сообщении (якорь по DOMRect)', () => {
    const container = makeContainer(1000, 500, 200)
    addMessage(container, 1, rect(-300, -200)) // выше вьюпорта — не попадёт в elements
    const anchor = addMessage(container, 2, rect(-100, 100)) // торчит за верхний край — якорь (reverse=true → elements[0])
    addMessage(container, 3, rect(100, 300))
    addMessage(container, 4, rect(300, 600))

    const saver = new ScrollSaver(targetOf(container), '[data-seq]', true)
    saver.save()

    // Два новых сообщения общей высотой 100px прилетели ВЫШЕ m1 (loadOlder-
    // препенд). scrollTop браузер сам не трогает — все существующие узлы
    // сдвигаются вниз на экране на 100px без единого write в scrollTop.
    anchor.getBoundingClientRect = () => rect(0, 200) // было {-100,100}, стало {0,200}
    setScrollHeight(container, 1100)

    saver.restore()

    // Чтобы якорь (его нижний край, т.к. верхний торчал за край) остался в
    // той же экранной позиции (100px), scrollTop должен вырасти ровно на
    // высоту вставки: 200 + 100 = 300.
    expect(container.scrollTop).toBe(300)
  })

  it('якорь удалён между save и restore — сработал fallback-режим (дельта scrollHeightMinusTop)', () => {
    const container = makeContainer(1000, 500, 200)
    const anchor = addMessage(container, 1, rect(100, 300))

    const saver = new ScrollSaver(targetOf(container), '[data-seq]', true)
    saver.save() // scrollHeightMinusTop = reverse ? scrollHeight-scrollTop : ... = 1000-200 = 800

    // Якорь пропал из DOM целиком (окно перерисовано/messages пересобраны),
    // причём БЕЗ единого оставшегося '[data-seq]' — re-query в restore() тоже
    // не находит анкера, ScrollSaver проваливается в _restore().
    anchor.remove()
    setScrollHeight(container, 1300)

    saver.restore()

    // _restore(): newScrollTop = reverse ? scrollHeight - scrollHeightMinusTop : ... = 1300 - 800 = 500
    expect(container.scrollTop).toBe(500)
  })

  it('рост высоты САМОГО якоря (например, доехавшая картинка) учтён восстановлением', () => {
    const container = makeContainer(1000, 500, 200)
    const anchor = addMessage(container, 1, rect(-50, 150)) // торчит за верхний край, якорь

    const saver = new ScrollSaver(targetOf(container), '[data-seq]', true)
    saver.save()

    // Якорь сам вырос на 80px (top не сдвинулся — расти некуда, он первый в DOM).
    anchor.getBoundingClientRect = () => rect(-50, 230)
    setScrollHeight(container, 1080)

    saver.restore()

    // Якорь торчит за верх → следим за нижним краем: было 150, стало 230 → +80.
    expect(container.scrollTop).toBe(280)
  })

  it('рост ЧУЖОЙ высоты за вьюпортом (не якоря) НЕ двигает вьюпорт — в отличие от дельта-метода', () => {
    const container = makeContainer(1000, 500, 200)
    addMessage(container, 1, rect(-50, 150)) // якорь, торчит за верх; его rect в этом сценарии не меняется
    // m2 полностью ниже вьюпорта (top>=clientHeight) — не входит в elements
    // (findElements() обрывает скан после первого невидимого после найденных
    // видимых), но физически существует и добавляет высоту всей ленте.
    addMessage(container, 2, rect(600, 1000))

    const saver = new ScrollSaver(targetOf(container), '[data-seq]', true)
    saver.save()

    // m2 подгрузил медиа и вырос на 500px где-то за вьюпортом — якоря это не
    // касается, его rect не меняется.
    setScrollHeight(container, 1500)

    saver.restore()

    // Экранная позиция якоря не изменилась (top/bottom те же) → restore()
    // видит newPosition === position и НЕ трогает scrollTop.
    expect(container.scrollTop).toBe(200)

    // "Укус" (см. Step 6 брифа): старый самодельный pendingRestore в
    // useChatScroll.ts держал ЧИСТУЮ дельту "расстояние от низа" —
    // scrollHeight-scrollTop зафиксированное при save. Тот же сценарий по
    // этой формуле даёт: newScrollTop = newScrollHeight - (scrollHeightAtSave
    // - scrollTopAtSave) = 1500 - (1000-200) = 700 — вьюпорт спрыгнул бы на
    // 500px вниз, хотя визуально ничего рядом с якорем не изменилось. Это
    // ровно тот баг, который ScrollSaver чинит структурно (см. README теста
    // и task-3-report.md, где этот же сценарий прогнан против реально
    // урезанного до дельты restore() — с красным выводом).
    const deltaFormulaResult = 1500 - (1000 - 200)
    expect(deltaFormulaResult).toBe(700)
    expect(deltaFormulaResult).not.toBe(container.scrollTop)
  })
})
