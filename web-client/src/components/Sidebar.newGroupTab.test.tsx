// «Новая группа» — флоу КОЛОНОЧНОГО слайдера (задача 0а-2 волны 7). Пины на врезку:
//  • `#new-menu` «New Group» зовёт `createNewGroupTab(slider)` (tweb
//    `sidebarLeft/index.ts:1073-1077`): первой въезжает вкладка выбора участников
//    `AppAddMembersTab` соседом `.item-main`;
//  • Esc закрывает вкладку одним шагом и возвращает чатлист (NAV-04 для этой вкладки).
// Вкладки настоящие; собственные пины флоу — `sidebarLeft/tabs/newGroup.solid.test.tsx`.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import lottieLoader from '@lib/lottie/lottieLoader'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
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
const membersTabs = () => [...sliderEl().querySelectorAll<HTMLElement>(':scope > .add-members-container.item-secondary')]

async function renderSidebar() {
  // Пустая книга контактов рисует заглушку-стикер выбора участников (`emptyPlaceholder`):
  // воркера lottie в happy-dom нет — заглушка стабом, как в `addMembers.solid.test.tsx`.
  vi.spyOn(lottieLoader, 'loadAnimationAsAsset').mockResolvedValue({} as LottiePlayer)
  vi.spyOn(lottieLoader, 'waitForFirstFrame').mockResolvedValue(undefined as never)
  await applyLang('en')
  useChatsStore.setState({ me: { user: { _: 'user', id: 1, first_name: 'Me', pFlags: {} } } as never })
  render(
    <ManagersProvider managers={managers}>
      <Sidebar onToggleMode={() => {}} />
    </ManagersProvider>,
  )
  await act(async () => {})
}

async function chooseNewGroup() {
  fireEvent.click(document.getElementById('new-menu')!)
  await act(async () => {})
  fireEvent.click(screen.getAllByText('New Group').find((el) => el.closest('#new-menu, .btn-menu, [role="menu"]'))!)
  await settle()
}

afterEach(async () => {
  cleanup()
  await pause(400)
  useChatsStore.setState({ me: null })
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('Sidebar — «Новая группа» на колоночном слайдере', () => {
  it('#new-menu «New Group» кладёт выбор участников (AppAddMembersTab) соседом .item-main', async () => {
    await renderSidebar()
    await chooseNewGroup()

    const [tab] = membersTabs()
    expect(tab).toBeDefined()
    expect(tab.previousElementSibling).toBe(mainTab())
    expect(tab.querySelector('.sidebar-header .sidebar-header__title')!.textContent).toBe('Add Members')
    expect(tab.querySelector(':scope > .sidebar-content > .btn-corner.is-visible')).not.toBeNull()
    expect(column().classList.contains('has-open-tabs')).toBe(true)
  })

  it('Esc закрывает вкладку одним шагом, чатлист снова активен', async () => {
    await renderSidebar()
    await chooseNewGroup()
    const [tab] = membersTabs()

    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(async () => { window.dispatchEvent(esc) })
    expect(esc.defaultPrevented).toBe(true)
    await settle()

    expect(tab.isConnected).toBe(false)
    expect(mainTab().classList.contains('active')).toBe(true)
    expect(column().classList.contains('has-open-tabs')).toBe(false)
  })
})
