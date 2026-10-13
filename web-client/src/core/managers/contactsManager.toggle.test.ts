// Вход `onContactUpdated` для владельца карточек — порт tweb `onContactUpdated`
// (812502980 `appUsersManager.ts:1216-1228`): контакт вошёл в книгу или вышел
// из неё карточкой (`saveApiUser` :738-754), а не ответом на add/del. Так
// второе устройство узнаёт о контакте из кадра user_update.
import { describe, expect, it, vi } from 'vitest'
import { newContactsManager, type ContactsContacts } from './contactsManager'
import type { User, Chat, UserReal } from '../peers/peer'

const BOB = 2
const bob: UserReal = { _: 'user', id: BOB, first_name: 'Бобби', pFlags: { contact: true } }

function stand(users: UserReal[] = []) {
  const cards = new Map<number, User | Chat>(users.map((u) => [u.id, u]))
  const book: ContactsContacts = { _: 'contacts.contacts', contacts: [], saved_count: 0, users: [] }
  const onContactsUpdate = vi.fn()
  const mgr = newContactsManager({
    rest: { get: vi.fn(async () => book), post: vi.fn(), del: vi.fn(), put: vi.fn() } as never,
    peers: {
      saveApiPeers: (o) => { for (const u of o?.users ?? []) cards.set(u.id, u) },
      cachedPeer: (id) => cards.get(id),
    },
    getMe: () => null,
    state: { getState: async () => ({}), pushToState: async () => {} },
    onContactsUpdate,
  })
  return { mgr, onContactsUpdate }
}

describe('contactsManager.onContactUpdated — контакт пришёл карточкой', () => {
  it('вошёл: в индекс и список, событие contacts_update', async () => {
    const { mgr, onContactsUpdate } = stand([bob])
    await mgr.list() // книга прочитана (пустая) — дальше её двигает только карточка

    mgr.onContactUpdated(BOB, true, false)

    expect(onContactsUpdate).toHaveBeenCalledExactlyOnceWith(BOB)
    expect(await mgr.getContactsPeerIds('Бобб', false, 'none')).toEqual([BOB])
  })

  it('повтор с тем же состоянием молчит (идемпотентно)', () => {
    const { mgr, onContactsUpdate } = stand([bob])

    mgr.onContactUpdated(BOB, true, false)
    mgr.onContactUpdated(BOB, true)

    expect(onContactsUpdate).toHaveBeenCalledTimes(1)
  })

  it('вышел: из индекса, событие contacts_update', async () => {
    const { mgr, onContactsUpdate } = stand([bob])
    await mgr.list()
    mgr.onContactUpdated(BOB, true, false)
    onContactsUpdate.mockClear()

    mgr.onContactUpdated(BOB, false, true)

    expect(onContactsUpdate).toHaveBeenCalledExactlyOnceWith(BOB)
    expect(await mgr.getContactsPeerIds('Бобб', false, 'none')).toEqual([])
  })
})
