/**
 * Пины порта `helpers/dom/focusTrap.ts` (tweb 472e3e76b, `helpers/dom/focusTrap.ts`).
 * Потребитель — оболочка попапов (`popups/indexTsx.tsx:228-234`, `:279`): Tab ходит
 * по кругу внутри верхнего попапа, фокус возвращается туда, откуда открыли.
 *
 * happy-dom не раскладывает: `getClientRects()` у любого узла даёт один прямоугольник,
 * так что видимость тут проверяется только через `[hidden]`/`[inert]`/`aria-hidden`
 * и `disabled` — ветку `display: none` предка движок не отличает.
 */
import { afterEach, describe, expect, it } from 'vitest'
import createFocusTrap, { getFocusableElements, type FocusTrap } from './focusTrap'

const traps: FocusTrap[] = []
function trapOf(element: HTMLElement) {
  const trap = createFocusTrap(element)
  traps.push(trap)
  return trap
}

afterEach(() => {
  // Стек ловушек модульный (WeakMap по документу): недоснятая ловушка держала бы
  // слушатели и верх стека в следующем тесте.
  traps.splice(0).forEach((trap) => trap.deactivate(false))
  document.body.replaceChildren()
})

function box(...labels: string[]) {
  const container = document.createElement('div')
  const buttons = labels.map((label) => {
    const button = document.createElement('button')
    button.textContent = label
    container.append(button)
    return button
  })
  document.body.append(container)
  return { container, buttons }
}

function outsideButton() {
  const button = document.createElement('button')
  button.textContent = 'outside'
  document.body.append(button)
  return button
}

function tab(shiftKey = false) {
  const target = (document.activeElement as HTMLElement) || document.body
  const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
  target.dispatchEvent(e)
  return e
}

describe('focusTrap: одна ловушка', () => {
  it('activate() фокусирует первый фокусируемый элемент и ставит контейнеру tabindex=-1', () => {
    const { container, buttons } = box('a', 'b', 'c')
    trapOf(container).activate()

    expect(document.activeElement).toBe(buttons[0])
    expect(container.getAttribute('tabindex')).toBe('-1')
  })

  it('activate(restoreTo, initialFocus) фокусирует initialFocus', () => {
    const { container, buttons } = box('a', 'b', 'c')
    trapOf(container).activate(undefined, buttons[2])

    expect(document.activeElement).toBe(buttons[2])
  })

  it('Tab на последнем → первый; Shift+Tab на первом → последний', () => {
    const { container, buttons } = box('a', 'b', 'c')
    trapOf(container).activate()

    buttons[2].focus()
    expect(tab().defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(buttons[0])

    expect(tab(true).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(buttons[2])
  })

  it('Tab в середине не перехватывается — ходит браузер', () => {
    const { container, buttons } = box('a', 'b', 'c')
    trapOf(container).activate()

    buttons[1].focus()
    expect(tab().defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(buttons[1])
  })

  it('фокус снаружи (focusin) возвращается внутрь', () => {
    const { container, buttons } = box('a', 'b')
    const outside = outsideButton()
    trapOf(container).activate()

    outside.focus()
    expect(document.activeElement).toBe(buttons[0])
  })

  it('deactivate() возвращает фокус на restoreTo; deactivate(false) — нет', () => {
    const opener = outsideButton()
    opener.focus()
    const { container } = box('a', 'b')
    const trap = trapOf(container)

    trap.activate()
    trap.deactivate()
    expect(document.activeElement).toBe(opener)

    trap.activate(opener)
    const other = outsideButton()
    trap.deactivate(false)
    other.focus()
    expect(document.activeElement).toBe(other)
  })

  it('после deactivate ловушка отпускает: фокус снаружи остаётся снаружи, Tab не трогает', () => {
    const { container } = box('a', 'b')
    const outside = outsideButton()
    const trap = trapOf(container)
    trap.activate()
    trap.deactivate(false)

    outside.focus()
    expect(document.activeElement).toBe(outside)
    expect(tab().defaultPrevented).toBe(false)
  })

  it('isActive() = false — ловушка стоит, но не держит', () => {
    const { container } = box('a', 'b')
    const outside = outsideButton()
    const trap = createFocusTrap(container, () => false)
    traps.push(trap)
    trap.activate()

    outside.focus()
    expect(document.activeElement).toBe(outside)
  })
})

describe('focusTrap: стопка ловушек (попап поверх попапа)', () => {
  it('активна только верхняя: фокус снаружи уходит в верхнюю, Tab кружит по верхней', () => {
    const lower = box('l1', 'l2')
    const upper = box('u1', 'u2')
    trapOf(lower.container).activate()
    trapOf(upper.container).activate()
    expect(document.activeElement).toBe(upper.buttons[0])

    lower.buttons[1].focus()
    expect(document.activeElement).toBe(upper.buttons[0])

    upper.buttons[1].focus()
    tab()
    expect(document.activeElement).toBe(upper.buttons[0])
  })

  it('deactivate верхней → фокус на кнопку нижней, которой её открыли', () => {
    const lower = box('l1', 'l2')
    const upper = box('u1', 'u2')
    trapOf(lower.container).activate()
    lower.buttons[1].focus()
    const upperTrap = trapOf(upper.container)
    upperTrap.activate()

    upperTrap.deactivate()
    expect(document.activeElement).toBe(lower.buttons[1])
  })

  it('открывателя верхней больше нет в DOM → фокус на первый элемент нижней', () => {
    const lower = box('l1', 'l2')
    const upper = box('u1', 'u2')
    trapOf(lower.container).activate()
    lower.buttons[1].focus()
    const upperTrap = trapOf(upper.container)
    upperTrap.activate()

    lower.buttons[1].remove()
    upperTrap.deactivate()
    expect(document.activeElement).toBe(lower.buttons[0])
  })

  it('снятие НИЖНЕЙ, пока верхняя открыта, фокус из верхней не уводит', () => {
    const opener = outsideButton()
    opener.focus()
    const lower = box('l1', 'l2')
    const lowerTrap = trapOf(lower.container)
    lowerTrap.activate()
    const upper = box('u1', 'u2')
    trapOf(upper.container).activate()
    upper.buttons[1].focus()

    lowerTrap.deactivate()
    expect(document.activeElement).toBe(upper.buttons[1])
  })

  // Форма оболочки попапов: `isActive` = «попап верхний в POPUPS» (`indexTsx.tsx:228-231`).
  // Поверх двух ловушек открыт попап без подложки (`withoutOverlay` — своей ловушки
  // нет), фокус в нём; снятие нижнего попапа не должно затягивать фокус в средний.
  it('снятие нижней, когда верхняя не держит (сверху попап без ловушки), фокус не трогает', () => {
    const lower = box('l1')
    const lowerTrap = trapOf(lower.container)
    lowerTrap.activate()
    const upper = box('u1', 'u2')
    let upperIsTop = true
    const upperTrap = createFocusTrap(upper.container, () => upperIsTop)
    traps.push(upperTrap)
    upperTrap.activate()
    const noOverlay = box('n1')
    upperIsTop = false
    noOverlay.buttons[0].focus()

    lowerTrap.deactivate()
    expect(document.activeElement).toBe(noOverlay.buttons[0])
  })

  it('меню закрыло свой попап раньше себя: восстановление меню идёт мимо исчезающего попапа', () => {
    const opener = outsideButton()
    opener.focus()
    const dialog = box('d1', 'd2')
    const dialogTrap = trapOf(dialog.container)
    dialogTrap.activate()
    dialog.buttons[1].focus()
    const menu = box('m1')
    const menuTrap = trapOf(menu.container)
    menuTrap.activate()

    dialogTrap.deactivate()
    menuTrap.deactivate()
    expect(document.activeElement).toBe(opener)
  })
})

describe('getFocusableElements', () => {
  it('скрытые ([hidden], [inert], aria-hidden) и disabled пропускаются', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <button id="ok">ok</button>
      <button id="disabled" disabled>x</button>
      <div hidden><button id="hidden">x</button></div>
      <div inert><button id="inert">x</button></div>
      <div aria-hidden="true"><button id="aria">x</button></div>
      <span tabindex="-1" id="negative">x</span>
      <span tabindex="0" id="zero">x</span>
    `
    document.body.append(container)

    expect(getFocusableElements(container).map((el) => el.id)).toEqual(['ok', 'zero'])
  })

  it('из группы радио — только отмеченная, без отметки — первая', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <input type="radio" name="a" id="a1">
      <input type="radio" name="a" id="a2" checked>
      <input type="radio" name="a" id="a3">
      <input type="radio" name="b" id="b1">
      <input type="radio" name="b" id="b2">
    `
    document.body.append(container)

    expect(getFocusableElements(container).map((el) => el.id)).toEqual(['a2', 'b1'])
  })

  it('положительный tabindex идёт первым, остальные — в порядке DOM', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <button id="first">x</button>
      <button id="second" tabindex="2">x</button>
      <button id="third" tabindex="1">x</button>
    `
    document.body.append(container)

    expect(getFocusableElements(container).map((el) => el.id)).toEqual(['third', 'second', 'first'])
  })
})
