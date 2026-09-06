// Тач-путь `attachTo` (tweb contextMenu.ts:249-315): долгое нажатие по чипу
// реакции и отсев чипа из обычного тапа.
//
// Отдельный файл, потому что `IS_TOUCH_SUPPORTED` читается на загрузке модулей
// (от него зависит и `CLICK_EVENT_NAME`: на таче «клик» — это `mousedown`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@environment/touchSupport', () => ({ default: true }))

import ChatContextMenu, {
  type ContextMenuChat,
  type ContextMenuManagers,
  type ContextMenuPopups,
} from './contextMenu'
import ChatSelection, { type SelectionBubbles } from './selection'
import contextMenuController from '@helpers/contextMenuController'
import { putMirrorPage, resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import type { MyMessage } from '@core/models'

const PEER = 5
const KEY = 'win'
/** `attachContextMenuListener` держит нажатие 400 мс (`.4e3`). */
const LONG_PRESS = 460

function message(id: number): MyMessage {
  return {
    _: 'message',
    id,
    pFlags: {},
    peerId: PEER,
    fromId: PEER,
    peer_id: { _: 'peerUser', user_id: PEER },
    date: 1700000000 + id,
    message: `text ${id}`,
  } as MyMessage
}

/** Разметка ленты с чипом реакции (`chat/reactions.ts:469, :750`). */
function makeBubble(mid: number) {
  const bubble = document.createElement('div')
  bubble.classList.add('bubble', 'is-in')
  bubble.dataset.mid = String(mid)
  bubble.dataset.peerId = String(PEER)

  const wrapper = document.createElement('div')
  wrapper.classList.add('bubble-content-wrapper')
  const content = document.createElement('div')
  content.classList.add('bubble-content')

  const reactions = document.createElement('div')
  reactions.classList.add('reactions', 'reactions-block', 'reactions-like-block')
  const chip = document.createElement('div')
  chip.classList.add('reaction', 'reaction-block', 'reaction-like-block')
  chip.dataset.reaction = '👍'
  reactions.append(chip)

  content.append(reactions)
  wrapper.append(content)
  bubble.append(wrapper)
  return { bubble, content, chip }
}

/** Тот же двойник ленты, что в `contextMenu.test.ts`: режиму выделения нужен
 *  доступ к отрисованным баблам. */
class FakeBubbles implements SelectionBubbles {
  constructor(public inner: HTMLElement) {}

  getRenderedHistory(sort: 'asc' | 'desc'): string[] {
    const mids = Array.from(this.inner.querySelectorAll<HTMLElement>('.bubble'))
      .map((bubble) => `${bubble.dataset.peerId}_${bubble.dataset.mid}`)
    return sort === 'asc' ? mids : mids.reverse()
  }

  getBubble(fullMid: string): HTMLElement | undefined {
    const mid = fullMid.slice(fullMid.indexOf('_') + 1)
    return this.inner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`) ?? undefined
  }

  getBubbleGroupedItems(bubble: HTMLElement): HTMLElement[] {
    return Array.from(bubble.querySelectorAll<HTMLElement>('.grouped-item'))
  }

  async getMountedBubble(fullMid: string) {
    const bubble = this.getBubble(fullMid)
    return bubble ? { bubble } : undefined
  }
}

function makeManagers(): ContextMenuManagers {
  return {
    messages: {
      votePoll: vi.fn().mockResolvedValue(undefined),
      closePoll: vi.fn().mockResolvedValue(undefined),
      viewers: vi.fn().mockResolvedValue([]),
    },
    chats: { getReadDate: vi.fn().mockResolvedValue(null) },
    media: { downloadToDisc: vi.fn() },
  }
}

function makePopups(): ContextMenuPopups {
  return {
    showPinMessage: vi.fn(),
    showDeleteMessages: vi.fn(),
    showForward: vi.fn(),
    showMessageReport: vi.fn(),
    showReactedList: vi.fn(),
    showStatistics: vi.fn(),
    showFactCheckEditor: vi.fn(),
  }
}

function makeChat(): ContextMenuChat {
  return {
    peerId: PEER,
    messagesStorageKey: KEY,
    canSend: () => true,
    hasMessageInput: () => true,
    initMessageReply: vi.fn(),
    initMessageEditing: vi.fn(),
    initSearch: vi.fn(),
  }
}

/** jsdom не умеет конструировать `TouchEvent` — важны только поля, которые
 *  читают `attachContextMenuListener` (`touches`) и `onContextMenu`
 *  (`target`, `changedTouches`). */
function touch(type: string, target: HTMLElement) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  const point = { clientX: 10, clientY: 10, pageX: 10, pageY: 10 }
  Object.assign(e, { touches: type === 'touchstart' ? [point] : [], changedTouches: [point] })
  target.dispatchEvent(e)
  return e
}

/** На таче `attachClickEvent` слушает `mousedown` (`helpers/dom/clickEvent.ts`). */
function tap(target: HTMLElement) {
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const flush = () => wait(0)

function menuElement(): HTMLElement | null {
  return document.getElementById('bubble-contextmenu')
}

let container: HTMLElement

beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  document.body.innerHTML = ''
  container = document.createElement('div')
  container.classList.add('bubbles-inner')
  document.body.append(container)
  putMirrorPage(KEY, [message(1)])
})

afterEach(() => {
  contextMenuController.close()
})

function attach(menu = new ChatContextMenu(makeChat(), {}, makeManagers(), makePopups())) {
  menu.attachTo(container)
  return menu
}

describe('тач: долгое нажатие по чипу реакции (tweb :249-280)', () => {
  it('открывает меню сообщения', async() => {
    const { bubble, chip } = makeBubble(1)
    container.append(bubble)
    attach()

    touch('touchstart', chip)
    await wait(LONG_PRESS)
    await flush()

    expect(menuElement()).not.toBeNull()
    expect(menuElement()!.classList.contains('active')).toBe(true)
  })

  it('гасит следующий `touchend`, иначе меню закрылось бы сразу', async() => {
    const { bubble, chip } = makeBubble(1)
    container.append(bubble)
    attach()

    touch('touchstart', chip)
    await wait(LONG_PRESS)
    await flush()

    expect(touch('touchend', chip).defaultPrevented).toBe(true)
  })

  it('в режиме выделения не делает ничего', async() => {
    const { bubble, chip } = makeBubble(1)
    container.append(bubble)

    // Выделение НАСТОЯЩЕЕ: без гейта меню бы открылось — режим выделения имеет
    // свой набор пунктов (`filterButtons` по `withSelection`), см.
    // `contextMenu.test.ts`.
    const selection = new ChatSelection(new FakeBubbles(container), { messages: {} })
    selection.toggleByElement(bubble)
    expect(selection.isSelecting).toBe(true)

    attach(new ChatContextMenu(makeChat(), { selection }, makeManagers(), makePopups()))

    touch('touchstart', chip)
    await wait(LONG_PRESS)
    await flush()

    expect(menuElement()).toBeNull()
  })

  it('долгое нажатие мимо чипа этой веткой не ловится', async() => {
    const { bubble, content } = makeBubble(1)
    container.append(bubble)
    attach()

    touch('touchstart', content)
    await wait(LONG_PRESS)
    await flush()

    // Меню открывает ТОЛЬКО обычный тап (следующий describe); долгое нажатие по
    // телу бабла у оригинала тоже проходит мимо этой ветки.
    expect(touch('touchend', content).defaultPrevented).toBe(false)
  })
})

describe('тач: обычный тап (tweb :282-315)', () => {
  it('по телу бабла открывает меню', async() => {
    const { bubble, content } = makeBubble(1)
    container.append(bubble)
    attach()

    tap(content)
    await flush()

    expect(menuElement()).not.toBeNull()
  })

  it('по чипу реакции меню НЕ открывает — чип разбирает делегат ленты', async() => {
    const { bubble, chip } = makeBubble(1)
    container.append(bubble)
    attach()

    tap(chip)
    await flush()

    expect(menuElement()).toBeNull()
  })
})
