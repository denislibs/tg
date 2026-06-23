# Clean Arch Slice 6 — Finalize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox (`- [ ]`) steps.

**Goal:** Finalize the Clean Architecture layout: relocate the HTTP/WS delivery into `internal/adapter/delivery/{http,ws}` (canonical §4), tidy the fx graph (drop dead providers), verify layer purity, and run a full whole-system verification. No behavior/API change.

**Architecture:** Slice 6 (last). Slices 0–5 already moved all business logic into `internal/usecase/*` (ports) with `internal/adapter/*` implementations, wired by fx — the architecture is complete. This slice does the final directory relocation of the delivery adapter and cleanup. `internal/store/postgres` (connect/migrate/testdb + embedded migrations) and `internal/store/redisstore` (redis client) remain as the infra/db + infra/redis layer (functionally already infra; only renaming would churn many test imports for no gain) — documented as such.

**Tech Stack:** Go, fx — pure relocation + verification.

---

## File Structure
```
backend/
  internal/adapter/delivery/http/   ← moved from internal/transport/http/  (package stays `http`)
  internal/adapter/delivery/ws/     ← moved from internal/transport/ws/    (package stays `ws`)
  internal/app/{providers.go,server.go,app.go}  — MODIFY: import paths + drop dead providePushRepo
  internal/store/{postgres,redisstore}  — UNCHANGED (infra/db + infra/redis layer)
  docs/superpowers/specs/2026-06-24-clean-architecture-di-design.md — MODIFY: mark done + note store/* role
```

---

### Task 1: Relocate HTTP delivery

**Files:** `git mv internal/transport/http → internal/adapter/delivery/http`; update importers.

- [ ] **Step 1: Move**

Run:
```bash
cd backend && mkdir -p internal/adapter/delivery && git mv internal/transport/http internal/adapter/delivery/http
```
The package declaration stays `package http`. The `openapi.yaml` embed + handlers move with it.

- [ ] **Step 2: Update import paths**

Update every import of `github.com/messenger-denis/backend/internal/transport/http` → `github.com/messenger-denis/backend/internal/adapter/delivery/http` across the repo (the alias `httptransport` may stay). Affected: `internal/app/server.go`, `internal/app/providers.go` (if any), and any cross-package test. Find them: `grep -rln "internal/transport/http" backend`.

- [ ] **Step 3: Build + test the package**

Run: `cd backend && go build ./... && go test ./internal/adapter/delivery/http/ -count=1`
Expected: builds; the delivery http tests pass (they moved with the package).

- [ ] **Step 4: Commit**
```bash
git add -A backend/ && git commit -m "refactor(backend): relocate http delivery to adapter/delivery/http"
```

---

### Task 2: Relocate WS delivery

**Files:** `git mv internal/transport/ws → internal/adapter/delivery/ws`; update importers.

- [ ] **Step 1: Move**

Run: `cd backend && git mv internal/transport/ws internal/adapter/delivery/ws`
Package stays `package ws` (and the integration test package `ws_test`).

- [ ] **Step 2: Update import paths**

`grep -rln "internal/transport/ws" backend` and replace → `internal/adapter/delivery/ws`. Affected: `internal/app/server.go`, the ws integration test's own import. Then remove the now-empty `internal/transport/` directory.

- [ ] **Step 3: Build + test + race**

Run: `cd backend && go build ./... && go test ./internal/adapter/delivery/ws/ -count=1 && go test -race -count=1 ./internal/adapter/delivery/ws/`
Expected: builds; ws tests pass; race-clean.

- [ ] **Step 4: Commit**
```bash
git add -A backend/ && git commit -m "refactor(backend): relocate ws delivery to adapter/delivery/ws"
```

---

### Task 3: fx tidy + layer-purity check + whole-system verify + docs

**Files:** Modify `internal/app/{providers.go,app.go}`; modify the design spec.

- [ ] **Step 1: Drop dead providers**

Remove `providePushRepo` from `providers.go` and its `fx.Provide` entry in `app.go` (it is built directly in the push block, not consumed via fx). Confirm no other unused provider remains (the assembler builds optional features directly; leaf providers config/ctx/pool/redis/minio/authrepo/authusecase/chat repos/chat usecase + the invoke are all used).

- [ ] **Step 2: Layer-purity check**

Run these and confirm the expected results (dependency rule: domain ← usecase ← adapter ← app):
```bash
cd backend
# domain must import NOTHING from this module:
grep -rn "messenger-denis/backend/internal" internal/domain --include='*.go' | grep -v _test.go
# usecase must import only domain (no adapter/app/transport/store):
grep -rn "messenger-denis/backend/internal/\(adapter\|app\|store\)" internal/usecase --include='*.go' | grep -v _test.go
```
Expected: the first prints nothing (domain is pure); the second prints nothing (usecases depend only on domain + their own ports). If anything prints, fix it (move the offending dependency behind a port).

- [ ] **Step 3: Whole suite + race + vet**

Run: `cd backend && go build ./... && go test ./... -count=1 && go test -race -count=1 ./internal/adapter/delivery/ws/ && go vet ./...`
Expected: all green; `grep -rln "internal/transport" backend` empty.

- [ ] **Step 4: Full-system docker e2e**

Bring up pg+redis+minio with VAPID keys; verify the whole surface still works identically:
- boot logs: `listening`, `session cache + realtime + presence enabled`, `media enabled`, `web push enabled`
- auth: request_code → sign_in → /me 200 → /sessions → logout → /me 401
- chat: create → send → history(count) → /sync(pts) → read → react → list reactions
- media: /media/upload (presigned) → /media/{id}
- push: /push/vapid_public_key → /push/subscribe ok
- /swagger 200, /openapi.yaml 200
(Use an isolated compose project + in-network curl for presigned MinIO, as in earlier slices.)

- [ ] **Step 5: Update the design spec**

In `docs/superpowers/specs/2026-06-24-clean-architecture-di-design.md`, set **Status: implemented** and append a short "Outcome" note: all features migrated (auth, chat/message/sync/reactions, realtime publisher+presence, media, push); delivery at `internal/adapter/delivery/{http,ws}`; `internal/store/{postgres,redisstore}` serve as the infra/db+redis layer (connection/migrations/client) while repositories live in `internal/adapter/repo/postgres`.

- [ ] **Step 6: Commit**
```bash
git add -A backend/ docs/ && git commit -m "refactor(backend): finalize Clean Architecture — fx tidy, layer-purity verified, docs"
```

---

## Self-Review Notes

- **Spec coverage:** delivery relocated to `adapter/delivery/{http,ws}` (§4); fx graph tidied (§5); layer purity asserted by grep checks (§3 dependency rule); store/* documented as the infra/db+redis layer (pragmatic deviation from a literal `infra/db` rename — same role, avoids high-churn cosmetic move); whole-system verification (§9 no behavior change).
- **No behavior change:** pure package relocation (`git mv` preserves history) + import-path updates + removal of an unused fx provider; the full suite + race + docker e2e confirm identical behavior; `contracts.md`/`openapi.yaml` unchanged.
- **Risk:** import churn only — caught immediately by `go build`/`go test`; nothing functional changes.
```
