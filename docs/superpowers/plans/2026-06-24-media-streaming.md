# Media: backend streaming + frontend upload/render (F9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real media in chats — the backend streams media bytes (Range-capable) and accepts byte uploads; the frontend uploads photos/files, sends messages carrying `media_id`, and renders image/video/document bubbles directly from the backend.

**Architecture (decided with the user — "stream through the backend"):** Presigned URLs point at the internal `minio:9000` (unreachable from the browser), so media bytes flow **through the backend**. Two new endpoints: `PUT /media/{id}/content` (owner uploads raw bytes; Bearer auth; backend streams body → MinIO `PutObject`) and `GET /media/{id}/content` (backend streams MinIO object → client via `http.ServeContent`, native Range/206). Because browser `<img>/<video>` cannot send an `Authorization` header, the **GET content endpoint authenticates via `?token=` query** (same mechanism the WS gateway already uses) and is mounted OUTSIDE the Bearer group. The **token never leaves the worker**: `MediaManager.contentUrl(id)` (in the Core Worker) builds the full `/api/media/{id}/content?token=…` URL and hands the string to the UI, which drops it straight into `src`. Uploads go through the worker's `RestClient` (Bearer) so the token stays put.

**Deferred (documented, not in this slice):** Service Worker caching/Range proxying + LQIP-from-`media.sizes` (the backend stores a single object, not multiple sizes). `blur_preview` LQIP IS used. Streaming for video is native (ServeContent Range) — no SW needed for it.

**Tech Stack:** Go + chi + minio-go + testcontainers (backend); React 18 + TS + MUI + Vitest (frontend). Update `docs/contracts.md` + `backend/internal/openapi/openapi.yaml`.

**Repo topology:** Backend tasks (B*) run in `/Users/denisurevic/Documents/messenger-denis` (backend repo, master). Frontend tasks (F*) run in `telegram-ui-clone/` (its own git repo). Backend commits: normal `git commit` ending with the Co-Authored-By trailer. Frontend commits: `git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit`.

**Verified backend facts:**
- `internal/adapter/storage/minio/client.go`: `Client{mc *minio.Client, bucket}`; has `Bucket/EnsureBucket/PresignedPut/PresignedGet`. `minio.Object` implements `io.ReadSeekCloser` and has `Stat() (minio.ObjectInfo, error)`.
- `internal/usecase/media/{media.go,ports.go}`: `Interactor{repo,storage}`; `ObjectStorage` port; `maxSize=100MiB`, `domain.Media{OwnerID,Bucket,ObjectKey,Mime,Size,Width,Height,Duration,BlurPreview}`.
- `internal/adapter/delivery/http/media_handler.go`: `MediaHandler{svc,access}`, `MediaAccess.CanAccessMedia(ctx,userID,mediaID)`, `UserFromContext`, `pathInt`, `writeError`, `writeJSON`.
- `internal/adapter/delivery/http/router.go`: media routes mounted in the Bearer group; `Authenticator.Authenticate(ctx,token)` resolves a token (used by `AuthMiddleware` and the WS handler). The WS route `r.Get("/ws", …)` is mounted at root (no Bearer middleware) and auths via `?token=`.

---

## Backend

## Task B0: Branch

- [ ] `cd /Users/denisurevic/Documents/messenger-denis && git checkout -b media-streaming && git status`

---

## Task B1: miniostore PutObject + GetObject (streaming)

**Files:** Modify `backend/internal/adapter/storage/minio/client.go`, `backend/internal/usecase/media/ports.go`; Test `backend/internal/adapter/storage/minio/client_test.go` (extend).

- [ ] **Step 1: Extend the `ObjectStorage` port** in `ports.go` — add an `io` import, an `ObjectInfo` struct, and two methods:

```go
// ObjectInfo is the storage-level metadata needed to stream an object.
type ObjectInfo struct {
	Size        int64
	ContentType string
	ModTime     time.Time
}
```
Add to the `ObjectStorage` interface:
```go
	PutObject(ctx context.Context, objectKey string, r io.Reader, size int64, contentType string) error
	GetObject(ctx context.Context, objectKey string) (io.ReadSeekCloser, ObjectInfo, error)
```
(Add `"io"` to the import block.)

- [ ] **Step 2: Implement in `client.go`** (add `"io"` to imports):

```go
// PutObject streams up to size bytes from r into objectKey.
func (c *Client) PutObject(ctx context.Context, objectKey string, r io.Reader, size int64, contentType string) error {
	_, err := c.mc.PutObject(ctx, c.bucket, objectKey, r, size, minio.PutObjectOptions{ContentType: contentType})
	return err
}

// GetObject opens objectKey for streaming reads (the returned reader is Range/Seek
// capable) and returns its size/content-type via a Stat round-trip.
func (c *Client) GetObject(ctx context.Context, objectKey string) (io.ReadSeekCloser, mediaObjectInfo, error) {
	obj, err := c.mc.GetObject(ctx, c.bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, mediaObjectInfo{}, err
	}
	st, err := obj.Stat()
	if err != nil {
		_ = obj.Close()
		return nil, mediaObjectInfo{}, err
	}
	return obj, mediaObjectInfo{Size: st.Size, ContentType: st.ContentType, ModTime: st.LastModified}, nil
}
```
The return type must be the port's `media.ObjectInfo`. To avoid an import cycle (the adapter must not import the usecase), define the method to return the usecase type directly: import `usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"` is acceptable here (adapter→usecase is allowed), and replace `mediaObjectInfo` with `usecasemedia.ObjectInfo`. Use that import and type in the signature.

> Wait — confirm direction: in this codebase adapters implement usecase ports, so `adapter/storage/minio` importing `usecase/media` for the `ObjectInfo` type is the established pattern (the adapter already satisfies `media.ObjectStorage`). Use `usecasemedia.ObjectInfo`.

- [ ] **Step 3: Extend the round-trip test** in `client_test.go` — after the presigned round-trip, add a streaming put/get (same testcontainers MinIO; gate with the same skip/short guard the existing test uses):

```go
func TestClient_PutGetObject(t *testing.T) {
	// reuse the same container/bootstrap helper the presigned test uses;
	// if that test has a `newTestClient(t)` helper, call it. Otherwise mirror its setup.
	c := newTestClient(t) // <-- use the existing helper from this file
	ctx := context.Background()
	key := "7/streamtest"
	payload := []byte("hello media bytes")
	if err := c.PutObject(ctx, key, bytes.NewReader(payload), int64(len(payload)), "text/plain"); err != nil {
		t.Fatalf("put: %v", err)
	}
	rc, info, err := c.GetObject(ctx, key)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer rc.Close()
	if info.Size != int64(len(payload)) {
		t.Fatalf("size = %d, want %d", info.Size, len(payload))
	}
	got, _ := io.ReadAll(rc)
	if string(got) != string(payload) {
		t.Fatalf("body = %q, want %q", got, payload)
	}
}
```
(Add imports `bytes`, `io` if missing. If the existing test does NOT expose a `newTestClient(t)` helper, refactor its container bootstrap into one and use it from both tests — keep behavior identical.)

- [ ] **Step 4: Run** `cd backend && go test ./internal/adapter/storage/minio/... -run 'PutGetObject|PresignedRoundTrip' -v` — both pass (may need Docker; if the existing presigned test is skip-guarded without Docker, the new one inherits the same guard).

- [ ] **Step 5: Commit**

```bash
cd /Users/denisurevic/Documents/messenger-denis
git add backend/internal/adapter/storage/minio/client.go backend/internal/usecase/media/ports.go backend/internal/adapter/storage/minio/client_test.go
git commit -m "feat(storage): MinIO PutObject/GetObject streaming + ObjectInfo port

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B2: media usecase PutContent + GetContent

**Files:** Modify `backend/internal/usecase/media/media.go`; Test `backend/internal/usecase/media/media_test.go` (extend).

**Context:** `PutContent` loads the row, enforces owner, streams bytes to storage. `GetContent` loads the row and opens the object for streaming (access control stays in the handler). Add `ErrForbidden`.

- [ ] **Step 1: Add the failing tests** in `media_test.go`. The existing `fakeStorage` must gain `PutObject`/`GetObject`; extend it (in-memory map of key→bytes):

```go
func TestPutContent_OwnerOnly(t *testing.T) {
	repo := &fakeRepo{m: domain.Media{ID: 1, OwnerID: 7, ObjectKey: "7/x", Mime: "image/png", Size: 5}}
	st := newFakeStorage()
	s := media.New(repo, st)
	if err := s.PutContent(context.Background(), 1, 7, bytes.NewReader([]byte("12345")), 5); err != nil {
		t.Fatalf("owner put: %v", err)
	}
	if err := s.PutContent(context.Background(), 1, 99, bytes.NewReader([]byte("12345")), 5); !errors.Is(err, media.ErrForbidden) {
		t.Fatalf("non-owner = %v, want ErrForbidden", err)
	}
}

func TestGetContent(t *testing.T) {
	repo := &fakeRepo{m: domain.Media{ID: 1, OwnerID: 7, ObjectKey: "7/x", Mime: "image/png", Size: 3}}
	st := newFakeStorage()
	_ = st.PutObject(context.Background(), "7/x", bytes.NewReader([]byte("abc")), 3, "image/png")
	s := media.New(repo, st)
	rc, info, m, err := s.GetContent(context.Background(), 1)
	if err != nil { t.Fatal(err) }
	defer rc.Close()
	if m.Mime != "image/png" || info.Size != 3 { t.Fatalf("meta wrong: %+v %+v", m, info) }
	got, _ := io.ReadAll(rc)
	if string(got) != "abc" { t.Fatalf("body=%q", got) }
}
```
Provide the fakes (adapt to the existing test file's fake names; if it already has `fakeRepo`/`fakeStorage`, extend them rather than redefine):

```go
type fakeStorage struct{ blobs map[string][]byte }
func newFakeStorage() *fakeStorage { return &fakeStorage{blobs: map[string][]byte{}} }
func (f *fakeStorage) Bucket() string { return "media" }
func (f *fakeStorage) PresignedPut(_ context.Context, _ string, _ time.Duration) (string, error) { return "put://x", nil }
func (f *fakeStorage) PresignedGet(_ context.Context, _ string, _ time.Duration) (string, error) { return "get://x", nil }
func (f *fakeStorage) PutObject(_ context.Context, key string, r io.Reader, _ int64, _ string) error { b, _ := io.ReadAll(r); f.blobs[key] = b; return nil }
func (f *fakeStorage) GetObject(_ context.Context, key string) (io.ReadSeekCloser, media.ObjectInfo, error) {
	b, ok := f.blobs[key]; if !ok { return nil, media.ObjectInfo{}, domain.ErrNotFound }
	return nopSeekCloser{bytes.NewReader(b)}, media.ObjectInfo{Size: int64(len(b)), ContentType: "application/octet-stream"}, nil
}
type nopSeekCloser struct{ *bytes.Reader }
func (nopSeekCloser) Close() error { return nil }
```
(If the file already defines `fakeStorage`/`fakeRepo`, MERGE these methods into them and reuse; do not duplicate type names.)

- [ ] **Step 2: Run — expect FAIL.** `cd backend && go test ./internal/usecase/media/...`

- [ ] **Step 3: Implement** in `media.go` (add `ErrForbidden` in `ports.go`'s error block: `ErrForbidden = errors.New("forbidden")`) and `"io"` import:

```go
// PutContent streams uploaded bytes into the media object. Only the owner may upload.
func (s *Interactor) PutContent(ctx context.Context, id, ownerID int64, r io.Reader, size int64) error {
	m, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if m.OwnerID != ownerID {
		return ErrForbidden
	}
	return s.storage.PutObject(ctx, m.ObjectKey, r, size, m.Mime)
}

// GetContent opens the media object for streaming. Access control is the caller's job.
func (s *Interactor) GetContent(ctx context.Context, id int64) (io.ReadSeekCloser, ObjectInfo, domain.Media, error) {
	m, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, ObjectInfo{}, domain.Media{}, err
	}
	rc, info, err := s.storage.GetObject(ctx, m.ObjectKey)
	if err != nil {
		return nil, ObjectInfo{}, domain.Media{}, err
	}
	if info.ContentType == "" || info.ContentType == "application/octet-stream" {
		info.ContentType = m.Mime // prefer the declared mime
	}
	return rc, info, m, nil
}
```

- [ ] **Step 4: Run — expect PASS.** `cd backend && go test ./internal/usecase/media/...`

- [ ] **Step 5: Commit**

```bash
cd /Users/denisurevic/Documents/messenger-denis
git add backend/internal/usecase/media/
git commit -m "feat(media): PutContent (owner) + GetContent streaming usecase

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B3: HTTP content endpoints + routes + docs

**Files:** Modify `backend/internal/adapter/delivery/http/media_handler.go`, `router.go`, `backend/internal/app/{providers.go,server.go}` (wire `auth` into `MediaHandler` if needed); `docs/contracts.md`; `backend/internal/openapi/openapi.yaml`. Test `media_handler_test.go` (extend).

**Context:** `PUT /media/{mediaID}/content` stays in the Bearer group (owner uploads). `GET /media/{mediaID}/content` is mounted at root and auths via `?token=` (reuse the WS pattern) then access-checks via `CanAccessMedia` and streams with `http.ServeContent`.

- [ ] **Step 1: Give `MediaHandler` an `Authenticator`** — in `media_handler.go` add the field + interface (mirror the WS `Authenticator`) and extend the constructor:

```go
type Authenticator interface {
	Authenticate(ctx context.Context, token string) (domain.User, int64, error)
}
```
Change `MediaHandler` to `{ svc; access; auth Authenticator }` and `NewMediaHandler(svc, access, auth)`.

- [ ] **Step 2: Add the two handlers** (`media_handler.go`, add imports `io`):

```go
const maxUpload = 100 << 20 // 100 MiB, mirrors usecase maxSize

func (h *MediaHandler) PutContent(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	id, ok := pathInt(w, r, "mediaID")
	if !ok {
		return
	}
	body := http.MaxBytesReader(w, r.Body, maxUpload)
	defer body.Close()
	err := h.svc.PutContent(r.Context(), id, user.ID, body, r.ContentLength)
	if errors.Is(err, usecasemedia.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not your media")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "media not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "upload failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetContent streams the bytes. Browser <img>/<video> can't send headers, so this
// route authenticates via ?token= (like /ws) and is mounted outside the Bearer group.
func (h *MediaHandler) GetContent(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	user, _, err := h.auth.Authenticate(r.Context(), token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	id, ok := pathInt(w, r, "mediaID")
	if !ok {
		return
	}
	allowed, err := h.access.CanAccessMedia(r.Context(), user.ID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load media")
		return
	}
	if !allowed {
		writeError(w, http.StatusNotFound, "media not found")
		return
	}
	rc, info, _, err := h.svc.GetContent(r.Context(), id)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "media not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load media")
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", info.ContentType)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, "", info.ModTime, rc) // handles Range/206
}
```

- [ ] **Step 3: Wire routes** in `router.go`. Inside `if mediaH != nil {` in the Bearer group, add the PUT:
```go
			pr.Put("/media/{mediaID}/content", mediaH.PutContent)
```
Outside the Bearer group (next to `r.Get("/ws", …)`), add the token-authed GET — guard on `mediaH != nil`:
```go
	if mediaH != nil {
		r.Get("/media/{mediaID}/content", mediaH.GetContent)
	}
```

- [ ] **Step 4: Pass `authUC` into `NewMediaHandler`** — update the construction site (in `app/providers.go` or `server.go` where `NewMediaHandler(svc, access)` is called) to `NewMediaHandler(svc, access, authUC)`. Find it: `grep -rn "NewMediaHandler" backend/internal`.

- [ ] **Step 5: Handler test** (`media_handler_test.go`) — add a fake `auth` + fake `svc` path. Since `svc` is a concrete `*usecasemedia.Interactor`, drive `GetContent` through a fake `ObjectStorage`+`MediaRepo` (as in B2). Add:
  - GET content with a valid `?token=` for a shared chat → 200 + body.
  - GET content with no token → 401.
  - GET content when `CanAccessMedia` returns false → 404.
  - PUT content by non-owner → 403.

  (Use the existing test's construction helpers; build the `Interactor` with the B2 fakes and a fake `MediaAccess`/`Authenticator`.) Provide a fake authenticator returning a fixed user for token `"good"`, error otherwise.

- [ ] **Step 6: Update docs** — `docs/contracts.md` (Media section): document `PUT /media/{chatID?}` … specifically:
  - `PUT /media/{mediaID}/content` · auth (Bearer, owner) — raw body, `Content-Type` = mime; `204` on success; `403` if not owner.
  - `GET /media/{mediaID}/content?token=<session-token>` · token-query auth — streams bytes, supports HTTP Range (206); `404` if no access. Note: browser media elements use this directly; the worker builds the URL.
  Mirror both in `backend/internal/openapi/openapi.yaml` (paths + security note for the query token).

- [ ] **Step 7: Run** `cd backend && go build ./... && go test ./internal/adapter/delivery/http/... ./internal/usecase/media/...` — build clean, tests pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/denisurevic/Documents/messenger-denis
git add backend/ docs/contracts.md
git commit -m "feat(http): PUT/GET /media/{id}/content streaming (Range, ?token= for GET)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 9: Merge backend branch**

```bash
cd /Users/denisurevic/Documents/messenger-denis
go test ./... 2>&1 | tail -20   # full suite green (media + http)
git checkout master && git merge --no-ff media-streaming -m "Merge media-streaming: byte streaming endpoints for media (F9 backend)"
```

---

## Frontend

## Task F0: Branch + rebuild backend image

- [ ] `cd telegram-ui-clone && git checkout master && git checkout -b frontend-slice5-media`
- [ ] Rebuild the verify backend so it has the new endpoints: `cd /Users/denisurevic/Documents/messenger-denis && docker compose -p msgrverify -f docker-compose.verify.yml up -d --build backend && curl -s -o/dev/null -w "%{http_code}\n" http://localhost:38080/api/health` (expect 200).

---

## Task F1: RestClient.putBytes

**Files:** Modify `src/core/net/restClient.ts`; Test `src/core/net/restClient.test.ts` (extend).

- [ ] **Step 1: Add a failing test** (extend the existing describe; stub `fetch`):

```ts
  it('putBytes PUTs a raw body with the content-type and bearer', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(null, { status: 204 }) }))
    const c = new RestClient('/api', () => 'tok')
    await c.putBytes('/media/5/content', new Uint8Array([1, 2, 3]).buffer, 'image/png')
    expect(calls[0].url).toBe('/api/media/5/content')
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('image/png')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(calls[0].init.method).toBe('PUT')
  })
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — add to `RestClient`:

```ts
  async putBytes(path: string, body: ArrayBuffer, contentType: string): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': contentType }
    const tok = this.getToken()
    if (tok) headers.Authorization = `Bearer ${tok}`
    const res = await fetch(this.base + path, { method: 'PUT', headers, body })
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`)
  }

  // Build a same-origin, token-carrying URL for browser media elements (img/video).
  contentUrl(path: string): string {
    const tok = this.getToken()
    return this.base + path + (tok ? `?token=${encodeURIComponent(tok)}` : '')
  }
```

- [ ] **Step 4: Run — expect PASS.** `cd telegram-ui-clone && npx vitest run src/core/net/restClient.test.ts`

- [ ] **Step 5: Commit**

```bash
cd telegram-ui-clone && git add src/core/net/restClient.ts src/core/net/restClient.test.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(net): RestClient.putBytes + contentUrl (token query)"
```

---

## Task F2: MediaManager + worker registration

**Files:** Create `src/core/managers/mediaManager.ts` + `.test.ts`; Modify `src/core/worker.ts`, `src/client/bootstrap.ts`.

**Context:** `upload({bytes,mime,size,width,height})` → `POST /media/upload` (metadata) → `PUT /media/{id}/content` (bytes) → returns `media_id`. `meta(id)` → `GET /media/{id}` (cached). `contentUrl(id)` → builds the token URL via `rest.contentUrl`.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/managers/mediaManager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { newMediaManager } from './mediaManager'

function fakeRest() {
  return {
    post: vi.fn(async () => ({ media_id: 42 })),
    get: vi.fn(async () => ({ id: 42, mime: 'image/png', size: 3, width: 10, height: 8, duration: 0, blur_preview: '' })),
    putBytes: vi.fn(async () => {}),
    contentUrl: (p: string) => '/api' + p + '?token=tok',
  } as never
}

describe('MediaManager', () => {
  it('upload registers metadata then PUTs bytes, returns media_id', async () => {
    const rest = fakeRest()
    const mgr = newMediaManager({ rest })
    const id = await mgr.upload({ bytes: new Uint8Array([1, 2, 3]).buffer, mime: 'image/png', size: 3, width: 10, height: 8 })
    expect(id).toBe(42)
    expect((rest as never as { post: ReturnType<typeof vi.fn> }).post).toHaveBeenCalled()
    expect((rest as never as { putBytes: ReturnType<typeof vi.fn> }).putBytes).toHaveBeenCalledWith('/media/42/content', expect.anything(), 'image/png')
  })

  it('meta maps + caches (one GET for two calls)', async () => {
    const rest = fakeRest()
    const mgr = newMediaManager({ rest })
    const m1 = await mgr.meta(42)
    const m2 = await mgr.meta(42)
    expect(m1.mime).toBe('image/png'); expect(m1.width).toBe(10)
    expect(m2).toEqual(m1)
    expect((rest as never as { get: ReturnType<typeof vi.fn> }).get).toHaveBeenCalledTimes(1)
  })

  it('contentUrl delegates to rest.contentUrl', () => {
    const mgr = newMediaManager({ rest: fakeRest() })
    expect(mgr.contentUrl(42)).toBe('/api/media/42/content?token=tok')
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// src/core/managers/mediaManager.ts
import type { RestClient } from '../net/restClient'

export interface UploadArgs { bytes: ArrayBuffer; mime: string; size: number; width?: number; height?: number; duration?: number }
export interface MediaMeta { id: number; mime: string; size: number; width: number; height: number; duration: number; blurPreview: string }

interface RestLike {
  post: RestClient['post']
  get: RestClient['get']
  putBytes: RestClient['putBytes']
  contentUrl: RestClient['contentUrl']
}

export function newMediaManager({ rest }: { rest: RestLike }) {
  const metaCache = new Map<number, MediaMeta>()
  return {
    async upload(a: UploadArgs): Promise<number> {
      const r = await rest.post<{ media_id: number }>('/media/upload', {
        mime: a.mime, size: a.size, width: a.width ?? 0, height: a.height ?? 0, duration: a.duration ?? 0,
      })
      await rest.putBytes(`/media/${r.media_id}/content`, a.bytes, a.mime)
      return r.media_id
    },
    async meta(id: number): Promise<MediaMeta> {
      const hit = metaCache.get(id)
      if (hit) return hit
      const r = await rest.get<{ id: number; mime: string; size: number; width: number; height: number; duration: number; blur_preview: string }>(`/media/${id}`)
      const m: MediaMeta = { id: r.id, mime: r.mime, size: r.size, width: r.width, height: r.height, duration: r.duration, blurPreview: r.blur_preview ?? '' }
      metaCache.set(id, m)
      return m
    },
    contentUrl(id: number): string {
      return rest.contentUrl(`/media/${id}/content`)
    },
  }
}

export type MediaManager = ReturnType<typeof newMediaManager>
```

- [ ] **Step 4: Register in the worker** — `src/core/worker.ts`: `import { newMediaManager } from './managers/mediaManager'`; `const media = newMediaManager({ rest })`; add to the `registerManagers` registry: `media: media as unknown as Record<string, (...a: unknown[]) => unknown>,`.

- [ ] **Step 5: Extend `Managers`** in `bootstrap.ts`:
```ts
import type { UploadArgs, MediaMeta } from '../core/managers/mediaManager'
```
```ts
  media: {
    upload(a: UploadArgs): Promise<number>
    meta(id: number): Promise<MediaMeta>
    contentUrl(id: number): Promise<string>
  }
```
> Note: RPC methods are async over the port, so `contentUrl` becomes `Promise<string>` on the UI side even though the worker impl is sync — the proxy wraps it. Callers `await managers.media.contentUrl(id)`.

- [ ] **Step 6: Run** `cd telegram-ui-clone && npx vitest run src/core/managers/mediaManager.test.ts && npx tsc -b` — green + clean.

- [ ] **Step 7: Commit**

```bash
cd telegram-ui-clone && git add src/core/managers/mediaManager.ts src/core/managers/mediaManager.test.ts src/core/worker.ts src/client/bootstrap.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(worker): MediaManager (upload bytes + meta + contentUrl)"
```

---

## Task F3: messageToConvMsg carries mediaId

**Files:** Modify `src/data.ts` (add `mediaId?` to `ConvMsg`), `src/core/messageToConvMsg.ts`; Test `src/core/messageToConvMsg.test.ts` (extend).

- [ ] **Step 1: Add the failing test**

```ts
  it('carries mediaId when the message has media', () => {
    const c = messageToConvMsg({ ...base, mediaId: 42, text: '' }, 7)
    expect(c.mediaId).toBe(42)
  })
```

- [ ] **Step 2: Run — expect FAIL** (`mediaId` not on ConvMsg / not mapped).

- [ ] **Step 3: Implement** — in `src/data.ts` add to the `ConvMsg` interface: `mediaId?: number`. In `messageToConvMsg.ts` set it:
```ts
  return {
    type: 'text',
    out,
    text: m.text,
    time: m.createdAt,
    status: out ? 'sent' : undefined,
    mediaId: m.mediaId ?? undefined,
  }
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
cd telegram-ui-clone && git add src/data.ts src/core/messageToConvMsg.ts src/core/messageToConvMsg.test.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(chats): ConvMsg.mediaId + map it in messageToConvMsg"
```

---

## Task F4: RealMediaBubble + render in ConversationView

**Files:** Create `src/components/messages/RealMediaBubble.tsx`; Modify `src/components/ConversationView.tsx`.

**Context:** Given a `mediaId`, fetch `meta`, then render: `image/*` → `<img>` with `blurPreview` LQIP background; `video/*` → `<video controls preload="metadata">` (native Range via the token URL); else → a document row (filename/size + download link). The content URL is resolved via `managers.media.contentUrl(id)`.

- [ ] **Step 1: Implement the component**

```tsx
// src/components/messages/RealMediaBubble.tsx
import { useEffect, useState } from 'react'
import { Box, Typography } from '@mui/material'
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined'
import { startClient } from '../../client/bootstrap'
import type { MediaMeta } from '../../core/managers/mediaManager'

export default function RealMediaBubble({ mediaId, out }: { mediaId: number; out: boolean }) {
  const [meta, setMeta] = useState<MediaMeta | null>(null)
  const [url, setUrl] = useState<string>('')

  useEffect(() => {
    let alive = true
    const { managers } = startClient()
    Promise.all([managers.media.meta(mediaId), managers.media.contentUrl(mediaId)]).then(([m, u]) => {
      if (alive) { setMeta(m); setUrl(u) }
    })
    return () => { alive = false }
  }, [mediaId])

  if (!meta || !url) {
    return <Box sx={{ width: 220, height: 160, borderRadius: '14px', background: 'rgba(0,0,0,0.18)' }} />
  }

  const lqip = meta.blurPreview ? `url("data:image/jpeg;base64,${meta.blurPreview}")` : undefined

  if (meta.mime.startsWith('image/')) {
    return (
      <Box sx={{ maxWidth: 320, borderRadius: '14px', overflow: 'hidden', backgroundImage: lqip, backgroundSize: 'cover' }}>
        <img src={url} alt="" style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 14 }} />
      </Box>
    )
  }
  if (meta.mime.startsWith('video/')) {
    return (
      <Box sx={{ maxWidth: 320, borderRadius: '14px', overflow: 'hidden' }}>
        <video src={url} controls preload="metadata" style={{ display: 'block', width: '100%', borderRadius: 14 }} />
      </Box>
    )
  }
  return (
    <Box component="a" href={url} download sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.25, py: 1, textDecoration: 'none', color: out ? '#fff' : 'inherit' }}>
      <Box sx={{ width: 44, height: 44, borderRadius: '50%', background: out ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <InsertDriveFileOutlined />
      </Box>
      <Box>
        <Typography sx={{ fontSize: 14.5, fontWeight: 600 }}>{`media-${mediaId}`}</Typography>
        <Typography sx={{ fontSize: 12.5, opacity: 0.7 }}>{`${Math.max(1, Math.round(meta.size / 1024))} KB`}</Typography>
      </Box>
    </Box>
  )
}
```

- [ ] **Step 2: Render it in `ConversationView`** — import it, and in the per-message render IIFE, before the existing `m.type === 'sticker' ...` branch, special-case media:

Add the import: `import RealMediaBubble from './messages/RealMediaBubble'`.

In the `row` JSX, change the first conditional so a media message renders the bubble. Find where the bubble content begins (the `m.type === 'sticker' || bigEmoji ? (...) : ...` chain) and wrap with a leading check:
```tsx
                  {m.mediaId ? (
                    <Box sx={{ position: 'relative', background: out ? tg.accent : incomingBg, borderRadius: '15px', overflow: 'hidden', maxWidth: 'min(340px, 82%)' }}>
                      <RealMediaBubble mediaId={m.mediaId} out={out} />
                      {m.text ? (
                        <Typography sx={{ px: 1.25, py: 0.5, fontSize: textSize, color: out ? '#fff' : tg.textPrimary }}>{m.text}</Typography>
                      ) : null}
                    </Box>
                  ) : m.type === 'sticker' || bigEmoji ? (
```
(Keep the rest of the existing chain intact; this just adds the leading `m.mediaId ?` branch.)

- [ ] **Step 3: Typecheck + build** `cd telegram-ui-clone && npx tsc -b && npx vitest run && npx vite build --outDir /tmp/tg-build-check --emptyOutDir` — clean/green/OK.

- [ ] **Step 4: Commit**

```bash
cd telegram-ui-clone && git add src/components/messages/RealMediaBubble.tsx src/components/ConversationView.tsx
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(chat): render real media bubbles (image/video/document + LQIP)"
```

---

## Task F5: Attach → upload → send media

**Files:** Modify `src/components/ConversationView.tsx`, `src/core/hooks/useMessageWindow.ts`.

**Context:** A hidden `<input type="file">` triggered from the attach button; on pick, read the file to an ArrayBuffer (+ image dimensions), `managers.media.upload(...)`, then `managers.realtime.sendMessage({chatId, text:'', clientMsgId, mediaId})`. Optimistic append shows the media immediately.

- [ ] **Step 1: Extend `useMessageWindow.appendOptimistic`** to accept an optional `mediaId`:

Change the signature in the interface and impl:
```ts
  appendOptimistic: (text: string, meId: number, clientMsgId: string, mediaId?: number) => void
```
In the impl, set `mediaId: mediaId ?? null` on the temp `Message` (Message already has `mediaId: number | null`). (No test change strictly required; optionally extend the existing optimistic test to pass a mediaId and assert `msgs.at(-1)?.mediaId`.)

- [ ] **Step 2: Wire the file input in `ConversationView`** — add a ref + handler near the other refs/handlers:

```ts
  const fileInputRef = useRef<HTMLInputElement>(null)

  const readImageSize = (file: File): Promise<{ width: number; height: number }> =>
    new Promise((resolve) => {
      if (!file.type.startsWith('image/')) return resolve({ width: 0, height: 0 })
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url) }
      img.onerror = () => { resolve({ width: 0, height: 0 }); URL.revokeObjectURL(url) }
      img.src = url
    })

  const onPickFile = async (file: File) => {
    if (!isRealChat) return
    const bytes = await file.arrayBuffer()
    const { width, height } = await readImageSize(file)
    const mediaId = await managers.media.upload({ bytes, mime: file.type || 'application/octet-stream', size: file.size, width, height })
    const clientMsgId = `c-${chat.id}-${performance.now()}-${Math.random().toString(36).slice(2)}`
    win.appendOptimistic('', meId ?? -1, clientMsgId, mediaId)
    void managers.realtime.sendMessage({ chatId: numericChatId, text: '', clientMsgId, mediaId })
    requestAnimationFrame(() => { const el = scrollRef.current; if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight }) })
  }
```

- [ ] **Step 3: Render the hidden input + open it from the attach button** — add once in the composer JSX:
```tsx
        <input ref={fileInputRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickFile(f); e.currentTarget.value = '' }} />
```
The attach button currently sets `attachAnchor` (opens AttachMenu). Simplest wiring: make the attach `IconButton`'s onClick ALSO open the file picker for real chats — change its onClick to `() => { if (isRealChat) fileInputRef.current?.click(); else setAttachAnchor(...) }`. (Keep the mock AttachMenu for non-real chats.) Find the attach `IconButton` (with `AttachFileRounded`) and adjust its onClick accordingly, preserving the existing anchor behavior for mock chats.

- [ ] **Step 4: Incoming media** — already handled: `RT.newMessage` → `applyIncoming(mapMessage(...))` includes `media_id`; ensure the incoming-new_message effect's `mapMessage({... media_id: m.media_id ...})` passes media_id (it does). messageToConvMsg now carries `mediaId`, so the bubble renders. No change needed beyond confirming.

- [ ] **Step 5: Typecheck + tests + build** — `cd telegram-ui-clone && npx tsc -b && npx vitest run && npx vite build --outDir /tmp/tg-build-check --emptyOutDir`.

- [ ] **Step 6: Commit**

```bash
cd telegram-ui-clone && git add src/components/ConversationView.tsx src/core/hooks/useMessageWindow.ts src/core/hooks/useMessageWindow.test.ts
git -c user.name="messenger-denis" -c user.email="d.maramygin@documentolog.com" commit -m "feat(chat): attach -> upload -> send media (optimistic)"
```

---

## Task F6: Live verification + memory + finish

- [ ] **Step 1: Rebuild + redeploy** (backend already rebuilt in F0; rebuild client + nginx):
```bash
cd telegram-ui-clone && npx vite build --base=/ --outDir ../client-build --emptyOutDir
cd /Users/denisurevic/Documents/messenger-denis && xattr -cr client-build 2>/dev/null
docker compose -p msgrverify -f docker-compose.verify.yml up -d --build nginx
curl -s -o /dev/null -w "SPA %{http_code}\n" http://localhost:38080/
```

- [ ] **Step 2: Browser verification (playwright MCP)** — log in as `+79990000001`, open the chat, click attach → pick a local image file, and assert: it uploads, the message appears with the image rendered (the `<img>` `src` is `/api/media/{id}/content?token=…` and returns 200), persists after reload, and a second tab/user sees it live. Confirm a `GET /media/{id}/content` returns `200` (image) and that a `Range` request returns `206` (use `curl -H 'Range: bytes=0-10' "http://localhost:38080/api/media/{id}/content?token=…"` → `206`). 0 console errors. Screenshot.

  > To get a token for the curl Range check: `request_code`+`sign_in` for `+79990000001` and use that token in `?token=`.

- [ ] **Step 3: Update memory** — `memory/messenger-project.md`: FE-5/F9 done — backend `PUT/GET /media/{id}/content` (Range via ServeContent, GET auths by `?token=` like WS, access-checked), `MediaManager` (upload bytes + meta + contentUrl), `RealMediaBubble` (image/video/document + LQIP), attach→upload→send. Note: token-in-URL for GET content (worker builds it; same tradeoff as WS); video streams natively (Range), images direct; Service Worker caching + multi-size LQIP deferred.

- [ ] **Step 4: Finish the frontend branch** — verify `npx vitest run && npx tsc -b` green, then merge `frontend-slice5-media` → `master`:
```bash
cd telegram-ui-clone && npx vitest run && npx tsc -b
git checkout master && git merge --no-ff frontend-slice5-media -m "Merge frontend-slice5: media upload/send/render (F9 frontend)"
```

---

## Self-Review (author checklist — completed)

- **Delivery decision honored:** bytes stream through the backend; GET content auths via `?token=` (browser media elements can't set headers); worker builds the URL so the token stays in IndexedDB. ✓
- **Backend layering:** storage adapter gains `PutObject`/`GetObject` (returns `io.ReadSeekCloser` + `media.ObjectInfo`); usecase `PutContent`/`GetContent` stay infra-free; handler does Range via `http.ServeContent` + access control. ✓
- **Range/streaming:** `http.ServeContent` over `minio.Object` (io.ReadSeeker) yields 206 natively; verified by a curl Range check in F6. ✓
- **Type consistency:** `MediaMeta`/`UploadArgs` shared worker↔UI; `ConvMsg.mediaId`; `Message.mediaId` already exists; RPC `contentUrl` is async on the UI side (documented). ✓
- **Contracts:** new endpoints added to `docs/contracts.md` + `openapi.yaml` (B3). ✓
- **No placeholders:** complete code per step; the B1/B2 test fakes say to MERGE into existing fakes (don't duplicate type names). ✓
- **Out of scope (documented):** Service Worker cache/Range-proxy, multi-size responsive images, image compression/thumbnail generation client-side, audio/voice upload UI, drag-and-drop. ✓
