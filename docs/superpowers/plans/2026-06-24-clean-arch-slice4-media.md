# Clean Arch Slice 4 — Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox (`- [ ]`) steps.

**Goal:** Migrate media to Clean Architecture: `domain.Media`, a `usecase/media` interactor (ports `MediaRepo` + `ObjectStorage`), a postgres `MediaRepo` adapter, and `internal/store/miniostore` relocated to `internal/adapter/storage/minio` as the `ObjectStorage` impl. Rewire the media HTTP handler + fx. Delete legacy `internal/media` and `internal/store/miniostore`. Behavior/API/suite unchanged.

**Architecture:** Slice 4. `media.Service`→`usecase/media.Interactor`; `media.Repo`→postgres adapter; `media.Storage` port → `usecase/media.ObjectStorage`; the MinIO client (which already exposes `Bucket/PresignedPut/PresignedGet/EnsureBucket`) becomes the adapter impl. The media handler keeps using the chat usecase for the access check (`CanAccessMedia`), now alongside the media usecase.

**Tech Stack:** Go, fx, minio-go, pgx, testcontainers (minio + postgres).

---

## File Structure
```
backend/
  internal/domain/media.go            — Media entity
  internal/usecase/media/
    ports.go    — MediaRepo, ObjectStorage, UploadInput, ErrTooLarge, ErrBadSize
    media.go    — Interactor: CreateUpload, GetMedia
    media_test.go — fakes
  internal/adapter/repo/postgres/mediarepo.go (+ test)
  internal/adapter/storage/minio/client.go (+ test)   — moved from internal/store/miniostore
  internal/transport/http/media_handler.go — MODIFY: *usecasemedia.Interactor
  internal/app/providers.go, server.go     — MODIFY
  DELETE: internal/media/  ·  internal/store/miniostore/
```

---

### Task 1: domain.Media + usecase/media

**Files:** Create `internal/domain/media.go`; `internal/usecase/media/{ports.go,media.go,media_test.go}`.

- [ ] **Step 1: domain.Media**

`internal/domain/media.go`:
```go
package domain

import "time"

type Media struct {
	ID          int64
	OwnerID     int64
	Bucket      string
	ObjectKey   string
	Mime        string
	Size        int64
	Width       int
	Height      int
	Duration    int
	BlurPreview []byte
	CreatedAt   time.Time
}
```

- [ ] **Step 2: usecase/media ports + interactor**

`internal/usecase/media/ports.go`:
```go
package media

import (
	"context"
	"errors"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

var (
	ErrTooLarge = errors.New("file too large")
	ErrBadSize  = errors.New("invalid size")
)

const (
	maxSize    = 100 << 20
	presignTTL = 15 * time.Minute
)

type MediaRepo interface {
	Create(ctx context.Context, m domain.Media) (domain.Media, error)
	GetByID(ctx context.Context, id int64) (domain.Media, error) // domain.ErrNotFound if absent
}

type ObjectStorage interface {
	Bucket() string
	PresignedPut(ctx context.Context, objectKey string, expiry time.Duration) (string, error)
	PresignedGet(ctx context.Context, objectKey string, expiry time.Duration) (string, error)
}

type UploadInput struct {
	OwnerID     int64
	Mime        string
	Size        int64
	Width       int
	Height      int
	Duration    int
	BlurPreview []byte
}
```
`internal/usecase/media/media.go` — `Interactor{repo MediaRepo; storage ObjectStorage}`, `New(repo, storage)`, `CreateUpload(ctx, UploadInput) (domain.Media, uploadURL string, err error)` and `GetMedia(ctx, id) (domain.Media, downloadURL string, err error)` — port from `internal/media/service.go` (size guards → ErrBadSize/ErrTooLarge; object key `ownerID/randomHex`; presigned URLs). Keep `randomKey()` helper.

- [ ] **Step 3: Unit tests (fakes)** — `media_test.go`: fake `MediaRepo` (map) + fake `ObjectStorage` (returns `http://put/<key>` / `http://get/<key>`). Port behaviors from `internal/media/service_test.go`: CreateUpload returns row+url, GetMedia returns metadata+url, oversize→ErrTooLarge, zero size→ErrBadSize.

- [ ] **Step 4: Run + commit**

Run: `cd backend && go test ./internal/usecase/media/ -v` → PASS.
```bash
git add backend/internal/domain/media.go backend/internal/usecase/media/ && git commit -m "feat(backend): domain.Media + media usecase + fakes"
```

---

### Task 2: postgres MediaRepo + minio adapter

**Files:** Create `internal/adapter/repo/postgres/mediarepo.go` (+test); create `internal/adapter/storage/minio/client.go` (+test) by moving `internal/store/miniostore`.

- [ ] **Step 1: MediaRepo (postgres)** — `package postgres`, `MediaRepo` over `*pgxpool.Pool` using `querier(ctx, pool)`, implementing `usecasemedia.MediaRepo` (Create, GetByID → `domain.Media`; `pgx.ErrNoRows`→`domain.ErrNotFound`). Port SQL from `internal/media/repo.go`. `NewMediaRepo(pool)`. Compile assertion `var _ usecasemedia.MediaRepo = (*MediaRepo)(nil)`.

- [ ] **Step 2: MediaRepo test** — testcontainers, port `internal/media/repo_test.go` (create + get + ErrNotFound). Seed an owner user inline.

- [ ] **Step 3: minio adapter** — create `internal/adapter/storage/minio/client.go` `package minio` by copying `internal/store/miniostore/client.go` VERBATIM (Client, Connect, Bucket, EnsureBucket, PresignedPut, PresignedGet) — only the package clause changes (imports `github.com/minio/minio-go/v7` stay). It satisfies `usecasemedia.ObjectStorage`. Copy `client_test.go` (testcontainers minio round-trip incl. Range 206).

- [ ] **Step 4: Run + commit**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -run Media -v && go test ./internal/adapter/storage/minio/ -v` → PASS (the minio test may flake on container startup — re-run in isolation).
```bash
git add backend/internal/adapter/repo/postgres/mediarepo.go backend/internal/adapter/repo/postgres/mediarepo_test.go backend/internal/adapter/storage/ && git commit -m "feat(backend): postgres media repo + minio object-storage adapter"
```

---

### Task 3: Rewire media handler + fx + delete legacy + verify

**Files:** Modify `transport/http/media_handler.go`, `internal/app/{providers.go,server.go}`; delete `internal/media`, `internal/store/miniostore`; fix `media_handler_test.go`.

- [ ] **Step 1: media handler** — `MediaHandler` holds `svc *usecasemedia.Interactor` + `access MediaAccess` (the existing local interface, satisfied by the chat usecase). `CreateUpload`/`Get` call the usecase; map `usecasemedia.ErrBadSize`→400, `usecasemedia.ErrTooLarge`→413, `domain.ErrNotFound`→404. `media.UploadInput`→`usecasemedia.UploadInput`; `m.BlurPreview` etc. from `domain.Media`. Responses identical.

- [ ] **Step 2: fx** — providers: `provideMediaRepo(pool) *pgadapter.MediaRepo`; the `MinioResult` now carries `*minioadapter.Client` (update `provideMinio` to `minioadapter.Connect`); `provideMediaUsecase` is built in the assembler (needs the optional storage) — in `server.go`, when `p.Minio.OK`: `mediaUC := usecasemedia.New(pgadapter.NewMediaRepo(p.Pool), p.Minio.Client)`, `mediaHandler = httptransport.NewMediaHandler(mediaUC, p.ChatUC)`. Update `MinioResult.Client` type + `provideMinio` import to the new adapter.

- [ ] **Step 3: Delete legacy + fix tests**

```bash
cd backend && rm -rf internal/media internal/store/miniostore
```
Fix `transport/http/media_handler_test.go`: its `fakeStorage` now implements `usecasemedia.ObjectStorage`; build `NewMediaHandler(usecasemedia.New(pgadapter.NewMediaRepo(pool), fakeStorage{}), newChatUC(pool))`. Replace `media.*` → `usecasemedia.*`/`domain.*`. Behavioral assertions unchanged.

- [ ] **Step 4: Whole suite + vet**

Run: `cd backend && go build ./... && go test ./... -count=1 && go vet ./...`
Expected green; `grep -rn "internal/media\b\|internal/store/miniostore" backend --include='*.go'` empty (note: `internal/usecase/media` and `internal/adapter/...` are the new homes).

- [ ] **Step 5: Docker e2e** — pg+minio stack: `/media/upload` → presigned PUT (in-network curl) → `/media/{id}` → presigned GET → body match + Range 206 (as in the original media verification). Or rely on the minio adapter round-trip test + the http media test.

- [ ] **Step 6: Commit**
```bash
git add -A backend/ && git commit -m "refactor(backend): media on Clean Architecture; delete legacy media + miniostore"
```

---

## Self-Review Notes

- **Spec coverage:** domain.Media (§3); media usecase + ports (§3); postgres media repo + minio storage adapter with `pgx.ErrNoRows`→`domain.ErrNotFound` (§3,§8); handler + fx rewired (§3,§5); legacy deleted, suite green (§6 Slice 4).
- **Behavior unchanged:** interactor is a faithful port (size guards, presign TTL, object-key scheme); MinIO client byte-identical (only package clause); presigned PUT/GET + Range preserved; contract docs untouched.
- **Layering:** media usecase depends only on its ports + domain; the minio client implements `ObjectStorage`; the postgres repo implements `MediaRepo`; the access check stays on the chat usecase via the handler's local `MediaAccess` interface.
- **Type consistency:** `domain.Media`, `usecasemedia.{Interactor,New,MediaRepo,ObjectStorage,UploadInput,ErrTooLarge,ErrBadSize}`, `pgadapter.NewMediaRepo`, `minioadapter.{Connect,Client}`, `MinioResult.Client *minioadapter.Client`, `NewMediaHandler(mediaUC, chatUC)` consistent.
```
