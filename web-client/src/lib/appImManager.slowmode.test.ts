// Ф7-И1 (MC-08): `message_error` с `SLOWMODE_WAIT_<N>` открывает попап «Медленный
// режим» с остатком (tweb `appImManager.ts:551-565`). Другие причины отказа попапа не
// открывают.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import mediaSizes, { ScreenSize } from '@core/dom/mediaSizes'
import type { Managers } from '@/client/bootstrap'
import rootScope from '@lib/rootScope'
import { RT } from '@core/realtime/events'
import { AppImManager } from './appImManager'

const columnRight = vi.hoisted(() => ({ sidebarEl: undefined as HTMLElement | undefined, toggleSidebar: () => Promise.resolve(), hide: () => {}, replaceSharedMediaTab: () => {} }))
vi.mock('@components/chatTips/index.solid', () => ({ renderChatTips: vi.fn() }))
vi.mock('@components/sidebarRight', () => ({ default: columnRight, RIGHT_COLUMN_ACTIVE_CLASSNAME: 'is-right-column-shown' }))
vi.mock('@components/chat/bubbles/chatBackground.solid', () => ({
  default: { setBackground: () => Promise.resolve(), getReadyPromise: () => Promise.resolve() },
}))

const popup = vi.hoisted(() => ({ confirmationPopup: vi.fn(() => Promise.resolve()) }))
vi.mock('@components/popups/popupPeer', async(importOriginal) => ({ ...(await importOriginal<object>()), confirmationPopup: popup.confirmationPopup }))
vi.mock('@components/wrappers/wrapDuration', () => ({ wrapSlowModeLeftDuration: (n: number) => `left:${n}` }))

type FakeAppImManager = { isSamePeer(a: object, b: object): boolean, dispatchEvent(name: string, chat: object): void }
const canSend = vi.hoisted(() => ({ value: true }))
const FakeChat = vi.hoisted(() => class {
  public container = document.createElement('div')
  public peerId = 0
  public type = 'chat'
  public inited?: boolean
  public input = { willAttachType: undefined as 'media' | 'document' | undefined }
  constructor(public appImManager: FakeAppImManager) {
    this.container.classList.add('chat', 'tabs-tab')
  }

  public canSend() {
    return Promise.resolve(canSend.value)
  }

  public async setPeer(options: { peerId?: number }) {
    this.appImManager.dispatchEvent('peer_changing', this)
    this.peerId = options.peerId || 0
    this.inited = true
    this.appImManager.dispatchEvent('peer_changed', this)
    return { cached: true, promise: Promise.resolve() }
  }

  public publishBackground() {
    return Promise.resolve()
  }

  public beforeDestroy() {}
  public destroy() {}
})
vi.mock('@components/chat/chat', () => ({ default: FakeChat }))

const managers = {
  peers: { getPeers: async() => [], fillMirror: async() => {}, resolveUsername: vi.fn() },
  presence: { get: async() => [] },
  dialogs: { hasDialog: async() => true, refresh: async() => null },
} as unknown as Managers

beforeAll(() => {
  mediaSizes.isMobile = false
  mediaSizes.isFloatingLeftSidebar = false
  mediaSizes.activeScreen = ScreenSize.large
  const left = document.getElementById('column-left')!
  const center = document.getElementById('column-center')!
  const right = document.getElementById('column-right')!
  document.body.append(left, center, right)
  columnRight.sidebarEl = right
  new AppImManager().construct(managers)
})

beforeEach(() => popup.confirmationPopup.mockClear())

describe('message_error: медленный режим', () => {
  it('SLOWMODE_WAIT_30 для пира — попап Slowmode/SlowModeHint с остатком и аватаром пира', () => {
    rootScope.dispatchEvent(RT.messageError, { client_msg_id: 'c1', reason: 'SLOWMODE_WAIT_30', peer_id: 77 })

    expect(popup.confirmationPopup).toHaveBeenCalledTimes(1)
    expect(popup.confirmationPopup).toHaveBeenCalledWith(expect.objectContaining({
      titleLangKey: 'Slowmode',
      descriptionLangKey: 'SlowModeHint',
      descriptionLangArgs: ['left:30'],
      button: { langKey: 'OK', isCancel: true },
      peerId: 77,
    }))
  })

  it('отказ без peer_id (старый сервер) — попап без аватара', () => {
    rootScope.dispatchEvent(RT.messageError, { client_msg_id: 'c1', reason: 'SLOWMODE_WAIT_5' })
    const arg = (popup.confirmationPopup.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(arg.peerId).toBeUndefined()
    expect(arg.descriptionLangArgs).toEqual(['left:5'])
  })

  it('прочие причины (too_long, BALANCE_TOO_LOW) попапа медленного режима не открывают', () => {
    for (const reason of ['too_long', 'BALANCE_TOO_LOW', 'ALLOW_PAYMENT_REQUIRED_5', 'failed']) {
      rootScope.dispatchEvent(RT.messageError, { client_msg_id: 'c1', reason, peer_id: 77 })
    }
    expect(popup.confirmationPopup).not.toHaveBeenCalled()
  })
})
