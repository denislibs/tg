// Вынос клиента в Document PiP — порт tweb `components/clientPip.tsx`
// (812502980), `components/clientPip.solid.tsx`. Окно PiP — фейк: второй
// документ happy-dom + `EventTarget` для `pagehide`; `close()` шлёт
// `pagehide`, как настоящее окно при закрытии.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delegateEvents } from 'solid-js/web'
import { getAppWindow, getOverlayRoot, onAppWindowChange, setAppWindow } from '@helpers/appWindow'

const reRender = vi.hoisted(() => vi.fn(async() => {}))
vi.mock('@components/chat/bubbles/chatBackground.solid', () => ({ default: { reRender } }))
vi.mock('@environment/documentPictureInPictureSupport', () => ({ default: true }))

const { default: openClientPip, closeClientPip, isClientPipOpen, moveAppBack, moveAppToWindow } =
  await import('./clientPip.solid')

type FakePip = Window & { close: ReturnType<typeof vi.fn>, focus: ReturnType<typeof vi.fn> }

function fakePipWindow(): FakePip {
  const target = new EventTarget()
  const doc = document.implementation.createHTMLDocument('pip')
  const close = vi.fn(() => { target.dispatchEvent(new Event('pagehide')) })
  return Object.assign(target, { document: doc, close, focus: vi.fn() }) as unknown as FakePip
}

let pip: FakePip
let pageChats: HTMLElement
let overlay: HTMLElement
let script: HTMLScriptElement
let visibility: DocumentVisibilityState
let requestWindow: ReturnType<typeof vi.fn>

beforeEach(() => {
  document.body.replaceChildren()
  overlay = document.createElement('div')
  overlay.className = 'sidebar-left-overlay'
  pageChats = document.createElement('div')
  pageChats.id = 'page-chats'
  script = document.createElement('script')
  document.body.append(overlay, pageChats, script)
  pip = fakePipWindow()
  requestWindow = vi.fn(async() => pip)
  vi.stubGlobal('documentPictureInPicture', { requestWindow, window: null })
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  reRender.mockClear()
})

afterEach(() => {
  moveAppBack()
  document.body.replaceChildren()
  setAppWindow(window)
  vi.unstubAllGlobals()
})

describe('moveAppToWindow (tweb clientPip.tsx:46-99)', () => {
  it('переносит все узлы body, кроме <script>, и ставит в их места комментарии', () => {
    expect(moveAppToWindow(pip)).toBe(true)

    expect(isClientPipOpen()).toBe(true)
    expect(pip.document.body.contains(pageChats)).toBe(true)
    expect(pip.document.body.contains(overlay)).toBe(true)
    expect(script.ownerDocument).toBe(document)
    expect(Array.from(document.body.childNodes).filter((n) => n.nodeType === Node.COMMENT_NODE)).toHaveLength(2)
    expect(reRender).toHaveBeenCalledOnce()
  })

  it('при уже открытом выносе — false, второе окно не трогается', () => {
    expect(moveAppToWindow(pip)).toBe(true)
    const second = fakePipWindow()
    expect(moveAppToWindow(second)).toBe(false)
    expect(getAppWindow()).toBe(pip)
    expect(second.document.body.childElementCount).toBe(0)
  })

  it('окно переключается ДО переноса узлов — в обе стороны (tweb :60-62, :118)', () => {
    const seen: Array<{ win: Window, rootIn: Document }> = []
    const off = onAppWindowChange((win) => seen.push({ win, rootIn: pageChats.ownerDocument }))

    moveAppToWindow(pip)
    expect(getOverlayRoot()).toBe(pip.document.body)
    moveAppBack()
    off()

    expect(seen).toEqual([
      { win: pip, rootIn: document },
      { win: window, rootIn: pip.document },
    ])
    expect(getOverlayRoot()).toBe(document.body)
  })

  // Таблицы стилей happy-dom не зеркалит: у его `CSSStyleSheet` нет `ownerNode`,
  // а `mirrorDocumentStyles` ключуется именно им (tweb `mirrorDocumentStyles.ts:26-27`).
  it('тема (`data-theme`) и классы body зеркалятся в документ PiP; сброс html/body', () => {
    document.documentElement.setAttribute('data-theme', 'night')
    document.body.classList.add('has-chat')
    try {
      moveAppToWindow(pip)
      const css = Array.from(pip.document.head.querySelectorAll('style')).map((s) => s.textContent).join('\n')
      expect(css).toContain('html,body{margin:0')
      expect(pip.document.documentElement.getAttribute('data-theme')).toBe('night')
      expect(pip.document.body.classList.contains('has-chat')).toBe(true)
    } finally {
      document.documentElement.removeAttribute('data-theme')
      document.body.classList.remove('has-chat')
    }
  })

  it('onClick Solid-узла, перенесённого в PiP, срабатывает (tweb :78-84)', () => {
    delegateEvents(['click'])
    const button = document.createElement('button') as HTMLButtonElement & { $$click?: () => void }
    const onClick = vi.fn()
    button.$$click = onClick
    pageChats.append(button)

    moveAppToWindow(pip)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('во вкладке — заглушка; её кнопка зовёт onReturn (tweb :86-90)', () => {
    const onReturn = vi.fn()
    moveAppToWindow(pip, onReturn)

    const button = document.body.querySelector<HTMLButtonElement>('button.btn-primary')!
    expect(button).not.toBeNull()
    button.click()
    expect(onReturn).toHaveBeenCalledOnce()
  })
})

describe('moveAppBack (tweb clientPip.tsx:102-127)', () => {
  it('узлы встают на прежние места, комментарии и заглушка уходят', () => {
    const before = Array.from(document.body.childNodes)
    moveAppToWindow(pip)
    moveAppBack()

    expect(Array.from(document.body.childNodes)).toEqual(before)
    expect(isClientPipOpen()).toBe(false)
    expect(reRender).toHaveBeenCalledTimes(2)
  })

  it('корень, открытый в выносе в getOverlayRoot(), возвращается во вкладку (tweb :106-120)', () => {
    moveAppToWindow(pip)
    const popup = getOverlayRoot().ownerDocument.createElement('div')
    getOverlayRoot().append(popup)

    moveAppBack()
    expect(popup.parentElement).toBe(document.body)
  })
})

describe('openClientPip (tweb clientPip.tsx:147-192)', () => {
  it('просит окно 430×760 и выносит клиент; повторный вызов — фокус окна', async() => {
    await openClientPip()
    expect(requestWindow).toHaveBeenCalledWith({ width: 430, height: 760 })
    expect(pageChats.ownerDocument).toBe(pip.document)

    await openClientPip()
    expect(pip.focus).toHaveBeenCalledOnce()
    expect(requestWindow).toHaveBeenCalledOnce()
  })

  it('отказ окна — клиент на месте', async() => {
    vi.stubGlobal('documentPictureInPicture', { requestWindow: vi.fn(async() => { throw new Error('denied') }), window: null })
    await openClientPip()
    expect(isClientPipOpen()).toBe(false)
    expect(getOverlayRoot()).toBe(document.body)
  })

  it('закрытие окна системной кнопкой (`pagehide`) возвращает клиент', async() => {
    await openClientPip()
    pip.dispatchEvent(new Event('pagehide'))
    expect(isClientPipOpen()).toBe(false)
    expect(pageChats.ownerDocument).toBe(document)
  })

  it('уход со вкладки и возврат на неё — клиент возвращается, окно закрывается', async() => {
    await openClientPip()
    document.dispatchEvent(new Event('visibilitychange')) // видима — уходом не считается
    expect(isClientPipOpen()).toBe(true)

    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(isClientPipOpen()).toBe(true)

    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(isClientPipOpen()).toBe(false)
    expect(pip.close).toHaveBeenCalled()
  })

  it('кнопка заглушки возвращает клиент и закрывает окно', async() => {
    await openClientPip()
    document.body.querySelector<HTMLButtonElement>('button.btn-primary')!.click()
    expect(isClientPipOpen()).toBe(false)
    expect(pip.close).toHaveBeenCalled()
  })
})

describe('closeClientPip (tweb clientPip.tsx:134-140)', () => {
  it('возвращает клиент и закрывает окно; подписки на вкладку сняты', async() => {
    await openClientPip()
    closeClientPip()
    expect(isClientPipOpen()).toBe(false)
    expect(pip.close).toHaveBeenCalledOnce()

    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(pip.close).toHaveBeenCalledOnce()
  })
})
