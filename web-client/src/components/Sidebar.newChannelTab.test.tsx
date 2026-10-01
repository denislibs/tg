// «Новый канал» — вкладка КОЛОНОЧНОГО слайдера (задача 0а-3 волны 7). Пины на врезку:
//  • `#new-menu` «New Channel» (tweb `sidebarLeft/index.ts:1086-1092`,
//    `createTab(AppNewChannelTab).open({})`) кладёт вкладку соседом `.item-main`;
//  • повторный выбор пункта при открытой вкладке второй не создаёт (`noSame`);
//  • Esc закрывает вкладку одним шагом и возвращает чатлист (NAV-04 для этой вкладки).
// Вкладка настоящая (`sidebarLeft/tabs/newChannel.solid.tsx`); её собственные пины —
// `sidebarLeft/tabs/newChannel.solid.test.tsx`.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Sidebar from './Sidebar'
import { ManagersProvider } from '../core/hooks/useManagers'
import { useChatsStore } from '../stores/chatsStore'
import { applyLang } from '@/test/lang'
import type { Managers } from '../client/bootstrap'

const managers = new Proxy({}, {
  get: () => new Proxy({}, { get: (_, method) => method === 'listAccounts' ? async () => [] : async () => undefined }),
}) as unknown as Managers

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = () => act(async () => { await pause(400) })

const column = () => document.getElementById('column-left')!
const sliderEl = () => column().querySelector<HTMLElement>(':scope > .sidebar-slider')!
const mainTab = () => sliderEl().querySelector<HTMLElement>(':scope > .item-main')!
const channelTabs = () => [...sliderEl().querySelectorAll<HTMLElement>(':scope > .new-channel-container.item-secondary')]

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

async function chooseNewChannel() {
  fireEvent.click(document.getElementById('new-menu')!)
  await act(async () => {})
  fireEvent.click(screen.getAllByText('New Channel').find((el) => el.closest('#new-menu, .btn-menu, [role="menu"]'))!)
  await settle()
}

afterEach(async () => {
  cleanup()
  await pause(400)
  useChatsStore.setState({ me: null })
  document.body.replaceChildren()
})

describe('Sidebar — «Новый канал» на колоночном слайдере', () => {
  it('#new-menu «New Channel» кладёт AppNewChannelTab соседом .item-main', async () => {
    await renderSidebar()
    await chooseNewChannel()

    const [tab] = channelTabs()
    expect(tab).toBeDefined()
    expect(tab.previousElementSibling).toBe(mainTab())
    expect(tab.querySelector('.sidebar-header .sidebar-header__title')!.textContent).toBe('New Channel')
    expect(tab.querySelector('.avatar-edit')).not.toBeNull()
    expect(column().classList.contains('has-open-tabs')).toBe(true)
  })

  it('Esc закрывает вкладку одним шагом, чатлист снова активен', async () => {
    await renderSidebar()
    await chooseNewChannel()
    const [tab] = channelTabs()

    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(async () => { window.dispatchEvent(esc) })
    expect(esc.defaultPrevented).toBe(true)
    await settle()

    expect(tab.isConnected).toBe(false)
    expect(mainTab().classList.contains('active')).toBe(true)
    expect(column().classList.contains('has-open-tabs')).toBe(false)
  })
})
