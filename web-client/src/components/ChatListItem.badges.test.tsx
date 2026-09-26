// ── ПИН tweb 08d07c2b4: «@» и отдельный бейдж упоминаний взаимоисключающи ────
//
// Строка чата показывает упоминание ОДНИМ из двух способов: либо бейдж
// непрочитанного сам становится «@» (всё непрочитанное — одно упоминание),
// либо рядом со счётчиком стоит отдельный бейдж «@». Никогда оба сразу
// (tweb `helpers/dialogMentionBadgeState.ts`). До порта строка рисовала «@»
// при ЛЮБОМ `unreadMentions` и число рядом — расходилась и со старым tweb:
// unread=1 + упоминание давало «@» и «1» вместо одного «@».
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ManagersProvider } from '../core/hooks/useManagers'
import { applyLang } from '../test/lang'
import type { Chat } from '../data'
import ChatListItem from './ChatListItem'

const chat: Chat = {
  id: '1',
  name: 'Пир',
  avatar: '',
  preview: 'привет',
  type: 'group',
}

const managers = { peers: { fillMirror: async () => {} } } as never

function renderRow(over: Partial<Chat>) {
  render(
    <ManagersProvider managers={managers}>
      <ChatListItem chat={{ ...chat, ...over }} selected={false} onSelect={() => {}} />
    </ManagersProvider>,
  )
  return {
    unread: document.querySelector<HTMLElement>('.dialog-subtitle-badge-unread'),
    mention: document.querySelector<HTMLElement>('.dialog-subtitle-badge-mention'),
  }
}

beforeEach(async () => {
  await applyLang('en')
})

afterEach(() => {
  cleanup()
})

describe('бейджи упоминаний в строке чата (tweb 08d07c2b4)', () => {
  it('всё непрочитанное — одно упоминание: бейдж непрочитанного становится «@», отдельного нет', () => {
    const { unread, mention } = renderRow({ unread: 1, unreadMentions: 1 })
    expect(unread?.textContent).toBe('@')
    // tweb appDialogsManager.ts:668 — `unreadBadge.classList.toggle('mention', isMention)`
    expect(unread?.classList.contains('mention')).toBe(true)
    expect(mention).toBeNull()
  })

  it('непрочитанного больше, чем упоминание: счётчик остаётся, рядом отдельный «@»', () => {
    const { unread, mention } = renderRow({ unread: 5, unreadMentions: 1 })
    expect(unread?.textContent).toBe('5')
    expect(unread?.classList.contains('mention')).toBe(false)
    expect(mention?.textContent).toBe('@')
  })

  it('без упоминаний — только счётчик', () => {
    const { unread, mention } = renderRow({ unread: 4 })
    expect(unread?.textContent).toBe('4')
    expect(mention).toBeNull()
  })

  it('одно старое упоминание без непрочитанного — бейджей нет (1 > 1 ложно у оригинала)', () => {
    const { unread, mention } = renderRow({ unreadMentions: 1 })
    expect(unread).toBeNull()
    expect(mention).toBeNull()
  })

  it('старые упоминания без непрочитанного — отдельный бейдж «@» (их > 1)', () => {
    const { unread, mention } = renderRow({ unreadMentions: 2 })
    expect(unread).toBeNull()
    expect(mention?.textContent).toBe('@')
  })
})
