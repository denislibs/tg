// Вторая половина того же дефекта (дёрганье композера при входе в канал):
// карточка чата приезжала REST'ом, а до её приезда хук отдавал «прав нет».
// Здесь пинится ровно то, что делает переход спокойным:
//   1) права канала в полёте помечены как НЕИЗВЕСТНЫЕ (permissionsKnown=false),
//      а не как «нельзя» — плашку из них выводить нельзя (см. controlPlates.test);
//   2) повторный вход в чат отдаёт права СИНХРОННО из кэша (первый же рендер);
//   3) на смене чата карточка прошлого чата не протекает ни на один рендер.
import type { ReactNode } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useChatInfoCard, resetChatCardCache } from './useChatInfoCard'
import { ManagersProvider } from './useManagers'

const CHANNEL_ID = 407
const OTHER_ID = 2

function wrapper(managers: unknown) {
  return ({ children }: { children: ReactNode }) => (
    <ManagersProvider managers={managers as never}>{children}</ManagersProvider>
  )
}

function card(over: Partial<{ type: string; myRole: string; myRights: number }> = {}) {
  return {
    type: 'channel', memberCount: 1, myRole: 'creator', myRights: 0, discussionChatId: 0,
    slowmodeSeconds: 0, chargeStars: 0, defaultPermissions: 31, ...over,
  }
}

// Карточка отдаётся не сразу: её ожидание и есть окно, в котором раньше вставала плашка.
function deferredManagers(byChat: Record<number, ReturnType<typeof card>>) {
  const resolvers: (() => void)[] = []
  const cardFn = vi.fn((chatId: number) => new Promise((res) => {
    resolvers.push(() => res(byChat[chatId]))
  }))
  return {
    managers: { groups: { card: cardFn, members: async () => [] } },
    cardFn,
    flush: () => { for (const r of resolvers.splice(0)) r() },
  }
}

describe('useChatInfoCard: права канала до приезда карточки', () => {
  beforeEach(() => { resetChatCardCache() })

  it('карточка в полёте — permissionsKnown=false (неизвестно), а не «нельзя писать»', async () => {
    const { managers, flush } = deferredManagers({ [CHANNEL_ID]: card() })
    const { result } = renderHook(
      () => useChatInfoCard({ isRealChat: true, isChannel: true, numericChatId: CHANNEL_ID }),
      { wrapper: wrapper(managers) },
    )

    expect(result.current.card).toBeNull()
    expect(result.current.permissionsKnown).toBe(false)

    flush()
    await waitFor(() => expect(result.current.card).not.toBeNull())
    expect(result.current.permissionsKnown).toBe(true)
    expect(result.current.canType).toBe(true)
  })

  it('повторный вход в канал: права известны на ПЕРВОМ рендере, до ответа сети', async () => {
    const first = deferredManagers({ [CHANNEL_ID]: card() })
    const a = renderHook(
      () => useChatInfoCard({ isRealChat: true, isChannel: true, numericChatId: CHANNEL_ID }),
      { wrapper: wrapper(first.managers) },
    )
    first.flush()
    await waitFor(() => expect(a.result.current.card).not.toBeNull())
    a.unmount()

    // второй вход — сеть ещё не ответила (flush не зван), но карточка уже есть
    const second = deferredManagers({ [CHANNEL_ID]: card() })
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
      [OTHER_ID]: card({ type: 'private', myRole: '' }),
      [CHANNEL_ID]: card(),
    })
    const { result, rerender } = renderHook(
      ({ id, channel }: { id: number; channel: boolean }) =>
        useChatInfoCard({ isRealChat: true, isChannel: channel, numericChatId: id }),
      { wrapper: wrapper(managers), initialProps: { id: OTHER_ID, channel: false } },
    )
    flush()
    await waitFor(() => expect(result.current.card).not.toBeNull())

    rerender({ id: CHANNEL_ID, channel: true })
    expect(result.current.card).toBeNull()
    expect(result.current.permissionsKnown).toBe(false)
  })

  it('logout стирает кэш — права прошлого аккаунта не показываются следующему', async () => {
    const first = deferredManagers({ [CHANNEL_ID]: card() })
    const a = renderHook(
      () => useChatInfoCard({ isRealChat: true, isChannel: true, numericChatId: CHANNEL_ID }),
      { wrapper: wrapper(first.managers) },
    )
    first.flush()
    await waitFor(() => expect(a.result.current.card).not.toBeNull())
    a.unmount()

    resetChatCardCache()

    const second = deferredManagers({ [CHANNEL_ID]: card({ myRole: 'subscriber' }) })
    const b = renderHook(
      () => useChatInfoCard({ isRealChat: true, isChannel: true, numericChatId: CHANNEL_ID }),
      { wrapper: wrapper(second.managers) },
    )
    expect(b.result.current.card).toBeNull()
    expect(b.result.current.permissionsKnown).toBe(false)
  })
})
