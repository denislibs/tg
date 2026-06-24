# Frontend Slice 2 — Auth (F2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox (`- [ ]`) steps.

**Goal:** Real phone+OTP login against the backend. A worker `AuthManager` (`requestCode`, `signIn`, `me`, `logout`) holds the session token in the worker and persists it in IndexedDB (so it survives reload); the existing `AuthFlow` UI is wired to `/api/auth/*`; the app gates on `/api/me` instead of the mock `localStorage` flag.

**Architecture:** Slice 2 of the frontend wiring (design `docs/superpowers/specs/2026-06-23-frontend-architecture-design.md`; contract `docs/contracts.md`). Builds on FE-1 (Core Worker + RPC + RestClient). The backend has **no 2FA/password step** (sign_in returns a token right after the code), so the AuthFlow `password` step is dropped and the QR step is left inert (no backend QR yet). Token lives in the worker; `RestClient.getToken` reads it; `AuthManager` persists it to IndexedDB via a small `TokenStore`. `data.ts` chat mocks are still used (real chats are the next slice).

**Tech Stack:** Vite/React/TS, zustand, vitest. Worker uses IndexedDB.

> Paths relative to `telegram-ui-clone/`. Commit in that repo.

---

## File Structure
```
telegram-ui-clone/src/
  core/store/idbKv.ts          — tiny IndexedDB key/value (get/set/del)
  core/auth/tokenStore.ts      — TokenStore interface + idb-backed impl + in-memory token holder
  core/managers/authManager.ts — requestCode/signIn/me/logout (uses RestClient + TokenStore)
  core/managers/authManager.test.ts
  core/worker.ts               — MODIFY: load token from idb, register authManager, restClient reads token
  client/bootstrap.ts          — MODIFY: Managers type gains `auth`
  components/auth/AuthFlow.tsx  — MODIFY: phone->requestCode, code->signIn, drop password, error UI
  App.tsx                       — MODIFY: gate on auth.me(); onComplete/logout via managers
```

---

### Task 1: IndexedDB kv + token store

**Files:** Create `src/core/store/idbKv.ts`, `src/core/auth/tokenStore.ts`.

- [ ] **Step 1: idb kv**

`src/core/store/idbKv.ts`:
```ts
// Minimal IndexedDB key/value store (one object store). Usable in a Worker.
const DB = 'msgr'
const STORE = 'kv'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE))
    r.onsuccess = () => resolve(r.result as T)
    r.onerror = () => reject(r.error)
  })
}

export const idbGet = <T>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key))
export const idbSet = (key: string, val: unknown) => tx<void>('readwrite', (s) => s.put(val, key))
export const idbDel = (key: string) => tx<void>('readwrite', (s) => s.delete(key))
```

- [ ] **Step 2: token store**

`src/core/auth/tokenStore.ts`:
```ts
import { idbGet, idbSet, idbDel } from '../store/idbKv'

const KEY = 'session_token'

// Holds the session token in memory (for synchronous RestClient reads) and
// persists it to IndexedDB so it survives reload.
export class TokenStore {
  private token: string | null = null

  /** Load the persisted token into memory (call once at worker start). */
  async load(): Promise<void> {
    this.token = (await idbGet<string>(KEY)) ?? null
  }

  get(): string | null {
    return this.token
  }

  async set(token: string): Promise<void> {
    this.token = token
    await idbSet(KEY, token)
  }

  async clear(): Promise<void> {
    this.token = null
    await idbDel(KEY)
  }
}
```

- [ ] **Step 3: Build + commit**

Run: `cd telegram-ui-clone && npx tsc --noEmit`
```bash
git add src/core/store/idbKv.ts src/core/auth/tokenStore.ts && git commit -m "feat: idb kv + token store"
```

---

### Task 2: AuthManager

**Files:** Create `src/core/managers/authManager.ts`, `authManager.test.ts`.

- [ ] **Step 1: Failing test (fake rest + fake token store)**

`src/core/managers/authManager.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { newAuthManager, type AuthDeps } from './authManager'

function deps(overrides: Partial<{ token: string | null }> = {}) {
  let token: string | null = overrides.token ?? null
  const calls: Array<[string, unknown]> = []
  const store = {
    get: () => token,
    set: async (t: string) => { token = t },
    clear: async () => { token = null },
  }
  const rest = {
    post: async (path: string, body: unknown) => {
      calls.push([path, body])
      if (path === '/auth/request_code') return { ok: true }
      if (path === '/auth/sign_in') return { token: 'TOK', user: { id: 1, phone: '+700', display_name: '+700' } }
      if (path === '/auth/logout') return { ok: true }
      throw new Error('unexpected ' + path)
    },
    get: async (path: string) => {
      if (path === '/me') {
        if (!token) throw Object.assign(new Error('missing token'), { status: 401 })
        return { id: 1, phone: '+700', display_name: '+700' }
      }
      throw new Error('unexpected ' + path)
    },
  }
  return { d: { rest, store } as unknown as AuthDeps, calls, token: () => token }
}

describe('AuthManager', () => {
  it('signIn stores the token and me() then returns the user', async () => {
    const { d, token } = deps()
    const auth = newAuthManager(d)
    await auth.requestCode('+7 700')
    const r = await auth.signIn('+7 700', '12345', 'web', 'browser')
    expect(r.user.id).toBe(1)
    expect(token()).toBe('TOK')
    await expect(auth.me()).resolves.toMatchObject({ id: 1 })
  })

  it('me() returns null when unauthenticated (401)', async () => {
    const { d } = deps()
    const auth = newAuthManager(d)
    await expect(auth.me()).resolves.toBeNull()
  })

  it('logout clears the token; me() then null', async () => {
    const { d, token } = deps({ token: 'TOK' })
    const auth = newAuthManager(d)
    await auth.logout()
    expect(token()).toBeNull()
    await expect(auth.me()).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run → fails.** `cd telegram-ui-clone && npm test -- authManager`.

- [ ] **Step 3: Implement**

`src/core/managers/authManager.ts`:
```ts
import { HttpError, type RestClient } from '../net/restClient'

export interface User { id: number; phone: string; display_name: string }

interface TokenStoreLike {
  get(): string | null
  set(token: string): Promise<void>
  clear(): Promise<void>
}

export interface AuthDeps {
  rest: RestClient
  store: TokenStoreLike
}

export function newAuthManager({ rest, store }: AuthDeps) {
  return {
    async requestCode(phone: string): Promise<void> {
      await rest.post('/auth/request_code', { phone })
    },

    async signIn(phone: string, code: string, device: string, platform: string): Promise<{ user: User }> {
      const res = await rest.post<{ token: string; user: User }>('/auth/sign_in', { phone, code, device, platform })
      await store.set(res.token)
      return { user: res.user }
    },

    async me(): Promise<User | null> {
      if (!store.get()) return null
      try {
        return await rest.get<User>('/me')
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) {
          await store.clear()
          return null
        }
        throw e
      }
    },

    async logout(): Promise<void> {
      if (store.get()) {
        try { await rest.post('/auth/logout', {}) } catch { /* ignore */ }
      }
      await store.clear()
    },
  }
}
```

- [ ] **Step 4: Run → pass.** `npm test -- authManager`.

- [ ] **Step 5: Commit**
```bash
git add src/core/managers/authManager.ts src/core/managers/authManager.test.ts && git commit -m "feat: AuthManager (requestCode/signIn/me/logout)"
```

---

### Task 3: Wire AuthManager into the worker + Managers type

**Files:** Modify `src/core/worker.ts`, `src/client/bootstrap.ts`.

- [ ] **Step 1: Worker — token store + auth manager**

In `src/core/worker.ts`, replace the in-memory token block with the TokenStore and register the auth manager. Concretely:
```ts
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { registerManagers } from '../rpc/managersProxy'
import { RestClient } from './net/restClient'
import { newHealthManager } from './managers/healthManager'
import { TokenStore } from './auth/tokenStore'
import { newAuthManager } from './managers/authManager'

const tokens = new TokenStore()
void tokens.load() // restore persisted session
const rest = new RestClient('/api', () => tokens.get())
const auth = newAuthManager({ rest, store: tokens })

function bind(ep: Endpoint) {
  const smp = new SuperMessagePort(ep)
  registerManagers(smp, {
    health: newHealthManager(rest),
    auth,
  })
}
```
(Keep the existing SharedWorker/Worker `onconnect`/fallback block unchanged.)

- [ ] **Step 2: Managers type**

In `src/client/bootstrap.ts`, extend the `Managers` interface:
```ts
import type { HealthStatus } from '../core/managers/healthManager'
import type { User } from '../core/managers/authManager'

export interface Managers {
  health: { check(): Promise<HealthStatus> }
  auth: {
    requestCode(phone: string): Promise<void>
    signIn(phone: string, code: string, device: string, platform: string): Promise<{ user: User }>
    me(): Promise<User | null>
    logout(): Promise<void>
  }
}
```

- [ ] **Step 3: Build + commit**

Run: `cd telegram-ui-clone && npx tsc --noEmit && npm test`
```bash
git add src/core/worker.ts src/client/bootstrap.ts && git commit -m "feat: register AuthManager in worker; Managers.auth type"
```

---

### Task 4: Wire AuthFlow to real auth + gate the app

**Files:** Modify `src/components/auth/AuthFlow.tsx`, `src/App.tsx`.

- [ ] **Step 1: AuthFlow uses the real backend**

In `src/components/auth/AuthFlow.tsx`:

(a) Add imports + obtain managers:
```ts
import { startClient } from '../../client/bootstrap'
```
At the top of the component body:
```ts
const { managers } = startClient()
const [error, setError] = useState('')
const [busy, setBusy] = useState(false)
const fullPhone = `${country.code}${phoneDigits}`
```

(b) **Phone "Next"** — replace its `onClick` so it requests a real code, then advances:
```tsx
onClick={async () => {
  if (busy) return
  setError(''); setBusy(true)
  try {
    await managers.auth.requestCode(fullPhone)
    setCode(Array(CODE_LEN).fill(''))
    go('code', 1)
  } catch {
    setError(t('Could not send the code. Try again.'))
  } finally { setBusy(false) }
}}
```

(c) **Code complete** — the backend has no 2FA, so signing in happens when the code is entered. Replace the `setDigit` "all entered" branch (currently `go('password', 1)`) and the code-step "Next" button to call a `submitCode` helper instead of going to `password`:
```ts
const submitCode = async () => {
  if (busy) return
  setError(''); setBusy(true)
  try {
    await managers.auth.signIn(fullPhone, codeStr, 'web', 'browser')
    onComplete()
  } catch {
    setError(t('Invalid code'))
    setCode(Array(CODE_LEN).fill(''))
    codeRefs.current[0]?.focus()
  } finally { setBusy(false) }
}
```
- In `setDigit`, change the last-digit branch from `setTimeout(() => go('password', 1), 180)` to `setTimeout(submitCode, 120)`.
- In the code step, change the "Next" button `onClick` from `() => go('password', 1)` to `submitCode`.

(d) **Drop the password step**: remove the `passwordStep` content from the `content` selector (the flow is now `phone | qr | code`). Leave `passwordStep`'s JSX defined or delete it — but it must no longer be reachable; set `content = step === 'phone' ? phoneStep : step === 'qr' ? qrStep : codeStep`. Update the back arrow target (`step === 'password' ? 'code' : 'phone'` → just `'phone'`). The `Step` type becomes `'phone' | 'qr' | 'code'`. Remove now-unused `password`/`showPass`/`setPassword` state and the password-related imports (`LockOutlined`, `VisibilityOutlined`, `VisibilityOffOutlined`) if they become unused.

(e) **QR step**: it currently calls `onComplete` on click — that would "log in" with no token. Change the QR code box `onClick` to a no-op and its title to `t('QR login is not available yet')` (real QR login is a later phase). Keep the rest of the QR UI.

(f) **Error display**: under the code inputs (and phone field), render the error when set:
```tsx
{error && <Typography sx={{ fontSize: 13, color: '#e53935', textAlign: 'center', mt: 1.5 }}>{error}</Typography>}
```

- [ ] **Step 2: Gate the app on real auth**

In `src/App.tsx` `ThemedApp`:

(a) Replace the `authed` state init + login/logout with a real check:
```ts
const [authed, setAuthed] = useState<boolean | null>(null) // null = checking

useEffect(() => {
  const { managers } = startClient()
  managers.auth.me().then((u) => setAuthed(!!u)).catch(() => setAuthed(false))
}, [])

const login = () => setAuthed(true)
const logout = () => {
  const { managers } = startClient()
  void managers.auth.logout()
  setAuthed(false)
}
```
Remove the `localStorage.getItem('tg-authed')` / `setItem` / `removeItem` usage.

(b) Render: while `authed === null` show nothing (or a blank background); when `false` show `<AuthFlow onComplete={login} />`; when `true` show the `Shell`. Adjust the existing conditional accordingly (it already switches on `authed`; just handle the `null` case by rendering `null` until resolved).

- [ ] **Step 3: Build + commit**

Run: `cd telegram-ui-clone && npx tsc --noEmit && npm test`
Expected: clean + tests green.
```bash
git add src/components/auth/AuthFlow.tsx src/App.tsx && git commit -m "feat: wire AuthFlow + app gate to real /api/auth + /api/me"
```

---

### Task 5: End-to-end verification (real login)

**Files:** none.

- [ ] **Step 1: Unit suite**

Run: `cd telegram-ui-clone && npm test` → all green (authManager + FE-1 tests).

- [ ] **Step 2: Live login through the stack**

```bash
cd telegram-ui-clone && npx vite build --base=/ --outDir ../client-build --emptyOutDir
```
Bring up an isolated stack (pg+redis+backend+nginx) on a free port (baked nginx image with the config + client-build, since bind-mounting the host conf hits a macOS xattr issue in this environment). Then in a browser:
1. Open the app → AuthFlow phone screen.
2. Enter a phone (e.g. `9990000000`), Next → should call `/api/auth/request_code` (200).
3. The dev OTP is **`12345`** (server logs it). Enter `12345` → `/api/auth/sign_in` → token stored → `onComplete` → the chat UI (mock chats) appears.
4. Reload → still logged in (token persisted in IndexedDB → `me()` returns the user).
5. (Optional) logout from the sidebar menu → back to AuthFlow.

Verify with the playwright MCP: type the phone, click Next, type `12345`, assert the app left the auth screen (no phone field; the sidebar/chat is visible). Check the browser console has no errors and the network shows `/api/auth/sign_in` 200.

- [ ] **Step 3:** No code changes expected; fix under the relevant task if login fails.

---

## Self-Review Notes

- **Spec coverage:** F2 — AuthManager (requestCode/signIn/me/logout) + token in worker + IndexedDB persistence (Tasks 1–3); AuthFlow + app gate on real auth (Task 4); live login verified (Task 5).
- **Backend alignment:** matches `docs/contracts.md` — `/auth/request_code {phone}`, `/auth/sign_in {phone,code,device,platform}` → `{token,user}`, `/me`, `/auth/logout`; dev OTP `12345`; 401 → unauthenticated. No 2FA → password step removed; QR inert (deferred).
- **Out of scope (next slices):** real chats/messages (still mock `data.ts`), WS connection/sync, presence — F3+/F5+.
- **Persistence:** token in the worker (in-memory for sync `RestClient` reads) + IndexedDB so it survives reload; `me()` self-heals a stale token (401 → clear → null).
- **Testing:** AuthManager unit-tested with fake rest + fake token store (no network/idb); the idb persistence + full login proven by the live playwright check.
- **Type consistency:** `TokenStore` (load/get/set/clear), `newAuthManager`/`AuthDeps`/`User`, `Managers.auth`, `startClient`, `requestCode/signIn/me/logout` consistent across worker, bootstrap, AuthFlow, App.
```
