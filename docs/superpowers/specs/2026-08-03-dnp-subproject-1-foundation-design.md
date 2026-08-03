# DNP — подпроект #1 «Фундамент» (L0 Noise + L1 надёжность): дизайн

Первый подпроект реализации протокола **DNP** (Denis Noise Protocol). Общая спека —
[`../../research/2026-08-01-dnp-noise-transport-protocol.md`](../../research/2026-08-01-dnp-noise-transport-protocol.md)
(далее «спека DNP»); здесь — только то, что делаем сейчас, до уровня, годного для плана реализации.

**Цель подпроекта:** realtime-кадры `{t,d}` идут через зашифрованный Noise-канал (токен внутри
канала), reconnect = новый хендшейк; чат работает как раньше. Всё остальное (RPC, медиа) остаётся на
текущем транспорте — это следующие подпроекты (#3, #4).

**Ключевое решение по выкладке:** делаем **двумя тонкими PR** за выключенным флагом `DNP_ENABLED`
(стратегия «инкрементально в main за флагом» из спеки DNP). Прод по умолчанию не меняется.

---

## 1. Архитектура: шов `Transport`

`connectionManager` (`web-client/src/core/realtime/connectionManager.ts`) зависит от `WsClient`
ровно через 7 методов — это и есть готовая граница абстракции. Выносим интерфейс:

```ts
// web-client/src/core/net/transport.ts
export interface Transport {
  connect(token: string): void
  close(): void
  isOpen(): boolean
  onOpen(cb: () => void): void
  onClose(cb: () => void): void
  onError(cb: () => void): void
  on(type: string, cb: (d: unknown) => void): void
  send(type: string, d?: unknown): void
}
```

- `PlainTransport` = текущий `WsClient` (`core/net/wsClient.ts`), помеченный `implements Transport`.
  Форма уже совпадает — новых методов не добавляем.
- `DnpTransport` (появляется в PR-1b) реализует **тот же** интерфейс, оборачивая `WsClient`:
  внутри — Noise-хендшейк и AEAD-кодек кадров. `connectionManager` про это не знает.
- `connectionManager` перетиповывается с `WsClient` на `Transport` (тело не меняется).
- Выбор реализации — в точке сборки `worker.ts:250` по флагу `AppConfig.dnp.enabled`.

Инвариант архитектуры клиента не нарушается: подписка на сокет по-прежнему только в насосе
`realtimeBridge`; `Transport` — деталь воркера, наружу (в eventBus/сторы) ничего не протекает.

---

## 2. Конфиг и флаг (новый `config/app.ts`)

У проекта нет своего центрального конфига (`config/modes.ts`/`debug.ts` — вендоренный островок
tlottie, `@ts-nocheck`; трогать нельзя). Заводим **свой** модуль:

```ts
// web-client/src/config/app.ts
export const AppConfig = {
  dnp: {
    // build-time дефолт + рантайм-оверрайд для стенда
    enabled:
      import.meta.env.VITE_DNP_ENABLED === '1' ||
      (typeof location !== 'undefined' && location.search.includes('dnp=1')),
    // PINNED PUBLIC keys. Массив ради бесшовной ротации (текущий + следующий).
    // ТОЛЬКО публичные ключи. Приватный ключ — исключительно на бэкенде.
    serverStaticPublicKeys: (import.meta.env.VITE_DNP_SERVER_PUBKEYS ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean),
  },
}
```

- `VITE_DNP_ENABLED` пробрасывается через `vite.config.ts` `define` (как уже сделано для
  `__APP_BUILD__`). Оверрайд `?dnp=1` — для verify-стенда, не трогая билд.
- `serverStaticPublicKeys` — **массив** pinned-ключей (обоснование ротации — в спеке DNP, §3 L0).
  В PR-1a значение может быть пустым (не используется до PR-1b).
- **Инвариант безопасности:** в `VITE_*` кладём только публичное. Приватный статический ключ
  сервера живёт только на бэкенде (env/секрет-менеджер), как `nginx/certs/dev-key.pem`.

---

## 3. PR-1a — шов + флаг (чистый рефактор, сразу в `main`)

Ничего в поведении не меняет, флаг OFF. Содержимое:

1. `core/net/transport.ts` — интерфейс `Transport`.
2. `WsClient implements Transport` (форма уже совпадает; правок логики нет).
3. `connectionManager` — параметр `ws: WsClient` → `ws: Transport`.
4. `config/app.ts` — объект `AppConfig` с флагом и (пустым) массивом ключей.
5. `vite.config.ts` — проброс `VITE_DNP_ENABLED` в `define`.
6. `worker.ts:250` — точка выбора транспорта:
   ```ts
   const transport: Transport = AppConfig.dnp.enabled
     ? makeDnpTransport()   // PR-1b
     : new WsClient('/ws')
   ```
   До PR-1b `makeDnpTransport()` кидает явную ошибку `DNP transport not implemented yet (PR-1b)`.
   Это осознанный guarded-флаг незаконченной фичи (по решению из brainstorming), а не мёртвая
   заглушка: путь достижим только при `DNP_ENABLED=1`, дефолт — OFF.

**Критерий готовности PR-1a:** `npm test` + `npm run typecheck` + `npm run build` зелёные; при
флаге OFF поведение чата идентично текущему (никаких новых кадров, тот же plain-WS).

---

## 4. PR-1b — `DnpTransport` (L0 + L1), за флагом

### 4.1 L0 — Noise secure channel (клиент)

- Новый модуль `core/net/dnp/` (живёт в воркере — крипта там уже штатно, см. секретные чаты).
- **Cipher suite:** `Noise_NK_25519_ChaChaPoly_BLAKE2s` (решение — ниже, §6).
- **Библиотека:** `@stablelib`-примитивы (`x25519`, `chacha20poly1305`, `blake2s`) + своя тонкая
  обёртка паттерна `NK` (решение — ниже, §6).
- **Хендшейк** (2 бинарных кадра): клиент → `e, es`; сервер → `e, ee`. `prologue = "dnp/1"`
  (привязка к версии, анти-downgrade). Статический pubkey сервера берётся из
  `AppConfig.dnp.serverStaticPublicKeys` (пробуем по списку — поддержка ротации).
- Получены две cipher-state; каждый прикладной кадр = `ChaCha20Poly1305.Encrypt` с монотонным
  nonce cipher-state. Приём — `Decrypt`.
- `DnpTransport` оборачивает `WsClient`: `binaryType='arraybuffer'`, хендшейк на `connect()`,
  encode/decode кадров. Наружу отдаёт тот же `Transport` API (`on`/`send` по типам кадров).

### 4.2 L1 — надёжность (клиент)

Большая часть уже есть в `connectionManager` (durable outbox в IndexedDB, resend, дедуп по
`client_msg_id`, exp backoff, ping/pong). DNP добавляет:
- **auth в канале:** первым прикладным кадром после хендшейка — `auth { token }` (сейчас токен
  идёт в WS-subprotocol `bearer`; в DNP он переезжает внутрь канала).
- **reconnect = новый хендшейк:** обрыв WS → новый Noise-хендшейк (новые эфемерные ключи) →
  повторная `auth` → resend неподтверждённого.
- `msg_id`/ack/дедуп на уровне кадра — по мере необходимости для realtime (минимально; полное
  обобщение мультиплексора — подпроект #2, здесь один поток).

### 4.3 Бэкенд — dual-mode

- Новый пакет `backend/internal/adapter/delivery/ws/dnp/` — `flynn/noise` responder, cipher-state,
  кодек кадра.
- `handler.go` — **dual-mode**: сервер продолжает принимать текущий plain-WS (токен в subprotocol
  `bearer`) И новый DNP-режим. Режим определяется на upgrade (напр. по subprotocol/первому кадру).
  Обязательно — иначе стенд с флагом ON отрезает обычных клиентов, а прод (флаг OFF) должен
  работать без изменений.
- В DNP-режиме: после upgrade — Noise-хендшейк, затем первый кадр `auth { token }`, валидация
  `token_hash` (как сейчас в `backend/internal/domain/token.go`), только потом остальные кадры.
- Приватный статический ключ сервера — в конфиге бэкенда (env/секрет), в клиент не попадает.

**Критерий готовности PR-1b (живой, на стенде `msgrverify` с `?dnp=1`):** realtime-кадры идут
через Noise-канал, токен ушёл внутрь канала, reconnect=rehandshake, чат (отправка/приём/typing/
read) работает; при флаге OFF — по-прежнему plain-WS.

---

## 5. Поток данных (после PR-1b, флаг ON)

```
Вниз (команда):  connectionManager.send(t,d)
                 → DnpTransport.send: encode кадр {t,d} → Noise.Encrypt → ws.send(ArrayBuffer)
Вверх (событие): ws.onmessage(ArrayBuffer) → Noise.Decrypt → decode → DnpTransport dispatch
                 → connectionManager.on(t) → realtimeBridge (без изменений) → eventBus → сторы
```

Формат realtime-кадра `{t,d}` не меняется — он просто становится plaintext'ом внутри AEAD-конверта.
`realtimeBridge`, Store-проектор, syncEngine/pts — не трогаются (DNP их транспортирует).

---

## 6. Технические решения (зафиксировано)

1. **Cipher suite: `Noise_NK_25519_ChaChaPoly_BLAKE2s`** (ChaCha20-Poly1305). Не зависит от AES-NI,
   единый набор клиент+сервер (`flynn/noise` умеет ChaChaPoly), WebCrypto всё равно не
   используем.
2. **Библиотека Noise на клиенте: `@stablelib`-примитивы + своя обёртка `NK`.** Против
   `noise-c.wasm`: без WASM-загрузки/инициализации, tree-shake, TS-native, меньше бандл; паттерн
   `NK` — 2 сообщения, обёртка тонкая. Совпадает с прецедентом секретных чатов (сборка из
   примитивов).
3. **Кодирование payload: текущий JSON `{t,d}`.** Нулевая правка семантики realtime-кадров.
   MessagePack/бинарь — позже, для L5.
4. **Разбиение: два PR** (шов+флаг → DnpTransport). Флаг в PR-1a, включённая ветка до PR-1b кидает
   явную ошибку.

---

## 7. Обработка ошибок

- **Хендшейк не удался / pubkey не совпал ни с одним pinned:** `DnpTransport` закрывает WS и идёт
  через обычный reconnect-путь `connectionManager` (тот же `onClose → scheduleReconnect`). На
  стенде это видно как невозможность подключиться при кривом ключе — что и есть защита (pinning).
- **`auth` отклонён сервером:** сервер закрывает канал; клиент — как при протухшем токене сейчас.
- **Флаг ON, но `DnpTransport` ещё не реализован (между PR-1a и PR-1b):** явная ошибка
  `DNP transport not implemented yet (PR-1b)` — только при `DNP_ENABLED=1`, прод (OFF) не задет.
- **Nonce переполнение/рассинхрон:** обрыв → rehandshake (новые cipher-state), как reconnect.

---

## 8. Тестирование

- **PR-1a:** `npm test` + `typecheck` + `build`; ручная проверка — чат работает, флаг OFF, новых
  кадров в сети нет.
- **PR-1b:**
  - Клиент: unit на кодек кадра (encode/decode round-trip) и на хендшейк против известных
    векторов Noise_NK.
  - Бэкенд: Go-тесты responder'а (хендшейк, отказ при неверном токене), тест dual-mode роутинга.
  - E2E на стенде `msgrverify` (`?dnp=1`): установка канала, realtime через Noise, reconnect=
    rehandshake, отправка/приём; параллельно клиент без флага (plain-WS) продолжает работать.

---

## 9. Границы подпроекта (что НЕ делаем здесь)

- L2 мультиплексор — подпроект #2 (в realtime один поток, HoL не актуален).
- L4 RPC-over-channel (REST на канал) — подпроект #3.
- L5 File API + SW-стриминг (медиа на канал) — подпроект #4; до него медиа на нативном HTTP/TLS.
- Ротация ключей как процедура — подпроект #5 (здесь только массив pinned-ключей в конфиге).
- Обфускация/анти-DPI — вне scope (см. спеку DNP §10).
