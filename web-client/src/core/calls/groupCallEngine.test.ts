// Видеочат: сигнал принимается только от участника звонка (аудит A5-04). На
// offer постороннего движок создавал RTCPeerConnection, доливал в него свой
// микрофон и камеру и отвечал — посторонний получал медиа участника.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendCallFrame = vi.fn()
const toastNew = vi.fn()
let iceGate: Promise<unknown> = Promise.resolve()
let existingParticipants: number[] = []
vi.mock('@components/toast', () => ({ toastNew: (...a: unknown[]) => toastNew(...a) }))

vi.mock('../../client/bootstrap', () => ({
  startClient: () => ({
    managers: {
      realtime: { sendCallFrame: (...a: unknown[]) => sendCallFrame(...a) },
      messages: { groupCallParticipants: async () => existingParticipants },
      calls: { iceConfig: async () => { await iceGate; return { servers: [], ttlSeconds: 0 } } },
    },
  }),
}))
vi.mock('../../stores/chatsStore', () => ({ useChatsStore: { getState: () => ({ meId: 1 }) } }))

const created: number[] = []
class FakePC {
  onicecandidate: unknown = null
  ontrack: unknown = null
  onconnectionstatechange: unknown = null
  constructor() { created.push(1) }
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
  sendCallFrame.mockReset()
  toastNew.mockReset()
  iceGate = Promise.resolve()
  existingParticipants = []
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

// Б-9: сервер не пустил в видеочат. К этому моменту клиент уже взял микрофон и
// открыл экран звонка — кадр rejected всё откатывает БЕЗ group_call_leave.
describe('groupCallEngine: отказ входа (action = rejected)', () => {
  const stopped: boolean[] = []
  const track = () => ({ stop: () => stopped.push(true), enabled: true })

  beforeEach(() => {
    stopped.length = 0
    store.useGroupCallStore.getState().reset()
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [track()], getAudioTracks: () => [], getVideoTracks: () => [] }),
      },
    })
  })

  const rejected = (peer: number, user: number) => ({
    t: 'group_call_update', d: { peer_id: peer, user_id: user, action: 'rejected' as const },
  })

  it('убирает локальный звонок, останавливает треки, не шлёт group_call_leave, показывает тост', async () => {
    await engine.joinGroupCall(PEER)
    expect(store.useGroupCallStore.getState().peerId).toBe(PEER)
    sendCallFrame.mockClear()

    engine.handleGroupCallFrame(rejected(PEER, 1))

    expect(store.useGroupCallStore.getState().peerId).toBeNull()
    expect(stopped).toHaveLength(1)
    expect(engine.getLocalStream()).toBeNull()
    expect(sendCallFrame).not.toHaveBeenCalled()
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'VoiceChat.Chat.Ended' })
  })

  it('отказ не затирает список участников идущего звонка', async () => {
    store.useGroupCallStore.getState().setActive(PEER, [2, 3])
    await engine.joinGroupCall(PEER)
    engine.handleGroupCallFrame(rejected(PEER, 1))
    expect(store.useGroupCallStore.getState().activeByChat[PEER]).toEqual([2, 3])
  })

  it('отказ чужого пользователя или другого чата звонок не трогает', async () => {
    await engine.joinGroupCall(PEER)
    engine.handleGroupCallFrame(rejected(PEER, 2))
    engine.handleGroupCallFrame(rejected(-200, 1))
    expect(store.useGroupCallStore.getState().peerId).toBe(PEER)
    expect(stopped).toHaveLength(0)
    expect(toastNew).not.toHaveBeenCalled()
  })

  it('зритель эфира: отказ снимает просмотр', async () => {
    const live = await import('../../stores/livestreamStore')
    live.useLivestreamStore.getState().setWatching(PEER)
    engine.handleGroupCallFrame(rejected(PEER, 1))
    expect(live.useLivestreamStore.getState().watchingPeerId).toBeNull()
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'VoiceChat.Chat.Ended' })
  })

  it('отказ, пока ждём ICE-конфиг для оффера: соединение не создаётся, звонок остаётся убранным', async () => {
    let release!: () => void
    iceGate = new Promise<void>((r) => { release = r })
    existingParticipants = [2]

    const joining = engine.joinGroupCall(PEER)
    await vi.waitFor(() => expect(store.useGroupCallStore.getState().peerId).toBe(PEER))
    engine.handleGroupCallFrame(rejected(PEER, 1))
    release()
    await joining

    expect(created).toHaveLength(0)
    expect(Object.keys(store.useGroupCallStore.getState().participants)).toHaveLength(0)
    expect(sendCallFrame.mock.calls.filter(([f]) => f.type === 'group_call_signal')).toHaveLength(0)
  })
})
