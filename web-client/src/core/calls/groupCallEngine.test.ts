// Видеочат: сигнал принимается только от участника звонка (аудит A5-04). На
// offer постороннего движок создавал RTCPeerConnection, доливал в него свой
// микрофон и камеру и отвечал — посторонний получал медиа участника.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendCallFrame = vi.fn()
const toastNew = vi.fn()
const TURN: RTCIceServer = { urls: ['turn:turn.test:3478?transport=udp'], username: 'u', credential: 'c' }
let iceServers: RTCIceServer[] = []
let iceGate: Promise<unknown> = Promise.resolve()
let existingParticipants: number[] = []
vi.mock('@components/toast', () => ({ toastNew: (...a: unknown[]) => toastNew(...a) }))

vi.mock('../../client/bootstrap', () => ({
  startClient: () => ({
    managers: {
      realtime: { sendCallFrame: (...a: unknown[]) => sendCallFrame(...a) },
      calls: { iceConfig: async () => { await iceGate; return { servers: iceServers, ttlSeconds: 86_400 } } },
      messages: { groupCallParticipants: async () => existingParticipants },
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
  async createOffer() { return { type: 'offer', sdp: 'o' } }
  private local: { type: string; sdp: string } | null = null
  async setLocalDescription(d?: { type: string; sdp: string }) { this.local = d ?? null }
  get localDescription() { return this.local }
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
    iceServers = [TURN] // вход без TURN не начинается (М3-2)
    store.useGroupCallStore.getState().reset()
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [track()], getAudioTracks: () => [], getVideoTracks: () => [] }),
      },
    })
  })

  const rejected = (peer: number, user: number) => ({
    t: 'group_call_update', d: { peer_id: peer, user_id: user, action: 'rejected' as const, forbidden: true },
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

  it('отказ не по праву (сбой хранилища) — общий тост ошибки', async () => {
    await engine.joinGroupCall(PEER)
    engine.handleGroupCallFrame({ t: 'group_call_update', d: { peer_id: PEER, user_id: 1, action: 'rejected' } })
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'Error.AnError' })
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
})

// Поколение звонка: соединение, ждавшее ICE-конфиг (кэш пуст или протух), не кладётся
// в звонок, убранный за это время (выход или отказ входа).
describe('groupCallEngine: звонок убран, пока соединение ждёт ICE-конфиг', () => {
  it('выход во время ожидания: соединение не создаётся, ответа на offer нет', async () => {
    let release!: () => void
    iceGate = new Promise<void>((r) => { release = r })

    engine.handleGroupCallFrame(offer(2))
    await new Promise((r) => setTimeout(r, 0))
    engine.leaveGroupCall()
    release()
    await new Promise((r) => setTimeout(r, 0))

    expect(created).toHaveLength(0)
    expect(Object.keys(store.useGroupCallStore.getState().participants)).toHaveLength(0)
    expect(sendCallFrame.mock.calls.filter(([f]) => f.type === 'group_call_signal')).toHaveLength(0)
  })

  it('отказ входа во время ожидания: соединение не создаётся, ответа на offer нет', async () => {
    let release!: () => void
    iceGate = new Promise<void>((r) => { release = r })

    engine.handleGroupCallFrame(offer(2))
    await new Promise((r) => setTimeout(r, 0))
    engine.handleGroupCallFrame({ t: 'group_call_update', d: { peer_id: PEER, user_id: 1, action: 'rejected', forbidden: true } })
    release()
    await new Promise((r) => setTimeout(r, 0))

    expect(store.useGroupCallStore.getState().peerId).toBeNull()
    expect(created).toHaveLength(0)
    expect(Object.keys(store.useGroupCallStore.getState().participants)).toHaveLength(0)
    expect(sendCallFrame.mock.calls.filter(([f]) => f.type === 'group_call_signal')).toHaveLength(0)
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

  it('новичок шлёт offer каждому сидящему, соединение через relay', async () => {
    iceServers = [TURN]
    existingParticipants = [1, 2]
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] }) } })
    store.useGroupCallStore.getState().reset()

    await engine.joinGroupCall(PEER)

    expect(created).toHaveLength(1)
    expect(created[0].iceTransportPolicy).toBe('relay')
    const signals = sendCallFrame.mock.calls.map(([f]) => f).filter((f) => f.type === 'group_call_signal')
    expect(signals.find((f) => f.data.sdp)?.data).toMatchObject({ peer_id: PEER, to_user_id: 2, sdp: { type: 'offer' } })
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
