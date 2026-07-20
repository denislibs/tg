# Секретные чаты (E2E) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить end-to-end зашифрованные секретные чаты 1-на-1 (текст + медиа) с device-local ключами, self-destruct таймером, верификацией по fingerprint и запретом пересылки.

**Architecture:** Обмен ключами ECDH P-256 через сервер (только публичные ключи), общий секрет → HKDF → non-extractable AES-256-GCM в IndexedDB браузера. Сообщения шифруются/дешифруются целиком на клиенте; сервер хранит непрозрачный блоб `enc_body` и никогда не видит plaintext. Handshake и доставка — через существующий WS `{t,d}` → `realtimeBridge`.

**Tech Stack:** Go 1.25 (chi, pgx, goose, uber/fx, gorilla/websocket), React 18 + TS strict + Zustand, WebCrypto (`crypto.subtle`), IndexedDB, vitest + fake-indexeddb.

**Референсные точки проекта (изучить перед стартом):**
- Прецедент «доп-колонка в messages через jsonb»: `backend/internal/store/postgres/migrations/0039_geo_live_venue.sql`, `messagesrepo.go` (`geoMetaParam`, `messageCols`).
- Прецедент опционального usecase-репозитория: `chat.go` — паттерн `SetTranslator/SetTopics`.
- Прецедент WS-кадров: `ws/conn.go` case-switch (`call_request`… `group_call_join`…).
- Прецедент realtime-подписки: `src/client/realtimeBridge.ts` (`smp.on(RT.geoLiveUpdate…)`).
- Прецедент менеджера/стора фичи: `src/stores/liveShareStore.ts`, `src/core/managers/messagesManager.ts`.

**Инвариант безопасности (держать во всех задачах):** расшифрованный контент рендерится только React-нодами (`RichText`/`CodeBlock`), никогда как raw-HTML. Приватные и AES-ключи — non-extractable, никогда не сериализуются в байты и не уходят на сервер.

---

## Фаза 1 — Крипто-ядро (frontend, чистые функции, TDD)

Начинаем с крипто-ядра: оно чистое, полностью юнит-тестируемо и от него зависит всё остальное. vitest бежит в node — там доступен `globalThis.crypto.subtle` (Node ≥ 20). Для IndexedDB-теста используем `fake-indexeddb`.

### Task 1: ECDH-обмен, вывод AES-ключа и fingerprint

**Files:**
- Create: `telegram-ui-clone/src/core/secret/crypto.ts`
- Test: `telegram-ui-clone/src/core/secret/crypto.test.ts`

- [ ] **Step 1: Написать падающий тест обмена ключами**

```ts
// crypto.test.ts
import { describe, it, expect } from 'vitest'
import { generateKeyPair, exportPublicKey, deriveSecret } from './crypto'

describe('secret/crypto ECDH', () => {
  it('обе стороны выводят одинаковый ключ и fingerprint', async () => {
    const a = await generateKeyPair()
    const b = await generateKeyPair()
    const aPub = await exportPublicKey(a.publicKey)
    const bPub = await exportPublicKey(b.publicKey)

    const sa = await deriveSecret(a.privateKey, bPub)
    const sb = await deriveSecret(b.privateKey, aPub)

    // fingerprint детерминированный и совпадает у обеих сторон
    expect(Array.from(sa.fingerprint)).toEqual(Array.from(sb.fingerprint))
    expect(sa.fingerprint.length).toBe(32)
    // ключ шифрования взаимозаменяем: A шифрует — B расшифровывает
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sa.key, new TextEncoder().encode('hi'))
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sb.key, ct)
    expect(new TextDecoder().decode(pt)).toBe('hi')
  })
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd telegram-ui-clone && npx vitest run src/core/secret/crypto.test.ts`
Expected: FAIL — `generateKeyPair is not a function` / module not found.

- [ ] **Step 3: Реализовать crypto.ts (обмен + вывод)**

```ts
// crypto.ts — WebCrypto-обёртки для секретных чатов.
// ECDH P-256 → HKDF-SHA256 → non-extractable AES-256-GCM. Ключи не экспортируемы.
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const

export interface DerivedSecret {
  key: CryptoKey // AES-256-GCM, non-extractable
  fingerprint: Uint8Array // SHA-256(sharedBits), 32 байта — для верификации
}

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ECDH, false /* extractable=false для private */, ['deriveBits', 'deriveKey'])
}

// Публичный ключ экспортируем в raw (65 байт для P-256) — только он уходит на сервер.
export async function exportPublicKey(pub: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', pub))
}

async function importPublicKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, ECDH, false, [])
}

export async function deriveSecret(priv: CryptoKey, peerPubRaw: Uint8Array): Promise<DerivedSecret> {
  const peerPub = await importPublicKey(peerPubRaw)
  // Сырые биты общего секрета (P-256 → 256 бит) — для HKDF и fingerprint.
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peerPub }, priv, 256))
  const fingerprint = new Uint8Array(await crypto.subtle.digest('SHA-256', bits))
  // HKDF из сырых бит → non-extractable AES-GCM.
  const hkdfKey = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('secret-chat-v1') },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false /* non-extractable */,
    ['encrypt', 'decrypt'],
  )
  bits.fill(0) // обнуляем сырой секрет
  return { key, fingerprint }
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `cd telegram-ui-clone && npx vitest run src/core/secret/crypto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add telegram-ui-clone/src/core/secret/crypto.ts telegram-ui-clone/src/core/secret/crypto.test.ts
git commit -m "feat(secret): ECDH key exchange + AES key derivation"
```

### Task 2: Шифрование/дешифровка payload сообщения

**Files:**
- Modify: `telegram-ui-clone/src/core/secret/crypto.ts`
- Test: `telegram-ui-clone/src/core/secret/crypto.test.ts`

- [ ] **Step 1: Написать падающий тест round-trip**

```ts
// добавить в crypto.test.ts
import { generateKeyPair, exportPublicKey, deriveSecret, encryptPayload, decryptPayload } from './crypto'

it('encryptPayload → decryptPayload round-trip', async () => {
  const a = await generateKeyPair(); const b = await generateKeyPair()
  const sa = await deriveSecret(a.privateKey, await exportPublicKey(b.publicKey))
  const sb = await deriveSecret(b.privateKey, await exportPublicKey(a.publicKey))
  const payload = { text: 'привет 🔒', entities: [{ type: 'bold', offset: 0, length: 6 }] }
  const blob = await encryptPayload(sa.key, payload)
  expect(typeof blob).toBe('string') // base64
  const out = await decryptPayload<typeof payload>(sb.key, blob)
  expect(out).toEqual(payload)
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd telegram-ui-clone && npx vitest run src/core/secret/crypto.test.ts`
Expected: FAIL — `encryptPayload is not a function`.

- [ ] **Step 3: Реализовать encryptPayload/decryptPayload**

```ts
// добавить в crypto.ts
function b64encode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Блоб = iv(12) || ciphertext, в base64. IV случайный на каждое сообщение.
export async function encryptPayload(key: CryptoKey, payload: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(JSON.stringify(payload))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data))
  const blob = new Uint8Array(iv.length + ct.length)
  blob.set(iv, 0); blob.set(ct, iv.length)
  return b64encode(blob)
}

export async function decryptPayload<T>(key: CryptoKey, blob: string): Promise<T> {
  const raw = b64decode(blob)
  const iv = raw.subarray(0, 12)
  const ct = raw.subarray(12)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return JSON.parse(new TextDecoder().decode(pt)) as T
}
```

- [ ] **Step 4: Запустить — PASS**

Run: `cd telegram-ui-clone && npx vitest run src/core/secret/crypto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add telegram-ui-clone/src/core/secret/crypto.ts telegram-ui-clone/src/core/secret/crypto.test.ts
git commit -m "feat(secret): AES-GCM message payload encrypt/decrypt"
```

### Task 3: Шифрование/дешифровка медиа (per-file ключ)

**Files:**
- Modify: `telegram-ui-clone/src/core/secret/crypto.ts`
- Test: `telegram-ui-clone/src/core/secret/crypto.test.ts`

- [ ] **Step 1: Написать падающий тест round-trip медиа**

```ts
// добавить в crypto.test.ts
import { encryptMedia, decryptMedia } from './crypto'

it('encryptMedia → decryptMedia round-trip с per-file ключом', async () => {
  const bytes = crypto.getRandomValues(new Uint8Array(4096))
  const { cipher, keyB64, ivB64 } = await encryptMedia(bytes)
  expect(cipher.byteLength).toBeGreaterThan(0)
  const out = await decryptMedia(cipher, keyB64, ivB64)
  expect(Array.from(new Uint8Array(out))).toEqual(Array.from(bytes))
})
```

- [ ] **Step 2: Запустить — FAIL** (`encryptMedia is not a function`).

Run: `cd telegram-ui-clone && npx vitest run src/core/secret/crypto.test.ts`

- [ ] **Step 3: Реализовать encryptMedia/decryptMedia**

```ts
// добавить в crypto.ts
// У каждого файла свой случайный AES-ключ (extractable — чтобы положить его
// в зашифрованный payload сообщения). Ключ+IV сами шифруются ключом чата,
// поэтому extractable здесь безопасно.
export async function encryptMedia(bytes: Uint8Array): Promise<{ cipher: ArrayBuffer; keyB64: string; ivB64: string }> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key))
  return { cipher, keyB64: b64encode(rawKey), ivB64: b64encode(iv) }
}

export async function decryptMedia(cipher: ArrayBuffer, keyB64: string, ivB64: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', b64decode(keyB64), { name: 'AES-GCM' }, false, ['decrypt'])
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(ivB64) }, key, cipher)
}
```

- [ ] **Step 4: Запустить — PASS.**

Run: `cd telegram-ui-clone && npx vitest run src/core/secret/crypto.test.ts`

- [ ] **Step 5: Commit**

```bash
git add telegram-ui-clone/src/core/secret/crypto.ts telegram-ui-clone/src/core/secret/crypto.test.ts
git commit -m "feat(secret): per-file media encrypt/decrypt"
```

### Task 4: Fingerprint → emoji-SAS для верификации

**Files:**
- Create: `telegram-ui-clone/src/core/secret/fingerprint.ts`
- Test: `telegram-ui-clone/src/core/secret/fingerprint.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// fingerprint.test.ts
import { describe, it, expect } from 'vitest'
import { fingerprintEmoji } from './fingerprint'

describe('fingerprintEmoji', () => {
  it('детерминирован и даёт 12 эмодзи', () => {
    const fp = new Uint8Array(32).map((_, i) => i) // 0..31
    const a = fingerprintEmoji(fp)
    const b = fingerprintEmoji(fp)
    expect(a).toEqual(b)
    expect(a).toHaveLength(12)
  })
  it('разный fingerprint → разный результат', () => {
    const x = fingerprintEmoji(new Uint8Array(32).fill(1))
    const y = fingerprintEmoji(new Uint8Array(32).fill(2))
    expect(x).not.toEqual(y)
  })
})
```

- [ ] **Step 2: Запустить — FAIL.**

Run: `cd telegram-ui-clone && npx vitest run src/core/secret/fingerprint.test.ts`

- [ ] **Step 3: Реализовать fingerprint.ts**

```ts
// fingerprint.ts — визуализация ключа как последовательности эмодзи (SAS).
// Берём по одному байту (12 из 32) как индекс в фиксированном алфавите эмодзи.
// Обе стороны выводят одинаковый fingerprint → одинаковую цепочку.
const EMOJI = [
  '😀','😎','🤖','👽','🐶','🐱','🦊','🐻','🐼','🐨','🦁','🐯','🦄','🐷','🐸','🐵',
  '🍎','🍊','🍋','🍉','🍇','🍓','🍒','🍑','🥝','🍍','🥥','🥑','🍅','🌽','🥕','🌶️',
  '⚽','🏀','🏈','⚾','🎾','🏐','🎱','🎯','🚗','✈️','🚀','⛵','🏰','⛺','🌋','🗿',
  '⭐','🌙','☀️','⚡','🔥','❄️','🌈','💧','🎈','🎁','🔑','🔒','💡','📷','🎸','🎺',
]

export function fingerprintEmoji(fp: Uint8Array): string[] {
  const out: string[] = []
  for (let i = 0; i < 12; i++) out.push(EMOJI[fp[i] % EMOJI.length])
  return out
}
```

- [ ] **Step 4: Запустить — PASS.**

Run: `cd telegram-ui-clone && npx vitest run src/core/secret/fingerprint.test.ts`

- [ ] **Step 5: Commit**

```bash
git add telegram-ui-clone/src/core/secret/fingerprint.ts telegram-ui-clone/src/core/secret/fingerprint.test.ts
git commit -m "feat(secret): key fingerprint → emoji SAS"
```

### Task 5: IndexedDB-хранилище ключей

**Files:**
- Create: `telegram-ui-clone/src/core/secret/keyStore.ts`
- Test: `telegram-ui-clone/src/core/secret/keyStore.test.ts`
- Modify: `telegram-ui-clone/package.json` (devDependency `fake-indexeddb`)

- [ ] **Step 1: Установить fake-indexeddb**

Run: `cd telegram-ui-clone && npm i -D fake-indexeddb`
Expected: пакет добавлен в devDependencies.

- [ ] **Step 2: Написать падающий тест**

```ts
// keyStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { generateKeyPair, exportPublicKey, deriveSecret } from './crypto'
import { saveKey, loadKey, deleteKey } from './keyStore'

describe('secret keyStore', () => {
  it('сохраняет и читает CryptoKey + fingerprint по chatId', async () => {
    const a = await generateKeyPair(); const b = await generateKeyPair()
    const s = await deriveSecret(a.privateKey, await exportPublicKey(b.publicKey))
    await saveKey(42, { key: s.key, fingerprint: s.fingerprint })
    const loaded = await loadKey(42)
    expect(loaded).not.toBeNull()
    // ключ рабочий: шифруем и дешифруем
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, loaded!.key, new TextEncoder().encode('x'))
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, loaded!.key, ct)
    expect(new TextDecoder().decode(pt)).toBe('x')
    await deleteKey(42)
    expect(await loadKey(42)).toBeNull()
  })
})
```

- [ ] **Step 3: Запустить — FAIL.**

Run: `cd telegram-ui-clone && npx vitest run src/core/secret/keyStore.test.ts`

- [ ] **Step 4: Реализовать keyStore.ts**

```ts
// keyStore.ts — device-local хранилище ключей секретных чатов в IndexedDB.
// CryptoKey structured-clonable → хранится как есть, оставаясь non-extractable.
export interface StoredKey { key: CryptoKey; fingerprint: Uint8Array }

const DB = 'secret-chats'
const STORE = 'keys'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

export function saveKey(chatId: number, v: StoredKey): Promise<void> {
  return tx('readwrite', (s) => s.put(v, chatId)).then(() => undefined)
}
export async function loadKey(chatId: number): Promise<StoredKey | null> {
  return (await tx<StoredKey | undefined>('readonly', (s) => s.get(chatId))) ?? null
}
export function deleteKey(chatId: number): Promise<void> {
  return tx('readwrite', (s) => s.delete(chatId)).then(() => undefined)
}
```

- [ ] **Step 5: Запустить — PASS.**

Run: `cd telegram-ui-clone && npx vitest run src/core/secret/keyStore.test.ts`

- [ ] **Step 6: Commit**

```bash
git add telegram-ui-clone/src/core/secret/keyStore.ts telegram-ui-clone/src/core/secret/keyStore.test.ts telegram-ui-clone/package.json telegram-ui-clone/package-lock.json
git commit -m "feat(secret): IndexedDB device-local key store"
```

---

## Фаза 2 — Бэкенд: модель данных, handshake, хранение шифртекста

### Task 6: Миграция — secret_chats + enc-колонки в messages

**Files:**
- Create: `backend/internal/store/postgres/migrations/0040_secret_chats.sql`

- [ ] **Step 1: Написать миграцию**

```sql
-- +goose Up
-- Секретные чаты (E2E, device-local). Чат — обычная строка chats(type='secret')
-- между двумя юзерами; здесь хранится handshake (только публичные ключи) и
-- состояние. Сервер НИКОГДА не видит приватные ключи и plaintext.
CREATE TABLE secret_chats (
    chat_id       BIGINT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
    initiator_id  BIGINT NOT NULL,
    responder_id  BIGINT NOT NULL,
    initiator_pub BYTEA NOT NULL,
    responder_pub BYTEA,
    state         TEXT NOT NULL DEFAULT 'requested', -- requested|accepted|rejected|discarded
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Шифртекст сообщения секретного чата (тип 'encrypted'): iv||ciphertext, blob.
-- text/entities у таких сообщений пустые. TTL self-destruct: ttl_seconds задаётся
-- отправителем, destruct_at выставляется на сервере при прочтении получателем.
ALTER TABLE messages ADD COLUMN enc_body    BYTEA;
ALTER TABLE messages ADD COLUMN ttl_seconds INT;
ALTER TABLE messages ADD COLUMN destruct_at TIMESTAMPTZ;
CREATE INDEX messages_destruct_idx ON messages (destruct_at) WHERE destruct_at IS NOT NULL;

-- +goose Down
DROP INDEX messages_destruct_idx;
ALTER TABLE messages DROP COLUMN destruct_at;
ALTER TABLE messages DROP COLUMN ttl_seconds;
ALTER TABLE messages DROP COLUMN enc_body;
DROP TABLE secret_chats;
```

- [ ] **Step 2: Применить и проверить (goose авто-применяет на старте)**

Run: `cd backend && go build ./... && docker compose -p msgrverify -f ../docker-compose.verify.yml up -d --build backend`
Затем проверить лог: `docker compose -p msgrverify -f ../docker-compose.verify.yml logs backend | grep -i "0040\|goose\|migrat"`
Expected: миграция 0040 применена без ошибок.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/store/postgres/migrations/0040_secret_chats.sql
git commit -m "feat(secret): migration — secret_chats + enc_body/ttl columns"
```

### Task 7: Доменные типы секретного чата

**Files:**
- Modify: `backend/internal/domain/chat.go` (комментарий типа Type)
- Create: `backend/internal/domain/secret.go`
- Modify: `backend/internal/domain/message.go` (поля enc)

- [ ] **Step 1: Обновить комментарий Chat.Type**

В `domain/chat.go` заменить строку:
```go
	Type    string // private | group | channel | saved
```
на:
```go
	Type    string // private | group | channel | saved | secret
```

- [ ] **Step 2: Создать domain/secret.go**

```go
package domain

import "time"

// SecretChatState — стадия E2E-handshake.
const (
	SecretRequested = "requested"
	SecretAccepted  = "accepted"
	SecretRejected  = "rejected"
	SecretDiscarded = "discarded"
)

// SecretChat хранит handshake секретного чата: сервер видит ТОЛЬКО публичные
// ключи участников и статус, но никогда не приватные ключи и не plaintext.
type SecretChat struct {
	ChatID       int64
	InitiatorID  int64
	ResponderID  int64
	InitiatorPub []byte
	ResponderPub []byte // nil до accept
	State        string
	CreatedAt    time.Time
}
```

- [ ] **Step 3: Добавить enc-поля в domain/message.go**

В `type Message struct` (перед `SenderName`) добавить:
```go
	// E2E-шифртекст сообщения типа 'encrypted' (iv||ciphertext). Text/Entities
	// у таких сообщений пустые — сервер хранит блоб непрозрачно.
	EncBody []byte
	// Self-destruct: TTLSeconds задаёт отправитель; DestructAt сервер ставит при
	// прочтении получателем (now + ttl), затем reaper сносит блоб.
	TTLSeconds *int
	DestructAt *time.Time
```

- [ ] **Step 4: Собрать**

Run: `cd backend && go build ./...`
Expected: компилируется.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/domain/secret.go backend/internal/domain/chat.go backend/internal/domain/message.go
git commit -m "feat(secret): domain types for secret chats + enc message fields"
```

### Task 8: Postgres-репозиторий secret_chats

**Files:**
- Create: `backend/internal/adapter/repo/postgres/secretrepo.go`
- Test: `backend/internal/adapter/repo/postgres/secretrepo_test.go` (интеграционный — только если в проекте уже есть pg-тесты; иначе покрытие через usecase-фейк в Task 9)

- [ ] **Step 1: Реализовать репозиторий**

```go
package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"<module>/internal/domain" // взять реальный module path из go.mod
)

type SecretRepo struct{ db Querier } // Querier — тот же интерфейс пула, что и в остальных репо этого пакета

func NewSecretRepo(db Querier) *SecretRepo { return &SecretRepo{db: db} }

func (r *SecretRepo) Create(ctx context.Context, sc domain.SecretChat) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO secret_chats (chat_id, initiator_id, responder_id, initiator_pub, state)
		 VALUES ($1,$2,$3,$4,'requested')`,
		sc.ChatID, sc.InitiatorID, sc.ResponderID, sc.InitiatorPub)
	return err
}

func (r *SecretRepo) Accept(ctx context.Context, chatID int64, responderPub []byte) error {
	_, err := r.db.Exec(ctx,
		`UPDATE secret_chats SET responder_pub=$2, state='accepted' WHERE chat_id=$1 AND state='requested'`,
		chatID, responderPub)
	return err
}

func (r *SecretRepo) SetState(ctx context.Context, chatID int64, state string) error {
	_, err := r.db.Exec(ctx, `UPDATE secret_chats SET state=$2 WHERE chat_id=$1`, chatID, state)
	return err
}

func (r *SecretRepo) Get(ctx context.Context, chatID int64) (domain.SecretChat, error) {
	var sc domain.SecretChat
	err := r.db.QueryRow(ctx,
		`SELECT chat_id, initiator_id, responder_id, initiator_pub, responder_pub, state, created_at
		 FROM secret_chats WHERE chat_id=$1`, chatID).
		Scan(&sc.ChatID, &sc.InitiatorID, &sc.ResponderID, &sc.InitiatorPub, &sc.ResponderPub, &sc.State, &sc.CreatedAt)
	if err == pgx.ErrNoRows {
		return domain.SecretChat{}, domain.ErrNotFound
	}
	return sc, err
}
```

> **Замечание для исполнителя:** точный тип `Querier`/поле `db` возьми из соседнего репо (напр. `contactsrepo.go` или `messagesrepo.go`) — используй тот же паттерн конструктора и тип пула, что уже в пакете. Модульный путь импорта — из `backend/go.mod`.

- [ ] **Step 2: Собрать**

Run: `cd backend && go build ./...`
Expected: компилируется.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/adapter/repo/postgres/secretrepo.go
git commit -m "feat(secret): postgres secret_chats repository"
```

### Task 9: Usecase — handshake секретного чата

**Files:**
- Create: `backend/internal/usecase/chat/secret.go`
- Modify: `backend/internal/usecase/chat/chat.go` (поле + Set-метод)
- Modify: `backend/internal/usecase/chat/ports.go` (порт SecretRepo)
- Test: `backend/internal/usecase/chat/secret_test.go`

- [ ] **Step 1: Добавить порт в ports.go**

```go
// SecretRepo хранит handshake секретных чатов (только публичные ключи + статус).
type SecretRepo interface {
	Create(ctx context.Context, sc domain.SecretChat) error
	Accept(ctx context.Context, chatID int64, responderPub []byte) error
	SetState(ctx context.Context, chatID int64, state string) error
	Get(ctx context.Context, chatID int64) (domain.SecretChat, error)
}
```

- [ ] **Step 2: Добавить поле + сеттер в chat.go**

Рядом с другими опциональными зависимостями добавить в `type Interactor struct` поле:
```go
	secret SecretRepo
```
и метод (рядом с `SetTranslator`):
```go
func (i *Interactor) SetSecret(s SecretRepo) { i.secret = s }
```

- [ ] **Step 3: Написать падающий тест стейт-машины**

```go
// secret_test.go
package chat

import (
	"context"
	"testing"

	"<module>/internal/domain"
)

func TestSecretHandshake(t *testing.T) {
	i, fakeSecret, fakeChats := newSecretTestInteractor(t) // хелпер: собери Interactor c фейками (см. существующие *_test.go)
	ctx := context.Background()

	// create: инициатор A шлёт pubA
	sc, err := i.CreateSecretChat(ctx, 1 /*A*/, 2 /*B*/, []byte("pubA"))
	if err != nil { t.Fatal(err) }
	if sc.State != domain.SecretRequested { t.Fatalf("state=%s", sc.State) }
	if fakeChats.lastType != "secret" { t.Fatalf("chat type=%s", fakeChats.lastType) }

	// accept: B шлёт pubB
	sc2, err := i.AcceptSecretChat(ctx, sc.ChatID, 2, []byte("pubB"))
	if err != nil { t.Fatal(err) }
	if sc2.State != domain.SecretAccepted { t.Fatalf("state=%s", sc2.State) }

	// чужой не может accept
	if _, err := i.AcceptSecretChat(ctx, sc.ChatID, 999, []byte("x")); err == nil {
		t.Fatal("expected error for non-responder accept")
	}
}
```

> Хелпер `newSecretTestInteractor` и фейки — по образцу существующих `chat/*_test.go` (`fakes_test.go`). Фейк `SecretRepo` держит одну запись в памяти; фейк `ChatRepo` уже есть — добавь запоминание типа создаваемого чата, если нужно (`lastType`).

- [ ] **Step 4: Запустить — FAIL.**

Run: `cd backend && go test ./internal/usecase/chat/ -run TestSecretHandshake`
Expected: FAIL — методы не определены.

- [ ] **Step 5: Реализовать secret.go**

```go
package chat

import (
	"context"

	"<module>/internal/domain"
)

// CreateSecretChat заводит чат type='secret' между userID и peerID и сохраняет
// публичный ключ инициатора. Возвращает созданный SecretChat в состоянии requested.
func (i *Interactor) CreateSecretChat(ctx context.Context, userID, peerID int64, initiatorPub []byte) (domain.SecretChat, error) {
	if i.secret == nil {
		return domain.SecretChat{}, domain.ErrUnavailable
	}
	if userID == peerID || len(initiatorPub) == 0 {
		return domain.SecretChat{}, domain.ErrInvalid
	}
	chatID, err := i.chats.CreateSecret(ctx, userID, peerID) // добавить в ChatRepo (Step 6)
	if err != nil {
		return domain.SecretChat{}, err
	}
	sc := domain.SecretChat{ChatID: chatID, InitiatorID: userID, ResponderID: peerID, InitiatorPub: initiatorPub, State: domain.SecretRequested}
	if err := i.secret.Create(ctx, sc); err != nil {
		return domain.SecretChat{}, err
	}
	i.publishSecretFrame(ctx, sc, "secret_chat_request")
	return sc, nil
}

func (i *Interactor) AcceptSecretChat(ctx context.Context, chatID, userID int64, responderPub []byte) (domain.SecretChat, error) {
	if i.secret == nil {
		return domain.SecretChat{}, domain.ErrUnavailable
	}
	sc, err := i.secret.Get(ctx, chatID)
	if err != nil {
		return domain.SecretChat{}, err
	}
	if sc.ResponderID != userID || sc.State != domain.SecretRequested {
		return domain.SecretChat{}, domain.ErrForbidden
	}
	if err := i.secret.Accept(ctx, chatID, responderPub); err != nil {
		return domain.SecretChat{}, err
	}
	sc.ResponderPub = responderPub
	sc.State = domain.SecretAccepted
	i.publishSecretFrame(ctx, sc, "secret_chat_accept")
	return sc, nil
}

func (i *Interactor) RejectSecretChat(ctx context.Context, chatID, userID int64) error {
	if i.secret == nil {
		return domain.ErrUnavailable
	}
	sc, err := i.secret.Get(ctx, chatID)
	if err != nil {
		return err
	}
	if sc.InitiatorID != userID && sc.ResponderID != userID {
		return domain.ErrForbidden
	}
	if err := i.secret.SetState(ctx, chatID, domain.SecretRejected); err != nil {
		return err
	}
	sc.State = domain.SecretRejected
	i.publishSecretFrame(ctx, sc, "secret_chat_reject")
	return nil
}
```

> `domain.ErrInvalid`/`ErrForbidden` — если таких нет, используй существующие эквиваленты из `domain/errors.go` (`ErrValidation`, `ErrPrivacy`/`ErrForbidden`). `publishSecretFrame` реализуется в Task 11 (пока можно объявить пустой метод-заглушку в этом же файле и заполнить в Task 11 — но заглушку НЕ коммитить как финал; проще реализовать сразу в Task 11 порядок: сделай Task 11 до запуска этого теста, либо временно закомментируй вызовы publish и раскомментируй в Task 11). **Рекомендация:** объяви `publishSecretFrame` здесь сразу, но телом-ссылкой на publisher, добавляемый в Task 11 — тогда тест Step 4 гоняй с `publisher==nil` (метод должен быть no-op при nil publisher).

- [ ] **Step 6: Добавить ChatRepo.CreateSecret**

В порт `ChatRepo` (ports.go) добавить:
```go
	CreateSecret(ctx context.Context, aID, bID int64) (int64, error)
```
Реализация в `postgres` chats-репо — по образцу `CreatePrivate` (создать chats(type='secret') + два chat_members), но БЕЗ дедупликации существующего приватного чата (секретных чатов между парой может быть несколько). Точный образец — метод `CreatePrivate` в chats-репо.

`publishSecretFrame` (no-op при nil publisher):
```go
func (i *Interactor) publishSecretFrame(ctx context.Context, sc domain.SecretChat, t string) {
	if i.publisher == nil {
		return
	}
	// тело — в Task 11 (рассылка кадра обоим участникам)
}
```

- [ ] **Step 7: Запустить — PASS.**

Run: `cd backend && go test ./internal/usecase/chat/ -run TestSecretHandshake`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/usecase/chat/secret.go backend/internal/usecase/chat/chat.go backend/internal/usecase/chat/ports.go backend/internal/usecase/chat/secret_test.go backend/internal/adapter/repo/postgres/
git commit -m "feat(secret): handshake state machine (create/accept/reject)"
```

### Task 10: Хранение шифртекста в messages (enc_body)

**Files:**
- Modify: `backend/internal/adapter/repo/postgres/messagesrepo.go` (messageCols, Insert, scanMessage)

- [ ] **Step 1: Добавить колонки в messageCols**

В `messagesrepo.go:27` дописать в конец строки `messageCols` (после `geo_meta`):
```
, enc_body, ttl_seconds, destruct_at
```

- [ ] **Step 2: Пробросить в Insert**

В `Insert` (около строки 353–364): в списке колонок INSERT добавить `enc_body, ttl_seconds, destruct_at`, увеличить нумерацию плейсхолдеров и в конец значений добавить `m.EncBody, m.TTLSeconds, m.DestructAt`. (Точное число `$N` — по образцу текущего запроса; добавляются три новых плейсхолдера после `geoMetaParam(m)`.)

- [ ] **Step 3: Пробросить в scanMessage**

Найти функцию сканирования строки (`scanMessage`/inline `rows.Scan(...)` рядом с декодированием `geo_meta`) и добавить в список сканируемых полей `&m.EncBody, &m.TTLSeconds, &m.DestructAt` в том же порядке, что в `messageCols`.

> **Критично:** порядок колонок в `messageCols`, в `INSERT`, и в `Scan` должен совпадать. Свериться с тем, как проброшен `geo_meta` — это точный образец «последней колонки».

- [ ] **Step 4: Собрать + прогнать существующие repo-тесты**

Run: `cd backend && go build ./... && go test ./internal/adapter/repo/postgres/ 2>&1 | tail -20`
Expected: компилируется; существующие тесты (если есть) зелёные.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/adapter/repo/postgres/messagesrepo.go
git commit -m "feat(secret): persist enc_body/ttl/destruct_at on messages"
```

### Task 11: Отправка/рассылка секретного сообщения + handshake-кадры

**Files:**
- Modify: `backend/internal/adapter/delivery/ws/conn.go` (case-и handshake + send с enc_body)
- Modify: `backend/internal/adapter/delivery/ws/frames.go` (поля кадра send + secret-кадры)
- Modify: `backend/internal/usecase/chat/secret.go` (тело `publishSecretFrame`)
- Modify: `backend/internal/usecase/chat/message.go` (маппинг enc_body/ttl в Send)

- [ ] **Step 1: Расширить входной кадр send_message**

В `ws/frames.go` в структуре разбора `send_message` (`sendMessageData`) добавить поля:
```go
	EncBody    string `json:"enc_body"`    // base64 iv||ciphertext (тип 'encrypted')
	TTLSeconds *int   `json:"ttl_seconds"`
```
В `ws/conn.go` case `"send_message"` при `type=='encrypted'` декодировать base64 `EncBody` в `[]byte` и прокинуть в доменное сообщение (`Message.EncBody`, `Message.TTLSeconds`), оставив `Text/Entities` пустыми.

- [ ] **Step 2: Маппинг в message.go Send**

В `chat/message.go` (метод Send) в ветке сборки `domain.Message` пробросить `EncBody`, `TTLSeconds` из входа для `type=='encrypted'`. Валидация: для `encrypted` требовать непустой `EncBody`, запрещать `Text`. Для не-secret чатов запретить `type=='encrypted'` (вернуть `ErrValidation`).

- [ ] **Step 3: Handshake-кадры в conn.go**

Добавить case-и (по образцу `call_request`…):
```go
case "secret_chat_request", "secret_chat_accept", "secret_chat_reject", "secret_chat_discard":
	// раскодировать {chat_id, peer_id?, pub?} и вызвать соответствующий метод
	// интерактора; ошибки → error-кадр отправителю.
```
Точный разбор полей — по образцу существующих case-ов; данные: `chat_id int64`, `peer_id int64` (для request), `pub string` (base64 публичного ключа).

- [ ] **Step 4: Тело publishSecretFrame**

В `chat/secret.go` реализовать рассылку кадра обоим участникам через `i.publisher`. Payload несёт `chat_id`, `state`, публичные ключи (base64) и id участников. Формат payload — по образцу других `publish*` методов интерактора (посмотреть `frame.go`/`geoLiveUpdatePayload`). Для `secret_chat_request` в payload включить `initiator_pub`; для `accept` — `responder_pub`.

- [ ] **Step 5: Сериализация enc-полей в исходящем new_message**

В месте сборки исходящего JSON сообщения (там же, где `geo`/`contact` — `frame.go` и HTTP `messageJSON`) добавить для секретных: `enc_body` (base64), `ttl_seconds`, `destruct_at`. Text/entities для `encrypted` не отдавать.

- [ ] **Step 6: Собрать + go vet**

Run: `cd backend && go build ./... && go vet ./... && gofmt -l internal | grep -v '^$' || echo gofmt-clean`
Expected: собирается, vet чистый, gofmt-clean.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/adapter/delivery/ws/ backend/internal/usecase/chat/
git commit -m "feat(secret): WS handshake frames + encrypted message send/broadcast"
```

### Task 12: Self-destruct — destruct_at при чтении + reaper

**Files:**
- Modify: `backend/internal/adapter/repo/postgres/messagesrepo.go` (SetDestructOnRead, ReapExpired)
- Modify: `backend/internal/usecase/chat/message.go` (в обработке read для секретного чата)
- Create: `backend/internal/usecase/chat/reaper.go` (или расширить существующий фон-воркер)
- Modify: `backend/internal/app/server.go` (запуск reaper-тикера, если нет общего планировщика)
- Test: `backend/internal/usecase/chat/reaper_test.go`

- [ ] **Step 1: Репозиторные методы**

```go
// SetDestructOnRead выставляет destruct_at = now()+ttl для непрочитанных ранее
// секретных сообщений чата с seq<=readSeq (только у которых ttl задан и destruct_at ещё nil).
func (r *MessagesRepo) SetDestructOnRead(ctx context.Context, chatID, readSeq int64) error {
	_, err := r.db.Exec(ctx,
		`UPDATE messages SET destruct_at = now() + make_interval(secs => ttl_seconds)
		 WHERE chat_id=$1 AND seq<=$2 AND ttl_seconds IS NOT NULL AND destruct_at IS NULL`,
		chatID, readSeq)
	return err
}

// ReapExpired помечает истёкшие секретные сообщения удалёнными и стирает блоб.
// Возвращает id стёртых — для рассылки delete-кадров.
func (r *MessagesRepo) ReapExpired(ctx context.Context, now time.Time) ([]domain.DeletedRef, error) {
	rows, err := r.db.Query(ctx,
		`UPDATE messages SET deleted_at = now(), enc_body = NULL
		 WHERE destruct_at IS NOT NULL AND destruct_at <= $1 AND deleted_at IS NULL
		 RETURNING id, chat_id`, now)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []domain.DeletedRef
	for rows.Next() {
		var d domain.DeletedRef
		if err := rows.Scan(&d.MsgID, &d.ChatID); err != nil { return nil, err }
		out = append(out, d)
	}
	return out, rows.Err()
}
```
> `domain.DeletedRef{MsgID, ChatID int64}` — добавить в domain, если нет.

- [ ] **Step 2: Написать падающий тест reaper**

```go
// reaper_test.go
func TestReapExpiredBroadcastsDelete(t *testing.T) {
	i, fakeMsgs, fakePub := newReaperTestInteractor(t)
	fakeMsgs.expired = []domain.DeletedRef{{MsgID: 10, ChatID: 5}}
	n := i.reapExpiredOnce(context.Background())
	if n != 1 { t.Fatalf("reaped=%d", n) }
	if len(fakePub.deletes) != 1 || fakePub.deletes[0].MsgID != 10 {
		t.Fatalf("expected delete broadcast for msg 10, got %+v", fakePub.deletes)
	}
}
```

- [ ] **Step 3: Запустить — FAIL.**

Run: `cd backend && go test ./internal/usecase/chat/ -run TestReapExpired`

- [ ] **Step 4: Реализовать reaper.go**

```go
package chat

import (
	"context"
	"time"
)

// reapExpiredOnce стирает истёкшие секретные сообщения и рассылает delete-кадры.
func (i *Interactor) reapExpiredOnce(ctx context.Context) int {
	refs, err := i.msgs.ReapExpired(ctx, time.Now())
	if err != nil || len(refs) == 0 {
		return 0
	}
	for _, r := range refs {
		i.broadcastDelete(ctx, r.ChatID, r.MsgID) // переиспользовать существующую рассылку delete_message
	}
	return len(refs)
}

// RunReaper запускается фоном (тикер) из app-слоя.
func (i *Interactor) RunReaper(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			i.reapExpiredOnce(ctx)
		}
	}
}
```
> `broadcastDelete` — переиспользовать существующий путь рассылки `delete_message` (найти в `message.go`/`frame.go`). При чтении секретного чата в обработчике read вызвать `i.msgs.SetDestructOnRead(ctx, chatID, readSeq)`.

- [ ] **Step 5: Запустить — PASS.**

Run: `cd backend && go test ./internal/usecase/chat/ -run TestReapExpired`

- [ ] **Step 6: Запустить reaper из app/server.go**

По образцу других фоновых горутин в `app/` запустить `go chatUC.RunReaper(appCtx, 10*time.Second)` (использовать fx lifecycle OnStart/OnStop). Если общего фонового планировщика нет — добавить в существующий hook старта.

- [ ] **Step 7: Собрать + тест**

Run: `cd backend && go build ./... && go test ./internal/usecase/chat/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/usecase/chat/reaper.go backend/internal/usecase/chat/message.go backend/internal/adapter/repo/postgres/messagesrepo.go backend/internal/app/server.go backend/internal/domain/
git commit -m "feat(secret): self-destruct — destruct_at on read + reaper broadcast"
```

### Task 13: Проброс SecretRepo и reaper в DI

**Files:**
- Modify: `backend/internal/app/server.go` (создание SecretRepo + `chatUC.SetSecret`)

- [ ] **Step 1: Зарегистрировать репозиторий**

По образцу `SetTranslator`/`SetTopics` в `server.go`: создать `postgres.NewSecretRepo(pool)` и вызвать `p.ChatUC.SetSecret(secretRepo)`. Импорт — существующий пакет postgres.

- [ ] **Step 2: Собрать + поднять стенд**

Run: `cd backend && go build ./... && docker compose -p msgrverify -f ../docker-compose.verify.yml up -d --build backend && docker compose -p msgrverify -f ../docker-compose.verify.yml restart nginx`
Expected: backend поднялся, миграция применена, nginx перепривязан (см. gotcha про IP).

- [ ] **Step 3: Commit**

```bash
git add backend/internal/app/server.go
git commit -m "feat(secret): wire SecretRepo + reaper into DI"
```

---

## Фаза 3 — Фронтенд: модели, realtime-плумбинг, менеджер/стор

### Task 14: Модели сообщений и чата

**Files:**
- Modify: `telegram-ui-clone/src/core/models.ts`

- [ ] **Step 1: Расширить RawMessage/Message**

В `RawMessage` добавить:
```ts
  enc_body?: string | null
  ttl_seconds?: number | null
  destruct_at?: string | null
```
В `Message` добавить:
```ts
  /** E2E-шифртекст (base64 iv||ciphertext) сообщения типа 'encrypted'; расшифровка на клиенте */
  encBody?: string | null
  /** self-destruct: срок жизни после прочтения (сек) и абсолютный дедлайн */
  ttlSeconds?: number | null
  destructAt?: string | null
  /** true — сообщение из секретного чата (после дешифровки text/entities заполнены локально) */
  secret?: boolean
```

- [ ] **Step 2: Пробросить в mapMessage**

В `mapMessage(r)` добавить: `encBody: r.enc_body ?? undefined, ttlSeconds: r.ttl_seconds ?? undefined, destructAt: r.destruct_at ?? undefined`. (Флаг `secret` выставляет `realtimeBridge`/менеджер, зная тип чата — не из wire.)

- [ ] **Step 3: tsc**

Run: `cd telegram-ui-clone && npx tsc -b`
Expected: типы проходят.

- [ ] **Step 4: Commit**

```bash
git add telegram-ui-clone/src/core/models.ts
git commit -m "feat(secret): message model — enc_body/ttl/destruct fields"
```

### Task 15: RT-события и транспорт кадров

**Files:**
- Modify: `telegram-ui-clone/src/core/realtime/events.ts`
- Modify: `telegram-ui-clone/src/core/realtime/connectionManager.ts`
- Modify: worker-диспетчер кадров (файл, где `case 'geo_live_update'` мапится в `broadcast(RT.geoLiveUpdate)` — найти grep `geo_live_update`)

- [ ] **Step 1: Добавить RT-ключи и типы событий**

В `events.ts` в `RT` добавить:
```ts
  secretRequest: 'rt:secret_chat_request',
  secretAccept: 'rt:secret_chat_accept',
  secretReject: 'rt:secret_chat_reject',
```
и типы:
```ts
export interface SecretHandshakeEvt { chatId: number; initiatorId: number; responderId: number; initiatorPub?: string; responderPub?: string; state: string }
```

- [ ] **Step 2: Диспетчер в worker**

По образцу `geo_live_update` добавить маршрутизацию входящих кадров `secret_chat_request/accept/reject` → `broadcast(RT.secretRequest/…)`. Поля перевести из snake_case в camelCase.

- [ ] **Step 3: Расширить SendArgs + sendFrame**

В `connectionManager.ts` в `SendArgs` добавить:
```ts
  encBody?: string
  ttlSeconds?: number | null
```
В `sendFrame` в объект `ws.send('send_message', {...})` добавить `enc_body: m.encBody ?? null, ttl_seconds: m.ttlSeconds ?? null`. Добавить методы отправки handshake-кадров:
```ts
    sendSecretFrame(t: 'secret_chat_request' | 'secret_chat_accept' | 'secret_chat_reject', d: Record<string, unknown>) { if (ws.isOpen()) ws.send(t, d) },
```

- [ ] **Step 4: tsc**

Run: `cd telegram-ui-clone && npx tsc -b`
Expected: проходит.

- [ ] **Step 5: Commit**

```bash
git add telegram-ui-clone/src/core/realtime/
git commit -m "feat(secret): RT events + WS transport for handshake & enc messages"
```

### Task 16: secretChatStore (состояние handshake)

**Files:**
- Create: `telegram-ui-clone/src/stores/secretChatStore.ts`
- Test: `telegram-ui-clone/src/stores/secretChatStore.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// secretChatStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useSecretChatStore } from './secretChatStore'

describe('secretChatStore', () => {
  beforeEach(() => useSecretChatStore.setState({ byChat: {} }))
  it('setState хранит стадию handshake по chatId', () => {
    useSecretChatStore.getState().setStatus(7, 'requested')
    expect(useSecretChatStore.getState().byChat[7]?.status).toBe('requested')
    useSecretChatStore.getState().setStatus(7, 'established')
    expect(useSecretChatStore.getState().byChat[7]?.status).toBe('established')
  })
  it('setFingerprint сохраняет emoji-цепочку', () => {
    useSecretChatStore.getState().setFingerprint(7, ['🔒', '🔑'])
    expect(useSecretChatStore.getState().byChat[7]?.fingerprint).toEqual(['🔒', '🔑'])
  })
})
```

- [ ] **Step 2: Запустить — FAIL.**

Run: `cd telegram-ui-clone && npx vitest run src/stores/secretChatStore.test.ts`

- [ ] **Step 3: Реализовать store (по образцу существующих zustand-сторов)**

```ts
// secretChatStore.ts — состояние E2E-handshake по chatId (нормализовано).
import { create } from 'zustand'

export type SecretStatus = 'requested' | 'awaiting' | 'established' | 'rejected'

interface SecretEntry { status: SecretStatus; fingerprint?: string[] }
interface SecretChatState {
  byChat: Record<number, SecretEntry>
  setStatus: (chatId: number, status: SecretStatus) => void
  setFingerprint: (chatId: number, fingerprint: string[]) => void
}

export const useSecretChatStore = create<SecretChatState>((set) => ({
  byChat: {},
  setStatus: (chatId, status) =>
    set((s) => ({ byChat: { ...s.byChat, [chatId]: { ...s.byChat[chatId], status } } })),
  setFingerprint: (chatId, fingerprint) =>
    set((s) => ({ byChat: { ...s.byChat, [chatId]: { ...s.byChat[chatId], fingerprint } } })),
}))
```

- [ ] **Step 4: Запустить — PASS.**

Run: `cd telegram-ui-clone && npx vitest run src/stores/secretChatStore.test.ts`

- [ ] **Step 5: Commit**

```bash
git add telegram-ui-clone/src/stores/secretChatStore.ts telegram-ui-clone/src/stores/secretChatStore.test.ts
git commit -m "feat(secret): secretChatStore for handshake state"
```

### Task 17: secretManager (команды E2E)

**Files:**
- Create: `telegram-ui-clone/src/core/managers/secretManager.ts`
- Modify: `telegram-ui-clone/src/client/bootstrap.ts` (тип Managers + сборка)

- [ ] **Step 1: Реализовать менеджер**

```ts
// secretManager.ts — команды секретного чата: создание/приём handshake и
// отправка зашифрованных сообщений. Не знает про React/DOM.
import { generateKeyPair, exportPublicKey, deriveSecret, encryptPayload } from '../secret/crypto'
import { fingerprintEmoji } from '../secret/fingerprint'
import { saveKey, loadKey } from '../secret/keyStore'
import { useSecretChatStore } from '../../stores/secretChatStore'
import type { ConnectionManager } from '../realtime/connectionManager'
import { b64FromBytes, b64ToBytes } from '../secret/crypto' // экспортировать хелперы из crypto.ts

export function createSecretManager(conn: ConnectionManager, createSecretChatRest: (peerId: number, pubB64: string) => Promise<{ chatId: number }>) {
  return {
    // Инициатор: генерит пару, создаёт чат на бэке, шлёт pubA.
    async start(peerId: number): Promise<number> {
      const kp = await generateKeyPair()
      const pub = await exportPublicKey(kp.publicKey)
      const { chatId } = await createSecretChatRest(peerId, b64FromBytes(pub))
      // приватный ключ временно держим до accept — кладём пару в keyStore как pending
      await savePending(chatId, kp.privateKey)
      useSecretChatStore.getState().setStatus(chatId, 'awaiting')
      return chatId
    },
    // Получатель принял: генерит пару, выводит общий ключ из initiatorPub, шлёт pubB.
    async accept(chatId: number, initiatorPubB64: string): Promise<void> {
      const kp = await generateKeyPair()
      const pub = await exportPublicKey(kp.publicKey)
      const secret = await deriveSecret(kp.privateKey, b64ToBytes(initiatorPubB64))
      await saveKey(chatId, { key: secret.key, fingerprint: secret.fingerprint })
      useSecretChatStore.getState().setStatus(chatId, 'established')
      useSecretChatStore.getState().setFingerprint(chatId, fingerprintEmoji(secret.fingerprint))
      conn.sendSecretFrame('secret_chat_accept', { chat_id: chatId, pub: b64FromBytes(pub) })
    },
    // Инициатор получил pubB: доводит общий ключ.
    async complete(chatId: number, responderPubB64: string): Promise<void> {
      const priv = await loadPending(chatId)
      if (!priv) return
      const secret = await deriveSecret(priv, b64ToBytes(responderPubB64))
      await saveKey(chatId, { key: secret.key, fingerprint: secret.fingerprint })
      await clearPending(chatId)
      useSecretChatStore.getState().setStatus(chatId, 'established')
      useSecretChatStore.getState().setFingerprint(chatId, fingerprintEmoji(secret.fingerprint))
    },
    // Отправка зашифрованного текста.
    async sendText(chatId: number, text: string, entities: unknown[], ttlSeconds: number | null, clientMsgId: string): Promise<void> {
      const stored = await loadKey(chatId)
      if (!stored) throw new Error('secret chat key missing')
      const encBody = await encryptPayload(stored.key, { text, entities })
      conn.sendMessage({ chatId, text: '', clientMsgId, type: 'encrypted', encBody, ttlSeconds })
    },
  }
}
```

> **Замечание:** `savePending/loadPending/clearPending` — хранение приватного ключа инициатора до accept: добавь их в `keyStore.ts` (отдельный object store `pending`, значение — non-extractable private `CryptoKey`). `b64FromBytes/b64ToBytes` — экспортируй уже написанные `b64encode/b64decode` из `crypto.ts` под этими именами (реэкспорт). `createSecretChatRest` — REST-обёртка `POST /secret_chats {peer_id, pub}` → `{chat_id}` (или отправить `secret_chat_request` целиком по WS, если решишь не заводить REST — тогда chatId придёт кадром; но REST проще для синхронного получения chatId, по образцу `sendGeoLive`).

- [ ] **Step 2: Добавить в тип Managers (bootstrap.ts)**

Добавить `secret: ReturnType<typeof createSecretManager>` в интерфейс `Managers` и собрать его в фабрике managers (по образцу существующих менеджеров).

- [ ] **Step 3: tsc**

Run: `cd telegram-ui-clone && npx tsc -b`
Expected: проходит.

- [ ] **Step 4: Commit**

```bash
git add telegram-ui-clone/src/core/managers/secretManager.ts telegram-ui-clone/src/client/bootstrap.ts telegram-ui-clone/src/core/secret/keyStore.ts telegram-ui-clone/src/core/secret/crypto.ts
git commit -m "feat(secret): secretManager — handshake + encrypted send"
```

### Task 18: realtimeBridge — handshake и дешифровка входящих

**Files:**
- Modify: `telegram-ui-clone/src/client/realtimeBridge.ts`

- [ ] **Step 1: Подписки на handshake-кадры**

По образцу `smp.on(RT.geoLiveUpdate, …)` добавить:
```ts
  smp.on(RT.secretRequest, (raw) => {
    const e = raw as SecretHandshakeEvt
    useSecretChatStore.getState().setStatus(e.chatId, 'requested')
    // авто-приём или показать запрос в UI: сохранить initiatorPub для accept
    pendingRequests.set(e.chatId, e.initiatorPub!)
    uiEvents.emit(RT.secretRequest, e)
  })
  smp.on(RT.secretAccept, (raw) => {
    const e = raw as SecretHandshakeEvt
    void managers.secret.complete(e.chatId, e.responderPub!)
  })
  smp.on(RT.secretReject, (raw) => {
    const e = raw as SecretHandshakeEvt
    useSecretChatStore.getState().setStatus(e.chatId, 'rejected')
    uiEvents.emit(RT.secretReject, e)
  })
```

- [ ] **Step 2: Дешифровка входящих encrypted-сообщений**

В обработчике `smp.on(RT.newMessage, …)` для сообщений с `type==='encrypted'` (или `encBody`): загрузить ключ (`loadKey(chatId)`), расшифровать payload, заполнить `text/entities` на объекте Message, проставить `secret:true`, и только потом положить в стор. Если ключа нет (другой браузер) — положить сообщение с плейсхолдером «🔒 недоступно на этом устройстве» (НЕ raw-HTML — обычная строка text). Дешифровка асинхронна: дешифруй до `store.addMessage`, накапливая через await (сохранить порядок).

- [ ] **Step 3: tsc + сборка**

Run: `cd telegram-ui-clone && npx tsc -b && npx vite build --base=/ --outDir ../client-build`
Expected: типы проходят, сборка ок.

- [ ] **Step 4: Commit**

```bash
git add telegram-ui-clone/src/client/realtimeBridge.ts
git commit -m "feat(secret): realtimeBridge — handshake handling + incoming decrypt"
```

---

## Фаза 4 — UI

### Task 19: Точка входа «Начать секретный чат» + визуал чата

**Files:**
- Modify: `telegram-ui-clone/src/components/UserInfoPanel.tsx` (пункт меню)
- Modify: заголовок/список чата — индикатор секретного чата (замок, зелёный акцент)

- [ ] **Step 1: Пункт «Начать секретный чат»**

В профиле пользователя (там же, где действия «Написать»/«Позвонить») добавить пункт, вызывающий `managers.secret.start(peerId)` и открывающий созданный чат (по образцу `onOpenChat` из контактов).

- [ ] **Step 2: Визуал**

Секретный чат (`chat.type === 'secret'`): иконка-замок 🔒 перед названием в шапке и в списке, зелёный акцент имени. Взять минимально — стиль как у остальных бейджей чата; без изобретательства.

- [ ] **Step 3: tsc + сборка**

Run: `cd telegram-ui-clone && npx tsc -b && npx vite build --base=/ --outDir ../client-build`

- [ ] **Step 4: Commit**

```bash
git add telegram-ui-clone/src/components/
git commit -m "feat(secret): entry point + secret chat visual"
```

### Task 20: Экран верификации ключа (emoji-fingerprint)

**Files:**
- Create: `telegram-ui-clone/src/components/secret/KeyVerificationPopup.tsx`
- Modify: `telegram-ui-clone/src/components/UserInfoPanel.tsx` (пункт «Encryption Key»)

- [ ] **Step 1: Реализовать попап**

Попап (`shared/ui/Popup`) показывает `fingerprint` из `useSecretChatStore.getState().byChat[chatId].fingerprint` крупной сеткой эмодзи + подпись «Сравните эти эмодзи с собеседником». Данные только из стора, рендер эмодзи как текст-ноды.

- [ ] **Step 2: Пункт в профиле секретного чата**

Добавить пункт «Ключ шифрования» → открывает `KeyVerificationPopup`.

- [ ] **Step 3: tsc + сборка**

Run: `cd telegram-ui-clone && npx tsc -b && npx vite build --base=/ --outDir ../client-build`

- [ ] **Step 4: Commit**

```bash
git add telegram-ui-clone/src/components/secret/ telegram-ui-clone/src/components/UserInfoPanel.tsx
git commit -m "feat(secret): key verification (emoji fingerprint) screen"
```

### Task 21: Self-destruct таймер + запрет пересылки

**Files:**
- Modify: `telegram-ui-clone/src/core/hooks/useChatSend.ts` (проброс ttlSeconds)
- Modify: `telegram-ui-clone/src/components/Composer.tsx` (пикер таймера в секретном чате)
- Modify: `telegram-ui-clone/src/core/hooks/useMessageActions.tsx` (скрыть forward/copy/quote)
- Modify: `telegram-ui-clone/src/components/messages/MessageBubbles.tsx` (обратный отсчёт до самоуничтожения)

- [ ] **Step 1: Пикер таймера**

В секретном чате в композере добавить контрол выбора TTL (Off / 5с / 10с / 1мин / 1час / 1день / 1нед). Стиль — по образцу `AutoDeleteMessages`/существующих меню. Значение хранить в локальном состоянии композера, пробрасывать в `sendText`.

- [ ] **Step 2: Отправка через secretManager**

В `useChatSend` для `chat.type==='secret'` слать через `managers.secret.sendText(chatId, text, entities, ttlSeconds, clientMsgId)` вместо обычного `connectionManager.sendMessage`. (Оптимистичный бабл: положить в стор расшифрованный `text` локально с `clientId`, как в обычном пути.)

- [ ] **Step 3: Скрыть forward/copy/quote**

В `useMessageActions.tsx`: если чат секретный (прокинуть флаг), не показывать действия forward, copy, «ответить с цитатой». Остальные (reply/delete) остаются.

- [ ] **Step 4: Обратный отсчёт**

В бабле секретного сообщения с `destructAt` показывать таймер обратного отсчёта (self-tick через `useState`+`setInterval`, как в GeoBubble live-countdown). По достижении — сообщение всё равно снесётся delete-кадром от reaper; локально можно скрыть заранее.

- [ ] **Step 5: tsc + vitest + сборка**

Run: `cd telegram-ui-clone && npx tsc -b && npx vitest run && npx vite build --base=/ --outDir ../client-build`
Expected: типы, все тесты, сборка — зелёные.

- [ ] **Step 6: Commit**

```bash
git add telegram-ui-clone/src/core/hooks/ telegram-ui-clone/src/components/
git commit -m "feat(secret): self-destruct timer + no-forward/copy in secret chats"
```

### Task 22: Медиа в секретном чате

**Files:**
- Modify: `telegram-ui-clone/src/core/managers/secretManager.ts` (sendMedia)
- Modify: `telegram-ui-clone/src/core/hooks/useChatSend.ts` (ветка attach для секретного чата)
- Modify: `telegram-ui-clone/src/components/messages/*` (дешифровка медиа при показе)

- [ ] **Step 1: secretManager.sendMedia**

```ts
    async sendMedia(chatId: number, file: File, ttlSeconds: number | null, clientMsgId: string, upload: (bytes: Uint8Array) => Promise<{ mediaId: number }>): Promise<void> {
      const stored = await loadKey(chatId)
      if (!stored) throw new Error('secret chat key missing')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { cipher, keyB64, ivB64 } = await encryptMedia(bytes)
      const { mediaId } = await upload(new Uint8Array(cipher)) // загрузка шифро-блоба существующим путём (octet-stream)
      const encBody = await encryptPayload(stored.key, { media: { mediaId, keyB64, ivB64, name: file.name, mime: file.type, size: bytes.byteLength } })
      conn.sendMessage({ chatId, text: '', clientMsgId, type: 'encrypted', encBody, ttlSeconds, mediaId })
    },
```
> `upload` — обёртка над существующим media-upload (`mediaManager`), но с `content-type: application/octet-stream` и без запроса генерации превью. Импортировать `encryptMedia`.

- [ ] **Step 2: Дешифровка медиа при показе**

В рендере секретного медиа-бабла: скачать блоб по `mediaId`, `decryptMedia(cipher, keyB64, ivB64)` → object URL → показать. Ключ+iv берутся из расшифрованного payload (`message` уже имеет их в памяти после дешифровки в realtimeBridge — прокинуть в модель как `secretMedia?: {mediaId,keyB64,ivB64,...}`).

- [ ] **Step 3: tsc + сборка**

Run: `cd telegram-ui-clone && npx tsc -b && npx vite build --base=/ --outDir ../client-build`

- [ ] **Step 4: Commit**

```bash
git add telegram-ui-clone/src/core/ telegram-ui-clone/src/components/
git commit -m "feat(secret): E2E media send + decrypt on view"
```

---

## Фаза 5 — Проверка на стенде (e2e)

### Task 23: Ручная e2e-проверка на :38443

**Files:**
- Create: `scratchpad/e2e-secret.md` (чек-лист прогона)

- [ ] **Step 1: Пересобрать стенд**

Run:
```bash
cd /Users/denisurevic/Documents/messenger-denis && \
cd telegram-ui-clone && npx vite build --base=/ --outDir ../client-build && cd .. && \
docker compose -p msgrverify -f docker-compose.verify.yml up -d --build backend && \
docker compose -p msgrverify -f docker-compose.verify.yml restart nginx
```

- [ ] **Step 2: Прогон сценария (два браузера/два юзера)**

Чек-лист (отметить каждый):
- [ ] A открывает профиль B → «Начать секретный чат» → чат создан, статус «ожидание».
- [ ] B видит запрос → принимает → у обоих статус «established».
- [ ] Экран «Ключ шифрования» у A и B показывает **одинаковую** цепочку эмодзи.
- [ ] A шлёт текст → B видит расшифрованный текст; в БД `messages.text` пуст, `enc_body` не пуст (проверить `docker compose -p msgrverify exec db psql ... -c "select type, text, (enc_body is not null) enc from messages where chat_id=<cid> order by id desc limit 3"`).
- [ ] A шлёт картинку → B видит её после дешифровки; в MinIO лежит шифро-блоб (не открывается как изображение напрямую).
- [ ] forward/copy в секретном чате скрыты.
- [ ] A ставит TTL 5с, шлёт, B читает → через ~5с сообщение исчезает у обоих; `enc_body` в БД обнулён (`enc_body is not null` → false), строка `deleted_at` заполнена.
- [ ] Открыть чат в третьем браузере (тот же аккаунт A) → секретного чата/сообщений нет (device-local).

- [ ] **Step 3: Финальные проверки качества**

Run:
```bash
cd backend && go build ./... && go vet ./... && go test ./internal/usecase/chat/ && gofmt -l internal | (grep -v '^$' && echo "NEEDS FMT" || echo "gofmt-clean")
cd ../telegram-ui-clone && npx tsc -b && npx vitest run && npx vite build --base=/ --outDir ../client-build
```
Expected: backend build/vet/test/gofmt чистые; frontend tsc/vitest/build зелёные.

- [ ] **Step 4: Commit чек-листа**

```bash
git add scratchpad/e2e-secret.md
git commit -m "docs(secret): e2e verification checklist"
```

---

## Self-review плана (сверка со спеком)

- **Крипта ECDH+HKDF+AES-GCM** → Task 1–3. ✓
- **Device-local ключи в IndexedDB, non-extractable, не уходят на сервер** → Task 1 (extractable=false), Task 5 (keyStore). ✓
- **Текст + медиа E2E** → Task 2 (текст), Task 3 + Task 22 (медиа). ✓
- **Self-destruct таймер** → Task 6 (колонки), Task 12 (destruct_at+reaper), Task 21 (пикер+отсчёт). ✓
- **Верификация ключа (fingerprint)** → Task 4 (emoji-SAS), Task 20 (экран). ✓
- **Запрет пересылки/копирования** → Task 21 Step 3. ✓
- **Сервер хранит только шифртекст, без превью/поиска/push-превью** → Task 6/10/11 (enc_body, text пуст), медиа octet-stream без тумбов Task 22. ✓
- **Handshake через WS `{t,d}` → realtimeBridge** → Task 11 (кадры), Task 15 (RT), Task 18 (bridge). ✓
- **Тип чата 'secret', 1-на-1** → Task 6/7 (модель), Task 9 (CreateSecret). ✓
- **Инвариант raw-HTML** → отмечено в шапке + Task 18 Step 2 (плейсхолдер как text-node), Task 20. ✓
- **Тесты backend (handshake, enc_body непрозрачен, reaper, push без превью)** → Task 9, 10, 12; push-без-превью следует из пустого text (проверка в Task 23). ✓
- **Тесты frontend (derive симметричен, round-trip текст/медиа, fingerprint стабилен)** → Task 1, 2, 3, 4. ✓
- **E2E на стенде** → Task 23. ✓

**Известные точки, требующие сверки с кодом при исполнении (не заглушки, а привязка к существующим паттернам):** тип пула `Querier` в postgres-пакете (Task 8), точный `$N`-порядок в Insert (Task 10), имена `domain.Err*` (Task 9), существующий путь `broadcastDelete`/`delete_message` (Task 12), фабрика managers и тип `Managers` (Task 17), файл worker-диспетчера кадров (Task 15).
