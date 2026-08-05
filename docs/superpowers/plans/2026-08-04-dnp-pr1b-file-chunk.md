# DNP PR-1b — file-кадры + чанк-протокол Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Скачивание медиа чанками через зашифрованный DNP-канал (бинарный kind 0x01 `file_chunk` ← JSON `file_req`), плюс клиентский download-примитив и один живой консюмер (изображения → blob-URL при DNP-ON).

**Architecture:** Клиент шлёт JSON-кадр `file_req{req_id, media_id, offset, limit}`; сервер (как `rpc_req`: горутина + семафор) проверяет доступ к `media_id` через существующий `MediaAccess.CanAccessMedia`, читает байты из MinIO через `media.Interactor.GetContent`→`Seek(offset)`, отвечает бинарным кадром `file_chunk`. Ошибка → JSON-кадр `file_err{req_id, error}`. Клиент коррелирует чанки по `req_id` (зеркало `ChannelRpc`), собирает Blob.

**Tech Stack:** Go 1.25 (flynn/noise, gorilla/websocket, MinIO), React 19 / TS strict (SharedWorker RPC через SuperMessagePort, DnpTransport поверх Noise_NK).

**Спека-источник:** [`../specs/2026-08-04-dnp-l5-media-channel-design.md`](../specs/2026-08-04-dnp-l5-media-channel-design.md) § «Чанк-протокол (PR-1b)». PR-1a (protocol v2 `dnp/2` + kind-байт) уже смёржен (#130) — база для этого PR.

## Global Constraints

- **Kind-байты:** `0x00` = JSON-кадр (существует), `0x01` = бинарный `file_chunk` (этот PR). Kind — первый байт **plaintext** (внутри AEAD-конверта); кладётся/снимается на слое `conn.go`/`DnpTransport`, НЕ в codec seal/open (codec байто-агностичен).
- **Бинарный layout `file_chunk`** (payload ПОСЛЕ kind-байта, всё Big-Endian): `req_id(u32) │ offset(u64) │ total(u64) │ len(u32) │ data(len байт)`. Header = 24 байта. `total` = полный размер файла (для прогресса/EOF). Последний чанк: `offset+len == total`.
- **`req_id`:** клиентский счётчик `u32` (обёртка при переполнении), отдельный от строковых `req_id` `ChannelRpc`.
- **Ошибки:** сервер шлёт JSON `{t:"file_err", d:{req_id, error}}` (kind 0x00). Нет доступа → `error:"forbidden"`; иначе → `error:"error"`. Не течёт наличие/отсутствие объекта. Клиентский `fetchFilePart` реджектит по `req_id`.
- **Размер чанка (клиент):** `512 * 1024`. Гарантированно < `maxMessageSize` (1 MiB) даже с header+kind+AEAD-tag.
- **Конкурентность (сервер):** `fileMaxConcurrent = 16`, неблокирующий семафор (как `rpcSem`); переполнение → `file_err{error:"busy"}`.
- **DNP за флагом** (`AppConfig.dnp.enabled` / `Handler.dnpServerPriv != nil`), не в проде. Plain-WS путь (native HTTP media) не трогаем.
- **Отвечать по-русски**, комментарии в коде — как в окружающем коде (RU, по делу). Мёртвый код не оставлять.

## Design decisions (подтверждено пользователем 2026-08-04)

1. **Ошибки — JSON-кадр `file_err`** (не молчаливый дроп): клиент реджектит сразу, отлаживаемо.
2. **Клиентский scope — примитив + один консюмер:** `fetchFilePart`/`downloadMedia`→Blob + разводка изображений (`useMediaContentUrl`) на blob-URL при DNP-ON (даёт живой e2e). Рендер `<video>`/стриминг — PR-2.

## File Structure

**Backend (`backend/internal/adapter/delivery/`):**
- `ws/conn.go` — параметризация `frameCodec.encode(kind, frame)`, `outFrame`, `Send`/`SendBinary`, поля conn `file`/`fileSem`, dispatch `case "file_req"`.
- `ws/file.go` *(новый)* — `fileReqData`, `fileChunkFrame`, `fileErrFrame`, интерфейс `FileDispatcher`, `fileMaxConcurrent`.
- `ws/handler.go` — поле `Handler.file`, `SetFileDispatcher`, проброс в `newConn`.
- `http/file_stream.go` *(новый)* — `FileStreamer{access, svc}`, `NewFileStreamer`, `ReadPart` (access-check + `GetContent` + Seek + read + clamp).
- `app/server.go` — `h.SetFileDispatcher(NewFileStreamer(p.ChatUC, mediaUC))`.
- Тесты: `ws/codec_seam_test.go` (правка), `ws/file_test.go` *(новый)*, `ws/file_dispatch_test.go` *(новый)*, `http/file_stream_test.go` *(новый)*, `ws/file_e2e_test.go` *(новый)*.

**Frontend (`web-client/src/core/`):**
- `net/transport.ts` — `onBinary(cb)` в интерфейс `Transport`.
- `net/dnp/dnpTransport.ts` — `KIND_FILE`, ветка `0x01` в `onMessage`, `binaryCbs`, `onBinary`.
- `net/wsClient.ts` — `onBinary()` no-op (plain-WS не шлёт бинарь).
- `net/dnp/fileDownload.ts` *(новый)* — `newFileDownload(transport)`: `fetchFilePart`, `downloadMedia`.
- `worker.ts` — конструкция `fileDownload`, проброс в `newMediaManager`.
- `managers/mediaManager.ts` — опц. dep `fileDownload`, метод `contentBlob(id)`.
- `hooks/useMediaContentUrl.ts` — DNP-путь: `contentBlob`→`createObjectURL` + revoke + fallback.
- Тесты: `net/dnp/dnpTransport.test.ts` (правка), `net/dnp/fileDownload.test.ts` *(новый)*, `managers/mediaManager.test.ts` (правка/новый).

---

### Task 1: Backend — бинарный send-путь (kind-параметр codec + SendBinary)

**Files:**
- Modify: `backend/internal/adapter/delivery/ws/conn.go`
- Test: `backend/internal/adapter/delivery/ws/codec_seam_test.go` (правка существующих вызовов)

**Interfaces:**
- Produces: `frameCodec.encode(kind byte, frame []byte) (int, []byte)`; `frameKindFile byte = 0x01`; `(*Conn).SendBinary(payload []byte)`; тип `outFrame{kind byte; data []byte}`.
- Consumes: существующий `dnp.EncryptFrame`, `frameKindJSON = 0x00`.

- [ ] **Step 1: Обновить тест codec_seam под новую сигнатуру encode**

В `codec_seam_test.go` заменить оба вызова `encode` и добавить проверку kind 0x01. Полный новый файл-тело функций:

```go
func TestPlainCodecIdentity(t *testing.T) {
	c := plainCodec{}
	mt, out := c.encode(frameKindJSON, []byte(`{"t":"x"}`))
	if mt != websocket.TextMessage || string(out) != `{"t":"x"}` {
		t.Fatalf("encode: %d %q", mt, out)
	}
	got, err := c.decode([]byte(`{"t":"x"}`))
	if err != nil || string(got) != `{"t":"x"}` {
		t.Fatalf("decode: %v %q", err, got)
	}
}

func TestDNPCodecRoundTripBinary(t *testing.T) {
	send, recv := dnpCipherPair(t)
	c := newDNPCodec(send, nil)
	mt, wire := c.encode(frameKindJSON, []byte(`{"t":"ping"}`))
	if mt != websocket.BinaryMessage {
		t.Fatalf("dnp must use binary, got %d", mt)
	}
	dec := newDNPCodec(nil, recv)
	got, err := dec.decode(wire)
	if err != nil || !bytes.Equal(got, []byte(`{"t":"ping"}`)) {
		t.Fatalf("decode: %v %q", err, got)
	}
}

// file-kind (0x01): decode ('только JSON') должен отвергнуть чужой kind, но сам
// зашифрованный payload должен нести именно 0x01 первым байтом plaintext.
func TestDNPCodecEncodeFileKind(t *testing.T) {
	send, recv := dnpCipherPair(t)
	enc := newDNPCodec(send, nil)
	payload := []byte{0xde, 0xad, 0xbe, 0xef}
	mt, wire := enc.encode(frameKindFile, payload)
	if mt != websocket.BinaryMessage {
		t.Fatalf("want binary, got %d", mt)
	}
	// расшифруем на низком уровне: plaintext = [0x01] ++ payload
	plain, err := dnp.DecryptFrame(recv, wire)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if len(plain) != 1+len(payload) || plain[0] != frameKindFile || !bytes.Equal(plain[1:], payload) {
		t.Fatalf("plaintext mismatch: %x", plain)
	}
}
```

Добавить импорт пакета `dnp` в тест, если его ещё нет: `"github.com/messenger-denis/backend/internal/adapter/delivery/ws/dnp"`.

- [ ] **Step 2: Прогнать тест — падает на компиляции (старая сигнатура encode)**

Run: `cd backend && go test ./internal/adapter/delivery/ws/ -run 'Codec' 2>&1 | head`
Expected: FAIL — `too many arguments in call to c.encode` / `undefined: frameKindFile`.

- [ ] **Step 3: Параметризовать encode kind-байтом + добавить SendBinary/outFrame**

В `conn.go`:

(a) Интерфейс `frameCodec` — сменить сигнатуру `encode`:

```go
type frameCodec interface {
	decode(raw []byte) ([]byte, error)         // WS-байты → plaintext-кадр (без kind)
	encode(kind byte, frame []byte) (int, []byte) // (kind, payload) → (websocket msgType, WS-байты)
}
```

(b) `plainCodec.encode` — kind игнорируется (plain-WS шлёт JSON-текст as-is; бинарные file-кадры на plain-путь не попадают):

```go
func (plainCodec) encode(_ byte, frame []byte) (int, []byte) { return websocket.TextMessage, frame }
```

(c) Рядом с `frameKindJSON` добавить file-kind:

```go
const frameKindJSON byte = 0x00
// frameKindFile — бинарный media-чанк (PR-1b). Первый байт plaintext внутри
// AEAD-конверта; codec seal/open остаётся байто-агностичным.
const frameKindFile byte = 0x01
```

(d) `dnpCodec.encode` — клеить переданный kind:

```go
func (c *dnpCodec) encode(kind byte, frame []byte) (int, []byte) {
	out, err := dnp.EncryptFrame(c.send, append([]byte{kind}, frame...))
	if err != nil {
		return websocket.BinaryMessage, nil // nil → writePump рвёт соединение
	}
	return websocket.BinaryMessage, out
}
```

(e) Тип очереди отправки — нести kind. Добавить рядом с `Conn`:

```go
// outFrame — единица очереди отправки: kind (0x00 JSON / 0x01 file) + payload.
type outFrame struct {
	kind byte
	data []byte
}
```

(f) Поле `send` в `Conn` и в `newConn` — сменить тип на `chan outFrame`:

```go
	send     chan outFrame
```
```go
		send: make(chan outFrame, sendBuffer), codec: codec,
```

(g) `Send` + новый `SendBinary` (общий неблокирующий enqueue):

```go
// Send queues a JSON frame (kind 0x00) for the writer. Drops the frame if the
// buffer is full (a stuck client must not block fan-out).
func (c *Conn) Send(frame []byte) { c.enqueue(outFrame{frameKindJSON, frame}) }

// SendBinary queues a raw binary payload (kind 0x01, media-чанк). Drop-if-full
// как Send. Плейн-conn его не зовёт (file_req обслуживается лишь при c.file != nil).
func (c *Conn) SendBinary(payload []byte) { c.enqueue(outFrame{frameKindFile, payload}) }

func (c *Conn) enqueue(f outFrame) {
	select {
	case c.send <- f:
	default:
	}
}
```

(h) `writePump` — распаковать `outFrame` и передать kind в encode:

```go
		case f, ok := <-c.send:
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.ws.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			mt, out := c.codec.encode(f.kind, f.data)
			if out == nil {
				return // сбой шифрования — рвём соединение (клиент переустановит канал)
			}
			if err := c.ws.WriteMessage(mt, out); err != nil {
				return
			}
```

- [ ] **Step 4: Прогнать тесты codec_seam — зелёные**

Run: `cd backend && go test ./internal/adapter/delivery/ws/ -run 'Codec' -v 2>&1 | tail -20`
Expected: PASS (`TestPlainCodecIdentity`, `TestDNPCodecRoundTripBinary`, `TestDNPCodecEncodeFileKind`).

- [ ] **Step 5: Убедиться, что весь пакет ws компилируется/зелёный**

Run: `cd backend && go build ./... && go test ./internal/adapter/delivery/ws/ 2>&1 | tail -20`
Expected: сборка ок; существующие ws-тесты (rpc/dispatch/dnp) зелёные — kind 0x00 путь не сломан.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/adapter/delivery/ws/conn.go backend/internal/adapter/delivery/ws/codec_seam_test.go
git commit -m "feat(dnp): параметризовать frameCodec.encode kind-байтом + Conn.SendBinary (file 0x01)"
```

---

### Task 2: Backend — file-кадры, интерфейс FileDispatcher, поля conn

**Files:**
- Create: `backend/internal/adapter/delivery/ws/file.go`
- Create: `backend/internal/adapter/delivery/ws/file_test.go`
- Modify: `backend/internal/adapter/delivery/ws/conn.go` (поля conn + newConn param)
- Modify: `backend/internal/adapter/delivery/ws/handler.go` (Handler.file + SetFileDispatcher + newConn call sites)

**Interfaces:**
- Consumes: `frameKindFile`, `SendBinary` (Task 1).
- Produces: `type FileDispatcher interface { ReadPart(ctx, userID, mediaID, offset, limit int64) ([]byte, int64, error) }`; `fileReqData`; `func fileChunkFrame(reqID uint32, offset, total int64, data []byte) []byte`; `func fileErrFrame(reqID uint32, msg string) []byte`; `const fileMaxConcurrent = 16`; `(*Handler).SetFileDispatcher(FileDispatcher)`; поля `Conn.file FileDispatcher`, `Conn.fileSem chan struct{}`.

- [ ] **Step 1: Написать тест на билдеры кадров**

`backend/internal/adapter/delivery/ws/file_test.go`:

```go
package ws

import (
	"encoding/binary"
	"encoding/json"
	"testing"
)

func TestFileChunkFrameLayout(t *testing.T) {
	data := []byte{0x01, 0x02, 0x03, 0x04, 0x05}
	frame := fileChunkFrame(7, 100, 500, data)
	if len(frame) != 24+len(data) {
		t.Fatalf("len = %d, want %d", len(frame), 24+len(data))
	}
	if got := binary.BigEndian.Uint32(frame[0:4]); got != 7 {
		t.Fatalf("req_id = %d", got)
	}
	if got := binary.BigEndian.Uint64(frame[4:12]); got != 100 {
		t.Fatalf("offset = %d", got)
	}
	if got := binary.BigEndian.Uint64(frame[12:20]); got != 500 {
		t.Fatalf("total = %d", got)
	}
	if got := binary.BigEndian.Uint32(frame[20:24]); got != uint32(len(data)) {
		t.Fatalf("len = %d", got)
	}
	if string(frame[24:]) != string(data) {
		t.Fatalf("data mismatch")
	}
}

func TestFileErrFrame(t *testing.T) {
	b := fileErrFrame(9, "forbidden")
	var f struct {
		T string `json:"t"`
		D struct {
			ReqID uint32 `json:"req_id"`
			Error string `json:"error"`
		} `json:"d"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if f.T != "file_err" || f.D.ReqID != 9 || f.D.Error != "forbidden" {
		t.Fatalf("bad frame: %+v", f)
	}
}
```

- [ ] **Step 2: Прогнать — падает (нет file.go)**

Run: `cd backend && go test ./internal/adapter/delivery/ws/ -run 'File' 2>&1 | head`
Expected: FAIL — `undefined: fileChunkFrame` / `undefined: fileErrFrame`.

- [ ] **Step 3: Создать file.go**

`backend/internal/adapter/delivery/ws/file.go`:

```go
package ws

import (
	"context"
	"encoding/binary"
	"encoding/json"
)

// fileMaxConcurrent ограничивает число одновременных file_req на соединение
// (как rpcMaxConcurrent): чтение чанка держит горутину + байты в памяти.
const fileMaxConcurrent = 16

// FileDispatcher отдаёт кусок медиа по offset/limit с проверкой прав юзера
// канала (реализуется в пакете http через FileStreamer). Несёт userID, чтобы ws
// не зависел от media/chat usecase напрямую.
type FileDispatcher interface {
	// ReadPart возвращает до limit байт с offset и total (полный размер файла).
	// Ошибка доступа → domain.ErrForbidden (маппится в file_err "forbidden").
	ReadPart(ctx context.Context, userID, mediaID, offset, limit int64) (data []byte, total int64, err error)
}

type fileReqData struct {
	ReqID   uint32 `json:"req_id"`
	MediaID int64  `json:"media_id"`
	Offset  int64  `json:"offset"`
	Limit   int64  `json:"limit"`
}

// fileChunkFrame сериализует бинарный media-чанк (payload ПОСЛЕ kind-байта 0x01,
// его клеит codec). Layout Big-Endian: req_id(u32)│offset(u64)│total(u64)│len(u32)│data.
func fileChunkFrame(reqID uint32, offset, total int64, data []byte) []byte {
	out := make([]byte, 24+len(data))
	binary.BigEndian.PutUint32(out[0:4], reqID)
	binary.BigEndian.PutUint64(out[4:12], uint64(offset))
	binary.BigEndian.PutUint64(out[12:20], uint64(total))
	binary.BigEndian.PutUint32(out[20:24], uint32(len(data)))
	copy(out[24:], data)
	return out
}

// fileErrFrame — JSON-кадр ошибки чанк-запроса (kind 0x00): клиент реджектит
// fetchFilePart по req_id.
func fileErrFrame(reqID uint32, msg string) []byte {
	b, _ := json.Marshal(map[string]any{
		"t": "file_err",
		"d": map[string]any{"req_id": reqID, "error": msg},
	})
	return b
}
```

- [ ] **Step 4: Добавить поля conn + newConn param + Handler wiring**

(a) `conn.go` — поля `Conn`:

```go
	rpc      RPCDispatcher // nil у plain-conn
	rpcSem   chan struct{} // ограничение конкурентности rpc-диспатча
	file     FileDispatcher // nil у plain-conn / до SetFileDispatcher
	fileSem  chan struct{}  // ограничение конкурентности file-диспатча
```

(b) `conn.go` — сигнатура и тело `newConn`:

```go
func newConn(ws *websocket.Conn, hub *Hub, svc *usecasechat.Interactor, presence Presence, user domain.User, deviceID int64, codec frameCodec, rpc RPCDispatcher, file FileDispatcher) *Conn {
	return &Conn{
		ws: ws, hub: hub, svc: svc, presence: presence,
		user: user, userID: user.ID, deviceID: deviceID,
		send: make(chan outFrame, sendBuffer), codec: codec,
		rpc: rpc, rpcSem: make(chan struct{}, rpcMaxConcurrent),
		file: file, fileSem: make(chan struct{}, fileMaxConcurrent),
	}
}
```

(c) `handler.go` — поле `Handler.file` (рядом с `rpc`), сеттер, проброс в оба вызова `newConn`:

```go
	rpc           RPCDispatcher // late-bound (см. SetRPCDispatcher); nil → rpc_req игнорируется
	file          FileDispatcher // late-bound (см. SetFileDispatcher); nil → file_req игнорируется
```
```go
// SetFileDispatcher связывает file-диспетчер после сборки роутера (как SetRPCDispatcher).
func (h *Handler) SetFileDispatcher(d FileDispatcher) { h.file = d }
```
DNP-путь (сейчас `newConn(..., codec, h.rpc)`):
```go
			conn := newConn(wsConn, h.hub, h.chatSvc, h.presence, user, deviceID, codec, h.rpc, h.file)
```
Plain-путь (сейчас `newConn(..., plainCodec{}, nil)`):
```go
	conn := newConn(wsConn, h.hub, h.chatSvc, h.presence, user, deviceID, plainCodec{}, nil, nil)
```

- [ ] **Step 5: Прогнать тесты + сборку — зелёные**

Run: `cd backend && go build ./... && go test ./internal/adapter/delivery/ws/ -run 'File' -v 2>&1 | tail -20`
Expected: PASS `TestFileChunkFrameLayout`, `TestFileErrFrame`; пакет собирается (все `newConn` обновлены).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/adapter/delivery/ws/file.go backend/internal/adapter/delivery/ws/file_test.go backend/internal/adapter/delivery/ws/conn.go backend/internal/adapter/delivery/ws/handler.go
git commit -m "feat(dnp): file-кадры (file_req/file_chunk/file_err) + FileDispatcher + conn wiring"
```

---

### Task 3: Backend — dispatch `case "file_req"`

**Files:**
- Modify: `backend/internal/adapter/delivery/ws/conn.go` (dispatch switch)
- Create: `backend/internal/adapter/delivery/ws/file_dispatch_test.go`

**Interfaces:**
- Consumes: `fileReqData`, `fileChunkFrame`, `fileErrFrame`, `FileDispatcher`, `SendBinary`, `c.fileSem`, `domain.ErrForbidden`.

- [ ] **Step 1: Тест диспатча через fake FileDispatcher**

`backend/internal/adapter/delivery/ws/file_dispatch_test.go`. Тест дёргает `dispatch` напрямую и читает результат из `c.send` (как это делают существующие dispatch-тесты; свериться с `rpc`-тестом на предмет хелперов сборки `Conn`). Учесть: chunk уходит через `SendBinary` (`outFrame.kind == frameKindFile`), ошибка — через `Send` (kind 0x00).

```go
package ws

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

type fakeFileDisp struct {
	data  []byte
	total int64
	err   error
}

func (f fakeFileDisp) ReadPart(_ context.Context, _, _, _, _ int64) ([]byte, int64, error) {
	return f.data, f.total, f.err
}

// drainSend ждёт один outFrame из очереди (тест-хелпер: dispatch запускает
// горутину, поэтому читаем с таймаутом через сам канал).
func drainSend(t *testing.T, c *Conn) outFrame {
	t.Helper()
	select {
	case f := <-c.send:
		return f
	case <-timeAfter():
		t.Fatal("no frame sent")
		return outFrame{}
	}
}

func TestDispatchFileReqChunk(t *testing.T) {
	c := &Conn{
		user:    domain.User{ID: 42},
		userID:  42,
		send:    make(chan outFrame, 4),
		file:    fakeFileDisp{data: []byte("hello"), total: 5},
		fileSem: make(chan struct{}, fileMaxConcurrent),
	}
	c.dispatch(context.Background(), Frame{T: "file_req", D: json.RawMessage(`{"req_id":7,"media_id":3,"offset":0,"limit":512}`)})
	f := drainSend(t, c)
	if f.kind != frameKindFile {
		t.Fatalf("kind = %d, want file", f.kind)
	}
	if binary.BigEndian.Uint32(f.data[0:4]) != 7 || binary.BigEndian.Uint64(f.data[12:20]) != 5 {
		t.Fatalf("bad chunk header: %x", f.data[:24])
	}
	if string(f.data[24:]) != "hello" {
		t.Fatalf("data = %q", f.data[24:])
	}
}

func TestDispatchFileReqForbidden(t *testing.T) {
	c := &Conn{
		userID:  42,
		send:    make(chan outFrame, 4),
		file:    fakeFileDisp{err: domain.ErrForbidden},
		fileSem: make(chan struct{}, fileMaxConcurrent),
	}
	c.dispatch(context.Background(), Frame{T: "file_req", D: json.RawMessage(`{"req_id":9,"media_id":3,"offset":0,"limit":512}`)})
	f := drainSend(t, c)
	if f.kind != frameKindJSON {
		t.Fatalf("err must be JSON kind, got %d", f.kind)
	}
	var e struct {
		D struct {
			ReqID uint32 `json:"req_id"`
			Error string `json:"error"`
		} `json:"d"`
	}
	if err := json.Unmarshal(f.data, &e); err != nil || e.D.ReqID != 9 || e.D.Error != "forbidden" {
		t.Fatalf("bad file_err: %q (%v)", f.data, err)
	}
}
```

Хелпер `timeAfter()`: добавить в этот файл `func timeAfter() <-chan time.Time { return time.After(2 * time.Second) }` (импорт `"time"`), либо использовать существующий хелпер, если найдётся в пакете — сначала грепнуть `grep -rn "time.After" internal/adapter/delivery/ws/*_test.go`.

- [ ] **Step 2: Прогнать — падает (нет case file_req)**

Run: `cd backend && go test ./internal/adapter/delivery/ws/ -run 'DispatchFileReq' 2>&1 | head`
Expected: FAIL — тест зависает на `drainSend` / нет кадра (case отсутствует, кадр не шлётся).

- [ ] **Step 3: Добавить case "file_req" в dispatch**

В `conn.go`, в `switch f.T`, после `case "rpc_req": ... }` добавить:

```go
	case "file_req":
		if c.file == nil {
			return // plain-conn / до SetFileDispatcher: file_req не обслуживаем
		}
		var d fileReqData
		if json.Unmarshal(f.D, &d) != nil || d.ReqID == 0 || d.MediaID == 0 {
			return
		}
		// Неблокирующий гейт: не стопорим read-pump; переполнение → file_err "busy".
		select {
		case c.fileSem <- struct{}{}:
		default:
			c.Send(fileErrFrame(d.ReqID, "busy"))
			return
		}
		file, userID := c.file, c.userID
		reqID, mediaID, offset, limit := d.ReqID, d.MediaID, d.Offset, d.Limit
		go func() {
			defer func() { <-c.fileSem }()
			defer saferun.Recover("ws.conn.file")
			data, total, err := file.ReadPart(context.Background(), userID, mediaID, offset, limit)
			if err != nil {
				msg := "error"
				if errors.Is(err, domain.ErrForbidden) {
					msg = "forbidden"
				}
				c.Send(fileErrFrame(reqID, msg))
				return
			}
			c.SendBinary(fileChunkFrame(reqID, offset, total, data))
		}()
```

(`errors`, `domain`, `saferun` уже импортированы в conn.go.)

- [ ] **Step 4: Прогнать тесты — зелёные**

Run: `cd backend && go test ./internal/adapter/delivery/ws/ -run 'DispatchFileReq' -v 2>&1 | tail -20`
Expected: PASS `TestDispatchFileReqChunk`, `TestDispatchFileReqForbidden`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/adapter/delivery/ws/conn.go backend/internal/adapter/delivery/ws/file_dispatch_test.go
git commit -m "feat(dnp): dispatch file_req → file_chunk (семафор + горутина, ошибки → file_err)"
```

---

### Task 4: Backend — FileStreamer adapter + wiring в server.go

**Files:**
- Create: `backend/internal/adapter/delivery/http/file_stream.go`
- Create: `backend/internal/adapter/delivery/http/file_stream_test.go`
- Modify: `backend/internal/app/server.go` (SetFileDispatcher)

**Interfaces:**
- Consumes: `MediaAccess.CanAccessMedia(ctx, userID, mediaID) (bool, error)` (media_handler.go:17), `usecasemedia.Interactor.GetContent(ctx, id) (io.ReadSeekCloser, ObjectInfo, domain.Media, error)` (media.go:224), `ObjectInfo.Size`, `domain.ErrForbidden`.
- Produces: `type FileStreamer struct{...}`; `NewFileStreamer(access MediaAccess, svc *usecasemedia.Interactor) *FileStreamer`; `(*FileStreamer).ReadPart(ctx, userID, mediaID, offset, limit int64) ([]byte, int64, error)` — удовлетворяет `ws.FileDispatcher` структурно.

- [ ] **Step 1: Тест ReadPart (fake storage + access)**

`backend/internal/adapter/delivery/http/file_stream_test.go`. Использует настоящий `usecasemedia.Interactor` с fake `MediaRepo`+`ObjectStorage` (свериться с сигнатурами в `internal/usecase/media/ports.go`: `MediaRepo.GetByID`, `ObjectStorage.GetObject`), либо, если проще — мок самого `GetContent` через минимальную реализацию. Предпочтительно — fake порты usecase, чтобы покрыть реальный путь.

```go
package http

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

type fakeAccess struct{ allow bool }

func (f fakeAccess) CanAccessMedia(context.Context, int64, int64) (bool, error) {
	return f.allow, nil
}

// fakeStorage + fakeRepo реализуют порты usecase/media для GetContent.
type fakeRepo struct{ m domain.Media }

func (r fakeRepo) GetByID(context.Context, int64) (domain.Media, error) { return r.m, nil }

// ...остальные методы MediaRepo — по интерфейсу из ports.go (panic-заглушки, не вызываются)...

type fakeStorage struct{ body []byte }

func (s fakeStorage) GetObject(_ context.Context, _ string) (io.ReadSeekCloser, usecasemedia.ObjectInfo, error) {
	return nopSeekCloser{bytes.NewReader(s.body)}, usecasemedia.ObjectInfo{Size: int64(len(s.body)), ContentType: "application/octet-stream"}, nil
}

// ...остальные методы ObjectStorage — по интерфейсу из ports.go (panic-заглушки)...

type nopSeekCloser struct{ *bytes.Reader }

func (nopSeekCloser) Close() error { return nil }

func newTestStreamer(allow bool, body []byte) *FileStreamer {
	svc := usecasemedia.New(fakeRepo{m: domain.Media{ObjectKey: "k"}}, fakeStorage{body: body}, nil)
	return NewFileStreamer(fakeAccess{allow: allow}, svc)
}

func TestReadPartOffsetLimit(t *testing.T) {
	data, total, err := newTestStreamer(true, []byte("0123456789")).ReadPart(context.Background(), 1, 2, 3, 4)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if total != 10 {
		t.Fatalf("total = %d", total)
	}
	if string(data) != "3456" {
		t.Fatalf("data = %q", data)
	}
}

func TestReadPartClampAtEOF(t *testing.T) {
	data, total, err := newTestStreamer(true, []byte("0123456789")).ReadPart(context.Background(), 1, 2, 8, 512)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if string(data) != "89" || total != 10 {
		t.Fatalf("data=%q total=%d", data, total)
	}
}

func TestReadPartForbidden(t *testing.T) {
	_, _, err := newTestStreamer(false, []byte("x")).ReadPart(context.Background(), 1, 2, 0, 512)
	if !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
}
```

> Примечание для реализатора: точный набор методов `MediaRepo`/`ObjectStorage` взять из `internal/usecase/media/ports.go`; неиспользуемые методы — `panic("unused")`-заглушки. Сигнатуру конструктора `usecasemedia.New(...)` свериться в `media.go`.

- [ ] **Step 2: Прогнать — падает (нет FileStreamer)**

Run: `cd backend && go test ./internal/adapter/delivery/http/ -run 'ReadPart' 2>&1 | head`
Expected: FAIL — `undefined: FileStreamer` / `undefined: NewFileStreamer`.

- [ ] **Step 3: Создать file_stream.go**

`backend/internal/adapter/delivery/http/file_stream.go`:

```go
package http

import (
	"context"
	"io"

	"github.com/messenger-denis/backend/internal/domain"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

// FileStreamer отдаёт куски медиа по DNP-каналу (реализует ws.FileDispatcher).
// Проверка прав — тем же MediaAccess, что и HTTP-эндпоинт /media/{id}/content;
// байты — тем же media.Interactor.GetContent (Seek по offset). Native-HTTP путь
// не трогается, это его канальный дублёр.
type FileStreamer struct {
	access MediaAccess
	svc    *usecasemedia.Interactor
}

func NewFileStreamer(access MediaAccess, svc *usecasemedia.Interactor) *FileStreamer {
	return &FileStreamer{access: access, svc: svc}
}

// ReadPart проверяет доступ, открывает объект, сикает на offset и читает до limit
// байт. Возвращает (data, total=полный размер, err). Нет доступа → domain.ErrForbidden.
func (s *FileStreamer) ReadPart(ctx context.Context, userID, mediaID, offset, limit int64) ([]byte, int64, error) {
	allowed, err := s.access.CanAccessMedia(ctx, userID, mediaID)
	if err != nil {
		return nil, 0, err
	}
	if !allowed {
		return nil, 0, domain.ErrForbidden
	}
	rc, info, _, err := s.svc.GetContent(ctx, mediaID)
	if err != nil {
		return nil, 0, err
	}
	defer rc.Close()

	if offset > 0 {
		if _, err := rc.Seek(offset, io.SeekStart); err != nil {
			return nil, 0, err
		}
	}
	remaining := info.Size - offset
	if remaining < 0 {
		remaining = 0
	}
	if limit > remaining {
		limit = remaining
	}
	buf := make([]byte, limit)
	n, err := io.ReadFull(rc, buf)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return nil, 0, err
	}
	return buf[:n], info.Size, nil
}
```

- [ ] **Step 4: Прогнать тесты — зелёные**

Run: `cd backend && go test ./internal/adapter/delivery/http/ -run 'ReadPart' -v 2>&1 | tail -20`
Expected: PASS `TestReadPartOffsetLimit`, `TestReadPartClampAtEOF`, `TestReadPartForbidden`.

- [ ] **Step 5: Wiring в server.go**

В `internal/app/server.go`, сразу после блока `SetRPCDispatcher` (строки ~327-328):

```go
	if h, ok := wsHandler.(*ws.Handler); ok {
		h.SetRPCDispatcher(httptransport.NewRouterRPC(router))
		h.SetFileDispatcher(httptransport.NewFileStreamer(p.ChatUC, mediaUC))
	}
```

> `p.ChatUC` уже используется как `MediaAccess` в `NewMediaHandler(mediaUC, p.ChatUC, ...)` (строка 227), `mediaUC` — это `*usecasemedia.Interactor`. Если блок `SetRPCDispatcher` уже внутри `if h, ok := ...`, просто добавить вторую строку внутрь; не дублировать type-assert.

- [ ] **Step 6: Прогнать сборку + полный backend-тест пакетов ws/http**

Run: `cd backend && go build ./... && go test ./internal/adapter/delivery/... 2>&1 | tail -20`
Expected: сборка ок; тесты зелёные.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/adapter/delivery/http/file_stream.go backend/internal/adapter/delivery/http/file_stream_test.go backend/internal/app/server.go
git commit -m "feat(dnp): FileStreamer (access-check + GetContent+Seek) + wiring SetFileDispatcher"
```

---

### Task 5: Backend — интеграционный e2e (flynn/noise initiator)

**Files:**
- Create: `backend/internal/adapter/delivery/ws/file_e2e_test.go`

**Interfaces:**
- Consumes: существующий интеграционный хелпер живого Noise-хендшейка (найти: `grep -rn "flynn/noise\|HandshakeNK\|dnpAccept\|httptest.NewServer" internal/adapter/delivery/ws/*_test.go` — переиспользовать инфраструктуру из dnp/rpc e2e-теста, добавленного в L4). `frameKindFile`, layout из Global Constraints.

- [ ] **Step 1: Написать e2e-тест «file_req → бинарный file_chunk»**

Расширить существующий паттерн живого DNP-теста (тот, что делает handshake→auth→rpc). Скелет (адаптировать под фактические хелперы уже существующего e2e-файла — сначала прочитать его):

```go
// TestDNPFileReqE2E: полный Noise_NK хендшейк → auth → file_req → сервер шлёт
// бинарный file_chunk с корректными байтами объекта (через fake FileDispatcher,
// установленный на Handler.SetFileDispatcher).
func TestDNPFileReqE2E(t *testing.T) {
	// 1. поднять Handler с dnpServerPriv + SetFileDispatcher(fakeFileDisp{data:"payload", total:7})
	// 2. httptest-сервер, WS-клиент с subprotocol dnp/2
	// 3. initiator handshake (flynn/noise, как в rpc e2e); split → send/recv cipher
	// 4. послать auth-кадр (kind 0x00 JSON {t:auth,d:{token}})
	// 5. послать file_req (kind 0x00 JSON {t:file_req,d:{req_id:1,media_id:5,offset:0,limit:512}})
	// 6. прочитать ответный бинарный кадр: decrypt → plain[0]==0x01 →
	//    parse header (req_id=1,total=7) → data=="payload"
}
```

Ключевые проверки (assert): ответный кадр — `websocket.BinaryMessage`; после `dnp.DecryptFrame` первый байт `== frameKindFile`; `binary.BigEndian.Uint32(plain[1:5]) == 1`; `plain[13:21]` (total) `== 7`; хвост `== "payload"`.

- [ ] **Step 2: Прогнать — сформулировать ожидание**

Run: `cd backend && go test ./internal/adapter/delivery/ws/ -run 'FileReqE2E' -v 2>&1 | tail -30`
Expected (перед реализацией теста корректно): либо компилируется и проходит (сервер уже умеет file_req из Task 3-4), либо выявляет несоответствие layout. Тест — регрессионный сторож живого пути.

- [ ] **Step 3: Довести тест до зелёного**

Если падает — сверить offset'ы header'а (kind-байт сдвигает всё на 1: в plaintext `plain[0]`=kind, header начинается с `plain[1]`). Убедиться, что клиентский `limit` ≥ размера объекта.

Run: `cd backend && go test ./internal/adapter/delivery/ws/ -run 'FileReqE2E' -v 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/adapter/delivery/ws/file_e2e_test.go
git commit -m "test(dnp): e2e file_req → бинарный file_chunk через живой Noise-канал"
```

---

### Task 6: Client — бинарная ветка транспорта (onBinary + KIND_FILE)

**Files:**
- Modify: `web-client/src/core/net/transport.ts` (интерфейс)
- Modify: `web-client/src/core/net/dnp/dnpTransport.ts`
- Modify: `web-client/src/core/net/wsClient.ts` (no-op onBinary)
- Test: `web-client/src/core/net/dnp/dnpTransport.test.ts` (правка/добавление)

**Interfaces:**
- Produces: `Transport.onBinary(cb: (data: Uint8Array) => void): void`. На DNP — фаерит payload ПОСЛЕ снятия kind-байта (`plain.subarray(1)` при `plain[0] === 0x01`). На plain-WS — no-op (никогда не фаерит).
- Consumes: `KIND_JSON`, `openFrame`, существующий `fail()`.

- [ ] **Step 1: Тест — dnpTransport доставляет бинарь в onBinary, JSON не ломается**

В `dnpTransport.test.ts` добавить тест (свериться с существующим паттерном теста: он делает handshake через тестовый ephemeral + фейковый WS; переиспользовать его helper'ы). Проверить: кадр с kind 0x01 → подписчик `onBinary` получает `plain.subarray(1)`; kind 0x00 → идёт в `on(t)`; неизвестный kind → канал падает (`fail`).

```ts
it('доставляет kind 0x01 в onBinary, не трогая JSON-подписчиков', () => {
  // ...поднять transport до state='ready' (как в существующих тестах)...
  const chunks: Uint8Array[] = []
  transport.onBinary((d) => chunks.push(d))
  // сервер шлёт зашифрованный кадр [0x01, 0xaa, 0xbb]
  const payload = new Uint8Array([0xaa, 0xbb])
  serverSendEncrypted(withKind(0x01, payload)) // helper: seal + доставить в onmessage
  expect(chunks).toHaveLength(1)
  expect(Array.from(chunks[0])).toEqual([0xaa, 0xbb])
})
```

- [ ] **Step 2: Прогнать — падает (нет onBinary / ветки 0x01)**

Run: `cd web-client && npx vitest run src/core/net/dnp/dnpTransport.test.ts 2>&1 | tail -20`
Expected: FAIL — `transport.onBinary is not a function` / бинарь роняет канал (`fail`).

- [ ] **Step 3: Реализовать onBinary + ветку 0x01**

(a) `transport.ts` — добавить в интерфейс:

```ts
  on(type: string, cb: (d: unknown) => void): void
  onBinary(cb: (data: Uint8Array) => void): void
  send(type: string, d?: unknown): void
```

(b) `dnpTransport.ts` — константа + поле + ветка + метод:

```ts
const KIND_JSON = 0x00
const KIND_FILE = 0x01
```
```ts
  private listeners = new Map<string, Array<(d: unknown) => void>>()
  private binaryCbs: Array<(data: Uint8Array) => void> = []
```
В `onMessage`, ветка `state === 'ready'`, заменить строку-гард на разбор kind:
```ts
    if (this.state === 'ready') {
      try {
        const plain = openFrame(this.cipherRecv!, raw)
        if (plain.length < 1) { this.fail(); return }
        if (plain[0] === KIND_FILE) {
          const bin = plain.subarray(1)
          for (const cb of this.binaryCbs) cb(bin)
          return
        }
        if (plain[0] !== KIND_JSON) { this.fail(); return }
        const f: Frame = decodeFrame(new TextDecoder().decode(plain.subarray(1)))
        for (const cb of this.listeners.get(f.t) ?? []) cb(f.d)
      } catch {
        this.fail() // сбой decrypt = необратимый рассинхрон nonce → close → rehandshake
      }
    }
```
Метод рядом с `on`:
```ts
  onBinary(cb: (data: Uint8Array) => void): void { this.binaryCbs.push(cb) }
```

(c) `wsClient.ts` — no-op (plain-WS не несёт бинарных file-кадров; медиа идёт нативным HTTP). Добавить рядом с `on`:
```ts
  onBinary(_cb: (data: Uint8Array) => void): void { /* plain-WS: медиа нативным HTTP, бинарь не приходит */ }
```

- [ ] **Step 4: Прогнать тесты транспорта — зелёные**

Run: `cd web-client && npx vitest run src/core/net/dnp/dnpTransport.test.ts 2>&1 | tail -20`
Expected: PASS (новый тест + существующие).

- [ ] **Step 5: Typecheck**

Run: `cd web-client && npx tsc --noEmit 2>&1 | tail -20`
Expected: без ошибок (WsClient и DnpTransport оба реализуют расширенный Transport).

- [ ] **Step 6: Commit**

```bash
git add web-client/src/core/net/transport.ts web-client/src/core/net/dnp/dnpTransport.ts web-client/src/core/net/wsClient.ts web-client/src/core/net/dnp/dnpTransport.test.ts
git commit -m "feat(dnp): бинарная ветка транспорта — Transport.onBinary + kind 0x01 в DnpTransport"
```

---

### Task 7: Client — примитив fileDownload (fetchFilePart + downloadMedia)

**Files:**
- Create: `web-client/src/core/net/dnp/fileDownload.ts`
- Create: `web-client/src/core/net/dnp/fileDownload.test.ts`

**Interfaces:**
- Consumes: `Transport` (`send('file_req', …)`, `onBinary(cb)`, `on('file_err', cb)`, `onClose(cb)`, `isOpen()`).
- Produces: `newFileDownload(transport: Transport)` → `{ isReady(): boolean; fetchFilePart(mediaId: number, offset: number, limit: number): Promise<Uint8Array>; downloadMedia(mediaId: number): Promise<Blob> }`. Заголовок бинарного кадра парсится как в Global Constraints (BE): `req_id(u32)@0, offset(u64)@4, total(u64)@12, len(u32)@20, data@24`.

- [ ] **Step 1: Тест на fake-транспорте**

`fileDownload.test.ts` — fake Transport, эмулирующий сервер: на `file_req` синхронно вызывает зарегистрированный `onBinary` cb с собранным бинарным кадром (или `file_err`).

```ts
import { describe, it, expect } from 'vitest'
import { newFileDownload } from './fileDownload'

// Собрать бинарный file_chunk payload (как это делает сервер, БЕЗ kind-байта —
// транспорт уже снял 0x01 перед onBinary).
function chunk(reqId: number, offset: number, total: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(24 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, reqId, false)
  dv.setBigUint64(4, BigInt(offset), false)
  dv.setBigUint64(12, BigInt(total), false)
  dv.setUint32(20, data.length, false)
  out.set(data, 24)
  return out
}

function fakeTransport(serve: (req: { req_id: number; media_id: number; offset: number; limit: number }, reply: (c: Uint8Array) => void, err: (reqId: number, msg: string) => void) => void) {
  let binCb: (d: Uint8Array) => void = () => {}
  let errCb: (d: unknown) => void = () => {}
  return {
    isOpen: () => true,
    onBinary: (cb: (d: Uint8Array) => void) => { binCb = cb },
    on: (t: string, cb: (d: unknown) => void) => { if (t === 'file_err') errCb = cb },
    onClose: () => {},
    send: (t: string, d?: unknown) => {
      if (t === 'file_req') serve(d as never, binCb, (reqId, msg) => errCb({ req_id: reqId, error: msg }))
    },
    // неиспользуемые методы Transport — заглушки
    connect: () => {}, close: () => {}, onOpen: () => {}, onError: () => {},
  }
}

describe('fileDownload', () => {
  it('fetchFilePart резолвит байты из бинарного кадра', async () => {
    const fd = newFileDownload(fakeTransport((req, reply) => {
      reply(chunk(req.req_id, 0, 3, new Uint8Array([1, 2, 3])))
    }) as never)
    const part = await fd.fetchFilePart(5, 0, 512)
    expect(Array.from(part)).toEqual([1, 2, 3])
  })

  it('downloadMedia собирает Blob из нескольких чанков', async () => {
    const total = 5
    const bytes = new Uint8Array([10, 20, 30, 40, 50])
    const fd = newFileDownload(fakeTransport((req, reply) => {
      const end = Math.min(req.offset + req.limit, total)
      reply(chunk(req.req_id, req.offset, total, bytes.subarray(req.offset, end)))
    }) as never)
    const blob = await fd.downloadMedia(1)
    expect(blob.size).toBe(5)
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([10, 20, 30, 40, 50])
  })

  it('file_err реджектит fetchFilePart', async () => {
    const fd = newFileDownload(fakeTransport((req, _reply, err) => {
      err(req.req_id, 'forbidden')
    }) as never)
    await expect(fd.fetchFilePart(5, 0, 512)).rejects.toThrow('forbidden')
  })
})
```

- [ ] **Step 2: Прогнать — падает (нет модуля)**

Run: `cd web-client && npx vitest run src/core/net/dnp/fileDownload.test.ts 2>&1 | tail -20`
Expected: FAIL — cannot find module `./fileDownload`.

- [ ] **Step 3: Реализовать fileDownload.ts**

```ts
import type { Transport } from '../transport'

const CHUNK_SIZE = 512 * 1024
const FILE_TIMEOUT_MS = 30_000

interface Pending {
  resolve: (v: { offset: number; total: number; data: Uint8Array }) => void
  reject: (e: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

// newFileDownload — скачивание медиа чанками через DNP-канал. Зеркалит ChannelRpc:
// file_req (JSON) → file_chunk (бинарь), корреляция по u32 req_id. Активен только
// при DNP-ON (RestClient/mediaManager зовут лишь при isReady). Один консюмер — изображения.
export function newFileDownload(transport: Transport) {
  const pending = new Map<number, Pending>()
  let seq = 0

  transport.onBinary((raw) => {
    if (raw.length < 24) return
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
    const reqId = dv.getUint32(0, false)
    const offset = Number(dv.getBigUint64(4, false))
    const total = Number(dv.getBigUint64(12, false))
    const len = dv.getUint32(20, false)
    const p = pending.get(reqId)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(reqId)
    p.resolve({ offset, total, data: raw.subarray(24, 24 + len) })
  })

  // Ошибка чанк-запроса: сервер шлёт file_err{req_id,error} — реджектим по req_id.
  transport.on('file_err', (d) => {
    const r = d as { req_id?: number; error?: string }
    if (typeof r?.req_id !== 'number') return
    const p = pending.get(r.req_id)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(r.req_id)
    p.reject(new Error(r.error ?? 'file error'))
  })

  // Обрыв канала → все in-flight реджектятся.
  transport.onClose(() => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('channel closed')) }
    pending.clear()
  })

  // fetchFilePart возвращает {data, total}: один чанк (до limit байт с offset).
  function fetchFilePart(mediaId: number, offset: number, limit: number): Promise<{ data: Uint8Array; total: number }> {
    const reqId = (seq = (seq + 1) >>> 0) // u32-счётчик с обёрткой
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(reqId); reject(new Error('file timeout')) }, FILE_TIMEOUT_MS)
      pending.set(reqId, { resolve: (v) => resolve({ data: v.data, total: v.total }), reject, timer })
      transport.send('file_req', { req_id: reqId, media_id: mediaId, offset, limit })
    })
  }

  return {
    isReady(): boolean { return transport.isOpen() },
    // Публичный примитив: один чанк (байты). Обёртка над fetchFilePart без total.
    async fetchFilePart(mediaId: number, offset: number, limit: number): Promise<Uint8Array> {
      const { data } = await fetchFilePart(mediaId, offset, limit)
      return data
    },
    // downloadMedia тянет весь файл чанками CHUNK_SIZE и собирает Blob.
    async downloadMedia(mediaId: number): Promise<Blob> {
      const parts: Uint8Array[] = []
      let offset = 0
      // первый чанк даёт total; дальше — до EOF (offset >= total).
      for (;;) {
        const { data, total } = await fetchFilePart(mediaId, offset, CHUNK_SIZE)
        parts.push(data)
        offset += data.length
        if (data.length === 0 || offset >= total) break
      }
      return new Blob(parts as BlobPart[])
    },
  }
}

export type FileDownload = ReturnType<typeof newFileDownload>
```

> Примечание: публичный `fetchFilePart` (возвращает `Uint8Array`) — обёртка над внутренним (возвращает `{data,total}`), чтобы `downloadMedia` знал `total`. Имя внутренней функции не конфликтует с методом объекта (разные скоупы), но для ясности реализатор может переименовать внутреннюю в `requestPart`.

- [ ] **Step 4: Прогнать тесты — зелёные**

Run: `cd web-client && npx vitest run src/core/net/dnp/fileDownload.test.ts 2>&1 | tail -20`
Expected: PASS (3 теста).

- [ ] **Step 5: Typecheck**

Run: `cd web-client && npx tsc --noEmit 2>&1 | tail -20`
Expected: без ошибок.

- [ ] **Step 6: Commit**

```bash
git add web-client/src/core/net/dnp/fileDownload.ts web-client/src/core/net/dnp/fileDownload.test.ts
git commit -m "feat(dnp): клиентский примитив fileDownload — fetchFilePart + downloadMedia→Blob"
```

---

### Task 8: Client — разводка одного консюмера (изображения → blob-URL при DNP-ON)

**Files:**
- Modify: `web-client/src/core/worker.ts` (конструкция fileDownload, проброс в mediaManager)
- Modify: `web-client/src/core/managers/mediaManager.ts` (dep fileDownload + `contentBlob`)
- Modify: `web-client/src/core/hooks/useMediaContentUrl.ts` (DNP-путь → objectURL)
- Test: `web-client/src/core/managers/mediaManager.test.ts` (правка/новый — покрыть contentBlob)

**Interfaces:**
- Consumes: `newFileDownload` (Task 7), `AppConfig.dnp.enabled`, `managers.media.contentBlob`.
- Produces: `mediaManager.contentBlob(id: number): Promise<Blob>` (через fileDownload); `useMediaContentUrl` при DNP-ON резолвит через blob-URL с revoke на cleanup, fallback на token-URL при ошибке.

- [ ] **Step 1: Тест — mediaManager.contentBlob идёт через fileDownload**

В `mediaManager.test.ts` добавить тест: передать fake `fileDownload` в `newMediaManager`, проверить, что `contentBlob(id)` зовёт `fileDownload.downloadMedia(id)` и возвращает его Blob.

```ts
it('contentBlob скачивает через канал (fileDownload)', async () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])])
  const fileDownload = { isReady: () => true, downloadMedia: vi.fn().mockResolvedValue(blob), fetchFilePart: vi.fn() }
  const mm = newMediaManager({ rest: fakeRest(), fileDownload } as never)
  await expect(mm.contentBlob(5)).resolves.toBe(blob)
  expect(fileDownload.downloadMedia).toHaveBeenCalledWith(5)
})
```

(Свериться с существующим `mediaManager.test.ts` на предмет `fakeRest()`-хелпера; если теста нет — создать файл с минимальным fake `RestLike`.)

- [ ] **Step 2: Прогнать — падает (нет contentBlob / dep)**

Run: `cd web-client && npx vitest run src/core/managers/mediaManager.test.ts 2>&1 | tail -20`
Expected: FAIL — `mm.contentBlob is not a function`.

- [ ] **Step 3: Добавить dep + contentBlob в mediaManager**

(a) Тип dep — добавить в сигнатуру `newMediaManager`:

```ts
import type { FileDownload } from '../net/dnp/fileDownload'
```
```ts
export function newMediaManager({ rest, onUploadProgress, fileDownload }: {
  rest: RestLike
  onUploadProgress?: (id: string, loaded: number, total: number) => void
  fileDownload?: FileDownload // задан только при DNP-ON: скачивание медиа через канал
}) {
```

(b) Метод в возвращаемом объекте (рядом с `contentUrl`):

```ts
    // contentBlob скачивает медиа целиком через DNP-канал (blob создаётся вызывающим
    // main-потоком: objectURL из воркера в DOM невалиден). Только при DNP-ON.
    async contentBlob(id: number): Promise<Blob> {
      if (!fileDownload) throw new Error('media: канал недоступен')
      return fileDownload.downloadMedia(id)
    },
```

- [ ] **Step 4: Сконструировать fileDownload в worker.ts и пробросить**

В `worker.ts`, рядом с `channelRpc` (строка ~61):

```ts
import { newFileDownload } from './net/dnp/fileDownload'
```
```ts
const channelRpc = AppConfig.dnp.enabled ? new ChannelRpc(ws) : undefined
const fileDownload = AppConfig.dnp.enabled ? newFileDownload(ws) : undefined
```
Найти вызов `newMediaManager({ rest, ... })` (грепнуть `grep -n "newMediaManager" core/worker.ts`) и добавить `fileDownload`:
```ts
const media = newMediaManager({ rest, onUploadProgress: /* как было */, fileDownload })
```

- [ ] **Step 5: DNP-путь в useMediaContentUrl (objectURL + revoke + fallback)**

`hooks/useMediaContentUrl.ts` — при DNP-ON скачать blob и отдать objectURL, revoke на cleanup; при ошибке — fallback на token-URL (`contentUrl`), чтобы картинка не пропадала до готовности канала:

```ts
import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import { AppConfig } from '../config/app'

export function useMediaContentUrl(mediaId: number): string {
  const managers = useManagers()
  const [url, setUrl] = useState('')
  useEffect(() => {
    let alive = true
    let objectUrl = ''
    const setFromToken = () => {
      void managers.media.contentUrl(mediaId).then((u) => { if (alive) setUrl(u) }).catch(() => {})
    }
    if (AppConfig.dnp.enabled) {
      // DNP-ON: тянем байты через канал, отдаём blob-URL. Ошибка (канал не готов) →
      // fallback на token-URL, чтобы изображение не пропадало.
      void managers.media.contentBlob(mediaId)
        .then((blob) => {
          if (!alive) return
          objectUrl = URL.createObjectURL(blob)
          setUrl(objectUrl)
        })
        .catch(() => { if (alive) setFromToken() })
    } else {
      setFromToken()
    }
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [managers, mediaId])
  return url
}
```

- [ ] **Step 6: Прогнать тесты + typecheck + build**

Run: `cd web-client && npx vitest run src/core/managers/mediaManager.test.ts 2>&1 | tail -20 && npx tsc --noEmit 2>&1 | tail && npx vite build --outDir /tmp/pr1b-build 2>&1 | tail -5`
Expected: тесты зелёные; typecheck чист; сборка ок.

- [ ] **Step 7: Commit**

```bash
git add web-client/src/core/worker.ts web-client/src/core/managers/mediaManager.ts web-client/src/core/managers/mediaManager.test.ts web-client/src/core/hooks/useMediaContentUrl.ts
git commit -m "feat(dnp): один консюмер — изображения через blob-URL из канала при DNP-ON"
```

---

## Self-Review

**Spec coverage (L5-спека § PR-1b):**
- ✅ `file_req` (JSON) — Task 3 dispatch + Task 6/7 клиент.
- ✅ `file_chunk` (бинарь, layout req_id/offset/total/len) — Task 2 builder, Task 3 send, Task 7 parse.
- ✅ Проверка доступа через media-usecase (`CanAccessMedia`) — Task 4.
- ✅ MinIO Seek(offset)+read limit — Task 4 (`GetContent`→`Seek`).
- ✅ Клиентские `fetchFilePart`/`downloadMedia`→Blob — Task 7.
- ✅ Бинарная ветка транспорта (отдельно от JSON) — Task 6.
- ✅ Go-интеграция (flynn/noise initiator) — Task 5.
- ✅ Клиент unit (сборка Blob из чанков, fake-транспорт) — Task 7.
- ➕ Сверх спеки (подтверждено): `file_err`-кадр (Task 2/3/7); один консюмер-изображения (Task 8).

**Type consistency:** `frameCodec.encode(kind,frame)` — Task 1 определяет, Task 3 использует. `FileDispatcher.ReadPart(ctx,userID,mediaID,offset,limit)([]byte,int64,error)` — Task 2 объявляет, Task 3 зовёт, Task 4 реализует. `fileChunkFrame(reqID uint32, offset,total int64, data []byte)` — единая сигнатура Task 2/3/5. Клиент `Transport.onBinary(cb)` — Task 6 объявляет, Task 7 использует. `newFileDownload(transport)`→`{isReady,fetchFilePart,downloadMedia}` — Task 7 → Task 8. Layout BE (req_id@0/offset@4/total@12/len@20/data@24) идентичен на сервере (Task 2) и клиенте (Task 7).

**Placeholder scan:** нет TBD/«add error handling» — все шаги несут код или точную команду; where реализатору нужно свериться с существующим кодом (порты media usecase, e2e-хелперы, fakeRest), явно указан grep/файл-источник.
