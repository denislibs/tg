// Локальный поиск контактов и «недавние» глобального поиска — порт tweb
// `appUsersManager.getContactsPeerIds`/`getContacts` (:417-481, индекс :509) и
// `pushRecentSearch`/`clearRecentSearch` (:277-305).
//
// «Недавние» проверяются по РЕЗУЛЬТАТУ: что легло в State на диске (тот же
// батч-ридер, которым вкладка поднимает State на старте) и что ушло зеркалом
// во вкладки.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { newContactsManager, type ContactsContacts } from './contactsManager'
import { newPersistManager } from './persistManager'
import { loadStateAll, saveStateKey } from '../store/persist'
import type { User, Chat, UserReal } from '../peers/peer'

const user = (id: number, first_name: string, last_name?: string, extra: Partial<UserReal> = {}): UserReal =>
  ({ _: 'user', id, first_name, ...(last_name ? { last_name } : {}), ...extra })

const book = (users: UserReal[]): ContactsContacts => ({
  _: 'contacts.contacts',
  contacts: users.map((u) => ({ _: 'contact', user_id: u.id, mutual: { _: 'boolFalse' } })),
  saved_count: 0,
  users,
})

function setup(opts: { contacts?: UserReal[]; me?: UserReal } = {}) {
  const cards = new Map<PeerId, User | Chat>()
  const get = vi.fn(async (_path: string): Promise<unknown> => book(opts.contacts ?? []))
  const post = vi.fn(async (_path: string, body: { contact_id: number }): Promise<unknown> =>
    book([user(body.contact_id, 'Added')]))
  const del = vi.fn(async (_path: string): Promise<void> => {})
  const mirror = vi.fn()
  const persist = newPersistManager(mirror)
  const mgr = newContactsManager({
    rest: { get, post, del, put: vi.fn() } as never,
    peers: {
      saveApiPeers: (o) => { for (const u of o?.users ?? []) cards.set(u.id, u) },
      cachedPeer: (id) => cards.get(id),
    },
    getMe: () => opts.me ?? null,
    state: {
      getState: loadStateAll,
      pushToState: (key, value) => persist.stateKey(key, value),
    },
  })
  return { mgr, get, mirror, cards }
}

describe('contactsManager.getContactsPeerIds — локальный индекс контактов', () => {
  it('находит контакт по имени, фамилии, @username и телефону; сортирует по имени', async () => {
    const { mgr } = setup({
      contacts: [
        user(1, 'Mike', 'Johnson'),
        user(2, 'John', 'Smith', { username: 'jsmith' }),
        user(3, 'Anna', undefined, { phone: '79001234567' }),
      ],
    })

    expect(await mgr.getContactsPeerIds('jo')).toEqual([2, 1])
    expect(await mgr.getContactsPeerIds('jsmi')).toEqual([2])
    expect(await mgr.getContactsPeerIds('7900')).toEqual([3])
    expect(await mgr.getContactsPeerIds('zz')).toEqual([])
  })

  it('без запроса — вся книга по имени; себя в книге не держит', async () => {
    const me = user(9, 'Zed', undefined, { pFlags: { self: true } })
    const { mgr } = setup({ contacts: [user(2, 'Boris'), me, user(1, 'Alice')], me })

    expect(await mgr.getContactsPeerIds()).toEqual([1, 2])
  })

  it('лимит уважается (срез — после сортировки по имени)', async () => {
    const { mgr } = setup({ contacts: [user(1, 'Anna'), user(2, 'Anton'), user(3, 'Andrew')] })

    expect(await mgr.getContactsPeerIds('an', false, undefined, 2)).toEqual([3, 1])
  })

  it('includeSaved: себя — первым, если запрос подходит (в т.ч. «Saved Messages»)', async () => {
    const me = user(9, 'Denis', undefined, { pFlags: { self: true } })
    const { mgr } = setup({ contacts: [user(1, 'Dmitry')], me })

    expect(await mgr.getContactsPeerIds('d', true)).toEqual([9, 1])
    expect(await mgr.getContactsPeerIds('saved', true)).toEqual([9])
    expect(await mgr.getContactsPeerIds('d', false)).toEqual([1])
  })

  it('книга грузится один раз: повторный поиск в сеть не ходит', async () => {
    const { mgr, get } = setup({ contacts: [user(1, 'John')] })

    await mgr.getContactsPeerIds('jo')
    await mgr.getContactsPeerIds('jo')

    expect(get).toHaveBeenCalledTimes(1)
  })

  it('добавленный контакт ищется, удалённый — нет (tweb pushContact/popContact)', async () => {
    const { mgr } = setup({ contacts: [user(1, 'John')] })
    await mgr.getContactsPeerIds('x')

    await mgr.add({ contactId: 5, firstName: 'Added' })
    expect(await mgr.getContactsPeerIds('add')).toEqual([5])

    await mgr.del(1)
    expect(await mgr.getContactsPeerIds('jo')).toEqual([])
  })

  it('смена аккаунта сбрасывает книгу: следующий поиск перечитывает её', async () => {
    const contacts = [user(1, 'John')]
    const { mgr, get } = setup({ contacts })
    expect(await mgr.getContactsPeerIds('jo')).toEqual([1])

    mgr.resetForLogout()
    contacts.splice(0, 1, user(2, 'Joan'))

    expect(await mgr.getContactsPeerIds('jo')).toEqual([2])
    expect(get).toHaveBeenCalledTimes(2)
  })
})

describe('contactsManager.pushRecentSearch / clearRecentSearch', () => {
  beforeEach(async () => {
    await saveStateKey('recentSearch', [])
  })

  const recent = async () => (await loadStateAll()).recentSearch

  it('ставит пира первым и рассылает ключ зеркалом во вкладки', async () => {
    const { mgr, mirror } = setup()

    await mgr.pushRecentSearch(5)
    await mgr.pushRecentSearch(-7)

    expect(await recent()).toEqual(['-7', '5'])
    expect(mirror).toHaveBeenLastCalledWith('recentSearch', ['-7', '5'])
  })

  it('повтор не дублирует, а поднимает наверх', async () => {
    const { mgr } = setup()

    await mgr.pushRecentSearch(1)
    await mgr.pushRecentSearch(2)
    await mgr.pushRecentSearch(1)

    expect(await recent()).toEqual(['1', '2'])
  })

  it('21-й вытесняет последний: в списке не больше 20', async () => {
    const { mgr } = setup()

    for (let id = 1; id <= 21; ++id) await mgr.pushRecentSearch(id)

    const list = await recent()
    expect(list).toHaveLength(20)
    expect(list?.[0]).toBe('21')
    expect(list).not.toContain('1')
  })

  it('одновременные записи не теряют друг друга (State у оригинала — один объект в памяти)', async () => {
    const { mgr } = setup()

    await Promise.all([mgr.pushRecentSearch(1), mgr.pushRecentSearch(2)])

    expect(await recent()).toEqual(['2', '1'])
  })

  it('clearRecentSearch обнуляет список', async () => {
    const { mgr, mirror } = setup()
    await mgr.pushRecentSearch(1)

    await mgr.clearRecentSearch()

    expect(await recent()).toEqual([])
    expect(mirror).toHaveBeenLastCalledWith('recentSearch', [])
  })
})

describe('contactsManager.isContact — порт `isContact` (:897-899)', () => {
  it('в книге — контакт; книга дочитывается до ответа (первое чтение ленивое)', async () => {
    const { mgr, get } = setup({ contacts: [user(5, 'Book')] })
    expect(await mgr.isContact(5)).toBe(true)
    expect(get).toHaveBeenCalledTimes(1)
    expect(await mgr.isContact(6)).toBe(false)
    expect(get).toHaveBeenCalledTimes(1) // книга читается один раз за сессию
  })

  it('вне книги, но с флагом contact на карточке — контакт', async () => {
    const { mgr, cards } = setup()
    cards.set(7, user(7, 'Flag', undefined, { pFlags: { contact: true } }))
    cards.set(8, user(8, 'Plain', undefined, { pFlags: {} }))
    expect(await mgr.isContact(7)).toBe(true)
    expect(await mgr.isContact(8)).toBe(false)
  })

  it('удалённый из книги перестаёт быть контактом', async () => {
    const { mgr } = setup({ contacts: [user(5, 'Book')] })
    expect(await mgr.isContact(5)).toBe(true)
    await mgr.del(5)
    expect(await mgr.isContact(5)).toBe(false)
  })
})
