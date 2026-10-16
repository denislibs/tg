// Лог звонка кладёт СЕРВЕР (backend usecase/chat/phonecall.go), как
// phone.discardCall у оригинала: клиент в чат ничего не отправляет, а лишь
// называет в call_end причину конца (tweb discardCall(reason),
// callInstance.ts:888). Здесь пинится и то, и другое: ни при одном исходе
// движок не зовёт messages.sendText, а кадры конца несут причину, по которой
// сервер выбирает Missed / Busy / Hangup / Disconnect.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectPair, createNet, FakePC, PEER_OF, pcOf, settle, until, type Net, type Side } from './callTestKit'

let net: Net

beforeEach(() => {
  // фейковые таймеры только для таймеров движка (45 с, грейс 8 с); setImmediate/реальные паузы
  // нужны реальной криптографии и реле
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  FakePC.reset()
  vi.stubGlobal('RTCPeerConnection', FakePC)
  net = createNet()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.doUnmock('../../client/bootstrap')
  vi.doUnmock('../audio/sounds')
})

const PEER = PEER_OF(2)
const reasonsOf = (side: Side, type: string) => side.frames(type).map((f) => f.data.reason)

describe('callEngine: лог звонка — забота сервера', () => {
  it('исходящий отменён до ответа: call_end с причиной hangup, sendText не зовётся', async () => {
    const A = await net.side(1)
    A.engine.startOutgoing(PEER, false)
    await until(() => A.frames('call_request').length === 1, 'call_request')

    A.engine.hangup()
    await vi.advanceTimersByTimeAsync(2000)

    expect(reasonsOf(A, 'call_end')).toEqual(['hangup'])
    expect(A.sendText).not.toHaveBeenCalled()
    expect(A.call()).toBeNull()
  })

  it('исходящий без ответа 45 с: call_end с причиной missed, sendText не зовётся', async () => {
    const A = await net.side(1)
    A.engine.startOutgoing(PEER, true)
    await vi.advanceTimersByTimeAsync(45_000)

    expect(reasonsOf(A, 'call_end')).toEqual(['missed'])
    expect(A.sendText).not.toHaveBeenCalled()
  })

  it('входящий отклонён: call_decline с причиной declined, sendText не зовётся', async () => {
    const B = await net.side(2)
    B.engine.handleFrame({ t: 'call_request', d: { call_id: 'c1', from_user_id: 1, video: false } })
    B.engine.decline()
    await vi.advanceTimersByTimeAsync(2000)

    expect(reasonsOf(B, 'call_decline')).toEqual(['declined'])
    expect(B.sendText).not.toHaveBeenCalled()
  })

  it('состоявшийся звонок, собеседник пропал: по истечении грейса call_end с причиной disconnect', async () => {
    const { A } = await connectPair(net)
    pcOf(A)!.setState('connected')
    expect(A.call()!.phase).toBe('active')

    pcOf(A)!.setState('disconnected')
    await vi.advanceTimersByTimeAsync(8000)

    expect(reasonsOf(A, 'call_end')).toEqual(['disconnect'])
    expect(A.sendText).not.toHaveBeenCalled()
  })

  it('состоявшийся звонок, соединение failed: call_end с причиной disconnect', async () => {
    const { A } = await connectPair(net)
    pcOf(A)!.setState('connected')
    pcOf(A)!.setState('failed')

    expect(reasonsOf(A, 'call_end')).toEqual(['disconnect'])
    expect(A.sendText).not.toHaveBeenCalled()
  })

  it('состоявшийся звонок положен кнопкой: call_end с причиной hangup', async () => {
    const { A } = await connectPair(net)
    pcOf(A)!.setState('connected')
    A.engine.hangup()

    expect(reasonsOf(A, 'call_end')).toEqual(['hangup'])
    expect(A.sendText).not.toHaveBeenCalled()
  })
})

// Кадр звонка — только по его call_id и только от собеседника (аудит A5-32):
// иначе посторонний кадром call_end без call_id обрывал чужой разговор.
// Второе устройство вызываемого гасится сервером (call_end answered_elsewhere)
// и не рвёт идущий разговор запоздалым отказом (A2-09).
describe('callEngine: кадры чужого звонка не действуют', () => {
  async function activeOutgoing() {
    const { A } = await connectPair(net)
    pcOf(A)!.setState('connected')
    return A
  }

  it('call_end без call_id не обрывает разговор', async () => {
    const A = await activeOutgoing()
    A.engine.handleFrame({ t: 'call_end', d: { from_user_id: PEER.id } })
    expect(A.call()!.phase).toBe('active')
  })

  it('call_end от не-собеседника не обрывает разговор', async () => {
    const A = await activeOutgoing()
    A.engine.handleFrame({ t: 'call_end', d: { call_id: A.call()!.callId, from_user_id: 99 } })
    expect(A.call()!.phase).toBe('active')
  })

  it('запоздалый call_decline (второе устройство) не рвёт разговор', async () => {
    const A = await activeOutgoing()
    A.engine.handleFrame({ t: 'call_decline', d: { call_id: A.call()!.callId, from_user_id: PEER.id, reason: 'missed' } })
    expect(A.call()!.phase).toBe('active')
  })

  it('answered_elsewhere гасит звонящий экран молча, без кадров', async () => {
    const B = await net.side(2)
    B.engine.handleFrame({ t: 'call_request', d: { call_id: 'c1', from_user_id: 1, video: false } })
    B.engine.handleFrame({ t: 'call_end', d: { call_id: 'c1', from_user_id: 5, reason: 'answered_elsewhere' } })
    expect(B.call()).toBeNull()
    await vi.advanceTimersByTimeAsync(45_000)
    expect(B.sent).toHaveLength(0)
  })

  it('answered_elsewhere не трогает устройство, которое ответило', async () => {
    const B = await net.side(2)
    B.engine.handleFrame({ t: 'call_request', d: { call_id: 'c1', from_user_id: 1, video: false, dh_hash: 'h' } })
    B.engine.accept()
    await until(() => B.call()?.phase === 'connecting', 'connecting')
    B.engine.handleFrame({ t: 'call_end', d: { call_id: 'c1', from_user_id: 5, reason: 'answered_elsewhere' } })
    expect(B.call()?.phase).toBe('connecting')
    await settle()
  })
})

// Б-8 (М3-2): политика ICE выбирается по p2p_allowed, которое ставит СЕРВЕР
// (tweb callInstance.ts:690-694, :1283-1287): разрешено — 'all', иначе 'relay' (IP не
// раскрывается собеседнику). Поле отсутствует или не boolean — закрываемся ('relay').
describe('callEngine: p2p_allowed → iceTransportPolicy', () => {
  const policies = () => FakePC.mains().map((p) => p.config.iceTransportPolicy)

  it('p2p_allowed: true у обеих сторон — pc создан с политикой all', async () => {
    net.p2pAllowed = true
    await connectPair(net)
    await until(() => FakePC.mains().length === 2, 'both pc')
    expect(policies()).toEqual(['all', 'all'])
  })

  it('p2p_allowed: false (запрет любой из сторон) — relay у обеих, звонок не рвётся', async () => {
    net.p2pAllowed = false
    const { A, B } = await connectPair(net)
    await until(() => FakePC.mains().length === 2, 'both pc')
    expect(policies()).toEqual(['relay', 'relay'])
    expect(A.call()!.endReason).toBeUndefined()
    expect(B.call()!.endReason).toBeUndefined()
  })

  it('входящий call_request без поля p2p_allowed — relay', async () => {
    net.p2pAllowed = undefined
    await connectPair(net)
    await until(() => FakePC.mains().length === 2, 'both pc')
    expect(policies()).toEqual(['relay', 'relay'])
  })

  it('p2p_allowed не boolean (строка "true") — relay', async () => {
    const B = await net.side(2)
    B.engine.handleFrame({ t: 'call_request', d: { call_id: 'c1', from_user_id: 1, video: false, dh_hash: 'h', p2p_allowed: 'true' } })
    B.engine.accept()
    await until(() => FakePC.mains().length === 1, 'pc')
    expect(policies()).toEqual(['relay'])
  })

  it('звонящий: call_accept с p2p_allowed: false — relay, true — all (значение берётся из call_accept)', async () => {
    for (const [allowed, want] of [[false, 'relay'], [true, 'all']] as const) {
      FakePC.reset()
      net = createNet()
      net.p2pAllowed = allowed
      const { A } = await connectPair(net)
      await until(() => FakePC.mains().length === 2, 'both pc')
      expect(A.call()!.p2pAllowed).toBe(allowed)
      expect(policies()).toEqual([want, want])
      A.engine.hangup()
      vi.resetModules()
    }
  })

  it('relay без TURN в iceServers: pc не создаётся, call_end disconnect, причина failed', async () => {
    net.p2pAllowed = false
    net.iceServers = [{ urls: ['stun:stun.test:3478'] }]
    const A = await net.side(1)
    const B = await net.side(2)
    A.engine.startOutgoing(PEER, false)
    await until(() => B.call()?.phase === 'incoming', 'incoming')
    B.engine.accept()
    await until(() => B.call()?.endReason === 'failed' && A.call()?.phase === 'ended', 'both ended')
    expect(FakePC.mains()).toHaveLength(0) // молчаливого перехода на 'all' нет
    expect(reasonsOf(B, 'call_end')).toEqual(['disconnect'])
  })

  it('p2p_allowed: true и нет TURN — звонок идёт (без TURN нужен лишь relay)', async () => {
    net.p2pAllowed = true
    net.iceServers = [{ urls: ['stun:stun.test:3478'] }]
    await connectPair(net)
    await until(() => FakePC.mains().length === 2, 'both pc')
    expect(policies()).toEqual(['all', 'all'])
  })
})

// К1: креды TURN живут час (ice_handler.go::iceCredentialTTL) и берутся на вход в звонок; кэш
// отдаёт их, пока до истечения больше 10 минут, и при сбое /calls/ice — пока больше минуты.
const MIN = 60_000
describe('callEngine: ICE-конфиг и срок кредов', () => {
  it('пока до истечения кредов больше 10 минут — один запрос, ближе — новый', async () => {
    const A = await net.side(1)
    await A.engine.iceServers()
    await vi.advanceTimersByTimeAsync(49 * MIN)
    await A.engine.iceServers()
    expect(net.iceFetches).toBe(1)
    await vi.advanceTimersByTimeAsync(2 * MIN)
    await A.engine.iceServers()
    expect(net.iceFetches).toBe(2)
  })

  it('сбой /calls/ice после кэша: пока креды живы — последний успешный конфиг (с TURN), не STUN-only', async () => {
    const A = await net.side(1)
    const first = await A.engine.iceServers()
    expect(A.engine.hasTurnServer(first)).toBe(true)
    net.iceFail = true
    await vi.advanceTimersByTimeAsync(51 * MIN)
    const again = await A.engine.iceServers()
    expect(net.iceFetches).toBe(2)
    expect(A.engine.hasTurnServer(again)).toBe(true)
  })

  it('сбой /calls/ice, кредам осталось меньше минуты — STUN-only: Allocate нового pc на них не пройдёт', async () => {
    const A = await net.side(1)
    await A.engine.iceServers()
    net.iceFail = true
    await vi.advanceTimersByTimeAsync(60 * MIN - 30_000)
    expect(A.engine.hasTurnServer(await A.engine.iceServers())).toBe(false)
  })

  it('сбой /calls/ice, кредам осталось больше минуты — ещё последний успешный конфиг', async () => {
    const A = await net.side(1)
    await A.engine.iceServers()
    net.iceFail = true
    await vi.advanceTimersByTimeAsync(58 * MIN)
    expect(A.engine.hasTurnServer(await A.engine.iceServers())).toBe(true)
  })

  it('keepIceFresh: креды обновляются за 10 минут до истечения, после остановки — нет', async () => {
    const A = await net.side(1)
    await A.engine.iceServers()
    const stop = A.engine.keepIceFresh()
    await vi.advanceTimersByTimeAsync(49 * MIN)
    expect(net.iceFetches).toBe(1)
    await vi.advanceTimersByTimeAsync(2 * MIN)
    expect(net.iceFetches).toBe(2)
    await vi.advanceTimersByTimeAsync(50 * MIN) // следующий срок — от новых кредов
    expect(net.iceFetches).toBe(3)
    stop()
    await vi.advanceTimersByTimeAsync(3 * 60 * MIN)
    expect(net.iceFetches).toBe(3)
  })

  it('keepIceFresh: сбой обновления — повтор через 30 с, а не сразу и не через час', async () => {
    const A = await net.side(1)
    await A.engine.iceServers()
    const stop = A.engine.keepIceFresh()
    net.iceFail = true
    await vi.advanceTimersByTimeAsync(50 * MIN + 1_000)
    expect(net.iceFetches).toBe(2)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(net.iceFetches).toBe(2)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(net.iceFetches).toBe(3)
    net.iceFail = false
    await vi.advanceTimersByTimeAsync(30_000)
    expect(net.iceFetches).toBe(4)
    await vi.advanceTimersByTimeAsync(40 * MIN)
    expect(net.iceFetches).toBe(4)
    stop()
  })

  it('первый же запрос /calls/ice упал, конфига ещё не было — STUN-only', async () => {
    const A = await net.side(1)
    net.iceFail = true
    expect(A.engine.hasTurnServer(await A.engine.iceServers())).toBe(false)
    expect(net.iceFetches).toBe(1)
  })

  it('/calls/ice висит: через 10 с — откат, следующий вызов идёт новым запросом', async () => {
    const A = await net.side(1)
    net.iceHang = true
    let done = false
    const first = A.engine.iceServers().then((s) => { done = true; return s })
    await vi.advanceTimersByTimeAsync(9_000)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(A.engine.hasTurnServer(await first)).toBe(false)
    net.iceHang = false
    expect(A.engine.hasTurnServer(await A.engine.iceServers())).toBe(true)
    expect(net.iceFetches).toBe(2)
  })

  it('/calls/ice висит после кэша, креды живы: через 10 с — последний конфиг с TURN', async () => {
    const A = await net.side(1)
    await A.engine.iceServers()
    await vi.advanceTimersByTimeAsync(51 * MIN)
    net.iceHang = true
    const again = A.engine.iceServers()
    await vi.advanceTimersByTimeAsync(10_500)
    expect(A.engine.hasTurnServer(await again)).toBe(true)
  })

  it('одновременные запросы конфига (несколько pc mesh) — один /calls/ice', async () => {
    const A = await net.side(1)
    const all = await Promise.all([A.engine.iceServers(), A.engine.iceServers(), A.engine.iceServers()])
    expect(net.iceFetches).toBe(1)
    expect(all.every((s) => A.engine.hasTurnServer(s))).toBe(true)
  })
})
