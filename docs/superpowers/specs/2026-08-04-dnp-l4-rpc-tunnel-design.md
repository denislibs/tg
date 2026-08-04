# DNP подпроект #3 — L4 RPC-туннель (REST поверх канала): дизайн

Третий подпроект DNP. L0-канал готов и смёржен (PR #119/#120/#123/#127), стенд-e2e пройден.
Здесь — **L4: REST-запросы менеджеров идут через зашифрованный DNP-канал** вместо нативного HTTP.
Общая спека DNP — [`../../research/2026-08-01-dnp-noise-transport-protocol.md`](../../research/2026-08-01-dnp-noise-transport-protocol.md) §L4.

**Цель:** при DNP-ON пост-логин REST течёт по каналу (`rpc_req`/`rpc_resp`), сервер маршрутизирует
их **тем же chi-роутером** (ноль правок хендлеров), HTTP-статусы несутся явно. Прод (флаг OFF) и
логин/медиа — без изменений.

**Границы (НЕ здесь):** L2-мультиплексор (RPC+realtime в одном канале, payload'ы мелкие → HoL
пренебрежим до файлов; async-диспатч + req_id уже дают конкурентность), L5-медиа
(`putBytes`/`contentUrl`/`mediaUrl` остаются на HTTP).

**Разбиение на 2 PR (решено на brainstorming):**
- **PR-3a — сервер** (Go): роутер-реплей диспетчер + `AuthMiddleware` trust-preset + обработка
  `rpc_req` в DNP-conn. Go-тесты.
- **PR-3b — клиент**: `channelRpc` + роутинг `restClient` + разводка в воркере + stand-e2e.

---

## 1. Ключевые решения

1. **Сервер: in-process роутер-реплей.** `rpc_req{req_id, method, path, body}` → построить
   `http.Request`, инжектить юзера/девайс канала в ctx → прогнать через **тот же роутер**
   (`httptest.ResponseRecorder`) → `rpc_resp{req_id, status, body}`. Переиспользует все ~258 роутов
   + middleware, ноль правок хендлеров, статусы явно (чинит потерю HTTP-статусов через worker-RPC).
2. **`AuthMiddleware` trust-preset:** если юзер уже в ctx → пропустить ре-аутентификацию. Безопасно
   (пред-инжект возможен только in-process; внешний HTTP-запрос юзера в ctx не подсунет — ctx
   строится сервером на каждый запрос). Паттерн уже есть в тестах (`WithValue(ctx, userKey, ...)`).
3. **Async-диспатч:** каждый `rpc_req` в своей горутине — иначе медленный хендлер заблокировал бы
   read-pump и realtime. req_id коррелирует ответы (порядок не важен).
4. **Клиент: туннель только когда канал ГОТОВ.** `restClient` шлёт `rpc_req` в канал лишь при
   активном+готовом DNP-канале; иначе fetch. Это автоматически держит `/auth/*` (логин — до канала)
   и любой пре-канальный REST на HTTP.

## 2. Формат кадров (payload'ы `{t,d}` внутри sealed-конверта)

```
rpc_req  : {t:"rpc_req",  d:{req_id, method, path, body}}   // path включает query; body = JSON|null
rpc_resp : {t:"rpc_resp", d:{req_id, status, body}}         // status = HTTP-код; body = JSON|null
```
Ошибки HTTP несутся кодом в `status` (≥400 → клиент кидает `HttpError(status, body.error)`), паника
хендлера → `Recoverer` → status 500. Отдельный `rpc_err` не нужен. Транспортный сбой (нет ответа) →
таймаут на клиенте.

## 3. Сервер (PR-3a)

### `internal/adapter/delivery/http/middleware.go`
- Экспортировать `WithUser(ctx, user domain.User, deviceID int64) context.Context` (ставит
  `userKey`/`deviceKey`).
- `AuthMiddleware`: в начале — `if _, ok := UserFromContext(ctx); ok { next.ServeHTTP(w, r); return }`
  (юзер уже пред-инжектён доверенным каналом). Иначе — текущая аутентификация по заголовку.

### `internal/adapter/delivery/http/rpc.go` (новый)
- `RouterRPC{router http.Handler}` реализует диспетчер:
  ```go
  func (d *RouterRPC) Dispatch(ctx context.Context, method, path string, body []byte) (int, []byte) {
      req := httptest.NewRequest(method, path, bytes.NewReader(body)).WithContext(ctx)
      req.Header.Set("Content-Type", "application/json")
      rec := httptest.NewRecorder()
      d.router.ServeHTTP(rec, req)
      return rec.Code, rec.Body.Bytes()
  }
  ```
  (ctx уже содержит юзера канала → `AuthMiddleware` пропускает ре-аутентификацию; хендлеры читают
  `UserFromContext` как обычно.)

### `internal/adapter/delivery/ws/` — обработка `rpc_req`
- Интерфейс в ws: `type RPCDispatcher interface { Dispatch(ctx, method, path string, body []byte) (int, []byte) }`.
- `dnpAccept` возвращает **полный `domain.User`** (не только ID) — нужен для инжекта в ctx.
- DNP-`Conn` держит `user domain.User`, `deviceID`, `rpc RPCDispatcher` (у plain-conn `rpc==nil`).
- В `dispatch`: `case "rpc_req"` → **горутина**: `ctx := httpx.WithUser(baseCtx, c.user, c.deviceID)`;
  `status, respBody := c.rpc.Dispatch(ctx, d.method, d.path, d.body)`; `c.Send(rpc_resp{req_id, status, respBody})`.
  Паника гасится (per-dispatch recover уже есть). Ограничить конкурентность per-conn (семафор, напр.
  16) — защита от флуда.

### Разводка (`internal/app/server.go`) — разрыв цикла
Цикл: wsHandler ← dispatcher ← router ← wsHandler. Разрываем поздним связыванием:
```
wsHandler := ws.NewHandler(...)                 // rpc пока nil
router := NewRouter(..., wsHandler, ...)
wsHandler.SetRPCDispatcher(NewRouterRPC(router)) // после сборки роутера
```

### Тесты (PR-3a)
- `rpc.go`: `Dispatch` против **реального** роутера (или мини-роутера с authed-хендлером, читающим
  `UserFromContext`): GET → 200 + тело; несуществующий путь → 404; хендлер-ошибка → её статус.
- `AuthMiddleware` trust-preset: запрос с пред-инжектённым юзером → хендлер видит юзера, ре-аутентификации
  нет; без юзера → обычная аутентификация по заголовку.
- DNP-conn `rpc_req` → `rpc_resp` (fake `RPCDispatcher`): проверить req_id/status/body, async (не
  блокирует), конкурентный лимит.
- Интеграция (по образцу ii-a): flynn/noise initiator по `dnp/1`, auth, затем `rpc_req` sealed →
  `rpc_resp` sealed с ожидаемым статусом/телом.

## 4. Клиент (PR-3b)

### `core/net/dnp/channelRpc.ts` (новый)
- `class ChannelRpc { constructor(transport: Transport); call(method, path, body): Promise<{status, body}> }`.
- Держит `pending: Map<reqId, {resolve, reject, timer}>`; подписан `transport.on('rpc_resp', ...)`.
- `call`: сгенерить `req_id`, `transport.send('rpc_req', {req_id, method, path, body})`, вернуть промис,
  резолвящийся на `rpc_resp` с этим `req_id` (или reject по таймауту, напр. 30с → `HttpError(0,'timeout')`).
- `isReady(): boolean` — прокси `transport.isOpen()` (канал готов = хендшейк+auth завершены).
- На `onClose`/reconnect — reject всех pending (клиент повторит через свои механизмы).

### `core/net/restClient.ts`
- Конструктор принимает опциональный `channelRpc?: { call(...): Promise<{status, body}>; isReady(): boolean }`.
- `request(method, path, body)`: **если `channelRpc?.isReady()`** → `{status, body} = await channelRpc.call(...)`;
  `status` вне 2xx → `throw new HttpError(status, body?.error ?? 'HTTP '+status)`; иначе вернуть `body`.
  Иначе — текущий `fetch`. `putBytes`/`contentUrl`/`mediaUrl` не трогаем (медиа/HTTP).

### Разводка (`core/worker.ts`)
- При DNP-ON: построить `ChannelRpc(transport)`, передать в `RestClient`. При OFF — не передавать
  (fetch). `RestClient`-интерфейс не меняется → менеджеры не трогаем.

### Тесты (PR-3b)
- `channelRpc`: `call` шлёт `rpc_req`, резолвит по `rpc_resp` с тем же req_id; таймаут; reject на close.
- `restClient`: с `channelRpc.isReady()===true` идёт через канал (мок), маппит статус→`HttpError`;
  с `isReady()===false` — fetch (регрессия).
- **Stand-e2e:** на `msgrverify` с DNP-ON — залогиниться, открыть диалоги/отправить — REST-вызовы идут
  как `rpc_req`/`rpc_resp` бинарём в канале (в DevTools нет нативных `/api/*` fetch после логина, кроме
  медиа); auth/логин — по HTTP.

## 5. Обработка ошибок
- HTTP-статус ≥400 → `rpc_resp{status}` → клиент кидает `HttpError` (как сейчас с fetch). Статусы
  теперь явные — чинит потерю кодов через worker-RPC.
- Нет ответа (хендлер завис/канал порвался) → клиентский таймаут `rpc_req` → `HttpError(0,'timeout')`;
  reconnect переустановит канал.
- Паника хендлера → `Recoverer` → 500 в recorder → `rpc_resp{status:500}`.
- Пред-инжект юзера только in-process; внешний HTTP не может подсунуть юзера в ctx.

## 6. Безопасность
Trust-preset в `AuthMiddleware` доверяет **только** пред-инжектённому in-process юзеру (из
аутентифицированного канала). Внешние HTTP-запросы строят ctx с нуля — юзера там нет до
`AuthMiddleware`, ре-аутентификация по заголовку сохраняется. RPC-путь не открывает обход авторизации
хендлеров (те по-прежнему читают `UserFromContext` и проверяют права).
