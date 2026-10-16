// Видеочат mesh из двух настоящих движков (свой граф модулей у каждой стороны) с реле кадров,
// как у сервера (usecase/chat/groupcall.go), и фейковым RTCPeerConnection по JSEP
// (groupCallTestKit.ts): трансиверы, mid, сверка m-строк answer с offer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakePC, type FakeTrack } from './groupCallTestKit'

const PEER = -100
const TURN: RTCIceServer = { urls: ['turn:turn.test:3478?transport=udp'], username: 'u', credential: 'c' }

interface Frame { type: string; data: Record<string, unknown> }
interface Side {
  id: number
  engine: typeof import('./groupCallEngine')
  store: typeof import('../../stores/groupCallStore')
  sent: Frame[]
}

let participants: number[] = []
const sides = new Map<number, Side>()
const stopped: FakeTrack[] = []

function deliver(to: number, t: string, d: Record<string, unknown>) {
  setImmediate(() => sides.get(to)?.engine.handleGroupCallFrame({ t, d } as never))
}

// Реле как у сервера: join/leave меняют список и фанятся всем, signal — адресату с from_user_id.
function relay(from: number, f: Frame) {
  if (f.type === 'group_call_join' || f.type === 'group_call_leave') {
    participants = f.type === 'group_call_join' ? [...participants, from] : participants.filter((id) => id !== from)
    for (const id of sides.keys()) {
      deliver(id, 'group_call_update', { peer_id: PEER, user_id: from, action: f.type === 'group_call_join' ? 'joined' : 'left', participants: [...participants] })
    }
    return
  }
  if (f.type !== 'group_call_signal') return
  const { to_user_id: to, ...rest } = f.data
  deliver(to as number, 'group_call_signal', { ...rest, from_user_id: from })
}

async function side(id: number): Promise<Side> {
  vi.resetModules()
  const sent: Frame[] = []
  vi.doMock('@components/toast', () => ({ toastNew: () => {} }))
  vi.doMock('../../stores/chatsStore', () => ({ useChatsStore: { getState: () => ({ meId: id }) } }))
  vi.doMock('../../client/bootstrap', () => ({
    startClient: () => ({
      managers: {
        realtime: { sendCallFrame: (f: Frame) => { sent.push(f); relay(id, f) } },
        calls: { iceConfig: async () => ({ servers: [TURN], ttlSeconds: 3600 }) },
        messages: { groupCallParticipants: async () => [...participants] },
        appConfig: { getAppConfig: async () => ({ groupcall_video_participants_max: 5 }) },
      },
    }),
  }))
  const s: Side = { id, engine: await import('./groupCallEngine'), store: await import('../../stores/groupCallStore'), sent }
  sides.set(id, s)
  return s
}

const track = (kind: string): FakeTrack => {
  const t: FakeTrack = { kind, enabled: true, stop: () => { stopped.push(t) } }
  return t
}
function stream(tracks: FakeTrack[]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    addTrack: (t: FakeTrack) => { tracks.push(t) },
  }
}

const settled = async () => { for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 1)) }
const stable = () => FakePC.all.every((pc) => pc.closed || pc.signalingState === 'stable')

let errors: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  participants = []
  sides.clear()
  stopped.length = 0
  FakePC.reset()
  vi.stubGlobal('RTCPeerConnection', FakePC)
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async (c: { audio?: boolean; video?: boolean }) =>
        stream([...(c.audio ? [track('audio')] : []), ...(c.video ? [track('video')] : [])]),
    },
  })
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  for (const s of sides.values()) s.engine.leaveGroupCall()
  errors.mockRestore()
  vi.unstubAllGlobals()
})

// tweb callInstance.ts:1836-1842 и :1984-1991: ответившая сторона, у которой есть свои дорожки,
// после answer шлёт свой offer. По JSEP это отправитель без mid: offer новичка m-строки под
// камеру сидящего не нёс, и в answer её не добавить.
describe('mesh: повторный offer ответившей стороны (Г3)', () => {
  it('сидящий с камерой, новичок вошёл только с аудио: новичок получает камеру сидящего', async () => {
    const sitting = await side(2)
    const newcomer = await side(1)
    await sitting.engine.joinGroupCall(PEER, true)
    await settled()
    await newcomer.engine.joinGroupCall(PEER, false)
    const newcomerPc = FakePC.all[0] // pc новичка создан раньше: сидящий своего ещё не завёл
    await vi.waitFor(() => expect(newcomerPc.remoteKinds).toContain('video'), { timeout: 2000 })
    await settled()
    expect(stable()).toBe(true)
    expect(errors).not.toHaveBeenCalled()
    // сам новичок камеры не шлёт: у сидящего видео не появилось
    expect(FakePC.all[1].remoteKinds).not.toContain('video')
  })

  it('обе стороны только с аудио: повторного offer нет', async () => {
    const sitting = await side(2)
    const newcomer = await side(1)
    await sitting.engine.joinGroupCall(PEER, false)
    await settled()
    await newcomer.engine.joinGroupCall(PEER, false)
    await settled()
    expect(sitting.sent.filter((f) => (f.data.sdp as { type?: string } | undefined)?.type === 'offer')).toHaveLength(0)
    expect(stable()).toBe(true)
  })
})

// tweb callInstance.ts:1726 (answer — к нашему offer по exchangeId) и :2295-2305: answer к
// заменённому offer не применяется, встречный offer невежливая сторона ставит в очередь.
describe('mesh: answer сопоставляется со своим offer (Г2)', () => {
  it('камера включена до ответа на первый offer: answer к первому offer не ложится на второй', async () => {
    const sitting = await side(2)
    const newcomer = await side(1)
    await sitting.engine.joinGroupCall(PEER, false)
    await settled()
    await newcomer.engine.joinGroupCall(PEER, false)
    await newcomer.engine.toggleGroupCam() // answer на первый offer ещё в пути
    await settled()
    const newcomerPc = FakePC.all[0]
    expect(newcomerPc.remoteAnswers).toHaveLength(1) // только answer ко второму offer
    expect(stable()).toBe(true)
    expect(errors).not.toHaveBeenCalled()
    expect(FakePC.all[1].remoteKinds).toContain('video')
  })

  it('обе стороны включают камеру одновременно (встречные offer): обе видят камеру друг друга', async () => {
    const a = await side(1)
    const b = await side(2)
    await b.engine.joinGroupCall(PEER, false)
    await settled()
    await a.engine.joinGroupCall(PEER, false)
    await settled()
    await Promise.all([a.engine.toggleGroupCam(), b.engine.toggleGroupCam()])
    await settled()
    expect(stable()).toBe(true)
    expect(errors).not.toHaveBeenCalled()
    expect(FakePC.all[0].remoteKinds).toContain('video')
    expect(FakePC.all[1].remoteKinds).toContain('video')
  })
})
