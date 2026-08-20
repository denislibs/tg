// Вторая половина того же дефекта (дёрганье композера при входе в канал):
// карточка чата приезжала REST'ом, а до её приезда хук отдавал «прав нет».
// Здесь пинится ровно то, что делает переход спокойным:
//   1) права канала в полёте помечены как НЕИЗВЕСТНЫЕ (permissionsKnown=false),
//      а не как «нельзя» — плашку из них выводить нельзя (см. controlPlates.test);
//   2) повторный вход в чат отдаёт права СИНХРОННО (первый же рендер);
//   3) на смене чата карточка прошлого чата не протекает ни на один рендер.
//
// Шаг D2.5: права зрителя живут в КОНСТРУКТОРЕ `channel`, а не в плоской
// карточке, и берутся из зеркала пиров — туда их кладёт владелец
// (`peers.saveApiPeers` в `groupsManager.card`), а применяет проектор
// (`applyPeerOps`). Фейк менеджера ниже воспроизводит ровно эту пару, поэтому
// «карточка приехала» здесь означает то же, что в проде.
import type { ReactNode } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useChatInfoCard, resetChatCardCache } from './useChatInfoCard'
import { ManagersProvider } from './useManagers'
import { applyPeerOps, resetPeerMirror } from '../peerCache'
import type { Channel, ChannelFull } from '../peers/peer'
import type { ChatCard } from '../managers/groupsManager'

const CHANNEL_ID = -407
const OTHER_ID = -2

function wrapper(managers: unknown) {
  return ({ children }: { children: ReactNode }) => (
    <ManagersProvider managers={managers as never}>{children}</ManagersProvider>
  )
}

function channel(peerId: PeerId, over: Partial<Channel> = {}): Channel {
  return {
    _: 'channel',
    id: Math.abs(peerId),
    title: 'C',
    photo: { _: 'chatPhotoEmpty' },
    date: 0,
    pFlags: { broadcast: true, creator: true },
    participants_count: 1,
    ...over,
  }
}

function fullChat(peerId: PeerId): ChannelFull {
  return {
    _: 'channelFull',
    id: Math.abs(peerId),
    about: '',
    read_inbox_max_id: 0,
    read_outbox_max_id: 0,
    unread_count: 0,
    chat_photo: null,
  }
}

function card(peerId: PeerId, chat = channel(peerId)): ChatCard {
  return { peerId, chat, fullChat: fullChat(peerId), creatorId: 0 }
}

// Карточка отдаётся не сразу: её ожидание и есть окно, в котором раньше вставала
// плашка. Владелец кладёт краткую форму в зеркало ТЕМ ЖЕ вызовом, что отвечает
// хуку, — здесь это `applyPeerOps` (в проде — кадр `rt:peer_op` от воркера).
function deferredManagers(byChat: Record<number, ChatCard>) {
  const resolvers: (() => void)[] = []
  const cardFn = vi.fn((peerId: PeerId) => new Promise((res) => {
    resolvers.push(() => {
      const c = byChat[peerId]
      if (c) applyPeerOps([{ op: 'upsert', peers: [c.chat] }])
      res(c ?? null)
    })
  }))
  return {
    managers: { groups: { card: cardFn, members: async () => [] }, peers: { fillMirror: async () => {} } },
    cardFn,
    flush: () => { for (const r of resolvers.splice(0)) r() },
  }
}

describe('useChatInfoCard: права канала до приезда карточки', () => {
  beforeEach(() => { resetChatCardCache(); resetPeerMirror() })

  it('карточка в полёте — permissionsKnown=false (неизвестно), а не «нельзя писать»', async () => {
    const { managers, flush } = deferredManagers({ [CHANNEL_ID]: card(CHANNEL_ID) })
    const { result } = renderHook(
      () => useChatInfoCard({ isRealChat: true, isChannel: true, numericChatId: CHANNEL_ID }),
      { wrapper: wrapper(managers) },
    )

    expect(result.current.full).toBeNull()
    expect(result.current.chat).toBeUndefined()
    expect(result.current.permissionsKnown).toBe(false)

    flush()
    await waitFor(() => expect(result.current.full).not.toBeNull())
    expect(result.current.permissionsKnown).toBe(true)
    expect(result.current.canType).toBe(true)
  })

  it('повторный вход в канал: права известны на ПЕРВОМ рендере, до ответа сети', async () => {
    const first = deferredManagers({ [CHANNEL_ID]: card(CHANNEL_ID) })
    const a = renderHook(
      () => useChatInfoCard({ isRealChat: true, isChannel: true, numericChatId: CHANNEL_ID }),
      { wrapper: wrapper(first.managers) },
    )
    first.flush()
    await waitFor(() => expect(a.result.current.full).not.toBeNull())
    a.unmount()

    // второй вход — сеть ещё не ответила (flush не зван), но карточка уже есть
    const second = deferredManagers({ [CHANNEL_ID]: card(CHANNEL_ID) })
    const b = renderHook(
      () => useChatInfoCard({ isRealChat: true, isChannel: true, numericChatId: CHANNEL_ID }),
      { wrapper: wrapper(second.managers) },
    )
    expect(b.result.current.permissionsKnown).toBe(true)
    expect(b.result.current.canType).toBe(true)
    expect(second.cardFn).toHaveBeenCalledWith(CHANNEL_ID) // свежесть всё равно запрашиваем
  })

  it('смена чата: карточка прошлого чата не видна ни на одном рендере нового', async () => {
    const { managers, flush } = deferredManagers({
      [OTHER_ID]: card(OTHER_ID, channel(OTHER_ID, { pFlags: { megagroup: true } })),
      [CHANNEL_ID]: card(CHANNEL_ID),
    })
    const { result, rerender } = renderHook(
      ({ id, channel: isCh }: { id: number; channel: boolean }) =>
        useChatInfoCard({ isRealChat: true, isChannel: isCh, numericChatId: id }),
      { wrapper: wrapper(managers), initialProps: { id: OTHER_ID, channel: false } },
    )
    flush()
    await waitFor(() => expect(result.current.full).not.toBeNull())

    rerender({ id: CHANNEL_ID, channel: true })
    expect(result.current.full).toBeNull()
    expect(result.current.chat).toBeUndefined()
    expect(result.current.permissionsKnown).toBe(false)
  })

  it('logout стирает кэш — права прошлого аккаунта не показываются следующему', async () => {
    const first = deferredManagers({ [CHANNEL_ID]: card(CHANNEL_ID) })
    const a = renderHook(
      () => useChatInfoCard({ isRealChat: true, isChannel: true, numericChatId: CHANNEL_ID }),
      { wrapper: wrapper(first.managers) },
    )
    first.flush()
    await waitFor(() => expect(a.result.current.full).not.toBeNull())
    a.unmount()

    // Тот же тандем, что на кадре `rt:logging_out`: свой кэш полной карточки
    // чистит хук, зеркало пиров — проектор (`storeProjection`, RT.loggingOut).
    resetChatCardCache()
    resetPeerMirror()

    const second = deferredManagers({ [CHANNEL_ID]: card(CHANNEL_ID) })
    const b = renderHook(
      () => useChatInfoCard({ isRealChat: true, isChannel: true, numericChatId: CHANNEL_ID }),
      { wrapper: wrapper(second.managers) },
    )
    expect(b.result.current.full).toBeNull()
    expect(b.result.current.permissionsKnown).toBe(false)
  })
})

// ── Права: полярность запретов ──────────────────────────────────────────────
// `default_banned_rights` это ЧТО НЕЛЬЗЯ. Перевернуть знак — значит перевернуть
// права всей группы: этот блок краснеет ровно на такой мутации.
describe('useChatInfoCard: права обычного участника супергруппы', () => {
  beforeEach(() => { resetChatCardCache(); resetPeerMirror() })

  const group = (banned: Partial<Record<string, true>>): Channel =>
    channel(OTHER_ID, {
      pFlags: { megagroup: true },
      default_banned_rights: { _: 'chatBannedRights', pFlags: banned as never, until_date: 0 },
    })

  it('запрета нет — писать и слать медиа можно', async () => {
    const { managers, flush } = deferredManagers({ [OTHER_ID]: card(OTHER_ID, group({})) })
    const { result } = renderHook(
      () => useChatInfoCard({ isRealChat: true, isChannel: false, numericChatId: OTHER_ID }),
      { wrapper: wrapper(managers) },
    )
    flush()
    await waitFor(() => expect(result.current.chat).toBeDefined())
    expect(result.current.canSendText).toBe(true)
    expect(result.current.canSendMedia).toBe(true)
  })

  it('выставленный флаг `send_messages` — это ЗАПРЕТ: писать нельзя, медиа можно', async () => {
    const { managers, flush } = deferredManagers({ [OTHER_ID]: card(OTHER_ID, group({ send_messages: true })) })
    const { result } = renderHook(
      () => useChatInfoCard({ isRealChat: true, isChannel: false, numericChatId: OTHER_ID }),
      { wrapper: wrapper(managers) },
    )
    flush()
    await waitFor(() => expect(result.current.chat).toBeDefined())
    expect(result.current.canSendText).toBe(false)
    expect(result.current.canSendMedia).toBe(true)
  })
})
