import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DnpTransport } from './dnpTransport'
import { CipherState } from './noise/symmetricState'
import { frameLen, sealFrame, openFrame } from './codec'
import fixture from './noise/fixtures/nk-vector.json'

const fromHex = (s: string) => new Uint8Array(s.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))
function withKind(kind: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + payload.length)
  out[0] = kind; out.set(payload, 1)
  return out
}

class FakeWS {
  static instances: FakeWS[] = []
  binaryType = 'blob'
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null
  sent: Uint8Array[] = []
  readyState = 0
  constructor(public url: string, public protocols?: string | string[]) { FakeWS.instances.push(this) }
  send(d: ArrayBufferView | ArrayBuffer) { this.sent.push(d instanceof Uint8Array ? d : new Uint8Array(d as ArrayBuffer)) }
  close() { this.readyState = 3; this.onclose?.() }
  open() { this.readyState = 1; this.onopen?.() }
  message(bytes: Uint8Array) { this.onmessage?.({ data: bytes.slice().buffer }) }
}

beforeEach(() => { FakeWS.instances = []; vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket) })

describe('DnpTransport', () => {
  it('handshakes, sends auth, becomes ready, decodes server frames', () => {
    const t = new DnpTransport('/ws', [fixture.serverStaticPub], {
      privateKey: fromHex(fixture.initEphemeralPriv), publicKey: new Uint8Array(0),
    })
    const opened = vi.fn(); const got = vi.fn()
    t.onOpen(opened); t.on('presence', got)
    t.connect('good-token')

    const ws = FakeWS.instances[0]
    expect(ws.protocols).toEqual(['dnp/2'])
    ws.open()
    // msg1 отправлен (детерминирован инъецированным эфемералом → совпадает с фикстурой)
    expect(ws.sent[0]).toEqual(frameLen(fromHex(fixture.msg1)))
    expect(t.isOpen()).toBe(false) // ещё не ready

    // сервер отвечает msg2
    ws.message(frameLen(fromHex(fixture.msg2)))
    expect(opened).toHaveBeenCalled()
    expect(t.isOpen()).toBe(true)

    // auth-кадр (sent[1]) расшифровывается серверным recv = CipherState(initSendKey);
    // клиент шлёт [0x00][JSON] — снимаем kind-байт перед JSON.parse
    const serverRecv = new CipherState(fromHex(fixture.initSendKey))
    const authFramePlain = openFrame(serverRecv, ws.sent[1])
    expect(authFramePlain[0]).toBe(0x00)
    const authPlain = JSON.parse(new TextDecoder().decode(authFramePlain.subarray(1)))
    expect(authPlain).toEqual({ t: 'auth', d: { token: 'good-token' } })

    // сервер → клиент кадр, зашифрованный initRecvKey; тоже [0x00][JSON] — иначе клиент отвергнет
    const serverSend = new CipherState(fromHex(fixture.initRecvKey))
    const presenceJson = new TextEncoder().encode(JSON.stringify({ t: 'presence', d: { user_id: 5, online: true } }))
    const frame = sealFrame(serverSend, withKind(0x00, presenceJson))
    ws.message(frame)
    expect(got).toHaveBeenCalledWith({ user_id: 5, online: true })
  })

  it('доставляет kind 0x01 в onBinary, не трогая JSON-подписчиков', () => {
    const t = new DnpTransport('/ws', [fixture.serverStaticPub], {
      privateKey: fromHex(fixture.initEphemeralPriv), publicKey: new Uint8Array(0),
    })
    const got = vi.fn(); t.on('presence', got)
    const chunks: Uint8Array[] = []
    t.onBinary((d) => chunks.push(d))
    t.connect('good-token')

    const ws = FakeWS.instances[0]
    ws.open()
    ws.message(frameLen(fromHex(fixture.msg2)))

    const serverSend = new CipherState(fromHex(fixture.initRecvKey))

    // сервер шлёт бинарный кадр [0x01, 0xaa, 0xbb] — kind-байт снимается, JSON не парсится
    const payload = new Uint8Array([0xaa, 0xbb])
    const binFrame = sealFrame(serverSend, withKind(0x01, payload))
    ws.message(binFrame)
    expect(chunks).toHaveLength(1)
    expect(Array.from(chunks[0])).toEqual([0xaa, 0xbb])

    // JSON (kind 0x00) в той же ready-сессии по-прежнему доходит до on(type)
    const presenceJson = new TextEncoder().encode(JSON.stringify({ t: 'presence', d: { user_id: 7, online: false } }))
    const jsonFrame = sealFrame(serverSend, withKind(0x00, presenceJson))
    ws.message(jsonFrame)
    expect(got).toHaveBeenCalledWith({ user_id: 7, online: false })
  })

  it('closes (triggering reconnect) on a corrupt server frame', () => {
    const t = new DnpTransport('/ws', [fixture.serverStaticPub], {
      privateKey: fromHex(fixture.initEphemeralPriv), publicKey: new Uint8Array(0),
    })
    const closed = vi.fn(); t.onClose(closed)
    t.connect('good-token')
    const ws = FakeWS.instances[0]; ws.open()
    ws.message(frameLen(fromHex(fixture.msg2)))
    // битый кадр (не расшифруется) → close → onClose (reconnect)
    ws.message(frameLen(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])))
    expect(closed).toHaveBeenCalled()
    expect(t.isOpen()).toBe(false)
  })
})
