// Вкладка контактов — вкладка КОЛОНОЧНОГО слайдера (задача 0а-1 волны 7). Пины на врезку:
//  • бургер «Contacts» (tweb `sidebarLeft/index.ts:693-696`, `closeTabsBefore` →
//    `createTab(AppContactsTab).open()`) кладёт вкладку соседом `.item-main`;
//  • `#new-menu` «New Private Chat» открывает ТУ ЖЕ вкладку (tweb `:1079-1083`,
//    `:1105-1109`); «New Secret Chat» (Отступление В7-1) скрыт флагом
//    `SECRET_CHATS_ENABLED` (решение пользователя 2026-10-01, `config/app.ts`);
//  • Esc закрывает вкладку одним шагом и возвращает чатлист (NAV-04 для этой вкладки).
// Содержимое вкладки — заглушка, которая показывает опцию: собственные пины вкладки —
// `sidebarLeft/tabs/contacts.solid.test.tsx`.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Sidebar from './Sidebar'
import { ManagersProvider } from '../core/hooks/useManagers'
import { useChatsStore } from '../stores/chatsStore'
import { applyLang } from '@/test/lang'
import type { Managers } from '../client/bootstrap'

// Solid-содержимое — функция, отдающая DOM-узел; опцию вкладки она читает контекстом
// `useSuperTab` — тем же, каким читает её настоящая вкладка.
vi.mock('./sidebarLeft/tabs/contacts.solid', async () => {
  const { useSuperTab } = await import('./solidJsTabs/superTabProvider.solid')
  return {
    default: () => {
      const [tab] = useSuperTab()
      const el = document.createElement('div')
      el.className = 'contacts-stub'
      el.dataset.secret = String(!!(tab as unknown as { payload?: { secret?: true } }).payload?.secret)
      tab.container.id = 'contacts-container'
      return el
    },
  }
})

const managers = new Proxy({}, {
  get: () => new Proxy({}, { get: (_, method) => method === 'listAccounts' ? async () => [] : async () => undefined }),
}) as unknown as Managers

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = () => act(async () => { await pause(400) })

const column = () => document.getElementById('column-left')!
const sliderEl = () => column().querySelector<HTMLElement>(':scope > .sidebar-slider')!
const mainTab = () => sliderEl().querySelector<HTMLElement>(':scope > .item-main')!
const contactsTabs = () => [...sliderEl().querySelectorAll<HTMLElement>(':scope > #contacts-container.item-secondary')]

async function renderSidebar() {
  await applyLang('en')
  useChatsStore.setState({ me: { user: { _: 'user', id: 1, first_name: 'Me', pFlags: {} } } as never })
  render(
    <ManagersProvider managers={managers}>
      <Sidebar onToggleMode={() => {}} />
    </ManagersProvider>,
  )
  await act(async () => {})
}

async function clickMenuItem(toggle: HTMLElement, label: string) {
  fireEvent.click(toggle)
  // меню — порт tweb `ButtonMenuToggle`: строится асинхронно и принимает клик,
  // только став `active`
  await vi.waitFor(() => expect(document.querySelector('.btn-menu.active')).not.toBeNull())
  fireEvent.click(screen.getByText(label))
  await act(async () => { await pause(50) })
}

afterEach(async () => {
  cleanup()
  await pause(400)
  useChatsStore.setState({ me: null })
  document.body.replaceChildren()
})

describe('Sidebar — вкладка контактов на колоночном слайдере', () => {
  it('бургер «Contacts» кладёт AppContactsTab соседом .item-main', async () => {
    await renderSidebar()
    await clickMenuItem(document.querySelector('.sidebar-tools-button')!, 'Contacts')

    const [tab] = contactsTabs()
    expect(tab).toBeDefined()
    expect(tab.previousElementSibling).toBe(mainTab())
    expect(tab.querySelector('.contacts-stub')!.getAttribute('data-secret')).toBe('false')
    expect(column().classList.contains('has-open-tabs')).toBe(true)
  })

  it('#new-menu: «New Private Chat» — та же вкладка без {secret}; «New Secret Chat» скрыт флагом', async () => {
    await renderSidebar()
    const fab = document.getElementById('new-menu')!

    await clickMenuItem(fab, 'New Private Chat')
    expect(contactsTabs()).toHaveLength(1)
    expect(contactsTabs()[0].querySelector('.contacts-stub')!.getAttribute('data-secret')).toBe('false')
    await settle()

    fireEvent.click(fab)
    await act(async () => {})
    expect(screen.queryByText('New Secret Chat')).toBeNull()
  })

  it('Esc закрывает вкладку одним шагом, чатлист снова активен', async () => {
    await renderSidebar()
    await clickMenuItem(document.querySelector('.sidebar-tools-button')!, 'Contacts')
    await settle()
    const [tab] = contactsTabs()

    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(async () => { window.dispatchEvent(esc) })
    expect(esc.defaultPrevented).toBe(true)
    await settle()

    expect(tab.isConnected).toBe(false)
    expect(mainTab().classList.contains('active')).toBe(true)
    expect(column().classList.contains('has-open-tabs')).toBe(false)
  })
})
