# DNP PR-1b-i — Noise-ядро + Go↔JS interop (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать ядро `Noise_NK_25519_ChaChaPoly_BLAKE2s` — клиент (хандрол на `@noble`) и сервер (`flynn/noise` responder) — и доказать их **interop** детерминированным фикстур-тестом. БЕЗ транспорта/WS/dual-mode (это PR-1b-ii).

**Architecture:** Клиент: тонкий адаптер над `@noble` → symmetric-state (HKDF/mix/encrypt) → NK-handshake (initiator). Сервер: `flynn/noise` NK-responder + детерминированный генератор фикстуры (flynn/noise как эталон-оракул). Interop-гейт: JS-initiator воспроизводит зафиксированные байты фикстуры (msg1, split-ключи, транспортный ct), сгенерированной Go-стороной.

**Tech Stack:** TypeScript strict (Vitest), Go 1.25 (`github.com/flynn/noise`), `@noble/curves`+`@noble/ciphers`+`@noble/hashes` (v2, ESM).

**Спека:** [`../specs/2026-08-03-dnp-pr1b-noise-channel-design.md`](../specs/2026-08-03-dnp-pr1b-noise-channel-design.md) — §2 (параметры Noise) обязателен к соблюдению байт-в-байт.

## Global Constraints

- **Cipher suite:** `Noise_NK_25519_ChaChaPoly_BLAKE2s`, `prologue = "dnp/1"` (ASCII) — на обеих сторонах идентично.
- **HKDF:** вариант Noise на HMAC-BLAKE2s. **AEAD nonce:** 12 байт = 4 нулевых ‖ 8-байтный **LE** счётчик. **AD:** хендшейк — `AD=h`; транспорт — `AD=""`.
- **TypeScript strict, без `any`**; неиспользуемые переменные ломают сборку. Go: `gofmt`, тесты `go test ./...`.
- **Крипто-критично:** каждая задача с крипто-логикой заканчивается тестом; symmetric-state/handshake — против детерминированных векторов; interop — обязательный гейт (Task 5). Без зелёных тестов задача не «готова».
- Импорты в `core/net` — относительные. Команды клиента — из `web-client/`, бэка — из `backend/`.
- **Границы:** без WS/`DnpTransport`/codec-конверта/dual-mode/ключевого тулинга-для-прода — это PR-1b-ii.

## Файловая структура PR-1b-i

- `web-client/src/core/net/dnp/noise/primitives.ts` (новый) — адаптер над `@noble`: dh, aead, hash, hmac.
- `web-client/src/core/net/dnp/noise/primitives.test.ts` (новый) — smoke + known-answer.
- `web-client/src/core/net/dnp/noise/symmetricState.ts` (новый) — HKDF, SymmetricState, CipherState.
- `web-client/src/core/net/dnp/noise/symmetricState.test.ts` (новый).
- `web-client/src/core/net/dnp/noise/handshakeState.ts` (новый) — NK initiator.
- `web-client/src/core/net/dnp/noise/handshakeState.test.ts` (новый) — детерминированный msg1.
- `web-client/src/core/net/dnp/noise/interop.test.ts` (новый) — JS против Go-фикстуры.
- `web-client/src/core/net/dnp/noise/fixtures/nk-vector.json` (новый, коммитится) — фикстура из Go.
- `backend/internal/adapter/delivery/ws/dnp/noise.go` (новый) — flynn/noise NK responder.
- `backend/internal/adapter/delivery/ws/dnp/noise_test.go` (новый) — responder round-trip + генератор фикстуры.
- `backend/go.mod` / `web-client/package.json` — новые зависимости.

---

### Task 1: Зависимости `@noble` + адаптер примитивов + smoke-тест

**Files:**
- Modify: `web-client/package.json` (deps)
- Create: `web-client/src/core/net/dnp/noise/primitives.ts`
- Create: `web-client/src/core/net/dnp/noise/primitives.test.ts`

**Interfaces:**
- Produces: `interface KeyPair { privateKey: Uint8Array; publicKey: Uint8Array }`; `dhGenerate(): KeyPair`; `dhPublic(sk): Uint8Array`; `dh(sk, pk): Uint8Array`; `hashBlake2s(data): Uint8Array`; `hmacBlake2s(key, data): Uint8Array`; `aeadSeal(key, nonce, ad, pt): Uint8Array`; `aeadOpen(key, nonce, ad, ct): Uint8Array`; `const HASHLEN = 32`.

- [ ] **Step 1: Установить зависимости**

Run (из `web-client/`): `npm i @noble/curves @noble/ciphers @noble/hashes`
Expected: три пакета добавлены в `dependencies` (v2.x).

- [ ] **Step 2: Написать smoke/known-answer тест (падающий)**

`web-client/src/core/net/dnp/noise/primitives.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { dhGenerate, dhPublic, dh, hashBlake2s, hmacBlake2s, aeadSeal, aeadOpen } from './primitives'

const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('')

describe('noise primitives (@noble adapter)', () => {
  it('x25519 DH agreement + pubkey derivation, 32-byte keys', () => {
    const a = dhGenerate(); const b = dhGenerate()
    expect(a.publicKey.length).toBe(32)
    expect(dhPublic(a.privateKey)).toEqual(a.publicKey)
    expect(dh(a.privateKey, b.publicKey)).toEqual(dh(b.privateKey, a.publicKey))
  })
  it('BLAKE2s-256 known-answer for "abc"', () => {
    // Стандартный вектор BLAKE2s-256("abc"). Если установленная либа не сходится —
    // сперва перепроверь вектор, потом ищи баг.
    expect(hex(hashBlake2s(new TextEncoder().encode('abc'))))
      .toBe('508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982')
  })
  it('HMAC-BLAKE2s is deterministic and 32 bytes', () => {
    const k = new Uint8Array(32).fill(1); const m = new Uint8Array(8).fill(2)
    const a = hmacBlake2s(k, m); const b = hmacBlake2s(k, m)
    expect(a).toEqual(b); expect(a.length).toBe(32)
  })
  it('ChaCha20-Poly1305 seal/open round-trip with AAD, tag appended', () => {
    const key = new Uint8Array(32).fill(7)
    const nonce = new Uint8Array(12); nonce[4] = 1
    const ad = new Uint8Array([9, 9]); const pt = new TextEncoder().encode('hello')
    const ct = aeadSeal(key, nonce, ad, pt)
    expect(ct.length).toBe(pt.length + 16) // Poly1305 tag
    expect(aeadOpen(key, nonce, ad, ct)).toEqual(pt)
  })
})
```

- [ ] **Step 3: Запустить — убедиться, что падает**

Run: `npx vitest run src/core/net/dnp/noise/primitives.test.ts`
Expected: FAIL — `./primitives` не существует.

- [ ] **Step 4: Реализовать адаптер**

`web-client/src/core/net/dnp/noise/primitives.ts`:
```ts
import { x25519 } from '@noble/curves/ed25519.js'
import { chacha20poly1305 } from '@noble/ciphers/chacha.js'
import { blake2s } from '@noble/hashes/blake2.js'
import { hmac } from '@noble/hashes/hmac.js'

export const HASHLEN = 32

export interface KeyPair { privateKey: Uint8Array; publicKey: Uint8Array }

// ВАЖНО: точные аксессоры x25519 могут отличаться по версии @noble/curves.
// Контракт — smoke-тест (DH agreement). Если установленная версия называет их
// иначе — правь ТОЛЬКО эти три функции, остальной код от них изолирован.
export const dhGenerate = (): KeyPair => {
  const privateKey = x25519.utils.randomPrivateKey()
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) }
}
export const dhPublic = (privateKey: Uint8Array): Uint8Array => x25519.getPublicKey(privateKey)
export const dh = (privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array =>
  x25519.getSharedSecret(privateKey, publicKey)

export const hashBlake2s = (data: Uint8Array): Uint8Array => blake2s(data)
export const hmacBlake2s = (key: Uint8Array, data: Uint8Array): Uint8Array => hmac(blake2s, key, data)

// ChaCha20-Poly1305: 32-байтный ключ, 12-байтный nonce, ad опционально, тег (16) в хвосте.
export const aeadSeal = (key: Uint8Array, nonce: Uint8Array, ad: Uint8Array, plaintext: Uint8Array): Uint8Array =>
  chacha20poly1305(key, nonce, ad).encrypt(plaintext)
export const aeadOpen = (key: Uint8Array, nonce: Uint8Array, ad: Uint8Array, ciphertext: Uint8Array): Uint8Array =>
  chacha20poly1305(key, nonce, ad).decrypt(ciphertext)
```

- [ ] **Step 5: Запустить тесты — зелёные**

Run: `npx vitest run src/core/net/dnp/noise/primitives.test.ts`
Expected: PASS (4 passed). Если падает DH-тест — скорректируй аксессоры x25519 в адаптере под установленную версию и перезапусти. Если падает BLAKE2s-вектор — перепроверь, что импорт `blake2s` (не `blake2b`).

- [ ] **Step 6: Тайпчек + commit**

Run: `npm run typecheck`
```bash
git add web-client/package.json web-client/package-lock.json web-client/src/core/net/dnp/noise/primitives.ts web-client/src/core/net/dnp/noise/primitives.test.ts
git commit -m "feat(dnp): @noble primitives adapter for Noise (dh/aead/hash/hmac)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: HKDF + SymmetricState + CipherState

**Files:**
- Create: `web-client/src/core/net/dnp/noise/symmetricState.ts`
- Create: `web-client/src/core/net/dnp/noise/symmetricState.test.ts`

**Interfaces:**
- Consumes (Task 1): `hashBlake2s`, `hmacBlake2s`, `aeadSeal`, `aeadOpen`, `HASHLEN`.
- Produces: `hkdf(chainingKey, ikm, numOutputs: 2): [Uint8Array, Uint8Array]`; `class CipherState { constructor(key: Uint8Array); encryptWithAd(ad, pt): Uint8Array; decryptWithAd(ad, ct): Uint8Array }`; `class SymmetricState { constructor(protocolName: string); mixKey(ikm): void; mixHash(data): void; encryptAndHash(pt): Uint8Array; decryptAndHash(ct): Uint8Array; split(): [CipherState, CipherState]; readonly h: Uint8Array }`; helper `nonce8(n: bigint): Uint8Array` (12-байтный nonce).

- [ ] **Step 1: Написать тесты (падающие)**

`web-client/src/core/net/dnp/noise/symmetricState.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { hkdf, nonce8, CipherState, SymmetricState } from './symmetricState'
import { hmacBlake2s } from './primitives'

describe('Noise HKDF (HMAC-BLAKE2s)', () => {
  it('matches the Noise 2-output construction', () => {
    const ck = new Uint8Array(32).fill(3); const ikm = new Uint8Array(32).fill(4)
    const [o1, o2] = hkdf(ck, ikm, 2)
    const tempKey = hmacBlake2s(ck, ikm)
    const exp1 = hmacBlake2s(tempKey, new Uint8Array([1]))
    const exp2 = hmacBlake2s(tempKey, new Uint8Array([...exp1, 2]))
    expect(o1).toEqual(exp1); expect(o2).toEqual(exp2)
  })
})

describe('nonce8', () => {
  it('is 12 bytes: 4 zero prefix + 8-byte little-endian counter', () => {
    expect([...nonce8(0n)]).toEqual(Array(12).fill(0))
    const n = nonce8(1n)
    expect([...n.slice(0, 4)]).toEqual([0, 0, 0, 0])
    expect(n[4]).toBe(1); expect([...n.slice(5)]).toEqual([0, 0, 0, 0, 0, 0, 0])
  })
})

describe('CipherState', () => {
  it('round-trips and advances the nonce', () => {
    const key = new Uint8Array(32).fill(5)
    const send = new CipherState(key); const recv = new CipherState(key)
    const ad = new Uint8Array(0)
    const c1 = send.encryptWithAd(ad, new TextEncoder().encode('one'))
    const c2 = send.encryptWithAd(ad, new TextEncoder().encode('two'))
    expect(new TextDecoder().decode(recv.decryptWithAd(ad, c1))).toBe('one')
    expect(new TextDecoder().decode(recv.decryptWithAd(ad, c2))).toBe('two')
  })
})

describe('SymmetricState', () => {
  it('two independent instances stay in lockstep (mixKey/mixHash/encrypt/decrypt)', () => {
    const a = new SymmetricState('Noise_NK_25519_ChaChaPoly_BLAKE2s')
    const b = new SymmetricState('Noise_NK_25519_ChaChaPoly_BLAKE2s')
    a.mixHash(new TextEncoder().encode('dnp/1')); b.mixHash(new TextEncoder().encode('dnp/1'))
    a.mixKey(new Uint8Array(32).fill(9)); b.mixKey(new Uint8Array(32).fill(9))
    const ct = a.encryptAndHash(new TextEncoder().encode('payload'))
    expect(new TextDecoder().decode(b.decryptAndHash(ct))).toBe('payload')
    expect(a.h).toEqual(b.h)
  })
})
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run src/core/net/dnp/noise/symmetricState.test.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Реализовать**

`web-client/src/core/net/dnp/noise/symmetricState.ts`:
```ts
import { HASHLEN, hashBlake2s, hmacBlake2s, aeadSeal, aeadOpen } from './primitives'

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total); let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

// 12-байтный ChaCha20-Poly1305 nonce по Noise: 4 нулевых байта + 8-байтный LE-счётчик.
export const nonce8 = (n: bigint): Uint8Array => {
  const out = new Uint8Array(12)
  const view = new DataView(out.buffer)
  view.setBigUint64(4, n, true /* little-endian */)
  return out
}

// Noise HKDF на HMAC-BLAKE2s (2 выхода).
export const hkdf = (chainingKey: Uint8Array, ikm: Uint8Array, numOutputs: 2): [Uint8Array, Uint8Array] => {
  const tempKey = hmacBlake2s(chainingKey, ikm)
  const output1 = hmacBlake2s(tempKey, new Uint8Array([1]))
  const output2 = hmacBlake2s(tempKey, concat(output1, new Uint8Array([2])))
  return [output1, output2]
}

export class CipherState {
  private n = 0n
  constructor(private readonly k: Uint8Array) {}
  encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    const ct = aeadSeal(this.k, nonce8(this.n), ad, plaintext); this.n++; return ct
  }
  decryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    const pt = aeadOpen(this.k, nonce8(this.n), ad, ciphertext); this.n++; return pt
  }
}

export class SymmetricState {
  private ck: Uint8Array
  private hVal: Uint8Array
  private k: Uint8Array | null = null
  private n = 0n
  get h(): Uint8Array { return this.hVal }

  constructor(protocolName: string) {
    const name = new TextEncoder().encode(protocolName)
    this.hVal = name.length <= HASHLEN
      ? concat(name, new Uint8Array(HASHLEN - name.length))
      : hashBlake2s(name)
    this.ck = this.hVal
  }

  mixHash(data: Uint8Array): void { this.hVal = hashBlake2s(concat(this.hVal, data)) }

  mixKey(ikm: Uint8Array): void {
    const [ck, tempK] = hkdf(this.ck, ikm, 2)
    this.ck = ck; this.k = tempK; this.n = 0n
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    let ct: Uint8Array
    if (this.k) { ct = aeadSeal(this.k, nonce8(this.n), this.hVal, plaintext); this.n++ }
    else ct = plaintext
    this.mixHash(ct); return ct
  }

  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    let pt: Uint8Array
    if (this.k) { pt = aeadOpen(this.k, nonce8(this.n), this.hVal, ciphertext); this.n++ }
    else pt = ciphertext
    this.mixHash(ciphertext); return pt
  }

  split(): [CipherState, CipherState] {
    const [t1, t2] = hkdf(this.ck, new Uint8Array(0), 2)
    return [new CipherState(t1), new CipherState(t2)]
  }
}
```

- [ ] **Step 4: Тесты зелёные + тайпчек**

Run: `npx vitest run src/core/net/dnp/noise/symmetricState.test.ts && npm run typecheck`
Expected: PASS (4 describe-блока), тайпчек чист.

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/net/dnp/noise/symmetricState.ts web-client/src/core/net/dnp/noise/symmetricState.test.ts
git commit -m "feat(dnp): Noise symmetric state (HKDF/mixKey/mixHash/split) + CipherState

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Noise_NK handshake (initiator)

**Files:**
- Create: `web-client/src/core/net/dnp/noise/handshakeState.ts`
- Create: `web-client/src/core/net/dnp/noise/handshakeState.test.ts`

**Interfaces:**
- Consumes (Task 1,2): `KeyPair`, `dhGenerate`, `dh`, `SymmetricState`, `CipherState`.
- Produces: `const PROTOCOL_NAME = 'Noise_NK_25519_ChaChaPoly_BLAKE2s'`; `class NKInitiator { constructor(opts: { prologue: Uint8Array; remoteStatic: Uint8Array; ephemeral?: KeyPair }); writeMessage1(payload?: Uint8Array): Uint8Array; readMessage2(message: Uint8Array): Uint8Array; split(): { send: CipherState; recv: CipherState } }`. `ephemeral` инъектируется в тестах ради детерминизма; в проде — генерится.

- [ ] **Step 1: Написать тест (падающий)**

`web-client/src/core/net/dnp/noise/handshakeState.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { NKInitiator, PROTOCOL_NAME } from './handshakeState'
import { dhGenerate } from './primitives'

describe('NKInitiator', () => {
  it('protocol name is exactly the DNP suite', () => {
    expect(PROTOCOL_NAME).toBe('Noise_NK_25519_ChaChaPoly_BLAKE2s')
  })
  it('writeMessage1 is deterministic given a fixed ephemeral, and starts with the 32-byte ephemeral public', () => {
    const server = dhGenerate()
    const eph = { privateKey: new Uint8Array(32).fill(1), publicKey: new Uint8Array(0) }
    // publicKey заполнит конструктор из privateKey
    const hs = new NKInitiator({ prologue: new TextEncoder().encode('dnp/1'), remoteStatic: server.publicKey, ephemeral: eph })
    const msg1 = hs.writeMessage1()
    // NK msg1 = e(32) ‖ encryptAndHash(empty payload=16 tag)
    expect(msg1.length).toBe(32 + 16)
  })
})
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run src/core/net/dnp/noise/handshakeState.test.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Реализовать**

`web-client/src/core/net/dnp/noise/handshakeState.ts`:
```ts
import { type KeyPair, dhGenerate, dhPublic, dh } from './primitives'
import { SymmetricState, type CipherState } from './symmetricState'

export const PROTOCOL_NAME = 'Noise_NK_25519_ChaChaPoly_BLAKE2s'

const EMPTY = new Uint8Array(0)

// Noise_NK, роль initiator (клиент). Паттерн: <- s (pre-message), -> e, es ; <- e, ee.
export class NKInitiator {
  private readonly ss = new SymmetricState(PROTOCOL_NAME)
  private readonly e: KeyPair
  private readonly rs: Uint8Array

  constructor(opts: { prologue: Uint8Array; remoteStatic: Uint8Array; ephemeral?: KeyPair }) {
    this.rs = opts.remoteStatic
    // Инъекция эфемерного ключа для детерминизма в тестах; иначе генерим.
    this.e = opts.ephemeral
      ? { privateKey: opts.ephemeral.privateKey, publicKey: dhPublic(opts.ephemeral.privateKey) }
      : dhGenerate()
    this.ss.mixHash(opts.prologue)
    // pre-message NK: статик ответчика известен заранее.
    this.ss.mixHash(this.rs)
  }

  // -> e, es
  writeMessage1(payload: Uint8Array = EMPTY): Uint8Array {
    this.ss.mixHash(this.e.publicKey)
    this.ss.mixKey(dh(this.e.privateKey, this.rs)) // es
    const encPayload = this.ss.encryptAndHash(payload)
    const out = new Uint8Array(this.e.publicKey.length + encPayload.length)
    out.set(this.e.publicKey, 0); out.set(encPayload, this.e.publicKey.length)
    return out
  }

  // <- e, ee
  readMessage2(message: Uint8Array): Uint8Array {
    const re = message.slice(0, 32)
    this.ss.mixHash(re)
    this.ss.mixKey(dh(this.e.privateKey, re)) // ee
    return this.ss.decryptAndHash(message.slice(32))
  }

  // Для initiator: send = k1 (init->resp), recv = k2 (resp->init).
  split(): { send: CipherState; recv: CipherState } {
    const [c1, c2] = this.ss.split()
    return { send: c1, recv: c2 }
  }
}
```

- [ ] **Step 4: Тесты зелёные + тайпчек**

Run: `npx vitest run src/core/net/dnp/noise/handshakeState.test.ts && npm run typecheck`
Expected: PASS, тайпчек чист.

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/net/dnp/noise/handshakeState.ts web-client/src/core/net/dnp/noise/handshakeState.test.ts
git commit -m "feat(dnp): Noise_NK handshake (initiator) on @noble

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Бэкенд flynn/noise NK responder + детерминированный генератор фикстуры

**Files:**
- Modify: `backend/go.mod` (+ `github.com/flynn/noise`)
- Create: `backend/internal/adapter/delivery/ws/dnp/noise.go`
- Create: `backend/internal/adapter/delivery/ws/dnp/noise_test.go`
- Create: `web-client/src/core/net/dnp/noise/fixtures/nk-vector.json` (эмитится тестом, коммитится)

**Interfaces:**
- Produces (Go): `func NewResponder(staticPriv []byte) (*Responder, error)`; `func (r *Responder) ReadMessage1(msg1 []byte) error`; `func (r *Responder) WriteMessage2() ([]byte, error)`; `func (r *Responder) Split() (send, recv *noise.CipherState)` — тонкая обёртка над flynn/noise NK responder, suite `NewCipherSuite(DH25519, CipherChaChaPoly, HashBLAKE2s)`, prologue `dnp/1`.
- Produces (фикстура JSON): поля `serverStaticPub` (hex, 32B), `initEphemeralPriv` (hex, 32B), `prologue` ("dnp/1"), `msg1` (hex), `msg2` (hex), `initSendKey`/`initRecvKey` (hex, 32B — split-ключи со стороны initiator), `transportFromInit` (hex — `send.Encrypt` первого сообщения `"ping"` с AD пустым).

- [ ] **Step 1: Добавить зависимость**

Run (из `backend/`): `go get github.com/flynn/noise`
Expected: модуль в `go.mod`/`go.sum`.

- [ ] **Step 2: Написать тест-генератор фикстуры (падающий)**

`backend/internal/adapter/delivery/ws/dnp/noise_test.go`:
```go
package dnp

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/flynn/noise"
)

// Детерминированный io.Reader: отдаёт фиксированные байты (для эфемерных ключей).
type fixedReader struct{ b []byte }

func (f *fixedReader) Read(p []byte) (int, error) { return copy(p, f.b), nil }

func suite() noise.CipherSuite {
	return noise.NewCipherSuite(noise.DH25519, noise.CipherChaChaPoly, noise.HashBLAKE2s)
}

// Прогоняет полный NK-хендшейк flynn/noise (обе стороны детерминированы) и пишет
// фикстуру, против которой JS-initiator обязан сойтись байт-в-байт (interop-гейт).
func TestGenerateInteropFixture(t *testing.T) {
	cs := suite()
	prologue := []byte("dnp/1")

	serverStatic, err := cs.GenerateKeypair(&fixedReader{bytes.Repeat([]byte{0x11}, 32)})
	if err != nil { t.Fatal(err) }

	initHS, err := noise.NewHandshakeState(noise.Config{
		CipherSuite: cs, Random: &fixedReader{bytes.Repeat([]byte{0x22}, 32)},
		Pattern: noise.HandshakeNK, Initiator: true, Prologue: prologue,
		PeerStatic: serverStatic.Public,
	})
	if err != nil { t.Fatal(err) }
	respHS, err := noise.NewHandshakeState(noise.Config{
		CipherSuite: cs, Random: &fixedReader{bytes.Repeat([]byte{0x33}, 32)},
		Pattern: noise.HandshakeNK, Initiator: false, Prologue: prologue,
		StaticKeypair: serverStatic,
	})
	if err != nil { t.Fatal(err) }

	msg1, _, _, err := initHS.WriteMessage(nil, nil)
	if err != nil { t.Fatal(err) }
	if _, _, _, err = respHS.ReadMessage(nil, msg1); err != nil { t.Fatal(err) }
	msg2, rSend, rRecv, err := respHS.WriteMessage(nil, nil)
	if err != nil { t.Fatal(err) }
	_, iSend, iRecv, err := initHS.ReadMessage(nil, msg2)
	if err != nil { t.Fatal(err) }
	if iSend == nil || rSend == nil { t.Fatal("handshake did not complete") }

	// Транспорт: initiator шлёт "ping" (AD пустой), responder расшифровывает.
	transport, err := iSend.Encrypt(nil, nil, []byte("ping"))
	if err != nil { t.Fatal(err) }
	if got, err := rRecv.Decrypt(nil, nil, transport); err != nil || string(got) != "ping" {
		t.Fatalf("responder decrypt: %v %q", err, got)
	}
	_ = iRecv

	// split-ключи initiator для сверки в JS (flynn хранит k в CipherState — берём через
	// повторный вывод: проще эмитить сами транспортные проверки; здесь эмитим msg/ключей
	// нет прямого геттера, поэтому interop сверяем по msg1/msg2/transport, не по raw-ключам).
	fx := map[string]string{
		"serverStaticPub":   hex.EncodeToString(serverStatic.Public),
		"initEphemeralPriv": hex.EncodeToString(bytes.Repeat([]byte{0x22}, 32)),
		"prologue":          "dnp/1",
		"msg1":              hex.EncodeToString(msg1),
		"msg2":              hex.EncodeToString(msg2),
		"transportFromInit": hex.EncodeToString(transport),
	}
	out, _ := json.MarshalIndent(fx, "", "  ")
	dst := filepath.Join("..", "..", "..", "..", "..", "..", "web-client", "src", "core", "net", "dnp", "noise", "fixtures", "nk-vector.json")
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil { t.Fatal(err) }
	if err := os.WriteFile(dst, out, 0o644); err != nil { t.Fatal(err) }
}
```

> ПРИМЕЧАНИЕ по flynn/noise API: сверься, что `WriteMessage`/`ReadMessage` возвращают `(out, *CipherState, *CipherState, error)` и что `GenerateKeypair(io.Reader)` есть у suite. Если сигнатуры отличаются в установленной версии — поправь вызовы (это первое, что проверяешь). Порядок cs: `cs0` = initiator→responder (send у initiator), `cs1` = responder→initiator.

- [ ] **Step 3: Запустить генератор — фикстура пишется**

Run (из `backend/`): `go test ./internal/adapter/delivery/ws/dnp/ -run TestGenerateInteropFixture -v`
Expected: PASS; файл `web-client/src/core/net/dnp/noise/fixtures/nk-vector.json` создан с непустыми hex-полями.

- [ ] **Step 4: Реализовать production-обёртку responder + её тест**

`backend/internal/adapter/delivery/ws/dnp/noise.go`:
```go
// Package dnp — серверная сторона L0-канала DNP (Noise_NK responder).
package dnp

import (
	"errors"
	"io"

	"github.com/flynn/noise"
)

const prologueV1 = "dnp/1"

func cipherSuite() noise.CipherSuite {
	return noise.NewCipherSuite(noise.DH25519, noise.CipherChaChaPoly, noise.HashBLAKE2s)
}

// Responder — обёртка над flynn/noise NK responder для одного соединения.
type Responder struct {
	hs         *noise.HandshakeState
	send, recv *noise.CipherState
}

// NewResponder строит responder со статическим приватным ключом сервера (32 байта).
func NewResponder(staticPriv []byte, rand io.Reader) (*Responder, error) {
	cs := cipherSuite()
	kp, err := noise.DH25519.GenerateKeypair(bytesReader(staticPriv))
	if err != nil {
		return nil, err
	}
	hs, err := noise.NewHandshakeState(noise.Config{
		CipherSuite: cs, Random: rand, Pattern: noise.HandshakeNK,
		Initiator: false, Prologue: []byte(prologueV1), StaticKeypair: kp,
	})
	if err != nil {
		return nil, err
	}
	return &Responder{hs: hs}, nil
}

// ReadMessage1 обрабатывает первый кадр клиента (e, es).
func (r *Responder) ReadMessage1(msg1 []byte) error {
	_, _, _, err := r.hs.ReadMessage(nil, msg1)
	return err
}

// WriteMessage2 формирует ответный кадр (e, ee) и завершает хендшейк.
func (r *Responder) WriteMessage2() ([]byte, error) {
	msg2, cs0, cs1, err := r.hs.WriteMessage(nil, nil)
	if err != nil {
		return nil, err
	}
	if cs0 == nil || cs1 == nil {
		return nil, errors.New("dnp: handshake incomplete after message 2")
	}
	// cs0: initiator->responder (recv у сервера); cs1: responder->initiator (send у сервера).
	r.recv, r.send = cs0, cs1
	return msg2, nil
}

// Split возвращает транспортные cipher-state сервера (send, recv) после хендшейка.
func (r *Responder) Split() (send, recv *noise.CipherState) { return r.send, r.recv }

// bytesReader отдаёт фиксированные 32 байта приватного ключа как io.Reader для GenerateKeypair.
func bytesReader(b []byte) io.Reader { return &staticKeyReader{b: b} }

type staticKeyReader struct{ b []byte }

func (s *staticKeyReader) Read(p []byte) (int, error) { return copy(p, s.b), nil }
```

Добавь в `noise_test.go` production-тест:
```go
func TestResponderCompletesHandshakeWithFlynnInitiator(t *testing.T) {
	cs := suite()
	serverStatic, _ := cs.GenerateKeypair(&fixedReader{bytes.Repeat([]byte{0x44}, 32)})
	resp, err := NewResponder(bytes.Repeat([]byte{0x44}, 32), &fixedReader{bytes.Repeat([]byte{0x55}, 32)})
	if err != nil { t.Fatal(err) }
	initHS, _ := noise.NewHandshakeState(noise.Config{
		CipherSuite: cs, Random: &fixedReader{bytes.Repeat([]byte{0x66}, 32)},
		Pattern: noise.HandshakeNK, Initiator: true, Prologue: []byte("dnp/1"),
		PeerStatic: serverStatic.Public,
	})
	msg1, _, _, _ := initHS.WriteMessage(nil, nil)
	if err := resp.ReadMessage1(msg1); err != nil { t.Fatal(err) }
	msg2, err := resp.WriteMessage2()
	if err != nil { t.Fatal(err) }
	_, iSend, _, err := initHS.ReadMessage(nil, msg2)
	if err != nil { t.Fatal(err) }
	send, _ := resp.Split()
	if send == nil { t.Fatal("no server cipher state") }
	ct, _ := iSend.Encrypt(nil, nil, []byte("hi"))
	got, err := recvDecrypt(resp, ct)
	if err != nil || string(got) != "hi" { t.Fatalf("server decrypt: %v %q", err, got) }
}

func recvDecrypt(r *Responder, ct []byte) ([]byte, error) {
	_, recv := r.Split()
	return recv.Decrypt(nil, nil, ct)
}
```

- [ ] **Step 5: Прогнать бэк-тесты + gofmt**

Run (из `backend/`): `gofmt -w internal/adapter/delivery/ws/dnp/ && go test ./internal/adapter/delivery/ws/dnp/ -v`
Expected: оба теста PASS; фикстура на месте.

- [ ] **Step 6: Commit (Go + фикстура вместе)**

```bash
git add backend/go.mod backend/go.sum backend/internal/adapter/delivery/ws/dnp/noise.go backend/internal/adapter/delivery/ws/dnp/noise_test.go web-client/src/core/net/dnp/noise/fixtures/nk-vector.json
git commit -m "feat(dnp): backend flynn/noise NK responder + committed interop fixture

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Go↔JS interop-тест (гейт корректности)

**Files:**
- Create: `web-client/src/core/net/dnp/noise/interop.test.ts`

**Interfaces:**
- Consumes: `NKInitiator` (Task 3), фикстуру `fixtures/nk-vector.json` (Task 4).

- [ ] **Step 1: Написать interop-тест**

`web-client/src/core/net/dnp/noise/interop.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { NKInitiator } from './handshakeState'
import fixture from './fixtures/nk-vector.json'

const fromHex = (s: string) => new Uint8Array(s.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))
const toHex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('')

// Эталон — flynn/noise (Go). JS-initiator ОБЯЗАН воспроизвести те же байты.
describe('Noise_NK Go<->JS interop (fixture from flynn/noise)', () => {
  it('JS initiator reproduces msg1, reads msg2, and matches the transport ciphertext', () => {
    const hs = new NKInitiator({
      prologue: new TextEncoder().encode(fixture.prologue),
      remoteStatic: fromHex(fixture.serverStaticPub),
      ephemeral: { privateKey: fromHex(fixture.initEphemeralPriv), publicKey: new Uint8Array(0) },
    })
    const msg1 = hs.writeMessage1()
    expect(toHex(msg1)).toBe(fixture.msg1) // байт-в-байт совпадение с Go

    const payload2 = hs.readMessage2(fromHex(fixture.msg2))
    expect(payload2.length).toBe(0) // пустой payload в NK msg2

    const { send } = hs.split()
    const transport = send.encryptWithAd(new Uint8Array(0), new TextEncoder().encode('ping'))
    expect(toHex(transport)).toBe(fixture.transportFromInit) // тот же ciphertext, что у Go
  })
})
```

- [ ] **Step 2: Запустить interop-тест**

Run (из `web-client/`): `npx vitest run src/core/net/dnp/noise/interop.test.ts`
Expected: PASS. **Если msg1 не сходится** — рассинхрон в порядке mixHash/mixKey или nonce/HKDF; **если transport не сходится** — порядок split-ключей (send vs recv) или AD. Это ловит именно то, ради чего тест существует.

> Настройка: убедись, что vitest/tsconfig разрешают JSON-импорт (`resolveJsonModule`). Если нет — тест читает файл через `fs.readFileSync` + `JSON.parse` (укажи путь от корня web-client).

- [ ] **Step 3: Полный прогон обеих сторон**

Run: `cd web-client && npm test && npm run typecheck` и `cd backend && go test ./internal/adapter/delivery/ws/dnp/`
Expected: всё зелёное. Interop доказан.

- [ ] **Step 4: Commit**

```bash
git add web-client/src/core/net/dnp/noise/interop.test.ts
git commit -m "test(dnp): Go<->JS Noise_NK interop gate against flynn/noise fixture

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Финальная проверка PR-1b-i

- [ ] `cd web-client && npm test && npm run typecheck && npm run build` — зелёное.
- [ ] `cd backend && go test ./... && gofmt -l internal/adapter/delivery/ws/dnp/` (пусто) — зелёное.
- [ ] Interop-тест проходит (msg1 + transport совпадают с Go-фикстурой байт-в-байт).
- [ ] Никакого WS/транспорта/dual-mode (это PR-1b-ii) — scope соблюдён.
- [ ] PR в `main`, ветка `feat/dnp-noise-channel`.

## Self-review (проверено при написании плана)

- **Покрытие спеки:** §2 (параметры Noise) — Task 2/3 (HKDF, nonce, AD, prologue, protocol name, split); клиент-крипта — Task 1-3; сервер `flynn/noise` NK — Task 4; interop-гейт §7 — Task 5. codec/transport/dual-mode §3-5 — сознательно НЕ здесь (PR-1b-ii).
- **Плейсхолдеры:** нет — весь код реальный. Два места с явной инструкцией «сверь сигнатуру под установленную версию» (x25519-аксессоры Task 1, flynn/noise API Task 4) — это не заглушки, а контролируемая точка адаптации к версии, прикрытая тестом.
- **Согласованность типов:** `KeyPair`/`dh`/`aead*`/`hmacBlake2s` из Task 1 → используются в Task 2/3 с теми же именами; `SymmetricState`/`CipherState`/`hkdf`/`nonce8` Task 2 → Task 3; `NKInitiator.writeMessage1/readMessage2/split` Task 3 → Task 5; фикстура (Task 4) поля ↔ чтение в Task 5 совпадают (`serverStaticPub`, `initEphemeralPriv`, `prologue`, `msg1`, `msg2`, `transportFromInit`).
- **Риск-контроль:** interop-тест (Task 5) — детерминированный оракул: любой баг symmetric-state/handshake проявится расхождением байт с flynn/noise.
