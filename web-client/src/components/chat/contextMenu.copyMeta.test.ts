// ── ПИН: ФОРМА даты в копируемом тексте нескольких сообщений ─────────────────
//
// `getSelectedMessagesText` (порт tweb `contextMenu.ts:1804-1851`) при выделении
// нескольких сообщений добавляет к каждому мету «имя, [дата]». Дату строит
// `getFullDate` с ЧЕТЫРЬМЯ аргументами (`:1834-1839`): день с ведущим нулём,
// месяц числом, без секунд, время через пробел — «04.06.2026 10:05».
//
// Пин заведён потому, что набор опций у вызывающего ничем не держался: задача
// #121 заменила здесь `toLocaleString()` (локаль БРАУЗЕРА) на `getFullDate`, и
// подмена любого из четырёх аргументов — или вызов вовсе без них — проходила
// зелёной. Форма эта не косметическая: пользователь вставляет текст в другое
// приложение, и «15 August 2026, 12:34:07» вместо «15.08.2026 12:34» — другой
// результат, чем у оригинала.
//
// Отдельным файлом, а не в `contextMenu.test.ts`: здесь подменяется буфер
// обмена (`@helpers/clipboard`), и подменять его на весь тот файл незачем.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { copied } = vi.hoisted(() => ({ copied: [] as string[] }))

vi.mock('@helpers/clipboard', () => ({
  copyTextToClipboard: (text: string) => { copied.push(text) },
}))

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

/** 4 июня 2026, 10:05:07 местного времени — ведущий ноль у дня и у месяца,
 *  ненулевые секунды (их форма обязана их ОТБРОСИТЬ). */
const FIRST = new Date('2026-06-04T10:05:07').getTime() / 1000
const SECOND = new Date('2026-06-04T10:06:07').getTime() / 1000

function message(id: number, date: number): MyMessage {
  return {
    _: 'message',
    id,
    pFlags: {},
    peerId: PEER,
    fromId: PEER,
    peer_id: { _: 'peerUser', user_id: PEER },
    date,
    message: `text ${id}`,
  } as MyMessage
}

function makeBubble(mid: number) {
  const bubble = document.createElement('div')
  bubble.classList.add('bubble', 'is-in')
  bubble.dataset.mid = String(mid)
  bubble.dataset.peerId = String(PEER)

  const wrapper = document.createElement('div')
  wrapper.classList.add('bubble-content-wrapper')
  const content = document.createElement('div')
  content.classList.add('bubble-content')
  wrapper.append(content)
  bubble.append(wrapper)
  return { bubble, content }
}

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

const makeManagers = () => ({
  messages: {
    votePoll: vi.fn().mockResolvedValue(undefined),
    closePoll: vi.fn().mockResolvedValue(undefined),
    viewers: vi.fn().mockResolvedValue([]),
  },
  chats: { getReadDate: vi.fn().mockResolvedValue(null) },
  media: { downloadToDisc: vi.fn() },
} satisfies ContextMenuManagers)

const makePopups = () => ({
  showPinMessage: vi.fn(),
  showDeleteMessages: vi.fn(),
  showForward: vi.fn(),
  showMessageReport: vi.fn(),
  showReactedList: vi.fn(),
  showStatistics: vi.fn(),
  showFactCheckEditor: vi.fn(),
} satisfies ContextMenuPopups)

const makeChat = (): ContextMenuChat => ({
  peerId: PEER,
  messagesStorageKey: KEY,
  canSend: () => true,
  hasMessageInput: () => true,
  initMessageReply: vi.fn(),
  initMessageEditing: vi.fn(),
  initSearch: vi.fn(),
})

function rightClick(target: HTMLElement) {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'pageX', { value: 10 })
  Object.defineProperty(e, 'pageY', { value: 10 })
  target.dispatchEvent(e)
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function clickItem(text: string) {
  const item = Array.from(document.getElementById('bubble-contextmenu')!.querySelectorAll<HTMLElement>('.btn-menu-item'))
    .find((el) => el.querySelector('.btn-menu-item-text')?.textContent === text)
  expect(item, `пункт «${text}» не найден`).toBeTruthy()
  item!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

let container: HTMLElement

beforeEach(() => {
  copied.length = 0
  resetMessagesMirror()
  resetPeerMirror()
  document.body.replaceChildren()
  container = document.createElement('div')
  container.classList.add('bubbles-inner')
  document.body.append(container)
})

afterEach(() => {
  contextMenuController.close()
})

describe('копирование нескольких сообщений — мета «имя, [дата]»', () => {
  it('дата в форме оригинала: день с нулём, месяц числом, без секунд, время через пробел', async() => {
    putMirrorPage(KEY, [message(1, FIRST), message(2, SECOND)])

    const first = makeBubble(1)
    const second = makeBubble(2)
    container.append(first.bubble, second.bubble)

    const selection = new ChatSelection(new FakeBubbles(container), { messages: {} })
    selection.toggleByElement(first.bubble)
    selection.toggleByElement(second.bubble)

    const menu = new ChatContextMenu(makeChat(), { selection }, makeManagers(), makePopups())
    menu.attachTo(container)

    rightClick(first.content)
    await flush()
    clickItem('Copy')

    expect(copied).toHaveLength(1)
    // Именно так, и никак иначе: `04.` — ведущий ноль дня, `.06.` — месяц
    // числом, `2026 10:05` — время через ПРОБЕЛ и БЕЗ секунд (в самой дате
    // секунды есть — :07).
    expect(copied[0]).toContain('[04.06.2026 10:05]')
    expect(copied[0]).toContain('[04.06.2026 10:06]')
    expect(copied[0]).not.toContain(':07')
  })

  it('одно сообщение — только текст, без меты (tweb :1841)', async() => {
    putMirrorPage(KEY, [message(1, FIRST)])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)

    const menu = new ChatContextMenu(makeChat(), {}, makeManagers(), makePopups())
    menu.attachTo(container)

    rightClick(content)
    await flush()
    clickItem('Copy')

    expect(copied).toEqual(['text 1'])
  })
})
