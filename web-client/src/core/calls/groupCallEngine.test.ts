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
// Как в браузере: операции идут по очереди и проверяют состояние сигналинга; на закрытом pc
// операция отклоняется, а закрытие ПОСРЕДИ операции оставляет её промис висеть навсегда
// (webrtc-pc «abort these steps», Chromium RTCVoidRequestPromiseImpl → Detach).
class FakePC {
  static all: FakePC[] = []
  /** Вмешаться в середину операции (выход участника, уборка звонка). */
  static hooks: { createOffer?: (pc: FakePC) => void; setLocalDescription?: (pc: FakePC) => void; afterSetLocalDescription?: (pc: FakePC) => void } = {}
  onicecandidate: unknown = null
  ontrack: unknown = null
  onconnectionstatechange: unknown = null
  closed = false
  signalingState: RTCSignalingState = 'stable'
  remoteDescription: unknown = null
  ice: unknown[] = []
  answers = 0
  private queue: Promise<unknown> = Promise.resolve()
  constructor(config: RTCConfiguration = {}) { created.push(config); FakePC.all.push(this) }
  addTrack() {}
  private run<T>(body: () => T): Promise<T> {
    if (this.closed) return Promise.reject(invalidState())
    const p = this.queue.then(async () => {
      await new Promise((r) => setTimeout(r, 0))
      if (this.closed) return new Promise<T>(() => {})
      return body()
    })
    this.queue = p.catch(() => {})
    return p
  }
  setRemoteDescription(d: { type: string }) {
    return this.run(() => {
      if (d.type === 'offer' ? this.signalingState !== 'stable' : this.signalingState !== 'have-local-offer') throw invalidState()
      this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable'
      this.remoteDescription = d
    })
  }
  addIceCandidate(c: unknown) {
    return this.run(() => { if (!this.remoteDescription) throw invalidState(); this.ice.push(c) })
  }
  createAnswer() {
    return this.run(() => { if (this.signalingState !== 'have-remote-offer') throw invalidState(); return { type: 'answer', sdp: 'a' } })
  }
  createOffer() {
    FakePC.hooks.createOffer?.(this)
    return this.run(() => ({ type: 'offer', sdp: 'o' }))
  }
  private local: { type: string; sdp: string } | null = null
  getSenders() { return [] }
  setLocalDescription(d?: { type: string; sdp?: string }) {
    FakePC.hooks.setLocalDescription?.(this)
    const p = this.run(() => {
      if (d?.type === 'rollback') {
        if (this.signalingState !== 'have-local-offer') throw invalidState()
        this.signalingState = 'stable'
        return
      }
      if (d?.type === 'answer') {
        if (this.signalingState !== 'have-remote-offer') throw invalidState()
        this.signalingState = 'stable'
        this.answers++
      } else {
        if (this.signalingState !== 'stable') throw invalidState()
        this.signalingState = 'have-local-offer'
      }
      this.local = (d ?? null) as { type: string; sdp: string } | null
    })
    // уже после завершения операции, но раньше, чем продолжение движка после await
    const after = FakePC.hooks.afterSetLocalDescription
    if (after) void p.then(() => {}).then(() => after(this))
    return p
  }
  get localDescription() { return this.local }
  close() { this.closed = true; this.signalingState = 'closed' }
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
    iceServers = [TURN]
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

  it('конфиг без TURN (сбой /calls/ice без живого кэша): сидящий не заводит мёртвый relay-pc и не отвечает', async () => {
    iceServers = [{ urls: ['stun:stun.test:3478'] }]
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    engine.handleGroupCallFrame(offer(2))
    await tick(); await tick(); await tick()
    expect(created).toHaveLength(0)
    expect(sendCallFrame).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('второй offer того же участника, пока ждём /calls/ice, не создаёт второго соединения', async () => {
    const release = gate()
    engine.handleGroupCallFrame(offer(2))
    engine.handleGroupCallFrame(offer(2))
    await tick()
    release()
    await vi.waitFor(() => expect(FakePC.all[0]?.answers).toBe(2)) // по очереди: offer → answer, offer → answer
    expect(created).toHaveLength(1)
    expect(sendCallFrame.mock.calls.filter(([f]) => f.data.sdp?.type === 'answer')).toHaveLength(2)
  })

  it('offer и сразу уход участника (кадр ещё ждал очереди): соединения нет', async () => {
    engine.handleGroupCallFrame(offer(2))
    engine.handleGroupCallFrame({ t: 'group_call_update', d: { peer_id: PEER, user_id: 2, action: 'left' as const, participants: [1] } })
    await tick(); await tick(); await tick()
    expect(created).toHaveLength(0)
  })

  it('media_state за offer, пока pc ждёт ICE-конфиг, не затирается созданием pc', async () => {
    const release = gate()
    engine.handleGroupCallFrame(offer(2))
    engine.handleGroupCallFrame({ t: 'group_call_signal', d: { peer_id: PEER, from_user_id: 2, media_state: { muted: true, video: true } } })
    await tick()
    release()
    await vi.waitFor(() => expect(FakePC.all[0]?.answers).toBe(1))
    await tick()
    expect(store.useGroupCallStore.getState().participants[2]).toMatchObject({ muted: true, videoOn: true })
  })

  it('выход и повторный вход в тот же чат, пока старый /calls/ice в полёте: на новый offer отвечаем', async () => {
    const release = gate()
    engine.handleGroupCallFrame(offer(2))
    await tick() // offer ждёт ICE-конфиг в ensurePc
    engine.leaveGroupCall()
    store.useGroupCallStore.getState().setJoined(PEER)
    store.useGroupCallStore.getState().setActive(PEER, [1, 2])
    engine.handleGroupCallFrame(offer(2))
    await tick()
    release()
    await vi.waitFor(() => expect(sendCallFrame.mock.calls.filter(([f]) => f.data.sdp?.type === 'answer')).toHaveLength(1))
    expect(created).toHaveLength(1)
  })

  it('кадр прошлого звонка, ждавший в очереди, не применяется к соединению нового', async () => {
    existingParticipants = [2]
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] }) } })
    store.useGroupCallStore.getState().reset()
    await engine.joinGroupCall(PEER) // старый звонок: pc с участником 2 ждёт answer
    const old = FakePC.all[0]
    engine.handleGroupCallFrame({ t: 'group_call_signal', d: { peer_id: PEER, from_user_id: 2, sdp: { type: 'answer' as const, sdp: 'a' } } })
    engine.handleGroupCallFrame(candidate(2, 9)) // встал в очередь за answer старого звонка
    engine.leaveGroupCall()
    await engine.joinGroupCall(PEER) // новый звонок в том же чате, новый pc с участником 2
    await vi.waitFor(() => expect(FakePC.all).toHaveLength(2))
    engine.handleGroupCallFrame({ t: 'group_call_signal', d: { peer_id: PEER, from_user_id: 2, sdp: { type: 'answer' as const, sdp: 'a' } } })
    engine.handleGroupCallFrame(candidate(2, 1))
    await vi.waitFor(() => expect(FakePC.all[1].ice).toHaveLength(1))
    await tick(); await tick()
    expect(old.ice).toHaveLength(0)
    expect(FakePC.all[1].ice).toEqual([{ candidate: 'c1', sdpMid: '0' }]) // старого c9 нет
  })

  it('встречный offer, мы невежливая сторона (меньший id): свой offer держим, встречный игнорируем', async () => {
    existingParticipants = [2]
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] }) } })
    store.useGroupCallStore.getState().reset()
    await engine.joinGroupCall(PEER) // наш offer участнику 2 ждёт answer
    engine.handleGroupCallFrame(offer(2))
    await tick(); await tick(); await tick()
    expect(FakePC.all[0].signalingState).toBe('have-local-offer')
    expect(sendCallFrame.mock.calls.filter(([f]) => f.data.sdp?.type === 'answer')).toHaveLength(0)
  })

  it('встречный offer, мы вежливая сторона (больший id): откат своего, answer, затем свой offer заново', async () => {
    existingParticipants = [0]
    store.useGroupCallStore.getState().reset()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] }) } })
    await engine.joinGroupCall(PEER)
    store.useGroupCallStore.getState().setActive(PEER, [0, 1])
    sendCallFrame.mockClear()
    engine.handleGroupCallFrame(offer(0))
    await vi.waitFor(() => expect(sendCallFrame.mock.calls.map(([f]) => f.data.sdp?.type).filter(Boolean)).toEqual(['answer', 'offer']))
  })

  it('запоздалый answer (соединение уже stable) не роняет обработку: следующий кандидат применяется', async () => {
    existingParticipants = [2]
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] }) } })
    store.useGroupCallStore.getState().reset()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    error.mockClear()
    await engine.joinGroupCall(PEER)
    const answer = { t: 'group_call_signal', d: { peer_id: PEER, from_user_id: 2, sdp: { type: 'answer' as const, sdp: 'a' } } }
    engine.handleGroupCallFrame(answer)
    engine.handleGroupCallFrame(answer)
    engine.handleGroupCallFrame(candidate(2, 1))
    await vi.waitFor(() => expect(FakePC.all[0].ice).toHaveLength(1))
    expect(error).not.toHaveBeenCalled() // tweb :1763-1767: answer не в том состоянии — молча мимо
    error.mockRestore()
  })

  it('участник ушёл, пока его соединение ждало ICE-конфиг: соединения нет, ответа нет, буфер снят', async () => {
    const release = gate()
    engine.handleGroupCallFrame(offer(2))
    engine.handleGroupCallFrame(candidate(2, 1))
    await tick() // offer дошёл до ensurePc и ждёт ICE-конфиг
    engine.handleGroupCallFrame({ t: 'group_call_update', d: { peer_id: PEER, user_id: 2, action: 'left' as const, participants: [1] } })
    release()
    await tick(); await tick(); await tick()
    expect(created).toHaveLength(0)
    expect(sendCallFrame.mock.calls.filter(([f]) => f.type === 'group_call_signal')).toHaveLength(0)
    // вернулся: новый offer — новое соединение без старых кандидатов
    store.useGroupCallStore.getState().setActive(PEER, [1, 2])
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

  it('участник ушёл посреди createOffer (промис операции повис): вход завершается, offer уходит другому', async () => {
    existingParticipants = [2, 3]
    FakePC.hooks.createOffer = (pc) => {
      if (pc === FakePC.all[0]) queueMicrotask(() => engine.handleGroupCallFrame({ t: 'group_call_update', d: { peer_id: PEER, user_id: 2, action: 'left' as const, participants: [1, 3] } }))
    }
    await engine.joinGroupCall(PEER)
    expect(sdpTo().map((f) => f.data.to_user_id)).toEqual([3])
    expect(sendCallFrame.mock.calls.some(([f]) => f.data.media_state)).toBe(true)
  })

  it('участник ушёл, пока его pc ждал ICE-конфиг (кэш истёк за время выбора микрофона): offer уходит остальным', async () => {
    existingParticipants = [2, 3]
    const now = Date.now()
    let release!: () => void
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => {
      vi.spyOn(Date, 'now').mockReturnValue(now + 61_000) // кэш конфига протух
      iceGate = new Promise<void>((r) => { release = r })
      return { getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] }
    } } })
    const join = engine.joinGroupCall(PEER)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await tick()
    engine.handleGroupCallFrame({ t: 'group_call_update', d: { peer_id: PEER, user_id: 2, action: 'left' as const, participants: [1, 3] } })
    release()
    await join
    expect(sdpTo().map((f) => f.data.to_user_id)).toEqual([3])
    vi.restoreAllMocks()
  })

  it('выход из звонка, пока готовится offer: вход не падает, offer не уходит', async () => {
    existingParticipants = [2]
    FakePC.hooks.createOffer = () => engine.leaveGroupCall()
    await expect(engine.joinGroupCall(PEER)).resolves.toBeUndefined()
    expect(sdpTo()).toHaveLength(0)
  })

  it('выход и вход в другой звонок во время setLocalDescription: старый offer в новый звонок не уходит', async () => {
    existingParticipants = [2]
    // setLocalDescription уже завершилась (pc не закрыт посреди неё), а продолжение цикла
    // выполняется после выхода и входа в другой звонок — держит только проверка поколения
    FakePC.hooks.afterSetLocalDescription = () => {
      engine.leaveGroupCall()
      store.useGroupCallStore.getState().setJoined(-200)
    }
    await engine.joinGroupCall(PEER)
    expect(sdpTo()).toHaveLength(0)
  })
})

describe('groupCallEngine: включение камеры (renegotiation)', () => {
  it('участник ушёл посреди offer с камерой: включение завершается, offer уходит другому', async () => {
    iceServers = [TURN]
    existingParticipants = [2, 3]
    const tracks: { kind: string; enabled: boolean; stop: () => void }[] = []
    const stream = { getTracks: () => tracks, getAudioTracks: () => [], getVideoTracks: () => tracks.filter((t) => t.kind === 'video'), addTrack: (t: never) => tracks.push(t) }
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async (c: { video?: boolean; audio?: boolean }) => c.audio ? stream : { getVideoTracks: () => [{ kind: 'video', enabled: true, stop: () => {} }] } } })
    store.useGroupCallStore.getState().reset()
    await engine.joinGroupCall(PEER)
    for (const pc of FakePC.all) pc.signalingState = 'stable' // answer'ы получены
    sendCallFrame.mockClear()
    FakePC.hooks.createOffer = (pc) => {
      if (pc === FakePC.all[0]) queueMicrotask(() => engine.handleGroupCallFrame({ t: 'group_call_update', d: { peer_id: PEER, user_id: 2, action: 'left' as const, participants: [1, 3] } }))
    }
    await engine.toggleGroupCam()
    expect(store.useGroupCallStore.getState().camOn).toBe(true)
    expect(sendCallFrame.mock.calls.map(([f]) => f).filter((f) => f.data.sdp).map((f) => f.data.to_user_id)).toEqual([3])
  })
})
