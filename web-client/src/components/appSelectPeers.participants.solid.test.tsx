/** @jsxImportSource solid-js */
/**
 * `AppSelectPeers` на участниках канала (`peerType: ['channelParticipants']`,
 * tweb `appSelectPeers.tsx:515-574`, `:634-650`, `:909-963`; 0б-7 волны 7).
 *
 * Предмет:
 *  - подгрузка страницами по 50 со смещением = числу строк, конец — по `count`
 *    или короткой странице (RS-06: прокрутка участников);
 *  - фильтр (`channelParticipantsFilter`) получает текущий запрос;
 *  - карта `participants` заполняется со страниц;
 *  - живое обновление: кадр `chat_participant` этого чата (`:533-540`) —
 *    подходящий под фильтр участник строкой, неподходящий/ушедший — снят;
 *    чужой чат не трогает;
 *  - `deletePeerId` снимает строку.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'
import rootScope from '@lib/rootScope'
import { RT } from '@core/realtime/events'
import type { User } from '@core/peers/peer'
import type { ChannelParticipantWire, ChannelParticipantsFilter } from '@core/managers/groupsManager'
import { isParticipantAdmin } from '@core/peers/participant'
import AppSelectPeers, { type AppSelectPeersManagers } from './appSelectPeers.solid'

const CHAT_ID = 30
const PEER = -CHAT_ID

const user = (id: number): User => ({ _: 'user', id, first_name: 'U' + id, pFlags: {} } as User)
const member = (id: number): ChannelParticipantWire => ({ _: 'channelParticipant', user_id: id, date: 1 })
const admin = (id: number): ChannelParticipantWire => ({ _: 'channelParticipantAdmin', user_id: id, promoted_by: 1, date: 1, admin_rights: { _: 'chatAdminRights' } })

let helper: MiddlewareHelper
let appendTo: HTMLElement
let all: ChannelParticipantWire[]
let getParticipants: ReturnType<typeof vi.fn>

function managers(): AppSelectPeersManagers {
  return {
    dialogs: { getDialogs: vi.fn() },
    contacts: { getContactsPeerIds: vi.fn(), testSelfSearch: vi.fn(async() => false) },
    channels: { search: vi.fn() },
    peers: {
      getPeers: vi.fn(async(ids: PeerId[]) => ids.map(user)),
      fillMirror: vi.fn(async() => {}),
    },
    groups: { getParticipants },
  } as unknown as AppSelectPeersManagers
}

const settle = async() => {
  for(let i = 0; i < 16; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const build = (options: Partial<ConstructorParameters<typeof AppSelectPeers>[0]> = {}) => new AppSelectPeers({
  appendTo,
  managers: managers(),
  middleware: helper.get(),
  peerType: ['channelParticipants'],
  peerId: PEER,
  multiSelect: false,
  ...options,
})

const rowIds = (selector: AppSelectPeers) =>
  [...selector.container.querySelectorAll<HTMLElement>('ul.chatlist > a.row')].map((row) => +row.dataset.peerId!)

beforeEach(() => {
  rootScope.myId = 1
  helper = getMiddleware()
  appendTo = document.createElement('div')
  document.body.append(appendTo)
  all = Array.from({ length: 120 }, (_, i) => member(i + 100))
  getParticipants = vi.fn(async({ filter, limit, offset }: { filter: ChannelParticipantsFilter, limit: number, offset: number }) => {
    const list = filter._ === 'channelParticipantsAdmins' ? all.filter(isParticipantAdmin) : all
    return { _: 'channels.channelParticipants', count: list.length, participants: list.slice(offset, offset + limit), chats: [], users: [] }
  })
})

afterEach(() => {
  helper.destroy()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('AppSelectPeers — участники канала', () => {
  it('страницы по 50 со смещением = числу строк; карта участников; конец по `count`', async() => {
    const selector = build()
    await settle()

    expect(getParticipants).toHaveBeenCalledTimes(1)
    expect(getParticipants.mock.calls[0][0]).toEqual({ id: CHAT_ID, filter: { _: 'channelParticipantsSearch', q: '' }, limit: 50, offset: 0 })
    expect(rowIds(selector)).toHaveLength(50)
    expect(selector.participants.get(100)).toEqual(member(100))

    selector.scrollable.onScrolledBottom!()
    await settle()
    selector.scrollable.onScrolledBottom!()
    await settle()

    expect(getParticipants.mock.calls.map((c) => c[0].offset)).toEqual([0, 50, 100])
    expect(rowIds(selector)).toHaveLength(120)
    // `count` достигнут — дальше в сеть не ходим
    selector.scrollable.onScrolledBottom!()
    await settle()
    expect(getParticipants).toHaveBeenCalledTimes(3)
  })

  it('фильтр — функцией от запроса (у админов — `channelParticipantsAdmins`)', async() => {
    all = [admin(5), member(6), admin(7)]
    const selector = build({
      channelParticipantsFilter: (q) => ({ _: 'channelParticipantsAdmins', q }),
      channelParticipantsUpdateFilter: isParticipantAdmin,
    })
    await settle()

    expect(getParticipants.mock.calls[0][0].filter).toEqual({ _: 'channelParticipantsAdmins', q: '' })
    expect(rowIds(selector)).toEqual([5, 7])
  })

  const participantUpdate = (userId: number, next: ChannelParticipantWire | undefined, channelId = CHAT_ID) => {
    rootScope.dispatchEventSingle(RT.chatParticipant, {
      _: 'updateChannelParticipant', channel_id: channelId, date: 1, user_id: userId, new_participant: next,
    })
  }

  it('`chat_participant` этого чата: назначенный — строкой, разжалованный — снят, сети нет', async() => {
    all = [admin(5), admin(7)]
    const selector = build({
      channelParticipantsFilter: (q) => ({ _: 'channelParticipantsAdmins', q }),
      channelParticipantsUpdateFilter: isParticipantAdmin,
    })
    await settle()
    expect(rowIds(selector)).toEqual([5, 7])
    getParticipants.mockClear()

    participantUpdate(7, member(7))
    participantUpdate(8, admin(8))
    await settle()

    expect(rowIds(selector).sort((a, b) => a - b)).toEqual([5, 8])
    expect(selector.participants.has(7)).toBe(false)
    expect(selector.participants.get(8)).toEqual(admin(8))
    expect(getParticipants).not.toHaveBeenCalled()
  })

  it('ушедший (без `new_participant`) снимается', async() => {
    all = [member(5), member(6)]
    const selector = build({ channelParticipantsUpdateFilter: (p) => !!p })
    await settle()
    participantUpdate(6, undefined)
    await settle()
    expect(rowIds(selector)).toEqual([5])
  })

  it('`chat_participant` чужого чата список не трогает', async() => {
    const selector = build({ channelParticipantsUpdateFilter: (p) => !!p })
    await settle()

    participantUpdate(100, undefined, 999)
    await settle()

    expect(rowIds(selector)).toHaveLength(50)
  })

  it('без `channelParticipantsUpdateFilter` на `chat_participant` не подписан', async() => {
    const selector = build()
    await settle()

    participantUpdate(100, undefined)
    await settle()

    expect(rowIds(selector)).toHaveLength(50)
  })

  it('`deletePeerId` снимает строку', async() => {
    all = [member(5), member(6)]
    const selector = build()
    await settle()

    selector.deletePeerId(5)

    expect(rowIds(selector)).toEqual([6])
  })
})
