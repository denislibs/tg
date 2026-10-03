// Хоткеи левой колонки — порт tweb `sidebarLeft/index.ts:457-468` (пачка П-4):
// Ctrl/Alt/Cmd+F открывает глобальный поиск, Ctrl/Cmd+0 — «Избранное»; под попапом
// оба молчат, «Избранное» уже открыто — Ctrl+0 тоже молчит.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import appImManager from '@lib/appImManager'
import appNavigationController from '@core/navigation/appNavigationController'
import rootScope from '@lib/rootScope'
import { useChatsStore } from '@stores/chatsStore'
import type { Managers } from '@/client/bootstrap'
import { installSidebarLeft, type InstalledSidebarLeft } from '@/test/sidebarLeft'
import { applyLang } from '@/test/lang'
import type { AppDialogsManager } from '@lib/appDialogsManager'
import type Chat from '@components/chat/chat'

const MY_ID = 1
const saved = vi.fn(async() => MY_ID)
const managers = new Proxy({}, {
  get: (_, name) => name === 'chats' ?
    { saved } :
    new Proxy({}, { get: () => async() => undefined }),
}) as unknown as Managers

let installed: InstalledSidebarLeft
const open = vi.fn()
const setPeer = vi.spyOn(appImManager, 'setPeer').mockResolvedValue(true)
let currentPeerId = 0

beforeAll(async() => {
  await applyLang('en')
  useChatsStore.setState({ me: { user: { _: 'user', id: MY_ID, pFlags: {} } } } as never)
  rootScope.myId = MY_ID
  installed = installSidebarLeft(managers, undefined, { full: true })
  installed.sidebar.construct(managers, { xd: undefined } as unknown as AppDialogsManager)
  vi.spyOn(installed.sidebar, 'initSearch').mockReturnValue({ open, openWithPeerId: vi.fn(), close: vi.fn() })
  vi.spyOn(appImManager, 'chat', 'get').mockImplementation(() => ({ peerId: currentPeerId }) as Chat)
})

afterAll(() => {
  installed.destroy()
  vi.restoreAllMocks()
})

afterEach(() => {
  open.mockClear()
  setPeer.mockClear()
  saved.mockClear()
  currentPeerId = 0
  appNavigationController.spliceItems(0, Infinity)
})

const press = (init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  window.dispatchEvent(event)
  return event
}

describe('Ctrl+F — глобальный поиск (tweb :457-460)', () => {
  it('Ctrl+F, Alt+F, Cmd+F открывают поиск и гасят браузерный «найти»', () => {
    expect(press({ key: 'f', ctrlKey: true }).defaultPrevented).toBe(true)
    press({ key: 'f', altKey: true })
    press({ key: 'f', metaKey: true })
    expect(open).toHaveBeenCalledTimes(3)
  })

  it('под попапом — нет; голая F — нет', () => {
    appNavigationController.pushItem({ type: 'popup', onPop: () => {} })
    press({ key: 'f', ctrlKey: true })
    appNavigationController.spliceItems(0, Infinity)
    press({ key: 'f' })
    expect(open).not.toHaveBeenCalled()
  })
})

describe('Ctrl+0 — «Избранное» (tweb :462-468)', () => {
  it('Ctrl+0 и Cmd+0 открывают «Избранное» путём пункта бургера (расхождение 9)', async() => {
    press({ key: '0', ctrlKey: true })
    await vi.waitFor(() => expect(setPeer).toHaveBeenCalledWith({ peerId: MY_ID }))
    expect(saved).toHaveBeenCalledTimes(1)

    press({ key: '0', metaKey: true })
    await vi.waitFor(() => expect(setPeer).toHaveBeenCalledTimes(2))
  })

  it('под попапом и когда «Избранное» уже открыто — нет', async() => {
    appNavigationController.pushItem({ type: 'popup', onPop: () => {} })
    press({ key: '0', ctrlKey: true })
    appNavigationController.spliceItems(0, Infinity)

    currentPeerId = MY_ID
    press({ key: '0', ctrlKey: true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(saved).not.toHaveBeenCalled()
    expect(setPeer).not.toHaveBeenCalled()
  })
})
