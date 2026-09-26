// Тесты порта tweb `components/buttonMenuToggle.ts` (см. шапку файла рядом).
//
// Пины — на DOM: где меню смонтировано, какие классы у меню и у триггера, что
// лежит в пунктах и когда узел уходит из DOM. Проверка «позвали ли
// contextMenuController» формой вызова ничего не доказывает: меню может быть
// «открыто» и при этом не лежать в документе.
import { afterEach, describe, expect, it, vi } from 'vitest'
import contextMenuController from '@helpers/contextMenuController'
import { getIconContent } from '@components/icon'
import type { ButtonMenuItemOptionsVerifiable } from '@components/buttonMenu'
import ButtonMenuToggle from './buttonMenuToggle'

afterEach(() => {
  contextMenuController.close()
  vi.useRealTimers()
  document.body.replaceChildren()
})

/** Триггер в документе — меню позиционируется от его прямоугольника. */
function mountTrigger() {
  const container = document.createElement('span')
  document.body.append(container)
  return container
}

/** Меню, смонтированное toggle'ом: tweb кладёт его в overlay-root (у нас body), а не в триггер. */
const openedMenu = () => document.body.querySelector<HTMLElement>(':scope > .btn-menu')

async function open(trigger: HTMLElement) {
  trigger.click()
  await vi.waitFor(() => expect(openedMenu()?.classList.contains('active')).toBe(true))
  return openedMenu()!
}

const items = (menu: HTMLElement) => Array.from(menu.querySelectorAll<HTMLElement>('.btn-menu-item'))

describe('ButtonMenuToggle: открытие', () => {
  it('контейнер получает btn-menu-toggle; клик монтирует меню в body с направлением, active и menu-open', async() => {
    const container = mountTrigger()
    const onClick = vi.fn()
    const button = ButtonMenuToggle({
      container,
      direction: 'bottom-left',
      buttons: [{ text: 'Delete', onClick }],
    })

    expect(button).toBe(container)
    expect(container.classList.contains('btn-menu-toggle')).toBe(true)
    expect(openedMenu()).toBeNull()

    const menu = await open(container)

    // tweb :139 — класс направления; :153-155 — overlay-root, НЕ внутрь триггера
    expect(menu.classList.contains('bottom-left')).toBe(true)
    expect(menu.parentElement).toBe(document.body)
    expect(container.contains(menu)).toBe(false)
    // contextMenuController.openBtnMenu(menu, onClose, el): menu-open на ТРИГГЕРЕ
    expect(container.classList.contains('menu-open')).toBe(true)
    // tweb :157 — positionMenuTrigger для bottom-left ставит top и right
    expect(menu.style.top).not.toBe('')
    expect(menu.style.right).not.toBe('')

    expect(items(menu).map((el) => el.textContent)).toEqual(['Delete'])
  })

  it('без container строит ButtonIcon с глифом icon (tweb :95)', () => {
    const button = ButtonMenuToggle({ direction: 'bottom-left', buttons: [], icon: 'more' })
    expect(button.classList.contains('btn-icon')).toBe(true)
    expect(button.classList.contains('btn-menu-toggle')).toBe(true)
    expect(button.querySelector('.tgico')?.textContent).toBe(getIconContent('more'))
  })

  it('onOpen получает смонтируемый элемент до вставки — его правки видны в DOM (tweb :144)', async() => {
    const container = mountTrigger()
    ButtonMenuToggle({
      container,
      direction: 'bottom-left',
      buttons: [{ text: 'Delete', onClick: () => {} }],
      onOpen: (_e, element) => {
        element.style.bottom = 'unset'
      },
    })

    const menu = await open(container)
    expect(menu.style.bottom).toBe('unset')
  })

  it('verify отсеивает пункты; если не прошёл ни один — меню не открывается (tweb :124-128)', async() => {
    const container = mountTrigger()
    const buttons: ButtonMenuItemOptionsVerifiable[] = [
      { text: 'Delete', onClick: () => {}, verify: () => false },
      { text: 'Copy', onClick: () => {}, verify: () => Promise.resolve(true) },
    ]
    ButtonMenuToggle({ container, direction: 'bottom-left', buttons })

    const menu = await open(container)
    expect(items(menu).map((el) => el.textContent)).toEqual(['Copy'])

    contextMenuController.close()

    const empty = mountTrigger()
    ButtonMenuToggle({
      container: empty,
      direction: 'bottom-left',
      buttons: [{ text: 'Delete', onClick: () => {}, verify: () => false }],
    })
    empty.click()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(empty.classList.contains('menu-open')).toBe(false)
  })
})

describe('ButtonMenuToggle: закрытие', () => {
  it('клик по открытому триггеру закрывает меню: menu-open снят, узел уходит из DOM через 300 мс (tweb :169-185)', async() => {
    const container = mountTrigger()
    const onClose = vi.fn()
    const onCloseAfter = vi.fn()
    ButtonMenuToggle({
      container,
      direction: 'bottom-left',
      buttons: [{ text: 'Delete', onClick: () => {} }],
      onClose,
      onCloseAfter,
    })

    const menu = await open(container)

    vi.useFakeTimers()
    container.click()

    expect(container.classList.contains('menu-open')).toBe(false)
    expect(menu.classList.contains('active')).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
    // узел ещё в DOM — играет transition закрытия
    expect(menu.isConnected).toBe(true)

    vi.advanceTimersByTime(300)
    expect(menu.isConnected).toBe(false)
    expect(onCloseAfter).toHaveBeenCalledTimes(1)
  })

  it('после закрытия меню строится заново — правки опций (иконка) доезжают до пунктов (tweb :178-182)', async() => {
    const container = mountTrigger()
    const buttons = [
      { text: 'Delete', onClick: () => {} },
      { text: 'Copy', onClick: () => {} },
    ] as ButtonMenuItemOptionsVerifiable[]
    ButtonMenuToggle({ container, direction: 'bottom-left', buttons })

    const first = await open(container)
    expect(items(first)[1].querySelector('.tgico')).toBeNull()

    vi.useFakeTimers()
    contextMenuController.close()
    vi.advanceTimersByTime(300)
    vi.useRealTimers()

    buttons[1].icon = 'check'
    const second = await open(container)

    expect(second).not.toBe(first)
    expect(items(second)[1].querySelector('.tgico')?.textContent).toBe(getIconContent('check'))
  })

  it('клик по пункту закрывает меню и зовёт его onClick', async() => {
    const container = mountTrigger()
    const onClick = vi.fn()
    ButtonMenuToggle({ container, direction: 'bottom-left', buttons: [{ text: 'Delete', onClick }] })

    const menu = await open(container)
    items(menu)[0].click()

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(container.classList.contains('menu-open')).toBe(false)
  })
})
