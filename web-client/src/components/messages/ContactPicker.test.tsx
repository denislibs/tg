// Выбор контакта для отправки (скрепка → «Контакт») — порт
// `showContactPickerPopup` (tweb `popups/pickUser.tsx:838-856`, `peerType:
// ['contacts']`): только адресная книга. Прежде в списке были все собеседники
// личных диалогов — «Избранное», служебный «Telegram», боты.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { ContactPicker } from './ChatDialogs'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'
import { applyPeerOps, resetPeerMirror } from '../../core/peerCache'

afterEach(cleanup)

describe('ContactPicker — адресная книга', () => {
  beforeEach(() => {
    resetPeerMirror()
    applyPeerOps([{
      op: 'upsert',
      peers: [
        { _: 'user', id: 11, first_name: 'Борис', pFlags: { contact: true } },
        { _: 'user', id: 777000, first_name: 'Telegram', pFlags: { verified: true } },
      ],
    }])
  })

  it('строки — только контакты книги', async () => {
    const getContactsPeerIds = vi.fn(async () => [11])
    const managers = {
      contacts: { getContactsPeerIds },
      peers: { fillMirror: vi.fn(async () => {}) },
    } as unknown as Managers
    render(
      <ManagersProvider managers={managers}>
        <ContactPicker onPick={() => {}} onClose={() => {}} />
      </ManagersProvider>,
    )

    await waitFor(() => expect(Array.from(document.querySelectorAll<HTMLElement>('[data-peer-id]')).map((el) => el.dataset.peerId)).toEqual(['11']))
    expect(getContactsPeerIds).toHaveBeenCalledWith('', false)
    expect(document.body.textContent).not.toContain('Telegram')
  })
})
