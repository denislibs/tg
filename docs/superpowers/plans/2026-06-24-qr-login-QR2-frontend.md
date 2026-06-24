# QR Login — Plan QR-2: Frontend

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec: `docs/superpowers/specs/2026-06-24-qr-login-design.md`. Backend QR-1 merged. Frontend repo at `/Users/denisurevic/Documents/messenger-denis/telegram-ui-clone` (its OWN git repo). Branch `frontend-slice12-qr-login`.

**Goal:** Desktop QR-login UI — a real (scannable) QR encoding `${origin}/qr/{token}`, auto-rotating every 30s and polling for confirmation; on confirmation the desktop logs in. Plus a `/qr/{token}` confirm screen for an already-authed device. Reuse the existing `AuthFlow` qr step; port tweb's styled QR.

**Architecture:** Worker `authManager` gains `qrNew/qrStatus/qrConfirm` (qrStatus stores the session token on confirm, like `signIn`). A real QR component using the `qr-code-styling` npm package (the lib tweb uses), styled per tweb (`paintQrCode`/`SignQRCard`: rounded dots + center logo). `AuthFlow` qr step drives rotate+poll. `/qr/{token}` confirm rides the existing `/join/{token}` deep-link pattern in `App.tsx` Shell.

**Tech Stack:** React, TS, MUI, zustand, Vitest. New dep: `qr-code-styling`.

---

## Task 1: authManager qr methods + Managers surface

**Files:**
- Modify: `src/core/managers/authManager.ts`
- Test: `src/core/managers/authManager.test.ts`
- Modify: `src/client/bootstrap.ts`

- [ ] **Step 1: Branch** — `cd telegram-ui-clone && git checkout master && git checkout -b frontend-slice12-qr-login`.

- [ ] **Step 2: Write failing tests** — append to `src/core/managers/authManager.test.ts` (match the existing harness in that file — it builds a manager over a fake `rest` + `store`; reuse that setup):
```ts
it('qrNew returns the token + url', async () => {
  // arrange a fake rest that returns a qr-new payload (follow the file's existing fake-rest pattern)
  const auth = makeAuth({
    post: async (path: string) => {
      if (path === '/auth/qr/new') return { token: 'tok123', url: 'http://h/qr/tok123', expires_at: '2026-06-24T00:01:00Z' }
      throw new Error('unexpected ' + path)
    },
  })
  const r = await auth.qrNew('web')
  expect(r.token).toBe('tok123')
  expect(r.url).toBe('http://h/qr/tok123')
})

it('qrStatus stores the session token when confirmed', async () => {
  const set = vi.fn(async () => {})
  const auth = makeAuth({
    get: async (path: string) => {
      if (path === '/auth/qr/tok123')
        return { status: 'confirmed', session_token: 'sess999', user: { id: 7, phone: '+7', display_name: '+7' } }
      throw new Error('unexpected ' + path)
    },
    store: { set },
  })
  const r = await auth.qrStatus('tok123')
  expect(r.status).toBe('confirmed')
  expect(r.user?.id).toBe(7)
  expect(set).toHaveBeenCalledWith('sess999')
})

it('qrStatus pending does not store a token', async () => {
  const set = vi.fn(async () => {})
  const auth = makeAuth({ get: async () => ({ status: 'pending' }), store: { set } })
  const r = await auth.qrStatus('tok123')
  expect(r.status).toBe('pending')
  expect(set).not.toHaveBeenCalled()
})

it('qrConfirm posts the token', async () => {
  const calls: any[] = []
  const auth = makeAuth({ post: async (p: string, b: any) => { calls.push([p, b]); return {} } })
  await auth.qrConfirm('tok123')
  expect(calls).toContainEqual(['/auth/qr/confirm', { token: 'tok123' }])
})
```
> `makeAuth` is shorthand for the file's existing manager-construction helper with the deps overridden. If the file constructs inline, adapt these to its exact pattern (build `newAuthManager({ rest, store })` with a fake rest/store). Keep the existing tests intact.

- [ ] **Step 3: Run to verify they fail** — `npx vitest run src/core/managers/authManager.test.ts`. Expected: FAIL (methods missing).

- [ ] **Step 4: Implement** — in `src/core/managers/authManager.ts` add these to the returned object (after `signIn`), and the response types:
```ts
    async qrNew(platform: string): Promise<{ token: string; url: string; expiresAt: string }> {
      const r = await rest.post<{ token: string; url: string; expires_at: string }>('/auth/qr/new', { platform })
      return { token: r.token, url: r.url, expiresAt: r.expires_at }
    },

    async qrStatus(token: string): Promise<{ status: 'pending' | 'confirmed' | 'expired'; user?: User }> {
      const r = await rest.get<{ status: 'pending' | 'confirmed' | 'expired'; session_token?: string; user?: User }>(`/auth/qr/${token}`)
      if (r.status === 'confirmed' && r.session_token) {
        await store.set(r.session_token)
      }
      return { status: r.status, user: r.user }
    },

    async qrConfirm(token: string): Promise<void> {
      await rest.post('/auth/qr/confirm', { token })
    },
```

- [ ] **Step 5: Managers surface** — in `src/client/bootstrap.ts`, extend the `auth` block of the `Managers` interface:
```ts
    qrNew(platform: string): Promise<{ token: string; url: string; expiresAt: string }>
    qrStatus(token: string): Promise<{ status: 'pending' | 'confirmed' | 'expired'; user?: User }>
    qrConfirm(token: string): Promise<void>
```
(The worker proxy forwards all manager methods generically — no other wiring needed; verify by grepping how `auth` methods reach the worker. If methods are explicitly listed in the worker registration, add them there too.)

- [ ] **Step 6: Run + tsc + commit** — `npx vitest run src/core/managers/authManager.test.ts && npx tsc -b`. Commit `feat(qr-login): authManager qrNew/qrStatus/qrConfirm + Managers surface`.

---

## Task 2: real styled QR component (port tweb)

**Files:**
- Add dep `qr-code-styling`
- Create: `src/components/auth/QrCode.tsx`

- [ ] **Step 1: Add the dependency** — `cd telegram-ui-clone && npm install qr-code-styling`. (Commit the package.json/lock changes with this task.)

- [ ] **Step 2: Reference tweb** — read `/Users/denisurevic/Documents/tweb/src/helpers/qrCode/paintQrCode.ts` and `/Users/denisurevic/Documents/tweb/src/pages/cards/SignQRCard.tsx` for the styling values (dots type `rounded`, dot color, background, center-logo size, the `qr-code-styling` options). Mirror those options; do not invent a new look.

- [ ] **Step 3: Component** — create `src/components/auth/QrCode.tsx`: a component that renders a real scannable QR for a `data` string using `qr-code-styling`, styled like tweb (rounded dots, transparent/white bg, a circular Telegram-plane logo in the center). It lazy-imports the lib so the bundle stays lean. Clear the host with `replaceChildren()` (never assign `innerHTML`).
```tsx
import { useEffect, useRef } from 'react'
import { Box } from '@mui/material'

/**
 * A real (scannable) QR rendered with `qr-code-styling`, styled to match tweb's
 * login QR (rounded dots + a center logo hole). `data` is the URL to encode;
 * changing it re-renders (used for the 30s auto-rotation). The caller overlays
 * the center logo over the cleared area.
 */
export default function QrCode({
  data,
  size = 220,
  color = '#000',
}: {
  data: string
  size?: number
  color?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const qrRef = useRef<any>(null)

  useEffect(() => {
    if (!data) return
    let alive = true
    void import('qr-code-styling').then((mod) => {
      if (!alive || !ref.current) return
      const QRCodeStyling = (mod as any).default
      const opts = {
        width: size,
        height: size,
        type: 'svg' as const,
        data,
        margin: 0,
        qrOptions: { errorCorrectionLevel: 'M' as const },
        dotsOptions: { type: 'rounded' as const, color },
        cornersSquareOptions: { type: 'extra-rounded' as const, color },
        cornersDotOptions: { type: 'dot' as const, color },
        backgroundOptions: { color: 'transparent' },
        imageOptions: { hideBackgroundDots: true, imageSize: 0.28, margin: 4 },
      }
      if (qrRef.current) {
        qrRef.current.update({ data })
      } else {
        qrRef.current = new QRCodeStyling(opts)
        ref.current.replaceChildren()
        qrRef.current.append(ref.current)
      }
    })
    return () => { alive = false }
  }, [data, size, color])

  return <Box ref={ref} sx={{ width: size, height: size }} aria-label="QR code" />
}
```
> If `qr-code-styling`'s `.update({data})` doesn't re-render reliably on `data` change, recreate the instance instead (call `ref.current.replaceChildren()`, `new QRCodeStyling(opts)`, append). Keep the center logo as the caller's absolutely-positioned overlay (the existing qr step already overlays a `TgPlane` circle).

- [ ] **Step 4: tsc + commit** — `npx tsc -b`. Commit `feat(qr-login): real styled QR component (qr-code-styling, tweb look)`.

---

## Task 3: wire AuthFlow qr step (rotate + poll) + confirm deep-link

**Files:**
- Modify: `src/components/auth/AuthFlow.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Live QR in the qr step** — in `AuthFlow.tsx` replace the inert `FakeQr` usage (lines ~309–342) with the real flow. Add state + effects near the other step state:
```tsx
  // qr step — generate + auto-rotate (30s) + poll (2s) for confirmation
  const [qrUrl, setQrUrl] = useState('')
  const [qrError, setQrError] = useState(false)
  const qrTokenRef = useRef<string>('')

  useEffect(() => {
    if (step !== 'qr') return
    let alive = true
    let rotate: ReturnType<typeof setInterval> | null = null
    let poll: ReturnType<typeof setInterval> | null = null

    const regen = async () => {
      try {
        const { token, url } = await managers.auth.qrNew('web')
        if (!alive) return
        qrTokenRef.current = token
        setQrUrl(url)
        setQrError(false)
      } catch {
        if (alive) setQrError(true)
      }
    }
    const tick = async () => {
      const token = qrTokenRef.current
      if (!token) return
      try {
        const r = await managers.auth.qrStatus(token)
        if (!alive) return
        if (r.status === 'confirmed') {
          cleanup()
          onComplete() // token already stored by qrStatus
        } else if (r.status === 'expired') {
          void regen() // rotate to a fresh code
        }
      } catch { /* transient; keep polling */ }
    }
    const cleanup = () => {
      alive = false
      if (rotate) clearInterval(rotate)
      if (poll) clearInterval(poll)
    }

    void regen()
    rotate = setInterval(() => void regen(), 30_000)
    poll = setInterval(() => void tick(), 2_000)
    return cleanup
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps
```
Then render `<QrCode data={qrUrl} size={220} color="#000" />` inside the white card (keep the existing center-logo overlay markup + the 3 instruction lines + "Log in by phone Number" link). When `qrError` is true OR `qrUrl===''`, show a subtle "Обновление…" / "QR недоступен" state in place of the code. Import `QrCode` and `useEffect`/`useRef` as needed.
> The "scan with your phone" instruction lines already exist — keep them. This screen is the desktop side; a real mobile app (or, in our web clone, an already-authed session that opens the encoded URL) confirms.

- [ ] **Step 2: Confirm deep-link** — in `src/App.tsx` Shell, add an effect mirroring the `/join/:token` block:
```tsx
  const [qrConfirmToken, setQrConfirmToken] = useState<string | null>(null)

  useEffect(() => {
    const m = location.pathname.match(/^\/qr\/([\w-]+)$/)
    if (!m) return
    setQrConfirmToken(m[1])
  }, [])
```
Render a confirm overlay when `qrConfirmToken` is set (reuse the app's modal/sheet styling — e.g. the add-member modal pattern): title "Войти на новом устройстве?", body "Подтвердите вход для нового устройства", and two buttons:
```tsx
// Подтвердить:
const { managers } = startClient()
try {
  await managers.auth.qrConfirm(qrConfirmToken)
  setJoinToast('Вход подтверждён') // reuse the existing transient toast + timer
} catch {
  setJoinToast('Не удалось подтвердить')
}
setQrConfirmToken(null)
window.history.replaceState({}, '', '/')
// Отмена: setQrConfirmToken(null); window.history.replaceState({}, '', '/')
```
(Reuse `joinToast`/`joinToastTimer` for the success banner.) An unauthenticated open of `/qr/{token}` lands on `AuthFlow` (v1, same as invite deep-links) — no extra handling.

- [ ] **Step 3: tsc + tests + build + commit** — `npx tsc -b && npx vitest run && npx vite build --base=/ --outDir /tmp/tg-build-check --emptyOutDir`. Commit `feat(qr-login): live QR step (rotate+poll+login) + /qr/{token} confirm deep-link`.

---

## Task 4: live verify + memory + merge

- [ ] **Step 1: Rebuild verify stack** — `cd telegram-ui-clone && npx vite build --base=/ --outDir ../client-build --emptyOutDir`, then `cd /Users/denisurevic/Documents/messenger-denis && docker compose -p msgrverify -f docker-compose.verify.yml up -d --build nginx`. Ensure the QR-1 backend is already built into the verify backend (rebuild backend if needed).

- [ ] **Step 2: Playwright two-session verify** (on :38080, mirror the stories verify approach):
  - Open a fresh browser (logged out) → AuthFlow → click the "Log in by QR" entry → the qr step shows a **real** QR; confirm via DOM that `managers.auth.qrNew` was called and `qrUrl` is `http://localhost:38080/qr/{token}` (read the `<svg>`/canvas presence + the data). 0 console errors.
  - Simulate the confirming (already-authed) device: in a second context/tab logged in as an existing user (seed/login via the token-swap trick from the stories verify — set idb `session_token`, close+reopen), navigate to `http://localhost:38080/qr/{token}` → the confirm overlay appears → click "Подтвердить" → toast "Вход подтверждён".
  - Back in the first (logged-out) browser: within ~2s its poll returns confirmed → it transitions into the main UI (Shell, chat list) as the confirming user. Confirm via DOM (sidebar present) + `GET /api/me` with the stored token. 0 console errors. Screenshot the qr step + the confirmed main UI.
  > If driving two browsers is awkward, you may confirm via API (`POST /api/auth/qr/confirm {token}` with an authed Bearer) to exercise the desktop's poll→login path in the browser; but verify the confirm **overlay UI** at least once by visiting `/qr/{token}` while authed.

- [ ] **Step 3: Memory** — update `messenger-project.md`: QR-login done (backend QR-1 + frontend QR-2) → feature COMPLETE; note `qr-code-styling` dep, the rotate(30s)+poll(2s) model, public new/status + Bearer confirm, and the `/qr/{token}` confirm deep-link. Add any bug found+fixed in live verify.

- [ ] **Step 4: Merge** — `cd telegram-ui-clone && git checkout master && git merge --no-ff frontend-slice12-qr-login -m "Merge frontend-slice12-qr-login: QR login frontend (QR-2)"`.

## Self-review
- Reuses the existing `AuthFlow` qr step (mirror tweb) on real data; real scannable QR via `qr-code-styling` (the lib tweb uses) styled per tweb; rotate(30s)+poll(2s) matches the chosen delivery; login-completion reuses `onComplete()` + the worker `tokenStore` (qrStatus stores the token like signIn); confirm rides the `/join/{token}` deep-link pattern. ✓
