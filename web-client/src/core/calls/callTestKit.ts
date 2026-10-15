// Тестовый стенд двух движков звонка (callEngine) с общим реле кадров и фейковым
// RTCPeerConnection. Только для *.test.ts: поднимает по свежему графу модулей на каждую сторону
// (vi.resetModules), поэтому у «Алисы» и «Боба» свои callStore и состояние движка.
import { vi } from 'vitest'

export interface Frame { type: string; data: Record<string, unknown> }

const realTimeout = globalThis.setTimeout
export const sleep = (ms: number) => new Promise<void>((r) => realTimeout(r, ms))

/** Ждёт условие реальными короткими паузами (таймеры теста могут быть фейковыми). */
export async function until(cond: () => boolean, what: string, steps = 1500) {
  for (let i = 0; i < steps; i++) {
    if (cond()) return
    await sleep(2)
  }
  throw new Error(`timeout: ${what}`)
}

/** Даёт отработать всем уже запущенным цепочкам (реле, криптография). */
export async function settle() {
  for (let i = 0; i < 25; i++) await sleep(2)
}

export const fpOfTag = (tag: string) =>
  `sha-256 ${Array.from(tag, (c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join(':')}`

export const sdpWithFp = (fp: string) =>
  `v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fingerprint:${fp}\r\n`

type Desc = { type: RTCSdpType; sdp: string; toJSON(): { type: RTCSdpType; sdp: string } }

export class FakePC {
  static all: FakePC[] = []
  static seq = 0
  /** Номер (с 1) боевого pc, конструктор которого бросает; 0 — не бросать. */
  static throwOnMain = 0
  static mainsCreated = 0
  static generateCertificate: () => Promise<{ tag: string }> = async () => ({ tag: `c${++FakePC.seq}` })
  static reset() {
    FakePC.all = []
    FakePC.throwOnMain = 0
    FakePC.mainsCreated = 0
    FakePC.generateCertificate = async () => ({ tag: `c${++FakePC.seq}` })
  }
  /** Боевые pc движка (временные pc из createDtlsIdentity без bundlePolicy). */
  static mains() { return FakePC.all.filter((p) => p.config.bundlePolicy === 'max-bundle') }

  config: RTCConfiguration
  connectionState: RTCPeerConnectionState = 'new'
  signalingState: RTCSignalingState = 'stable'
  localDescription: Desc | null = null
  remoteDescription: Desc | null = null
  onicecandidate: unknown = null
  ontrack: unknown = null
  onnegotiationneeded: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  transceivers: Array<{ receiver: { track: { kind: string } } }> = []
  closed = false
  tracks: unknown[] = []
  ice: unknown[] = []
  constructor(config: RTCConfiguration = {}) {
    this.config = config
    if (config.bundlePolicy === 'max-bundle' && ++FakePC.mainsCreated === FakePC.throwOnMain) throw new Error('pc ctor failed')
    FakePC.all.push(this)
  }
  get cert() { return (this.config.certificates?.[0] as unknown as { tag: string } | undefined)?.tag ?? '' }
  private negotiate() { queueMicrotask(() => { if (!this.closed && this.signalingState === 'stable') this.onnegotiationneeded?.() }) }
  addTransceiver(kind: string) { this.transceivers.push({ receiver: { track: { kind } } }); this.negotiate() }
  addTrack(track: { kind: string }) { this.tracks.push(track); this.transceivers.push({ receiver: { track: { kind: track.kind } } }); this.negotiate(); return {} }
  getTransceivers() { return this.transceivers }
  getSenders() { return [] }
  createDataChannel() { return {} }
  async createOffer() { return { type: 'offer' as const, sdp: sdpWithFp(fpOfTag(this.cert)) } }
  private desc(type: RTCSdpType): Desc {
    const sdp = sdpWithFp(fpOfTag(this.cert))
    return { type, sdp, toJSON: () => ({ type, sdp }) }
  }
  async setLocalDescription() {
    if (this.signalingState === 'have-remote-offer') { this.localDescription = this.desc('answer'); this.signalingState = 'stable' }
    else { this.localDescription = this.desc('offer'); this.signalingState = 'have-local-offer' }
  }
  async setRemoteDescription(d: { type: RTCSdpType; sdp?: string }) {
    this.remoteDescription = { type: d.type, sdp: d.sdp ?? '', toJSON: () => ({ type: d.type, sdp: d.sdp ?? '' }) }
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable'
  }
  async addIceCandidate(c: unknown) { this.ice.push(c) }
  close() { this.closed = true }
  setState(st: RTCPeerConnectionState) { this.connectionState = st; this.onconnectionstatechange?.() }
}

/**
 * Боевой pc стороны — тот, что создан с обещанным ею сертификатом: порядок создания pc двух
 * сторон зависит от гонки. Обещанное берётся из её call_accept (отвечающий) или dh_reveal (звонящий).
 */
export function pcOf(side: { frames(type: string): Frame[] }): FakePC | undefined {
  const f = side.frames('call_accept')[0] ?? side.frames('call_signal').find((x) => x.data.dh_reveal)
  const fps = f?.data.dtls as string[] | undefined
  return FakePC.mains().find((p) => fpOfTag(p.cert) === fps?.[0])
}

export type Engine = typeof import('./callEngine')
export type StoreMod = typeof import('../../stores/callStore')

export interface Side {
  id: number
  engine: Engine
  store: StoreMod
  sent: Frame[]
  /** managers.messages.sendText: движок обязан его не звать (лог звонка — забота сервера) */
  sendText: ReturnType<typeof vi.fn>
  frames(type: string): Frame[]
  call(): ReturnType<StoreMod['useCallStore']['getState']>['call']
}

/** Реле: как сервер, ставит from_user_id и отдаёт кадр адресату. `tamper` подменяет/задерживает. */
export interface Net {
  sides: Map<number, Side>
  /**
   * Что реле-сервер ставит в `p2p_allowed` кадров call_request/call_accept (затирая присланное,
   * как backend usecase/chat/phonecall.go): true/false; undefined — поле не ставится вовсе.
   */
  p2pAllowed: boolean | undefined
  /** Ответ GET /calls/ice: по умолчанию STUN + TURN, как на стенде. */
  iceServers: RTCIceServer[]
  /** Вернуть кадры, которые надо доставить в одном тике (пусто — кадр проглочен). */
  tamper?: (from: number, to: number, f: Frame) => Frame[]
  side(id: number): Promise<Side>
}

export function createNet(): Net {
  // Как сервер: p2p_allowed ставится только в call_request и call_accept, присланное затирается.
  const serverStamp = (data: Record<string, unknown>, type: string) => {
    const out = { ...data }
    delete out.p2p_allowed
    if ((type === 'call_request' || type === 'call_accept') && net.p2pAllowed !== undefined) out.p2p_allowed = net.p2pAllowed
    return out
  }
  const net: Net = {
    sides: new Map(),
    p2pAllowed: true,
    iceServers: [{ urls: ['stun:stun.test:3478'] }, { urls: ['turn:turn.test:3478?transport=udp'], username: 'u', credential: 'c' }],
    async side(id) {
      vi.resetModules()
      const sent: Frame[] = []
      const sendText = vi.fn()
      vi.doMock('../../client/bootstrap', () => ({
        startClient: () => ({
          managers: {
            realtime: {
              sendCallFrame: (f: Frame) => {
                sent.push(f)
                const to = f.data.to_user_id as number
                const out = net.tamper ? net.tamper(id, to, f) : [f]
                if (out.length === 0) return
                setImmediate(() => {
                  const peer = net.sides.get(to)
                  if (!peer) return
                  for (const o of out) peer.engine.handleFrame({ t: o.type, d: serverStamp({ ...o.data, from_user_id: id }, o.type) } as never)
                })
              },
            },
            messages: { sendText: (...a: unknown[]) => sendText(...a) },
            calls: { iceConfig: async () => ({ servers: net.iceServers, ttlSeconds: 3600 }) },
            peers: { getUsers: async () => [] },
          },
        }),
      }))
      vi.doMock('../audio/sounds', () => ({ playSound: () => {}, stopSound: () => {} }))
      const engine = await import('./callEngine')
      const store = await import('../../stores/callStore')
      const side: Side = {
        id, engine, store, sent, sendText,
        frames: (type) => sent.filter((f) => f.type === type),
        call: () => store.useCallStore.getState().call,
      }
      net.sides.set(id, side)
      return side
    },
  }
  return net
}

export const PEER_OF = (id: number) => ({ id, name: `u${id}`, avatar: '#000' })

/** Звонок Алисы Бобу до ответа Боба включительно (accept() вызван). */
export async function startPair(net: Net, video = false) {
  const A = await net.side(1)
  const B = await net.side(2)
  A.engine.startOutgoing(PEER_OF(2), video)
  await until(() => B.call()?.phase === 'incoming', 'incoming at B')
  B.engine.accept()
  return { A, B }
}

/** Честный звонок до момента, когда у обеих сторон есть SAS. */
export async function connectPair(net: Net, video = false) {
  const { A, B } = await startPair(net, video)
  await until(() => !!A.call()?.e2eFingerprint && !!B.call()?.e2eFingerprint, 'SAS on both sides')
  await until(() => FakePC.mains().length >= 2, 'both peer connections')
  return { A, B }
}
