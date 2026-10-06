// Лог звонка кладёт СЕРВЕР (backend usecase/chat/phonecall.go), как
// phone.discardCall у оригинала: клиент в чат ничего не отправляет, а лишь
// называет в call_end причину конца (tweb discardCall(reason),
// callInstance.ts:888). Здесь пинится и то, и другое: ни при одном исходе
// движок не зовёт messages.sendText, а кадры конца несут причину, по которой
// сервер выбирает Missed / Busy / Hangup / Disconnect.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendCallFrame = vi.fn()
const sendText = vi.fn()

vi.mock('../../client/bootstrap', () => ({
  startClient: () => ({
    managers: {
      realtime: { sendCallFrame: (...a: unknown[]) => sendCallFrame(...a) },
      messages: { sendText: (...a: unknown[]) => sendText(...a) },
      calls: { iceConfig: async () => ({ servers: [], ttlSeconds: 0 }) },
      peers: { getUsers: async () => [] },
    },
  }),
}))
vi.mock('../audio/sounds', () => ({ playSound: () => {}, stopSound: () => {} }))
vi.mock('../secret/crypto', () => ({
  generateKeyPair: async () => ({ privateKey: {}, publicKey: {} }),
  exportPublicKey: async () => new Uint8Array([1]),
  deriveSecret: async () => ({ fingerprint: new Uint8Array(32) }),
  b64FromBytes: () => 'pub',
  b64ToBytes: () => new Uint8Array([1]),
}))

// Минимальный RTCPeerConnection: движку нужны колбэки состояния и приём-only
// трансиверы (медиа-устройств в happy-dom нет).
class FakePC {
  static last: FakePC | null = null
  connectionState: RTCPeerConnectionState = 'new'
  signalingState: RTCSignalingState = 'stable'
  onicecandidate: unknown = null
  ontrack: unknown = null
  onnegotiationneeded: unknown = null
  onconnectionstatechange: (() => void) | null = null
  constructor() { FakePC.last = this }
  addTransceiver() {}
  addTrack() { return {} }
  getSenders() { return [] }
  close() {}
  setState(st: RTCPeerConnectionState) {
    this.connectionState = st
    this.onconnectionstatechange?.()
  }
}

type Engine = typeof import('./callEngine')
type Store = typeof import('../../stores/callStore')
let engine: Engine
let callStore: Store

const PEER = { id: 2, name: 'Боб', avatar: '#000' }

function framesOf(type: string) {
  return sendCallFrame.mock.calls.map((c) => c[0] as { type: string; data: Record<string, unknown> }).filter((f) => f.type === type)
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  sendCallFrame.mockReset()
  sendText.mockReset()
  FakePC.last = null
  vi.stubGlobal('RTCPeerConnection', FakePC)
  engine = await import('./callEngine')
  callStore = await import('../../stores/callStore')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('callEngine: лог звонка — забота сервера', () => {
  it('исходящий отменён до ответа: call_end с причиной hangup, sendText не зовётся', async () => {
    engine.startOutgoing(PEER, false)
    await vi.advanceTimersByTimeAsync(0)
    expect(framesOf('call_request')).toHaveLength(1)

    engine.hangup()
    await vi.advanceTimersByTimeAsync(2000)

    expect(framesOf('call_end').map((f) => f.data.reason)).toEqual(['hangup'])
    expect(sendText).not.toHaveBeenCalled()
    expect(callStore.useCallStore.getState().call).toBeNull()
  })

  it('исходящий без ответа 45 с: call_end с причиной missed, sendText не зовётся', async () => {
    engine.startOutgoing(PEER, true)
    await vi.advanceTimersByTimeAsync(45_000)

    expect(framesOf('call_end').map((f) => f.data.reason)).toEqual(['missed'])
    expect(sendText).not.toHaveBeenCalled()
  })

  it('входящий отклонён: call_decline с причиной declined, sendText не зовётся', async () => {
    engine.handleFrame({ t: 'call_request', d: { call_id: 'c1', from_user_id: 1, video: false } })
    engine.decline()
    await vi.advanceTimersByTimeAsync(2000)

    expect(framesOf('call_decline').map((f) => f.data.reason)).toEqual(['declined'])
    expect(sendText).not.toHaveBeenCalled()
  })

  it('состоявшийся звонок, собеседник пропал: по истечении грейса call_end с причиной disconnect', async () => {
    engine.startOutgoing(PEER, false)
    await vi.advanceTimersByTimeAsync(0)
    const callId = callStore.useCallStore.getState().call!.callId
    engine.handleFrame({ t: 'call_accept', d: { call_id: callId, from_user_id: 2 } })
    await vi.advanceTimersByTimeAsync(0)
    const pc = FakePC.last!
    pc.setState('connected')
    expect(callStore.useCallStore.getState().call!.phase).toBe('active')

    pc.setState('disconnected')
    await vi.advanceTimersByTimeAsync(8000)

    expect(framesOf('call_end').map((f) => f.data.reason)).toEqual(['disconnect'])
    expect(sendText).not.toHaveBeenCalled()
  })

  it('состоявшийся звонок, соединение failed: call_end с причиной disconnect', async () => {
    engine.startOutgoing(PEER, false)
    await vi.advanceTimersByTimeAsync(0)
    const callId = callStore.useCallStore.getState().call!.callId
    engine.handleFrame({ t: 'call_accept', d: { call_id: callId, from_user_id: 2 } })
    await vi.advanceTimersByTimeAsync(0)
    FakePC.last!.setState('connected')
    FakePC.last!.setState('failed')

    expect(framesOf('call_end').map((f) => f.data.reason)).toEqual(['disconnect'])
    expect(sendText).not.toHaveBeenCalled()
  })

  it('состоявшийся звонок положен кнопкой: call_end с причиной hangup', async () => {
    engine.startOutgoing(PEER, false)
    await vi.advanceTimersByTimeAsync(0)
    const callId = callStore.useCallStore.getState().call!.callId
    engine.handleFrame({ t: 'call_accept', d: { call_id: callId, from_user_id: 2 } })
    await vi.advanceTimersByTimeAsync(0)
    FakePC.last!.setState('connected')
    engine.hangup()

    expect(framesOf('call_end').map((f) => f.data.reason)).toEqual(['hangup'])
    expect(sendText).not.toHaveBeenCalled()
  })
})

// Кадр звонка — только по его call_id и только от собеседника (аудит A5-32):
// иначе посторонний кадром call_end без call_id обрывал чужой разговор.
// Второе устройство вызываемого гасится сервером (call_end answered_elsewhere)
// и не рвёт идущий разговор запоздалым отказом (A2-09).
describe('callEngine: кадры чужого звонка не действуют', () => {
  async function activeOutgoing() {
    engine.startOutgoing(PEER, false)
    await vi.advanceTimersByTimeAsync(0)
    const callId = callStore.useCallStore.getState().call!.callId
    engine.handleFrame({ t: 'call_accept', d: { call_id: callId, from_user_id: PEER.id } })
    await vi.advanceTimersByTimeAsync(0)
    FakePC.last!.setState('connected')
    return callId
  }

  it('call_end без call_id не обрывает разговор', async () => {
    await activeOutgoing()
    engine.handleFrame({ t: 'call_end', d: { from_user_id: PEER.id } })
    expect(callStore.useCallStore.getState().call!.phase).toBe('active')
  })

  it('call_end от не-собеседника не обрывает разговор', async () => {
    const callId = await activeOutgoing()
    engine.handleFrame({ t: 'call_end', d: { call_id: callId, from_user_id: 99 } })
    expect(callStore.useCallStore.getState().call!.phase).toBe('active')
  })

  it('запоздалый call_decline (второе устройство) не рвёт разговор', async () => {
    const callId = await activeOutgoing()
    engine.handleFrame({ t: 'call_decline', d: { call_id: callId, from_user_id: PEER.id, reason: 'missed' } })
    expect(callStore.useCallStore.getState().call!.phase).toBe('active')
  })

  it('answered_elsewhere гасит звонящий экран молча, без кадров', async () => {
    engine.handleFrame({ t: 'call_request', d: { call_id: 'c1', from_user_id: 1, video: false } })
    engine.handleFrame({ t: 'call_end', d: { call_id: 'c1', from_user_id: 5, reason: 'answered_elsewhere' } })
    expect(callStore.useCallStore.getState().call).toBeNull()
    await vi.advanceTimersByTimeAsync(45_000)
    expect(sendCallFrame).not.toHaveBeenCalled()
  })

  it('answered_elsewhere не трогает устройство, которое ответило', async () => {
    engine.handleFrame({ t: 'call_request', d: { call_id: 'c1', from_user_id: 1, video: false } })
    engine.accept()
    await vi.advanceTimersByTimeAsync(0)
    engine.handleFrame({ t: 'call_end', d: { call_id: 'c1', from_user_id: 5, reason: 'answered_elsewhere' } })
    expect(callStore.useCallStore.getState().call?.phase).toBe('connecting')
  })
})
