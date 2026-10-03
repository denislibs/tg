// Блок F `AppImManager` (порт tweb `appImManager.ts:1703-1895`, пачка П-4): хоткеи
// (`attachKeydownListener`), защита копирования (`attachCopyListener`), ориентиры экранного
// доступа (`attachSkipToContent`/`setStaticLandmarkLabels`, `:349-352`, `:3199-3201`) и
// Esc, который закрывает чат записью `im` контроллера навигации. Класс — настоящий и один
// на файл (обработчики висят на `document.body`, как у tweb, — второй экземпляр продублировал
// бы их), инстанс чата — дублёр `Chat` с членами, которые читает блок F.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import pause from '@helpers/schedulers/pause'
import overlayCounter from '@helpers/overlayCounter'
import mediaSizes, { ScreenSize } from '@core/dom/mediaSizes'
import appNavigationController, { type NavigationItem } from '@core/navigation/appNavigationController'
import rootScope from '@lib/rootScope'
import type { Managers } from '@/client/bootstrap'
import { returnToStaticMarkup } from '@/test/staticMarkup'
import { applyLang } from '@/test/lang'
import { AppImManager } from './appImManager'

const columnRight = vi.hoisted(() => ({ sidebarEl: undefined as HTMLElement | undefined, toggleSidebar: () => Promise.resolve(), hide: () => {}, replaceSharedMediaTab: () => {} }))
vi.mock('@components/sidebarRight', () => ({ default: columnRight, RIGHT_COLUMN_ACTIVE_CLASSNAME: 'is-right-column-shown' }))
vi.mock('@components/chat/bubbles/chatBackground.solid', () => ({
  default: { setBackground: () => Promise.resolve(), getReadyPromise: () => Promise.resolve() },
}))
const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', async(importOriginal) => ({ ...(await importOriginal<object>()), toastNew }))
const chats = vi.hoisted(() => new Map<number, object>())
vi.mock('@core/peerCache', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  cachedChat: (peerId: number) => chats.get(peerId),
}))

// члены `Chat`, которые читает блок F: `input` (`ChatInput` К-4), `bubbles.scrollable.container`,
// `selection.isSelecting`, `type`
const parts = vi.hoisted(() => ({
  canSendPlain: true,
  isSelecting: false,
  passEventToInput: (() => {}) as (e: KeyboardEvent) => void,
}))
type FakeAppImManager = {
  isSamePeer(a: object, b: object): boolean
  dispatchEvent(name: string, chat: object): void
}
const FakeChat = vi.hoisted(() => class {
  public container = document.createElement('div')
  public peerId = 0
  public threadId?: number
  public type = 'chat'
  public inited?: boolean
  public sharedMediaTab = undefined
  public input?: object
  public bubbles?: { scrollable: { container: HTMLElement } }
  public selection = {
    get isSelecting() { return parts.isSelecting },
  }

  constructor(public appImManager: FakeAppImManager) {
    this.container.classList.add('chat', 'tabs-tab')
  }

  public async setPeer(options: { peerId?: number, type?: string }) {
    const { peerId, type = 'chat' } = options
    if(!peerId) this.inited = undefined
    else if(!this.inited) {
      this.inited = true
      const messageInput = document.createElement('div')
      messageInput.className = 'input-message-input'
      messageInput.contentEditable = 'true'
      const scrollContainer = document.createElement('div')
      scrollContainer.className = 'scrollable scrollable-y'
      scrollContainer.tabIndex = -1
      this.container.append(messageInput, scrollContainer)
      this.input = {
        messageInput,
        canSendPlain: () => parts.canSendPlain,
        passEventToInput: (e: KeyboardEvent) => parts.passEventToInput(e),
      }
      this.bubbles = { scrollable: { container: scrollContainer } }
    }

    if(!this.appImManager.isSamePeer(this, options)) {
      this.appImManager.dispatchEvent('peer_changing', this)
      this.peerId = peerId || 0
    }

    this.type = type
    this.appImManager.dispatchEvent('peer_changed', this)
    return peerId ? { cached: true, promise: Promise.resolve() } : undefined
  }

  public publishBackground() {
    return Promise.resolve()
  }

  public beforeDestroy() {}

  public destroy() {
    this.container.remove()
  }
})
vi.mock('@components/chat/chat', () => ({ default: FakeChat }))

const getNextDialog = vi.fn(async(_peerId: number, _next: boolean, _filterId: number): Promise<{ peerId: number } | undefined> => undefined)
const managers = {
  peers: { getPeers: async(ids: number[]) => ids.map((id) => ({ _: 'user', id, pFlags: {} })), fillMirror: async() => {}, resolveUsername: vi.fn() },
  presence: { get: async() => [] },
  dialogs: { hasDialog: async() => true, refresh: async() => null, getNextDialog },
  channels: { join: async() => {} },
} as unknown as Managers

const settle = () => pause(20)
const navTypes = () => (appNavigationController as unknown as { navigations: NavigationItem[] }).navigations.map((item) => item.type)

let im: AppImManager
const passEventToInput = vi.fn()

beforeAll(async() => {
  await applyLang('en')
  mediaSizes.isMobile = false
  mediaSizes.activeScreen = ScreenSize.large
  const left = document.getElementById('column-left')!
  const center = document.getElementById('column-center')!
  const right = document.getElementById('column-right')!
  document.body.append(left, center, right)
  columnRight.sidebarEl = right
  history.replaceState(null, '', location.pathname)
  im = new AppImManager()
  im.construct(managers)
  await im.setInnerPeer({ peerId: 1 })
  await settle()
})

afterAll(() => {
  appNavigationController.spliceItems(0, Infinity)
  ;['column-left', 'column-center', 'column-right'].forEach((id) => returnToStaticMarkup(document.getElementById(id)!))
  document.body.className = ''
})

beforeEach(() => {
  Object.assign(parts, { canSendPlain: true, isSelecting: false, passEventToInput })
  im.isShiftLockShortcut = false
})

afterEach(() => {
  passEventToInput.mockReset()
  getNextDialog.mockReset()
  toastNew.mockReset()
  document.getSelection()?.removeAllRanges()
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  document.querySelectorAll('.test-node').forEach((node) => node.remove())
})

/** Узел-цель в документе (не поле ввода и не кнопка). */
function node(tag = 'div') {
  const el = document.createElement(tag)
  el.className = 'test-node'
  document.body.append(el)
  return el
}

/** Настоящее нажатие: синтетические события блок F отбрасывает (`!e.isTrusted`, `:1711`). */
function press(init: KeyboardEventInit, target: EventTarget = node(), trusted = true) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  if(trusted) Object.defineProperty(event, 'isTrusted', { value: true })
  target.dispatchEvent(event)
  return event
}

const scrollContainer = () => (im.chat.bubbles as unknown as { scrollable: { container: HTMLElement } }).scrollable.container

describe('Alt+↑/↓ — соседний чат папки (tweb :1746-1757)', () => {
  it('Alt+↓ — следующий диалог папки владельца списка; событие погашено', async() => {
    getNextDialog.mockResolvedValueOnce({ peerId: 7 })
    const event = press({ key: 'ArrowDown', altKey: true })
    expect(event.defaultPrevented).toBe(true)
    expect(getNextDialog).toHaveBeenCalledWith(1, true, expect.any(Number))
    await settle()
    expect(im.chat.peerId).toBe(7)

    getNextDialog.mockResolvedValueOnce({ peerId: 1 })
    press({ key: 'ArrowUp', altKey: true })
    expect(getNextDialog).toHaveBeenLastCalledWith(7, false, expect.any(Number))
    await settle()
    expect(im.chat.peerId).toBe(1)
  })

  it('соседа нет — чат не меняется', async() => {
    press({ key: 'ArrowDown', altKey: true })
    await settle()
    expect(getNextDialog).toHaveBeenCalledTimes(1)
    expect(im.chat.peerId).toBe(1)
  })
})

describe('общие гейты (tweb :1706-1733)', () => {
  it('синтетическое событие, открытый попап, фокус на кнопке — блок F молчит', () => {
    press({ key: 'ArrowDown', altKey: true }, node(), false)
    overlayCounter.isOverlayActive = true
    press({ key: 'ArrowDown', altKey: true })
    overlayCounter.isOverlayActive = false
    press({ key: 'ArrowDown', altKey: true }, node('button'))
    expect(getNextDialog).not.toHaveBeenCalled()
  })

  it('чужое поле ввода клавиши не отдаёт', () => {
    press({ key: 'a' }, node('input'))
    press({ key: 'ArrowDown', altKey: true }, node('textarea'))
    expect(passEventToInput).not.toHaveBeenCalled()
    expect(getNextDialog).not.toHaveBeenCalled()
  })
})

describe('печать в любом месте → поле ввода (tweb :1835-1845)', () => {
  it('буква вне поля уходит в `passEventToInput`', () => {
    const event = press({ key: 'a' })
    expect(passEventToInput).toHaveBeenCalledWith(event)
  })

  // запись голоса (`chat.input.recording`) — расхождение 14 F2: записи у `ChatInput` нет (Б-30)
  it('не уходит: идёт выделение сообщений, Shift — часть сочетания блокировки', () => {
    parts.isSelecting = true
    press({ key: 'a' })
    parts.isSelecting = false
    im.isShiftLockShortcut = true
    press({ key: 'A', shiftKey: true })
    expect(passEventToInput).not.toHaveBeenCalled()
  })

  it('Ctrl+C вне поля — браузеру (копирование выделения)', () => {
    press({ key: 'c', code: 'KeyC', ctrlKey: true })
    press({ key: 'c', code: 'KeyC', metaKey: true })
    expect(passEventToInput).not.toHaveBeenCalled()
  })
})

describe('PageUp/PageDown и стрелки — прокрутка ленты (tweb :1739-1764)', () => {
  it('PageDown без модификаторов отдаёт фокус ленте; Ctrl+PageDown — полю ввода (к концу текста, tweb `input.ts:3187`)', () => {
    const ctrl = press({ key: 'PageDown', ctrlKey: true })
    expect(document.activeElement).not.toBe(scrollContainer())
    expect(passEventToInput).toHaveBeenCalledWith(ctrl)

    passEventToInput.mockClear()
    press({ key: 'PageDown' })
    expect(document.activeElement).toBe(scrollContainer())
    expect(passEventToInput).not.toHaveBeenCalled()
  })

  it('↑ там, где писать нельзя, — прокрутка ленты; где можно — клавиша гаснет (правка — Б-80)', () => {
    parts.canSendPlain = false
    press({ key: 'ArrowUp' })
    expect(document.activeElement).toBe(scrollContainer())

    scrollContainer().blur()
    parts.canSendPlain = true
    press({ key: 'ArrowUp' })
    press({ key: 'ArrowDown' })
    expect(document.activeElement).not.toBe(scrollContainer())
    expect(passEventToInput).not.toHaveBeenCalled()
  })
})

describe('защита копирования (tweb :1854-1895)', () => {
  function selectRestricted(peerId: number) {
    const bubble = node()
    bubble.classList.add('bubble')
    bubble.dataset.peerId = String(peerId)
    const message = document.createElement('div')
    message.className = 'message no-forwards'
    message.textContent = 'secret'
    bubble.append(message)
    const range = document.createRange()
    range.selectNodeContents(message)
    document.getSelection()!.addRange(range)
  }

  function copy() {
    const event = new Event('copy', { bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    return event
  }

  it('выделение в бабле `no-forwards` не копируется; тост — по типу пира', () => {
    selectRestricted(5)
    expect(copy().defaultPrevented).toBe(true)
    expect(toastNew).toHaveBeenLastCalledWith({ langPackKey: 'CopyRestricted.User' })

    document.getSelection()!.removeAllRanges()
    chats.set(-100, { _: 'channel', id: 100, pFlags: { broadcast: true } })
    selectRestricted(-100)
    copy()
    expect(toastNew).toHaveBeenLastCalledWith({ langPackKey: 'CopyRestricted.Channel' })

    document.getSelection()!.removeAllRanges()
    chats.set(-200, { _: 'channel', id: 200, pFlags: { megagroup: true } })
    selectRestricted(-200)
    copy()
    expect(toastNew).toHaveBeenLastCalledWith({ langPackKey: 'CopyRestricted.Group' })
  })

  it('обычный бабл копируется', () => {
    const bubble = node()
    bubble.className = 'test-node bubble'
    bubble.dataset.peerId = '5'
    bubble.textContent = 'open'
    const range = document.createRange()
    range.selectNodeContents(bubble)
    document.getSelection()!.addRange(range)
    expect(copy().defaultPrevented).toBe(false)
    expect(toastNew).not.toHaveBeenCalled()
  })
})

describe('ориентиры экранного доступа (tweb :349-352, :3199-3201, appLandmarks.ts)', () => {
  it('ссылка «пропустить к чату» названа и показана; клик ведёт фокус в центр, хэш не трогает', () => {
    const link = document.getElementById('skip-to-content')!
    expect(link.hidden).toBe(false)
    expect(link.textContent).toBe('Skip to conversation')

    const hash = location.hash
    link.click()
    expect(document.activeElement).toBe(document.getElementById('column-center'))
    expect(location.hash).toBe(hash)
  })

  it('колонки названы и переименовываются на `language_apply` (расхождение 2)', () => {
    const left = document.getElementById('column-left')!
    const right = document.getElementById('column-right')!
    expect(left.getAttribute('aria-label')).toBe('Chat list')
    expect(right.getAttribute('aria-label')).toBe('Chat info')

    left.removeAttribute('aria-label')
    rootScope.dispatchEventSingle('language_apply')
    expect(left.getAttribute('aria-label')).toBe('Chat list')
  })
})

describe('Esc (tweb `appNavigationController.ts:217-224`)', () => {
  it('открытый чат закрывается записью `im`', async() => {
    expect(navTypes()).toContain('im')
    press({ key: 'Escape' }, window)
    await settle()
    expect(navTypes()).not.toContain('im')
    expect(im.chat.peerId).toBe(0)
  })
})
