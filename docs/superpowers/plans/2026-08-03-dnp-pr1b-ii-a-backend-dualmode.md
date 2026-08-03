# DNP PR-1b-ii-a — бэкенд dual-mode (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Научить бэкенд принимать DNP-канал (Noise) параллельно с plain-WS: length-framed codec, `frameCodec`-шов в `conn.go`, ветка `dnp/1` в `handler.go`, `DNP_SERVER_PRIVKEY` в конфиге, утилита `dnpkeygen`. Доказано Go-интеграционным тестом (`flynn/noise` initiator → хендлер). Клиент НЕ трогаем.

**Architecture:** Крипто-ядро (`ws/dnp/noise.go`, PR-1b-i) уже есть. Здесь: `dnp/codec.go` (length-framing + encrypt/decrypt-frame), `frameCodec` интерфейс в `conn.go` (plain identity/Text vs dnp Noise/Binary) — `dispatch`/hub/pump без изменений. `handler.go`: subprotocol `dnp/1` → `dnpAccept` (хендшейк + auth-кадр внутри канала) → `newConn(dnpCodec)`.

**Tech Stack:** Go 1.25, `github.com/flynn/noise` v1.1.0, gorilla/websocket. Всё из `backend/`.

**Спека:** [`../specs/2026-08-03-dnp-pr1b-ii-channel-transport-design.md`](../specs/2026-08-03-dnp-pr1b-ii-channel-transport-design.md) §4.

## Global Constraints

- **Чистая архитектура** (`domain ← usecase ← adapter`); DNP — в `adapter/delivery/ws`. Приватный ключ читается в `internal/config`, прокидывается через `app/` в `NewHandler`.
- **Формат кадра:** `u32 BE len ‖ payload`. Хендшейк: payload = сырое Noise-сообщение. Транспорт: payload = `CipherState.Encrypt(nil, nil, JSON)`. AD = nil (пустой). Единообразно (спека §2).
- **Plain-путь (`bearer`) не менять** — существующий `ws_integration_test` обязан оставаться зелёным.
- **Приватный статик сервера — только на сервере** (env `DNP_SERVER_PRIVKEY`), никогда в репозиторий/клиент.
- `gofmt -l` пусто, `go vet ./...` чисто, `go test ./...` зелёное. Команды из `backend/`.
- flynn/noise API (проверено v1.1.0): `Responder.ReadMessage1/WriteMessage2/Split`; `CipherState.Encrypt(out, ad, pt) ([]byte, error)` / `Decrypt(out, ad, ct) ([]byte, error)`.

## Файловая структура

- `internal/adapter/delivery/ws/dnp/codec.go` (новый) — `FrameLen`/`UnframeLen`/`EncryptFrame`/`DecryptFrame`.
- `internal/adapter/delivery/ws/dnp/codec_test.go` (новый).
- `internal/adapter/delivery/ws/conn.go` (правка) — интерфейс `frameCodec`, `plainCodec`, `dnpCodec`; `readPump`/`writePump` через кодек; `newConn` принимает кодек.
- `internal/adapter/delivery/ws/dnp_accept.go` (новый) — `dnpAccept(wsConn, responder, auth, ctx)`.
- `internal/adapter/delivery/ws/dnp_accept_test.go` (новый) — интеграционный (flynn/noise initiator).
- `internal/adapter/delivery/ws/handler.go` (правка) — ветка `dnp/1`, статик-ключ в `Handler`.
- `internal/config/config.go` (правка) — `DNPServerPrivKey` из `DNP_SERVER_PRIVKEY`.
- `internal/app/server.go` (правка) — прокинуть ключ в `NewHandler`.
- `cmd/dnpkeygen/main.go` (новый) — генератор Curve25519-пары.

---

### Task 1: `dnp/codec.go` — length-framing + encrypt/decrypt-frame

**Files:**
- Create: `backend/internal/adapter/delivery/ws/dnp/codec.go`
- Create: `backend/internal/adapter/delivery/ws/dnp/codec_test.go`

**Interfaces:**
- Produces: `FrameLen(payload []byte) []byte`; `UnframeLen(raw []byte) ([]byte, error)`; `EncryptFrame(cs *noise.CipherState, plaintext []byte) ([]byte, error)`; `DecryptFrame(cs *noise.CipherState, raw []byte) ([]byte, error)`; `const MaxFrameLen = 1 << 20`.

- [ ] **Step 1: Написать тест (падающий)**

`backend/internal/adapter/delivery/ws/dnp/codec_test.go`:
```go
package dnp

import (
	"bytes"
	"testing"

	"github.com/flynn/noise"
)

func TestFrameLenRoundTrip(t *testing.T) {
	for _, p := range [][]byte{{}, {1}, bytes.Repeat([]byte{7}, 500)} {
		got, err := UnframeLen(FrameLen(p))
		if err != nil || !bytes.Equal(got, p) {
			t.Fatalf("round-trip %d: %v %x", len(p), err, got)
		}
	}
}

func TestUnframeLenRejectsBadInput(t *testing.T) {
	if _, err := UnframeLen([]byte{0, 0}); err == nil {
		t.Fatal("short header must error")
	}
	// len says 10 but only 2 payload bytes
	if _, err := UnframeLen([]byte{0, 0, 0, 10, 1, 2}); err == nil {
		t.Fatal("length mismatch must error")
	}
}

// completeHandshake runs an NK handshake (flynn both sides) and returns the
// initiator's send state and the responder's recv state (same direction key pair).
func completeHandshake(t *testing.T) (iSend, rRecv *noise.CipherState) {
	t.Helper()
	cs := cipherSuite()
	serverStatic, err := cs.GenerateKeypair(bytesReader(bytes.Repeat([]byte{0x11}, 32)))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := NewResponder(bytes.Repeat([]byte{0x11}, 32), bytesReader(bytes.Repeat([]byte{0x33}, 32)))
	if err != nil {
		t.Fatal(err)
	}
	initHS, err := noise.NewHandshakeState(noise.Config{
		CipherSuite: cs, Random: bytesReader(bytes.Repeat([]byte{0x22}, 32)),
		Pattern: noise.HandshakeNK, Initiator: true, Prologue: []byte(prologueV1),
		PeerStatic: serverStatic.Public,
	})
	if err != nil {
		t.Fatal(err)
	}
	msg1, _, _, err := initHS.WriteMessage(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := resp.ReadMessage1(msg1); err != nil {
		t.Fatal(err)
	}
	msg2, err := resp.WriteMessage2()
	if err != nil {
		t.Fatal(err)
	}
	_, is, _, err := initHS.ReadMessage(nil, msg2)
	if err != nil {
		t.Fatal(err)
	}
	_, rRecv = resp.Split() // responder recv = initiator send direction
	return is, rRecv
}

func TestEncryptDecryptFrameRoundTrip(t *testing.T) {
	iSend, rRecv := completeHandshake(t)
	wire, err := EncryptFrame(iSend, []byte(`{"t":"ping"}`))
	if err != nil {
		t.Fatal(err)
	}
	got, err := DecryptFrame(rRecv, wire)
	if err != nil || string(got) != `{"t":"ping"}` {
		t.Fatalf("decrypt: %v %q", err, got)
	}
}
```

- [ ] **Step 2: Запустить — падает**

Run: `go test ./internal/adapter/delivery/ws/dnp/ -run 'Frame|EncryptDecrypt' -v`
Expected: FAIL (`FrameLen`/`UnframeLen`/`EncryptFrame`/`DecryptFrame` undefined).

- [ ] **Step 3: Реализовать**

`backend/internal/adapter/delivery/ws/dnp/codec.go`:
```go
package dnp

import (
	"encoding/binary"
	"errors"

	"github.com/flynn/noise"
)

// MaxFrameLen — верхняя граница payload одного кадра (совпадает с ws.maxMessageSize).
const MaxFrameLen = 1 << 20

// Формат кадра: u32 big-endian длина payload + payload. Над WS префикс избыточен
// (границы даёт сам WS), но закладываем его единообразно ради будущего сырого-TCP
// носителя (см. спеку DNP §4/§10.8). Хендшейк: payload = сырое Noise-сообщение;
// транспорт: payload = зашифрованный кадр.
func FrameLen(payload []byte) []byte {
	out := make([]byte, 4+len(payload))
	binary.BigEndian.PutUint32(out[:4], uint32(len(payload)))
	copy(out[4:], payload)
	return out
}

// UnframeLen снимает длину и валидирует, что она ровно соответствует остатку.
func UnframeLen(raw []byte) ([]byte, error) {
	if len(raw) < 4 {
		return nil, errors.New("dnp: short frame header")
	}
	n := binary.BigEndian.Uint32(raw[:4])
	if n > MaxFrameLen {
		return nil, errors.New("dnp: frame too large")
	}
	if int(n) != len(raw)-4 {
		return nil, errors.New("dnp: frame length mismatch")
	}
	return raw[4:], nil
}

// Seal/Open — только крипта (без длины), AD пустой. Для случаев, где длина уже снята
// (напр. auth-кадр после readWSFramed).
func Seal(cs *noise.CipherState, plaintext []byte) ([]byte, error) {
	return cs.Encrypt(nil, nil, plaintext)
}
func Open(cs *noise.CipherState, ciphertext []byte) ([]byte, error) {
	return cs.Decrypt(nil, nil, ciphertext)
}

// EncryptFrame шифрует прикладной кадр и оборачивает длиной: [len][Encrypt(pt)].
func EncryptFrame(cs *noise.CipherState, plaintext []byte) ([]byte, error) {
	ct, err := Seal(cs, plaintext)
	if err != nil {
		return nil, err
	}
	return FrameLen(ct), nil
}

// DecryptFrame снимает длину и расшифровывает: Open(unframe(raw)).
func DecryptFrame(cs *noise.CipherState, raw []byte) ([]byte, error) {
	ct, err := UnframeLen(raw)
	if err != nil {
		return nil, err
	}
	return Open(cs, ct)
}
```

- [ ] **Step 4: Тесты зелёные**

Run: `gofmt -w internal/adapter/delivery/ws/dnp/ && go test ./internal/adapter/delivery/ws/dnp/ -v`
Expected: все PASS (новые + существующие responder-тесты).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/adapter/delivery/ws/dnp/codec.go backend/internal/adapter/delivery/ws/dnp/codec_test.go
git commit -m "feat(dnp): length-framed codec (FrameLen/EncryptFrame) over Noise cipher-state

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `frameCodec`-шов в `conn.go`

**Files:**
- Modify: `backend/internal/adapter/delivery/ws/conn.go`
- Create: `backend/internal/adapter/delivery/ws/dnp_support_test.go` (общие тест-хелперы пакета `ws`)
- Create: `backend/internal/adapter/delivery/ws/codec_seam_test.go`

**Interfaces:**
- Consumes: `dnp.EncryptFrame`/`dnp.DecryptFrame` (Task 1), `noise.CipherState`.
- Produces: `type frameCodec interface { decode(raw []byte) ([]byte, error); encode(frame []byte) (int, []byte) }`; `plainCodec`; `newDNPCodec(send, recv *noise.CipherState) frameCodec`; `newConn(..., codec frameCodec)`. Тест-хелперы (package `ws`, переиспользуются Task 3): `type fixedReader struct{ b []byte }`, `dnpCipherPair(t) (iSend, rRecv *noise.CipherState)`.

- [ ] **Step 1: Общий тест-хелпер + тест кодеков (падающий)**

`backend/internal/adapter/delivery/ws/dnp_support_test.go` — общие хелперы пакета `ws` (Task 3 их переиспользует, чтобы не дублировать символы):
```go
package ws

import (
	"bytes"
	"testing"

	"github.com/flynn/noise"
	"github.com/messenger-denis/backend/internal/adapter/delivery/ws/dnp"
)

// fixedReader — детерминированный io.Reader для ключей/эфемералей в тестах.
type fixedReader struct{ b []byte }

func (f fixedReader) Read(p []byte) (int, error) { return copy(p, f.b), nil }

func dnpSuite() noise.CipherSuite {
	return noise.NewCipherSuite(noise.DH25519, noise.CipherChaChaPoly, noise.HashBLAKE2s)
}

// dnpCipherPair гоняет полный NK-хендшейк (flynn обе стороны) и возвращает
// send initiator'а и recv responder'а (одно направление — один ключ).
func dnpCipherPair(t *testing.T) (iSend, rRecv *noise.CipherState) {
	t.Helper()
	cs := dnpSuite()
	serverStatic, err := cs.GenerateKeypair(fixedReader{bytes.Repeat([]byte{0x11}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	resp, err := dnp.NewResponder(bytes.Repeat([]byte{0x11}, 32), fixedReader{bytes.Repeat([]byte{0x33}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	initHS, err := noise.NewHandshakeState(noise.Config{
		CipherSuite: cs, Random: fixedReader{bytes.Repeat([]byte{0x22}, 32)},
		Pattern: noise.HandshakeNK, Initiator: true, Prologue: []byte("dnp/1"),
		PeerStatic: serverStatic.Public,
	})
	if err != nil {
		t.Fatal(err)
	}
	msg1, _, _, _ := initHS.WriteMessage(nil, nil)
	if err := resp.ReadMessage1(msg1); err != nil {
		t.Fatal(err)
	}
	msg2, _ := resp.WriteMessage2()
	_, is, _, err := initHS.ReadMessage(nil, msg2)
	if err != nil {
		t.Fatal(err)
	}
	_, rRecv = resp.Split()
	return is, rRecv
}
```

`backend/internal/adapter/delivery/ws/codec_seam_test.go`:
```go
package ws

import (
	"bytes"
	"testing"

	"github.com/gorilla/websocket"
)

func TestPlainCodecIdentity(t *testing.T) {
	c := plainCodec{}
	mt, out := c.encode([]byte(`{"t":"x"}`))
	if mt != websocket.TextMessage || string(out) != `{"t":"x"}` {
		t.Fatalf("encode: %d %q", mt, out)
	}
	got, err := c.decode([]byte(`{"t":"x"}`))
	if err != nil || string(got) != `{"t":"x"}` {
		t.Fatalf("decode: %v %q", err, got)
	}
}

func TestDNPCodecRoundTripBinary(t *testing.T) {
	send, recv := dnpCipherPair(t) // общий хелпер из dnp_support_test.go
	c := newDNPCodec(send, nil)
	mt, wire := c.encode([]byte(`{"t":"ping"}`))
	if mt != websocket.BinaryMessage {
		t.Fatalf("dnp must use binary, got %d", mt)
	}
	dec := newDNPCodec(nil, recv)
	got, err := dec.decode(wire)
	if err != nil || !bytes.Equal(got, []byte(`{"t":"ping"}`)) {
		t.Fatalf("decode: %v %q", err, got)
	}
}
```
Хелпер `dnpCipherPair` определён в `dnp_support_test.go` (тот же пакет `ws`) — не дублировать.

- [ ] **Step 2: Запустить — падает**

Run: `go test ./internal/adapter/delivery/ws/ -run 'Codec' -v`
Expected: FAIL (`plainCodec`/`newDNPCodec` undefined).

- [ ] **Step 3: Реализовать шов в `conn.go`**

Добавить в `conn.go` (после импортов; добавить импорты `"github.com/flynn/noise"` и `".../ws/dnp"`):
```go
// frameCodec абстрагирует чтение/запись байтов ОДНОГО кадра. dispatch/hub/pump
// от шифрования не зависят — DNP вклинивается только здесь.
type frameCodec interface {
	decode(raw []byte) ([]byte, error)  // WS-байты → plaintext JSON-кадр
	encode(frame []byte) (int, []byte)  // JSON-кадр → (websocket msgType, WS-байты)
}

// plainCodec — текущий путь: text-кадры JSON as-is.
type plainCodec struct{}

func (plainCodec) decode(raw []byte) ([]byte, error) { return raw, nil }
func (plainCodec) encode(frame []byte) (int, []byte) { return websocket.TextMessage, frame }

// dnpCodec — Noise-канал: binary + шифрование каждого кадра. send использует
// только writePump, recv — только readPump (гонок нет).
type dnpCodec struct{ send, recv *noise.CipherState }

func newDNPCodec(send, recv *noise.CipherState) frameCodec { return &dnpCodec{send: send, recv: recv} }

func (c *dnpCodec) decode(raw []byte) ([]byte, error) { return dnp.DecryptFrame(c.recv, raw) }
func (c *dnpCodec) encode(frame []byte) (int, []byte) {
	out, err := dnp.EncryptFrame(c.send, frame)
	if err != nil {
		return websocket.BinaryMessage, nil // nil → writePump пропустит (см. Step 4)
	}
	return websocket.BinaryMessage, out
}
```

- [ ] **Step 4: Прошить кодек в `Conn`/`newConn`/`readPump`/`writePump`**

В `conn.go`:
```go
// поле в struct Conn:
	codec    frameCodec
```
```go
// newConn — добавить параметр codec последним:
func newConn(ws *websocket.Conn, hub *Hub, svc *usecasechat.Interactor, presence Presence, userID, deviceID int64, codec frameCodec) *Conn {
	return &Conn{ws: ws, hub: hub, svc: svc, presence: presence, userID: userID, deviceID: deviceID, send: make(chan []byte, sendBuffer), codec: codec}
}
```
`readPump` — заменить разбор входящего сообщения:
```go
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		_ = c.ws.SetReadDeadline(time.Now().Add(pongWait))
		plain, err := c.codec.decode(data)
		if err != nil {
			continue // битый/недешифруемый кадр — пропускаем (обрыв придёт отдельно)
		}
		var f Frame
		if json.Unmarshal(plain, &f) != nil {
			continue
		}
		c.dispatch(ctx, f)
```
`writePump` — заменить запись прикладного кадра (ping/close ветки не трогать):
```go
		case frame, ok := <-c.send:
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.ws.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			mt, out := c.codec.encode(frame)
			if out == nil {
				return // сбой шифрования — рвём соединение (клиент переустановит канал)
			}
			if err := c.ws.WriteMessage(mt, out); err != nil {
				return
			}
```

- [ ] **Step 5: Обновить существующий вызов `newConn` (plain-путь)**

В `handler.go` (строка ~75) — временно передать `plainCodec{}` (полноценная ветка dnp — в Task 4):
```go
	conn := newConn(wsConn, h.hub, h.chatSvc, h.presence, user.ID, deviceID, plainCodec{})
```

- [ ] **Step 6: Тесты — новые кодеки + plain-путь не сломан**

Run: `gofmt -w internal/adapter/delivery/ws/ && go vet ./internal/adapter/delivery/ws/... && go test ./internal/adapter/delivery/ws/... -run 'Codec' -v`
Затем полный ws-пакет (нужен Docker для integration): `go test ./internal/adapter/delivery/ws/...`
Expected: кодек-тесты PASS; существующий `ws_integration_test` (plain) PASS — поведение не изменилось. Если Docker недоступен, отметь в отчёте, что integration-часть не гонялась, и убедись хотя бы что пакет компилируется (`go build ./...`) и unit-тесты зелёные.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/adapter/delivery/ws/conn.go backend/internal/adapter/delivery/ws/handler.go backend/internal/adapter/delivery/ws/codec_seam_test.go
git commit -m "refactor(ws): frameCodec seam (plain vs dnp) in conn read/write pumps

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `dnpAccept` — хендшейк + auth внутри канала (+ интеграционный тест)

**Files:**
- Create: `backend/internal/adapter/delivery/ws/dnp_accept.go`
- Create: `backend/internal/adapter/delivery/ws/dnp_accept_test.go`

**Interfaces:**
- Consumes: `dnp.NewResponder`/`FrameLen`/`UnframeLen`/`DecryptFrame`, `Authenticator`, `newDNPCodec`.
- Produces: `func dnpAccept(ctx context.Context, wsConn *websocket.Conn, serverPriv []byte, auth Authenticator) (codec frameCodec, userID, deviceID int64, err error)`.

- [ ] **Step 1: Написать интеграционный тест (падающий)**

`backend/internal/adapter/delivery/ws/dnp_accept_test.go`:
```go
package ws

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/flynn/noise"
	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/adapter/delivery/ws/dnp"
	"github.com/messenger-denis/backend/internal/domain"
)

type fakeAuth struct{ token string }

func (f fakeAuth) Authenticate(_ context.Context, token string) (domain.User, int64, error) {
	if token != f.token {
		return domain.User{}, 0, domain.ErrForbidden
	}
	return domain.User{ID: 42}, 7, nil
}

// fixedReader и dnpSuite определены в dnp_support_test.go (пакет ws) — не дублировать.
func TestDNPAcceptHandshakeAuthAndTransport(t *testing.T) {
	serverPriv := bytes.Repeat([]byte{0x11}, 32)
	cs := dnpSuite()
	serverStatic, _ := cs.GenerateKeypair(fixedReader{serverPriv})

	up := websocket.Upgrader{Subprotocols: []string{"dnp/1"}, CheckOrigin: func(*http.Request) bool { return true }}
	var gotUser, gotDevice int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wsConn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		codec, uid, did, err := dnpAccept(r.Context(), wsConn, serverPriv, fakeAuth{token: "good"})
		if err != nil {
			_ = wsConn.Close()
			return
		}
		gotUser, gotDevice = uid, did
		// Отправить один зашифрованный кадр обратно (проверка send-стороны).
		_, out := codec.encode([]byte(`{"t":"pong"}`))
		_ = wsConn.WriteMessage(websocket.BinaryMessage, out)
	}))
	defer srv.Close()

	// Клиент: flynn/noise NK initiator по dnp/1.
	url := "ws" + strings.TrimPrefix(srv.URL, "http")
	d := websocket.Dialer{Subprotocols: []string{"dnp/1"}}
	conn, _, err := d.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	initHS, _ := noise.NewHandshakeState(noise.Config{
		CipherSuite: cs, Random: rand.Reader, Pattern: noise.HandshakeNK,
		Initiator: true, Prologue: []byte("dnp/1"), PeerStatic: serverStatic.Public,
	})
	msg1, _, _, _ := initHS.WriteMessage(nil, nil)
	_ = conn.WriteMessage(websocket.BinaryMessage, dnp.FrameLen(msg1))

	_, raw, _ := conn.ReadMessage()
	m2, _ := dnp.UnframeLen(raw)
	_, iSend, iRecv, err := initHS.ReadMessage(nil, m2)
	if err != nil {
		t.Fatalf("read msg2: %v", err)
	}
	// auth-кадр (sealed).
	authWire, _ := dnp.EncryptFrame(iSend, []byte(`{"t":"auth","d":{"token":"good"}}`))
	_ = conn.WriteMessage(websocket.BinaryMessage, authWire)

	// Ответный pong.
	_, praw, _ := conn.ReadMessage()
	pong, err := dnp.DecryptFrame(iRecv, praw)
	if err != nil {
		t.Fatalf("decrypt pong: %v", err)
	}
	var f struct{ T string }
	_ = json.Unmarshal(pong, &f)
	if f.T != "pong" {
		t.Fatalf("want pong, got %q", pong)
	}
	if gotUser != 42 || gotDevice != 7 {
		t.Fatalf("auth not wired: user=%d device=%d", gotUser, gotDevice)
	}
}
```

> ПРИМЕЧАНИЕ: тест использует `dnp.CipherSuiteForTest()`/`dnp.BytesReaderForTest()`. В Task 1 экспортируй эти тонкие тест-хелперы из пакета `dnp` (или, если не хочешь расширять публичную поверхность, в этом тесте пересобери suite локально: `noise.NewCipherSuite(noise.DH25519, noise.CipherChaChaPoly, noise.HashBLAKE2s)` и inline-reader). Выбери один вариант и примени единообразно.

- [ ] **Step 2: Запустить — падает**

Run: `go test ./internal/adapter/delivery/ws/ -run 'DNPAccept' -v`
Expected: FAIL (`dnpAccept` undefined).

- [ ] **Step 3: Реализовать `dnpAccept`**

`backend/internal/adapter/delivery/ws/dnp_accept.go`:
```go
package ws

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"time"

	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/adapter/delivery/ws/dnp"
)

const dnpHandshakeWait = 10 * time.Second

// dnpAccept выполняет Noise_NK хендшейк по уже апгрейженному сокету и авторизацию
// первым кадром внутри канала. Возвращает готовый dnpCodec и пользователя.
func dnpAccept(ctx context.Context, wsConn *websocket.Conn, serverPriv []byte, auth Authenticator) (frameCodec, int64, int64, error) {
	responder, err := dnp.NewResponder(serverPriv, rand.Reader)
	if err != nil {
		return nil, 0, 0, err
	}
	_ = wsConn.SetReadDeadline(time.Now().Add(dnpHandshakeWait))

	// msg1 (e, es)
	msg1, err := readWSFramed(wsConn)
	if err != nil {
		return nil, 0, 0, err
	}
	if err := responder.ReadMessage1(msg1); err != nil {
		return nil, 0, 0, err
	}
	// msg2 (e, ee)
	msg2, err := responder.WriteMessage2()
	if err != nil {
		return nil, 0, 0, err
	}
	_ = wsConn.SetWriteDeadline(time.Now().Add(dnpHandshakeWait))
	if err := wsConn.WriteMessage(websocket.BinaryMessage, dnp.FrameLen(msg2)); err != nil {
		return nil, 0, 0, err
	}
	send, recv := responder.Split()

	// первый кадр внутри канала — auth{token}
	authCiphertext, err := readWSFramed(wsConn)
	if err != nil {
		return nil, 0, 0, err
	}
	plain, err := dnp.Open(recv, authCiphertext) // длина уже снята readWSFramed
	if err != nil {
		return nil, 0, 0, err
	}
	var f struct {
		T string `json:"t"`
		D struct {
			Token string `json:"token"`
		} `json:"d"`
	}
	if json.Unmarshal(plain, &f) != nil || f.T != "auth" || f.D.Token == "" {
		return nil, 0, 0, errors.New("dnp: expected auth frame")
	}
	user, deviceID, err := auth.Authenticate(ctx, f.D.Token)
	if err != nil {
		return nil, 0, 0, err
	}
	_ = wsConn.SetReadDeadline(time.Time{}) // снять дедлайн хендшейка
	return newDNPCodec(send, recv), user.ID, deviceID, nil
}

// readWSFramed читает бинарное WS-сообщение и снимает length-префикс.
func readWSFramed(wsConn *websocket.Conn) ([]byte, error) {
	mt, data, err := wsConn.ReadMessage()
	if err != nil {
		return nil, err
	}
	if mt != websocket.BinaryMessage {
		return nil, errors.New("dnp: expected binary frame")
	}
	return dnp.UnframeLen(data)
}
```

> `readWSFramed` снимает длину и отдаёт ciphertext; `dnp.Open` (Task 1) расшифровывает без длины.
> `DecryptFrame` (с длиной) используется только conn-путём, который получает сырой WS-байт `[len][ct]`.

- [ ] **Step 4: Тесты зелёные**

Run: `gofmt -w internal/adapter/delivery/ws/ && go test ./internal/adapter/delivery/ws/ -run 'DNPAccept|Codec' -v`
Expected: PASS — хендшейк, auth (user=42/device=7), обратный pong расшифрован.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/adapter/delivery/ws/dnp_accept.go backend/internal/adapter/delivery/ws/dnp_accept_test.go backend/internal/adapter/delivery/ws/dnp/codec.go backend/internal/adapter/delivery/ws/dnp/codec_test.go
git commit -m "feat(dnp): server dnpAccept — Noise handshake + in-channel auth frame

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: dual-mode в `handler.go` + конфиг `DNP_SERVER_PRIVKEY` + `cmd/dnpkeygen`

**Files:**
- Modify: `backend/internal/adapter/delivery/ws/handler.go`
- Modify: `backend/internal/config/config.go`
- Modify: `backend/internal/app/server.go`
- Create: `backend/cmd/dnpkeygen/main.go`

**Interfaces:**
- Consumes: `dnpAccept` (Task 3), `newConn` (Task 2).
- Produces: `Handler` с полем `dnpServerPriv []byte`; `NewHandler(..., dnpServerPrivHex string)`.

- [ ] **Step 1: Конфиг — прочитать `DNP_SERVER_PRIVKEY`**

`backend/internal/config/config.go` — добавить поле в `Config` и чтение:
```go
	DNPServerPrivKey string // hex 32-байтного Curve25519 приватного статик-ключа сервера (DNP). Пусто → DNP выключен.
```
рядом с остальными `os.Getenv`:
```go
	c.DNPServerPrivKey = os.Getenv("DNP_SERVER_PRIVKEY")
```

- [ ] **Step 2: `handler.go` — принять ключ и ветвить по subprotocol**

`Handler` — добавить поле и параметр конструктора:
```go
	dnpServerPriv []byte // nil → DNP выключен (ветка dnp/1 не активируется)
```
`NewHandler(...)` — добавить последний параметр `dnpServerPrivHex string`; в теле:
```go
	var dnpPriv []byte
	if dnpServerPrivHex != "" {
		if b, err := hex.DecodeString(dnpServerPrivHex); err == nil && len(b) == 32 {
			dnpPriv = b
		}
	}
```
и положить `dnpServerPriv: dnpPriv` в возвращаемый `Handler`. Добавить `"encoding/hex"` в импорты. В апгрейдер добавить `dnp/1`:
```go
			Subprotocols: []string{"bearer", "dnp/1"},
```
`ServeHTTP` — в начале ветка DNP (перед текущей plain-логикой):
```go
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.dnpServerPriv != nil && hasSubprotocol(r, "dnp/1") {
		wsConn, err := h.upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		codec, userID, deviceID, err := dnpAccept(r.Context(), wsConn, h.dnpServerPriv, h.auth)
		if err != nil {
			_ = wsConn.Close()
			return
		}
		conn := newConn(wsConn, h.hub, h.chatSvc, h.presence, userID, deviceID, codec)
		conn.run(r.Context())
		return
	}
	// ... существующий plain-путь без изменений, но newConn получает plainCodec{} ...
}

func hasSubprotocol(r *http.Request, want string) bool {
	for _, p := range websocket.Subprotocols(r) {
		if p == want {
			return true
		}
	}
	return false
}
```
(Убедись, что plain-ветка `newConn(...)` уже передаёт `plainCodec{}` из Task 2 Step 5.)

- [ ] **Step 3: DI — прокинуть ключ в `NewHandler`**

`backend/internal/app/server.go:204` — добавить аргумент:
```go
		wsHandler = ws.NewHandler(hub, p.AuthUC, p.ChatUC, presenceMgr, p.Cfg.WebAuthnOrigins, p.Cfg.DNPServerPrivKey)
```

- [ ] **Step 4: `cmd/dnpkeygen`**

`backend/cmd/dnpkeygen/main.go`:
```go
// Command dnpkeygen генерит Curve25519-пару для DNP: приватный → env DNP_SERVER_PRIVKEY
// (только на сервере), публичный → VITE_DNP_SERVER_PUBKEYS (билд фронта).
package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/flynn/noise"
)

func main() {
	kp, err := noise.DH25519.GenerateKeypair(rand.Reader)
	if err != nil {
		panic(err)
	}
	fmt.Printf("DNP_SERVER_PRIVKEY=%s\n", hex.EncodeToString(kp.Private))
	fmt.Printf("VITE_DNP_SERVER_PUBKEYS=%s\n", hex.EncodeToString(kp.Public))
}
```

- [ ] **Step 5: Собрать, проверить, keygen работает**

Run:
```
gofmt -w internal/ cmd/ && go vet ./... && go build ./... && go run ./cmd/dnpkeygen
```
Expected: сборка чистая; `dnpkeygen` печатает две строки (priv 64 hex, pub 64 hex). Плюс полный ws-тест (Docker): `go test ./internal/adapter/delivery/ws/...` — dual-mode-тест и plain integration зелёные.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/adapter/delivery/ws/handler.go backend/internal/config/config.go backend/internal/app/server.go backend/cmd/dnpkeygen/main.go
git commit -m "feat(dnp): dual-mode ws handler (dnp/1 subprotocol) + DNP_SERVER_PRIVKEY + dnpkeygen

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Финальная проверка PR-1b-ii-a

- [ ] `cd backend && gofmt -l internal/ cmd/` (пусто), `go vet ./...`, `go build ./...` — чисто.
- [ ] `go test ./internal/adapter/delivery/ws/...` — dnpAccept integration + codec + существующий plain integration зелёные (нужен Docker для integration; если недоступен — отметить и прогнать unit).
- [ ] `go run ./cmd/dnpkeygen` печатает пару ключей.
- [ ] Клиент НЕ трогали; флаг `DNP_ENABLED` на клиенте по-прежнему OFF (заглушка кидает) — DNP-путь бэка активируется только при заданном `DNP_SERVER_PRIVKEY`.
- [ ] Приватный ключ нигде не закоммичен.
- [ ] PR в `main`, ветка `feat/dnp-channel-backend`.

## Self-review (проверено при написании плана)

- **Покрытие спеки §4:** codec.go (Task 1), frameCodec-шов conn.go (Task 2), dnpAccept хендшейк+auth (Task 3), dual-mode handler + config + DI + dnpkeygen (Task 4). Клиент (§5) — вне этого PR.
- **Plain-путь не сломан:** Task 2 Step 5 сразу переводит существующий `newConn` на `plainCodec{}` (identity/Text) — поведение 1:1; существующий integration-тест — регрессионный гейт.
- **Плейсхолдеры:** реальный Go. Два места с явной инструкцией выбора (тест-хелперы `dnp` экспортировать vs inline; `DecryptFrame` с длиной vs добавить `Open` без длины) — контролируемые точки, обе с рекомендацией; реализатор фиксирует один вариант и применяет единообразно.
- **Согласованность:** `FrameLen`/`UnframeLen`/`EncryptFrame`/`DecryptFrame` (Task 1) ↔ `dnpCodec` (Task 2) ↔ `dnpAccept` (Task 3); `newConn(codec)` (Task 2) ↔ вызовы в handler (Task 4); `NewHandler(...,privHex)` (Task 4) ↔ `server.go` (Task 4).
- **Безопасность:** приватный ключ только из env, декодируется в память, в фикстуры/логи/репозиторий не пишется; `dnpkeygen` печатает в stdout (оператор сам разложит по секретам).
