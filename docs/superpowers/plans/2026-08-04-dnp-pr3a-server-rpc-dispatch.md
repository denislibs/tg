# DNP PR-3a — сервер: RPC-диспатч (роутер-реплей) (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сервер обрабатывает `rpc_req` из DNP-канала, прогоняя их через **тот же chi-роутер** (in-process реплей) с юзером канала, и шлёт `rpc_resp`. Ноль правок хендлеров. Клиент — в PR-3b.

**Architecture:** `RPCDispatcher` (интерфейс в ws, несёт user+deviceID) реализует `RouterRPC` в http (инжектит юзера в ctx через `WithUser`, реплеит роутер через `httptest`). `AuthMiddleware` пропускает ре-аутентификацию, если юзер уже в ctx (пред-инжектён доверенным каналом). DNP-`Conn` на `rpc_req` async-диспатчит (горутина + семафор) и шлёт `rpc_resp`. Разводка — поздним связыванием (разрыв цикла wsHandler↔router).

**Tech Stack:** Go 1.25, chi/v5, `net/http/httptest`, gorilla/websocket, flynn/noise. Всё из `backend/`.

**Спека:** [`../specs/2026-08-04-dnp-l4-rpc-tunnel-design.md`](../specs/2026-08-04-dnp-l4-rpc-tunnel-design.md).

## Global Constraints

- **Чистая архитектура:** `ws` НЕ импортирует `http` (оба — sibling-адаптеры). Поэтому `RPCDispatcher.Dispatch` несёт `user domain.User, deviceID int64`, а инжект в ctx делает `RouterRPC` (пакет http). ws импортирует только `domain`.
- **Кадры:** `rpc_req{req_id, method, path, body}` → `rpc_resp{req_id, status, body}`. `body` — сырой JSON (`json.RawMessage`), пустой → `null`. Статус HTTP несётся явно.
- **Plain-путь (`bearer`) и обычный HTTP — без изменений.** `AuthMiddleware` trust-preset безопасен: внешний HTTP строит ctx с нуля, юзера там нет до middleware.
- **Async-диспатч:** `rpc_req` в горутине (не блокировать read-pump/realtime). Конкурентность per-conn ограничена семафором (16); переполнение → `rpc_resp{status:503}` (не блокировать read-pump).
- `gofmt -l` пусто, `go vet ./...`, `go build ./...`, `go test ./...` зелёные. Команды из `backend/`.
- **Известное ограничение (задокументировать):** `rpc_resp` идёт через тот же best-effort `Conn.Send` (буфер 32, дропает при переполнении) — под экстремальной нагрузкой ответ может дропнуться → клиентский таймаут+ретрай. Приемлемо для L4; backpressure — позже.

## Файловая структура

- `internal/adapter/delivery/http/middleware.go` (правка) — `WithUser` + trust-preset в `AuthMiddleware`.
- `internal/adapter/delivery/http/middleware_test.go` (нов/правка) — тесты trust-preset.
- `internal/adapter/delivery/http/rpc.go` (новый) — `RouterRPC`.
- `internal/adapter/delivery/http/rpc_test.go` (новый).
- `internal/adapter/delivery/ws/conn.go` (правка) — `RPCDispatcher`, `Conn.user/rpc/rpcSem`, `newConn` sig, `dispatch` case `rpc_req`, `rpcRespFrame`.
- `internal/adapter/delivery/ws/handler.go` (правка) — `Handler.rpc` + `SetRPCDispatcher`, DNP-ветка передаёт user+rpc; plain-ветка — user+nil.
- `internal/adapter/delivery/ws/dnp_accept.go` (правка) — вернуть `domain.User`.
- `internal/adapter/delivery/ws/rpc_test.go` (новый) — fake-dispatcher + интеграция.
- `internal/app/server.go` (правка) — позднее связывание диспетчера.

---

### Task 1: `WithUser` + `AuthMiddleware` trust-preset

**Files:**
- Modify: `backend/internal/adapter/delivery/http/middleware.go`
- Create: `backend/internal/adapter/delivery/http/middleware_test.go`

**Interfaces:**
- Produces: `func WithUser(ctx context.Context, user domain.User, deviceID int64) context.Context`.

- [ ] **Step 1: Написать тесты (падающие)**

`backend/internal/adapter/delivery/http/middleware_test.go`:
```go
package http

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// authStub implements the Authenticator interface for middleware tests.
type authStub struct{ okToken string }

func (a authStub) Authenticate(_ context.Context, token string) (domain.User, int64, error) {
	if token != a.okToken {
		return domain.User{}, 0, errors.New("bad token")
	}
	return domain.User{ID: 7}, 3, nil
}

func TestAuthMiddlewareTrustsPresetUser(t *testing.T) {
	var seen int64
	h := AuthMiddleware(authStub{okToken: "x"})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, _ := UserFromContext(r.Context())
		seen = u.ID
		w.WriteHeader(http.StatusOK)
	}))

	// Preset user, NO Authorization header → middleware must skip re-auth.
	req := httptest.NewRequest(http.MethodGet, "/me", nil).
		WithContext(WithUser(context.Background(), domain.User{ID: 42}, 9))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || seen != 42 {
		t.Fatalf("preset user ignored: code=%d seen=%d", rec.Code, seen)
	}

	// No preset, no header → 401.
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/me", nil))
	if rec2.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 without auth, got %d", rec2.Code)
	}
}
```
> `authStub` переиспользуется в `rpc_test.go` (Task 2) — определи один раз (в middleware_test.go), не дублируй.

- [ ] **Step 2: Запустить — падает**

Run: `go test ./internal/adapter/delivery/http/ -run AuthMiddlewareTrusts -v`
Expected: FAIL — `WithUser` не существует / preset игнорируется (текущий middleware всегда требует токен).

- [ ] **Step 3: Реализовать**

`backend/internal/adapter/delivery/http/middleware.go` — добавить `WithUser` и trust-preset:
```go
// WithUser пред-инжектит аутентифицированного (доверенным каналом, in-process)
// юзера в ctx — так AuthMiddleware пропускает ре-аутентификацию по заголовку.
// Внешние HTTP-запросы так юзера подсунуть НЕ могут (их ctx строится сервером с нуля).
func WithUser(ctx context.Context, user domain.User, deviceID int64) context.Context {
	ctx = context.WithValue(ctx, userKey, user)
	return context.WithValue(ctx, deviceKey, deviceID)
}
```
В `AuthMiddleware` — в начало хендлера (перед чтением токена):
```go
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, ok := UserFromContext(r.Context()); ok {
				next.ServeHTTP(w, r) // юзер уже пред-инжектён доверенным in-process каналом
				return
			}
			token := bearerToken(r)
			// ... без изменений ...
```

- [ ] **Step 4: Тесты зелёные**

Run: `gofmt -w internal/adapter/delivery/http/ && go test ./internal/adapter/delivery/http/ -run AuthMiddlewareTrusts -v`
Expected: PASS (оба под-случая).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/adapter/delivery/http/middleware.go backend/internal/adapter/delivery/http/middleware_test.go
git commit -m "feat(http): WithUser + AuthMiddleware trusts a pre-injected (in-process) user

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `RouterRPC` — реплей роутера

**Files:**
- Create: `backend/internal/adapter/delivery/http/rpc.go`
- Create: `backend/internal/adapter/delivery/http/rpc_test.go`

**Interfaces:**
- Produces: `type RouterRPC struct { router http.Handler }`; `func NewRouterRPC(router http.Handler) *RouterRPC`; `func (d *RouterRPC) Dispatch(ctx context.Context, user domain.User, deviceID int64, method, path string, body []byte) (int, []byte)`.

- [ ] **Step 1: Написать тест (падающий)**

`backend/internal/adapter/delivery/http/rpc_test.go`:
```go
package http

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/messenger-denis/backend/internal/domain"
)

func TestRouterRPCReplaysWithInjectedUser(t *testing.T) {
	r := chi.NewRouter()
	r.Group(func(pr chi.Router) {
		pr.Use(AuthMiddleware(authStub{okToken: "x"})) // trust-preset пропустит без заголовка
		pr.Get("/me", func(w http.ResponseWriter, req *http.Request) {
			u, _ := UserFromContext(req.Context())
			writeJSON(w, http.StatusOK, map[string]any{"id": u.ID})
		})
	})
	d := NewRouterRPC(r)

	status, body := d.Dispatch(context.Background(), domain.User{ID: 55}, 1, http.MethodGet, "/me", nil)
	if status != http.StatusOK {
		t.Fatalf("status=%d body=%s", status, body)
	}
	if !strings.Contains(string(body), `"id":55`) {
		t.Fatalf("body missing injected user: %s", body)
	}

	// Несуществующий путь → 404.
	if s, _ := d.Dispatch(context.Background(), domain.User{ID: 55}, 1, http.MethodGet, "/nope", nil); s != http.StatusNotFound {
		t.Fatalf("want 404, got %d", s)
	}
}
```
> `authStub` — из middleware_test.go (Task 1), тот же пакет. `writeJSON` — существующий хелпер пакета http.

- [ ] **Step 2: Запустить — падает**

Run: `go test ./internal/adapter/delivery/http/ -run RouterRPC -v`
Expected: FAIL — `RouterRPC`/`NewRouterRPC` не существуют.

- [ ] **Step 3: Реализовать**

`backend/internal/adapter/delivery/http/rpc.go`:
```go
package http

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"

	"github.com/messenger-denis/backend/internal/domain"
)

// RouterRPC реплеит rpc-запрос канала через реальный chi-роутер.
type RouterRPC struct{ router http.Handler }

func NewRouterRPC(router http.Handler) *RouterRPC { return &RouterRPC{router: router} }

// Dispatch строит синтетический http.Request с пред-инжектённым юзером канала и
// прогоняет его через роутер, возвращая статус и тело ответа. AuthMiddleware
// пропускает ре-аутентификацию (юзер уже в ctx); хендлеры читают UserFromContext.
func (d *RouterRPC) Dispatch(ctx context.Context, user domain.User, deviceID int64, method, path string, body []byte) (int, []byte) {
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	req = req.WithContext(WithUser(ctx, user, deviceID))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	d.router.ServeHTTP(rec, req)
	return rec.Code, rec.Body.Bytes()
}
```

- [ ] **Step 4: Тесты зелёные**

Run: `gofmt -w internal/adapter/delivery/http/ && go test ./internal/adapter/delivery/http/ -run RouterRPC -v`
Expected: PASS (200 + тело с id=55; 404 на несуществующем).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/adapter/delivery/http/rpc.go backend/internal/adapter/delivery/http/rpc_test.go
git commit -m "feat(http): RouterRPC — dispatch channel RPC by replaying the chi router

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: ws — обработка `rpc_req` (интерфейс, conn, dispatch)

**Files:**
- Modify: `backend/internal/adapter/delivery/ws/dnp_accept.go`
- Modify: `backend/internal/adapter/delivery/ws/conn.go`
- Modify: `backend/internal/adapter/delivery/ws/handler.go`
- Create: `backend/internal/adapter/delivery/ws/rpc_test.go`

**Interfaces:**
- Produces: `type RPCDispatcher interface { Dispatch(ctx context.Context, user domain.User, deviceID int64, method, path string, body []byte) (int, []byte) }`; `func (h *Handler) SetRPCDispatcher(d RPCDispatcher)`; `newConn(..., user domain.User, deviceID int64, codec frameCodec, rpc RPCDispatcher)`.
- Consumes: `dnpAccept` теперь возвращает `domain.User`.

- [ ] **Step 1: Написать тест (падающий)**

`backend/internal/adapter/delivery/ws/rpc_test.go`:
```go
package ws

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type fakeRPC struct{ gotUser int64 }

func (f *fakeRPC) Dispatch(_ context.Context, user domain.User, _ int64, method, path string, body []byte) (int, []byte) {
	f.gotUser = user.ID
	return 200, []byte(`{"ok":true,"m":"` + method + `","p":"` + path + `"}`)
}

func TestConnDispatchesRPCReq(t *testing.T) {
	rpc := &fakeRPC{}
	c := newConn(nil, nil, nil, nil, domain.User{ID: 77}, 5, plainCodec{}, rpc)
	// Читаем c.send напрямую (без реального сокета).
	f := Frame{T: "rpc_req", D: json.RawMessage(`{"req_id":"r1","method":"GET","path":"/dialogs","body":null}`)}
	c.dispatch(context.Background(), f)

	select {
	case raw := <-c.send:
		var out struct {
			T string `json:"t"`
			D struct {
				ReqID  string          `json:"req_id"`
				Status int             `json:"status"`
				Body   json.RawMessage `json:"body"`
			} `json:"d"`
		}
		if json.Unmarshal(raw, &out) != nil || out.T != "rpc_resp" || out.D.ReqID != "r1" || out.D.Status != 200 {
			t.Fatalf("bad rpc_resp: %s", raw)
		}
		if rpc.gotUser != 77 {
			t.Fatalf("user not passed: %d", rpc.gotUser)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no rpc_resp (async dispatch stuck?)")
	}
}
```
> Реализатору: `newConn` вызывается с `nil` для ws/hub/svc/presence — в этом тесте `dispatch` для `rpc_req` их не трогает (только `c.rpc`, `c.user`, `c.send`). Семафор `rpcSem` должен быть проинициализирован в `newConn`. Если `c.send` не забуферен — сделай буфер (он уже `make(chan []byte, sendBuffer)`).

- [ ] **Step 2: Запустить — падает**

Run: `go test ./internal/adapter/delivery/ws/ -run ConnDispatchesRPC -v`
Expected: FAIL — `newConn` не принимает rpc; case `rpc_req` не обрабатывается.

- [ ] **Step 3: `dnp_accept.go` — вернуть полный `domain.User`**

Сигнатура и последняя строка:
```go
func dnpAccept(ctx context.Context, wsConn *websocket.Conn, serverPriv []byte, auth Authenticator) (frameCodec, domain.User, int64, error) {
	// ... без изменений до Authenticate ...
	user, deviceID, err := auth.Authenticate(ctx, f.D.Token)
	if err != nil {
		return nil, domain.User{}, 0, err
	}
	_ = wsConn.SetReadDeadline(time.Time{})
	return newDNPCodec(send, recv), user, deviceID, nil
}
```
Обнови ранние `return nil, 0, 0, err` → `return nil, domain.User{}, 0, err`. Импортни `domain`.

- [ ] **Step 4: `conn.go` — интерфейс, поля, newConn, dispatch, rpcRespFrame**

Добавить (импорты: `context`, `net/http` для статуса не обязателен — числа; `domain`; `saferun` уже есть):
```go
// RPCDispatcher реплеит rpc-запрос канала (реализуется в пакете http через RouterRPC).
// Несёт user+deviceID, чтобы ws не зависел от http.
type RPCDispatcher interface {
	Dispatch(ctx context.Context, user domain.User, deviceID int64, method, path string, body []byte) (int, []byte)
}

const rpcMaxConcurrent = 16

type rpcReqData struct {
	ReqID  string          `json:"req_id"`
	Method string          `json:"method"`
	Path   string          `json:"path"`
	Body   json.RawMessage `json:"body"`
}

func rpcRespFrame(reqID string, status int, body []byte) []byte {
	if len(body) == 0 {
		body = []byte("null")
	}
	b, _ := json.Marshal(map[string]any{
		"t": "rpc_resp",
		"d": map[string]any{"req_id": reqID, "status": status, "body": json.RawMessage(body)},
	})
	return b
}
```
`Conn` — добавить поля:
```go
	user   domain.User
	rpc    RPCDispatcher      // nil у plain-conn
	rpcSem chan struct{}      // ограничение конкурентности rpc-диспатча
```
(поле `userID int64` можно оставить и заполнять `user.ID`, чтобы не трогать существующие обращения `c.userID`.)
`newConn` — новая сигнатура (принимает `user domain.User` + `rpc`):
```go
func newConn(ws *websocket.Conn, hub *Hub, svc *usecasechat.Interactor, presence Presence, user domain.User, deviceID int64, codec frameCodec, rpc RPCDispatcher) *Conn {
	return &Conn{
		ws: ws, hub: hub, svc: svc, presence: presence,
		user: user, userID: user.ID, deviceID: deviceID,
		send: make(chan []byte, sendBuffer), codec: codec,
		rpc: rpc, rpcSem: make(chan struct{}, rpcMaxConcurrent),
	}
}
```
`dispatch` — добавить case (импортни `context`):
```go
	case "rpc_req":
		if c.rpc == nil {
			return // plain-conn: RPC не обслуживает
		}
		var d rpcReqData
		if json.Unmarshal(f.D, &d) != nil || d.ReqID == "" {
			return
		}
		// Неблокирующий гейт конкурентности: не стопорим read-pump, сбрасываем нагрузку 503.
		select {
		case c.rpcSem <- struct{}{}:
		default:
			c.Send(rpcRespFrame(d.ReqID, 503, []byte(`{"error":"rpc busy"}`)))
			return
		}
		rpc, user, deviceID := c.rpc, c.user, c.deviceID
		reqID, method, path, body := d.ReqID, d.Method, d.Path, d.Body
		go func() {
			defer func() { <-c.rpcSem }()
			defer saferun.Recover("ws.conn.rpc")
			status, respBody := rpc.Dispatch(context.Background(), user, deviceID, method, path, body)
			c.Send(rpcRespFrame(reqID, status, respBody))
		}()
```

- [ ] **Step 5: `handler.go` — `Handler.rpc` + `SetRPCDispatcher` + обновить оба newConn-вызова**

```go
type Handler struct {
	// ... существующие поля ...
	rpc RPCDispatcher // late-bound (см. SetRPCDispatcher); nil → rpc_req игнорируется
}

// SetRPCDispatcher связывает диспетчер после сборки роутера (разрыв цикла wsHandler↔router).
func (h *Handler) SetRPCDispatcher(d RPCDispatcher) { h.rpc = d }
```
DNP-ветка (использует полный user из dnpAccept + h.rpc):
```go
		codec, user, deviceID, err := dnpAccept(r.Context(), wsConn, h.dnpServerPriv, h.auth)
		if err != nil {
			_ = wsConn.Close()
			return
		}
		conn := newConn(wsConn, h.hub, h.chatSvc, h.presence, user, deviceID, codec, h.rpc)
		conn.run(r.Context())
		return
```
Plain-ветка — передать полный `user` (он уже есть из `h.auth.Authenticate`) и `nil` rpc:
```go
	conn := newConn(wsConn, h.hub, h.chatSvc, h.presence, user, deviceID, plainCodec{}, nil)
```
> Проверь `grep -rn "newConn(" internal/adapter/delivery/ws/` и обнови ВСЕ вызовы (включая тесты) под новую сигнатуру.

- [ ] **Step 6: Тесты зелёные (весь ws) + vet**

Run: `gofmt -w internal/adapter/delivery/ws/ && go vet ./internal/adapter/delivery/ws/... && go test ./internal/adapter/delivery/ws/ -run 'ConnDispatchesRPC|Codec|DNPAccept' -v`
Затем полный ws-пакет (Docker): `go test ./internal/adapter/delivery/ws/...` — plain-integration зелёный (кроме известного флейка `TestWS_RevokeClosesSocket`).

- [ ] **Step 7: Commit**

```bash
git add backend/internal/adapter/delivery/ws/dnp_accept.go backend/internal/adapter/delivery/ws/conn.go backend/internal/adapter/delivery/ws/handler.go backend/internal/adapter/delivery/ws/rpc_test.go
git commit -m "feat(dnp): server handles rpc_req over the channel (async dispatch + semaphore)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Разводка (`server.go`) + интеграционный тест end-to-end

**Files:**
- Modify: `backend/internal/app/server.go`
- Modify: `backend/internal/adapter/delivery/ws/rpc_test.go` (+ интеграция)

**Interfaces:**
- Consumes: `ws.NewHandler`, `NewRouter`, `http.NewRouterRPC`, `(*ws.Handler).SetRPCDispatcher`.

- [ ] **Step 1: Разводка позднего связывания в `server.go`**

Найти, где строится `wsHandler` и `NewRouter(...)`. После сборки роутера связать диспетчер:
```go
	wsHandler = ws.NewHandler(hub, p.AuthUC, p.ChatUC, presenceMgr, p.Cfg.WebAuthnOrigins, p.Cfg.DNPServerPrivKey)
	// ... router := httptransport.NewRouter(..., wsHandler, ...) ...
	// после сборки роутера (разрыв цикла wsHandler↔router):
	if h, ok := wsHandler.(*ws.Handler); ok {
		h.SetRPCDispatcher(httptransport.NewRouterRPC(router))
	}
```
> Проверь фактические имена переменных роутера/алиас пакета http (`httptransport`?) в server.go и подставь. `wsHandler` может быть уже типа `*ws.Handler` — тогда без type-assert.

- [ ] **Step 2: Интеграционный тест end-to-end (flynn/noise initiator → rpc)**

Добавить в `backend/internal/adapter/delivery/ws/rpc_test.go` (Docker-free: mini-роутер через `RouterRPC`, но `RouterRPC` в пакете http → в ws-тесте используем **фейковый** `RPCDispatcher`, а полный роутер-реплей уже покрыт `http/rpc_test.go`). Здесь — сквозной путь **через реальный dnpAccept + канал**:
```go
func TestDNPChannelRPCEndToEnd(t *testing.T) {
	serverPriv := bytes.Repeat([]byte{0x11}, 32)
	cs := dnpSuite()
	serverStatic, _ := cs.GenerateKeypair(fixedReader{serverPriv})

	up := websocket.Upgrader{Subprotocols: []string{"dnp/1"}, CheckOrigin: func(*http.Request) bool { return true }}
	rpc := &fakeRPC{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wsConn, err := up.Upgrade(w, r, nil)
		if err != nil { return }
		codec, user, deviceID, err := dnpAccept(r.Context(), wsConn, serverPriv, fakeAuthWS{token: "good"})
		if err != nil { _ = wsConn.Close(); return }
		c := newConn(wsConn, nil, nil, nil, user, deviceID, codec, rpc)
		go c.writePump(context.Background())
		c.readPump(context.Background())
	}))
	defer srv.Close()

	// initiator: handshake + auth + rpc_req, read rpc_resp
	// (используй dnp.FrameLen/UnframeLen/EncryptFrame/DecryptFrame + flynn/noise как в dnp_accept_test.go)
	// ... хендшейк (msg1/msg2), auth{token:"good"}, затем sealed rpc_req, прочитать sealed rpc_resp ...
	// assert: rpc_resp.status==200, fakeRPC видел user.ID из auth (домен-юзер fakeAuthWS).
}
```
> Реализатору: перенеси initiator-обвязку из `dnp_accept_test.go` (там уже есть хендшейк+auth+transport через `dnp.EncryptFrame`/`DecryptFrame`). `fakeAuthWS` = локальный Authenticator, возвращающий `domain.User{ID:...}` для токена "good" (см. `dnp_accept_test.go`, там он уже есть — переиспользуй, не дублируй имя). После auth пошли `EncryptFrame(iSend, rpc_req_json)`, прочитай `DecryptFrame(iRecv, ...)` → `rpc_resp`. Проверь `req_id`, `status==200`, и что `fakeRPC.gotUser` == id из fakeAuthWS. Это доказывает сквозной путь: канал → dnpAccept → conn.dispatch(rpc_req) → rpc_resp по каналу.

- [ ] **Step 3: Сборка + тесты + vet**

Run: `gofmt -w internal/ && go vet ./... && go build ./... && go test ./internal/adapter/delivery/ws/ ./internal/adapter/delivery/http/ -run 'RPC|DNPChannel|AuthMiddlewareTrusts|RouterRPC' -v`
Expected: всё зелёное; end-to-end rpc через канал проходит.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/app/server.go backend/internal/adapter/delivery/ws/rpc_test.go
git commit -m "feat(dnp): wire RouterRPC into ws handler + end-to-end channel RPC test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Финальная проверка PR-3a

- [ ] `cd backend && gofmt -l internal/` пусто, `go vet ./...`, `go build ./...` — чисто.
- [ ] `go test ./internal/adapter/delivery/http/... ./internal/adapter/delivery/ws/...` — RPC (middleware trust-preset, RouterRPC, conn rpc_req, end-to-end) зелёные; plain-integration зелёный (кроме известного флейка `TestWS_RevokeClosesSocket`).
- [ ] Клиент НЕ трогали (PR-3b). Prod: без `DNP_SERVER_PRIVKEY` DNP-путь неактивен; `rpc_req` приходит только по DNP-каналу.
- [ ] Trust-preset не открывает обход авторизации (внешний HTTP юзера в ctx не подсунет).
- [ ] PR в `main`, ветка `feat/dnp-rpc-l4`.

## Self-review (проверено при написании плана)

- **Покрытие спеки §3:** WithUser+trust-preset (Task 1), RouterRPC (Task 2), ws rpc_req async-диспатч + dnpAccept→User (Task 3), server.go late-bind + e2e (Task 4). Клиент §4 — PR-3b.
- **Слои:** ws НЕ импортирует http — `RPCDispatcher` несёт user+deviceID; инжект ctx в `RouterRPC` (http). Цикл wsHandler↔router разорван поздним связыванием.
- **Плейсхолдеры:** нет — весь код реальный (тест-хелперы `authStub`/`fakeRPC`/`fakeAuthWS` определяются один раз, переиспользуются; интеграционный initiator переносится из `dnp_accept_test.go`, а не дублируется).
- **Согласованность:** `RPCDispatcher.Dispatch(ctx,user,deviceID,method,path,body)` одинаков в ws-интерфейсе (Task 3) и http-реализации (Task 2); `newConn(...user, deviceID, codec, rpc)` (Task 3) ↔ оба вызова в handler.go; `rpc_resp` формат (Task 3 rpcRespFrame) ↔ тест (Task 3) ↔ клиентский парсинг (PR-3b).
- **Async/plain:** rpc в горутине + семафор (не блокирует realtime); plain-conn `rpc==nil` → rpc_req игнор; известное ограничение best-effort Send задокументировано.
