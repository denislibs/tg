# DNP PR-1a — шов транспорта + флаг (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ввести абстракцию `Transport` и флаг `DNP_ENABLED` (OFF) в клиенте — чистый рефактор без изменения поведения, готовящий почву для `DnpTransport` (PR-1b).

**Architecture:** `connectionManager` зависит от нового интерфейса `Transport` (7 методов, уже совпадающих с `WsClient`). Флаг `AppConfig.dnp.enabled` в фабрике `createTransport()` выбирает `WsClient` (plain, дефолт) либо `makeDnpTransport()` (пока throwing-заглушка). Прод по умолчанию идёт по `WsClient` — поведение 1:1.

**Tech Stack:** TypeScript (strict), Vite 8, Vitest. Файлы — `web-client/src/`.

**Спека:** [`../specs/2026-08-03-dnp-subproject-1-foundation-design.md`](../specs/2026-08-03-dnp-subproject-1-foundation-design.md). Общая спека DNP — [`../../research/2026-08-01-dnp-noise-transport-protocol.md`](../../research/2026-08-01-dnp-noise-transport-protocol.md).

## Global Constraints

- **TypeScript strict, без `any`** — неиспользуемые переменные ломают сборку.
- **Тесты зелёные** перед «готово»: `npm test`, `npm run typecheck`, `npm run build`.
- **Мёртвый код не оставлять** — throwing-заглушка `makeDnpTransport` допустима только как guarded-флаг (путь достижим лишь при `DNP_ENABLED=1`, дефолт OFF).
- **Секреты:** в `VITE_*` — только публичное (флаг, публичные ключи). Приватные ключи в клиент не попадают.
- **Импорты в `core/net`/`core/realtime` — относительные** (соответствие текущему стилю: `wsClient.ts`, `connectionManager.ts`).
- Все команды запускать из `web-client/`.

## Файловая структура PR-1a

- `core/net/transport.ts` (новый) — интерфейс `Transport`, единственная ответственность: контракт транспорта.
- `core/net/wsClient.ts` (правка) — `implements Transport`.
- `core/net/wsClient.test.ts` (правка) — починка предсуществующего красного теста (subprotocol вместо `?token=`).
- `core/realtime/connectionManager.ts` (правка) — тип `ws` c `WsClient` на `Transport`.
- `config/app.ts` (новый) — `AppConfig` + чистый резолвер `readDnpConfig`.
- `config/app.test.ts` (новый) — тесты резолвера.
- `vite-env.d.ts` (правка) — типы `VITE_DNP_*`.
- `core/net/dnp/index.ts` (новый) — `makeDnpTransport()` throwing-заглушка (PR-1b наполнит).
- `core/net/createTransport.ts` (новый) — фабрика выбора транспорта по флагу.
- `core/net/createTransport.test.ts` (новый) — тесты фабрики.
- `core/worker.ts` (правка) — точка сборки: `new WsClient('/ws')` → `createTransport()`.

---

### Task 1: Интерфейс `Transport` + `WsClient implements` + перетиповка `connectionManager` (+ починка красного теста)

**Files:**
- Create: `web-client/src/core/net/transport.ts`
- Modify: `web-client/src/core/net/wsClient.ts:7`
- Modify: `web-client/src/core/net/wsClient.test.ts:5-18,29`
- Modify: `web-client/src/core/realtime/connectionManager.ts:2,10`

**Interfaces:**
- Produces: `interface Transport { connect(token: string): void; close(): void; isOpen(): boolean; onOpen(cb: () => void): void; onClose(cb: () => void): void; onError(cb: () => void): void; on(type: string, cb: (d: unknown) => void): void; send(type: string, d?: unknown): void }` — экспорт из `core/net/transport.ts`.
- Consumes: существующий `WsClient` (форма уже совпадает).

- [ ] **Step 1: Починить предсуществующий красный тест `wsClient.test.ts`**

`FakeWS` игнорирует второй аргумент конструктора (протоколы), а тест ждёт токен в URL — это устарело (токен теперь в subprotocol `['bearer', token]`). Правим `FakeWS` и ассерт:

```ts
// было: constructor(public url: string) { FakeWS.instances.push(this) }
constructor(public url: string, public protocols?: string | string[]) { FakeWS.instances.push(this) }
```

```ts
// было (строка 29): expect(ws.url).toContain('/ws?token=tok')
expect(ws.url).toBe('/ws')
expect(ws.protocols).toEqual(['bearer', 'tok'])
```

- [ ] **Step 2: Запустить тест — убедиться, что теперь зелёный**

Run: `npx vitest run src/core/net/wsClient.test.ts`
Expected: PASS (2 passed) — красный ассерт починен.

- [ ] **Step 3: Создать интерфейс `Transport`**

`web-client/src/core/net/transport.ts`:
```ts
// Узкая граница между connectionManager и конкретным транспортом (plain WS / DNP).
// Форма выведена из фактического использования WsClient в connectionManager.
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

- [ ] **Step 4: Пометить `WsClient` как реализацию `Transport`**

`web-client/src/core/net/wsClient.ts` — добавить импорт типа и `implements`:
```ts
import { decodeFrame, encodeFrame, type Frame } from '../../protocol/frames'
import type { Transport } from './transport'
```
```ts
// было: export class WsClient {
export class WsClient implements Transport {
```
Тело класса не меняется — методы уже соответствуют интерфейсу.

- [ ] **Step 5: Перетиповать `connectionManager` на `Transport`**

`web-client/src/core/realtime/connectionManager.ts`:
```ts
// строка 2 — было: import type { WsClient } from '../net/wsClient'
import type { Transport } from '../net/transport'
```
```ts
// строка 10 (в interface CMDeps) — было: ws: WsClient
ws: Transport
```
Остальное тело `newConnectionManager` не трогать.

- [ ] **Step 6: Тайпчек — убедиться, что шов согласован**

Run: `npm run typecheck`
Expected: без ошибок (форма `WsClient` совпадает с `Transport`; `connectionManager` компилируется на новом типе).

- [ ] **Step 7: Прогнать связанные тесты**

Run: `npx vitest run src/core/net src/core/realtime`
Expected: PASS — поведение не менялось.

- [ ] **Step 8: Commit**

```bash
git add web-client/src/core/net/transport.ts web-client/src/core/net/wsClient.ts web-client/src/core/net/wsClient.test.ts web-client/src/core/realtime/connectionManager.ts
git commit -m "refactor(net): интерфейс Transport, WsClient implements, перетиповка connectionManager

Плюс починка предсуществующего красного wsClient.test (subprotocol
вместо устаревшего ?token=).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Конфиг `config/app.ts` + флаг `DNP_ENABLED`

**Files:**
- Create: `web-client/src/config/app.ts`
- Create: `web-client/src/config/app.test.ts`
- Modify: `web-client/src/vite-env.d.ts`

**Interfaces:**
- Produces: `interface DnpConfig { enabled: boolean; serverStaticPublicKeys: string[] }`; `function readDnpConfig(env: ImportMetaEnv, search: string): DnpConfig`; `const AppConfig: { dnp: DnpConfig }` — экспорт из `config/app.ts`.

- [ ] **Step 1: Написать падающие тесты резолвера**

`web-client/src/config/app.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readDnpConfig } from './app'

const env = (o: Record<string, string | undefined>) => o as unknown as ImportMetaEnv

describe('readDnpConfig', () => {
  it('disabled by default, empty keys', () => {
    const c = readDnpConfig(env({}), '')
    expect(c.enabled).toBe(false)
    expect(c.serverStaticPublicKeys).toEqual([])
  })
  it('enabled via VITE_DNP_ENABLED=1', () => {
    expect(readDnpConfig(env({ VITE_DNP_ENABLED: '1' }), '').enabled).toBe(true)
  })
  it('enabled via ?dnp=1 override', () => {
    expect(readDnpConfig(env({}), '?foo=1&dnp=1').enabled).toBe(true)
  })
  it('parses comma-separated pinned keys, trims, drops empties', () => {
    const c = readDnpConfig(env({ VITE_DNP_SERVER_PUBKEYS: ' a , b ,, c ' }), '')
    expect(c.serverStaticPublicKeys).toEqual(['a', 'b', 'c'])
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/config/app.test.ts`
Expected: FAIL — модуль `./app` / `readDnpConfig` ещё не существует.

- [ ] **Step 3: Добавить типы окружения**

`web-client/src/vite-env.d.ts` — дополнить (interface merging с `vite/client`):
```ts
interface ImportMetaEnv {
  readonly VITE_DNP_ENABLED?: string
  readonly VITE_DNP_SERVER_PUBKEYS?: string
}
```

- [ ] **Step 4: Реализовать `config/app.ts`**

```ts
// Свой центральный конфиг приложения. НЕ путать с config/modes.ts — тот вендоренный
// островок tlottie (@ts-nocheck), трогать нельзя. Здесь — build-time флаги проекта.
export interface DnpConfig {
  enabled: boolean
  // PINNED PUBLIC keys (массив ради бесшовной ротации). ТОЛЬКО публичные —
  // приватный статический ключ сервера живёт исключительно на бэкенде.
  serverStaticPublicKeys: string[]
}

// Чистый резолвер — тестируется без побочек загрузки модуля.
export function readDnpConfig(env: ImportMetaEnv, search: string): DnpConfig {
  return {
    enabled: env.VITE_DNP_ENABLED === '1' || search.includes('dnp=1'),
    serverStaticPublicKeys: (env.VITE_DNP_SERVER_PUBKEYS ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean),
  }
}

export const AppConfig = {
  dnp: readDnpConfig(
    import.meta.env,
    typeof location !== 'undefined' ? location.search : '',
  ),
}
```

- [ ] **Step 5: Запустить тесты — убедиться, что зелёные**

Run: `npx vitest run src/config/app.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 6: Тайпчек**

Run: `npm run typecheck`
Expected: без ошибок.

- [ ] **Step 7: Commit**

```bash
git add web-client/src/config/app.ts web-client/src/config/app.test.ts web-client/src/vite-env.d.ts
git commit -m "feat(config): свой config/app.ts с флагом DNP_ENABLED (OFF по умолчанию)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Фабрика `createTransport` + DNP-заглушка + разводка в `worker.ts`

**Files:**
- Create: `web-client/src/core/net/dnp/index.ts`
- Create: `web-client/src/core/net/createTransport.ts`
- Create: `web-client/src/core/net/createTransport.test.ts`
- Modify: `web-client/src/core/worker.ts:5,250`

**Interfaces:**
- Consumes: `Transport` (Task 1), `AppConfig` (Task 2), `WsClient` (существующий).
- Produces: `function makeDnpTransport(): Transport` (заглушка, throws до PR-1b); `function createTransport(): Transport`.

- [ ] **Step 1: Написать падающие тесты фабрики**

`web-client/src/core/net/createTransport.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Управляемый мок конфига: флаг флипаем в тестах.
const { state } = vi.hoisted(() => ({ state: { enabled: false, serverStaticPublicKeys: [] as string[] } }))
vi.mock('../../config/app', () => ({ AppConfig: { dnp: state } }))

import { createTransport } from './createTransport'
import { WsClient } from './wsClient'

describe('createTransport', () => {
  beforeEach(() => { state.enabled = false })

  it('returns PlainTransport (WsClient) when DNP disabled', () => {
    expect(createTransport()).toBeInstanceOf(WsClient)
  })

  it('throws via DNP stub when enabled (guarded flag)', () => {
    state.enabled = true
    expect(() => createTransport()).toThrow('not implemented yet (PR-1b)')
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/core/net/createTransport.test.ts`
Expected: FAIL — `./createTransport` / `./dnp` ещё не существуют.

- [ ] **Step 3: Создать DNP-заглушку**

`web-client/src/core/net/dnp/index.ts`:
```ts
import type { Transport } from '../transport'

// PR-1b наполнит: Noise_NK-хендшейк + AEAD-кодек кадров (см. спеку подпроекта #1, §4).
// До тех пор DNP-путь — guarded-флаг: достижим только при AppConfig.dnp.enabled (дефолт OFF),
// поэтому прод не задет.
export function makeDnpTransport(): Transport {
  throw new Error('DNP transport not implemented yet (PR-1b)')
}
```

- [ ] **Step 4: Создать фабрику**

`web-client/src/core/net/createTransport.ts`:
```ts
import type { Transport } from './transport'
import { WsClient } from './wsClient'
import { makeDnpTransport } from './dnp'
import { AppConfig } from '../../config/app'

// Точка выбора транспорта по флагу. Дефолт (OFF) → plain WS, поведение 1:1 с текущим.
export function createTransport(): Transport {
  return AppConfig.dnp.enabled ? makeDnpTransport() : new WsClient('/ws')
}
```

- [ ] **Step 5: Запустить тесты фабрики — зелёные**

Run: `npx vitest run src/core/net/createTransport.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 6: Развести в `worker.ts`**

`web-client/src/core/worker.ts`:
```ts
// строка 5 — было: import { WsClient } from './net/wsClient'
import { createTransport } from './net/createTransport'
```
```ts
// строка 250 — было: const ws = new WsClient('/ws')
const ws = createTransport()
```
(Если `WsClient` больше нигде в `worker.ts` не используется — удалить старый импорт полностью; если используется — оставить оба импорта. Проверить `grep -n "WsClient" src/core/worker.ts` перед правкой.)

- [ ] **Step 7: Полный прогон — тесты, тайпчек, сборка**

Run: `npm test && npm run typecheck && npm run build`
Expected: всё зелёное. Флаг OFF → `worker.ts` собирает `WsClient`; поведение чата не изменилось.

- [ ] **Step 8: Commit**

```bash
git add web-client/src/core/net/dnp/index.ts web-client/src/core/net/createTransport.ts web-client/src/core/net/createTransport.test.ts web-client/src/core/worker.ts
git commit -m "feat(net): createTransport — выбор транспорта по флагу DNP_ENABLED

DNP-путь — throwing-заглушка (guarded-флаг) до PR-1b; дефолт OFF → plain WsClient.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Финальная проверка PR-1a

- [ ] `npm test` — зелёный (включая починенный `wsClient.test`, новые `app.test`, `createTransport.test`).
- [ ] `npm run typecheck` — без ошибок.
- [ ] `npm run build` — успешно.
- [ ] Ручная проверка (флаг OFF): чат работает как раньше, в сети — тот же plain-WS, новых кадров нет.
- [ ] PR в `main`, ветка `feat/dnp-transport`.

---

## Self-review (проверено при написании плана)

- **Покрытие спеки §3 (PR-1a):** интерфейс `Transport` (Task 1), `config/app.ts`+флаг (Task 2), фабрика+заглушка+разводка в `worker.ts` (Task 3) — все пункты §3 закрыты. §4 (PR-1b) сознательно вне этого плана.
- **Плейсхолдеры:** нет — во всех шагах реальный код и точные команды.
- **Согласованность типов:** `Transport` (8 методов) одинаков в `transport.ts`, `implements` у `WsClient`, параметре `CMDeps.ws`, возврате `makeDnpTransport`/`createTransport`. `DnpConfig`/`readDnpConfig`/`AppConfig.dnp` согласованы между Task 2 и Task 3 (мок в тесте повторяет форму `dnp`).
- **Побочно:** Task 1 чинит предсуществующий красный `wsClient.test` (регрессия из мёржа subprotocol-аутентификации) — иначе PR-1a внёс бы красноту в main.
