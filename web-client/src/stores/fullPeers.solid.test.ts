// Пин Solid-порта tweb `stores/fullPeers.ts` (Task 1, план
// docs/superpowers/plans/2026-09-05-profile-card-solid.md) + сведения
// писателей (Task 1.5, `ensureFullPeer`). Каждый кейс поднимает свежий
// реестр модулей (`vi.resetModules`): и зеркало (`core/chatFullCache.ts`), и
// локальная карта `expirations` внутри `fullPeers.solid.ts` — модульное
// состояние, общее для всех тестов файла.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'solid-js'
import { cleanup, renderHook, act } from '@testing-library/react'
import type { Managers } from '../client/bootstrap'

const { profile, card, fillMirror } = vi.hoisted(() => ({ profile: vi.fn(), card: vi.fn(), fillMirror: vi.fn() }))
vi.mock('../client/bootstrap', () => ({
  startClient: () => ({ managers: { privacy: { profile }, groups: { card } } }),
}))
// `useUserProfile` (Task 2, React-панель) идёт через DI-контекст
// (`useManagers()`), а не `startClient()` напрямую — см. докблок
// `core/hooks/useManagers.tsx`. Managers ТЕ ЖЕ шпионы `profile`/`card`, что и
// у мока `startClient` выше: единственность пути проверяется именно ИХ
// СЧЁТЧИКОМ ВЫЗОВОВ, а не тем, что обе функции существуют.
vi.mock('../core/hooks/useManagers', () => ({
  useManagers: () => ({ privacy: { profile }, groups: { card }, peers: { fillMirror } }),
}))

const userFull = (id: number, over: Partial<Record<string, unknown>> = {}) => ({
  _: 'userFull' as const,
  id,
  about: 'bio',
  ...over,
})
const channelFull = (id: number, over: Partial<Record<string, unknown>> = {}) => ({
  _: 'channelFull' as const,
  id,
  about: '',
  read_inbox_max_id: 0,
  read_outbox_max_id: 0,
  unread_count: 0,
  chat_photo: null,
  ...over,
})

let m: typeof import('./fullPeers.solid')

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  profile.mockReset()
  card.mockReset()
  fillMirror.mockReset()
  profile.mockResolvedValue({ user: { _: 'user', id: 1 }, fullUser: userFull(1), canMessage: true })
  card.mockResolvedValue({ peerId: -1, chat: { _: 'channel', id: 1 }, fullChat: channelFull(1) })
  fillMirror.mockResolvedValue(undefined)
  m = await import('./fullPeers.solid')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useFullPeer (Solid)', () => {
  it('пользователь (peerId ≥ 0): запрашивает privacy.profile() и отдаёт fullUser', async () => {
    let dispose!: () => void
    const full = createRoot((d) => {
      dispose = d
      return m.useFullPeer(1)
    })
    expect(full()).toBeUndefined() // сеть ещё не ответила

    await vi.advanceTimersByTimeAsync(0)
    expect(profile).toHaveBeenCalledWith(1)
    expect(card).not.toHaveBeenCalled()
    expect(full()).toEqual(userFull(1))
    dispose()
  })

  it('чат (peerId < 0): запрашивает groups.card() и отдаёт fullChat', async () => {
    let dispose!: () => void
    const full = createRoot((d) => {
      dispose = d
      return m.useFullPeer(-1)
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(card).toHaveBeenCalledWith(-1)
    expect(profile).not.toHaveBeenCalled()
    expect(full()?._).toBe('channelFull')
    dispose()
  })

  it('TTL: по истечении PEER_FULL_TTL карточка перезапрашивается сама', async () => {
    let dispose!: () => void
    createRoot((d) => {
      dispose = d
      m.useFullPeer(1)
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(profile).toHaveBeenCalledTimes(1)

    // МУТАЦИЯ: замени `PEER_FULL_TTL` на бесконечность / убери setInterval —
    // второй вызов не случится, и этот expect упадёт.
    await vi.advanceTimersByTimeAsync(m.PEER_FULL_TTL)
    expect(profile).toHaveBeenCalledTimes(2)
    dispose()
  })

  it('cleanup: после dispose таймеры не тикают', async () => {
    let dispose!: () => void
    createRoot((d) => {
      dispose = d
      m.useFullPeer(1)
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(profile).toHaveBeenCalledTimes(1)

    dispose()
    // МУТАЦИЯ: убери `onCleanup(() => { clearInterval/clearTimeout })` —
    // profile продолжит вызываться и после dispose, этот expect упадёт.
    await vi.advanceTimersByTimeAsync(m.PEER_FULL_TTL * 3)
    expect(profile).toHaveBeenCalledTimes(1)
  })

  it('refreshFullPeer форсирует повторный запрос вне расписания TTL', async () => {
    let dispose!: () => void
    createRoot((d) => {
      dispose = d
      m.useFullPeer(1)
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(profile).toHaveBeenCalledTimes(1)

    m.refreshFullPeer(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(profile).toHaveBeenCalledTimes(2)
    dispose()
  })

  it('overwrite=true (refreshFullPeer) запоминает срок протухания — новый маунт того же peerId досрочно планирует ТОЛЬКО оставшийся остаток, не полный TTL заново', async () => {
    // Первый маунт: мягкая фетч без сброса срока (overwrite=false).
    let dispose!: () => void
    createRoot((d) => {
      dispose = d
      m.useFullPeer(1)
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(profile).toHaveBeenCalledTimes(1)

    // Форсированный сброс — ТЕПЕРЬ срок протухания известен (Date.now() + TTL).
    m.refreshFullPeer(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(profile).toHaveBeenCalledTimes(2)

    dispose() // useDynamicCachedValue гасит корень: интервал/таймаут этого маунта сняты

    // Половина срока проходит БЕЗ живого потребителя.
    await vi.advanceTimersByTimeAsync(m.PEER_FULL_TTL / 2)
    expect(profile).toHaveBeenCalledTimes(2) // никто не подписан — тишина

    // Новый маунт того же peerId: `expirations` пережила dispose (модульная
    // карта), карточка в зеркале уже есть — мягкой немедленной фетчи не будет,
    // а вот `timeout` обязан встать на ОСТАВШИЙСЯ остаток (TTL/2), а не заново
    // ждать полный TTL, как ждал бы `setInterval` первого маунта.
    let dispose2!: () => void
    createRoot((d) => {
      dispose2 = d
      m.useFullPeer(1)
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(profile).toHaveBeenCalledTimes(2) // маунт не запросил заново — карточка свежая

    // МУТАЦИЯ: инвертируй `if (overwrite) expirations.set(...)` на `if (!overwrite)`
    // — `expirations` для peerId=1 перестанет обновляться реальным сбросом, и
    // третий вызов ниже либо не случится к этому моменту, либо случится раньше
    // тестового окна: строка ниже перестанет совпадать с реальным временем.
    await vi.advanceTimersByTimeAsync(m.PEER_FULL_TTL / 2 - 1)
    expect(profile).toHaveBeenCalledTimes(2) // остаток ещё не истёк

    await vi.advanceTimersByTimeAsync(2)
    expect(profile).toHaveBeenCalledTimes(3) // именно теперь истёк ОСТАТОК исходного срока
    dispose2()
  })

  it('два потребителя одного peerId делят один таймер (useDynamicCachedValue): один сетевой поход, не два', async () => {
    let dispose!: () => void
    createRoot((d) => {
      dispose = d
      m.useFullPeer(1)
      m.useFullPeer(1)
    })
    await vi.advanceTimersByTimeAsync(0)
    // МУТАЦИЯ: вызови `_useFullPeer` напрямую вместо `useDynamicCachedValue(...)`
    // — каждый потребитель заведёт свой запрос, здесь будет 2.
    expect(profile).toHaveBeenCalledTimes(1)
    dispose()
  })
})

// Task 1.5: сведение писателей `useChatInfoCard.ts`/`Chat.tsx` на `ensureFullPeer`.
// Пин на саму мотивацию задачи — ревью задачи 1 нашло, что как только Solid-
// профиль (Task 2) смонтируется РЯДОМ с открытым чатом, за один и тот же peerId
// полетят два независимых запроса. Здесь `ensureFullPeer(managers, peerId)`
// подставлен на место реального вызова `Chat.tsx`, а `m.useFullPeer` — на
// место реального Solid-профиля; менеджеры общие (`vi.mock` выше), как в
// проде — общий `startClient()`/`useManagers()`.
describe('ensureFullPeer: единственность сетевого пути (Task 1.5)', () => {
  const managers = { privacy: { profile }, groups: { card } } as unknown as Managers

  it('React-эффект (Chat.tsx) фетчит первым — Solid-профиль того же пира сеть повторно не открывает', async () => {
    m.ensureFullPeer(managers, 1)
    await vi.advanceTimersByTimeAsync(0)
    expect(profile).toHaveBeenCalledTimes(1)

    let dispose!: () => void
    createRoot((d) => {
      dispose = d
      m.useFullPeer(1) // Task 2: профиль монтируется рядом с открытым чатом
    })
    await vi.advanceTimersByTimeAsync(0)
    // МУТАЦИЯ: в `isFullPeerFresh` требуй `expirations` даже при лежащей
    // карточке (как дословный порт tweb) — второй вызов случится, здесь будет 2.
    expect(profile).toHaveBeenCalledTimes(1)
    dispose()
  })

  // Обратный порядок: Solid успевает первым (пользователь открыл профиль
  // раньше, чем это заметил React-эффект приватного чата, либо повторный
  // маунт того же профиля).
  it('и наоборот: Solid фетчит первым — React-эффект (Chat.tsx) того же пира сеть повторно не открывает', async () => {
    let dispose!: () => void
    createRoot((d) => {
      dispose = d
      m.useFullPeer(1)
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(profile).toHaveBeenCalledTimes(1)

    m.ensureFullPeer(managers, 1) // Chat.tsx: эффект приватного чата того же пира
    await vi.advanceTimersByTimeAsync(0)
    expect(profile).toHaveBeenCalledTimes(1)
    dispose()
  })
})

// `useChatInfoCard.ts` (чат/канал, НЕ пользователь) через `ensureFullPeer` не
// идёт вовсе — см. её докблок: она вызывается и для приватного диалога, где
// `isUser(peerId)` увёл бы запрос на `privacy.profile()` вместо `groups.card()`.
// Поэтому она продолжает звать `groups.card()` НАПРЯМУЮ и БЕЗУСЛОВНО при
// каждом маунте (пин — `useChatInfoCard.test.tsx`, «повторный вход в канал»),
// а вклад в Task 1.5 с её стороны — `markFullPeerFetched` ПОСЛЕ своего
// успешного похода: другую сторону (Solid-профиль ТОГО ЖЕ чата/канала) это
// избавляет от повторного запроса, хотя сама она себя так не бережёт.
describe('ensureFullPeer: односторонняя выгода для чата/канала (useChatInfoCard не гейтится, Solid — да)', () => {
  it('чат уже загружен мимо ensureFullPeer (как это делает useChatInfoCard) — Solid того же чата сеть не открывает', async () => {
    const chatFullCache = await import('../core/chatFullCache')
    const c = await card(-1) // тот же вызов, что делает useChatInfoCard.ts
    const ticket = chatFullCache.beginPeerFullFetch(-1)
    chatFullCache.saveChatFull(-1, c.fullChat, ticket)
    m.markFullPeerFetched(-1) // ровно то, что useChatInfoCard.ts зовёт после saveChatFull
    expect(card).toHaveBeenCalledTimes(1)

    let dispose!: () => void
    createRoot((d) => {
      dispose = d
      m.useFullPeer(-1) // Task 2: Solid-профиль ТОГО ЖЕ чата рядом
    })
    await vi.advanceTimersByTimeAsync(0)
    // МУТАЦИЯ: убери вызов `markFullPeerFetched` в useChatInfoCard.ts —
    // Solid не увидит карточку свежей и продублирует поход, здесь будет 2.
    expect(card).toHaveBeenCalledTimes(1)
    dispose()
  })
})

// Task 2 профиля на Solid, «пятый писатель» (находка ревью 1.5):
// `core/hooks/useUserProfileData.ts::useUserProfile` (React, живёт в
// `UserInfoPanel.tsx`) раньше звал `managers.privacy.profile(peerId)` САМ —
// второй, независимый от Solid-профиля поход за той же карточкой. Здесь
// `useUserProfile` — настоящий (не заглушка), рендерится `renderHook`; Solid
// сторона — `m.useFullPeer`, как и в блоке выше. Пин — счётчик вызовов
// `profile` (менеджер), а не факт «функция позвалась».
describe('useUserProfile (React, UserInfoPanel): единственность сетевого пути (Task 2)', () => {
  const seedPeerMirror = async () => {
    const peerCache = await import('../core/peerCache')
    peerCache.applyPeerOps([{
      op: 'upsert',
      peers: [{ _: 'user', id: 1, first_name: 'Дн', pFlags: { verified: true } }],
    }])
    return peerCache
  }

  it('React-хук (панель) фетчит первым — Solid-профиль того же пира сеть повторно не открывает', async () => {
    await seedPeerMirror()
    const { useUserProfile } = await import('../core/hooks/useUserProfileData')

    const { result, unmount } = renderHook(() => useUserProfile(1, false))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(profile).toHaveBeenCalledTimes(1)
    expect(result.current?.fullUser).toEqual(userFull(1))
    unmount()

    let dispose!: () => void
    createRoot((d) => {
      dispose = d
      m.useFullPeer(1) // Task 2: Solid-профиль того же пира монтируется рядом
    })
    await vi.advanceTimersByTimeAsync(0)
    // МУТАЦИЯ: верни `useUserProfile` к прямому `managers.privacy.profile()` —
    // второй независимый поход случится, здесь будет 2.
    expect(profile).toHaveBeenCalledTimes(1)
    dispose()
  })

  // Обратный порядок: пользователь открыл Solid-профиль (например, из чужого
  // чата) раньше, чем открыл панель профиля того же пира.
  it('и наоборот: Solid фетчит первым — React-хук (панель) того же пира сеть повторно не открывает', async () => {
    await seedPeerMirror()
    const { useUserProfile } = await import('../core/hooks/useUserProfileData')

    let dispose!: () => void
    createRoot((d) => {
      dispose = d
      m.useFullPeer(1)
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(profile).toHaveBeenCalledTimes(1)

    const { result, unmount } = renderHook(() => useUserProfile(1, false))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(profile).toHaveBeenCalledTimes(1)
    expect(result.current?.fullUser).toEqual(userFull(1)) // подхватил карточку, которую принёс Solid
    unmount()
    dispose()
  })

  it('телефон — из ЕДИНСТВЕННОГО ответа privacy.profile(), смёрженный в user; username/verified — из общего зеркала пиров, а не из этого ответа', async () => {
    profile.mockResolvedValue({
      user: { _: 'user', id: 1, phone: '+79990001122', username: 'из-privacy-profile-ИГНОРИРУЕТСЯ' },
      fullUser: userFull(1),
      canMessage: true,
    })
    await seedPeerMirror() // username в общем зеркале не задан — undefined, а не то, что "приехало" в profile()
    const { useUserProfile } = await import('../core/hooks/useUserProfileData')

    const { result, unmount } = renderHook(() => useUserProfile(1, false))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(result.current?.user.phone).toBe('+79990001122') // из privacy.profile(), единственного источника
    expect(result.current?.user.pFlags?.verified).toBe(true) // из ОБЩЕГО зеркала (seedPeerMirror), не из profile()
    // МУТАЦИЯ: замени источник username/verified на `profile.user` вместо
    // общего зеркала — эта строка перестанет отличать источники и может
    // случайно пройти; см. вместо неё явную проверку username ниже.
    expect(result.current?.user.username).toBeUndefined()
    unmount()
  })

  it('пробел общего зеркала пиров объявляется (fillMirror), если панель открылась раньше диалогов', async () => {
    const { useUserProfile } = await import('../core/hooks/useUserProfileData')
    // Зеркало НЕ засеяно — cachedPeer(1) === undefined.
    const { unmount } = renderHook(() => useUserProfile(1, false))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    // МУТАЦИЯ: убери вызов `managers.peers.fillMirror([peerId])` — этот
    // expect упадёт (пробел останется необъявленным).
    expect(fillMirror).toHaveBeenCalledWith([1])
    unmount()
  })

  it('isSaved=true / peerId=null — сеть не открывается вовсе (свой профиль показывает панель иначе)', async () => {
    const { useUserProfile } = await import('../core/hooks/useUserProfileData')
    const { result: r1, unmount: u1 } = renderHook(() => useUserProfile(1, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(profile).not.toHaveBeenCalled()
    expect(r1.current).toBeNull()
    u1()

    const { result: r2, unmount: u2 } = renderHook(() => useUserProfile(null, false))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(profile).not.toHaveBeenCalled()
    expect(r2.current).toBeNull()
    u2()
  })
})
