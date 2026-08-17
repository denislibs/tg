// subscribeMediaToken — не-React подписка на смену медиа-токена.
//
// Зачем отдельно от useMediaTokenVersion: стрим <video>/<audio> при DNP-OFF
// живёт на токенном URL, токен протухает за 15 минут, и императивному баблу
// ленты (React-хука у него нет) нужен тот же сигнал «пересобери src» — иначе
// открытое видео получит 401 на середине буфера. React-хук теперь ЭТА ЖЕ
// подписка (useSyncExternalStore поверх неё), второй реализации нет.
//
// Модульное состояние зеркала живёт в модуле — каждый кейс поднимает свежий
// реестр (vi.resetModules), как в core/mediaUrl.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tokenInfo } = vi.hoisted(() => ({ tokenInfo: vi.fn() }))
vi.mock('../client/bootstrap', () => ({ startClient: () => ({ managers: { media: { tokenInfo } } }) }))

const TOK = (token: string) => ({ token, expiresAt: Date.now() + 900_000 })

let m: typeof import('./mediaUrl')

beforeEach(async () => {
  vi.resetModules()
  tokenInfo.mockReset()
  tokenInfo.mockResolvedValue(TOK('worker-tok'))
  m = await import('./mediaUrl')
})

describe('subscribeMediaToken', () => {
  it('смена токена будит подписчика', async () => {
    const cb = vi.fn()
    m.subscribeMediaToken(cb)

    const fresh = TOK('fresh') // ровно ТОТ ЖЕ снимок ниже: сравнение идёт и по expiresAt
    m.applyMediaToken(fresh)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(m.mediaContentUrl(7)).toBe('/api/media/7/content?token=fresh')

    // повторное применение того же снимка подписчиков не будит (иначе каждый
    // бабл пересобирал бы src вхолостую)
    m.applyMediaToken(fresh)
    expect(cb).toHaveBeenCalledTimes(1)
    await Promise.resolve()
  })

  it('отписка работает: снятый бабл больше не будят', () => {
    const cb = vi.fn()
    const unsubscribe = m.subscribeMediaToken(cb)

    unsubscribe()
    m.applyMediaToken(TOK('fresh'))

    expect(cb).not.toHaveBeenCalled()
  })

  // Пин той же строки, что держит React-путь (core/mediaUrl.test.ts): потребитель,
  // который гейтится на hasMediaToken() и при «нет» рисует подложку, mediaContentUrl
  // не зовёт — к владельцу в этом состоянии идёт только сама подписка.
  it('подписка сама запрашивает токен у владельца, когда его нет', () => {
    expect(m.hasMediaToken()).toBe(false)
    m.subscribeMediaToken(vi.fn())
    expect(tokenInfo).toHaveBeenCalled()
  })

  it('сброс сессии (resetMediaToken) будит подписчика', () => {
    m.applyMediaToken(TOK('old'))
    const cb = vi.fn()
    m.subscribeMediaToken(cb)
    cb.mockClear()

    m.resetMediaToken()

    expect(cb).toHaveBeenCalledTimes(1)
    expect(m.hasMediaToken()).toBe(false)
  })
})
