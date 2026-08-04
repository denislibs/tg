import type { Transport } from '../transport'
import { NKInitiator } from './noise/handshakeState'
import type { KeyPair } from './noise/primitives'
import type { CipherState } from './noise/symmetricState'
import { frameLen, unframeLen, sealFrame, openFrame } from './codec'
import { encodeFrame, decodeFrame, type Frame } from '../../../protocol/frames'

const PROLOGUE = new TextEncoder().encode('dnp/2')
const KIND_JSON = 0x00

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim()
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16)
  return out
}

// withKind: префикс байта-типа перед сериализованным JSON-кадром. 0x00=JSON (этот PR),
// 0x01 зарезервирован под file-кадры (PR-1b). Транспортный слой — codec.ts байто-агностичен.
function withKind(kind: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + payload.length)
  out[0] = kind; out.set(payload, 1)
  return out
}

type State = 'idle' | 'handshaking' | 'ready' | 'closed'

// DnpTransport — Noise-канал (Noise_NK initiator) поверх сырого WebSocket, реализует
// тот же контракт Transport, что и WsClient. onOpen фаерит только когда канал готов.
export class DnpTransport implements Transport {
  private ws: WebSocket | null = null
  private state: State = 'idle'
  private hs: NKInitiator | null = null
  private cipherSend: CipherState | null = null
  private cipherRecv: CipherState | null = null
  private token = ''
  private listeners = new Map<string, Array<(d: unknown) => void>>()
  private openCbs: Array<() => void> = []
  private closeCbs: Array<() => void> = []
  private errorCbs: Array<() => void> = []

  constructor(
    private url: string,
    private serverStaticPublicKeys: string[],
    private testEphemeral?: KeyPair,
  ) {}

  connect(token: string): void {
    this.token = token
    this.state = 'handshaking'
    const ws = new WebSocket(this.url, ['dnp/2'])
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => this.startHandshake()
    ws.onclose = () => { this.state = 'closed'; for (const cb of this.closeCbs) cb() }
    ws.onerror = () => { for (const cb of this.errorCbs) cb() }
    ws.onmessage = (ev) => this.onMessage(ev)
  }

  private startHandshake(): void {
    // Пиннинг: берём первый ключ (ротация-ретрай по списку — отложено). Нет ключа → закрываем.
    const hex = this.serverStaticPublicKeys[0]
    if (!hex) { this.fail(); return }
    this.hs = new NKInitiator({ prologue: PROLOGUE, remoteStatic: hexToBytes(hex), ephemeral: this.testEphemeral })
    this.ws!.send(frameLen(this.hs.writeMessage1()) as BufferSource)
  }

  private onMessage(ev: MessageEvent): void {
    if (!(ev.data instanceof ArrayBuffer)) return
    const raw = new Uint8Array(ev.data)
    if (this.state === 'handshaking') {
      try {
        this.hs!.readMessage2(unframeLen(raw))
        const { send, recv } = this.hs!.split()
        this.cipherSend = send; this.cipherRecv = recv
        const authJson = encodeFrame('auth', { token: this.token })
        this.ws!.send(sealFrame(this.cipherSend, withKind(KIND_JSON, new TextEncoder().encode(authJson))) as BufferSource)
        this.state = 'ready'
        for (const cb of this.openCbs) cb()
      } catch {
        this.fail() // хендшейк не сошёлся → close → reconnect (новый хендшейк)
      }
      return
    }
    if (this.state === 'ready') {
      try {
        const plain = openFrame(this.cipherRecv!, raw)
        if (plain.length < 1 || plain[0] !== KIND_JSON) { this.fail(); return } // PR-1b: 0x01 file
        const f: Frame = decodeFrame(new TextDecoder().decode(plain.subarray(1)))
        for (const cb of this.listeners.get(f.t) ?? []) cb(f.d)
      } catch {
        this.fail() // сбой decrypt = необратимый рассинхрон nonce → close → rehandshake
      }
    }
  }

  // fail: закрыть WS, НЕ глуша onclose — сработает onClose → connectionManager решедулит reconnect.
  private fail(): void { this.ws?.close() }

  on(type: string, cb: (d: unknown) => void): void {
    const arr = this.listeners.get(type) ?? []
    arr.push(cb); this.listeners.set(type, arr)
  }
  onOpen(cb: () => void): void { this.openCbs.push(cb) }
  onClose(cb: () => void): void { this.closeCbs.push(cb) }
  onError(cb: () => void): void { this.errorCbs.push(cb) }

  isOpen(): boolean { return this.state === 'ready' }

  send(t: string, d?: unknown): void {
    if (this.state !== 'ready' || !this.cipherSend) return
    this.ws!.send(sealFrame(this.cipherSend, withKind(KIND_JSON, new TextEncoder().encode(encodeFrame(t, d)))) as BufferSource)
  }

  // Умышленное закрытие (connectionManager.stop): глушим onclose, чтобы НЕ переподключаться.
  close(): void {
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null }
    this.state = 'closed'
  }
}
