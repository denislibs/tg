// Тесты порта tweb `helpers/contextMenuController.ts` + базы
// `helpers/overlayClickHandler.ts` (см. шапки файлов рядом).
//
// Среда тестов — happy-dom без тача (`IS_TOUCH_SUPPORTED === false`), то есть
// десктопная ветка: слежка за мышью включена, `contextmenu` слушается once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import contextMenuController from './contextMenuController'
import overlayCounter from './overlayCounter'
import mediaSizes from '@helpers/mediaSizes'

/** Меню в DOM внутри «родителя» — так его монтирует ButtonMenuToggle-путь. */
function makeMenu() {
  const parent = document.createElement('div')
  const menu = document.createElement('div')
  menu.classList.add('btn-menu')
  parent.append(menu)
  document.body.append(parent)
  return { parent, menu }
}

/** Прямоугольник узла — happy-dom layout не считает. */
function stubRect(el: HTMLElement, rect: Partial<DOMRect>) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
    ...rect,
  } as DOMRect)
}

function mouseMove(clientX: number, clientY: number) {
  const e = new MouseEvent('mousemove')
  Object.defineProperty(e, 'clientX', { value: clientX, configurable: true })
  Object.defineProperty(e, 'clientY', { value: clientY, configurable: true })
  window.dispatchEvent(e)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  contextMenuController.close()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('openBtnMenu / close', () => {
  it('открытие вешает active + was-open на меню и menu-open на родителя', () => {
    const { parent, menu } = makeMenu()

    contextMenuController.openBtnMenu(menu)

    expect(menu.classList.contains('active')).toBe(true)
    expect(menu.classList.contains('was-open')).toBe(true)
    expect(parent.classList.contains('menu-open')).toBe(true)
    expect(contextMenuController.isOpened()).toBe(true)
  })

  it('triggerElement перебивает родителя как носитель menu-open', () => {
    const { parent, menu } = makeMenu()
    const trigger = document.createElement('button')
    document.body.append(trigger)

    contextMenuController.openBtnMenu(menu, undefined, trigger)

    expect(trigger.classList.contains('menu-open')).toBe(true)
    expect(parent.classList.contains('menu-open')).toBe(false)
  })

  it('close снимает active и menu-open и зовёт onClose ровно один раз', () => {
    const { parent, menu } = makeMenu()
    const onClose = vi.fn()

    contextMenuController.openBtnMenu(menu, onClose)
    contextMenuController.close()

    expect(menu.classList.contains('active')).toBe(false)
    // was-open остаётся — на нём держится мобильная анимация
    expect(menu.classList.contains('was-open')).toBe(true)
    expect(parent.classList.contains('menu-open')).toBe(false)
    expect(contextMenuController.isOpened()).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('оверлей .btn-menu-overlay вставляется ПЕРЕД меню и снимается на закрытии', () => {
    const { parent, menu } = makeMenu()

    contextMenuController.openBtnMenu(menu)
    const overlay = parent.querySelector('.btn-menu-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay!.nextElementSibling).toBe(menu)

    contextMenuController.close()
    expect(parent.querySelector('.btn-menu-overlay')).toBeNull()
  })

  it('close(e) с таргетом .btn-menu ничего не делает (клик по самому меню)', () => {
    const { menu } = makeMenu()
    contextMenuController.openBtnMenu(menu)

    const e = new MouseEvent('click')
    Object.defineProperty(e, 'target', { value: menu, configurable: true })
    contextMenuController.close(e)

    expect(contextMenuController.isOpened()).toBe(true)
  })

  it('night вешается, когда активен тёмный оверлей, и снимается через 400 мс', () => {
    const { menu } = makeMenu()
    overlayCounter.isDarkOverlayActive = true

    contextMenuController.openBtnMenu(menu)
    expect(menu.classList.contains('night')).toBe(true)

    contextMenuController.close()
    expect(menu.classList.contains('night')).toBe(true)
    vi.advanceTimersByTime(400)
    expect(menu.classList.contains('night')).toBe(false)

    overlayCounter.isDarkOverlayActive = false
  })

  it('без тёмного оверлея night не вешается', () => {
    const { menu } = makeMenu()
    contextMenuController.openBtnMenu(menu)
    expect(menu.classList.contains('night')).toBe(false)
  })
})

describe('закрытие по клику мимо', () => {
  it('клик вне меню закрывает', () => {
    const { menu } = makeMenu()
    const outside = document.createElement('div')
    document.body.append(outside)

    contextMenuController.openBtnMenu(menu)
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(contextMenuController.isOpened()).toBe(false)
  })

  it('клик внутри меню не закрывает', () => {
    const { menu } = makeMenu()
    const item = document.createElement('div')
    menu.append(item)

    contextMenuController.openBtnMenu(menu)
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(contextMenuController.isOpened()).toBe(true)
  })
})

describe('закрытие по уходу курсора (десктоп)', () => {
  it('корневое меню закрывается, только когда курсор дальше 100 px', () => {
    const { menu } = makeMenu()
    stubRect(menu, { left: 100, top: 100, right: 300, bottom: 300 })

    contextMenuController.openBtnMenu(menu)

    mouseMove(399, 200) // 99 px правее — ещё держится
    expect(contextMenuController.isOpened()).toBe(true)

    mouseMove(400, 200) // ровно 100 px — закрывается
    expect(contextMenuController.isOpened()).toBe(false)
  })
})

describe('стек подменю', () => {
  it('addAdditionalMenu помечает подменю active/was-open, close закрывает всё', () => {
    const { menu } = makeMenu()
    const trigger = document.createElement('div')
    const submenu = document.createElement('div')
    document.body.append(trigger, submenu)
    const onSubClose = vi.fn()

    contextMenuController.openBtnMenu(menu)
    contextMenuController.addAdditionalMenu(submenu, trigger, 2, onSubClose)

    expect(submenu.classList.contains('active')).toBe(true)
    expect(submenu.classList.contains('was-open')).toBe(true)

    contextMenuController.close()
    expect(submenu.classList.contains('active')).toBe(false)
    expect(onSubClose).toHaveBeenCalled()
    // узел подменю удаляется отложенно, через pause(400)
    vi.advanceTimersByTime(400)
  })

  it('addAdditionalMenu без открытого корневого меню — no-op', () => {
    const trigger = document.createElement('div')
    const submenu = document.createElement('div')
    document.body.append(trigger, submenu)

    contextMenuController.addAdditionalMenu(submenu, trigger, 2)

    expect(submenu.classList.contains('active')).toBe(false)
  })

  it('closeMenusByLevel закрывает подменю своего уровня и глубже', () => {
    const { menu } = makeMenu()
    const trigger = document.createElement('div')
    const second = document.createElement('div')
    const third = document.createElement('div')
    document.body.append(trigger, second, third)

    contextMenuController.openBtnMenu(menu)
    contextMenuController.addAdditionalMenu(second, trigger, 2)
    contextMenuController.addAdditionalMenu(third, trigger, 3)

    contextMenuController.closeMenusByLevel(3)
    expect(third.classList.contains('active')).toBe(false)
    expect(second.classList.contains('active')).toBe(true)

    contextMenuController.closeMenusByLevel(2)
    expect(second.classList.contains('active')).toBe(false)
    vi.advanceTimersByTime(400)
  })
})

describe('реакция на ресайз', () => {
  it('mediaSizes resize закрывает открытое меню', () => {
    const { menu } = makeMenu()
    contextMenuController.openBtnMenu(menu)

    mediaSizes.dispatchEvent('resize')

    expect(contextMenuController.isOpened()).toBe(false)
  })
})
