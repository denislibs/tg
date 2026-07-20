# Секретные чаты (E2E) — дизайн

**Дата:** 2026-07-20
**Статус:** утверждён, готов к плану реализации

## Контекст и мотивация

В приложении реализовано почти всё из Telegram (звонки, опросы, планирование,
черновики, шаред-медиа, реакции, форум-топики, папки, 2FA, passkeys, QR-логин,
push, live-location), но **секретных чатов (E2E) нет**: вся переписка идёт через
сервер (`send_message` по WS → Postgres → рассылка), сервер видит plaintext.

**Важно:** эталона в tweb нет — веб-клиенты Telegram секретные чаты не
поддерживают (secret chats device-local, не облачные). Поэтому протокол
проектируем сами, но соблюдаем **гарантии** настоящего Telegram: сервер не читает
переписку, ключи device-local, верификация по fingerprint, self-destruct.

## Принятые решения (из брейншторма)

1. **Крипта:** WebCrypto **ECDH P-256 → HKDF-SHA256 → AES-256-GCM**. Никакого
   самописного крипто, никакого воспроизведения wire-формата MTProto.
2. **Модель ключей:** **device-local**, как в Telegram. Приватный/симметричный
   ключ живёт только в IndexedDB этого браузера, на сервер не уходит. Вход с
   другого браузера — секретного чата там нет; logout/очистка storage — чат
   потерян навсегда.
3. **Контент:** текст **и** медиа (фото/видео/файлы/голос), всё E2E.
4. **Поведения:** self-destruct таймер сообщений, верификация ключа
   (emoji-fingerprint), запрет пересылки/копирования наружу.
   Скриншот-уведомление **не делаем** (в браузере скриншот надёжно не
   детектируется — любая реализация была бы фиктивной).

## Криптография

### Обмен ключами (per-chat, эфемерный)

На каждый секретный чат — своя эфемерная пара ECDH P-256:

1. Инициатор **A**: `generateKey(ECDH P-256)` → `(privA, pubA)`. Экспорт `pubA`
   (raw/SPKI) → серверу → доставка **B** кадром `secret_chat_request`.
2. Получатель **B**: `generateKey` → `(privB, pubB)`. Считает
   `sharedBits = deriveBits(ECDH, privB, pubA)`. Шлёт `pubB` обратно кадром
   `secret_chat_accept`.
3. Инициатор **A**: получив `pubB`, считает `sharedBits = deriveBits(ECDH, privA, pubB)`
   — секрет идентичен.

Сервер видит только публичные ключи и не может вывести общий секрет.

### Вывод ключа и fingerprint

- `sharedBits` → `HKDF-SHA256` → **non-extractable** `AES-256-GCM` CryptoKey
  (через `importKey`+`deriveKey`).
- Отдельно `SHA-256(sharedBits)` → байты fingerprint. `sharedBits` после этого
  обнуляются/выходят из области видимости.
- fingerprint детерминированно маппится в **emoji-SAS** (сетка эмодзи) для
  визуального сравнения обеими сторонами.

### Хранение ключей

- В **IndexedDB** по `secretChatId`: `{ aesKey: CryptoKey (non-extractable),
  fingerprint: Uint8Array, peerPub, state }`.
- `CryptoKey` structured-clonable → хранится в IndexedDB, оставаясь
  non-extractable. Приватный ECDH-ключ и AES-ключ **никогда** не сериализуются в
  байты и не отправляются на сервер.

## Сообщения

- Payload = `{ text, entities, media?, ... }` → UTF-8 → **AES-GCM** со случайным
  12-байтным IV → блоб `iv || ciphertext`.
- Новый тип сообщения `encrypted`. На бэке — колонка `enc_body bytea`; `text` и
  `entities` пустые. Сервер хранит блоб **непрозрачно**: не индексирует, не
  добавляет в поиск, в push шлёт без превью (текста у сервера нет в принципе).
- Получатель: тянет блоб → расшифровывает ключом из IndexedDB → рендерит
  **только React-нодами** (`RichText`/`CodeBlock`; правило «никакого raw-HTML»
  соблюдается). Плейнтекст живёт только в рантайм-сторе; после перезагрузки
  история перекачивается с сервера (шифртекст) и дешифруется заново.

## Медиа

- На каждый файл — **свой** случайный AES-GCM ключ+IV. Файл шифруется в браузере
  → зашифрованный блоб грузится существующим upload-путём (сервер видит просто
  байты, `content-type: application/octet-stream`, **без** генерации превью).
- Ключ+IV файла кладутся **внутрь E2E-payload сообщения** — то есть сами
  зашифрованы ключом чата (модель Telegram: у каждого медиа свой ключ в
  зашифрованном сообщении).
- Скачивание → дешифровка ключом из payload → показ. Серверных тумбов нет.

**Решение (нет эталона):** серверный thumbnail для секретного медиа отключаем —
сервер не может сгенерировать превью из шифртекста. Превью появляется только
после дешифровки у получателя.

## Модель данных (бэкенд)

- Новый тип чата `secret` в `domain/chat.go` (`private|group|channel|saved|secret`),
  всегда 1-на-1. Чат = строка `chats(type=secret)` + два `chat_members`.
- Таблица `secret_chats` (миграция): `chat_id, initiator_id, responder_id,
  initiator_pub bytea, responder_pub bytea, state (requested|accepted|rejected|discarded),
  created_at`.
- `messages` (миграция): тип `encrypted`, `enc_body bytea`, `ttl_seconds int`,
  `destruct_at timestamptz`. TTL-метаданные не секретны — хранятся открыто.

## Handshake и realtime

- Новые WS-кадры (несут **только** публичные ключи/статус):
  `secret_chat_request`, `secret_chat_accept`, `secret_chat_reject`,
  `secret_chat_discard`. Идут через существующий `{t,d}` →
  **`realtimeBridge`** (единственный канал сокет→стор).
- Стейт-машина: `requested → accepted (established)` | `rejected` | `discarded`.
- **Self-destruct:** при прочтении получателем (существующий `read`-кадр) сервер
  ставит `destruct_at = now + ttl_seconds`; reaper (периодический + удаление по
  доступу) сносит `enc_body` на сервере и рассылает delete-кадр; клиент
  самоуничтожает сообщение локально.

## Фронтенд (по слоям — инварианты архитектуры соблюдены)

- `core/secret/crypto.ts` — WebCrypto-обёртки: генерация пары, вывод ключа,
  enc/dec payload, enc/dec медиа, `fingerprint→emoji SAS`.
- `core/secret/keyStore.ts` — IndexedDB-хранилище ключей.
- `stores/secretChatStore.ts` — состояние handshake по чату (нормализовано по id).
- `core/managers/secretManager.ts` — команды: `createSecretChat(userId)`,
  `acceptSecretChat`, `rejectSecretChat`, `sendEncrypted` (шифрует → отдаёт в
  `connectionManager`), дешифровка входящих. Не знает про React/DOM.
- `realtimeBridge` — обработка handshake-кадров + дешифровка входящих
  `encrypted`-сообщений → кладёт в стор как обычный `Message` с флагом `secret`.
- UI:
  - Пункт «Начать секретный чат» в профиле пользователя.
  - Визуал секретного чата: зелёный акцент + замок (как в Telegram), в шапке 🔒.
  - Экран **верификации ключа** — emoji-fingerprint для сравнения.
  - Пикер self-destruct таймера (переиспользуем стиль `AutoDeleteMessages`).
  - В `useMessageActions` для секретного чата **скрыты** forward/copy/цитата.
  - Состояние «ожидание принятия собеседником».

## Инварианты безопасности

- **Никогда** не рендерить расшифрованный контент как raw-HTML — только React-ноды.
- Приватные/симметричные ключи non-extractable, никогда не уходят на сервер.
- Сервер не индексирует `enc_body`, не кладёт в поиск, push без превью.
- Ссылки в расшифрованном тексте — по существующему allow-list схем.

## Тестирование

- **Backend:** стейт-машина handshake (request→accept→established, reject,
  discard), непрозрачное хранение `enc_body`, TTL-reaper удаляет блоб, push без
  превью для секретного чата.
- **Frontend (vitest, WebCrypto в node):** `derive(A,B) === derive(B,A)`;
  round-trip enc/dec текста; round-trip enc/dec медиа; стабильный fingerprint,
  совпадающий у обеих сторон.
- **E2E на стенде (:38443):** A создаёт секретный чат → B принимает → обмен
  текстом и картинкой → fingerprint совпал у обоих → TTL уничтожил сообщение и на
  клиенте, и на сервере.

## Явно вне скоупа (YAGNI)

- Синхронизация секретного чата между устройствами/браузерами (device-local by design).
- Восстановление ключа после logout/очистки storage.
- Скриншот-уведомления (недетектируемо в браузере).
- Секретные группы (только 1-на-1, как в Telegram).
- Rekeying / forward secrecy по ходу чата (эфемерный per-chat ключ; PFS —
  возможное будущее расширение, не в этой версии).
- Чанковая загрузка больших зашифрованных файлов (наследует текущее ограничение
  проекта — один PUT целиком).
