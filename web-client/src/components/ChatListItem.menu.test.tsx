// ── Пин: контекстное меню строки чатлиста создаётся по требованию ────────────
//
// На стенде в body висели скрытые `.btn-menu` — по одному на КАЖДУЮ строку
// списка чатов, даже без правого клика: общий `shared/ui/Menu` рендерил панель
// всегда, а строка (`ChatListItem.tsx`) держит свой `<Menu>`. У tweb меню
// диалога собирается на открытии и снимается после закрытия
// (`helpers/dom/createContextMenu.ts::init` — `ButtonMenu` + `append`, закрытие
// — `destroy()` → `_element.remove()` через 300 мс, :143-147; так же
// `buttonMenuToggle.ts:171-220`).
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ManagersProvider } from '../core/hooks/useManagers'
import { applyLang } from '../test/lang'
import type { Chat } from '../data'
import ChatListItem from './ChatListItem'

const managers = { peers: { fillMirror: async () => {} } } as never

const N = 5
const chats: Chat[] = Array.from({ length: N }, (_, i) => ({
  id: String(i + 1),
  name: 'Пир ' + (i + 1),
  avatar: '',
  preview: 'привет',
  type: 'private',
  date: 0,
}))

function renderList() {
  return render(
    <ManagersProvider managers={managers}>
      {chats.map((chat) => (
        <ChatListItem key={chat.id} chat={chat} selected={false} onSelect={() => {}} />
      ))}
    </ManagersProvider>,
  )
}

const menus = () => document.body.querySelectorAll('.btn-menu')

beforeEach(async () => {
  await applyLang('en')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('контекстное меню строки чатлиста', () => {
  it(`после рендера ${N} строк в body нет ни одного меню`, () => {
    renderList()

    expect(document.querySelectorAll('[data-peer-id]').length).toBe(N)
    expect(menus().length).toBe(0)
  })

  it('правый клик создаёт одно меню, закрытие снимает его из DOM', () => {
    vi.useFakeTimers()
    renderList()
    const row = document.querySelector<HTMLElement>('[data-peer-id="3"]')!

    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 })
    expect(menus().length).toBe(1)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    // панель доигрывает закрытие (фолбэк Menu — 300 мс, как у tweb)
    expect(menus().length).toBe(1)
    act(() => { vi.advanceTimersByTime(300) })
    expect(menus().length).toBe(0)
  })
})
