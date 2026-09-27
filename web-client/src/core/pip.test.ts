// Вынос клиента в Document PiP (`enterAppPip`) — единственный писатель
// активного окна (`helpers/appWindow.ts`), как у tweb `components/clientPip.tsx`
// (812502980) `moveAppToWindow`/`moveAppBack`. Окно PiP — фейк: второй документ
// happy-dom + `EventTarget` для `pagehide`; `close()` шлёт `pagehide`, как
// настоящее окно при закрытии.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, act } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { delegateEvents } from 'solid-js/web'
import { getOverlayRoot, onAppWindowChange, setAppWindow } from '@helpers/appWindow'
import { enterAppPip, usePipStore, usePortalContainer } from './pip'

const LABELS = { title: 't', hint: 'h', back: 'b' }

type FakePip = Window & { close: () => void }

function fakePipWindow(): FakePip {
  const target = new EventTarget()
  const doc = document.implementation.createHTMLDocument('pip')
  return Object.assign(target, {
    document: doc,
    close: () => { target.dispatchEvent(new Event('pagehide')) },
  }) as unknown as FakePip
}

let pip: FakePip
let root: HTMLElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  root = document.createElement('div')
  root.id = 'root'
  document.body.append(root)
  pip = fakePipWindow()
  vi.stubGlobal('documentPictureInPicture', { requestWindow: vi.fn(async() => pip), window: null })
})

afterEach(() => {
  pip.close() // вернуть клиент, если тест не вернул сам (restore идемпотентен)
  root.remove()
  document.body.replaceChildren()
  setAppWindow(window)
  vi.unstubAllGlobals()
})

describe('enterAppPip — писатель активного окна (tweb clientPip.tsx:62, :118)', () => {
  it('в выносе корень оверлеев — body окна PiP; после pagehide — снова body вкладки', async() => {
    expect(await enterAppPip(LABELS)).toBe(true)
    expect(root.ownerDocument).toBe(pip.document)
    expect(getOverlayRoot()).toBe(pip.document.body)

    pip.dispatchEvent(new Event('pagehide'))
    expect(root.ownerDocument).toBe(document)
    expect(getOverlayRoot()).toBe(document.body)
  })

  it('окно переключается ДО переноса узлов — в обе стороны (tweb :60-62, :118)', async() => {
    const seen: Array<{ win: Window, rootIn: Document }> = []
    const off = onAppWindowChange((win) => seen.push({ win, rootIn: root.ownerDocument }))

    await enterAppPip(LABELS)
    pip.close()
    off()

    expect(seen).toEqual([
      { win: pip, rootIn: document },
      { win: window, rootIn: pip.document },
    ])
  })

  it('один писатель двух читательских форм: usePipStore.win и активное окно меняются вместе', async() => {
    const seen: Array<Window | null> = []
    const off = onAppWindowChange(() => seen.push(usePipStore.getState().win))

    await enterAppPip(LABELS)
    pip.close()
    off()

    expect(seen).toEqual([pip, null])
  })

  it('отказ окна PiP — активное окно не трогается', async() => {
    vi.stubGlobal('documentPictureInPicture', { requestWindow: vi.fn(async() => { throw new Error('denied') }), window: null })
    expect(await enterAppPip(LABELS)).toBe(false)
    expect(getOverlayRoot()).toBe(document.body)
  })
})

describe('возврат временных корней (tweb clientPip.tsx:104-111, :120)', () => {
  it('оверлей, открытый в выносе в getOverlayRoot(), возвращается во вкладку, а не гибнет с окном', async() => {
    await enterAppPip(LABELS)
    const overlay = document.createElement('div')
    getOverlayRoot().append(overlay)
    expect(overlay.ownerDocument).toBe(pip.document)

    pip.close()
    expect(overlay.parentElement).toBe(document.body)
  })

  it('React-портал usePortalContainer перенацеливает сам React — без двойного переноса и без исключения', async() => {
    const host = document.createElement('div')
    root.append(host)
    function Portaled() {
      return createPortal(createElement('div', { 'data-portal': '' }), usePortalContainer())
    }
    let reactRoot!: Root
    act(() => {
      reactRoot = createRoot(host)
      reactRoot.render(createElement(Portaled))
    })
    expect(document.body.querySelectorAll('[data-portal]')).toHaveLength(1)

    await act(async() => { await enterAppPip(LABELS) })
    expect(pip.document.body.querySelectorAll('[data-portal]')).toHaveLength(1)

    const errors: unknown[] = []
    const onError = (e: ErrorEvent) => { errors.push(e.error) }
    window.addEventListener('error', onError)
    act(() => { pip.close() })
    window.removeEventListener('error', onError)

    expect(errors).toEqual([])
    expect(document.body.querySelectorAll('[data-portal]')).toHaveLength(1)
    expect(pip.document.body.querySelectorAll('[data-portal]')).toHaveLength(0)
    act(() => reactRoot.unmount())
  })
})

describe('делегированные события Solid в окне PiP (tweb clientPip.tsx:76-83)', () => {
  it('onClick Solid-узла, перенесённого в PiP, срабатывает', async() => {
    delegateEvents(['click'])
    const button = document.createElement('button') as HTMLButtonElement & { $$click?: () => void }
    const onClick = vi.fn()
    button.$$click = onClick
    root.append(button)

    await enterAppPip(LABELS)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
