# DNP PR-1b-ii — L0-канал: транспорт (codec + DnpTransport + dual-mode) — дизайн

Вторая часть PR-1b. Крипто-ядро (PR-1b-i) **смёржено** (PR #120): `NKInitiator` на клиенте,
`flynn/noise` responder на бэке, Go↔JS interop доказан. Здесь — **обвязка канала**: length-framed
codec, клиентский `DnpTransport`, серверный dual-mode, тулинг ключей, e2e. Спека PR-1b —
[`2026-08-03-dnp-pr1b-noise-channel-design.md`](2026-08-03-dnp-pr1b-noise-channel-design.md).

**Цель:** realtime-кадры `{t,d}` идут через зашифрованный Noise-канал; токен — первым кадром внутри
канала; reconnect = новый хендшейк; бэкенд принимает и plain-WS, и DNP. Прод по умолчанию (флаг OFF)
не меняется.

**Разбиение на 2 PR (решено на brainstorming):**
- **PR-1b-ii-a — бэкенд dual-mode** (только Go): `codec.go`, `frameCodec`-шов в `conn.go`, ветка
  `dnp/1` в `handler.go`, тулинг ключей, `DNP_SERVER_PRIVKEY`. Доказан Go-интеграционным тестом
  (`flynn/noise` initiator → хендлер). Клиент не трогаем (флаг OFF, заглушка кидает).
- **PR-1b-ii-b — клиент + e2e**: `codec.ts`, `DnpTransport`, разводка в `worker.ts`, stand e2e с
  флагом ON.

---

## 1. Ключевые находки по интеграции

- **`conn.go` — транспортно-нейтральный шов.** `readPump`: WS-сообщение → `dispatch(Frame)`;
  `writePump`: `send []byte` → `WriteMessage`. Вся логика (`dispatch`, hub, fan-out, WS-ping) не
  зависит от того, зашифрован ли payload. DNP вклинивается ТОЛЬКО в чтение/запись байтов кадра.
- **WS-control-кадры (ping/pong/close) DNP не оборачивает** — Noise шифрует только payload
  сообщений; `writePump`-ticker WS-ping продолжает работать под DNP без изменений.
- **`handler.go` — точка ветвления.** Plain: auth ДО upgrade (токен из subprotocol). DNP: upgrade
  первым, затем хендшейк по сокету, затем auth-кадр внутри канала.

## 2. Формат кадра L0 (length-framed AEAD-конверт)

```
DNP wire message (бинарный WS-фрейм):
  ┌──────────────┬───────────────────────────┐
  │ len u32 (BE) │ payload                   │
  └──────────────┴───────────────────────────┘
Хендшейк: payload = сырое Noise-сообщение (msg1 клиент→сервер, msg2 сервер→клиент).
После Split: payload = CipherState.seal(UTF8(JSON {t,d})), AD = "".
```

Над WS префикс длины избыточен (границы даёт сам WS), но кладётся ради носитель-агностичности
(спека DNP §4/§10.8) и **обе стороны применяют его единообразно** ко всем сообщениям после upgrade.

## 3. Хендшейк + auth поверх WS

```
клиент → WS open, Sec-WebSocket-Protocol: dnp/1, binaryType=arraybuffer
клиент → [len][msg1]   (NKInitiator.writeMessage1)
сервер → [len][msg2]   (Responder: ReadMessage1 → WriteMessage2)   → cipher-state обеих сторон
клиент → [len][seal(auth{token})]                                   первый прикладной кадр
сервер → open(auth) → Authenticate(token) ok → newConn(dnpCodec).run()  ; иначе close
далее  → каждый {t,d} = [len][seal(JSON)] ; обрыв WS → новый хендшейк
```

`auth`-кадр — обычный `{t:"auth", d:{token}}`. Токен уходит из subprotocol в канал.

## 4. Бэкенд (PR-1b-ii-a)

### `internal/adapter/delivery/ws/dnp/codec.go`
- `Seal(cs *noise.CipherState, plaintext []byte) []byte` → `[u32 len][cs.Encrypt(nil,nil,pt)]`.
- `Open(cs *noise.CipherState, r io.Reader/[]byte) ([]byte, error)` → снять длину, `cs.Decrypt`.
- Хелперы чтения/записи length-framed сообщения из/в `*websocket.Conn` (binary).

### `internal/adapter/delivery/ws/conn.go` — шов `frameCodec`
- Ввести интерфейс:
  ```go
  type frameCodec interface {
      decode(raw []byte) ([]byte, error) // WS-байты → plaintext JSON-кадр
      encode(frame []byte) (int, []byte)  // JSON-кадр → (websocket msgType, WS-байты)
  }
  ```
- `plainCodec`: `decode` = identity; `encode` = `(TextMessage, frame)`. Поведение 1:1 с текущим.
- `dnpCodec{send, recv *noise.CipherState}`: `decode` = length-deframe + `recv.Decrypt`; `encode`
  = `send.Encrypt` + length-frame, `(BinaryMessage, out)`.
- `Conn` получает поле `codec frameCodec`. `readPump`: `c.codec.decode(raw)` перед JSON-unmarshal.
  `writePump`: `mt, out := c.codec.encode(frame)` перед `WriteMessage`. `dispatch`/hub/ping/send —
  без изменений. WS read-deadline/pong/limit остаются на `c.ws` (общие).
- Гонок нет: `send` cipher-state использует только `writePump`, `recv` — только `readPump`.

### `internal/adapter/delivery/ws/handler.go` — dual-mode
- В `ServeHTTP`: если `websocket.Subprotocols(r)` содержит `dnp/1` → DNP-путь:
  upgrade (эхнуть `dnp/1`) → `dnp.Responder`: прочитать `[len][msg1]`, отправить `[len][msg2]` →
  прочитать `[len][seal(auth)]`, `Open` → `auth{token}` → `Authenticate(token)` → `newConn` c
  `dnpCodec{send,recv}` → `run`. Ошибка/невалидный токен → close.
  Иначе — текущий `bearer`-путь без изменений. Апгрейдер добавляет `dnp/1` в `Subprotocols`.
- Хендшейк-фаза читает/пишет сокет напрямую (до старта pump'ов); дедлайны на время хендшейка.

### Конфиг и ключи
- `DNP_SERVER_PRIVKEY` (env/секрет, 32 байта hex/base64) → в DI (`app/providers.go`, `server.go`),
  прокинуть в `NewHandler`/responder-фабрику. Приватный ключ **только на сервере**.
- `cmd/dnpkeygen` — генерит Curve25519-пару (`flynn/noise` `DH25519.GenerateKeypair(rand.Reader)`),
  печатает приватный (для env) и публичный (для `VITE_DNP_SERVER_PUBKEYS`). Для dev/стенда.

### Тест (PR-1b-ii-a, доказательство)
Go-интеграционный: поднять `httptest` с DNP-хендлером; `flynn/noise` NK **initiator** (с фикс-
статиком сервера, тем же, что у responder) подключается по `dnp/1`, гоняет хендшейк, шлёт
`[len][seal(auth{валидный тестовый токен})]`, затем `[len][seal(ping)]`, получает `[len][seal(pong)]`
или `hello`; plain-путь тем же хендлером не задет (bearer-тест зелёный). Auth с неверным токеном →
соединение закрыто.

## 5. Клиент (PR-1b-ii-b)

### `core/net/dnp/codec.ts`
- `frameLen`-конверт: `encodeMessage(payload: Uint8Array): Uint8Array` (`u32 BE len ‖ payload`),
  `decodeMessage`. `seal(cs, jsonBytes)` / `open(cs, wireBytes)` через `CipherState`.

### `core/net/dnp/dnpTransport.ts` — `implements Transport`
- State-machine: `idle → handshaking → ready → closed`. `connect(token)`: открыть сырой WS
  (`new WebSocket('/ws', ['dnp/1'])`, `binaryType='arraybuffer'`); on WS-open → `NKInitiator` (pubkey
  из `AppConfig.dnp.serverStaticPublicKeys`) → отправить `[len][msg1]`. on WS-message: если
  `handshaking` → `readMessage2`, `split`, отправить `[len][seal(auth{token})]`, перейти в `ready`,
  **фаернуть `onOpen`-колбэки**; если `ready` → `open`+decode → диспатч слушателям по `t`.
- `send(t,d)`: `seal(encodeFrame{t,d})` → `ws.send`. `on/onOpen/onClose/onError/isOpen/close` — как в
  `WsClient`, тот же контракт `Transport`. `onClose`/`onError` пробрасываются → `connectionManager`
  решедулит reconnect → новый `connect` → новый хендшейк.
- Готовность (`onOpen`) = хендшейк завершён и auth отправлен. Неверный токен → сервер закрывает →
  onClose (как протухший токен в plain).

### `core/net/dnp/index.ts` + `config`
- `makeDnpTransport()` → `new DnpTransport('/ws', AppConfig.dnp.serverStaticPublicKeys)` (снять
  throwing-заглушку).
- `config/app.ts`: убрать `?dnp=1`-оверрайд, `enabled = env.VITE_DNP_ENABLED === '1'` (отложенный
  minor PR-1a).

### Тест (PR-1b-ii-b)
- Unit `codec.ts` round-trip. Unit `DnpTransport` state-machine на фейковом WS: скормить фикстурные
  `msg2`/кадры, проверить переход в ready, отправку auth, декод входящих, `onOpen`.
- **E2E на стенде** `msgrverify`: билд фронта `VITE_DNP_ENABLED=1` + `VITE_DNP_SERVER_PUBKEYS`;
  бэк с `DNP_SERVER_PRIVKEY` (пара из `dnpkeygen`). Чат (отправка/приём/typing/read) работает через
  Noise-канал; reconnect=rehandshake; параллельно plain-клиент (флаг OFF) жив.

## 6. Переносы из PR-1b-i (вписываются попутно)
- `symmetricState`/`CipherState`: MAX_NONCE-гард (сигналить до переполнения).
- `NKInitiator`: defensive-copy `remoteStatic`; length-guard в `readMessage2` (ожидать 48 байт).
- Interop: добавить `transportFromResp` в фикстуру + recv-direction assert (закрыть непокрытое
  направление). — Уместно в PR-1b-ii-a (рядом с бэкендом/фикстурой) или -b.

## 7. Обработка ошибок
- Хендшейк не сошёлся / pubkey не подошёл → close → reconnect (тот же путь).
- `auth` отклонён → сервер закрывает канал.
- wasm/крипта/канал не поднялись при флаге ON → громкая ошибка, **без** молчаливого фолбэка на plain.
- Битый кадр/сбой decrypt → close → rehandshake.

## 8. Границы (НЕ здесь)
Полная L1 (ack/dedup на каждый кадр), L2 мультиплексор, L4 RPC, L5 медиа, обфускация — позже.

## 9. Безопасность
Приватный статик сервера — только в env бэка (`DNP_SERVER_PRIVKEY`), никогда в клиент/репозиторий
(как `nginx/certs/dev-key.pem`). В `VITE_*` — только публичные ключи. nginx не трогаем.
