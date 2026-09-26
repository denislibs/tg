// Порт tweb `src/tests/activationKeys.test.ts` (472e3e76b) — пины
// `helpers/solid/buttonKeyDown.ts`.
//
// Два хелпера различаются ровно в одном, и это главное: кнопка отвечает на
// Enter И Space, ссылка — только на Enter. На ссылке Space принадлежит
// прокрутке: отдать его ссылке — отнять page-down у того, кто читает список,
// в котором она стоит.
import { expect, it, vi } from 'vitest'
import buttonKeyDown, { linkKeyDown } from './buttonKeyDown'

function press(element: HTMLElement, key: string) {
  const event = new KeyboardEvent('keydown', { key, cancelable: true })
  Object.defineProperty(event, 'target', { value: element })
  return event
}

function stub(role: string) {
  const element = document.createElement('div')
  element.setAttribute('role', role)
  element.tabIndex = 0
  const click = vi.fn()
  element.click = click
  return { element, click }
}

it('заместитель кнопки срабатывает на Enter и на Space', () => {
  const { element, click } = stub('button')

  const enter = press(element, 'Enter')
  buttonKeyDown(enter, element)
  expect(click).toHaveBeenCalledTimes(1)
  expect(enter.defaultPrevented).toBe(true)

  const space = press(element, ' ')
  buttonKeyDown(space, element)
  expect(click).toHaveBeenCalledTimes(2)
  expect(space.defaultPrevented).toBe(true)
})

it('заместитель ссылки срабатывает на Enter, а Space оставляет прокрутке', () => {
  const { element, click } = stub('link')

  const enter = press(element, 'Enter')
  linkKeyDown(enter, element)
  expect(click).toHaveBeenCalledTimes(1)
  expect(enter.defaultPrevented).toBe(true)

  const space = press(element, ' ')
  linkKeyDown(space, element)
  expect(click).toHaveBeenCalledTimes(1)
  expect(space.defaultPrevented).toBe(false)
})

it('на нативном контроле не срабатывает ни один — он активируется сам', () => {
  const anchor = document.createElement('a')
  anchor.href = '#somewhere'
  const click = vi.fn()
  anchor.click = click

  linkKeyDown(press(anchor, 'Enter'), anchor)
  buttonKeyDown(press(anchor, 'Enter'), anchor)
  expect(click).not.toHaveBeenCalled()
})

it('выключенный заместитель ([aria-disabled="true"]) не активируется', () => {
  const { element, click } = stub('button')
  element.setAttribute('aria-disabled', 'true')

  buttonKeyDown(press(element, 'Enter'), element)
  expect(click).not.toHaveBeenCalled()
})

it('пропускает клавишу, которая лишь проходит мимо: повтор, обработанная, от ребёнка', () => {
  const { element, click } = stub('link')

  const repeated = press(element, 'Enter')
  Object.defineProperty(repeated, 'repeat', { value: true })
  linkKeyDown(repeated, element)

  const handled = press(element, 'Enter')
  handled.preventDefault()
  linkKeyDown(handled, element)

  const fromAChild = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
  Object.defineProperty(fromAChild, 'target', { value: document.createElement('span') })
  linkKeyDown(fromAChild, element)

  expect(click).not.toHaveBeenCalled()
})
