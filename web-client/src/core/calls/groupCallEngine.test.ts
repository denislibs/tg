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
const invalidState = () => Object.assign(new Error('InvalidStateError'), { name: 'InvalidStateError' })
// Как в браузере: операции закрытого pc отклоняются, кандидат до remoteDescription — тоже,
// а remoteDescription встаёт не синхронно с вызовом.
class FakePC {
  static all: FakePC[] = []
  /** Вмешаться в середину операции (выход участника, уборка звонка). */
  static hooks: { createOffer?: (pc: FakePC) => void; setLocalDescription?: (pc: FakePC) => void } = {}
  onicecandidate: unknown = null
  ontrack: unknown = null
  onconnectionstatechange: unknown = null
  closed = false
  remoteDescription: unknown = null
  ice: unknown[] = []
  constructor(config: RTCConfiguration = {}) { created.push(config); FakePC.all.push(this) }
  addTrack() {}
  async setRemoteDescription(d: unknown) {
    if (this.closed) throw invalidState()
    await new Promise((r) => setTimeout(r, 0))
    this.remoteDescription = d
  }
  async addIceCandidate(c: unknown) {
    if (this.closed || !this.remoteDescription) throw invalidState()
    this.ice.push(c)
  }
  async createAnswer() { if (this.closed) throw invalidState(); return { type: 'answer', sdp: 'a' } }
  async createOffer() {
    FakePC.hooks.createOffer?.(this)
    if (this.closed) throw invalidState()
    return { type: 'offer', sdp: 'o' }
  }
  private local: { type: string; sdp: string } | null = null
  async setLocalDescription(d?: { type: string; sdp: string }) {
    if (this.closed) throw invalidState()
    FakePC.hooks.setLocalDescription?.(this) // вызов уже принят: закрытие в середине его не отклоняет
    this.local = d ?? null
  }
  get localDescription() { return this.local }
  close() { this.closed = true }
}

type Engine = typeof import('./groupCallEngine')
type Store = typeof import('../../stores/groupCallStore')
let engine: Engine
let store: Store

const PEER = -100

beforeEach(async () => {
  vi.resetModules()
  created.length = 0
  FakePC.all = []
  FakePC.hooks = {}
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

const candidate = (from: number, n: number) => ({
  t: 'group_call_signal', d: { peer_id: PEER, from_user_id: from, candidate: { candidate: `c${n}`, sdpMid: '0' } },
})
const tick = () => new Promise((r) => setTimeout(r, 0))
const gate = () => {
  let release!: () => void
  iceGate = new Promise<void>((r) => { release = r })
  return () => release()
}

// tweb буферизует кандидаты до remoteDescription (callInstance.ts:2240-2255, :2315-2352,
// P2P_MAX_PENDING_CANDIDATES constants.ts:48): кандидат, пришедший раньше pc или раньше
// применённого offer/answer, не теряется.
describe('groupCallEngine: кандидаты до готовности соединения', () => {
  beforeEach(() => { iceServers = [TURN] })

  it('кандидаты, пришедшие пока сидящий берёт ICE-конфиг, добавляются после offer', async () => {
    const release = gate()
    engine.handleGroupCallFrame(offer(2))
    engine.handleGroupCallFrame(candidate(2, 1))
    engine.handleGroupCallFrame(candidate(2, 2))
    await tick()
    release()
    await vi.waitFor(() => expect(FakePC.all[0]?.ice).toHaveLength(2))
    expect(FakePC.all).toHaveLength(1)
  })

  it('кандидаты сразу за answer (remoteDescription ещё не встал) не теряются', async () => {
    existingParticipants = [2]
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] }) } })
    store.useGroupCallStore.getState().reset()
    await engine.joinGroupCall(PEER)
    engine.handleGroupCallFrame({ t: 'group_call_signal', d: { peer_id: PEER, from_user_id: 2, sdp: { type: 'answer' as const, sdp: 'a' } } })
    engine.handleGroupCallFrame(candidate(2, 1))
    await vi.waitFor(() => expect(FakePC.all[0].ice).toHaveLength(1))
  })

  it('второй offer того же участника, пока ждём /calls/ice, не создаёт второго соединения', async () => {
    const release = gate()
    engine.handleGroupCallFrame(offer(2))
    engine.handleGroupCallFrame(offer(2))
    await tick()
    release()
    await tick(); await tick(); await tick()
    expect(created).toHaveLength(1)
  })

  it('участник ушёл, пока его соединение ждало ICE-конфиг: соединения нет, ответа нет, буфер снят', async () => {
    const release = gate()
    engine.handleGroupCallFrame(offer(2))
    engine.handleGroupCallFrame(candidate(2, 1))
    engine.handleGroupCallFrame({ t: 'group_call_update', d: { peer_id: PEER, user_id: 2, action: 'left' as const, participants: [1, 2] } })
    release()
    await tick(); await tick(); await tick()
    expect(created).toHaveLength(0)
    expect(sendCallFrame.mock.calls.filter(([f]) => f.type === 'group_call_signal')).toHaveLength(0)
    // новый offer того же участника после ухода — новое соединение без старых кандидатов
    engine.handleGroupCallFrame(offer(2))
    await vi.waitFor(() => expect(created).toHaveLength(1))
    await tick(); await tick()
    expect(FakePC.all[0].ice).toHaveLength(0)
  })
})

describe('groupCallEngine: цикл офферов новичка и закрытое соединение', () => {
  beforeEach(() => {
    iceServers = [TURN]
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] }) } })
    store.useGroupCallStore.getState().reset()
  })
  const sdpTo = () => sendCallFrame.mock.calls.map(([f]) => f).filter((f) => f.type === 'group_call_signal' && f.data.sdp)

  it('участник ушёл, пока ему готовили offer: вход не падает, offer уходит следующему', async () => {
    existingParticipants = [2, 3]
    FakePC.hooks.createOffer = (pc) => {
      if (pc === FakePC.all[0]) engine.handleGroupCallFrame({ t: 'group_call_update', d: { peer_id: PEER, user_id: 2, action: 'left' as const, participants: [1, 3] } })
    }
    await expect(engine.joinGroupCall(PEER)).resolves.toBeUndefined()
    expect(sdpTo().map((f) => f.data.to_user_id)).toEqual([3])
  })

  it('выход из звонка, пока готовится offer: вход не падает, offer не уходит', async () => {
    existingParticipants = [2]
    FakePC.hooks.createOffer = () => engine.leaveGroupCall()
    await expect(engine.joinGroupCall(PEER)).resolves.toBeUndefined()
    expect(sdpTo()).toHaveLength(0)
  })

  it('выход и вход в другой звонок во время setLocalDescription: старый offer в новый звонок не уходит', async () => {
    existingParticipants = [2]
    FakePC.hooks.setLocalDescription = () => {
      engine.leaveGroupCall()
      store.useGroupCallStore.getState().setJoined(-200)
    }
    await engine.joinGroupCall(PEER)
    expect(sdpTo()).toHaveLength(0)
  })
})
