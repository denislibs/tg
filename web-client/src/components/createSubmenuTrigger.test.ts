// Тесты порта tweb `components/createSubmenuTrigger.ts` + `floatingButtonMenu.ts`
// (см. шапки файлов рядом). Пины — на DOM, который видит пользователь: подпись
// пункта-триггера с шевроном, подменю по наведению рядом с пунктом, клик по
// пункту не закрывает корневое меню, а закрытие корня уносит и подменю.
import { afterEach, describe, expect, it, vi } from 'vitest'
import contextMenuController from '@helpers/contextMenuController'
import { getIconContent } from '@components/icon'
import ButtonMenu from '@components/buttonMenu'
import ButtonMenuToggle from '@components/buttonMenuToggle'
import createSubmenuTrigger from './createSubmenuTrigger'
import { applyLang } from '@/test/lang'

afterEach(() => {
  contextMenuController.close()
  vi.useRealTimers()
  document.body.replaceChildren()
})

const rootMenu = () => document.body.querySelector<HTMLElement>(':scope > .btn-menu:not(.btn-menu-submenu)')
const submenu = () => document.body.querySelector<HTMLElement>(':scope > .btn-menu.btn-menu-submenu')

async function openRootWith(trigger: ReturnType<typeof createSubmenuTrigger>) {
  await applyLang('en')
  const container = document.createElement('span')
  document.body.append(container)
  const onPlain = vi.fn()
  ButtonMenuToggle({
    container,
    direction: 'bottom-right',
    buttons: [trigger, { text: 'Settings', onClick: onPlain }],
    // tweb `sidebarLeft/index.ts:849-857` — триггер вешается на открытии корня
    onOpen: () => trigger.onOpen?.(),
    onClose: () => trigger.onClose?.(),
  })
  container.click()
  await vi.waitFor(() => expect(rootMenu()?.classList.contains('active')).toBe(true))
  return { menu: rootMenu()!, onPlain }
}

describe('createSubmenuTrigger', () => {
  it('подпись пункта: span.submenu-label > span.submenu-label-text + шеврон arrowhead (tweb :70-77)', async() => {
    const trigger = createSubmenuTrigger({
      options: { text: 'MultiAccount.More', icon: 'more' },
      createSubmenu: () => ButtonMenu({ buttons: [] }),
    })
    const { menu } = await openRootWith(trigger)
    const item = menu.querySelector<HTMLElement>('.btn-menu-item')!

    const label = item.querySelector('.btn-menu-item-text > .submenu-label')!
    expect(label.querySelector('.submenu-label-text')!.textContent).toBe('More')
    expect(label.lastElementChild!.textContent).toBe(getIconContent('arrowhead'))
    expect(item.classList.contains('submenu-trigger')).toBe(true)
  })

  it('наведение открывает подменю рядом с пунктом: btn-menu-submenu, active, позиция', async() => {
    const createSubmenu = vi.fn(() => ButtonMenu({ buttons: [{ text: 'ReportBug', onClick: () => {} }] }))
    const trigger = createSubmenuTrigger({ options: { text: 'MultiAccount.More', icon: 'more' }, createSubmenu })
    await openRootWith(trigger)

    trigger.element!.dispatchEvent(new MouseEvent('mouseenter'))
    await vi.waitFor(() => expect(submenu()?.classList.contains('active')).toBe(true))

    expect(createSubmenu).toHaveBeenCalledTimes(1)
    expect(submenu()!.textContent).toContain('Report Bug')
    expect(submenu()!.style.left).not.toBe('')
    expect(submenu()!.style.top).not.toBe('')
  })

  it('клик по триггеру не закрывает корневое меню (keepOpen + stopPropagation, tweb :36-38, :83)', async() => {
    const trigger = createSubmenuTrigger({
      options: { text: 'MultiAccount.More', icon: 'more' },
      createSubmenu: () => ButtonMenu({ buttons: [] }),
    })
    const { menu } = await openRootWith(trigger)

    trigger.element!.click()
    await new Promise((r) => setTimeout(r, 20))

    expect(menu.classList.contains('active')).toBe(true)
    expect(contextMenuController.isOpened()).toBe(true)
  })

  it('уход курсора до готовности подменю отменяет его (tweb floatingButtonMenu :47-55)', async() => {
    let resolve!: (el: HTMLElement) => void
    const trigger = createSubmenuTrigger({
      options: { text: 'MultiAccount.More', icon: 'more' },
      createSubmenu: () => new Promise<HTMLElement>((r) => { resolve = r }),
    })
    await openRootWith(trigger)

    trigger.element!.dispatchEvent(new MouseEvent('mouseenter'))
    trigger.element!.dispatchEvent(new MouseEvent('mouseleave'))
    resolve(await ButtonMenu({ buttons: [] }))
    await new Promise((r) => setTimeout(r, 20))

    expect(submenu()).toBeNull()
  })

  it('закрытие корня закрывает и подменю', async() => {
    const trigger = createSubmenuTrigger({
      options: { text: 'MultiAccount.More', icon: 'more' },
      createSubmenu: () => ButtonMenu({ buttons: [] }),
    })
    await openRootWith(trigger)
    trigger.element!.dispatchEvent(new MouseEvent('mouseenter'))
    await vi.waitFor(() => expect(submenu()?.classList.contains('active')).toBe(true))

    contextMenuController.close()

    expect(submenu()!.classList.contains('active')).toBe(false)
  })
})
