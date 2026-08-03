# DNP PR-1b-ii-b — клиент: codec + DnpTransport + разводка (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Клиент говорит на DNP: length-framed `codec.ts`, `DnpTransport` (implements `Transport`, сырой WS + Noise-хендшейк + auth-кадр), снять throwing-заглушку, флаг только build-time. Realtime через Noise-канал за флагом; прод (OFF) 1:1.

**Architecture:** Крипто-ядро (`dnp/noise/*`, PR-1b-i) и серверный dual-mode (PR-1b-ii-a) уже в main. Здесь клиентская обвязка: `codec.ts` (зеркало Go), `DnpTransport` (state-machine `handshaking→ready`, `NKInitiator`, `onOpen` после готовности), `makeDnpTransport` → реальный транспорт, `config/app.ts` без `?dnp=1`.

**Tech Stack:** TypeScript strict (Vitest), Vite 8. Всё из `web-client/`.

**Спека:** [`../specs/2026-08-03-dnp-pr1b-ii-channel-transport-design.md`](../specs/2026-08-03-dnp-pr1b-ii-channel-transport-design.md) §5.

## Global Constraints

- **Формат кадра (зеркало бэка):** `u32 BE len ‖ payload`. Хендшейк: payload = сырое Noise. Транспорт: payload = `CipherState.encryptWithAd(EMPTY_AD, JSON)`. AD пустой.
- **dual-mode:** WS subprotocol `dnp/1`, `binaryType='arraybuffer'`. Токен — первым кадром `{t:"auth",d:{token}}` внутри канала (НЕ в subprotocol).
- **`onOpen` фаерит только когда канал готов** (хендшейк завершён + auth отправлен) — `connectionManager` трактует это как «подключено».
- **reconnect = rehandshake:** сбой хендшейка/decrypt → закрыть WS так, чтобы сработал `onClose` (не глушить `onclose`), тогда `connectionManager` решедулит новый `connect` → новый хендшейк. Публичный `close()` (умышленный) — глушит `onclose`.
- **TypeScript strict, без `any`**; неиспользуемые переменные ломают сборку. Импорты в `core/net/dnp` — относительные.
- **e2e — док-шаг** (не автогейт): решено на brainstorming. Автогейт PR = unit (codec + DnpTransport) + typecheck + build. Стенд-e2e расписан в конце как ручная верификация.
- **Тест-инъекция эфемерного ключа:** `DnpTransport` принимает опциональный `testEphemeral?: KeyPair` (как `NKInitiator`), только ради детерминизма тестов; в проде эфемерал генерится.
- Команды из `web-client/`.

## Файловая структура

- `src/core/net/dnp/codec.ts` (новый) — `frameLen`/`unframeLen`/`sealFrame`/`openFrame`.
- `src/core/net/dnp/codec.test.ts` (новый).
- `src/core/net/dnp/dnpTransport.ts` (новый) — `DnpTransport implements Transport`.
- `src/core/net/dnp/dnpTransport.test.ts` (новый) — state-machine на фейковом WS через фикстуру.
- `src/core/net/dnp/index.ts` (правка) — `makeDnpTransport` → реальный.
- `src/config/app.ts` (правка) — убрать `?dnp=1`/`search`.
- `src/config/app.test.ts` (правка) — убрать кейс `?dnp=1`, поправить вызовы.
- `src/core/net/dnp/noise/handshakeState.ts` (правка) — defensive-copy `remoteStatic` + length-guard `readMessage2`.
- `src/core/net/dnp/noise/handshakeState.test.ts` (правка) — тесты хардненинга.

---

### Task 1: `dnp/codec.ts` — length-framing + seal/open

**Files:**
- Create: `web-client/src/core/net/dnp/codec.ts`
- Create: `web-client/src/core/net/dnp/codec.test.ts`

**Interfaces:**
- Consumes: `CipherState` (`./noise/symmetricState`) — `encryptWithAd(ad, pt)`/`decryptWithAd(ad, ct)`.
- Produces: `MAX_FRAME_LEN`; `frameLen(payload): Uint8Array`; `unframeLen(raw): Uint8Array`; `sealFrame(cs, plaintext): Uint8Array`; `openFrame(cs, raw): Uint8Array`.

- [ ] **Step 1: Написать тест (падающий)**

`web-client/src/core/net/dnp/codec.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { frameLen, unframeLen, sealFrame, openFrame } from './codec'
import { CipherState } from './noise/symmetricState'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (u: Uint8Array) => new TextDecoder().decode(u)

describe('dnp codec length-framing', () => {
  it('frameLen/unframeLen round-trip incl. empty', () => {
    for (const p of [new Uint8Array(0), new Uint8Array([1]), enc('hello world')]) {
      expect(unframeLen(frameLen(p))).toEqual(p)
    }
  })
  it('frameLen writes a 4-byte big-endian length prefix', () => {
    const out = frameLen(new Uint8Array([9, 9, 9]))
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 3])
  })
  it('unframeLen rejects short header and length mismatch', () => {
    expect(() => unframeLen(new Uint8Array([0, 0]))).toThrow()
    expect(() => unframeLen(new Uint8Array([0, 0, 0, 10, 1, 2]))).toThrow()
  })
})

describe('dnp codec seal/open', () => {
  it('round-trips a JSON frame across two CipherStates with the same key', () => {
    const key = new Uint8Array(32).fill(9)
    const send = new CipherState(key); const recv = new CipherState(key)
    const wire = sealFrame(send, enc('{"t":"ping"}'))
    expect(wire.length).toBeGreaterThan(4 + 16) // len prefix + tag
    expect(dec(openFrame(recv, wire))).toBe('{"t":"ping"}')
  })
})
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run src/core/net/dnp/codec.test.ts`
Expected: FAIL — `./codec` не существует.

- [ ] **Step 3: Реализовать**

`web-client/src/core/net/dnp/codec.ts`:
```ts
import type { CipherState } from './noise/symmetricState'

// Верхняя граница payload одного кадра (совпадает с бэкендом ws maxMessageSize).
export const MAX_FRAME_LEN = 1 << 20
const EMPTY_AD = new Uint8Array(0)

// Формат кадра: u32 big-endian длина + payload. Над WS префикс избыточен (границы
// даёт сам WS), но закладываем единообразно с бэком ради будущего сырого-TCP носителя.
export function frameLen(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length)
  new DataView(out.buffer).setUint32(0, payload.length, false) // big-endian
  out.set(payload, 4)
  return out
}

export function unframeLen(raw: Uint8Array): Uint8Array {
  if (raw.length < 4) throw new Error('dnp: short frame header')
  const n = new DataView(raw.buffer, raw.byteOffset, 4).getUint32(0, false)
  if (n > MAX_FRAME_LEN) throw new Error('dnp: frame too large')
  if (n !== raw.length - 4) throw new Error('dnp: frame length mismatch')
  return raw.subarray(4)
}

// Транспортный кадр: [len][encrypt(pt)], AD пустой.
export function sealFrame(cs: CipherState, plaintext: Uint8Array): Uint8Array {
  return frameLen(cs.encryptWithAd(EMPTY_AD, plaintext))
}

export function openFrame(cs: CipherState, raw: Uint8Array): Uint8Array {
  return cs.decryptWithAd(EMPTY_AD, unframeLen(raw))
}
```

- [ ] **Step 4: Тесты зелёные + тайпчек**

Run: `npx vitest run src/core/net/dnp/codec.test.ts && npm run typecheck`
Expected: PASS, тайпчек чист.

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/net/dnp/codec.ts web-client/src/core/net/dnp/codec.test.ts
git commit -m "feat(dnp): client length-framed codec (frameLen/sealFrame) mirroring backend

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `DnpTransport` (implements Transport)

**Files:**
- Create: `web-client/src/core/net/dnp/dnpTransport.ts`
- Create: `web-client/src/core/net/dnp/dnpTransport.test.ts`

**Interfaces:**
- Consumes: `Transport` (`../transport`), `NKInitiator` (`./noise/handshakeState`), `KeyPair`/`CipherState`, `frameLen`/`unframeLen`/`sealFrame`/`openFrame` (Task 1), `encodeFrame`/`decodeFrame` (`../../../protocol/frames`).
- Produces: `class DnpTransport implements Transport` with `constructor(url: string, serverStaticPublicKeys: string[], testEphemeral?: KeyPair)`.

- [ ] **Step 1: Написать тест state-machine (падающий)**

`web-client/src/core/net/dnp/dnpTransport.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DnpTransport } from './dnpTransport'
import { CipherState } from './noise/symmetricState'
import { frameLen, sealFrame, openFrame } from './codec'
import fixture from './noise/fixtures/nk-vector.json'

const fromHex = (s: string) => new Uint8Array(s.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))

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
    expect(ws.protocols).toEqual(['dnp/1'])
    ws.open()
    // msg1 отправлен (детерминирован инъецированным эфемералом → совпадает с фикстурой)
    expect(ws.sent[0]).toEqual(frameLen(fromHex(fixture.msg1)))
    expect(t.isOpen()).toBe(false) // ещё не ready

    // сервер отвечает msg2
    ws.message(frameLen(fromHex(fixture.msg2)))
    expect(opened).toHaveBeenCalled()
    expect(t.isOpen()).toBe(true)

    // auth-кадр (sent[1]) расшифровывается серверным recv = CipherState(initSendKey)
    const serverRecv = new CipherState(fromHex(fixture.initSendKey))
    const authPlain = JSON.parse(new TextDecoder().decode(openFrame(serverRecv, ws.sent[1])))
    expect(authPlain).toEqual({ t: 'auth', d: { token: 'good-token' } })

    // сервер → клиент кадр, зашифрованный initRecvKey
    const serverSend = new CipherState(fromHex(fixture.initRecvKey))
    const frame = sealFrame(serverSend, new TextEncoder().encode(JSON.stringify({ t: 'presence', d: { user_id: 5, online: true } })))
    ws.message(frame)
    expect(got).toHaveBeenCalledWith({ user_id: 5, online: true })
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
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run src/core/net/dnp/dnpTransport.test.ts`
Expected: FAIL — `./dnpTransport` не существует.

- [ ] **Step 3: Реализовать**

`web-client/src/core/net/dnp/dnpTransport.ts`:
```ts
import type { Transport } from '../transport'
import { NKInitiator } from './noise/handshakeState'
import type { KeyPair } from './noise/primitives'
import type { CipherState } from './noise/symmetricState'
import { frameLen, unframeLen, sealFrame, openFrame } from './codec'
import { encodeFrame, decodeFrame, type Frame } from '../../../protocol/frames'

const PROLOGUE = new TextEncoder().encode('dnp/1')

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim()
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16)
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
    const ws = new WebSocket(this.url, ['dnp/1'])
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
    this.ws!.send(frameLen(this.hs.writeMessage1()))
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
        this.ws!.send(sealFrame(this.cipherSend, new TextEncoder().encode(authJson)))
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
        const f: Frame = decodeFrame(new TextDecoder().decode(plain))
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
    this.ws!.send(sealFrame(this.cipherSend, new TextEncoder().encode(encodeFrame(t, d))))
  }

  // Умышленное закрытие (connectionManager.stop): глушим onclose, чтобы НЕ переподключаться.
  close(): void {
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null }
    this.state = 'closed'
  }
}
```

- [ ] **Step 4: Тесты зелёные + тайпчек**

Run: `npx vitest run src/core/net/dnp/dnpTransport.test.ts && npm run typecheck`
Expected: PASS (оба кейса), тайпчек чист. Настройка: JSON-импорт фикстуры уже работает (`resolveJsonModule` включён, использован в interop.test).

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/net/dnp/dnpTransport.ts web-client/src/core/net/dnp/dnpTransport.test.ts
git commit -m "feat(dnp): DnpTransport — Noise_NK channel over raw WS (implements Transport)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Разводка — реальный `makeDnpTransport` + убрать `?dnp=1`

**Files:**
- Modify: `web-client/src/core/net/dnp/index.ts`
- Modify: `web-client/src/config/app.ts`
- Modify: `web-client/src/config/app.test.ts`

**Interfaces:**
- Consumes: `DnpTransport` (Task 2), `AppConfig` (`config/app`).

- [ ] **Step 1: Заменить заглушку реальным транспортом**

`web-client/src/core/net/dnp/index.ts` (целиком):
```ts
import type { Transport } from '../transport'
import { DnpTransport } from './dnpTransport'
import { AppConfig } from '../../../config/app'

// Достижимо только при AppConfig.dnp.enabled (build-time VITE_DNP_ENABLED, дефолт OFF).
export function makeDnpTransport(): Transport {
  return new DnpTransport('/ws', AppConfig.dnp.serverStaticPublicKeys)
}
```

- [ ] **Step 2: Убрать `?dnp=1`-оверрайд из конфига**

`web-client/src/config/app.ts` — `readDnpConfig` теперь без `search`:
```ts
export function readDnpConfig(env: ImportMetaEnv): DnpConfig {
  return {
    enabled: env.VITE_DNP_ENABLED === '1',
    serverStaticPublicKeys: (env.VITE_DNP_SERVER_PUBKEYS ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean),
  }
}

export const AppConfig = {
  dnp: readDnpConfig(import.meta.env),
}
```
(Комментарий про build-time флаг оставить/обновить; `location.search` больше не читается — оверрайд в воркере всё равно не работал.)

- [ ] **Step 3: Обновить тест конфига**

`web-client/src/config/app.test.ts` — убрать кейс `?dnp=1`, поправить вызовы `readDnpConfig(env({...}))` (без второго аргумента):
```ts
import { describe, it, expect } from 'vitest'
import { readDnpConfig } from './app'

const env = (o: Record<string, string | undefined>) => o as unknown as ImportMetaEnv

describe('readDnpConfig', () => {
  it('disabled by default, empty keys', () => {
    const c = readDnpConfig(env({}))
    expect(c.enabled).toBe(false)
    expect(c.serverStaticPublicKeys).toEqual([])
  })
  it('enabled via VITE_DNP_ENABLED=1', () => {
    expect(readDnpConfig(env({ VITE_DNP_ENABLED: '1' })).enabled).toBe(true)
  })
  it('parses comma-separated pinned keys, trims, drops empties', () => {
    const c = readDnpConfig(env({ VITE_DNP_SERVER_PUBKEYS: ' a , b ,, c ' }))
    expect(c.serverStaticPublicKeys).toEqual(['a', 'b', 'c'])
  })
})
```

- [ ] **Step 4: Полный прогон — тесты, тайпчек, сборка**

Run: `npm test && npm run typecheck && npm run build`
Expected: всё зелёное. Флаг OFF → `createTransport` собирает `WsClient` (поведение 1:1); реальный `DnpTransport` подключается только при `VITE_DNP_ENABLED=1`.

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/net/dnp/index.ts web-client/src/config/app.ts web-client/src/config/app.test.ts
git commit -m "feat(dnp): wire real DnpTransport; drop non-functional ?dnp=1 (build-time flag only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Хардненинг Noise-хендшейка (перенос из PR-1b-i)

**Files:**
- Modify: `web-client/src/core/net/dnp/noise/handshakeState.ts`
- Modify: `web-client/src/core/net/dnp/noise/handshakeState.test.ts`

**Interfaces:**
- Изменяет поведение `NKInitiator` (defensive-copy входного `remoteStatic`; строгая проверка длины `readMessage2`) без смены сигнатур.

- [ ] **Step 1: Дописать тесты (падающие)**

Добавить в `web-client/src/core/net/dnp/noise/handshakeState.test.ts`:
```ts
import fixture from './fixtures/nk-vector.json'
const fromHex2 = (s: string) => new Uint8Array(s.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))
const toHex2 = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('')

describe('NKInitiator hardening', () => {
  it('defensively copies remoteStatic (caller mutation after construction is ignored)', () => {
    const rs = fromHex2(fixture.serverStaticPub)
    const hs = new NKInitiator({
      prologue: new TextEncoder().encode('dnp/1'), remoteStatic: rs,
      ephemeral: { privateKey: fromHex2(fixture.initEphemeralPriv), publicKey: new Uint8Array(0) },
    })
    rs.fill(0) // портим буфер вызывающего ПОСЛЕ конструктора
    expect(toHex2(hs.writeMessage1())).toBe(fixture.msg1) // без копии msg1 бы не совпал
  })
  it('rejects a malformed message2 (wrong length) with a clear error', () => {
    const hs = new NKInitiator({
      prologue: new TextEncoder().encode('dnp/1'), remoteStatic: fromHex2(fixture.serverStaticPub),
      ephemeral: { privateKey: fromHex2(fixture.initEphemeralPriv), publicKey: new Uint8Array(0) },
    })
    hs.writeMessage1()
    expect(() => hs.readMessage2(new Uint8Array(10))).toThrow('message2')
  })
})
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run src/core/net/dnp/noise/handshakeState.test.ts`
Expected: FAIL — defensive-copy/length-guard ещё нет (мутация портит msg1; короткий msg2 не кидает `message2`).

- [ ] **Step 3: Реализовать хардненинг**

`web-client/src/core/net/dnp/noise/handshakeState.ts`:
```ts
  constructor(opts: { prologue: Uint8Array; remoteStatic: Uint8Array; ephemeral?: KeyPair }) {
    this.rs = opts.remoteStatic.slice() // defensive copy: не зависим от мутаций буфера вызывающего
    this.e = opts.ephemeral
      ? { privateKey: opts.ephemeral.privateKey, publicKey: dhPublic(opts.ephemeral.privateKey) }
      : dhGenerate()
    this.ss.mixHash(opts.prologue)
    this.ss.mixHash(this.rs)
  }
```
```ts
  // <- e, ee
  readMessage2(message: Uint8Array): Uint8Array {
    // NK msg2 = 32-байтный ephemeral + 16-байтный AEAD-тег (пустой payload) = 48.
    if (message.length !== 48) throw new Error('dnp: malformed message2 (expected 48 bytes)')
    const re = message.slice(0, 32)
    this.ss.mixHash(re)
    this.ss.mixKey(dh(this.e.privateKey, re)) // ee
    return this.ss.decryptAndHash(message.slice(32))
  }
```

- [ ] **Step 4: Тесты зелёные (весь noise/) + тайпчек**

Run: `npx vitest run src/core/net/dnp/noise/ && npm run typecheck`
Expected: PASS — новые хардненинг-тесты + все прежние (interop, symmetricState, handshakeState) зелёные (msg1/interop не изменились, копия не влияет на вывод).

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/net/dnp/noise/handshakeState.ts web-client/src/core/net/dnp/noise/handshakeState.test.ts
git commit -m "harden(dnp): defensive-copy remoteStatic + strict message2 length guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Финальная проверка PR-1b-ii-b

- [ ] `npm test && npm run typecheck && npm run build` — зелёное (codec + DnpTransport + noise + config + весь фронт).
- [ ] Флаг OFF: `createTransport` → `WsClient`, чат работает 1:1; в сети plain-WS, новых кадров нет.
- [ ] `?dnp=1` в URL больше ничего не включает (только `VITE_DNP_ENABLED`).
- [ ] PR в `main`, ветка `feat/dnp-client-iib`.

## Стенд-e2e (ручная верификация — док-шаг, вне автогейта)

Крипта и interop уже доказаны (PR-1b-i байт-в-байт JS↔Go; PR-1b-ii-a: Go-сервер принимает flynn/noise initiator). Полный стенд-прогон подтверждает клиентскую обвязку живьём:

1. Сгенерировать пару: `cd backend && go run ./cmd/dnpkeygen` → `DNP_SERVER_PRIVKEY=…`, `VITE_DNP_SERVER_PUBKEYS=…`.
2. Бэкенд (стенд `msgrverify`): выставить `DNP_SERVER_PRIVKEY`, пересобрать/перезапустить.
3. Фронт: `cd web-client && VITE_DNP_ENABLED=1 VITE_DNP_SERVER_PUBKEYS=<pub> npx vite build --outDir ../client-build`.
4. Открыть приложение через nginx стенда, войти, проверить: чат работает (отправка/приём/typing/read) через Noise-канал; в DevTools WS-кадры бинарные (не JSON); reconnect (перезапуск бэка) → канал переустанавливается (rehandshake); параллельно вкладка со старым билдом (флаг OFF) продолжает работать по plain-WS.

## Self-review (проверено при написании плана)

- **Покрытие спеки §5:** codec.ts (Task 1), DnpTransport (Task 2), makeDnpTransport+config (Task 3), хардненинг-перенос (Task 4), e2e-док-шаг (в конце). MAX_NONCE-гард сознательно НЕ включён (нативный `DataView.setBigUint64` уже кидает при 2^64; остаётся отложенным — чистого unit-теста нет).
- **Плейсхолдеры:** реальный код везде.
- **Согласованность типов:** `frameLen`/`unframeLen`/`sealFrame`/`openFrame` (Task 1) ↔ DnpTransport (Task 2); `CipherState`/`NKInitiator` API из main; `DnpTransport(url, keys, testEphemeral?)` (Task 2) ↔ `makeDnpTransport` (Task 3); `readDnpConfig(env)` (Task 3) ↔ тест (Task 3); фикстура-поля (`msg1`/`msg2`/`initSendKey`/`initRecvKey`/`initEphemeralPriv`/`serverStaticPub`) — проверены присутствующими.
- **Prod-инвариант:** флаг OFF → `WsClient` (createTransport не меняется); DnpTransport достижим только при VITE_DNP_ENABLED=1.
- **reconnect:** `fail()` (внутренний, не глушит onclose → reconnect) vs `close()` (публичный, глушит) — разведены; тест на corrupt-frame покрывает путь reconnect.
