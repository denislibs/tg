// Пункт «Статистика» меню сообщения — tweb 812502980 `chat/contextMenu.ts:1293-1298`
// (`canViewMessageStatistics` :2338-2345, `onStatisticsClick` :2333-2336), бэклог Б-93.
//
// Меню поднимается настоящим (`ChatContextMenu` + `ButtonMenu` +
// `contextMenuController`, окно — `messagesMirror`), как в соседних
// `contextMenu.*.test.ts`. Права на статистику — `pFlags.can_view_stats`
// полной карточки в зеркале (`core/chatFullCache.ts::canViewStatistics`),
// правая колонка — фейк `createTab`/`toggleSidebar` у шапки чата.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatContextMenu, { type ContextMenuManagers } from './contextMenu'
import type Chat from './chat'
import { attachTestSelection, createTestChat } from './testChat'
import contextMenuController from '@helpers/contextMenuController'
import { putMirrorPage, resetMessagesMirror } from '@core/history/messagesMirror'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { resetChatFullMirror, saveChatFull } from '@core/chatFullCache'
import type { Channel } from '@core/peers/peer'
import type { MyMessage } from '@core/models'
import AppStatisticsTab from '@components/sidebarRight/tabs/statistics.solid'

const CHANNEL: PeerId = -200
const GROUP: PeerId = -100
const KEY = 'win'

const channel = (id: number, pFlags: Channel['pFlags']): Channel => ({
  _: 'channel', id, title: 'C' + id, photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags,
  default_banned_rights: { _: 'chatBannedRights', pFlags: {}, until_date: 0 },
} as Channel)

function post(peerId: PeerId, id: number): MyMessage {
  return {
    _: 'message',
    id,
    pFlags: {},
    peerId,
    peer_id: { _: 'peerChannel', channel_id: Math.abs(peerId) },
    date: 1700000000 + id,
    message: 'пост',
  } as MyMessage
}

function makeBubble(peerId: PeerId, mid: number) {
  const bubble = document.createElement('div')
  bubble.classList.add('bubble', 'is-in')
  bubble.dataset.mid = String(mid)
  bubble.dataset.peerId = String(peerId)
  const content = document.createElement('div')
  content.classList.add('bubble-content')
  bubble.append(content)
  return { bubble, content }
}

const managers = {
  messages: {
    votePoll: vi.fn().mockResolvedValue(undefined),
    closePoll: vi.fn().mockResolvedValue(undefined),
    viewers: vi.fn().mockResolvedValue([]),
    setFactCheck: vi.fn().mockResolvedValue(undefined),
    removeFactCheck: vi.fn().mockResolvedValue(undefined),
  },
  chats: { getReadDate: vi.fn().mockResolvedValue(null) },
} satisfies ContextMenuManagers

let open: ReturnType<typeof vi.fn>
let createTab: ReturnType<typeof vi.fn>
let toggleSidebar: ReturnType<typeof vi.fn>

function makeChat(peerId: PeerId): Chat {
  const chat = createTestChat({ peerId, messagesStorageKey: KEY, isBroadcast: peerId === CHANNEL })
  attachTestSelection(chat, { getRenderedHistory: () => [], getBubble: () => undefined, getBubbleGroupedItems: () => [] })
  ;(chat as unknown as { topbar: unknown }).topbar = { appSidebarRight: { createTab, toggleSidebar } }
  return chat
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function rightClick(target: HTMLElement) {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'pageX', { value: 10 })
  Object.defineProperty(e, 'pageY', { value: 10 })
  target.dispatchEvent(e)
}

const items = () => Array.from(document.getElementById('bubble-contextmenu')?.querySelectorAll<HTMLElement>('.btn-menu-item') ?? [])
const statisticsItem = () => items().find((item) => item.querySelector('.btn-menu-item-text')?.textContent === 'View Statistics')

let container: HTMLElement

async function openOn(peerId: PeerId, message: MyMessage) {
  putMirrorPage(KEY, [message])
  const { bubble, content } = makeBubble(peerId, message.id)
  container.append(bubble)
  const menu = new ChatContextMenu(makeChat(peerId), managers)
  menu.attachTo(container)
  rightClick(content)
  await flush()
}

const fullWithStats = (id: number) => ({
  _: 'channelFull' as const, id, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null,
  pFlags: { can_view_stats: true as const },
})

beforeEach(() => {
  vi.clearAllMocks()
  resetMessagesMirror()
  resetPeerMirror()
  resetChatFullMirror()
  applyPeerOps([{ op: 'upsert', peers: [channel(200, { broadcast: true }), channel(100, { megagroup: true })] }])
  open = vi.fn()
  createTab = vi.fn(() => ({ open }))
  toggleSidebar = vi.fn(() => Promise.resolve())
  document.body.innerHTML = ''
  container = document.createElement('div')
  container.classList.add('bubbles-inner')
  document.body.append(container)
})

afterEach(() => {
  contextMenuController.close()
})

describe('«Статистика» в меню сообщения (Б-93)', () => {
  it('пост канала, карточка с can_view_stats — пункт есть; клик открывает AppStatisticsTab поста и колонку', async() => {
    saveChatFull(CHANNEL, fullWithStats(200))
    await openOn(CHANNEL, post(CHANNEL, 7))
    const item = statisticsItem()
    expect(item).toBeDefined()

    item!.click()
    expect(createTab).toHaveBeenCalledWith(AppStatisticsTab)
    expect(open).toHaveBeenCalledWith(CHANNEL, 7)
    expect(toggleSidebar).toHaveBeenCalledWith(true)
  })

  it('без can_view_stats (не админ) — пункта нет', async() => {
    await openOn(CHANNEL, post(CHANNEL, 7))
    expect(items().length).toBeGreaterThan(0)
    expect(statisticsItem()).toBeUndefined()
  })

  it('группа (не канал) — пункта нет даже с can_view_stats', async() => {
    saveChatFull(GROUP, fullWithStats(100))
    await openOn(GROUP, post(GROUP, 7))
    expect(statisticsItem()).toBeUndefined()
  })

  it('ещё не отправленный пост (локальный номер) — пункта нет', async() => {
    saveChatFull(CHANNEL, fullWithStats(200))
    await openOn(CHANNEL, post(CHANNEL, 7.0001))
    expect(statisticsItem()).toBeUndefined()
  })
})
