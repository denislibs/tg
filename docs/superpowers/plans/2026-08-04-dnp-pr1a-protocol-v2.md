# DNP PR-1a — protocol v2 groundwork (dnp/2 + kind-байт) (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Эволюция wire до **dnp/2**: bump prologue+subprotocol и ввести **kind-байт** на каждый транспортный кадр (0x00=JSON). Ноль новой функциональности — realtime+RPC работают поверх dnp/2. Готовит бинарные file-кадры (PR-1b, kind 0x01).

**Architecture:** kind-байт — первый байт **plaintext** (внутри AEAD, до JSON): сервер добавляет/снимает в `dnpCodec` (+ `dnpAccept` для auth), клиент — в `DnpTransport.send`/`onMessage`/auth. codec seal/open остаётся байт-агностичным. prologue/subprotocol `dnp/1`→`dnp/2` (клиент+сервер). Interop-фикстура регенерируется (меняется из-за prologue; kind-байт её НЕ трогает — он выше codec-слоя).

**Tech Stack:** Go (flynn/noise), TypeScript (@noble), Vitest. `backend/` + `web-client/`.

**Спека:** [`../specs/2026-08-04-dnp-l5-media-channel-design.md`](../specs/2026-08-04-dnp-l5-media-channel-design.md) §«Protocol v2».

## Global Constraints

- **kind-байт:** `0x00` = `UTF8(JSON {t,d})` (все текущие кадры); `0x01` зарезервирован под file_chunk (PR-1b). PR-1a: kind всегда 0x00; не-0x00 → ошибка/close.
- **kind-байт — на DNP-пути**, НЕ на plain-WS (`plainCodec` не трогаем — plain-клиент шлёт голый JSON). Только `dnpCodec`/`dnpAccept`/`DnpTransport`.
- **prologue + subprotocol → `dnp/2`** согласованно (клиент+сервер). Хендшейк падает чисто при рассинхроне.
- **Совместимость:** DNP за флагом, не в проде, деплой вместе → wire-bump безопасен. Interop-фикстура регенерируется под dnp/2.
- **Критерий готовности:** realtime + RPC (L3/L4) работают поверх dnp/2 с kind 0x00; Go↔JS interop проходит байт-в-байт под dnp/2. Plain-WS не задет.
- `gofmt`/`go vet`/`go build`/`go test` зелёные; `npm test`/`typecheck`/`build` зелёные.

## Файловая структура

**Сервер (Task 1):**
- `internal/adapter/delivery/ws/dnp/noise.go` — `prologueV1` → `dnp/2`.
- `internal/adapter/delivery/ws/handler.go` — subprotocol `dnp/1` → `dnp/2` (Subprotocols + hasSubprotocol).
- `internal/adapter/delivery/ws/conn.go` — `dnpCodec.encode/decode` kind-байт (0x00).
- `internal/adapter/delivery/ws/dnp_accept.go` — снять kind-байт с auth-кадра.
- `internal/adapter/delivery/ws/dnp/noise_test.go` — регенерация фикстуры (генератор с dnp/2).
- `internal/adapter/delivery/ws/rpc_test.go` / `dnp_accept_test.go` — initiator'ы добавляют kind-байт к транспортным кадрам.
- `web-client/src/core/net/dnp/noise/fixtures/nk-vector.json` — регенерируется (пишется Go-генератором).

**Клиент (Task 2):**
- `web-client/src/core/net/dnp/dnpTransport.ts` — PROLOGUE/subprotocol `dnp/2` + kind-байт (send/onMessage/auth).
- `web-client/src/core/net/dnp/dnpTransport.test.ts` — subprotocol `dnp/2` + kind-байт в ожиданиях.
- `web-client/src/core/net/dnp/noise/handshakeState.test.ts` — prologue `dnp/2` (совпасть с регенер. фикстурой).
- `web-client/src/core/net/dnp/noise/interop.test.ts` — читает `fixture.prologue` (проверить, что динамически).

---

### Task 1: Сервер — dnp/2 + kind-байт + регенерация фикстуры

**Files:** (см. серверный список выше)

**Interfaces:**
- Меняет: `prologueV1="dnp/2"`; subprotocol `"dnp/2"`; `dnpCodec` кадр = `[0x00][JSON]`; `dnpAccept` снимает kind-байт с auth.

- [ ] **Step 1: prologue + subprotocol → dnp/2**

`ws/dnp/noise.go`:
```go
const prologueV1 = "dnp/2"
```
`ws/handler.go`: заменить оба `"dnp/1"` на `"dnp/2"` (в `Subprotocols: []string{"bearer", "dnp/2"}` и `hasSubprotocol(r, "dnp/2")`). Комментарии обновить (dnp/1 → dnp/2).

- [ ] **Step 2: регенерировать interop-фикстуру + прогнать генератор**

Run (из `backend/`): `go test ./internal/adapter/delivery/ws/dnp/ -run TestGenerateInteropFixture`
Expected: PASS; `web-client/src/core/net/dnp/noise/fixtures/nk-vector.json` перезаписан с `"prologue":"dnp/2"` и новыми `msg1/msg2/transportFromInit` (крипта та же, prologue другой). Убедиться `grep '"prologue"' web-client/src/core/net/dnp/noise/fixtures/nk-vector.json` → `dnp/2`.

- [ ] **Step 3: kind-байт в `dnpCodec` (conn.go)**

`ws/conn.go` — `dnpCodec.encode`/`decode`:
```go
const frameKindJSON byte = 0x00

func (c *dnpCodec) decode(raw []byte) ([]byte, error) {
	plain, err := dnp.DecryptFrame(c.recv, raw)
	if err != nil {
		return nil, err
	}
	if len(plain) < 1 || plain[0] != frameKindJSON {
		return nil, errors.New("dnp: unexpected frame kind")
	}
	return plain[1:], nil
}

func (c *dnpCodec) encode(frame []byte) (int, []byte) {
	out, err := dnp.EncryptFrame(c.send, append([]byte{frameKindJSON}, frame...))
	if err != nil {
		return websocket.BinaryMessage, nil
	}
	return websocket.BinaryMessage, out
}
```
(Импортни `errors`, если ещё нет.)

- [ ] **Step 4: снять kind-байт с auth-кадра в `dnpAccept`**

`ws/dnp_accept.go` — после `dnp.Open(recv, authCiphertext)`:
```go
	plain, err := dnp.Open(recv, authCiphertext)
	if err != nil {
		return nil, domain.User{}, 0, err
	}
	if len(plain) < 1 || plain[0] != 0x00 {
		return nil, domain.User{}, 0, errors.New("dnp: expected JSON auth frame")
	}
	plain = plain[1:]
	// ... существующий json.Unmarshal(plain, &f) ...
```

- [ ] **Step 5: обновить Go-интеграционные тесты (initiator добавляет kind-байт)**

В `dnp_accept_test.go` и `rpc_test.go` initiator шлёт транспортные кадры через `dnp.EncryptFrame(iSend, payload)` и читает `dnp.DecryptFrame(iRecv, raw)`. Теперь payload на отправке = `append([]byte{0x00}, jsonBytes...)`, а на приёме — снять первый байт перед JSON-разбором. Добавь локальный хелпер в тест-пакет:
```go
func kindJSON(b []byte) []byte { return append([]byte{0x00}, b...) }
func stripKind(t *testing.T, b []byte) []byte {
	t.Helper()
	if len(b) < 1 || b[0] != 0x00 { t.Fatalf("bad frame kind: %x", b) }
	return b[1:]
}
```
Применить: auth-кадр и rpc_req → `EncryptFrame(iSend, kindJSON(json))`; rpc_resp/ответы → `stripKind(t, DecryptFrame(iRecv, raw))` перед `json.Unmarshal`. (Хелперы — один раз в общем тест-файле пакета, не дублировать.)

- [ ] **Step 6: gofmt + vet + серверные dnp-тесты**

Run (из `backend/`): `gofmt -w internal/adapter/delivery/ws/ && go vet ./internal/adapter/delivery/ws/... && go test ./internal/adapter/delivery/ws/ -run 'DNPAccept|Codec|DNPChannel|RPC|Frame' -v`
Затем полный ws-пакет (Docker): `go test ./internal/adapter/delivery/ws/...` — plain-integration зелёный (кроме известного флейка `TestWS_RevokeClosesSocket`), DNP-integration зелёные под dnp/2+kind.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/adapter/delivery/ws/ web-client/src/core/net/dnp/noise/fixtures/nk-vector.json
git commit -m "feat(dnp): protocol v2 — dnp/2 prologue+subprotocol + kind byte (server)

Регенерирована interop-фикстура под dnp/2. kind-байт 0x00 на транспортных
кадрах DNP (dnpCodec + dnpAccept). Plain-WS не задет.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Клиент — dnp/2 + kind-байт

**Files:** (см. клиентский список выше)

**Interfaces:** `DnpTransport` шлёт/принимает `[0x00][JSON]`; PROLOGUE/subprotocol `dnp/2`.

- [ ] **Step 1: PROLOGUE + subprotocol → dnp/2**

`web-client/src/core/net/dnp/dnpTransport.ts`:
```ts
const PROLOGUE = new TextEncoder().encode('dnp/2')
```
и в `connect`:
```ts
    const ws = new WebSocket(this.url, ['dnp/2'])
```

- [ ] **Step 2: kind-байт в send/auth/onMessage**

Добавить хелпер и применить (в `dnpTransport.ts`):
```ts
const KIND_JSON = 0x00
function withKind(kind: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + payload.length)
  out[0] = kind; out.set(payload, 1)
  return out
}
```
auth-кадр (в onMessage, фаза handshaking):
```ts
        const authJson = encodeFrame('auth', { token: this.token })
        this.ws!.send(sealFrame(this.cipherSend, withKind(KIND_JSON, new TextEncoder().encode(authJson))) as BufferSource)
```
`send(t,d)`:
```ts
    this.ws!.send(sealFrame(this.cipherSend, withKind(KIND_JSON, new TextEncoder().encode(encodeFrame(t, d)))) as BufferSource)
```
`onMessage` (фаза ready):
```ts
        const plain = openFrame(this.cipherRecv!, raw)
        if (plain.length < 1 || plain[0] !== KIND_JSON) { this.fail(); return } // PR-1b: 0x01 file
        const f: Frame = decodeFrame(new TextDecoder().decode(plain.subarray(1)))
```

- [ ] **Step 3: обновить клиентские тесты под dnp/2 + kind**

- `dnpTransport.test.ts`: `expect(ws.protocols).toEqual(['dnp/2'])`; тест использует регенер. фикстуру (msg1/msg2 из неё — динамически, не хардкод). Auth-кадр теперь `[0x00][authJSON]` — при декоде серверным `CipherState(initSendKey)` снять первый байт перед JSON.parse. Серверный кадр к клиенту (`presence`) — фейк-сервер шлёт `sealFrame(CipherState(initRecvKey), withKind(0x00, json))`, иначе клиент его отвергнет.
- `handshakeState.test.ts`: заменить хардкод `'dnp/1'` на `'dnp/2'` в тестах, что сверяются с фикстурой (иначе msg1 не совпадёт). Тесты, где prologue — произвольные тест-данные (symmetricState mechanics), можно оставить, но для единообразия — `dnp/2`.
- `interop.test.ts`: должен читать `fixture.prologue` (динамически) — проверь; если хардкод — поправь на `fixture.prologue`.

- [ ] **Step 4: полный клиентский гейт**

Run (из `web-client/`): `npm test && npm run typecheck && npm run build`
Expected: всё зелёное. interop-тест проходит байт-в-байт под dnp/2; DnpTransport-тест — с kind-байтом; realtime/RPC не сломаны (kind 0x00). Флаг OFF (plain WsClient) — не задет.

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/net/dnp/dnpTransport.ts web-client/src/core/net/dnp/dnpTransport.test.ts web-client/src/core/net/dnp/noise/handshakeState.test.ts web-client/src/core/net/dnp/noise/interop.test.ts
git commit -m "feat(dnp): protocol v2 — dnp/2 prologue+subprotocol + kind byte (client)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Финальная проверка PR-1a

- [ ] `cd backend && gofmt -l internal/adapter/delivery/ws/` пусто, `go vet`, `go build`, `go test ./internal/adapter/delivery/ws/...` (DNP + plain) зелёные (кроме известного флейка).
- [ ] `cd web-client && npm test && npm run typecheck && npm run build` — зелёные; interop байт-в-байт под dnp/2.
- [ ] Prologue **и** subprotocol = `dnp/2` на обеих сторонах; фикстура `"prologue":"dnp/2"`.
- [ ] kind-байт 0x00 на всех транспортных DNP-кадрах (dnpCodec + dnpAccept + DnpTransport); plain-WS без kind-байта (не задет).
- [ ] Realtime + RPC работают поверх dnp/2 (ноль новой функциональности — только wire-эволюция).
- [ ] PR в `main`, ветка `feat/dnp-media-l5`.

## Self-review (проверено при написании плана)

- **Покрытие спеки §Protocol v2:** prologue+subprotocol dnp/2 (Task 1/2), kind-байт обе стороны (Task 1/2), регенерация фикстуры (Task 1), обновление тестов (Task 1/2). file-кадры (0x01) — PR-1b.
- **Плейсхолдеров нет:** реальный код; тест-хелперы `kindJSON`/`withKind` определены явно.
- **Согласованность:** kind 0x00 одинаков клиент/сервер; фикстура (Task 1, dnp/2) ↔ клиентские тесты (Task 2); auth-кадр `[0x00][JSON]` — клиент шлёт (Task 2), сервер снимает (Task 1 `dnpAccept`).
- **Ключевой риск — координация фикстуры:** Task 1 регенерирует и коммитит `nk-vector.json` (dnp/2); Task 2 использует её (msg1/msg2 динамически) — порядок SDD (Task1→Task2) это гарантирует.
- **Kind-байт не трогает codec/фикстуру:** он на транспортном слое; interop-фикстура меняется только из-за prologue (проверено: `transportFromInit` = raw `Encrypt("ping")` без kind).
