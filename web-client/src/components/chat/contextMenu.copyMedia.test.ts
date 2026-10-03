// Пункт «Копировать медиа» меню сообщения — tweb 812502980, коммит 508acd4f5
// (`chat/contextMenu.ts:1110-1121`, `canCopyMedia` :1658-1666,
// `onCopyMediaClick` :2200-2205, `copyMessageMediaWithFeedback.ts`).
//
// Меню поднимается настоящим (`ChatContextMenu` + `ButtonMenu` +
// `contextMenuController`, окно — `messagesMirror`), как в `contextMenu.test.ts`.
// Подменены только края мира: буфер обмена браузера (`ClipboardItem`,
// `navigator.clipboard`), выдача URL медиа воркером (`ensureMediaUrl`) и
// `fetch` байтов по нему, плюс тост — ради проверки текста. Здесь же — соседний
// пункт «Скачать» (`onDownloadClick` :2178-2190, граница — `appDownloadManager`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureMediaUrl: vi.fn<(id: number) => Promise<string>>(),
  toastNew: vi.fn(),
  downloadToDisc: vi.fn(() => Promise.resolve()),
}))

vi.mock('@lib/appDownloadManager', () => ({ downloadToDisc: mocks.downloadToDisc }))

vi.mock('@core/media/ensureMediaUrl', () => ({ ensureMediaUrl: mocks.ensureMediaUrl }))
vi.mock('@components/toast', async(importOriginal) => ({
  ...(await importOriginal<typeof import('@components/toast')>()),
  toastNew: mocks.toastNew,
}))

import ChatContextMenu, { type ContextMenuManagers } from './contextMenu'
import type Chat from './chat'
import { attachTestSelection, createTestChat } from './testChat'
import contextMenuController from '@helpers/contextMenuController'
import { putMirrorPage, resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import type { MyMessage } from '@core/models'

const PEER = 5
const KEY = 'win'

class ClipboardItemMock {
  public static supports = vi.fn(() => true)

  constructor(public items: Record<string, Blob | Promise<Blob>>) {}
}

function photoMessage(id: number): MyMessage {
  return {
    _: 'message',
    id,
    pFlags: {},
    peerId: PEER,
    fromId: PEER,
    peer_id: { _: 'peerUser', user_id: PEER },
    date: 1700000000 + id,
    message: '',
    media: { _: 'messageMediaPhoto', pFlags: {}, photo: { _: 'photo', id: 700 + id, sizes: [] } },
  } as MyMessage
}

function videoMessage(id: number): MyMessage {
  return {
    ...photoMessage(id),
    media: {
      _: 'messageMediaDocument',
      pFlags: {},
      document: { _: 'document', id: 800 + id, mime_type: 'video/mp4', size: 1, attributes: [], type: 'video' },
    },
  } as MyMessage
}

/** Бабл с медиа-узлом внутри: `canDownload` требует цель внутри медиа (:1464-1470). */
function makeMediaBubble(mid: number) {
  const bubble = document.createElement('div')
  bubble.classList.add('bubble', 'is-in')
  bubble.dataset.mid = String(mid)
  bubble.dataset.peerId = String(PEER)
  const wrapper = document.createElement('div')
  wrapper.classList.add('bubble-content-wrapper')
  const content = document.createElement('div')
  content.classList.add('bubble-content')
  const media = document.createElement('div')
  media.classList.add('media-photo')
  content.append(media)
  wrapper.append(content)
  bubble.append(wrapper)
  return { bubble, media }
}

function makeManagers() {
  return {
    messages: {
      votePoll: vi.fn().mockResolvedValue(undefined),
      closePoll: vi.fn().mockResolvedValue(undefined),
      viewers: vi.fn().mockResolvedValue([]),
      setFactCheck: vi.fn().mockResolvedValue(undefined),
      removeFactCheck: vi.fn().mockResolvedValue(undefined),
    },
    chats: { getReadDate: vi.fn().mockResolvedValue(null) },
  } satisfies ContextMenuManagers
}

function makeChat(): Chat {
  const chat = createTestChat({ peerId: PEER, messagesStorageKey: KEY })
  attachTestSelection(chat, { getRenderedHistory: () => [], getBubble: () => undefined, getBubbleGroupedItems: () => [] })
  return chat
}

function rightClick(target: HTMLElement) {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'pageX', { value: 10 })
  Object.defineProperty(e, 'pageY', { value: 10 })
  target.dispatchEvent(e)
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const menuElement = () => document.getElementById('bubble-contextmenu')

function items(): HTMLElement[] {
  return Array.from(menuElement()?.querySelectorAll<HTMLElement>('.btn-menu-item') ?? [])
}

const itemTexts = () => items().map((item) => item.querySelector('.btn-menu-item-text')?.textContent ?? '')

const copyItem = () => items().find((item) => item.querySelector('.btn-menu-item-text')?.textContent === 'Copy Media')

let container: HTMLElement
let write: ReturnType<typeof vi.fn>

async function openOn(message: MyMessage) {
  putMirrorPage(KEY, [message])
  const { bubble, media } = makeMediaBubble(message.id)
  container.append(bubble)

  const menu = new ChatContextMenu(makeChat(), makeManagers())
  menu.attachTo(container)

  rightClick(media)
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  resetMessagesMirror()
  resetPeerMirror()
  document.body.innerHTML = ''
  container = document.createElement('div')
  container.classList.add('bubbles-inner')
  document.body.append(container)

  write = vi.fn((clipboardItems: ClipboardItemMock[]) => clipboardItems[0].items['image/png'])
  Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: ClipboardItemMock })
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { write } })
  mocks.ensureMediaUrl.mockResolvedValue('blob:full')
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    blob: () => Promise.resolve(new Blob(['png'], { type: 'image/png' })),
  })))
})

afterEach(() => {
  contextMenuController.close()
  vi.unstubAllGlobals()
})

describe('«Копировать медиа» в меню сообщения (tweb 508acd4f5)', () => {
  it('у фото пункт стоит сразу после копирования текста и раньше «Скачать» (:1110)', async() => {
    await openOn(photoMessage(1))

    const texts = itemTexts()
    expect(texts).toContain('Copy Media')
    expect(texts.indexOf('Copy Media')).toBeLessThan(texts.indexOf('Download'))
  })

  it('у видео пункта нет — в буфер пишется только картинка', async() => {
    await openOn(videoMessage(2))

    expect(itemTexts()).toContain('Download')
    expect(itemTexts()).not.toContain('Copy Media')
  })

  it('браузер не пишет png в буфер — пункта нет', async() => {
    ClipboardItemMock.supports.mockReturnValue(false)
    await openOn(photoMessage(3))
    ClipboardItemMock.supports.mockReturnValue(true)

    expect(itemTexts()).not.toContain('Copy Media')
  })

  it('клик: прелоадер вместо иконки, меню открыто, по итогу — тост и закрытие меню', async() => {
    let resolveBlob!: (blob: Blob) => void
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      blob: () => new Promise<Blob>((resolve) => { resolveBlob = resolve }),
    })))
    await openOn(photoMessage(4))

    const item = copyItem()!
    item.click()

    // запись ушла сразу, в тике клика (`ClipboardItem` получил промис)
    expect(write).toHaveBeenCalledOnce()
    // keepOpen: меню ждёт конца копирования
    expect(menuElement()!.classList.contains('active')).toBe(true)
    expect(item.classList.contains('is-loading')).toBe(true)
    expect(item.querySelector('.btn-menu-item-icon > .preloader.btn-menu-item-preloader')).not.toBeNull()

    await flush()
    // копируется ПОЛНЫЙ файл фото (не превью)
    expect(mocks.ensureMediaUrl).toHaveBeenCalledWith(704)
    expect(mocks.toastNew).not.toHaveBeenCalled()
    expect(item.classList.contains('is-loading')).toBe(true)

    resolveBlob(new Blob(['png'], { type: 'image/png' }))
    await flush()
    await flush()

    expect(mocks.toastNew).toHaveBeenCalledWith({ langPackKey: 'MediaCopied' })
    expect(menuElement()!.classList.contains('active')).toBe(false)
    expect(item.classList.contains('is-loading')).toBe(false)
    expect(item.querySelector('.btn-menu-item-preloader')).toBeNull()
  })

  it('сбой копирования — тост об ошибке, прелоадер снят', async() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    write.mockImplementation(() => Promise.reject(new Error('denied')))
    await openOn(photoMessage(5))

    const item = copyItem()!
    item.click()
    await flush()
    await flush()

    expect(mocks.toastNew).toHaveBeenCalledWith({ langPackKey: 'MediaCopyFailed' })
    expect(item.classList.contains('is-loading')).toBe(false)
  })
})

describe('«Скачать» в меню сообщения (tweb :2178-2190)', () => {
  const clickDownload = () => items()
    .find((item) => item.querySelector('.btn-menu-item-text')?.textContent === 'Download')!
    .click()

  it('фото уходит в `appDownloadManager.downloadToDisc` полным файлом `photo<id>.jpg`', async() => {
    await openOn(photoMessage(6))

    clickDownload()

    expect(mocks.downloadToDisc).toHaveBeenCalledWith({
      mediaId: 706, fileName: 'photo706.jpg', mime: 'image/jpeg', size: undefined,
    })
  })

  it('документ — со своим типом и размером, имя без `file_name` — `file<id>`', async() => {
    await openOn(videoMessage(7))

    clickDownload()

    expect(mocks.downloadToDisc).toHaveBeenCalledWith({
      mediaId: 807, fileName: 'file807', mime: 'video/mp4', size: 1,
    })
  })
})
