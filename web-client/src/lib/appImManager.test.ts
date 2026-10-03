// Ядро `AppImManager` (порт tweb `src/lib/appImManager.ts`, шаги К-2, К-3): колонки
// (`selectTab`), стек инстансов чата (`setPeer`/`setInnerPeer`/`spliceChats`), разбор
// хэша (`onHashChange`) и позиция ленты (`saveChatPosition`/`getChatSavedPosition`).
// Класс — настоящий, свой экземпляр на тест; соседи-синглтоны колонок и фон — дублёры
// (их предмет — свои тесты), инстанс чата — дублёр `Chat` (`components/chat/chat.ts`,
// его предмет — `chat.test.ts`) с тем же контрактом смены пира: класс проверяется по
// своему DOM (`.chats-container`, контейнеры инстансов) и записям
// `appNavigationController`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import pause from '@helpers/schedulers/pause'
import mediaSizes, { ScreenSize } from '@core/dom/mediaSizes'
import appNavigationController, { type NavigationItem } from '@core/navigation/appNavigationController'
import { ChatType } from '@components/chat/chatType'
import { generateMessageId } from '@core/history/messageId'
import type { Managers } from '@/client/bootstrap'
import { returnToStaticMarkup } from '@/test/staticMarkup'
import { APP_TABS, AppImManager, LEFT_COLUMN_ACTIVE_CLASSNAME } from './appImManager'

const columnRight = vi.hoisted(() => ({ sidebarEl: undefined as HTMLElement | undefined, toggleSidebar: () => Promise.resolve(), hide: () => {}, replaceSharedMediaTab: () => {} }))
vi.mock('@components/sidebarRight', () => ({ default: columnRight, RIGHT_COLUMN_ACTIVE_CLASSNAME: 'is-right-column-shown' }))
vi.mock('@components/chat/bubbles/chatBackground.solid', () => ({
  default: { setBackground: () => Promise.resolve(), getReadyPromise: () => Promise.resolve() },
}))
// дублёр `Chat` (tweb `chat.ts:1035-1156` в объёме, который читает `AppImManager`):
// `inited`, `peer_changing` до смены пира, `peer_changed` после, `.fake-chat` — «окно»
type FakeAppImManager = {
  isSamePeer(a: object, b: object): boolean
  dispatchEvent(name: string, chat: object): void
}
const FakeChat = vi.hoisted(() => class {
  public container = document.createElement('div')
  public peerId = 0
  public threadId?: number
  public monoforumThreadId?: number
  public type = 'chat'
  public inited?: boolean
  public sharedMediaTab = undefined
  public bubbles = undefined
  constructor(public appImManager: FakeAppImManager) {
    this.container.classList.add('chat', 'tabs-tab')
  }

  public async setPeer(options: { peerId?: number, threadId?: number, monoforumThreadId?: number, type?: string }) {
    const { peerId, threadId, monoforumThreadId, type = 'chat' } = options
    if(!peerId) this.inited = undefined
    else if(!this.inited) this.inited = true
    if(!this.appImManager.isSamePeer(this, options)) {
      this.appImManager.dispatchEvent('peer_changing', this)
      this.peerId = peerId || 0
      this.threadId = threadId
      this.monoforumThreadId = monoforumThreadId
    }

    if(!peerId) {
      this.container.replaceChildren()
      this.appImManager.dispatchEvent('peer_changed', this)
      return
    }

    this.type = type
    const fake = document.createElement('div')
    fake.className = 'fake-chat'
    fake.dataset.peerId = String(peerId)
    this.container.replaceChildren(fake)
    this.appImManager.dispatchEvent('peer_changed', this)
    return { cached: true, promise: Promise.resolve() }
  }

  public publishBackground() {
    return Promise.resolve()
  }

  public beforeDestroy() {}

  public destroy() {
    this.container.replaceChildren()
    this.container.remove()
  }
})
vi.mock('@components/chat/chat', () => ({ default: FakeChat }))

const getPeers = vi.fn(async(ids: PeerId[]) => ids.map((id) => ({ _: 'user', id, pFlags: {} })))
const managers = {
  peers: { getPeers, fillMirror: async() => {}, resolveUsername: vi.fn() },
  presence: { get: async() => [] },
  dialogs: { hasDialog: async() => true, refresh: async() => null },
  channels: { join: async() => {} },
  messages: { getDiscussionMessage: vi.fn() },
} as unknown as Managers

let im: AppImManager

/** Дождаться `setPeer` целиком: динамический импорт острова и два `setTimeout(0)` (`:3366-3378`). */
const settle = () => pause(20)

/** Статичные колонки `index.html` (`test/staticMarkup.ts`) — в `body` на время теста. */
function mountColumns() {
  const left = document.getElementById('column-left')!
  const center = document.getElementById('column-center')!
  const right = document.getElementById('column-right')!
  center.replaceChildren()
  left.inert = center.inert = false
  document.body.append(left, center, right)
  columnRight.sidebarEl = right
  return { left, center }
}

beforeEach(() => {
  mediaSizes.isMobile = false
  mediaSizes.isFloatingLeftSidebar = false
  mediaSizes.activeScreen = ScreenSize.large
  history.replaceState(null, '', location.pathname)
})

afterEach(() => {
  appNavigationController.spliceItems(0, Infinity)
  ;['column-left', 'column-center', 'column-right'].forEach((id) => returnToStaticMarkup(document.getElementById(id)!))
  document.body.replaceChildren()
  document.body.className = ''
  vi.restoreAllMocks()
})

function construct() {
  const dom = mountColumns()
  im = new AppImManager()
  im.construct(managers)
  return dom
}

/** Записи контроллера навигации снизу вверх — его стек приватный, читаем как есть. */
const navTypes = () => (appNavigationController as unknown as { navigations: NavigationItem[] }).navigations.map((item) => item.type)

describe('selectTab (tweb :3137-3197)', () => {
  it('класс на body следует за вкладкой; переход к чату заводит одну запись `im`', () => {
    construct()
    expect(document.body.classList.contains(LEFT_COLUMN_ACTIVE_CLASSNAME)).toBe(true)
    expect(navTypes()).toEqual([])

    void im.selectTab(APP_TABS.CHAT)
    expect(document.body.classList.contains(LEFT_COLUMN_ACTIVE_CLASSNAME)).toBe(false)
    expect(navTypes()).toEqual(['im'])

    // профиль поверх открытого чата второй записи `im` не заводит (`!findItemByType('im')`)
    void im.selectTab(APP_TABS.PROFILE)
    void im.selectTab(APP_TABS.CHAT)
    expect(navTypes()).toEqual(['im'])
  })

  it('на мобильном невидимая колонка — `inert`', () => {
    const { left, center } = construct()
    mediaSizes.isMobile = true
    mediaSizes.activeScreen = ScreenSize.mobile

    void im.selectTab(APP_TABS.CHAT)
    expect(left.inert).toBe(true)
    expect(center.inert).toBe(false)

    void im.selectTab(APP_TABS.CHATLIST)
    expect(left.inert).toBe(false)
    expect(center.inert).toBe(true)
  })
})

describe('стек чатов (tweb :3219-3434)', () => {
  it('`chats[0]` есть всегда: `.chats-container` с одним неактивированным инстансом', () => {
    const { center } = construct()
    const container = center.querySelector(':scope > .chats-container.tabs-container[data-animation="navigation"]')!
    expect(container).not.toBeNull()
    expect(im.chats).toHaveLength(1)
    expect(container.children[0]).toBe(im.chat.container)
    expect(im.chat.container.classList.contains('active')).toBe(true)
    expect(im.chat.inited).toBeUndefined()
  })

  it('первый пир — тот же инстанс; `setInnerPeer` поверх инициализированного — новый инстанс и запись `chat`', async() => {
    construct()
    const first = im.chat

    await im.setInnerPeer({ peerId: 1 })
    await settle()
    expect(im.chats).toEqual([first])
    expect(first.peerId).toBe(1)
    expect(first.container.querySelector('.fake-chat')?.getAttribute('data-peer-id')).toBe('1')
    expect(document.body.classList.contains(LEFT_COLUMN_ACTIVE_CLASSNAME)).toBe(false)

    await im.setInnerPeer({ peerId: 1, threadId: 10, type: ChatType.Discussion })
    await settle()
    expect(im.chats).toHaveLength(2)
    expect(im.chat).not.toBe(first)
    expect(im.chat.container.classList.contains('active')).toBe(true)
    expect(first.container.classList.contains('active')).toBe(false)
    expect(navTypes()).toEqual(['im', 'chat'])
  })

  it('`openScheduled` (tweb :3436-3441) — лента отложенных того же пира поверх чата: новый инстанс `Scheduled`', async() => {
    construct()
    await im.setInnerPeer({ peerId: 1 })
    await settle()
    const root = im.chat

    im.openScheduled(1)
    await settle()
    expect(im.chats).toHaveLength(2)
    expect(im.chat).not.toBe(root)
    expect(im.chat.type).toBe(ChatType.Scheduled)
    expect(im.chat.peerId).toBe(1)
    expect(navTypes()).toEqual(['im', 'chat'])
  })

  it('`existingIndex`: тот же пир ниже по стеку — срез до него, инстанс переиспользуется', async() => {
    construct()
    await im.setInnerPeer({ peerId: 1 })
    await settle()
    const root = im.chat
    await im.setInnerPeer({ peerId: 1, threadId: 10, type: ChatType.Discussion })
    await settle()

    await im.setInnerPeer({ peerId: 1 })
    await settle()
    expect(im.chats).toEqual([root])
  })

  it('уход к пиру дна с глубины 3 — `spliceChats`: `removeByType(chat)` × (N−1), через 350 мс контейнеров и корней нет', async() => {
    construct()
    await im.setInnerPeer({ peerId: 1 })
    await settle()
    await im.setInnerPeer({ peerId: 1, threadId: 10, type: ChatType.Discussion })
    await settle()
    await im.setInnerPeer({ peerId: 1, threadId: 20, type: ChatType.Discussion })
    await settle()
    expect(im.chats).toHaveLength(3)
    const spliced = im.chats.slice(1)
    const removeByType = vi.spyOn(appNavigationController, 'removeByType')

    await im.setPeer({ peerId: 1 })
    expect(im.chats).toHaveLength(1)
    expect(removeByType.mock.calls.filter(([type, single]) => type === 'chat' && single === true)).toHaveLength(spliced.length - 1)

    await pause(350 + 20)
    spliced.forEach((chat) => {
      expect(chat.container.isConnected).toBe(false)
      expect(chat.container.childElementCount).toBe(0)
    })
  })

  it('`setPeer({})` на глубине > 0 снимает только верхний уровень', async() => {
    construct()
    await im.setInnerPeer({ peerId: 1 })
    await settle()
    const root = im.chat
    await im.setInnerPeer({ peerId: 1, threadId: 10, type: ChatType.Discussion })
    await settle()

    await im.setPeer({})
    expect(im.chats).toEqual([root])
    expect(root.peerId).toBe(1)
  })

  it('мобильный `setPeer({})` инстанс не трогает — только вкладка списка', async() => {
    construct()
    mediaSizes.isMobile = true
    mediaSizes.activeScreen = ScreenSize.mobile
    await im.setInnerPeer({ peerId: 1 })
    await settle()
    const chat = im.chat
    const fake = chat.container.querySelector('.fake-chat')

    await im.setPeer({})
    expect(im.chat).toBe(chat)
    expect(chat.peerId).toBe(1)
    expect(chat.container.querySelector('.fake-chat')).toBe(fake)
    expect(document.body.classList.contains(LEFT_COLUMN_ACTIVE_CLASSNAME)).toBe(true)
  })

  it('десктопный `setPeer({})` очищает инстанс и возвращает список', async() => {
    construct()
    await im.setInnerPeer({ peerId: 1 })
    await settle()

    await im.setPeer({})
    expect(im.chat.peerId).toBe(0)
    expect(im.chat.container.querySelector('.fake-chat')).toBeNull()
    expect(document.body.classList.contains(LEFT_COLUMN_ACTIVE_CLASSNAME)).toBe(true)
  })
})

describe('хэш (tweb :1912-2031)', () => {
  const withHash = (hash: string) => {
    history.replaceState(null, '', location.pathname + hash)
  }

  it('`#@имя` — `openUsername`', () => {
    withHash('#@durov')
    const openUsername = vi.spyOn(AppImManager.prototype, 'openUsername').mockResolvedValue(undefined)
    construct()
    expect(openUsername).toHaveBeenCalledWith({ userName: '@durov', lastMsgId: undefined, threadId: undefined })
  })

  it('`#<peerId>` — пир из владельца карточек и `setInnerPeer`', async() => {
    withHash('#42')
    const setInnerPeer = vi.spyOn(AppImManager.prototype, 'setInnerPeer').mockResolvedValue(undefined)
    construct()
    await settle()
    expect(getPeers).toHaveBeenCalledWith([42])
    expect(setInnerPeer).toHaveBeenCalledWith({ peerId: 42 })
  })

  it('`#/im?p=@имя&post=N` — `openUsername` с номером сообщения', () => {
    withHash('#/im?p=@durov&post=5')
    const openUsername = vi.spyOn(AppImManager.prototype, 'openUsername').mockResolvedValue(undefined)
    construct()
    expect(openUsername).toHaveBeenCalledWith({ userName: '@durov', lastMsgId: 5, threadId: undefined })
  })

  it('`#@имя?post=N` (кнопка публичной страницы, PR #380): `op` переводит серверный номер в клиентский (tweb :2084-2096)', async() => {
    withHash('#@lenta_news?post=30')
    ;(managers.peers as unknown as { resolveUsername: ReturnType<typeof vi.fn> }).resolveUsername
      .mockResolvedValueOnce({ _: 'channel', id: 1, username: 'lenta_news', pFlags: {} })
    const setInnerPeer = vi.spyOn(AppImManager.prototype, 'setInnerPeer').mockResolvedValue(undefined)
    construct()
    await settle()
    expect(setInnerPeer).toHaveBeenCalledWith(expect.objectContaining({ peerId: -1, lastMsgId: generateMessageId(30) }))
  })

  it('`#column-center` (якорь страницы) ничего не открывает', async() => {
    withHash('#column-center')
    const openUsername = vi.spyOn(AppImManager.prototype, 'openUsername')
    const setInnerPeer = vi.spyOn(AppImManager.prototype, 'setInnerPeer')
    construct()
    await settle()
    expect(openUsername).not.toHaveBeenCalled()
    expect(setInnerPeer).not.toHaveBeenCalled()
    expect(getPeers).not.toHaveBeenCalledWith([NaN])
  })

  it('смена хэша после старта доходит через `appNavigationController.onHashChange`', () => {
    construct()
    const openUsername = vi.spyOn(im, 'openUsername').mockResolvedValue(undefined)
    withHash('#@telegram')
    appNavigationController.onHashChange?.()
    expect(openUsername).toHaveBeenCalledWith({ userName: '@telegram', lastMsgId: undefined, threadId: undefined })
  })

  it('открытый чат пишет свой пир в хэш (`peer_changed` → `overrideHash`)', async() => {
    construct()
    const overrideHash = vi.spyOn(appNavigationController, 'overrideHash')
    await im.setInnerPeer({ peerId: 77 })
    await settle()
    expect(overrideHash).toHaveBeenCalledWith('77')
  })
})

describe('тред комментариев адресуется номером зеркала (Б-110)', () => {
  const GROUP = -900
  const MIRROR = 50

  it('`op({commentId})` — `openComment` (tweb :2208-2224): `getDiscussionMessage(канал, пост)` → тред группы по номеру зеркала', async() => {
    const getDiscussionMessage = (managers.messages as unknown as { getDiscussionMessage: ReturnType<typeof vi.fn> }).getDiscussionMessage
    getDiscussionMessage.mockResolvedValueOnce({ _: 'message', peerId: GROUP, id: generateMessageId(MIRROR) })
    const setInnerPeer = vi.spyOn(AppImManager.prototype, 'setInnerPeer').mockResolvedValue(undefined)
    construct()
    await im.op({ peer: { _: 'channel', id: 1, pFlags: {} } as never, lastMsgId: 30, commentId: 7 })
    expect(getDiscussionMessage).toHaveBeenCalledWith(-1, generateMessageId(30))
    expect(setInnerPeer).toHaveBeenCalledWith({
      peerId: GROUP, lastMsgId: generateMessageId(7), threadId: generateMessageId(MIRROR), type: ChatType.Discussion,
    })
  })

  it('ссылка на тред группы (`?thread=` номер зеркала) — то же окно, что клик по футеру поста', async() => {
    const setInnerPeer = vi.spyOn(AppImManager.prototype, 'setInnerPeer').mockResolvedValue(undefined)
    construct()
    await im.op({ peer: { _: 'channel', id: 900, pFlags: { megagroup: true } } as never, threadId: MIRROR })
    expect(setInnerPeer).toHaveBeenCalledWith(expect.objectContaining({
      peerId: GROUP, threadId: generateMessageId(MIRROR), type: ChatType.Discussion,
    }))
  })
})

describe('позиция ленты (tweb :479-486, :2640-2688)', () => {
  /** Лента в том состоянии, которое читает `saveChatPosition`. */
  const bubblesAt = ({ distanceToEnd, loadedBottom = true, rendered = 30, invisibleBottom = 5, savedReaction }: {
    distanceToEnd: number, loadedBottom?: boolean, rendered?: number, invisibleBottom?: number, savedReaction?: string
  }) => ({
    scrollable: { getDistanceToEnd: () => distanceToEnd, loadedAll: { bottom: loadedBottom }, scrollPosition: 420 },
    getRenderedLength: () => rendered,
    getViewportSlice: () => ({ invisibleBottom: { length: invisibleBottom } }),
    sliceViewport: vi.fn(),
    getRenderedHistory: () => ['1_9', '1_8', '1_7'],
    savedReaction,
  })

  it('смена пира на том же инстансе (`peer_changing`) сохраняет окно', async() => {
    construct()
    await im.setInnerPeer({ peerId: 1 })
    await settle()
    const chat = im.chat as unknown as { bubbles: ReturnType<typeof bubblesAt> }
    chat.bubbles = bubblesAt({ distanceToEnd: 500 })

    await im.setPeer({ peerId: 2 })
    await settle()
    expect(chat.bubbles.sliceViewport).toHaveBeenCalledWith(true)
    expect(im.getChatSavedPosition({ peerId: 1, type: ChatType.Chat } as never)).toEqual({ mids: [9, 8, 7], top: 420 })
  })

  it('чат оставлен у низа — прошлая запись удаляется', async() => {
    construct()
    await im.setInnerPeer({ peerId: 1 })
    await settle()
    const chat = im.chat as unknown as { bubbles: ReturnType<typeof bubblesAt> }
    chat.bubbles = bubblesAt({ distanceToEnd: 500 })
    await im.setPeer({ peerId: 2 })
    await settle()
    await im.setPeer({ peerId: 1 })
    await settle()
    chat.bubbles = bubblesAt({ distanceToEnd: 0 })

    await im.setPeer({ peerId: 2 })
    await settle()
    expect(im.getChatSavedPosition({ peerId: 1, type: ChatType.Chat } as never)).toBeUndefined()
  })

  it('под фильтром тега «Избранного» позиция не сохраняется (:2125)', async() => {
    construct()
    await im.setInnerPeer({ peerId: 1 })
    await settle()
    const chat = im.chat as unknown as { bubbles: ReturnType<typeof bubblesAt> }
    chat.bubbles = bubblesAt({ distanceToEnd: 500, savedReaction: '👍' })

    await im.setPeer({ peerId: 2 })
    await settle()
    expect(im.getChatSavedPosition({ peerId: 1, type: ChatType.Chat } as never)).toBeUndefined()
  })

  it('ключ — пир и тред; отложенные и поиск позиции не имеют (:2641-2643)', () => {
    construct()
    const at = { peerId: 1, threadId: 10, type: ChatType.Discussion, bubbles: bubblesAt({ distanceToEnd: 500 }) }
    im.saveChatPosition(at as never)
    expect(im.getChatSavedPosition({ peerId: 1, threadId: 10, type: ChatType.Discussion } as never)).toEqual({ mids: [9, 8, 7], top: 420 })
    expect(im.getChatSavedPosition({ peerId: 1, type: ChatType.Chat } as never)).toBeUndefined()

    im.saveChatPosition({ peerId: 3, type: ChatType.Scheduled, bubbles: bubblesAt({ distanceToEnd: 500 }) } as never)
    expect(im.getChatSavedPosition({ peerId: 3, type: ChatType.Chat } as never)).toBeUndefined()
  })
})
