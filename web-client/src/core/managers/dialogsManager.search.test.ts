// Локальный поиск диалогов по названию — порт ветки `query` у tweb
// `dialogsStorage.getDialogs` (lib/storages/dialogs.ts:1660-1709) поверх
// `SearchIndex` (`dialogsIndex`, :342), который ведётся там же, где диалог
// сохраняется (:1400-1403) и выбрасывается (:1104).
//
// Пины — на РЕЗУЛЬТАТ: какие строки вернулись и в каком порядке, плюс отсутствие
// похода в сеть (поиск по имени сеть не трогает — ради этого он и локальный).
import { describe, expect, it, vi } from 'vitest'
import { newDialogsManager } from './dialogsManager'
import { makeDialog, makeLastMessage } from '../dialogs/testDialog'
import { ARCHIVE_FOLDER_ID } from '../folderIds'
import type { Dialog, RawDialog } from '../models'
import type { Chat, User, UserReal } from '../peers/peer'

const at = (day: number) => `2026-08-${String(day).padStart(2, '0')}T00:00:00Z`

const dialog = (peerId: number, day: number, archived = false): Dialog =>
  makeDialog({ peerId, archived, lastMessage: makeLastMessage({ peerId, id: 1, fromId: 1, text: 'x', createdAt: at(day) }) })

/** Строка в форме провода: клиентских полей (`peerId`, `lastMessage`) нет. */
const rawDialog = (peerId: number): RawDialog => {
  const { peerId: _p, lastMessage: _m, ...wire } = makeDialog({ peerId })
  return wire
}

const user = (id: number, first_name: string, last_name?: string, username?: string): UserReal =>
  ({ _: 'user', id, first_name, ...(last_name ? { last_name } : {}), ...(username ? { username } : {}) })
const channel = (id: number, title: string): Chat =>
  ({ _: 'channel', id, title, access_hash: 0, date: 0, photo: { _: 'chatPhotoEmpty' } } as unknown as Chat)

function setup(opts: { cache: Dialog[]; peers: (User | Chat)[]; chats?: unknown }) {
  const cards = new Map<PeerId, User | Chat>()
  const put = (p: User | Chat) => cards.set(p._ === 'user' || p._ === 'userEmpty' ? p.id : -p.id, p)
  opts.peers.forEach(put)
  const get = vi.fn(async (): Promise<unknown> => {
    if (opts.chats === undefined) throw new Error('сеть недоступна')
    return opts.chats
  })
  const mgr = newDialogsManager({
    rest: { get } as never,
    loadCache: async () => opts.cache,
    loadState: async () => ({ pinnedOrders: {} }),
    peers: {
      saveApiPeers: (o) => { [...(o?.chats ?? []), ...(o?.users ?? [])].forEach(put) },
      cachedPeer: (id) => cards.get(id),
      hydrateFromDisk: async () => {},
    },
  })
  return { mgr, get, put }
}

const peerIds = (page: { dialogs: Dialog[] }) => page.dialogs.map((d) => d.peerId)

describe('dialogsManager.getDialogs({query}) — локальный индекс диалогов', () => {
  it('находит диалог по имени собеседника и по названию чата, в порядке списка, без сети', async () => {
    const { mgr, get } = setup({
      cache: [dialog(1, 1), dialog(-2, 3), dialog(3, 2)],
      peers: [user(1, 'John', 'Smith'), channel(2, 'Johnny Fans'), user(3, 'Maria')],
    })

    const page = await mgr.getDialogs({ query: 'jo', limit: 20, filterId: 0 })

    // порядок — индекс диалога (свежее выше), как `dialogs.sort(...)` оригинала
    expect(peerIds(page)).toEqual([-2, 1])
    expect(page.isEnd).toBe(true)
    expect(peerIds(await mgr.getDialogs({ query: 'mar', filterId: 0 }))).toEqual([3])
    expect(get).not.toHaveBeenCalled()
  })

  it('ищет и по @username, и по транслитерации', async () => {
    const { mgr } = setup({
      cache: [dialog(1, 1), dialog(2, 2)],
      peers: [user(1, 'Денис', undefined, 'den_is'), user(2, 'Bob')],
    })

    expect(peerIds(await mgr.getDialogs({ query: 'denis', filterId: 0 }))).toEqual([1])
    expect(peerIds(await mgr.getDialogs({ query: 'den_is', filterId: 0 }))).toEqual([1])
  })

  it('лимит уважается: страница режется, конец не объявляется', async () => {
    const { mgr } = setup({
      cache: [dialog(1, 3), dialog(2, 2), dialog(3, 1)],
      peers: [user(1, 'Anna'), user(2, 'Anton'), user(3, 'Andrew')],
    })

    const page = await mgr.getDialogs({ query: 'an', limit: 2, filterId: 0 })

    expect(peerIds(page)).toEqual([1, 2])
    expect(page.isEnd).toBe(false)
  })

  it('папка: «все чаты» не отдают архив, архив — только архивные (tweb `dialog.folder_id === filterId`)', async () => {
    const { mgr } = setup({
      cache: [dialog(1, 2), dialog(2, 1, true)],
      peers: [user(1, 'John'), user(2, 'Johnny')],
    })

    expect(peerIds(await mgr.getDialogs({ query: 'jo', filterId: 0 }))).toEqual([1])
    expect(peerIds(await mgr.getDialogs({ query: 'jo', filterId: ARCHIVE_FOLDER_ID }))).toEqual([2])
  })

  it('выброшенный диалог больше не находится', async () => {
    const { mgr } = setup({ cache: [dialog(-5, 1)], peers: [channel(5, 'Rust Chat')] })
    expect(peerIds(await mgr.getDialogs({ query: 'rust', filterId: 0 }))).toEqual([-5])

    mgr.applyRemoved(-5)

    expect(peerIds(await mgr.getDialogs({ query: 'rust', filterId: 0 }))).toEqual([])
  })

  it('диалог из догруженной страницы списка ищется (слияние страницы — тоже сохранение)', async () => {
    const chats = {
      _: 'messages.dialogs',
      dialogs: [rawDialog(8)], messages: [], chats: [], users: [user(8, 'Oleg')],
    }
    const { mgr } = setup({ cache: [], peers: [], chats })
    await mgr.getDialogs({ limit: 20, filterId: 0 })

    expect(peerIds(await mgr.getDialogs({ query: 'oleg', filterId: 0 }))).toEqual([8])
  })

  it('диалог, приехавший из сети, ищется; повторное сохранение переиндексирует имя', async () => {
    const chats = {
      _: 'messages.dialogs',
      dialogs: [rawDialog(7)], messages: [], chats: [], users: [user(7, 'Kate')],
    }
    const { mgr } = setup({ cache: [], peers: [], chats })
    await mgr.refresh()
    expect(peerIds(await mgr.getDialogs({ query: 'kate', filterId: 0 }))).toEqual([7])

    // Переименование: тот же диалог, новая карточка — строка списка не
    // изменилась, но сохранение диалога (tweb saveDialog) переиндексирует его.
    chats.users = [user(7, 'Katherine')]
    await mgr.refresh()

    expect(peerIds(await mgr.getDialogs({ query: 'katherine', filterId: 0 }))).toEqual([7])
  })
})
