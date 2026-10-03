// Контейнер React-порталов переживает вынос клиента в Document PiP
// (`components/clientPip.solid.tsx`): узел-хозяин переезжает целиком, а цель
// портала у React не меняется — ни двойного переноса, ни `removeChild` не у
// того родителя.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { getOverlayRoot, setAppWindow } from '@helpers/appWindow'
import { usePortalContainer } from './usePortalContainer'

vi.mock('@components/chat/bubbles/chatBackground.solid', () => ({ default: { reRender: async() => {} } }))

const { moveAppBack, moveAppToWindow } = await import('@components/clientPip.solid')

function fakePipWindow(): Window {
  const target = new EventTarget()
  const doc = document.implementation.createHTMLDocument('pip')
  return Object.assign(target, { document: doc, close: () => {} }) as unknown as Window
}

let setOpen!: (open: boolean) => void
function Portaled() {
  const [open, set] = useState(false)
  setOpen = set
  return createPortal(open ? <div data-portal="" /> : null, usePortalContainer())
}

let pip: Window
let reactRoot: Root
let errors: unknown[]
const onError = (e: ErrorEvent) => { errors.push(e.error) }

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  document.body.replaceChildren()
  const pageChats = document.createElement('div')
  pageChats.id = 'page-chats'
  const host = document.createElement('div')
  pageChats.append(host)
  document.body.append(pageChats)
  pip = fakePipWindow()
  errors = []
  window.addEventListener('error', onError)
  act(() => {
    reactRoot = createRoot(host)
    reactRoot.render(<Portaled />)
  })
})

afterEach(() => {
  act(() => reactRoot.unmount())
  window.removeEventListener('error', onError)
  moveAppBack()
  document.body.replaceChildren()
  setAppWindow(window)
})

describe('usePortalContainer — узел-хозяин в body активного окна', () => {
  it('открытый до выноса портал уезжает в PiP и закрывается там без исключения', () => {
    act(() => setOpen(true))
    expect(document.body.querySelectorAll('[data-portal]')).toHaveLength(1)

    moveAppToWindow(pip)
    expect(pip.document.body.querySelectorAll('[data-portal]')).toHaveLength(1)

    act(() => setOpen(false))
    expect(errors).toEqual([])
    expect(pip.document.body.querySelectorAll('[data-portal]')).toHaveLength(0)
  })

  it('открытый в выносе портал возвращается во вкладку и закрывается там без исключения', () => {
    moveAppToWindow(pip)
    act(() => setOpen(true))
    expect(getOverlayRoot().querySelectorAll('[data-portal]')).toHaveLength(1)

    moveAppBack()
    expect(document.body.querySelectorAll('[data-portal]')).toHaveLength(1)
    expect(pip.document.body.querySelectorAll('[data-portal]')).toHaveLength(0)

    act(() => setOpen(false))
    expect(errors).toEqual([])
    expect(document.body.querySelectorAll('[data-portal]')).toHaveLength(0)
  })
})
