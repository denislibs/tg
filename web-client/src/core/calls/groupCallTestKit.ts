// Фейковый RTCPeerConnection для тестов группового движка (groupCallEngine). Только для *.test.ts.
// Ведёт себя как браузер по JSEP (RFC 8829) в той части, на которую опирается движок:
//  - операции идут по очереди и проверяют состояние сигналинга; на закрытом pc операция
//    отклоняется, а закрытие ПОСРЕДИ операции оставляет её промис висеть навсегда
//    (webrtc-pc «abort these steps», Chromium RTCVoidRequestPromiseImpl → Detach);
//  - setLocalDescription(offer) разрешён и в have-local-offer (повторный offer, JSEP 5.5);
//  - трансиверы и mid: addTrack заводит трансивер без mid, mid назначает применённый offer;
//    чужой offer связывает свои m-строки с трансиверами addTrack того же вида (JSEP 5.10),
//    остальные m-строки получают новые трансиверы без отправителя; answer, чьи m-строки не
//    совпадают с нашим offer, отклоняется (Chromium: «order of m-lines in answer doesn't match»);
//  - ontrack — на каждую m-строку, по которой другая сторона отправляет.
// SDP — JSON `{m: [{mid, kind, send}]}`; не-JSON (литералы старых тестов) читается как пустой.

export interface MLine { mid: string; kind: string; send: boolean }
export interface FakeTrack { kind: string; enabled?: boolean; stop?: () => void }
interface Transceiver {
  mid: string | null
  kind: string
  sender: { track: FakeTrack | null }
  receiver: { track: { kind: string } }
  /** Трансивер заведён чужим offer (откат его убирает), а не addTrack. */
  fromRemote: boolean
}

const invalidState = (why: string) => Object.assign(new Error(`InvalidStateError: ${why}`), { name: 'InvalidStateError' })
export const sdpOf = (m: MLine[]) => JSON.stringify({ m })
export function parseSdp(sdp: string | undefined): MLine[] {
  try { return (JSON.parse(sdp ?? '') as { m?: MLine[] }).m ?? [] } catch { return [] }
}

export class FakePC {
  static all: FakePC[] = []
  static configs: RTCConfiguration[] = []
  /** Вмешаться в середину операции (выход участника, уборка звонка). */
  static hooks: { createOffer?: (pc: FakePC) => void; setLocalDescription?: (pc: FakePC) => void; afterSetLocalDescription?: (pc: FakePC) => void } = {}
  static reset() { FakePC.all = []; FakePC.configs = []; FakePC.hooks = {} }

  onicecandidate: unknown = null
  ontrack: ((e: { track: { kind: string }; streams: unknown[] }) => void) | null = null
  onconnectionstatechange: unknown = null
  closed = false
  signalingState: RTCSignalingState = 'stable'
  remoteDescription: { type: string; sdp: string } | null = null
  ice: unknown[] = []
  answers = 0
  /** Каждый answer, поданный в setRemoteDescription (и отклонённый тоже). */
  remoteAnswers: string[] = []
  /** Виды дорожек, пришедших в ontrack. */
  remoteKinds: string[] = []
  transceivers: Transceiver[] = []
  private local: { type: string; sdp: string } | null = null
  private nextMid = 0
  /** Трансиверы, получившие mid от последнего применённого нашего offer (откат их снимает). */
  private offerAssigned: Transceiver[] = []
  private remoteStream = { id: `rs${FakePC.all.length}` }
  private queue: Promise<unknown> = Promise.resolve()

  constructor(public config: RTCConfiguration = {}) { FakePC.configs.push(config); FakePC.all.push(this) }
  getConfiguration() { return this.config }
  /** Как браузер: certificates, пришедшие в setConfiguration, должны совпасть с прежними (InvalidModificationError). */
  setConfiguration(config: RTCConfiguration) {
    if (config.certificates) throw new DOMException('certificates differ', 'InvalidModificationError')
    this.config = config
  }

  private run<T>(body: () => T): Promise<T> {
    if (this.closed) return Promise.reject(invalidState('closed'))
    const p = this.queue.then(async () => {
      await new Promise((r) => setTimeout(r, 0))
      if (this.closed) return new Promise<T>(() => {})
      return body()
    })
    this.queue = p.catch(() => {})
    return p
  }

  addTrack(track: FakeTrack) {
    if (this.closed) throw invalidState('closed')
    // JSEP: свободный (никогда не отправлявший) трансивер того же вида из чужого offer
    const free = this.transceivers.find((t) => t.fromRemote && t.kind === track.kind && !t.sender.track)
    if (free) { free.sender.track = track; return free.sender }
    const t: Transceiver = { mid: null, kind: track.kind, sender: { track }, receiver: { track: { kind: track.kind } }, fromRemote: false }
    this.transceivers.push(t)
    return t.sender
  }
  getSenders() { return this.transceivers.map((t) => t.sender) }
  getTransceivers() { return this.transceivers }

  private lines(): MLine[] {
    let n = this.nextMid
    return this.transceivers.map((t) => ({ mid: t.mid ?? String(n++), kind: t.kind, send: !!t.sender.track }))
  }

  createOffer() {
    FakePC.hooks.createOffer?.(this)
    return this.run(() => ({ type: 'offer' as const, sdp: sdpOf(this.lines()) }))
  }
  createAnswer() {
    return this.run(() => {
      if (this.signalingState !== 'have-remote-offer') throw invalidState('createAnswer')
      const m = parseSdp(this.remoteDescription?.sdp).map((l) => {
        const t = this.transceivers.find((x) => x.mid === l.mid)
        return { mid: l.mid, kind: l.kind, send: !!t?.sender.track }
      })
      return { type: 'answer' as const, sdp: sdpOf(m) }
    })
  }

  setLocalDescription(d?: { type: string; sdp?: string }) {
    FakePC.hooks.setLocalDescription?.(this)
    const p = this.run(() => {
      if (d?.type === 'rollback') {
        if (this.signalingState !== 'have-local-offer') throw invalidState('rollback')
        for (const t of this.offerAssigned) t.mid = null
        this.offerAssigned = []
        this.signalingState = 'stable'
        return
      }
      if (d?.type === 'answer') {
        if (this.signalingState !== 'have-remote-offer') throw invalidState('SLD(answer)')
        this.signalingState = 'stable'
        this.answers++
      } else {
        if (this.signalingState !== 'stable' && this.signalingState !== 'have-local-offer') throw invalidState('SLD(offer)')
        const m = parseSdp(d?.sdp)
        if (this.signalingState === 'stable') this.offerAssigned = [] // откат возвращает к последнему stable
        this.transceivers.forEach((t, k) => {
          if (t.mid == null && m[k]) { t.mid = m[k].mid; this.offerAssigned.push(t) }
        })
        this.nextMid = Math.max(this.nextMid, ...m.map((l) => Number(l.mid) + 1).filter(Number.isFinite))
        this.signalingState = 'have-local-offer'
      }
      this.local = { type: d?.type ?? 'offer', sdp: d?.sdp ?? '' }
    })
    // уже после завершения операции, но раньше, чем продолжение движка после await
    const after = FakePC.hooks.afterSetLocalDescription
    if (after) void p.then(() => {}).then(() => after(this))
    return p
  }

  setRemoteDescription(d: { type: string; sdp?: string }) {
    if (d.type === 'answer') this.remoteAnswers.push(d.sdp ?? '')
    return this.run(() => {
      const m = parseSdp(d.sdp)
      if (d.type === 'offer') {
        if (this.signalingState !== 'stable') throw invalidState('SRD(offer)')
        for (const l of m) {
          let t = this.transceivers.find((x) => x.mid === l.mid)
          if (!t) {
            t = this.transceivers.find((x) => x.mid == null && !x.fromRemote && x.kind === l.kind)
            if (t) t.mid = l.mid
          }
          if (!t) {
            t = { mid: l.mid, kind: l.kind, sender: { track: null }, receiver: { track: { kind: l.kind } }, fromRemote: true }
            this.transceivers.push(t)
          }
        }
        this.nextMid = Math.max(this.nextMid, ...m.map((l) => Number(l.mid) + 1).filter(Number.isFinite))
        this.signalingState = 'have-remote-offer'
      } else {
        if (this.signalingState !== 'have-local-offer') throw invalidState('SRD(answer)')
        const offered = parseSdp(this.local?.sdp).map((l) => l.mid).join(',')
        if (m.map((l) => l.mid).join(',') !== offered) throw invalidState(`answer m-lines [${m.map((l) => l.mid).join(',')}] ≠ offer [${offered}]`)
        this.offerAssigned = []
        this.signalingState = 'stable'
      }
      this.remoteDescription = { type: d.type, sdp: d.sdp ?? '' }
      for (const l of m) {
        if (!l.send) continue
        this.remoteKinds.push(l.kind)
        this.ontrack?.({ track: { kind: l.kind }, streams: [this.remoteStream] })
      }
    })
  }

  addIceCandidate(c: unknown) {
    return this.run(() => { if (!this.remoteDescription) throw invalidState('no remoteDescription'); this.ice.push(c) })
  }
  get localDescription() { return this.local }
  close() { this.closed = true; this.signalingState = 'closed' }
}
