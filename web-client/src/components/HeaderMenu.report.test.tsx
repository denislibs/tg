// ── ПИН tweb 2488f2cf0: «Пожаловаться» в ⋮-меню лички — только у бота ─────────
//
// tweb `topbar.ts::verifyReport` (812502980): для пользователя пункт решает
// `canReportBot`, у обычного собеседника жалобы в меню нет. До порта наш
// `HeaderMenu` показывал «Report» в любой личке, кроме сервисного аккаунта.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../core/hooks/useHeaderMenuActions', () => ({
  useHeaderMenuActions: () => ({ blocked: false, toggleBlock: () => {}, setChatTtl: () => {} }),
}))

import { applyPeerOps, resetPeerMirror } from '../core/peerCache'
import { applyLang } from '../test/lang'
import type { Chat } from '../data'
import HeaderMenu from './HeaderMenu'

const PEER = 42

function renderMenu() {
  const chat: Chat = { id: String(PEER), name: 'Пир', avatar: '', preview: '', type: 'private' }
  render(<HeaderMenu chat={chat} anchor={{ top: 0, right: 0 }} onClose={() => {}} />)
}

beforeEach(async () => {
  await applyLang('en')
})

afterEach(() => {
  cleanup()
  resetPeerMirror()
})

describe('HeaderMenu: «Пожаловаться» в личке (tweb 2488f2cf0)', () => {
  it('у бота пункт есть', () => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: PEER, first_name: 'Бот', pFlags: { bot: true } }] }])
    renderMenu()
    expect(screen.queryByText('Report')).not.toBeNull()
  })

  it('у обычного пользователя пункта нет', () => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: PEER, first_name: 'Человек', pFlags: {} }] }])
    renderMenu()
    expect(screen.queryByText('Report')).toBeNull()
  })
})
