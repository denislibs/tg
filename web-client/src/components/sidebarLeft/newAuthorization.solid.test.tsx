/** @jsxImportSource solid-js */
// Пины плашки «новый вход» — порт tweb `tests/newAuthorization.test.tsx` (812502980)
// и проводки `renderNewAuthorization` (tweb `appDialogsManager.ts:1390-1394`).
//
// Менеджеры воркера — `getProxiedManagers().sessions` (расхождение 1 шапки компонента),
// поэтому вместо `rootScope.managers.appAccountManager` мокается он. Строки — настоящие
// (`@/test/lang`), попапы и тяжёлые зависимости — как в оригинале.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  terminate: vi.fn(),
  list: vi.fn(),
  getUnconfirmed: vi.fn(),
  toast: vi.fn(),
  toastNew: vi.fn(),
  createPopupTsx: vi.fn(),
  createTab: vi.fn(),
  open: vi.fn(),
}))

vi.mock('@/client/bootstrap', () => ({
  getProxiedManagers: () => ({
    sessions: {
      confirmUnconfirmedAuthorization: mocks.confirm,
      terminate: mocks.terminate,
      list: mocks.list,
      getUnconfirmedAuthorizations: mocks.getUnconfirmed,
    },
  }),
}))

vi.mock('@components/toast', () => ({
  hideToast: vi.fn(),
  toast: mocks.toast,
  toastNew: mocks.toastNew,
}))

vi.mock('@components/popups/indexTsx.solid', () => ({
  default: (): null => null,
  createPopup: mocks.createPopupTsx,
}))

vi.mock('@components/lottieAnimation.solid', () => ({
  default: (): null => null,
}))

vi.mock('@components/mediaHeader.solid', () => ({
  default: (): null => null,
}))

vi.mock('@lib/lottie/lottieLoader', () => ({
  default: {},
}))

vi.mock('@components/sidebarLeft', () => ({
  default: { createTab: mocks.createTab },
}))

vi.mock('@components/solidJsTabs/tabs', () => ({
  AppActiveSessionsTab: class AppActiveSessionsTab {},
}))

import '@/test/lang'
import rootScope from '@lib/rootScope'
import { useIsSidebarCollapsed } from '@stores/foldersSidebar.solid'
import type { Managers } from '@/client/bootstrap'
import { NewAuthorization, renderNewAuthorization } from './newAuthorization.solid'

const managers = { sessions: { getUnconfirmedAuthorizations: mocks.getUnconfirmed } } as unknown as Managers

const authorization = {
  hash: 42,
  date: 1_000,
  device: 'Safari on iPhone',
  location: 'Dubai, UAE',
}

let dispose: (() => void) | undefined

const buttonByText = (container: HTMLElement, text: string) => {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent === text)!
}

beforeEach(() => {
  mocks.createTab.mockReturnValue({ open: mocks.open })
  mocks.list.mockResolvedValue([])
  mocks.getUnconfirmed.mockResolvedValue([])
  useIsSidebarCollapsed()[1](false)
})

afterEach(() => {
  vi.useRealTimers()
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  document.body.className = ''
  vi.clearAllMocks()
})

describe('new authorization notice', () => {
  it('announces the expanded notice and confirms through the sessions manager', async() => {
    mocks.confirm.mockResolvedValue(true)
    const container = document.createElement('div')
    document.body.append(container)
    dispose = render(() => <NewAuthorization authorization={authorization} total={2} />, container)

    const notice = container.querySelector<HTMLElement>('[role="alert"]')!
    expect(notice).toBeTruthy()
    expect(notice.getAttribute('aria-live')).toBe('assertive')
    expect(notice.textContent).toContain('1/2 Someone just got access')
    expect(notice.textContent).toContain('from Safari on iPhone, Dubai, UAE')

    const confirm = buttonByText(container, 'Yes, it’s me')
    expect(confirm.classList.contains('hover-primary-effect')).toBe(true)
    expect(confirm.classList.contains('rp-overflow')).toBe(true)
    const deny = buttonByText(container, 'No, it’s not me!')
    expect(deny.classList.contains('rp-overflow')).toBe(true)
    confirm.click()
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.confirm).toHaveBeenCalledWith(42)
    expect(mocks.terminate).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith(expect.any(DocumentFragment), undefined, 5000)
  })

  it('uses a keyboard-focusable labelled button when the sidebar is collapsed', () => {
    useIsSidebarCollapsed()[1](true)
    const container = document.createElement('div')
    document.body.append(container)
    dispose = render(() => <NewAuthorization authorization={authorization} total={1} />, container)

    const button = container.querySelector<HTMLButtonElement>('button[aria-label]')!
    expect(button).toBeTruthy()
    expect(button.type).toBe('button')
    expect(button.getAttribute('aria-label')).toContain('Safari on iPhone, Dubai, UAE')
    button.click()
    expect(mocks.createPopupTsx).toHaveBeenCalledOnce()
  })

  it('opens the prevented-login flow with PopupElementTsx after terminating the session', async() => {
    vi.useFakeTimers()
    mocks.terminate.mockResolvedValue(true)
    const container = document.createElement('div')
    document.body.append(container)
    dispose = render(() => <NewAuthorization authorization={authorization} total={1} />, container)

    buttonByText(container, 'No, it’s not me!').click()
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)

    // `hash` на проводе — string | number, терминация адресует сессию числом
    expect(mocks.terminate).toHaveBeenCalledWith(42)
    expect(mocks.createPopupTsx).toHaveBeenCalledOnce()
  })

  it('explains why a fresh session cannot deny another authorization', async() => {
    mocks.terminate.mockRejectedValue({ type: 'FRESH_RESET_AUTHORISATION_FORBIDDEN' })
    const container = document.createElement('div')
    document.body.append(container)
    dispose = render(() => <NewAuthorization authorization={authorization} total={1} />, container)

    buttonByText(container, 'No, it’s not me!').click()
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.toastNew).toHaveBeenCalledWith({
      langPackKey: 'RecentSessions.Error.FreshReset',
    })
    expect(mocks.createPopupTsx).not.toHaveBeenCalled()
  })

  it('explains why a fresh session cannot confirm another authorization', async() => {
    mocks.confirm.mockRejectedValue({ type: 'FRESH_CHANGE_AUTHORIZATION_FORBIDDEN' })
    const container = document.createElement('div')
    document.body.append(container)
    dispose = render(() => <NewAuthorization authorization={authorization} total={1} />, container)

    buttonByText(container, 'Yes, it’s me').click()
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.toastNew).toHaveBeenCalledWith({ langPackKey: 'RecentSessions.Error.FreshReset' })
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('a refused action (false from the server) is an error, not a success', async() => {
    mocks.confirm.mockResolvedValue(false)
    const container = document.createElement('div')
    document.body.append(container)
    dispose = render(() => <NewAuthorization authorization={authorization} total={1} />, container)

    buttonByText(container, 'Yes, it’s me').click()
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.toastNew).toHaveBeenCalledWith({ langPackKey: 'Error.AnError' })
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('the confirmation toast link opens the Devices tab with the fresh session list', async() => {
    mocks.confirm.mockResolvedValue(true)
    const sessions = [{ _: 'authorization', hash: 1 }]
    mocks.list.mockResolvedValue(sessions)
    const container = document.createElement('div')
    document.body.append(container)
    dispose = render(() => <NewAuthorization authorization={authorization} total={1} />, container)

    buttonByText(container, 'Yes, it’s me').click()
    await Promise.resolve()
    await Promise.resolve()
    const content = mocks.toast.mock.calls[0][0] as DocumentFragment
    expect(content.textContent).toContain('New Login Allowed')
    const link = content.querySelector('a')!
    expect(link.textContent).toBe('Settings > Devices')
    link.click()
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.createTab).toHaveBeenCalled()
    expect(mocks.open).toHaveBeenCalledWith({ authorizations: sessions })
  })
})

// ── Корень над списком чатов ─────────────────────────────────────────────────

describe('renderNewAuthorization', () => {
  let host: HTMLDivElement
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  beforeEach(() => {
    Element.prototype.animate = vi.fn(() => ({ finished: Promise.resolve() }) as unknown as Animation) as unknown as typeof Element.prototype.animate
    host = document.createElement('div')
    document.body.append(host)
  })

  afterEach(() => {
    delete (Element.prototype as { animate?: unknown }).animate
  })

  it('плашки нет, пока запросов нет; первый запрос — плашка и body.has-unconfirmed-authorization; ответили — уходит', async() => {
    dispose = renderNewAuthorization(host, managers)
    await flush()
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(document.body.classList.contains('has-unconfirmed-authorization')).toBe(false)

    rootScope.dispatchEventSingle('unconfirmed_authorizations_update', [
      { hash: 7, date: 5, device: 'Firefox, web', location: 'Berlin' },
      { hash: 8, date: 4, device: 'Safari, web', location: '' },
    ])
    await flush()

    const notice = host.querySelector<HTMLElement>('[role="alert"]')!
    expect(notice).toBeTruthy()
    expect(notice.textContent).toContain('1/2 Someone just got access')
    expect(notice.textContent).toContain('from Firefox, web, Berlin')
    expect(document.body.classList.contains('has-unconfirmed-authorization')).toBe(true)

    rootScope.dispatchEventSingle('unconfirmed_authorizations_update', [])
    await flush()
    await flush()

    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(document.body.classList.contains('has-unconfirmed-authorization')).toBe(false)
  })

  it('dispose снимает класс с body и корень', async() => {
    dispose = renderNewAuthorization(host, managers)
    rootScope.dispatchEventSingle('unconfirmed_authorizations_update', [
      { hash: 7, date: 5, device: 'Firefox, web', location: 'Berlin' },
    ])
    await flush()
    expect(document.body.classList.contains('has-unconfirmed-authorization')).toBe(true)

    dispose()
    dispose = undefined

    expect(document.body.classList.contains('has-unconfirmed-authorization')).toBe(false)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
})
