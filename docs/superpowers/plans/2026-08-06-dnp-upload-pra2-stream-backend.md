# DNP upload PR-a′ (backend): reshape file_up → стрим в объект (io.Pipe→PutObject)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.
> Шаги — чекбоксы.

**Goal:** Переиграть приём `file_up` из #137 (был: `index`→MinIO-multipart-part, ломался на
правиле S3 «part ≥5МБ») на **потоковую сборку**: `file_up` несёт `offset`, бэкенд стримит
чанки по порядку в один MinIO-объект через `io.Pipe → PutObject`. Без multipart, без 5МБ,
память = один чанк.

**Architecture:** `file_up` заголовок → offset+total. Новый usecase-компонент
`StreamUploads` (в пакете `usecase/media`): сессия per mediaID (`io.Pipe` + горутина
`PutObject`), проверка порядка offset, idle-abort (GC + обрыв). ws `UploadDispatcher.WriteChunk`
→ http `MediaUploader` → `StreamUploads.WriteChunk`. Существующий HTTP multipart-путь
(`SavePart`/`Finalize`/`PutPart`) **НЕ трогаем** — он для не-DNP.

**Tech Stack:** Go 1.25, MinIO (`storage.PutObject(ctx, objectKey, io.Reader, size, mime)`),
flynn/noise (e2e). Клиент — PR-b.

Дизайн: `docs/superpowers/specs/2026-08-06-dnp-file-exchange-design.md`.

## Global Constraints

- **Чистая архитектура:** `ws` знает только интерфейс `UploadDispatcher`; реализация — http
  (`MediaUploader`) → usecase (`StreamUploads`). `StreamUploads` живёт в пакете `usecase/media`
  (доступ к неэкспортируемым `Interactor.storage/repo/process`).
- **Read-limit:** sealed `file_up`-кадр ≤ `maxMessageSize` (1МБ). `maxFileUpChunk = 512КБ` (data).
- **Wire (Big-Endian, заголовок 28Б):** `req_id(u32)@0 │ media_id(u64)@4 │ offset(u64)@12 │
  total(u64)@20 │ data@28`. `len = len(payload) − 28`. Последний чанк: `offset+len == total`.
- **Ack (JSON kind 0x00):** `file_up_ok{req_id}` / `file_up_err{req_id, error}`
  (error: forbidden/order/error/busy).
- **Порядок:** чанки строго по возрастанию offset (клиент stop-and-wait). Нарушение → `order` +
  сессия рвётся (клиент рестартит файл). Инвариант: для одного mediaID нет конкурентных
  WriteChunk (клиент шлёт следующий только после ack).
- **Права** — `ownerID` (=userID канала) сверяется при offset=0 (`GetByID`+`OwnerID`).
- **HTTP multipart-путь не трогаем.**

---

### Task 1: reshape file_up frame — offset/total (28Б заголовок)

**Files:**
- Modify: `backend/internal/adapter/delivery/ws/upload.go`
- Modify: `backend/internal/adapter/delivery/ws/upload_test.go`

**Interfaces:**
- Produces: `parseFileUp(p []byte) (reqID uint32, mediaID, offset, total int64, data []byte, ok bool)`;
  `fileUpFrame(reqID uint32, mediaID, offset, total int64, data []byte) []byte`. (`fileUpOkFrame`/
  `fileUpErrFrame`, `maxFileUpChunk`, `uploadMaxConcurrent` — без изменений.)

- [ ] **Step 1: Обновить тест round-trip под offset/total**

```go
func TestFileUpFrameRoundTrip(t *testing.T) {
	data := []byte{1, 2, 3, 4, 5}
	frame := fileUpFrame(7, 42, 1024, 8192, data)
	reqID, mediaID, offset, total, got, ok := parseFileUp(frame)
	if !ok || reqID != 7 || mediaID != 42 || offset != 1024 || total != 8192 || string(got) != string(data) {
		t.Fatalf("round-trip mismatch: %d %d %d %d %v ok=%v", reqID, mediaID, offset, total, got, ok)
	}
}

func TestParseFileUpShort(t *testing.T) {
	if _, _, _, _, _, ok := parseFileUp(make([]byte, 27)); ok { // < 28Б заголовка
		t.Fatal("short payload must be rejected")
	}
}
```

(Удали старый тест с `index/total` u32-mismatch — теперь len выводится из размера кадра, отдельного
len-поля нет, поэтому mismatch-теста на len больше нет.)

- [ ] **Step 2: Запустить — упадёт (старая сигнатура index)**

Run: `cd backend && go test ./internal/adapter/delivery/ws/ -run TestFileUp -count=1`
Expected: FAIL (сигнатуры не совпадают).

- [ ] **Step 3: Реализация — offset/total, 28Б заголовок**

```go
// fileUpFrame собирает бинарный file_up (payload ПОСЛЕ kind-байта 0x02). Layout BE:
// req_id(u32)│media_id(u64)│offset(u64)│total(u64)│data. len выводится из размера кадра.
func fileUpFrame(reqID uint32, mediaID, offset, total int64, data []byte) []byte {
	out := make([]byte, 28+len(data))
	binary.BigEndian.PutUint32(out[0:4], reqID)
	binary.BigEndian.PutUint64(out[4:12], uint64(mediaID))
	binary.BigEndian.PutUint64(out[12:20], uint64(offset))
	binary.BigEndian.PutUint64(out[20:28], uint64(total))
	copy(out[28:], data)
	return out
}

// parseFileUp разбирает payload file_up (без kind-байта). ok=false при коротком заголовке.
func parseFileUp(p []byte) (reqID uint32, mediaID, offset, total int64, data []byte, ok bool) {
	if len(p) < 28 {
		return 0, 0, 0, 0, nil, false
	}
	reqID = binary.BigEndian.Uint32(p[0:4])
	mediaID = int64(binary.BigEndian.Uint64(p[4:12]))
	offset = int64(binary.BigEndian.Uint64(p[12:20]))
	total = int64(binary.BigEndian.Uint64(p[20:28]))
	return reqID, mediaID, offset, total, p[28:], true
}
```

- [ ] **Step 4: Запустить — зелёные**

Run: `cd backend && go test ./internal/adapter/delivery/ws/ -run TestFileUp -count=1 && go test ./internal/adapter/delivery/ws/ -run TestParseFileUp -count=1`

- [ ] **Step 5: Commit**

```bash
git add backend/internal/adapter/delivery/ws/upload.go backend/internal/adapter/delivery/ws/upload_test.go
git commit -m "refactor(dnp): file_up несёт offset/total (стрим) вместо index (28Б заголовок)"
```

---

### Task 2: usecase StreamUploads — io.Pipe→PutObject, сессия, порядок, idle-abort

**Files:**
- Create: `backend/internal/usecase/media/stream_upload.go`
- Test: `backend/internal/usecase/media/stream_upload_test.go`

**Interfaces:**
- Consumes: `Interactor.storage.PutObject`, `Interactor.repo.GetByID`, `Interactor.process`.
- Produces: `NewStreamUploads(svc *Interactor) *StreamUploads`;
  `WriteChunk(ctx, ownerID, mediaID, offset, total int64, data []byte) (done bool, err error)`.

- [ ] **Step 1: Тест — целый объект собирается из чанков по порядку**

```go
package media

import (
	"bytes"
	"context"
	"io"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// фейки storage/repo с минимумом под StreamUploads (следуй существующим фейкам media_test.go —
// если там есть fakeRepo/fakeStorage, расширь/переиспользуй их, не дублируй типы).
// storage.PutObject должен РЕАЛЬНО дочитать r до EOF в отдельной горутине (иначе io.Pipe
// заблокирует writer) — фейк складывает прочитанное в буфер.

func TestStreamUploadAssembles(t *testing.T) {
	st := &fakeStorage{} // PutObject: io.ReadAll(r) → сохранить по objectKey
	repo := &fakeRepo{media: domain.Media{ID: 42, OwnerID: 7, ObjectKey: "k", Mime: "video/mp4"}}
	svc := New(repo, st, nil) // processor nil
	su := NewStreamUploads(svc)
	ctx := context.Background()

	// total=6, два чанка по 3
	done, err := su.WriteChunk(ctx, 7, 42, 0, 6, []byte{1, 2, 3})
	if err != nil || done { t.Fatalf("chunk1: done=%v err=%v", done, err) }
	done, err = su.WriteChunk(ctx, 7, 42, 3, 6, []byte{4, 5, 6})
	if err != nil || !done { t.Fatalf("chunk2 (last): done=%v err=%v", done, err) }

	if got := st.get("k"); !bytes.Equal(got, []byte{1, 2, 3, 4, 5, 6}) {
		t.Fatalf("assembled object mismatch: %v", got)
	}
}
```

- [ ] **Step 2: Тест — не тот offset → order-ошибка + чужой владелец → forbidden**

```go
func TestStreamUploadOrder(t *testing.T) {
	su := NewStreamUploads(New(&fakeRepo{media: domain.Media{ID: 42, OwnerID: 7, ObjectKey: "k"}}, &fakeStorage{}, nil))
	if _, err := su.WriteChunk(context.Background(), 7, 42, 0, 9, []byte{1, 2, 3}); err != nil { t.Fatal(err) }
	// ожидался offset=3, шлём 6 → order
	if _, err := su.WriteChunk(context.Background(), 7, 42, 6, 9, []byte{7, 8, 9}); err == nil {
		t.Fatal("out-of-order offset must error")
	}
}

func TestStreamUploadForbidden(t *testing.T) {
	su := NewStreamUploads(New(&fakeRepo{media: domain.Media{ID: 42, OwnerID: 7, ObjectKey: "k"}}, &fakeStorage{}, nil))
	_, err := su.WriteChunk(context.Background(), 999, 42, 0, 3, []byte{1, 2, 3}) // не владелец
	if err != ErrForbidden {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}
```

- [ ] **Step 3: Запустить — упадёт**

Run: `cd backend && go test ./internal/usecase/media/ -run TestStreamUpload -count=1`
Expected: FAIL (StreamUploads нет).

- [ ] **Step 4: Реализация `stream_upload.go`**

```go
package media

import (
	"context"
	"errors"
	"io"
	"sync"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// streamIdleTTL — если по сессии нет чанков дольше этого, она абортится (обрыв канала /
// брошенный аплоад). Двойная роль: корректность (не течём) + GC.
const streamIdleTTL = 60 * time.Second

type streamSession struct {
	pw     *io.PipeWriter
	next   int64      // ожидаемый следующий offset
	result chan error // итог PutObject
	m      domain.Media
	timer  *time.Timer
}

// StreamUploads собирает медиа-объект из упорядоченных по offset чанков DNP-канала:
// первый чанк открывает io.Pipe + горутину PutObject, последующие пишут в pipe по порядку,
// последний закрывает pipe → объект готов → фоновый процессинг. Без S3-multipart.
type StreamUploads struct {
	svc      *Interactor
	mu       sync.Mutex
	sessions map[int64]*streamSession // ключ — mediaID
}

func NewStreamUploads(svc *Interactor) *StreamUploads {
	return &StreamUploads{svc: svc, sessions: make(map[int64]*streamSession)}
}

func (su *StreamUploads) abort(mediaID int64, s *streamSession, cause error) {
	_ = s.pw.CloseWithError(cause) // рвёт PutObject-читателя
	su.mu.Lock()
	if su.sessions[mediaID] == s {
		delete(su.sessions, mediaID)
	}
	su.mu.Unlock()
	s.timer.Stop()
}

// WriteChunk пишет один упорядоченный чанк. done=true — объект собран целиком.
func (su *StreamUploads) WriteChunk(ctx context.Context, ownerID, mediaID, offset, total int64, data []byte) (bool, error) {
	su.mu.Lock()
	s := su.sessions[mediaID]
	if s == nil {
		if offset != 0 {
			su.mu.Unlock()
			return false, ErrBadPart // сессии нет, а offset не нулевой
		}
		m, err := su.svc.repo.GetByID(ctx, mediaID)
		if err != nil {
			su.mu.Unlock()
			return false, err
		}
		if m.OwnerID != ownerID {
			su.mu.Unlock()
			return false, ErrForbidden
		}
		pr, pw := io.Pipe()
		s = &streamSession{pw: pw, next: 0, result: make(chan error, 1), m: m}
		s.timer = time.AfterFunc(streamIdleTTL, func() { su.abort(mediaID, s, errors.New("upload idle timeout")) })
		su.sessions[mediaID] = s
		su.mu.Unlock()
		go func() { s.result <- su.svc.storage.PutObject(context.Background(), m.ObjectKey, pr, total, m.Mime) }()
	} else {
		su.mu.Unlock()
	}

	if offset != s.next {
		su.abort(mediaID, s, errors.New("out of order"))
		return false, ErrBadPart
	}
	s.timer.Reset(streamIdleTTL)
	if _, err := s.pw.Write(data); err != nil { // PutObject упал / сессия абортнута
		su.abort(mediaID, s, err)
		return false, err
	}
	s.next += int64(len(data))

	if s.next >= total { // последний чанк
		_ = s.pw.Close() // EOF → PutObject завершает объект
		err := <-s.result
		su.mu.Lock()
		if su.sessions[mediaID] == s {
			delete(su.sessions, mediaID)
		}
		su.mu.Unlock()
		s.timer.Stop()
		if err != nil {
			return false, err
		}
		if su.svc.processor != nil {
			go su.svc.process(s.m) // dims/thumbnail в фоне (как PutContent)
		}
		return true, nil
	}
	return false, nil
}
```

(Проверь фактические имена: `Interactor.storage`/`repo`/`processor`/`process`, `ErrBadPart`/
`ErrForbidden`, `ObjectStorage.PutObject` сигнатуру — используй реальные из `media.go`/`ports.go`.)

- [ ] **Step 5: Запустить — зелёные**

Run: `cd backend && go test ./internal/usecase/media/ -run TestStreamUpload -count=1 && go test ./internal/usecase/media/ -count=1`
Expected: PASS (весь пакет media).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/usecase/media/stream_upload.go backend/internal/usecase/media/stream_upload_test.go
git commit -m "feat(dnp): StreamUploads — сборка объекта из offset-чанков (io.Pipe→PutObject)"
```

---

### Task 3: ws UploadDispatcher.WriteChunk + dispatchFileUp (offset) + http MediaUploader reshape + wiring

**Files:**
- Modify: `backend/internal/adapter/delivery/ws/file.go` (интерфейс `UploadDispatcher`)
- Modify: `backend/internal/adapter/delivery/ws/conn.go` (`dispatchFileUp`)
- Modify: `backend/internal/adapter/delivery/ws/upload_dispatch_test.go`
- Modify: `backend/internal/adapter/delivery/http/media_uploader.go`
- Create: `backend/internal/adapter/delivery/http/media_uploader_test.go` (переписать под WriteChunk)
- Modify: `backend/internal/app/server.go`

**Interfaces:**
- `UploadDispatcher.WriteChunk(ctx, userID, mediaID, offset, total int64, data []byte) (done bool, err error)`
  (заменяет `SavePart`).
- `MediaUploader` оборачивает `chunkWriter{ WriteChunk(ctx, ownerID, mediaID, offset, total int64, data []byte) (bool, error) }` (реализуется `*usecasemedia.StreamUploads`).

- [ ] **Step 1: Обновить интерфейс + dispatchFileUp под offset (тест dispatch)**

Тест `upload_dispatch_test.go` — `fakeUploader` меняет метод на `WriteChunk`, а `dispatchFileUp`
шлёт `file_up_ok` при успехе (в т.ч. done), `file_up_err "forbidden"` при `ErrForbidden`,
`"error"` иначе; кадр > `maxFileUpChunk` → `"error"` без вызова. Кадр строится
`fileUpFrame(reqID, mediaID, offset, total, data)`.

```go
type fakeUploader struct {
	gotUserID, gotMediaID, gotOffset, gotTotal int64
	gotData                                    []byte
	done                                       bool
	err                                        error
}
func (f *fakeUploader) WriteChunk(_ context.Context, userID, mediaID, offset, total int64, data []byte) (bool, error) {
	f.gotUserID, f.gotMediaID, f.gotOffset, f.gotTotal, f.gotData = userID, mediaID, offset, total, append([]byte(nil), data...)
	return f.done, f.err
}
// TestDispatchFileUpOK: fileUpFrame(9, 42, 0, 3, {1,2,3}); ждём file_up_ok req_id=9; fake.gotOffset==0,total==3.
// TestDispatchFileUpForbidden: err=domain.ErrForbidden → file_up_err "forbidden".
// TestDispatchFileUpTooLarge: data > maxFileUpChunk → file_up_err "error", WriteChunk НЕ вызван.
// (ОДНО чтение из c.send на тест — как в исправленной версии #137: только lastSent, без waitSend.)
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cd backend && go test ./internal/adapter/delivery/ws/ -run TestDispatchFileUp -count=1`

- [ ] **Step 3: Реализация — file.go интерфейс + conn.go dispatchFileUp**

`file.go`:
```go
type UploadDispatcher interface {
	WriteChunk(ctx context.Context, userID, mediaID, offset, total int64, data []byte) (done bool, err error)
}
```

`conn.go` `dispatchFileUp` (offset-версия):
```go
func (c *Conn) dispatchFileUp(ctx context.Context, payload []byte) {
	if c.upload == nil {
		return
	}
	reqID, mediaID, offset, total, data, ok := parseFileUp(payload)
	if !ok || mediaID == 0 {
		return
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
		_, err := upload.WriteChunk(context.Background(), userID, mediaID, offset, total, data)
		switch {
		case err == nil:
			c.Send(fileUpOkFrame(reqID))
		case errors.Is(err, domain.ErrForbidden):
			c.Send(fileUpErrFrame(reqID, "forbidden"))
		default:
			c.Send(fileUpErrFrame(reqID, "error"))
		}
	}()
}
```

(`done` для ack не используется — клиент знает завершение по отправленному последнему offset.
Порядок сессии обеспечен stop-and-wait: клиент шлёт следующий чанк только после `file_up_ok`,
поэтому конкурентных WriteChunk по одному mediaID нет, offset монотонен.)

- [ ] **Step 4: Реализация — http MediaUploader → chunkWriter/StreamUploads + server.go**

`media_uploader.go`:
```go
type chunkWriter interface {
	WriteChunk(ctx context.Context, ownerID, mediaID, offset, total int64, data []byte) (bool, error)
}
type MediaUploader struct{ su chunkWriter }
func NewMediaUploader(su chunkWriter) *MediaUploader { return &MediaUploader{su: su} }

// инверсия: ws-контракт (userID, mediaID) → usecase (ownerID=userID, mediaID)
func (u *MediaUploader) WriteChunk(ctx context.Context, userID, mediaID, offset, total int64, data []byte) (bool, error) {
	return u.su.WriteChunk(ctx, userID, mediaID, offset, total, data)
}
```
Тест `media_uploader_test.go` — fake `chunkWriter` ловит аргументы, проверяет проброс.

`server.go` (рядом с прежним wiring): было
`h.SetUploadDispatcher(httptransport.NewMediaUploader(mediaUC))` — стало
`h.SetUploadDispatcher(httptransport.NewMediaUploader(usecasemedia.NewStreamUploads(mediaUC)))`
(проверь имена импортов/переменных на месте).

- [ ] **Step 5: Запустить — зелёные + сборка**

Run: `cd backend && go build ./... && go vet ./internal/... && go test ./internal/adapter/delivery/ws/... ./internal/adapter/delivery/http/ -run 'FileUp|MediaUploader|DispatchFileUp' -count=1`

- [ ] **Step 6: Commit**

```bash
git add backend/internal/adapter/delivery/ws/ backend/internal/adapter/delivery/http/media_uploader.go backend/internal/adapter/delivery/http/media_uploader_test.go backend/internal/app/server.go
git commit -m "feat(dnp): ws WriteChunk + dispatchFileUp(offset) + MediaUploader→StreamUploads + wiring"
```

---

### Task 4: гардрейл — стрим/раздача не отдаёт байты нефинализированного объекта

**Files:**
- Test: `backend/internal/usecase/media/stream_upload_test.go` (доп. тест) ИЛИ
  `backend/internal/adapter/delivery/http/media_handler_test.go`

**Цель:** подтвердить (или починить), что чтение контента объекта, у которого стрим-запись ещё
НЕ завершена (объект не создан в MinIO), возвращает ошибку/404, а не частичные байты. Инвариант
из дизайна §5 (гардрейл 2).

- [ ] **Step 1: Тест — GetContent до записи объекта → ошибка**

```go
// В пакете usecase/media (или http, по месту GetContent). Медиа-строка создана (CreateUpload),
// но объект в storage ещё не записан (стрим не завершён) → GetContent/чтение должно вернуть err.
func TestGetContentBeforeStreamed(t *testing.T) {
	st := &fakeStorage{} // объект "k" НЕ записан
	svc := New(&fakeRepo{media: domain.Media{ID: 42, OwnerID: 7, ObjectKey: "k"}}, st, nil)
	if _, _, err := svc.GetContent(context.Background(), 42); err == nil {
		t.Fatal("GetContent на нефинализированном объекте должен ошибаться, а не отдавать байты")
	}
}
```

(Сверь фактическую сигнатуру `GetContent` — `media.go:264`+. Фейк `fakeStorage.GetContent`
на отсутствующий ключ должен возвращать ошибку/`domain.ErrNotFound`, отражая поведение MinIO
`GetObject` на несуществующий объект — если реальный storage так и делает, тест лишь фиксирует
инвариант; если нет — это реальный баг, чинить в usecase/adapter.)

- [ ] **Step 2: Запустить**

Run: `cd backend && go test ./internal/usecase/media/ -run TestGetContentBeforeStreamed -count=1`
Expected: PASS (инвариант держится) ЛИБО FAIL → починить и зафиксировать в отчёте.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/usecase/media/stream_upload_test.go
git commit -m "test(dnp): гардрейл — контент нефинализированного объекта не отдаётся (defense-in-depth)"
```

---

### Task 5: e2e через живой flynn/noise initiator (стрим file_up → объект)

**Files:**
- Modify: `backend/internal/adapter/delivery/ws/upload_e2e_test.go`

**Interfaces:**
- Consumes: стек Task 1-3 + обвязка `file_e2e_test.go`/`upload_e2e_test.go` (#137).

- [ ] **Step 1: Тест — initiator стримит 2 чанка file_up (offset 0,3), сервер собирает + ack'ает оба**

Переписать существующий `TestDNPChannelFileUpEndToEnd` (из #137) под стрим:
1. `fakeUploader` (или реальный `StreamUploads` с fake storage) на `SetUploadDispatcher`.
2. NK-хендшейк + auth (как есть).
3. Шлёт два бинарных кадра:
   `EncryptFrame(iSend, append([]byte{0x02}, fileUpFrame(7, 5, 0, 6, []byte{1,2,3})...))`,
   затем `...fileUpFrame(8, 5, 3, 6, []byte{4,5,6})...`.
4. Читает два ответных кадра → оба `file_up_ok` (req_id 7, затем 8).
5. Проверяет: fake получил оба чанка (offset 0 и 3, total 6); если использован реальный
   `StreamUploads`+fake storage — объект "k" == `{1,2,3,4,5,6}`.

```go
// использовать реальный StreamUploads для настоящего e2e сборки объекта:
// up := usecasemedia.NewStreamUploads(usecasemedia.New(fakeRepo{...owner совпадает с auth-userID...}, fakeStorage, nil))
// conn.SetUploadDispatcher(httptransport.NewMediaUploader(up))  // или напрямую, если пакетно доступно
```

(Переиспользуй хелперы хендшейка из `file_e2e_test.go`, не дублируй. Учти: auth-userID канала
должен совпасть с `OwnerID` медиа в fakeRepo, иначе forbidden.)

- [ ] **Step 2: Запустить — зелёный**

Run: `cd backend && go test ./internal/adapter/delivery/ws/ -run TestDNPChannelFileUpEndToEnd -count=1 -v`

- [ ] **Step 3: Commit**

```bash
git add backend/internal/adapter/delivery/ws/upload_e2e_test.go
git commit -m "test(dnp): e2e стрим file_up (2 чанка) → объект собран + ack по каналу"
```

---

## Финальная проверка

- `cd backend && go build ./... && go vet ./...` — чисто.
- `go test ./internal/adapter/delivery/ws/... ./internal/adapter/delivery/http/... ./internal/usecase/media/... -count=1`
  — зелёные (кроме предсущ. `TestWS_RevokeClosesSocket`).

## Self-Review

- **Покрытие дизайна:** offset-кадр (Task 1) ✅; стрим-сборка io.Pipe→PutObject + порядок +
  idle-abort (Task 2) ✅; ws→http→usecase проводка (Task 3) ✅; гардрейл нефинализированного
  (Task 4) ✅; e2e по каналу (Task 5) ✅. Multipart HTTP-путь не тронут.
- **Плейсхолдеры:** нет; фейки — со ссылкой на существующие `media_test.go`.
- **Типы:** `WriteChunk(userID/ownerID, mediaID, offset, total int64, data)` согласован
  ws↔http↔usecase; инверсия userID→ownerID в MediaUploader (Task 3). Заголовок 28Б (Task 1)
  ↔ `parseFileUp` ↔ e2e (Task 5). `#137`-маппинг `SavePart`/index удалён.
- **Риск (задокументирован):** stop-and-wait клиент гарантирует отсутствие конкурентных
  WriteChunk по mediaID (порядок); при нарушении — `order`-ошибка рвёт сессию (безопасно).
