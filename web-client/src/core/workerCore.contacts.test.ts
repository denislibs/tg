// Проводка книги контактов и «недавних» глобального поиска в createWorkerCore()
// (норма CLAUDE.md «Тесты»: каждая строка проводки краснеет на своём удалении).
// Сам менеджер покрыт `managers/contactsManager.search.test.ts`; здесь — что
// в проде ему поданы НАСТОЯЩИЕ зависимости:
//  - `state` — State с диска под версионным гейтом и writer `persist.stateKey`
//    (диск + кадр `state:mirror` во вкладки);
//  - `peers` — карточки книги втекают в общее хранилище;
//  - `getMe` — текущий пользователь для `includeSaved`;
//  - `contacts.resetForLogout()` на переходе сессии.
//
// fake-indexeddb — ПЕРВОЙ строкой: newCursor()/newConnectionManager() читают
// IndexedDB прямо в конструкторе.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkerCore } from './workerCore'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { loadStateAll, saveStateKey } from './store/persist'
import { STATE_VERSION } from './state/state'

function pair(): [Endpoint, Endpoint] {
  const listenersA: Array<(ev: MessageEvent) => void> = []
  const listenersB: Array<(ev: MessageEvent) => void> = []
  const epA: Endpoint = {
    postMessage: (m) => { for (const l of listenersB) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersA.push(l) },
  }
  const epB: Endpoint = {
    postMessage: (m) => { for (const l of listenersA) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersB.push(l) },
  }
  return [epA, epB]
}

/** Книга контактов, которую сейчас отдаёт «сервер». */
let book: { id: number; first_name: string }[] = []

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  book = []
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.endsWith('/auth/logout')) return new Response('{}', { status: 200 })
    if (u.endsWith('/auth/sign_in')) {
      return new Response(JSON.stringify({
        _: 'auth.authorization',
        token: 'session-b',
        user: { _: 'user', pFlags: { self: true }, id: 5, first_name: 'Me', phone: '+79990000005' },
      }), { status: 200 })
    }
    if (u.endsWith('/contacts')) {
      return new Response(JSON.stringify({
        _: 'contacts.contacts',
        contacts: book.map((u) => ({ _: 'contact', user_id: u.id, mutual: { _: 'boolFalse' } })),
        saved_count: 0,
        users: book.map((u) => ({ _: 'user', ...u })),
      }), { status: 200 })
    }
    throw new Error('unexpected fetch ' + u)
  }))
})

afterEach(() => { vi.unstubAllGlobals() })

describe('createWorkerCore(): contacts — «недавние» глобального поиска', () => {
  it('pushRecentSearch по RPC дописывает к State С ДИСКА и рассылает кадр state:mirror', async () => {
    await saveStateKey('version', STATE_VERSION)
    await saveStateKey('recentSearch', ['9'])
    const core = createWorkerCore()
    const [epWorker, epTab] = pair()
    core.bind(epWorker)
    const tab = new SuperMessagePort(epTab)
    const frames: Array<{ event: string; payload: unknown }> = []
    tab.onAny((event, payload) => frames.push({ event, payload }))

    await tab.invoke('manager', { name: 'contacts', method: 'pushRecentSearch', args: [-5] })

    expect((await loadStateAll()).recentSearch).toEqual(['-5', '9'])
    expect(frames).toContainEqual({ event: 'state:mirror', payload: { key: 'recentSearch', value: ['-5', '9'] } })
  })
})

describe('createWorkerCore(): contacts — локальный поиск по книге', () => {
  it('карточки книги втекают в общее хранилище пиров', async () => {
    book = [{ id: 1, first_name: 'John' }]
    const core = createWorkerCore()

    expect(await core.registry.contacts.getContactsPeerIds('jo')).toEqual([1])
    expect(core.registry.peers.cachedPeer(1)).toMatchObject({ _: 'user', first_name: 'John' })
  })

  it('вход под другим аккаунтом сбрасывает книгу, а includeSaved видит нового «себя»', async () => {
    book = [{ id: 1, first_name: 'John' }]
    const core = createWorkerCore()
    expect(await core.registry.contacts.getContactsPeerIds('jo')).toEqual([1])

    book = [{ id: 2, first_name: 'Joan' }]
    await core.registry.auth.signIn('+79990000005', '12345', 'dev', 'web')

    expect(await core.registry.contacts.getContactsPeerIds('jo')).toEqual([2])
    expect(await core.registry.contacts.getContactsPeerIds('saved', true)).toEqual([5])
  })

  it('logout тоже сбрасывает книгу', async () => {
    book = [{ id: 1, first_name: 'John' }]
    const core = createWorkerCore()
    expect(await core.registry.contacts.getContactsPeerIds('jo')).toEqual([1])

    book = []
    await core.registry.auth.logout()

    expect(await core.registry.contacts.getContactsPeerIds('jo')).toEqual([])
  })
})
