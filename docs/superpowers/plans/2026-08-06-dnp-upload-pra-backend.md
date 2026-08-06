# DNP L5 upload — PR-a (backend): приём file_up → SavePart

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.
> Шаги — чекбоксы (`- [ ]`).

**Goal:** Бэкенд принимает бинарный кадр `file_up` (kind 0x02) по DNP-каналу, пишет чанк
через usecase `SavePart`, отвечает `file_up_ok`/`file_up_err`. Зеркало download (`file_req`).

**Architecture:** codec-шов учится возвращать kind кадра; `readPump` ветвится
0x00→JSON-диспатч / 0x02→`file_up`-диспатч (горутина+семафор, как `file_req`);
`UploadDispatcher`→`SavePart` (адаптер в http, ws не импортит usecase).

**Tech Stack:** Go 1.25, gorilla/websocket, flynn/noise (e2e). Клиентская часть — PR-b.

## Global Constraints

- Чистая архитектура: `ws` НЕ импортит usecase/http — только интерфейс `UploadDispatcher`
  (как `FileDispatcher`). Реализация — в `adapter/delivery/http`.
- **Read-limit:** `maxMessageSize = 1<<20` (1МБ) — sealed `file_up`-кадр не должен его
  превышать. `maxFileUpChunk = 512<<10` (512КБ data) — reject кадра с `len` сверх (заголовок
  24Б + kind 1Б + AEAD-tag 16Б ≪ 1МБ). Клиент (PR-b) режет parts по 512КБ.
- **Wire (Big-Endian, заголовок 24Б):** `req_id(u32)@0 │ media_id(u64)@4 │ index(u32)@12 │
  total(u32)@16 │ len(u32)@20 │ data@24`. kind-байт 0x02 клеит codec (в payload его нет).
- **Ack (JSON kind 0x00):** `{"t":"file_up_ok","d":{"req_id":N}}` /
  `{"t":"file_up_err","d":{"req_id":N,"error":"forbidden|bad_part|error"}}`.
- **Права** — внутри `SavePart` (по ownerID = userID канала; `ErrForbidden`). userID из
  `dnpAccept`. Наличие объекта не течёт (ошибки маппятся в короткие коды).
- plain-WS путь НЕ трогаем (plainCodec.decode остаётся identity, kind=JSON).

---

### Task 1: file_up frame — parse/build + ok/err кадры

**Files:**
- Create: `backend/internal/adapter/delivery/ws/upload.go`
- Test: `backend/internal/adapter/delivery/ws/upload_test.go`

**Interfaces:**
- Produces: `parseFileUp(payload []byte) (reqID uint32, mediaID int64, index, total int, data []byte, ok bool)`;
  `fileUpFrame(reqID uint32, mediaID int64, index, total int, data []byte) []byte` (build,
  для тестов/симметрии); `fileUpOkFrame(reqID uint32) []byte`; `fileUpErrFrame(reqID uint32, msg string) []byte`.

- [ ] **Step 1: Тест — round-trip build→parse + короткий payload отвергается**

```go
package ws

import "testing"

func TestFileUpFrameRoundTrip(t *testing.T) {
	data := []byte{1, 2, 3, 4, 5}
	frame := fileUpFrame(7, 42, 2, 10, data)
	reqID, mediaID, index, total, got, ok := parseFileUp(frame)
	if !ok || reqID != 7 || mediaID != 42 || index != 2 || total != 10 || string(got) != string(data) {
		t.Fatalf("round-trip mismatch: %d %d %d %d %v ok=%v", reqID, mediaID, index, total, got, ok)
	}
}

func TestParseFileUpShort(t *testing.T) {
	if _, _, _, _, _, ok := parseFileUp([]byte{0, 1, 2}); ok { // < 24Б заголовка
		t.Fatal("short payload must be rejected")
	}
}

func TestParseFileUpLenMismatch(t *testing.T) {
	frame := fileUpFrame(1, 1, 1, 1, []byte{9, 9, 9})
	frame = frame[:len(frame)-1] // len в заголовке говорит 3, данных 2 → mismatch
	if _, _, _, _, _, ok := parseFileUp(frame); ok {
		t.Fatal("len/data mismatch must be rejected")
	}
}
```

- [ ] **Step 2: Запустить — упадёт (parseFileUp/fileUpFrame не существуют)**

Run: `cd backend && go test ./internal/adapter/delivery/ws/ -run TestFileUp -count=1`
Expected: FAIL (не компилируется — функций нет).

- [ ] **Step 3: Реализация `upload.go`**

```go
package ws

import (
	"encoding/binary"
	"encoding/json"
)

// uploadMaxConcurrent — предел одновременных file_up на соединение (как fileMaxConcurrent).
const uploadMaxConcurrent = 16

// maxFileUpChunk — потолок data одного file_up-кадра. sealed-кадр (24Б заголовок +
// 1Б kind + 16Б AEAD-tag + data) обязан влезать в maxMessageSize (1МБ). 512КБ — с запасом.
const maxFileUpChunk = 512 << 10

// fileUpFrame собирает бинарный file_up (payload ПОСЛЕ kind-байта 0x02, его клеит codec).
// Layout Big-Endian: req_id(u32)│media_id(u64)│index(u32)│total(u32)│len(u32)│data.
func fileUpFrame(reqID uint32, mediaID int64, index, total int, data []byte) []byte {
	out := make([]byte, 24+len(data))
	binary.BigEndian.PutUint32(out[0:4], reqID)
	binary.BigEndian.PutUint64(out[4:12], uint64(mediaID))
	binary.BigEndian.PutUint32(out[12:16], uint32(index))
	binary.BigEndian.PutUint32(out[16:20], uint32(total))
	binary.BigEndian.PutUint32(out[20:24], uint32(len(data)))
	copy(out[24:], data)
	return out
}

// parseFileUp разбирает payload file_up (без kind-байта). ok=false при коротком заголовке
// или несоответствии len/данных.
func parseFileUp(p []byte) (reqID uint32, mediaID int64, index, total int, data []byte, ok bool) {
	if len(p) < 24 {
		return 0, 0, 0, 0, nil, false
	}
	reqID = binary.BigEndian.Uint32(p[0:4])
	mediaID = int64(binary.BigEndian.Uint64(p[4:12]))
	index = int(binary.BigEndian.Uint32(p[12:16]))
	total = int(binary.BigEndian.Uint32(p[16:20]))
	length := int(binary.BigEndian.Uint32(p[20:24]))
	if length != len(p)-24 {
		return 0, 0, 0, 0, nil, false
	}
	return reqID, mediaID, index, total, p[24:], true
}

// fileUpOkFrame / fileUpErrFrame — JSON-ack (kind 0x00).
func fileUpOkFrame(reqID uint32) []byte {
	b, _ := json.Marshal(map[string]any{"t": "file_up_ok", "d": map[string]any{"req_id": reqID}})
	return b
}

func fileUpErrFrame(reqID uint32, msg string) []byte {
	b, _ := json.Marshal(map[string]any{"t": "file_up_err", "d": map[string]any{"req_id": reqID, "error": msg}})
	return b
}
```

- [ ] **Step 4: Запустить — зелёные**

Run: `cd backend && go test ./internal/adapter/delivery/ws/ -run TestFileUp -count=1 && go test ./internal/adapter/delivery/ws/ -run TestParseFileUp -count=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/adapter/delivery/ws/upload.go backend/internal/adapter/delivery/ws/upload_test.go
git commit -m "feat(dnp): file_up frame — parse/build + ok/err кадры (backend)"
```

---

### Task 2: codec decode→kind, readPump-ветка, UploadDispatcher + dispatchFileUp

**Files:**
- Modify: `backend/internal/adapter/delivery/ws/conn.go`
- Modify: `backend/internal/adapter/delivery/ws/file.go` (добавить интерфейс `UploadDispatcher`)
- Test: `backend/internal/adapter/delivery/ws/upload_dispatch_test.go`
- Возможно: обновить существующие тесты, зовущие `codec.decode` (новая сигнатура).

**Interfaces:**
- Consumes: `parseFileUp`, `fileUpOkFrame`, `fileUpErrFrame`, `maxFileUpChunk`, `uploadMaxConcurrent` (Task 1).
- Produces: `frameKindFileUp byte = 0x02`; `frameCodec.decode(raw) (byte, []byte, error)`;
  `UploadDispatcher` interface; `Conn.SetUploadDispatcher`; `dispatchFileUp`.

- [ ] **Step 1: Тест — dispatchFileUp вызывает SavePart и шлёт ack ok**

```go
package ws

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

type fakeUploader struct {
	gotUserID, gotMediaID int64
	gotIndex, gotTotal    int
	gotData               []byte
	err                   error
}

func (f *fakeUploader) SavePart(_ context.Context, userID, mediaID int64, index, total int, data []byte) error {
	f.gotUserID, f.gotMediaID, f.gotIndex, f.gotTotal, f.gotData = userID, mediaID, index, total, append([]byte(nil), data...)
	return f.err
}

func TestDispatchFileUpOK(t *testing.T) {
	up := &fakeUploader{}
	c := newTestConnWithUpload(t, up, 555) // helper: Conn с userID=555, codec собирающий Send-кадры
	c.dispatchFileUp(context.Background(), fileUpFrame(9, 42, 3, 10, []byte{1, 2, 3}))
	waitSend(t, c) // дождаться ack из горутины
	if up.gotUserID != 555 || up.gotMediaID != 42 || up.gotIndex != 3 || up.gotTotal != 10 || string(up.gotData) != string([]byte{1, 2, 3}) {
		t.Fatalf("SavePart args mismatch: %+v", up)
	}
	got := lastSent(t, c)
	var f struct{ T string; D struct{ ReqID uint32 `json:"req_id"` } }
	_ = json.Unmarshal(got, &f)
	if f.T != "file_up_ok" || f.D.ReqID != 9 {
		t.Fatalf("expected file_up_ok req_id=9, got %s", got)
	}
	_ = time.Now
}
```

Примечание для реализатора: helper'ы `newTestConnWithUpload`/`waitSend`/`lastSent` собери по
образцу существующих conn/file-тестов (`file_dispatch_test.go`, `file_test.go`) — там уже
есть паттерн Conn с перехватом `send`-канала. Переиспользуй его, не изобретай заново. Если
существующий helper даёт Conn без upload — расширь минимально (поле `upload`, `SetUploadDispatcher`).

- [ ] **Step 2: Тест — SavePart ErrForbidden → ack file_up_err "forbidden"; кадр > maxFileUpChunk → "error", SavePart НЕ зовётся**

```go
func TestDispatchFileUpForbidden(t *testing.T) {
	up := &fakeUploader{err: domain.ErrForbidden}
	c := newTestConnWithUpload(t, up, 555)
	c.dispatchFileUp(context.Background(), fileUpFrame(9, 42, 1, 1, []byte{1}))
	waitSend(t, c)
	if got := lastSent(t, c); !containsErr(got, 9, "forbidden") {
		t.Fatalf("expected file_up_err forbidden, got %s", got)
	}
}

func TestDispatchFileUpTooLarge(t *testing.T) {
	up := &fakeUploader{}
	c := newTestConnWithUpload(t, up, 555)
	big := make([]byte, maxFileUpChunk+1)
	c.dispatchFileUp(context.Background(), fileUpFrame(9, 42, 1, 1, big))
	waitSend(t, c)
	if up.gotMediaID != 0 { // SavePart не должен вызваться
		t.Fatal("oversized chunk must be rejected before SavePart")
	}
	if got := lastSent(t, c); !containsErr(got, 9, "error") {
		t.Fatalf("expected file_up_err error, got %s", got)
	}
}
```

(`containsErr` — маленький helper: распарсить JSON и сверить t=="file_up_err", req_id, error.)

- [ ] **Step 3: Запустить — упадёт**

Run: `cd backend && go test ./internal/adapter/delivery/ws/ -run TestDispatchFileUp -count=1`
Expected: FAIL (dispatchFileUp/SetUploadDispatcher нет).

- [ ] **Step 4: Реализация — codec decode→kind**

В `conn.go`: добавить `const frameKindFileUp byte = 0x02` рядом с `frameKindFile`.
Изменить интерфейс и реализации:

```go
type frameCodec interface {
	decode(raw []byte) (kind byte, payload []byte, err error) // WS-байты → (kind, plaintext-кадр)
	encode(kind byte, frame []byte) (int, []byte)
}

func (plainCodec) decode(raw []byte) (byte, []byte, error) { return frameKindJSON, raw, nil }

func (c *dnpCodec) decode(raw []byte) (byte, []byte, error) {
	plain, err := dnp.DecryptFrame(c.recv, raw)
	if err != nil {
		return 0, nil, err
	}
	if len(plain) < 1 {
		return 0, nil, errors.New("dnp: empty frame")
	}
	return plain[0], plain[1:], nil
}
```

`readPump` (ветвление по kind):

```go
kind, plain, err := c.codec.decode(data)
if err != nil {
	return // nonce-десинк (DNP) — рвём; plainCodec никогда не ошибается
}
switch kind {
case frameKindFileUp:
	c.dispatchFileUp(ctx, plain)
	continue
case frameKindJSON:
	var f Frame
	if json.Unmarshal(plain, &f) != nil {
		continue
	}
	c.dispatch(ctx, f)
default:
	continue // неизвестный kind — дропаем кадр (decrypt удался, nonce цел)
}
```

(Заменяет прежние строки `plain, err := c.codec.decode(data)` … `c.dispatch(ctx, f)`.)

- [ ] **Step 5: Реализация — UploadDispatcher, Conn-поля, dispatchFileUp**

В `file.go` добавить интерфейс:

```go
// UploadDispatcher пишет один part медиа (реализуется в http через MediaUploader).
// Права (владелец медиа) проверяются внутри реализации; ошибка → domain.ErrForbidden.
type UploadDispatcher interface {
	SavePart(ctx context.Context, userID, mediaID int64, index, total int, data []byte) error
}
```

В `conn.go`: поля `upload UploadDispatcher` + `uploadSem chan struct{}` в структуре `Conn`;
инициализация `uploadSem: make(chan struct{}, uploadMaxConcurrent)` в конструкторе; сеттер:

```go
func (c *Conn) SetUploadDispatcher(u UploadDispatcher) { c.upload = u }
```

(Если `Conn` создаётся с фиксированным набором аргументов и `file` тоже сеттером —
следуй тому же стилю: `upload` через сеттер, как `SetFileDispatcher`. Проверь, как
`SetFileDispatcher` объявлен, и повтори 1:1.)

`dispatchFileUp` (по образцу `case "file_req"`):

```go
func (c *Conn) dispatchFileUp(ctx context.Context, payload []byte) {
	if c.upload == nil {
		return // plain-conn / до SetUploadDispatcher
	}
	reqID, mediaID, index, total, data, ok := parseFileUp(payload)
	if !ok || mediaID == 0 {
		return // битый кадр — молча дропаем (req_id мог не распарситься)
	}
	if len(data) > maxFileUpChunk {
		c.Send(fileUpErrFrame(reqID, "error"))
		return
	}
	select {
	case c.uploadSem <- struct{}{}:
	default:
		c.Send(fileUpErrFrame(reqID, "busy"))
		return
	}
	upload, userID := c.upload, c.userID
	go func() {
		defer func() { <-c.uploadSem }()
		defer saferun.Recover("ws.conn.upload")
		err := upload.SavePart(context.Background(), userID, mediaID, index, total, data)
		switch {
		case err == nil:
			c.Send(fileUpOkFrame(reqID))
		case errors.Is(err, domain.ErrForbidden):
			c.Send(fileUpErrFrame(reqID, "forbidden"))
		default:
			c.Send(fileUpErrFrame(reqID, "error")) // bad_part и прочее — короткий код
		}
	}()
}
```

(Если usecase отдаёт различимый `ErrBadPart` и его хочется отразить — маппь в "bad_part";
иначе "error". Смотри, экспортируется ли он из ws-видимого пакета; если нет — оставь "error".)

- [ ] **Step 6: Обновить сломанные вызовы decode**

Найти все вызовы `codec.decode`/`.decode(` в тестах пакета и обновить под новую сигнатуру
`(kind, payload, err)`:

Run: `cd backend && grep -rn "\.decode(" internal/adapter/delivery/ws/`
Поправить каждый (в т.ч. `dnp_support_test.go`/codec-тесты, если есть). Затем весь пакет.

- [ ] **Step 7: Запустить — зелёные (весь ws-пакет, кроме предсуществующего revoke-флейки)**

Run: `cd backend && go test ./internal/adapter/delivery/ws/... -count=1`
Expected: PASS (кроме `TestWS_RevokeClosesSocket` — предсуществующий флейк на main, не связан).
`go vet ./internal/adapter/delivery/ws/...` — чисто.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/adapter/delivery/ws/
git commit -m "feat(dnp): codec decode→kind + file_up диспатч (readPump ветка, UploadDispatcher)"
```

---

### Task 3: http-адаптер MediaUploader + server.go wiring

**Files:**
- Create: `backend/internal/adapter/delivery/http/media_uploader.go`
- Modify: `backend/internal/app/server.go` (late-bind, рядом с `SetFileDispatcher`)
- Test: `backend/internal/adapter/delivery/http/media_uploader_test.go`

**Interfaces:**
- Consumes: `ws.UploadDispatcher` (Task 2); `usecasemedia.Interactor.SavePart`.
- Produces: `NewMediaUploader(svc) *MediaUploader` реализует `ws.UploadDispatcher`.

- [ ] **Step 1: Тест — SavePart проксируется в usecase с bytes.Reader**

```go
package http

import (
	"bytes"
	"context"
	"io"
	"testing"
)

type fakeUpSvc struct {
	id, owner     int64
	index, total  int
	body          []byte
	size          int64
}

func (f *fakeUpSvc) SavePart(_ context.Context, id, ownerID int64, index, total int, r io.Reader, size int64) error {
	f.id, f.owner, f.index, f.total, f.size = id, ownerID, index, total, size
	f.body, _ = io.ReadAll(r)
	return nil
}

func TestMediaUploaderSavePart(t *testing.T) {
	svc := &fakeUpSvc{}
	up := NewMediaUploader(svc)
	if err := up.SavePart(context.Background(), 7, 42, 2, 10, []byte{1, 2, 3}); err != nil {
		t.Fatal(err)
	}
	if svc.id != 42 || svc.owner != 7 || svc.index != 2 || svc.total != 10 || svc.size != 3 || !bytes.Equal(svc.body, []byte{1, 2, 3}) {
		t.Fatalf("proxy mismatch: %+v", svc)
	}
}
```

Примечание: `NewMediaUploader` должен принимать УЗКИЙ интерфейс (метод `SavePart`), а не
конкретный `*usecasemedia.Interactor` — чтобы тест подставил fake. Объяви локальный интерфейс
`partSaver` в `media_uploader.go` с сигнатурой usecase-метода.

- [ ] **Step 2: Запустить — упадёт**

Run: `cd backend && go test ./internal/adapter/delivery/http/ -run TestMediaUploader -count=1`
Expected: FAIL.

- [ ] **Step 3: Реализация `media_uploader.go`**

```go
package http

import (
	"bytes"
	"context"
	"io"
)

// partSaver — узкий порт usecase (тестируемость): совпадает с
// usecasemedia.Interactor.SavePart.
type partSaver interface {
	SavePart(ctx context.Context, id, ownerID int64, partIndex, total int, r io.Reader, size int64) error
}

// MediaUploader реализует ws.UploadDispatcher: пишет part медиа из DNP-канала через
// usecase SavePart (права владельца — внутри usecase).
type MediaUploader struct{ svc partSaver }

func NewMediaUploader(svc partSaver) *MediaUploader { return &MediaUploader{svc: svc} }

func (u *MediaUploader) SavePart(ctx context.Context, userID, mediaID int64, index, total int, data []byte) error {
	return u.svc.SavePart(ctx, mediaID, userID, index, total, bytes.NewReader(data), int64(len(data)))
}
```

- [ ] **Step 4: Wiring в server.go**

Рядом с `h.SetFileDispatcher(httptransport.NewFileStreamer(p.ChatUC, mediaUC))` (server.go:329)
добавить:

```go
h.SetUploadDispatcher(httptransport.NewMediaUploader(mediaUC))
```

(Проверь имя ws-хендлера `h` и переменную `mediaUC` в этом месте — используй те же.)

- [ ] **Step 5: Запустить — зелёные + сборка всего backend**

Run: `cd backend && go test ./internal/adapter/delivery/http/ -run TestMediaUploader -count=1 && go build ./... && go vet ./...`
Expected: PASS + сборка без ошибок.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/adapter/delivery/http/media_uploader.go backend/internal/adapter/delivery/http/media_uploader_test.go backend/internal/app/server.go
git commit -m "feat(dnp): MediaUploader (ws.UploadDispatcher→SavePart) + wiring server.go"
```

---

### Task 4: e2e через живой flynn/noise initiator (file_up по каналу)

**Files:**
- Test: `backend/internal/adapter/delivery/ws/upload_e2e_test.go`

**Interfaces:**
- Consumes: весь стек Task 1-3 + существующая обвязка e2e (`file_e2e_test.go` — хендшейк
  NK initiator + auth + EncryptFrame).

- [ ] **Step 1: Тест — initiator шлёт file_up (kind 0x02), сервер пишет part + ack file_up_ok**

По образцу `file_e2e_test.go` (переиспользуй его хелперы хендшейка/шифрования):
1. Подними Conn с `SetUploadDispatcher(&fakeUploader{})` (fake ловит SavePart-аргументы).
2. Initiator проводит NK-хендшейк + auth (как в file_e2e).
3. Шлёт **бинарный** кадр: `EncryptFrame(iSend, append([]byte{0x02}, fileUpFrame(7, 5, 1, 1, []byte{9,9,9})...))`.
4. Читает ответный кадр (sealed) → decrypt → это JSON kind 0x00 `file_up_ok{req_id:7}`.
5. Проверяет: fake получил index=1,total=1,data=[9,9,9]; ack корректен.

```go
// Скелет (детали хелперов — из file_e2e_test.go):
func TestDNPChannelFileUpEndToEnd(t *testing.T) {
	up := &fakeUploader{}
	// ... поднять httptest-сервер с ws-хендлером, SetUploadDispatcher(up) ...
	// ... NK initiator: handshake + auth-кадр ...
	frame := fileUpFrame(7, 5, 1, 1, []byte{9, 9, 9})
	wire, err := dnp.EncryptFrame(iSend, append([]byte{0x02}, frame...))
	if err != nil { t.Fatal(err) }
	// ... write wire; read reply; decrypt via iRecv; snip kind 0x00; json → file_up_ok, req_id=7 ...
	if up.gotMediaID != 5 || up.gotIndex != 1 || string(up.gotData) != string([]byte{9,9,9}) {
		t.Fatalf("SavePart not called correctly: %+v", up)
	}
}
```

Примечание: НЕ дублируй хендшейк — вынеси/переиспользуй хелпер из `file_e2e_test.go`
(там уже есть initiator-обвязка). Если хелпер приватный и переиспользуем — зови его; если
инлайн — скопируй минимально необходимое, как это сделано в rpc/file e2e.

- [ ] **Step 2: Запустить — зелёный**

Run: `cd backend && go test ./internal/adapter/delivery/ws/ -run TestDNPChannelFileUpEndToEnd -count=1 -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/adapter/delivery/ws/upload_e2e_test.go
git commit -m "test(dnp): e2e file_up через живой Noise-канал (flynn initiator)"
```

---

## Финальная проверка (после всех задач)

- `cd backend && go build ./... && go vet ./...` — чисто.
- `cd backend && go test ./internal/adapter/delivery/ws/... ./internal/adapter/delivery/http/... -count=1`
  — зелёные (кроме предсуществующего `TestWS_RevokeClosesSocket`).

## Self-Review

- **Покрытие спеки:** приём kind 0x02 (Task 2 codec+readPump) ✅; file_up parse/ack (Task 1)
  ✅; UploadDispatcher→SavePart (Task 2+3) ✅; лимит чанка (Task 2) ✅; e2e по каналу (Task 4)
  ✅. Клиент — PR-b (вне scope).
- **Плейсхолдеры:** нет — код приведён; helper-адаптация тестов явно указана со ссылкой на
  существующие образцы (`file_dispatch_test.go`, `file_e2e_test.go`).
- **Типы:** `SavePart(userID, mediaID, index, total, data)` (ws.UploadDispatcher) ↔
  `MediaUploader.SavePart` ↔ usecase `SavePart(id, ownerID, index, total, r, size)` —
  порядок аргументов на границе адаптера инвертируется (userID→ownerID, mediaID→id) явно в
  Task 3. `decode` новая сигнатура `(byte,[]byte,error)` — все callers обновлены в Task 2 Step 6.
