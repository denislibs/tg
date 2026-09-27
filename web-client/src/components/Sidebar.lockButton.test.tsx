// Кнопка замка в шапке колонки — порт tweb `sidebarLeft/lockButton.tsx` и
// `toggleRightButtons` (`sidebarLeft/index.ts:345-352`, 812502980): при
// включённом код-пароле шапка дописывает ванильный узел кнопки
// (`sidebarLeft/lockButton.solid.tsx`) последним, после кнопки статуса, и снимает
// при выключении; поиск его не прячет. Щелчок запирает с анимацией иконки
// (`PasscodeLockScreenController.lock(иконка, onAnimationEnd)`).
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Sidebar from './Sidebar'
import { ManagersProvider } from '../core/hooks/useManagers'
import { useChatsStore } from '../stores/chatsStore'
import { useSettingsStore } from '../settings'
import { applyLang } from '@/test/lang'
import type { Managers } from '../client/bootstrap'

const lock = vi.hoisted(() => vi.fn(async(_icon?: HTMLElement | boolean, _onAnimationEnd?: () => void) => {}))
vi.mock('@components/passcodeLock/passcodeLockScreenController.solid', () => ({ default: { lock } }))

// Слой менеджеров — рекурсивный Proxy: любой вызов отдаёт промис (шов с воркером).
const managers = new Proxy({}, {
  get: () => new Proxy({}, { get: () => async () => undefined }),
}) as unknown as Managers

const setMe = (pFlags: { premium?: true }) => useChatsStore.setState({
  me: { user: { _: 'user', id: 1, first_name: 'Me', pFlags } } as never,
})

const header = () => document.querySelector('.main-search-sidebar-header')!
const lockBtn = () => header().querySelector<HTMLButtonElement>('.sidebar-lock-button')

const renderSidebar = async () => {
  await applyLang('en')
  render(
    <ManagersProvider managers={managers}>
      <Sidebar onToggleMode={() => {}} />
    </ManagersProvider>,
  )
  await act(async () => {})
}

afterEach(() => {
  cleanup()
  lock.mockClear()
  useChatsStore.setState({ me: null })
  useSettingsStore.setState({ passcodeEnabled: false })
})

describe('Sidebar — кнопка замка в шапке (tweb lockButton.tsx, toggleRightButtons)', () => {
  it('код выключен — замка нет; включили — Solid-узел порта последним ребёнком шапки; выключили — снят', async () => {
    setMe({})
    useSettingsStore.setState({ passcodeEnabled: false })
    await renderSidebar()
    expect(lockBtn()).toBeNull()
    expect(header().classList.contains('is-input-the-last-child')).toBe(true)

    await act(async () => { useSettingsStore.setState({ passcodeEnabled: true }) })
    const btn = lockBtn()!
    expect(btn).not.toBeNull()
    expect(header().lastElementChild).toBe(btn)
    expect([...btn.classList]).toEqual(['btn-icon', 'sidebar-lock-button'])
    expect(btn.getAttribute('aria-label')).toBe('Tap to lock Telegram.')
    // иконка — `LockIcon` tweb со скобой, не глиф шрифта
    expect(btn.querySelector(':scope > .sidebar-lock-button-icon > svg path.lock-icon-shackle')).not.toBeNull()
    expect(btn.querySelector('.tgico')).toBeNull()
    expect(header().classList.contains('is-input-the-last-child')).toBe(false)

    await act(async () => { useSettingsStore.setState({ passcodeEnabled: false }) })
    expect(lockBtn()).toBeNull()
    expect(header().classList.contains('is-input-the-last-child')).toBe(true)
  })

  it('у подписчика Premium — после кнопки статуса, и остаётся последним при смене Premium', async () => {
    setMe({})
    useSettingsStore.setState({ passcodeEnabled: true })
    await renderSidebar()
    expect(header().lastElementChild).toBe(lockBtn())

    await act(async () => { setMe({ premium: true }) })
    const status = header().querySelector(':scope > .sidebar-emoji-status')!
    expect(status).not.toBeNull()
    expect(status.nextElementSibling).toBe(lockBtn())
    expect(header().lastElementChild).toBe(lockBtn())
  })

  it('щелчок — lock(обёртка иконки, onAnimationEnd); поиск кнопку не прячет', async () => {
    setMe({})
    useSettingsStore.setState({ passcodeEnabled: true })
    await renderSidebar()

    await act(async () => { lockBtn()!.click() })
    expect(lock).toHaveBeenCalledTimes(1)
    expect(lock.mock.calls[0][0]).toBe(lockBtn()!.querySelector('.sidebar-lock-button-icon'))
    expect(lock.mock.calls[0][1]).toBeTypeOf('function')

    const input = header().querySelector<HTMLInputElement>('.input-search-input')!
    await act(async () => { input.dispatchEvent(new FocusEvent('focus')) })
    await act(async () => {})
    expect(lockBtn()).not.toBeNull()
  })
})
