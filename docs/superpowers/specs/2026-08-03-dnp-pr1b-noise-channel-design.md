# DNP PR-1b — L0 Noise secure channel: дизайн

Вторая часть подпроекта #1 «Фундамент». Спека части 1a (шов+флаг, **смёржена**) —
[`2026-08-03-dnp-subproject-1-foundation-design.md`](2026-08-03-dnp-subproject-1-foundation-design.md);
общая спека DNP — [`../../research/2026-08-01-dnp-noise-transport-protocol.md`](../../research/2026-08-01-dnp-noise-transport-protocol.md).

**Цель:** реальный `DnpTransport` — зашифрованный Noise-канал поверх WSS. Realtime-кадры `{t,d}`
идут через канал, токен уходит в первый кадр внутри канала, reconnect = новый хендшейк. Бэкенд
принимает и plain-WS, и DNP (dual-mode). Прод по умолчанию (флаг OFF) не меняется.

**Границы (НЕ здесь):** полная L1 (msg_id/ack/dedup на каждый кадр — realtime в ней не нуждается,
целостность даёт TLS+Noise-nonce, у `send_message` ack уже есть), L2, L4, L5/медиа. Обфускация.

---

## 1. Зафиксированные решения

1. **Объём: только L0-канал** (без обобщения L1 на все кадры).
2. **Клиентская крипта: хандрол `Noise_NK` на `@noble`** — `@noble/curves` (x25519),
   `@noble/ciphers` (chacha20poly1305), `@noble/hashes` (blake2s + hmac). Актуальные, проаудированные,
   чистый ESM, без WASM. (Переопределяет прежний выбор `@stablelib`/`noise-c.wasm`: `noise-c.wasm`
   заархивирован в 2023, `@stablelib` обновляется реже `@noble`.)
3. **Серверная крипта: `github.com/flynn/noise`** — `NewCipherSuite(DH25519, CipherChaChaPoly, HashBLAKE2s)`,
   `HandshakeNK` (проверено — всё экспортируется).
4. **Cipher suite: `Noise_NK_25519_ChaChaPoly_BLAKE2s`**, `prologue = "dnp/1"`.
5. **dual-mode: по WS-subprotocol `dnp/1`.** Plain-клиент шлёт `['bearer', token]` (без изменений).
6. **Флаг: только build-time `VITE_DNP_ENABLED`.** Убираем `?dnp=1`-оверрайд (в воркере не работает —
   `location.search` там = URL бандла воркера; чинит оба отложенных minor из PR-1a разом).

---

## 2. Параметры Noise (критично для interop — обе стороны обязаны совпасть байт-в-байт)

Хандрол клиента ДОЛЖЕН точно повторить [Noise spec rev 34](https://noiseprotocol.org/noise.html)
для `Noise_NK`. `flynn/noise` делает это внутри; наш клиент — руками. Критичные параметры:

- **Имя протокола (ASCII):** `Noise_NK_25519_ChaChaPoly_BLAKE2s` (33 байта > HASHLEN 32 →
  начальный `h = BLAKE2s(name)`).
- **Prologue:** ASCII `dnp/1`, `MixHash(prologue)` сразу после инициализации `h`/`ck`.
- **Pre-message NK:** статик сервера известен клиенту заранее. Инициатор: `MixHash(rs_pub)`;
  ответчик: `MixHash(s_pub)` — до первого сообщения.
- **Паттерн:** `-> e, es` (msg1); `<- e, ee` (msg2). Payload'ы пустые.
- **HKDF:** на HMAC-BLAKE2s, вариант Noise (temp_key = HMAC(ck, ikm); out1 = HMAC(temp_key, 0x01);
  out2 = HMAC(temp_key, out1‖0x02)). `MixKey` берёт 2 выхода.
- **AEAD nonce:** ChaCha20-Poly1305, 12 байт = 4 нулевых ‖ 8-байтный **little-endian** счётчик `n`.
  На каждый Encrypt/Decrypt `n++`, обнуляется в `Split`.
- **AD:** во время хендшейка `EncryptAndHash`/`DecryptAndHash` используют `AD = h`. **Транспортные**
  кадры после `Split` — `AD = ""` (пустой).
- **Split:** `(k1, k2) = HKDF(ck, "", 2)`. Инициатор шлёт `k1`, принимает `k2`; ответчик наоборот.

**Мандат:** корректность подтверждается (а) официальными **Noise NK-тест-векторами**
(snapshot из cacophony/noise-c), (б) **ранним Go↔JS interop-тестом** (см. §7). Без обоих — не
мёржить.

---

## 3. Формат кадра L0 (length-framed AEAD-конверт)

Над WS каждое сообщение — уже отдельный бинарный фрейм, но кладём **свой префикс длины** ради
носитель-агностичности (спека DNP §4/§10.8):

```
L0 wire message (бинарный WS-фрейм):
  ┌──────────────┬───────────────────────────┐
  │ len u32 (BE) │ ciphertext (Noise-encrypt)│   len = длина ciphertext
  └──────────────┴───────────────────────────┘
Хендшейк: ciphertext = сырое Noise-сообщение (msg1/msg2).
После Split: ciphertext = ChaChaPoly.Encrypt(k, n++, ad="", plaintext=UTF8(JSON {t,d})).
```

Payload прикладного кадра в PR-1b — существующая JSON-строка `{t,d}` (L3 не меняется). Никаких
kind/stream/msg_id полей: L2/L1-обобщение отложены, в канале один логический поток.

---

## 4. Компоненты

### Клиент — `web-client/src/core/net/dnp/`
- `noise/hkdf.ts`, `noise/symmetricState.ts`, `noise/handshakeState.ts` — хандрол Noise_NK на
  `@noble`. `handshakeState` умеет только роль **initiator** (клиент): `writeMessage1()`,
  `readMessage2()`, `split()`.
- `noise/vectors.test.ts` — прогон официальных NK-векторов.
- `codec.ts` — length-framed конверт `encode(Uint8Array)`/`decode`, + `sealFrame`/`openFrame`
  через cipher-state после Split. Юнит: round-trip.
- `dnpTransport.ts` — `implements Transport`. `connect(token)`: открыть WS с subprotocol `dnp/1`,
  `binaryType='arraybuffer'`; прогнать хендшейк; послать `auth{token}` первым кадром; на
  `onmessage` — `openFrame` → `decodeFrame` → диспатч по `t`; `send(t,d)` → `encodeFrame` →
  `sealFrame` → `ws.send`. `close()`, `isOpen()`, `onOpen/onClose/onError` — как в `WsClient`.
  Pinned-pubkey сервера — из `AppConfig.dnp.serverStaticPublicKeys` (пробуем по списку → ротация).
- `index.ts` — `makeDnpTransport()` возвращает `new DnpTransport('/ws', AppConfig.dnp...)`
  (заменяет throwing-заглушку PR-1a).

### Клиент — правки вне `dnp/`
- `config/app.ts` — убрать `?dnp=1`-оверрайд: `enabled = env.VITE_DNP_ENABLED === '1'` (без query;
  снимает оба minor). Тест обновить.
- `createTransport.ts` — включённая ветка возвращает реальный `makeDnpTransport()` (уже так; меняется
  только тело заглушки).

### Бэкенд — `backend/internal/adapter/delivery/ws/dnp/`
- `noise.go` — `flynn/noise` NK-responder: статик-ключ из конфига, `ReadMessage`(msg1) →
  `WriteMessage`(msg2) → две cipher-state.
- `codec.go` — тот же length-framed конверт (u32 BE + ciphertext), seal/open.
- read/write pump оборачивают open/seal; первый кадр канала = `auth{token}` → существующий
  `Authenticate(ctx, token)` → дальше обычная маршрутизация кадров (как в текущем `conn.go`).

### Бэкенд — dual-mode
- `handler.go` — на upgrade: если `websocket.Subprotocols(r)` содержит `dnp/1` → эхнуть `dnp/1`,
  пойти по Noise-пути (токен НЕ из subprotocol, а из auth-кадра). Иначе — текущий `bearer`-путь
  1:1. Апгрейдер добавляет `dnp/1` в список `Subprotocols`.
- Конфиг: `DNP_SERVER_PRIVKEY` (приватный статик, только на сервере). Публичный — в билд фронта.
  nginx не трогаем.

### Тулинг ключей
- Маленькая утилита (Go `cmd/` или скрипт) — генерит Curve25519-пару, печатает приватный (для env
  бэка) и публичный (для `VITE_DNP_SERVER_PUBKEYS`). Для dev/стенда.

---

## 5. Хендшейк + auth (последовательность)

```
клиент → WS open, Sec-WebSocket-Protocol: dnp/1
клиент → [len][msg1]  (e, es)
сервер → [len][msg2]  (e, ee)          → обе стороны: send/recv cipher-state
клиент → [len][seal(auth{token})]      первый прикладной кадр
сервер → Authenticate(token) ok → принимает кадры; иначе close
далее  → каждый {t,d} = [len][seal(JSON)] ; обрыв WS → новый хендшейк (новые эфемерные ключи)
```

## 6. Обработка ошибок

- Хендшейк не сошёлся / pubkey не подошёл ни к одному pinned → `close()` → `connectionManager`
  сам решедулит reconnect (тот же путь, что сейчас).
- `auth` отклонён → сервер закрывает канал (как протухший токен).
- Флаг ON, но крипта/канал не поднялись → громкая ошибка, **без** молчаливого фолбэка на plain
  (иначе теряется весь смысл). Консистентно с guarded-флагом PR-1a.
- Рассинхрон nonce/расшифровка не прошла → close → rehandshake.

## 7. Тестирование

- **Клиент unit:** codec round-trip; symmetric-state/handshake против **официальных NK-векторов**;
  `sealFrame`/`openFrame` round-trip.
- **Бэкенд unit:** responder (успех + отказ при неверном auth); dual-mode-маршрутизация (subprotocol
  `dnp/1` → Noise, иначе bearer).
- **Interop (главный):** Go↔JS хендшейк — клиентский `handshakeState` против `flynn/noise` responder,
  сверка cipher-state (первое зашифрованное сообщение расшифровывается другой стороной). Гонять
  **рано**, до `dnpTransport`/бэк-интеграции.
- **E2E на стенде `msgrverify`** (`VITE_DNP_ENABLED=1`, `DNP_SERVER_PRIVKEY` задан): канал встаёт,
  realtime идёт шифром, reconnect=rehandshake, чат (отправка/приём/typing/read) работает;
  параллельно plain-клиент (флаг OFF) жив.

## 8. Проверить на реализации (риски)

- **wasm нет — риск снят.** Но `@noble`-хандрол symmetric-state крипто-критичен: NK-вектора +
  interop-тест обязательны до интеграции.
- **`flynn/noise` API** (`ReadMessage`/`WriteMessage`/`Split`, порядок для responder) — свериться на
  первом же responder-юните.
- **Порядок cipher-state в Split** (кто k1/k2) — единственный частый источник рассинхрона; ловится
  interop-тестом.

## 9. Возможное разбиение на PR (решить в плане)

Кандидат: (1b-i) Noise-ядро на @noble + вектора + Go-responder + **interop-тест** (без транспорта);
(1b-ii) `codec` + `dnpTransport` + бэк dual-mode + e2e. Первый шаг снимает главный риск (крипта/
interop) изолированно. Финализируется на этапе плана.
