// «Новое сообщение» / «Новый секретный чат» — выбор собеседника из адресной
// книги. У tweb кнопка `newprivate` открывает `AppContactsTab`
// (`sidebarLeft/index.ts:1039`): тот же список контактов, без себя, служебного
// «Telegram» и собеседников вне книги. Прежде экран собирал людей из личных
// диалогов и ботов.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import NewPrivateChat from './NewPrivateChat'
import { ManagersProvider } from '../core/hooks/useManagers'
import type { Managers } from '../client/bootstrap'
import { applyPeerOps, resetPeerMirror } from '../core/peerCache'
import { useChatsStore } from '../stores/chatsStore'
import { makeDialog } from '../core/dialogs/testDialog'

afterEach(cleanup)

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-peer-id]')).map((el) => Number(el.dataset.peerId))

describe('NewPrivateChat — адресная книга', () => {
  beforeEach(() => {
    resetPeerMirror()
    applyPeerOps([{
      op: 'upsert',
      peers: [
        { _: 'user', id: 11, first_name: 'Борис', pFlags: { contact: true } },
        { _: 'user', id: 13, first_name: 'Собеседник', pFlags: {} },
        { _: 'user', id: 14, first_name: 'Бот', pFlags: { bot: true } },
        { _: 'user', id: 777000, first_name: 'Telegram', pFlags: { verified: true } },
      ],
    }])
    useChatsStore.setState({ dialogs: [13, 14, 777000, 11].map((peerId) => makeDialog({ peerId })) })
  })

  afterEach(() => useChatsStore.setState({ dialogs: [] }))

  it('строки — контакты книги, клик отдаёт пира и закрывает экран', async () => {
    const getContactsPeerIds = vi.fn(async () => [11])
    const managers = {
      contacts: { getContactsPeerIds },
      media: { downloadMediaURL: vi.fn(async () => '') },
      peers: { fillMirror: vi.fn(async () => {}) },
    } as unknown as Managers
    const onPick = vi.fn()
    const onClose = vi.fn()
    render(
      <ManagersProvider managers={managers}>
        <NewPrivateChat onPick={onPick} onClose={onClose} />
      </ManagersProvider>,
    )

    await waitFor(() => expect(rows()).toEqual([11]))
    expect(getContactsPeerIds).toHaveBeenCalledWith('', false)
    expect(document.body.textContent).not.toContain('Telegram')
    expect(document.body.textContent).not.toContain('Собеседник')

    fireEvent.click(document.querySelector('[data-peer-id="11"]')!)
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 11, title: 'Борис' }))
    expect(onClose).toHaveBeenCalled()
  })
})
