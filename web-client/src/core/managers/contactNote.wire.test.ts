// Провод заметки контакта и предложения даты рождения — к Telegram (О-20, О-22
// плана волны 7):
//  • `contacts.addContact.note` — flags.1?TextWithEntities: без заметки ключа
//    НЕТ (сервер тогда её не трогает), с ней — конструктор, а не строка;
//  • `contacts.updateContactNote(id, note)` → PUT /contacts/{id}/note
//    (tweb `appProfileManager.updateUserNote`);
//  • `users.suggestBirthday(id, birthday)` → POST /users/{id}/suggest_birthday
//    (tweb `appProfileManager.suggestUserBirthday`).
import { describe, expect, it, vi } from 'vitest'
import { newContactsManager, type ContactsContacts } from './contactsManager'
import { newProfileManager } from './profileManager'
import type { RestClient } from '../net/restClient'

const book = (id: number): ContactsContacts => ({
  _: 'contacts.contacts',
  contacts: [{ _: 'contact', user_id: id, mutual: { _: 'boolFalse' } }],
  saved_count: 0,
  users: [{ _: 'user', id, first_name: 'Би' }],
})

function contacts() {
  const post = vi.fn(async (_path: string, body: { contact_id: number }) => book(body.contact_id))
  const mgr = newContactsManager({
    rest: { get: vi.fn(), post, del: vi.fn(), put: vi.fn() } as never,
    peers: { saveApiPeers: () => {}, cachedPeer: () => undefined },
    getMe: () => null,
    state: { get: () => undefined, set: () => {} } as never,
  })
  return { mgr, post }
}

describe('contacts.add — note как у contacts.addContact', () => {
  it('без заметки ключа note нет — правка имени её не стирает', async () => {
    const { mgr, post } = contacts()
    await mgr.add({ contactId: 2, firstName: 'Би' })
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][1]).not.toHaveProperty('note')
  })

  it('заметка едет конструктором textWithEntities', async () => {
    const { mgr, post } = contacts()
    const note = { _: 'textWithEntities' as const, text: 'коллега', entities: [] }
    await mgr.add({ contactId: 2, firstName: 'Би', note })
    expect(post.mock.calls[0][1]).toMatchObject({ contact_id: 2, note })
  })
})

describe('profile — updateUserNote / suggestUserBirthday', () => {
  it('updateUserNote → PUT /contacts/{id}/note {note}', async () => {
    const put = vi.fn(async () => ({ _: 'boolTrue' }))
    const mgr = newProfileManager({ rest: { put } as unknown as RestClient })
    const note = { _: 'textWithEntities' as const, text: 'друг', entities: [] }
    await mgr.updateUserNote(2, note)
    expect(put).toHaveBeenCalledWith('/contacts/2/note', { note })
  })

  it('suggestUserBirthday → POST /users/{id}/suggest_birthday {birthday}', async () => {
    const post = vi.fn(async () => ({}))
    const mgr = newProfileManager({ rest: { post } as unknown as RestClient })
    const birthday = { _: 'birthday' as const, day: 8, month: 3 }
    await mgr.suggestUserBirthday(2, birthday)
    expect(post).toHaveBeenCalledWith('/users/2/suggest_birthday', { birthday })
  })
})
