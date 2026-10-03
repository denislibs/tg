// Пины порта tweb `internalLinkProcessor.ts`: разбор ссылки → процессор → вызов
// `appImManager`/попапа, и проводка делегата `data-anchor-action` (наша замена
// inline-`onclick`, `helpers/addAnchorListener.ts`). Клики — настоящие события по
// якорям, собранным настоящим `wrapRichText`, как их рисует лента.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const im = vi.hoisted(() => ({
  openUsername: vi.fn(async() => undefined),
  op: vi.fn(async() => undefined),
  open: vi.fn(async() => undefined),
  setInnerPeer: vi.fn(async() => undefined),
  openWebApp: vi.fn(),
}))
vi.mock('@lib/appImManager', () => ({ default: im }))

const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', () => ({ toastNew }))

const showStickersPopup = vi.hoisted(() => vi.fn())
vi.mock('@components/sidebarLeft/settingsPopups', () => ({ showStickersPopup }))

const showSharedFolderInvitePopup = vi.hoisted(() => vi.fn())
vi.mock('@components/popups/sharedFolderInvite.solid', () => ({ default: showSharedFolderInvitePopup }))

import internalLinkProcessor from './internalLinkProcessor'
import wrapRichText from './richtext/wrapRichText'
import { KNOWN_ANCHOR_ACTIONS } from './richtext/url'
import { getAnchorListener } from '@helpers/addAnchorListener'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import { HttpError } from '@core/net/restClient'
import type { Managers } from '@/client/bootstrap'

const managers = {
  peers: {
    resolveUsername: vi.fn(),
    getPeers: vi.fn(),
  },
  groups: { importChatInvite: vi.fn() },
  folders: { previewInvite: vi.fn() },
  bots: { start: vi.fn(), menuButton: vi.fn() },
  auth: { qrConfirm: vi.fn() },
}

beforeAll(() => {
  internalLinkProcessor.construct(managers as unknown as Managers)
})

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  document.body.replaceChildren()
})

/** Ссылка в тексте сообщения — как её рисует лента (`wrapRichText`). */
function mountLink(url: string, text = url): HTMLAnchorElement {
  const fragment = wrapRichText(text, {
    entities: [text === url ?
      { _: 'messageEntityUrl', offset: 0, length: text.length } :
      { _: 'messageEntityTextUrl', offset: 0, length: text.length, url }],
  })
  const message = document.createElement('div')
  message.className = 'message'
  message.append(fragment)
  document.body.append(message)
  return message.querySelector('a')!
}

function press(anchor: HTMLElement, type: 'auxclick' | 'click' = 'click', button = 0) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button })
  anchor.dispatchEvent(e)
  return e
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('t.me-ссылки исполняет процессор (делегат документа)', () => {
  it('t.me/<имя> — openUsername, клик погашен', () => {
    const anchor = mountLink('https://t.me/durov')
    expect(anchor.getAttribute('data-anchor-action')).toBe('im')

    const e = press(anchor)

    expect(e.defaultPrevented).toBe(true)
    expect(im.openUsername).toHaveBeenCalledWith({ userName: 'durov', lastMsgId: undefined, commentId: undefined, threadId: undefined })
  })

  it('t.me/<имя>/<пост>?comment= — номер поста и комментарий', () => {
    press(mountLink('https://t.me/channel/12?comment=5'))
    expect(im.openUsername).toHaveBeenCalledWith({ userName: 'channel', lastMsgId: 12, commentId: 5, threadId: undefined })
  })

  it('t.me/c/<id>/<пост> — карточка закрытого чата и op', async() => {
    const peer = { _: 'channel', id: 123 }
    managers.peers.getPeers.mockResolvedValue([peer])
    press(mountLink('https://t.me/c/123/45'))
    await flush()
    expect(managers.peers.getPeers).toHaveBeenCalledWith([-123])
    expect(im.op).toHaveBeenCalledWith({ peer, lastMsgId: 45, threadId: undefined })
  })

  it('t.me/c/… без доступа — тост LinkNotFound', async() => {
    managers.peers.getPeers.mockRejectedValue(new HttpError(403, 'forbidden'))
    press(mountLink('https://t.me/c/123/45'))
    await flush()
    expect(im.op).not.toHaveBeenCalled()
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'LinkNotFound' })
  })

  it('t.me/+hash — вступление и открытие чата из ответа', async() => {
    managers.groups.importChatInvite.mockResolvedValue(-77)
    const anchor = mountLink('https://t.me/+abcdef')
    expect(anchor.getAttribute('data-anchor-action')).toBe('joinchat')
    press(anchor)
    await flush()
    expect(managers.groups.importChatInvite).toHaveBeenCalledWith('abcdef')
    expect(im.open).toHaveBeenCalledWith({ peerId: -77 })
  })

  it('t.me/joinchat/<hash> с заявкой — тост RequestToJoinSent (tweb joinChatInvite.tsx:122)', async() => {
    managers.groups.importChatInvite.mockRejectedValue(new HttpError(400, 'x', 'INVITE_REQUEST_SENT'))
    press(mountLink('https://t.me/joinchat/abcdef'))
    await flush()
    expect(im.open).not.toHaveBeenCalled()
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'RequestToJoinSent' })
  })

  it('t.me/addlist/<slug> — предпросмотр папки и попап', async() => {
    const preview = { title: 'Work', chats: [] }
    managers.folders.previewInvite.mockResolvedValue(preview)
    press(mountLink('https://t.me/addlist/slug1'))
    await flush()
    expect(showSharedFolderInvitePopup).toHaveBeenCalledWith({ chatlistInvite: preview, slug: 'slug1', managers })
  })

  it('t.me/addlist/<slug> недействительный — тост SharedFolder.Link.Expired', async() => {
    managers.folders.previewInvite.mockRejectedValue(new HttpError(404, 'not found'))
    press(mountLink('https://t.me/addlist/slug1'))
    await flush()
    expect(showSharedFolderInvitePopup).not.toHaveBeenCalled()
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'SharedFolder.Link.Expired' })
  })

  it('t.me/addstickers/<имя> — попап набора', () => {
    press(mountLink('https://t.me/addstickers/Cats'))
    expect(showStickersPopup).toHaveBeenCalledWith({ shortName: 'Cats' })
  })

  it('история t.me/<имя>/s/<id> — вида без предмета: тост Link.NotSupported, а не чат', () => {
    press(mountLink('https://t.me/durov/s/5'))
    expect(im.openUsername).not.toHaveBeenCalled()
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'Link.NotSupported' })
  })

  it('обычная внешняя ссылка — не наша: клик не погашен', () => {
    const e = press(mountLink('https://example.com/'))
    expect(e.defaultPrevented).toBe(false)
  })
})

describe('tg://-ссылки (через appImManager.openUrl, как `#?tgaddr=`)', () => {
  const run = (url: string) => {
    const callback = getAnchorListener('tg_' + url.slice(5).split(/[/?]/)[0])!
    const a = document.createElement('a')
    a.href = url
    return callback(a)
  }

  it('tg://resolve?domain=<бот>&start= — бот запускается и открывается (расхождение 3)', async() => {
    managers.peers.resolveUsername.mockResolvedValue({ _: 'user', id: 42, pFlags: { bot: true } })
    managers.bots.start.mockResolvedValue(42)
    await run('tg://resolve?domain=mybot&start=hello')
    expect(managers.bots.start).toHaveBeenCalledWith(42, 'hello')
    expect(im.setInnerPeer).toHaveBeenCalledWith({ peerId: 42 })
  })

  it('tg://join?invite= — то же вступление, что t.me/+hash', async() => {
    managers.groups.importChatInvite.mockResolvedValue(-5)
    await run('tg://join?invite=zzz')
    expect(im.open).toHaveBeenCalledWith({ peerId: -5 })
  })

  it('tg://addstickers?set= — попап набора', () => {
    run('tg://addstickers?set=Dogs')
    expect(showStickersPopup).toHaveBeenCalledWith({ shortName: 'Dogs' })
  })

  it('реестр действий `wrapUrl` и обработчики `tg_*` не разъехались', () => {
    const tgKnown = [...KNOWN_ANCHOR_ACTIONS].filter((name) => name.startsWith('tg_'))
    expect(tgKnown.length).toBeGreaterThan(0)
    for (const name of tgKnown) {
      expect(getAnchorListener(name), name).toBeDefined()
    }
  })
})

describe('замаскированная ссылка спрашивает перед открытием (tweb e96e06c37, :91-113)', () => {
  const popup = () => document.querySelector<HTMLElement>('.popup-masked-url')
  const mountMasked = () => mountLink('https://evil.example/', 'жми сюда')

  it('средняя кнопка: вместо новой вкладки — попап с НАСТОЯЩИМ адресом', () => {
    const anchor = mountMasked()
    expect(anchor.getAttribute('data-anchor-action')).toBe('showMaskedAlert')
    const e = press(anchor, 'auxclick', 1)

    expect(e.defaultPrevented).toBe(true)
    expect(popup()!.querySelector('.popup-title')?.textContent).toBe('Open Link')
    expect(popup()!.querySelector('.popup-description')?.textContent).toBe('Do you want to open https://evil.example/?')
  })

  it('основная кнопка — тот же вопрос', () => {
    const e = press(mountMasked())
    expect(e.defaultPrevented).toBe(true)
    expect(popup()).not.toBeNull()
  })

  it('«Открыть» кликает клон с настоящим адресом, и клон второй раз не спрашивает', () => {
    press(mountMasked(), 'auxclick', 1)

    const clone = popup()!.querySelector<HTMLAnchorElement>('.popup-description a')!
    expect(clone.href).toBe('https://evil.example/')
    expect(clone.hasAttribute('data-anchor-action')).toBe(false)

    const clicked = vi.spyOn(clone, 'click').mockImplementation(() => {})
    const open = Array.from(popup()!.querySelectorAll<HTMLElement>('.popup-button')).find((b) => b.textContent === 'Open')!
    open.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('правая кнопка и уже отменённый клик — не наши', () => {
    const anchor = mountMasked()
    expect(press(anchor, 'auxclick', 2).defaultPrevented).toBe(false)

    anchor.addEventListener('auxclick', (e) => e.preventDefault(), { once: true })
    press(anchor, 'auxclick', 1)
    expect(popup()).toBeNull()
  })
})
