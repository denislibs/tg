/** @jsxImportSource solid-js */
// Плашка «новый вход» на своём месте — в оверлее владельца списка чатов
// (`lib/appDialogsManager.ts`, tweb `appDialogsManager.ts:1390-1394`): стартовое чтение
// запросов у владельца сессий, событие `unconfirmed_authorizations_update` рисует плашку,
// `destroy()` владельца снимает её вместе с `body.has-unconfirmed-authorization`.
// Тесты самого компонента — `newAuthorization.solid.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@components/toast', () => ({ toastNew: vi.fn(), toast: vi.fn(), hideToast: vi.fn() }))

import '@/test/lang'
import rootScope from '@lib/rootScope'
import { resetPeerMirror } from '@core/peerCache'
import {
  FakeResizeObserver, installFrames, mountOwner, resetStores, settle, uninstallFrames, type Mounted,
} from '@/lib/appDialogsManager.testkit'

let mounted: Mounted | undefined
const prompt = { hash: 7, date: 5, device: 'Firefox, web', location: 'Berlin' }

beforeEach(() => {
  resetStores()
  resetPeerMirror()
  expect(installFrames(), 'очередь fastRaf досталась этому файлу непрокрученной').toBe(true)
  FakeResizeObserver.instances = []
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  Element.prototype.animate = vi.fn(() => ({ finished: Promise.resolve() }) as unknown as Animation) as unknown as typeof Element.prototype.animate
})

afterEach(() => {
  mounted?.manager.destroy()
  mounted = undefined
  uninstallFrames()
  resetStores()
  resetPeerMirror()
  vi.unstubAllGlobals()
  delete (Element.prototype as { animate?: unknown }).animate
  document.body.className = ''
})

describe('плашка «новый вход» в оверлее владельца списка', () => {
  it('владелец читает запросы у менеджера сессий; событие воркера рисует плашку первой в .chatlist-overlay', async () => {
    mounted = mountOwner()
    await settle()
    expect(mounted.hooks.managers.sessions.getUnconfirmedAuthorizations).toHaveBeenCalledTimes(1)
    const overlay = mounted.host.querySelector<HTMLElement>(':scope > .chatlist-overlay')!
    const container = overlay.firstElementChild as HTMLElement
    expect(container.querySelector('[role="alert"]')).toBeNull()

    rootScope.dispatchEventSingle('unconfirmed_authorizations_update', [prompt])
    await settle()

    const notice = container.querySelector<HTMLElement>('[role="alert"]')!
    expect(notice).toBeTruthy()
    expect(notice.textContent).toContain('Someone just got access to your messages!')
    expect(notice.textContent).toContain('from Firefox, web, Berlin')
    expect(document.body.classList.contains('has-unconfirmed-authorization')).toBe(true)
  })

  it('destroy() владельца снимает плашку и body.has-unconfirmed-authorization', async () => {
    mounted = mountOwner()
    await settle()
    rootScope.dispatchEventSingle('unconfirmed_authorizations_update', [prompt])
    await settle()
    expect(document.body.classList.contains('has-unconfirmed-authorization')).toBe(true)

    mounted.manager.destroy()
    mounted = undefined

    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(document.body.classList.contains('has-unconfirmed-authorization')).toBe(false)
  })
})
