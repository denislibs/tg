// КАРТОЧКА ПРЕВЬЮ ССЫЛКИ в императивной ленте — порт ветки `case
// 'messageMediaWebPage'` (tweb bubbles.ts:9334-9786) и `invert-media` (:9191-9193).
// До Ф-5 C2 лента карточку не рисовала вовсе, хотя сервер её отдаёт.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { makeMessage } from '@core/messages/testMessage'
import rootScope from '@lib/rootScope'
import { ANCHOR_ACTION_ATTRIBUTE } from '@lib/richtext'
import addAnchorListener from '@helpers/addAnchorListener'
import type { MessageMediaWebPage, MyPhoto, WebPage } from '@core/media/messageMedia'
import type { MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import type ChatBubbles from './bubbles'
import type { BubblesManagers } from './bubbles'
import { createTestChat, mountTestBubbles } from './testChat'

const CHAT = 71
const URL = 'https://example.com/post'

const photo = (w: number, h: number): MyPhoto => ({
  _: 'photo', id: 77, sizes: [{ _: 'photoSize', type: 'w', w, h, size: 1 }],
} as MyPhoto)

const webPage = (over: Partial<WebPage> = {}): WebPage => ({
  _: 'webPage', pFlags: {}, url: URL, display_url: 'example.com/post',
  site_name: 'Example', title: 'Заголовок', description: 'Описание', ...over,
})

const media = (wp: WebPage, pFlags: MessageMediaWebPage['pFlags'] = {}): MessageMediaWebPage => ({
  _: 'messageMediaWebPage', pFlags, webpage: wp,
})

const msg = (m?: MessageMediaWebPage, over: { invert?: boolean, text?: string } = {}): MyMessage => {
  const message = makeMessage({ peerId: CHAT, fromId: 2, id: 1, text: over.text ?? 'смотри ' + URL, createdAt: '2026-08-15T12:00:00Z', media: m })
  if (over.invert) message.pFlags.invert_media = true
  return message
}

const managersWith = (messages: MyMessage[]): BubblesManagers => ({
  messages: {
    getHistory: vi.fn(async (): Promise<HistoryResult> => ({ messages, count: messages.length, reachedTop: true, reachedBottom: true })),
    getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
    messageByDate: vi.fn(async () => null),
  },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0), getDialogReadState: vi.fn(async () => undefined) },
  realtime: { markRead: vi.fn(async () => ({ ok: true })) },
})

async function settle() {
  for (let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined; document.body.replaceChildren() })
beforeEach(() => { resetMessagesMirror(); resetPeerMirror() })

async function feedWith(message: MyMessage) {
  const ctx = createTestChat({ peerId: CHAT })
  document.body.append(ctx.container)
  const feed = mountTestBubbles(ctx, managersWith([message]))
  await (await feed.setPeer())?.promise
  await settle()
  return feed
}

const bubbleOf = (b: ChatBubbles) => b.chatInner.querySelector<HTMLElement>('.bubble[data-mid="1"]')!
const boxOf = (b: ChatBubbles) => bubbleOf(b).querySelector<HTMLAnchorElement>('.message > a.webpage')

describe('ChatBubbles — карточка превью ссылки', () => {
  it('карточка в теле: имя сайта, заголовок, описание; классы has-webpage single-media; перед временем', async () => {
    bubbles = await feedWith(msg(media(webPage())))
    const bubble = bubbleOf(bubbles)
    expect(bubble.classList.contains('has-webpage')).toBe(true)
    expect(bubble.classList.contains('single-media')).toBe(true)

    const box = boxOf(bubbles)!
    expect(box).not.toBeNull()
    expect(box.classList.contains('quote-like')).toBe(true)
    expect(box.querySelector('.webpage-quote.quote-like-border > .webpage-content')).not.toBeNull()
    expect(box.querySelector('.webpage-name strong')!.textContent).toBe('Example')
    expect(box.querySelector('.webpage-title strong')!.textContent).toBe('Заголовок')
    expect(box.querySelector('.webpage-text')!.textContent).toBe('Описание')
    // внешняя ссылка без `safe`: новая вкладка + подтверждение (tweb :9456-9464)
    expect(box.getAttribute('href')).toBe(URL)
    expect(box.target).toBe('_blank')
    expect(box.getAttribute(ANCHOR_ACTION_ATTRIBUTE)).toBe('showMaskedAlert')
    // текст → карточка → время (tweb :9758 `timeSpan.before(box)`)
    const messageDiv = bubble.querySelector('.message')!
    const children = Array.from(messageDiv.children)
    expect(children.indexOf(box)).toBeGreaterThan(0)
    expect(children.indexOf(box)).toBeLessThan(children.findIndex((c) => c.classList.contains('time')))
  })

  it('t.me-ссылка: действие на карточке и футер «VIEW MESSAGE» (tweb :9418-9454)', async () => {
    addAnchorListener({ name: 'im', callback: () => {} })
    const tme = 'https://t.me/durov'
    bubbles = await feedWith(msg(media(webPage({ url: tme, display_url: 't.me/durov' })), { text: tme }))
    const box = boxOf(bubbles)!
    expect(box.getAttribute(ANCHOR_ACTION_ATTRIBUTE)).toBe('im')
    expect(box.getAttribute('safe')).toBe('1')
    // исполнитель есть — карточка ведёт внутри приложения, без новой вкладки
    expect(box.target).toBe('')
    expect(box.querySelector('.webpage-footer')!.textContent).toBe('VIEW MESSAGE')
  })

  it('крупная картинка: превью под текстом карточки, без square/vertical', async () => {
    bubbles = await feedWith(msg(media(webPage({ photo: photo(1280, 720) }))))
    const bubble = bubbleOf(bubbles)
    expect(bubble.classList.contains('photo')).toBe(true)
    expect(bubble.classList.contains('is-square-photo')).toBe(false)
    const content = boxOf(bubbles)!.querySelector('.webpage-content')!
    expect(content.lastElementChild!.classList.contains('webpage-preview-resizer')).toBe(true)
  })

  it('квадрат без has_large_media → is-square-photo 48×48, превью сверху (tweb :9593-9604)', async () => {
    bubbles = await feedWith(msg(media(webPage({ photo: photo(600, 600) }))))
    expect(bubbleOf(bubbles).classList.contains('is-square-photo')).toBe(true)
    const box = boxOf(bubbles)!
    expect(box.classList.contains('has-square-photo')).toBe(true)
    const preview = box.querySelector<HTMLElement>('.webpage-preview')!
    expect(preview.style.width).toBe('48px')
    expect(box.querySelector('.webpage-content')!.firstElementChild!.classList.contains('webpage-preview-resizer')).toBe(true)
  })

  it('квадрат с has_large_media рисуется крупно; force_small_media — снова квадрат (tweb :9479-9480)', async () => {
    const large = webPage({ photo: photo(600, 600), pFlags: { has_large_media: true } })
    bubbles = await feedWith(msg(media(large)))
    expect(bubbleOf(bubbles).classList.contains('is-square-photo')).toBe(false)
    bubbles.destroy()
    bubbles = await feedWith(msg(media(large, { force_small_media: true })))
    expect(bubbleOf(bubbles).classList.contains('is-square-photo')).toBe(true)
  })

  it('вертикальная без has_large_media → is-vertical-photo (tweb :9605-9608)', async () => {
    bubbles = await feedWith(msg(media(webPage({ photo: photo(400, 800) }))))
    expect(bubbleOf(bubbles).classList.contains('is-vertical-photo')).toBe(true)
  })

  it('invert_media: invert-media на бабле, карточка первой в теле с mt-bigger, превью сверху (tweb :9191, :9745, :9757-9759)', async () => {
    bubbles = await feedWith(msg(media(webPage({ photo: photo(1280, 720) })), { invert: true }))
    const bubble = bubbleOf(bubbles)
    expect(bubble.classList.contains('invert-media')).toBe(true)
    const messageDiv = bubble.querySelector('.message')!
    expect(messageDiv.firstElementChild).toBe(boxOf(bubbles))
    expect(messageDiv.classList.contains('mt-bigger')).toBe(true)
    expect(boxOf(bubbles)!.querySelector('.webpage-content')!.firstElementChild!.classList.contains('webpage-preview-resizer')).toBe(true)
  })

  it('правка: тот же текст и карточка (реакция) — тот же узел; снятое превью уносит её и классы; догонка — рисует', async () => {
    const m = media(webPage())
    bubbles = await feedWith(msg(m))
    const box = boxOf(bubbles)
    const edit = (message: MyMessage) => rootScope.dispatchEventSingle('message_edit', { storageKey: String(CHAT), peerId: CHAT, mid: 1, message })

    edit(msg(m))
    await settle()
    expect(boxOf(bubbles)).toBe(box)
    expect(bubbleOf(bubbles).classList.contains('has-webpage')).toBe(true)
    // текст правки встаёт ПЕРЕД карточкой
    const messageDiv = bubbleOf(bubbles).querySelector('.message')!
    expect(messageDiv.firstElementChild).not.toBe(box)

    edit(msg(undefined, { text: 'без ссылки' }))
    await settle()
    expect(boxOf(bubbles)).toBeNull()
    expect(bubbleOf(bubbles).classList.contains('has-webpage')).toBe(false)

    // догоняющая карточка (`updateMessageWebPage` → patch {media}) — та же правка
    edit(msg(m))
    await settle()
    expect(boxOf(bubbles)).not.toBeNull()
  })

  it('правка текста пересобирает карточку (у tweb правка пересоздаёт бабл, :1097)', async () => {
    const m = media(webPage())
    bubbles = await feedWith(msg(m))
    const box = boxOf(bubbles)
    rootScope.dispatchEventSingle('message_edit', { storageKey: String(CHAT), peerId: CHAT, mid: 1, message: msg(m, { text: 'иначе ' + URL }) })
    await settle()
    expect(boxOf(bubbles)).not.toBeNull()
    expect(boxOf(bubbles)).not.toBe(box)
  })

  it('t.me-действие без исполнителя открывается новой вкладкой (наш реестр шире исполнителей)', async () => {
    const tme = 'https://t.me/share/url?url=x'
    bubbles = await feedWith(msg(media(webPage({ url: tme, display_url: 't.me/share/url' })), { text: tme }))
    const box = boxOf(bubbles)!
    expect(box.getAttribute(ANCHOR_ACTION_ATTRIBUTE)).toBe('share')
    expect(box.target).toBe('_blank')
  })

  it('адрес вне allow-list схем — карточка без href', async () => {
    bubbles = await feedWith(msg(media(webPage({ url: 'javascript:alert(1)', display_url: 'x' })), { text: 'x' }))
    expect(boxOf(bubbles)!.hasAttribute('href')).toBe(false)
  })

  it('клик по полю превью не открывает ссылку (tweb :3932-3935)', async () => {
    bubbles = await feedWith(msg(media(webPage({ photo: photo(1280, 720) }))))
    const resizer = boxOf(bubbles)!.querySelector<HTMLElement>('.webpage-preview-resizer')!
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    resizer.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})
