// ── ПИН tweb 812502980: «Добавить в контакты» в ⋮ шапки — только не-контакту ──
//
// tweb `topbar.ts:605-610`: пункт `AddContact` с verify
// `!isBot && isUser && !appPeersManager.isContact(peerId)` — у того, кто уже в
// книге (или пришёл с `pFlags.contact`), пункта нет. Прежде наш `HeaderMenu`
// показывал его в любой личке, кроме сервисного аккаунта.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../core/hooks/useHeaderMenuActions', () => ({
  useHeaderMenuActions: () => ({ blocked: false, toggleBlock: () => {}, setChatTtl: () => {} }),
}))

let isContact: boolean | undefined
vi.mock('../core/hooks/useIsContact', () => ({
  useIsContact: () => isContact,
}))

import { applyPeerOps, resetPeerMirror } from '../core/peerCache'
import { applyLang } from '../test/lang'
import type { Chat } from '../data'
import HeaderMenu from './HeaderMenu'

const PEER = 42

function renderMenu() {
  const chat: Chat = { id: String(PEER), name: 'Пир', avatar: '', preview: '', type: 'private' }
  render(<HeaderMenu chat={chat} anchor={{ top: 0, right: 0 }} onClose={() => {}} onAddContact={() => {}} />)
}

beforeEach(async () => {
  await applyLang('en')
  applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: PEER, first_name: 'Боб', pFlags: {} }] }])
})

afterEach(() => {
  cleanup()
  resetPeerMirror()
})

describe('HeaderMenu: «Добавить в контакты» (tweb topbar.ts:605-610)', () => {
  it('не контакт — пункт есть', () => {
    isContact = false
    renderMenu()
    expect(screen.queryByText('Add to contacts')).not.toBeNull()
  })

  it('уже контакт — пункта нет', () => {
    isContact = true
    renderMenu()
    expect(screen.queryByText('Add to contacts')).toBeNull()
  })

  it('ответ ещё не пришёл — пункта нет', () => {
    isContact = undefined
    renderMenu()
    expect(screen.queryByText('Add to contacts')).toBeNull()
  })

  it('бот — пункта нет', () => {
    isContact = false
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: PEER, first_name: 'Бот', pFlags: { bot: true } }] }])
    renderMenu()
    expect(screen.queryByText('Add to contacts')).toBeNull()
  })
})
