# QR Login — Design Spec

**Status:** Approved 2026-06-24. Decisions (user): desktop receives the session via **polling** a public endpoint; QR is conceptually **scanned by a mobile/already-authed device** (no in-browser camera scanner in v1); the desktop **auto-rotates** the QR token every ~30s; QR rendering **ports tweb's login-QR card** (which uses the `qr-code-styling` npm package + tweb's styling wrapper).

## Goal

Let an unauthenticated client log in without typing a phone/OTP: it displays a QR that encodes a short-lived login token; an already-authenticated device opens it, confirms, and the backend mints a fresh session for the confirming user and hands it back to the waiting (polling) client — mirroring Telegram's "Log in by QR code".

## Flow

1. **Generate.** Unauthenticated client (the "desktop") opens the login screen and chooses "Log in by QR". It calls public `POST /auth/qr/new` → `{ token, url, expires_at }`. `token` is a fresh random id (24 hex chars); `url = ${origin}/qr/{token}`; TTL ~60s.
2. **Display + rotate + poll.** The desktop renders a QR encoding `url`. Every ~30s it calls `POST /auth/qr/new` again and swaps in the fresh QR (auto-rotation). In parallel it polls `GET /auth/qr/{token}` every ~2s for the **current** token → `{ status: "pending" | "confirmed" | "expired", session_token?, user? }`.
3. **Scan + confirm.** An already-authenticated device (a mobile, conceptually; in the web clone any authed session that opens `url`) lands on `/qr/{token}` → a confirm screen "Войти на новом устройстве?" showing the requesting platform → user taps "Подтвердить" → `POST /auth/qr/confirm { token }` (Bearer of the confirming user).
4. **Mint session.** Backend validates the token (exists, `pending`, not expired), then creates a **new device/session for the confirming user** via the same primitives `SignIn` uses (`domain.GenerateToken` + `devices.Create(userID, name, platform, tokenHash)`), stores the new opaque session token + user snapshot on the qr record, and marks it `confirmed`. The qr record keeps its short TTL so the desktop can read the result once.
5. **Desktop logs in.** The desktop's next poll returns `{ status: "confirmed", session_token, user }`. It stores `session_token` in IndexedDB (the existing `tokenStore`) and transitions into the main UI via the **existing sign-in-completion path** (same as phone/OTP success). The qr record is single-use.

## Data model (no migration — Redis)

QR login records are ephemeral with a natural TTL, so they live in Redis (not Postgres; no migration). Keyed by the **token hash** (never store the raw token), value is a small JSON blob:

- Key: `qrlogin:{sha256(token)}`, TTL ~60s on create.
- Value (pending): `{ status: "pending", platform: string, created_at }`.
- On confirm: value replaced with `{ status: "confirmed", session_token, user: {id, phone, display_name}, ... }`, TTL refreshed short (~60s) so the desktop reads it once; deleted after a successful read or on natural expiry.

`expired` is implicit: a missing key for a token the client knows about ⇒ `expired` (the `GET` returns `{status:"expired"}` when the key is gone).

## Backend (clean-arch; extends `usecase/auth`)

New port in `internal/usecase/auth/ports.go`:
```go
type QRStore interface {
    Put(ctx context.Context, tokenHash string, rec domain.QRLogin, ttl time.Duration) error
    Get(ctx context.Context, tokenHash string) (domain.QRLogin, error) // domain.ErrNotFound when absent/expired
    Delete(ctx context.Context, tokenHash string) error
}
```
New domain type `domain.QRLogin{Status string; Platform string; SessionToken string; User domain.User; CreatedAt time.Time}` (+ status consts `QRPending`/`QRConfirmed`).

New `Interactor` methods (reuse `devices` repo + `domain.GenerateToken`; `QRStore` injected at runtime like `SetCache`, nil ⇒ feature disabled):
- `NewQRLogin(ctx, platform string) (token string, expiresAt time.Time, err error)`: generate token, `Put` a `pending` record (TTL), return raw token + expiry. `ErrQRUnavailable` (→ 503) when `QRStore` is nil.
- `QRStatus(ctx, token string) (domain.QRLogin, error)`: `Get` by hash; if confirmed, `Delete` (single-use) and return the record (with `SessionToken`/`User`); `ErrNotFound` ⇒ caller maps to `expired`.
- `ConfirmQRLogin(ctx, token string, confirmingUserID int64) error`: `Get` (must be `pending`+unexpired, else `ErrNotFound`/`ErrConflict`); mint a new session for `confirmingUserID` (`GenerateToken` + `devices.Create(userID, "QR login", record.Platform, tokenHash)`); `Put` the record as `confirmed` with the new session token + the user snapshot (load via users repo); return.

Adapter: `internal/adapter/cache/redis/qrstore.go` implementing `QRStore` (JSON marshal, `SET ... EX`, `GET`, `DEL`). Wired in `server.go` next to the session cache: `if p.Redis.OK { authUC.SetQRStore(redisQRStore(p.Redis)) }`.

HTTP (`auth_handler.go`, routes in `router.go`):
- `POST /auth/qr/new` (**public**, next to `request_code`/`sign_in`): body `{ platform? }` → `{ token, url, expires_at }`. `url` is built from the request `Origin`/`Host` (or a configured base) as `${origin}/qr/{token}`.
- `GET /auth/qr/{token}` (**public**): → `{ status, session_token?, user? }` (`expired` when unknown).
- `POST /auth/qr/confirm` (**Bearer group**): body `{ token }` → `{ ok: true }`; maps `ErrNotFound`→404, `ErrConflict`→409, `ErrQRUnavailable`→503.

`contracts.md` + `openapi.yaml`: add the three endpoints.

## Frontend (`telegram-ui-clone`)

- **Worker `AuthManager`** (`src/core/managers/authManager.ts` or wherever auth RPC lives): `qrNew(platform)→{token,url,expiresAt}`, `qrStatus(token)→{status,sessionToken?,user?}`, `qrConfirm(token)→void`. Add to the `Managers.auth` surface in `bootstrap.ts`. `qrStatus` "confirmed" sets the token in `tokenStore` (same as `signIn`) so all tabs become authed.
- **QR login screen** (desktop, in `AuthFlow` — it already has an inert QR option to wire): a QR card **ported from tweb** `src/pages/cards/SignQRCard.tsx` + `src/helpers/qrCode/paintQrCode.ts`, using the `qr-code-styling` npm package (the dependency tweb uses) for the rounded Telegram-styled QR. Behaviour: on mount `qrNew` → render `url`; a 30s timer re-runs `qrNew` and swaps the QR (auto-rotation); a ~2s poll loop calls `qrStatus(currentToken)`; on `confirmed` → token stored → app transitions to main UI (reuse the existing post-sign-in transition); on `expired` show "QR истёк" with a manual refresh that also restarts rotation.
- **Confirm deep-link** `/qr/{token}` (authed; mirrors the existing `/join/{token}` handling in `App.tsx` Shell): a confirm screen "Войти на новом устройстве?" (+ platform from the record if surfaced) → "Подтвердить" calls `qrConfirm(token)` → success toast "Вход подтверждён" → `history.replaceState('/')`. Unauthenticated open ⇒ lands on login (v1, same as invite deep-links).

## Security

- Token is random (24 hex), short-lived (~60s), single-use (confirmed record deleted on first read).
- `confirm` requires a valid Bearer (the confirming device proves it is already authenticated); the new session is minted for **that** user.
- The session token is returned to the desktop only via the poll keyed by the qr token; possession of the ephemeral token is the desktop's proof of ownership (same trust model as Telegram's QR login). Auto-rotation shrinks the exposure window.
- Never store the raw qr token (hash it, like session tokens); never log it.

## Out of scope (v1)

In-browser camera QR scanner; binding the qr session to device fingerprint/IP; revoking a pending qr login before confirmation; rate-limiting `POST /auth/qr/new` beyond what already exists; APNs/FCM. (A real mobile app would parse the token from the QR and call `confirm`; we don't build a native scanner.)

## Plans

- **QR-1 (backend):** `domain.QRLogin` + `QRStore` port + redis adapter; `Interactor.NewQRLogin/QRStatus/ConfirmQRLogin` (+ `SetQRStore`, nil-safe); HTTP 3 endpoints + router wiring + fx; contracts/openapi; unit tests (fake QRStore) + handler test; merge + curl smoke on :38080 (new → pending; confirm as an authed user → status flips to confirmed with a working session_token; expired path).
- **QR-2 (frontend):** add `qr-code-styling`; port tweb `SignQRCard`/`paintQrCode`; worker `AuthManager` qr methods + `Managers.auth`; desktop QR screen (rotate + poll + login on confirm); `/qr/{token}` confirm deep-link; vitest; live-verify (playwright on :38080) the two-session flow + merge.

## Self-review

- Polling + public new/status + Bearer confirm matches the chosen delivery; auto-rotation every 30s is a desktop-side timer over `POST /auth/qr/new`. Reuses `devices`+`GenerateToken` for session minting (no new token machinery), Redis for ephemeral records (no migration), and tweb's QR card for faithful UI. Confirm rides the existing `/join/{token}` deep-link pattern; login-completion reuses the existing `tokenStore` path. ✓
