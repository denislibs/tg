// Видеочат: сигнал принимается только от участника звонка (аудит A5-04). На
// offer постороннего движок создавал RTCPeerConnection, доливал в него свой
// микрофон и камеру и отвечал — посторонний получал медиа участника.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendCallFrame = vi.fn()
const TURN: RTCIceServer = { urls: ['turn:turn.test:3478?transport=udp'], username: 'u', credential: 'c' }
let iceServers: RTCIceServer[] = []

vi.mock('../../client/bootstrap', () => ({
  startClient: () => ({
    managers: {
      realtime: { sendCallFrame: (...a: unknown[]) => sendCallFrame(...a) },
      calls: { iceConfig: async () => ({ servers: iceServers, ttlSeconds: 3600 }) },
      messages: { groupCallParticipants: async () => [] },
    },
  }),
}))
vi.mock('../../stores/chatsStore', () => ({ useChatsStore: { getState: () => ({ meId: 1 }) } }))

const created: RTCConfiguration[] = []
class FakePC {
  onicecandidate: unknown = null
  ontrack: unknown = null
  onconnectionstatechange: unknown = null
  constructor(config: RTCConfiguration = {}) { created.push(config) }
  addTrack() {}
  async setRemoteDescription() {}
  async createAnswer() { return { type: 'answer', sdp: 'a' } }
  async setLocalDescription() {}
  get localDescription() { return { type: 'answer', sdp: 'a' } }
  close() {}
}

type Engine = typeof import('./groupCallEngine')
type Store = typeof import('../../stores/groupCallStore')
let engine: Engine
let store: Store

const PEER = -100

beforeEach(async () => {
  vi.resetModules()
  created.length = 0
  iceServers = []
  sendCallFrame.mockReset()
  vi.stubGlobal('RTCPeerConnection', FakePC)
  engine = await import('./groupCallEngine')
  store = await import('../../stores/groupCallStore')
  store.useGroupCallStore.getState().setJoined(PEER)
  store.useGroupCallStore.getState().setActive(PEER, [1, 2])
})

const offer = (from: number) => ({
  t: 'group_call_signal', d: { peer_id: PEER, from_user_id: from, sdp: { type: 'offer' as const, sdp: 'o' } },
})

describe('groupCallEngine: сигнал только от участника', () => {
  it('offer постороннего не создаёт соединения и не получает ответа', async () => {
    engine.handleGroupCallFrame(offer(7))
    await new Promise((r) => setTimeout(r, 0))
    expect(created).toHaveLength(0)
    expect(sendCallFrame).not.toHaveBeenCalled()
  })

  it('offer участника звонка принимается', async () => {
    engine.handleGroupCallFrame(offer(2))
    await vi.waitFor(() => expect(created).toHaveLength(1))
    await vi.waitFor(() => expect(sendCallFrame).toHaveBeenCalled())
  })
})

// Б-8 (М3-2): у tweb групповой звонок ходит к SFU, IP участника видит только сервер. У нас mesh,
// поэтому та же модель видимости — все соединения через TURN (`relay`), прямых кандидатов нет.
describe('groupCallEngine: mesh только через TURN', () => {
  it('соединение с участником создаётся с iceTransportPolicy relay', async () => {
    iceServers = [TURN]
    engine.handleGroupCallFrame(offer(2))
    await vi.waitFor(() => expect(created).toHaveLength(1))
    expect(created[0].iceTransportPolicy).toBe('relay')
  })

  it('вход без TURN в iceServers: group_call_join не шлётся, микрофон не запрашивается, состояние сброшено', async () => {
    iceServers = [{ urls: ['stun:stun.test:3478'] }]
    const getUserMedia = vi.fn()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    store.useGroupCallStore.getState().reset()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await engine.joinGroupCall(PEER)

    expect(sendCallFrame).not.toHaveBeenCalled()
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(store.useGroupCallStore.getState().peerId).toBeNull()
    expect(store.useGroupCallStore.getState().connecting).toBe(false)
    expect(error).toHaveBeenCalled()
  })

  it('вход с TURN: group_call_join уходит', async () => {
    iceServers = [TURN]
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] }) } })
    store.useGroupCallStore.getState().reset()

    await engine.joinGroupCall(PEER)

    expect(sendCallFrame).toHaveBeenCalledWith({ type: 'group_call_join', data: { peer_id: PEER } })
  })

  it('двойной вход (два клика) — один getUserMedia и один group_call_join', async () => {
    iceServers = [TURN]
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    store.useGroupCallStore.getState().reset()

    await Promise.all([engine.joinGroupCall(PEER), engine.joinGroupCall(PEER)])

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(sendCallFrame.mock.calls.filter(([f]) => f.type === 'group_call_join')).toHaveLength(1)
  })
})
