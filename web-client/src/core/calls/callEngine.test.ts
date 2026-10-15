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
