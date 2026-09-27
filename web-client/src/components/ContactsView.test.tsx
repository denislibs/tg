// Экран «Контакты» (бургер → Контакты) — АДРЕСНАЯ КНИГА.
//
// Жалоба: в контактах были «Telegram» (служебные уведомления, 777000),
// «Избранное» и вообще все, с кем была переписка, — экран собирал список из
// личных диалогов. У tweb `ContactsList` читает `getContactsPeerIds(query,
// false)` — только книгу `contacts.getContacts`, без себя
// (`sidebarLeft/contactsList.tsx`, `appUsersManager.ts:454-503`).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import ContactsView from './ContactsView'
import { ManagersProvider } from '../core/hooks/useManagers'
import type { Managers } from '../client/bootstrap'
import { applyPeerOps, resetPeerMirror } from '../core/peerCache'
import { useChatsStore } from '../stores/chatsStore'
import { makeDialog } from '../core/dialogs/testDialog'

const ME = 100
const SERVICE = 777000

afterEach(cleanup)

function mount(book: PeerId[]) {
  const getContactsPeerIds = vi.fn(async (query?: string) =>
    query ? book.filter((id) => id === 11) : book)
  const presenceGet = vi.fn(async (ids: number[]) => ids.map((user_id) => ({ user_id, status: { _: 'userStatusRecently' as const } })))
  const managers = {
    contacts: { getContactsPeerIds },
    presence: { get: presenceGet },
    media: { downloadMediaURL: vi.fn(async () => '') },
    peers: { fillMirror: vi.fn(async () => {}) },
  } as unknown as Managers
  const onOpen = vi.fn()
  const view = render(
    <ManagersProvider managers={managers}>
      <ContactsView onOpenPeer={onOpen} onBack={() => {}} />
    </ManagersProvider>,
  )
  return { ...view, getContactsPeerIds, presenceGet, onOpen }
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-peer-id]')).map((el) => Number(el.dataset.peerId))

describe('ContactsView — только адресная книга', () => {
  beforeEach(() => {
    resetPeerMirror()
    applyPeerOps([{
      op: 'upsert',
      peers: [
        { _: 'user', id: 11, first_name: 'Борис', pFlags: { contact: true } },
        { _: 'user', id: 12, first_name: 'Анна', pFlags: { contact: true } },
        { _: 'user', id: 13, first_name: 'Собеседник', pFlags: {} },
        { _: 'user', id: SERVICE, first_name: 'Telegram', pFlags: { verified: true } },
        { _: 'user', id: ME, first_name: 'Я', pFlags: { self: true } },
      ],
    }])
    // Личные диалоги есть со всеми — экран не должен из них собирать список.
    useChatsStore.setState({
      meId: ME,
      dialogs: [13, SERVICE, ME, 11].map((peerId) => makeDialog({ peerId })),
    })
  })

  afterEach(() => useChatsStore.setState({ meId: null, dialogs: [] }))

  it('показывает контакты книги и никого сверх неё (ни Telegram, ни Избранное, ни собеседников)', async () => {
    const { getContactsPeerIds } = mount([12, 11])

    await waitFor(() => expect(rows()).toEqual([12, 11]))
    expect(getContactsPeerIds).toHaveBeenCalledWith('', false)
    expect(document.body.textContent).not.toContain('Telegram')
    expect(document.body.textContent).not.toContain('Собеседник')
    expect(document.body.textContent).not.toContain('Избранное')
  })

  it('присутствие контакта без диалога досевается (у tweb статус едет на карточке книги)', async () => {
    useChatsStore.setState({ presence: { 11: { _: 'userStatusRecently' } } })
    const { presenceGet } = mount([12, 11])

    await waitFor(() => expect(presenceGet).toHaveBeenCalledWith([12]))
    useChatsStore.setState({ presence: {} })
  })

  it('пустая книга — пустой экран, а не личные диалоги', async () => {
    const { getContactsPeerIds } = mount([])

    await waitFor(() => expect(getContactsPeerIds).toHaveBeenCalled())
    await waitFor(() => expect(document.body.textContent).toContain('No contacts found'))
    expect(rows()).toEqual([])
  })

  it('поиск — индексом книги (getContactsPeerIds(query))', async () => {
    const { getContactsPeerIds } = mount([12, 11])
    await waitFor(() => expect(rows()).toEqual([12, 11]))

    fireEvent.change(document.querySelector('input')!, { target: { value: 'Бор' } })

    await waitFor(() => expect(rows()).toEqual([11]))
    expect(getContactsPeerIds).toHaveBeenLastCalledWith('Бор', false)
  })

  it('клик открывает пира контакта (setListClickListener → setPeer)', async () => {
    const { onOpen } = mount([11])
    await waitFor(() => expect(rows()).toEqual([11]))

    fireEvent.click(document.querySelector('[data-peer-id="11"]')!)

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 11, title: 'Борис' }))
  })
})
