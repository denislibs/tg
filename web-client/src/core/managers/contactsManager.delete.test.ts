// Удаление контакта — порт tweb `appUsersManager.deleteContacts` (812502980
// `:1310-1320`): ответ `contacts.deleteContacts` — Updates с этим user уже
// БЕЗ `pFlags.contact` и с профильным именем; оригинал кладёт его в кэш
// (`processUpdateMessage`), потом `onContactUpdated(false)`. Без этого в кэше
// оставалась карточка «контакта» с именем из книги, и `isContact` (книга ИЛИ
// флаг карточки) продолжал отвечать «да» — пункт «Добавить в контакты» не
// возвращался.
import { describe, expect, it, vi } from 'vitest'
import { newContactsManager, type ContactsContacts } from './contactsManager'
import type { User, Chat, UserReal } from '../peers/peer'

const BOB = 2

describe('contactsManager.del — карточка из ответа ложится в кэш', () => {
  it('после удаления: профильное имя, без contact, isContact = false', async () => {
    const cards = new Map<PeerId, User | Chat>()
    const asContact: UserReal = { _: 'user', id: BOB, first_name: 'Бобби', pFlags: { contact: true } }
    const asStranger: UserReal = { _: 'user', id: BOB, first_name: 'Боб', last_name: 'Петров' }
    const book: ContactsContacts = {
      _: 'contacts.contacts',
      contacts: [{ _: 'contact', user_id: BOB, mutual: { _: 'boolFalse' } }],
      saved_count: 0,
      users: [asContact],
    }
    const del = vi.fn(async (_path: string) => ({ _: 'updates', updates: [], users: [asStranger], chats: [], date: 0, seq: 0 }))
    const onContactsUpdate = vi.fn()
    const mgr = newContactsManager({
      rest: { get: vi.fn(async () => book), post: vi.fn(), del, put: vi.fn() } as never,
      peers: {
        saveApiPeers: (o) => { for (const u of o?.users ?? []) cards.set(u.id, u) },
        cachedPeer: (id) => cards.get(id),
      },
      getMe: () => null,
      state: { getState: async () => ({}), pushToState: async () => {} },
      onContactsUpdate,
    })

    expect(await mgr.isContact(BOB)).toBe(true)
    await mgr.del(BOB)

    expect(del).toHaveBeenCalledWith(`/contacts/${BOB}`)
    expect(cards.get(BOB)).toEqual(asStranger)
    expect(await mgr.isContact(BOB)).toBe(false)
    expect(onContactsUpdate).toHaveBeenCalledWith(BOB)
  })
})
