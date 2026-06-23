# Backend Plan D1 — Media (MinIO) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let clients upload and download media (photos, videos, files, voice) through MinIO using presigned URLs (so bytes never pass through the backend), and attach media to messages. Downloads support HTTP Range natively (MinIO/S3), enabling streaming in the frontend Service Worker.

**Architecture:** A `media` table records each object's metadata + owner. `internal/store/miniostore` wraps the MinIO Go SDK (ensure bucket, presigned PUT/GET). A `media.Service` creates a media row + a presigned PUT URL (client uploads directly to MinIO), and resolves a media id to metadata + a presigned GET URL. Messages gain a nullable `media_id`; `Send` validates the media belongs to the sender and the message JSON carries `media_id` (the client resolves details via `GET /media/{id}`). Tested with the testcontainers MinIO module (real presigned PUT/GET round-trip) + testcontainers Postgres.

**Tech Stack:** Go, **github.com/minio/minio-go/v7**, chi/v5, pgx/v5, testcontainers-go (+ minio module).

Implements spec §6 (media table, messages.media_id), §11 (presigned media flow, HTTP Range). Web Push is Plan D2. Server-side preview/transcode (multiple `sizes`, video thumbnails) is a later phase; D1 stores a client-supplied `blur_preview` (LQIP) and basic dimensions.

---

## File Structure

```
backend/
  internal/config/config.go        — MODIFY: MinIO settings (+test)
  internal/store/postgres/migrations/0004_media.sql — media table + messages.media_id
  internal/store/miniostore/
    client.go        — Connect, EnsureBucket, PresignedPut, PresignedGet
    client_test.go   — testcontainers MinIO round-trip
  internal/media/
    repo.go          — Media type, Create, GetByID
    repo_test.go
    service.go       — Service: CreateUpload, GetMedia
    service_test.go
  internal/messaging/
    messages_repo.go — MODIFY: Message.MediaID + media_id in SELECT/INSERT/scan
    message_service.go — MODIFY: SendInput.MediaID, validate owner, store
    message_service_test.go — MODIFY: send-with-media test
  internal/transport/http/
    media_handler.go — POST /media/upload, GET /media/{id}
    media_handler_test.go
    router.go        — MODIFY: mount media routes (nil-safe if MinIO down)
  cmd/server/main.go — MODIFY: connect MinIO, build media service + handler
```

---

### Task 1: Config + migration + media repo

**Files:**
- Modify: `backend/internal/config/config.go`
- Modify: `backend/internal/config/config_test.go`
- Create: `backend/internal/store/postgres/migrations/0004_media.sql`
- Create: `backend/internal/media/repo.go`
- Create: `backend/internal/media/repo_test.go`

- [ ] **Step 1: Add MinIO settings to config**

In `backend/internal/config/config.go`, add fields to `Config` and populate them in `Load` (all with defaults, so the server runs without MinIO configured):
```go
	MinioEndpoint  string
	MinioAccessKey string
	MinioSecretKey string
	MinioBucket    string
	MinioUseSSL    bool
```
In `Load`, after the existing fields:
```go
	c.MinioEndpoint = getenv("MINIO_ENDPOINT", "localhost:9000")
	c.MinioAccessKey = getenv("MINIO_ACCESS_KEY", "minioadmin")
	c.MinioSecretKey = getenv("MINIO_SECRET_KEY", "minioadmin")
	c.MinioBucket = getenv("MINIO_BUCKET", "media")
	c.MinioUseSSL = getenv("MINIO_USE_SSL", "false") == "true"
```

- [ ] **Step 2: Add a config test for the MinIO defaults**

Append to `backend/internal/config/config_test.go`:
```go
func TestLoad_MinioDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	c, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.MinioEndpoint != "localhost:9000" || c.MinioBucket != "media" {
		t.Errorf("minio defaults wrong: %+v", c)
	}
	if c.MinioUseSSL {
		t.Error("MinioUseSSL should default to false")
	}
}
```

- [ ] **Step 3: Write the migration**

Create `backend/internal/store/postgres/migrations/0004_media.sql`:
```sql
-- +goose Up
CREATE TABLE media (
  id           BIGSERIAL PRIMARY KEY,
  owner_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bucket       TEXT NOT NULL,
  object_key   TEXT NOT NULL,
  mime         TEXT NOT NULL DEFAULT '',
  size         BIGINT NOT NULL DEFAULT 0,
  width        INT NOT NULL DEFAULT 0,
  height       INT NOT NULL DEFAULT 0,
  duration     INT NOT NULL DEFAULT 0,
  blur_preview BYTEA,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE messages ADD COLUMN media_id BIGINT REFERENCES media(id);

-- +goose Down
ALTER TABLE messages DROP COLUMN media_id;
DROP TABLE media;
```

- [ ] **Step 4: Write the media repo**

Create `backend/internal/media/repo.go`:
```go
// Package media stores media metadata and brokers presigned MinIO URLs.
package media

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("not found")

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

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

func (r *Repo) Create(ctx context.Context, m Media) (Media, error) {
	err := r.pool.QueryRow(ctx,
		`INSERT INTO media (owner_id, bucket, object_key, mime, size, width, height, duration, blur_preview)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 RETURNING id, created_at`,
		m.OwnerID, m.Bucket, m.ObjectKey, m.Mime, m.Size, m.Width, m.Height, m.Duration, m.BlurPreview,
	).Scan(&m.ID, &m.CreatedAt)
	return m, err
}

func (r *Repo) GetByID(ctx context.Context, id int64) (Media, error) {
	var m Media
	err := r.pool.QueryRow(ctx,
		`SELECT id, owner_id, bucket, object_key, mime, size, width, height, duration, blur_preview, created_at
		 FROM media WHERE id=$1`, id).Scan(
		&m.ID, &m.OwnerID, &m.Bucket, &m.ObjectKey, &m.Mime, &m.Size,
		&m.Width, &m.Height, &m.Duration, &m.BlurPreview, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Media{}, ErrNotFound
	}
	return m, err
}
```

- [ ] **Step 5: Write the repo test**

Create `backend/internal/media/repo_test.go`:
```go
package media

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func seedUser(t *testing.T, repo *Repo, phone string) int64 {
	t.Helper()
	var id int64
	err := repo.pool.QueryRow(context.Background(),
		`INSERT INTO users (phone, display_name) VALUES ($1,$1) RETURNING id`, phone).Scan(&id)
	if err != nil {
		t.Fatalf("seedUser: %v", err)
	}
	return id
}

func TestRepo_CreateAndGet(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, repo, "+700")

	m, err := repo.Create(ctx, Media{
		OwnerID: owner, Bucket: "media", ObjectKey: "k1", Mime: "image/jpeg",
		Size: 1024, Width: 800, Height: 600, BlurPreview: []byte{1, 2, 3},
	})
	if err != nil || m.ID == 0 {
		t.Fatalf("Create = %+v, %v", m, err)
	}
	got, err := repo.GetByID(ctx, m.ID)
	if err != nil || got.ObjectKey != "k1" || got.Width != 800 || len(got.BlurPreview) != 3 {
		t.Fatalf("GetByID = %+v, %v", got, err)
	}
	if _, err := repo.GetByID(ctx, 999999); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/config/ -run MinioDefaults -v && go test ./internal/media/ -run Repo -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/config/ backend/internal/store/postgres/migrations/0004_media.sql backend/internal/media/repo.go backend/internal/media/repo_test.go
git commit -m "feat(backend): media table + repo + MinIO config"
```

---

### Task 2: MinIO client wrapper

**Files:**
- Create: `backend/internal/store/miniostore/client.go`
- Create: `backend/internal/store/miniostore/client_test.go`

- [ ] **Step 1: Add dependencies**

Run:
```bash
cd backend && go get github.com/minio/minio-go/v7@latest github.com/testcontainers/testcontainers-go/modules/minio@latest
```
Expected: dependencies added.

- [ ] **Step 2: Write the client**

Create `backend/internal/store/miniostore/client.go`:
```go
// Package miniostore wraps the MinIO SDK: bucket setup and presigned URLs.
package miniostore

import (
	"context"
	"net/url"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type Client struct {
	mc     *minio.Client
	bucket string
}

// Connect dials MinIO and returns a client bound to a bucket.
func Connect(endpoint, accessKey, secretKey, bucket string, useSSL bool) (*Client, error) {
	mc, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, err
	}
	return &Client{mc: mc, bucket: bucket}, nil
}

func (c *Client) Bucket() string { return c.bucket }

// EnsureBucket creates the bucket if it does not already exist.
func (c *Client) EnsureBucket(ctx context.Context) error {
	exists, err := c.mc.BucketExists(ctx, c.bucket)
	if err != nil {
		return err
	}
	if !exists {
		return c.mc.MakeBucket(ctx, c.bucket, minio.MakeBucketOptions{})
	}
	return nil
}

// PresignedPut returns a URL the client can PUT bytes to directly.
func (c *Client) PresignedPut(ctx context.Context, objectKey string, expiry time.Duration) (string, error) {
	u, err := c.mc.PresignedPutObject(ctx, c.bucket, objectKey, expiry)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

// PresignedGet returns a URL the client can GET (Range-capable) directly.
func (c *Client) PresignedGet(ctx context.Context, objectKey string, expiry time.Duration) (string, error) {
	u, err := c.mc.PresignedGetObject(ctx, c.bucket, objectKey, expiry, url.Values{})
	if err != nil {
		return "", err
	}
	return u.String(), nil
}
```

- [ ] **Step 3: Write the testcontainers round-trip test**

Create `backend/internal/store/miniostore/client_test.go`:
```go
package miniostore

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"testing"
	"time"

	tcminio "github.com/testcontainers/testcontainers-go/modules/minio"
)

func TestClient_PresignedRoundTrip(t *testing.T) {
	ctx := context.Background()
	container, err := tcminio.Run(ctx, "minio/minio:latest")
	if err != nil {
		t.Skipf("cannot start minio container (is Docker running?): %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(ctx) })

	endpoint, err := container.ConnectionString(ctx)
	if err != nil {
		t.Fatalf("connstr: %v", err)
	}
	c, err := Connect(endpoint, container.Username, container.Password, "media", false)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := c.EnsureBucket(ctx); err != nil {
		t.Fatalf("ensure bucket: %v", err)
	}

	// Upload via presigned PUT.
	putURL, err := c.PresignedPut(ctx, "obj1", time.Minute)
	if err != nil {
		t.Fatalf("presign put: %v", err)
	}
	body := []byte("hello media")
	req, _ := http.NewRequest(http.MethodPut, putURL, bytes.NewReader(body))
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("put upload: %v status=%v", err, resp.StatusCode)
	}
	resp.Body.Close()

	// Download via presigned GET.
	getURL, err := c.PresignedGet(ctx, "obj1", time.Minute)
	if err != nil {
		t.Fatalf("presign get: %v", err)
	}
	resp, err = http.Get(getURL)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("get download: %v status=%v", err, resp.StatusCode)
	}
	defer resp.Body.Close()
	got, _ := io.ReadAll(resp.Body)
	if !bytes.Equal(got, body) {
		t.Fatalf("round-trip mismatch: %q", got)
	}

	// Range request returns 206 Partial Content.
	rreq, _ := http.NewRequest(http.MethodGet, getURL, nil)
	rreq.Header.Set("Range", "bytes=0-4")
	rresp, err := http.DefaultClient.Do(rreq)
	if err != nil || rresp.StatusCode != http.StatusPartialContent {
		t.Fatalf("range request: %v status=%v", err, rresp.StatusCode)
	}
	rresp.Body.Close()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && go test ./internal/store/miniostore/ -v`
Expected: PASS (pulls minio image on first run; skips if Docker unavailable).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/store/miniostore/ backend/go.mod backend/go.sum
git commit -m "feat(backend): MinIO client wrapper (bucket + presigned PUT/GET)"
```

---

### Task 3: Media service

**Files:**
- Create: `backend/internal/media/service.go`
- Create: `backend/internal/media/service_test.go`

- [ ] **Step 1: Write the service**

Create `backend/internal/media/service.go`:
```go
package media

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

const presignTTL = 15 * time.Minute

// ErrTooLarge is returned when the declared size exceeds the limit.
var ErrTooLarge = errors.New("file too large")

const maxSize = 100 << 20 // 100 MiB

// Storage is the subset of miniostore.Client the service needs.
type Storage interface {
	Bucket() string
	PresignedPut(ctx context.Context, objectKey string, expiry time.Duration) (string, error)
	PresignedGet(ctx context.Context, objectKey string, expiry time.Duration) (string, error)
}

type Service struct {
	repo    *Repo
	storage Storage
}

func NewService(repo *Repo, storage Storage) *Service {
	return &Service{repo: repo, storage: storage}
}

// UploadInput describes a media object the client is about to upload.
type UploadInput struct {
	OwnerID     int64
	Mime        string
	Size        int64
	Width       int
	Height      int
	Duration    int
	BlurPreview []byte
}

// CreateUpload records media metadata and returns the row plus a presigned PUT
// URL the client uploads the bytes to directly.
func (s *Service) CreateUpload(ctx context.Context, in UploadInput) (Media, string, error) {
	if in.Size <= 0 || in.Size > maxSize {
		return Media{}, "", ErrTooLarge
	}
	objectKey := fmt.Sprintf("%d/%s", in.OwnerID, randomKey())
	m, err := s.repo.Create(ctx, Media{
		OwnerID: in.OwnerID, Bucket: s.storage.Bucket(), ObjectKey: objectKey,
		Mime: in.Mime, Size: in.Size, Width: in.Width, Height: in.Height,
		Duration: in.Duration, BlurPreview: in.BlurPreview,
	})
	if err != nil {
		return Media{}, "", err
	}
	uploadURL, err := s.storage.PresignedPut(ctx, objectKey, presignTTL)
	if err != nil {
		return Media{}, "", err
	}
	return m, uploadURL, nil
}

// GetMedia returns a media row and a presigned GET (download) URL.
func (s *Service) GetMedia(ctx context.Context, id int64) (Media, string, error) {
	m, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return Media{}, "", err
	}
	downloadURL, err := s.storage.PresignedGet(ctx, m.ObjectKey, presignTTL)
	if err != nil {
		return Media{}, "", err
	}
	return m, downloadURL, nil
}

func randomKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
```

- [ ] **Step 2: Write the service test (fake storage)**

Create `backend/internal/media/service_test.go`:
```go
package media

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

type fakeStorage struct{}

func (fakeStorage) Bucket() string { return "media" }
func (fakeStorage) PresignedPut(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://minio/put/" + key, nil
}
func (fakeStorage) PresignedGet(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://minio/get/" + key, nil
}

func TestService_CreateUploadAndGet(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	s := NewService(repo, fakeStorage{})
	ctx := context.Background()
	owner := seedUser(t, repo, "+700")

	m, uploadURL, err := s.CreateUpload(ctx, UploadInput{OwnerID: owner, Mime: "image/jpeg", Size: 2048, Width: 100, Height: 100})
	if err != nil {
		t.Fatalf("CreateUpload: %v", err)
	}
	if m.ID == 0 || uploadURL == "" {
		t.Fatalf("bad result: %+v url=%q", m, uploadURL)
	}

	got, downloadURL, err := s.GetMedia(ctx, m.ID)
	if err != nil || got.ID != m.ID || downloadURL == "" {
		t.Fatalf("GetMedia = %+v, %q, %v", got, downloadURL, err)
	}
}

func TestService_RejectsOversize(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(NewRepo(pool), fakeStorage{})
	owner := seedUser(t, NewRepo(pool), "+701")
	if _, _, err := s.CreateUpload(context.Background(), UploadInput{OwnerID: owner, Size: maxSize + 1}); err != ErrTooLarge {
		t.Fatalf("expected ErrTooLarge, got %v", err)
	}
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/media/ -run Service -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/media/service.go backend/internal/media/service_test.go
git commit -m "feat(backend): media service (CreateUpload + GetMedia presigned URLs)"
```

---

### Task 4: Messaging integration + HTTP endpoints + wiring

**Files:**
- Modify: `backend/internal/messaging/messages_repo.go`
- Modify: `backend/internal/messaging/message_service.go`
- Modify: `backend/internal/messaging/message_service_test.go`
- Create: `backend/internal/transport/http/media_handler.go`
- Modify: `backend/internal/transport/http/router.go`
- Modify: `backend/cmd/server/main.go`
- Create: `backend/internal/transport/http/media_handler_test.go`

- [ ] **Step 1: Add media_id to messages (repo + Message struct)**

In `backend/internal/messaging/messages_repo.go`:

(a) Add `MediaID *int64` to the `Message` struct.

(b) Add `media_id` to every SELECT column list (`FindByClientMsgID`, `GetHistory`'s three queries) — append `, media_id` after `client_msg_id` in each `SELECT ... created_at, deleted_at` list, placing it consistently. Specifically change each column list from:
```
id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, created_at, deleted_at
```
to:
```
id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, media_id, created_at, deleted_at
```

(c) Add `media_id` to `Insert`:
```go
	`INSERT INTO messages (chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, media_id)
	 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
	 RETURNING id, chat_id, seq, sender_id, type, text, reply_to_id, client_msg_id, media_id, created_at, deleted_at`,
	m.ChatID, m.Seq, m.SenderID, m.Type, m.Text, m.ReplyToID, m.ClientMsgID, m.MediaID`
```

(d) Update `scanInto` to scan `media_id` in the new position:
```go
	err := s.Scan(&m.ID, &m.ChatID, &m.Seq, &m.SenderID, &m.Type, &m.Text,
		&m.ReplyToID, &m.ClientMsgID, &m.MediaID, &m.CreatedAt, &deletedAt)
```

- [ ] **Step 2: Add MediaID to SendInput and validate ownership**

In `backend/internal/messaging/message_service.go`:

(a) Add `MediaID *int64` to `SendInput`.

(b) In `Send`, after the membership check and before the transaction, if `in.MediaID != nil` verify the media belongs to the sender. Add a small repo call via the pool — to avoid a hard dependency on the media package, query directly:
```go
	if in.MediaID != nil {
		var ownerID int64
		err := s.pool.QueryRow(ctx, `SELECT owner_id FROM media WHERE id=$1`, *in.MediaID).Scan(&ownerID)
		if err != nil || ownerID != in.SenderID {
			return Message{}, ErrNotFound
		}
	}
```
(c) Pass `MediaID` into the inserted `Message`:
```go
		msg, e = s.msgs.Insert(ctx, tx, Message{
			ChatID: in.ChatID, Seq: seq, SenderID: in.SenderID,
			Type: in.Type, Text: in.Text, ReplyToID: in.ReplyToID,
			ClientMsgID: cmid, MediaID: in.MediaID,
		})
```
(d) Include `media_id` in `messageUpdatePayload`:
```go
func messageUpdatePayload(m Message) map[string]any {
	return map[string]any{
		"chat_id": m.ChatID, "msg_id": m.ID, "seq": m.Seq,
		"sender_id": m.SenderID, "type": m.Type, "text": m.Text,
		"media_id": m.MediaID, "created_at": m.CreatedAt,
	}
}
```

- [ ] **Step 3: Include media_id in the REST message JSON**

In `backend/internal/transport/http/chat_handler.go`, update `messageJSON` to include `"media_id": m.MediaID,` (add the key alongside the existing fields).

- [ ] **Step 4: Add a send-with-media test**

Append to `backend/internal/messaging/message_service_test.go`:
```go
func TestService_Send_WithMedia(t *testing.T) {
	pool := postgres.NewTestDB(t)
	s := NewService(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+790")
	b := seedUser(t, pool, "+791")
	chatID, _ := s.CreatePrivateChat(ctx, a, b)

	// Seed a media row owned by a.
	var mediaID int64
	_ = pool.QueryRow(ctx,
		`INSERT INTO media (owner_id, bucket, object_key, mime) VALUES ($1,'media','k','image/jpeg') RETURNING id`,
		a).Scan(&mediaID)

	msg, err := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Type: "photo", Text: "look", MediaID: &mediaID})
	if err != nil {
		t.Fatalf("Send with media: %v", err)
	}
	if msg.MediaID == nil || *msg.MediaID != mediaID {
		t.Fatalf("message media_id = %v; want %d", msg.MediaID, mediaID)
	}

	// Media owned by someone else is rejected.
	var otherMedia int64
	_ = pool.QueryRow(ctx,
		`INSERT INTO media (owner_id, bucket, object_key, mime) VALUES ($1,'media','k2','image/jpeg') RETURNING id`,
		b).Scan(&otherMedia)
	if _, err := s.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Type: "photo", MediaID: &otherMedia}); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound for foreign media, got %v", err)
	}
}
```

- [ ] **Step 5: Write the media HTTP handlers**

Create `backend/internal/transport/http/media_handler.go`:
```go
package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/messenger-denis/backend/internal/media"
)

type MediaHandler struct{ svc *media.Service }

func NewMediaHandler(svc *media.Service) *MediaHandler { return &MediaHandler{svc: svc} }

type uploadBody struct {
	Mime        string `json:"mime"`
	Size        int64  `json:"size"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	Duration    int    `json:"duration"`
	BlurPreview []byte `json:"blur_preview"` // base64 in JSON
}

func (h *MediaHandler) CreateUpload(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var body uploadBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	m, uploadURL, err := h.svc.CreateUpload(r.Context(), media.UploadInput{
		OwnerID: user.ID, Mime: body.Mime, Size: body.Size,
		Width: body.Width, Height: body.Height, Duration: body.Duration, BlurPreview: body.BlurPreview,
	})
	if errors.Is(err, media.ErrTooLarge) {
		writeError(w, http.StatusRequestEntityTooLarge, "file too large")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create upload")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"media_id": m.ID, "object_key": m.ObjectKey, "upload_url": uploadURL,
	})
}

func (h *MediaHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "mediaID")
	if !ok {
		return
	}
	m, downloadURL, err := h.svc.GetMedia(r.Context(), id)
	if errors.Is(err, media.ErrNotFound) {
		writeError(w, http.StatusNotFound, "media not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load media")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": m.ID, "mime": m.Mime, "size": m.Size,
		"width": m.Width, "height": m.Height, "duration": m.Duration,
		"download_url": downloadURL,
	})
}
```

- [ ] **Step 6: Mount media routes (nil-safe) and wire main.go**

(a) In `backend/internal/transport/http/router.go`, change `NewRouter` to accept an optional media handler:
```go
func NewRouter(authSvc *auth.Service, chatSvc *messaging.Service, wsHandler http.Handler, mediaH *MediaHandler) http.Handler {
```
Inside the protected group, add:
```go
		if mediaH != nil {
			pr.Post("/media/upload", mediaH.CreateUpload)
			pr.Get("/media/{mediaID}", mediaH.Get)
		}
```
Update the existing test helpers `newTestRouter` and `newMessagingRouter` to pass `nil` for the new `mediaH` argument.

(b) In `backend/cmd/server/main.go`, connect MinIO (graceful fallback) and build the media handler:
```go
	var mediaHandler *httptransport.MediaHandler
	if mc, err := miniostore.Connect(cfg.MinioEndpoint, cfg.MinioAccessKey, cfg.MinioSecretKey, cfg.MinioBucket, cfg.MinioUseSSL); err != nil {
		log.Printf("minio unavailable, media disabled: %v", err)
	} else if err := mc.EnsureBucket(ctx); err != nil {
		log.Printf("minio bucket setup failed, media disabled: %v", err)
	} else {
		mediaHandler = httptransport.NewMediaHandler(media.NewService(media.NewRepo(pool), mc))
		log.Printf("media enabled (minio bucket %q)", cfg.MinioBucket)
	}
```
Pass `mediaHandler` as the new fourth argument to `httptransport.NewRouter(...)`. Add imports `"github.com/messenger-denis/backend/internal/media"` and `"github.com/messenger-denis/backend/internal/store/miniostore"`.

- [ ] **Step 7: Write the media handler test (fake storage via service)**

Create `backend/internal/transport/http/media_handler_test.go`:
```go
package http

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/auth"
	"github.com/messenger-denis/backend/internal/media"
	"github.com/messenger-denis/backend/internal/messaging"
	"github.com/messenger-denis/backend/internal/store/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

type fakeStorage struct{}

func (fakeStorage) Bucket() string { return "media" }
func (fakeStorage) PresignedPut(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://minio/put/" + key, nil
}
func (fakeStorage) PresignedGet(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://minio/get/" + key, nil
}

func newMediaRouter(t *testing.T) (http.Handler, *pgxpool.Pool) {
	pool := postgres.NewTestDB(t)
	authSvc := auth.NewService(auth.NewRepo(pool), "12345", func(string, ...any) {})
	chatSvc := messaging.NewService(pool)
	mediaH := NewMediaHandler(media.NewService(media.NewRepo(pool), fakeStorage{}))
	return NewRouter(authSvc, chatSvc, nil, mediaH), pool
}

func TestMedia_UploadAndGet_HTTP(t *testing.T) {
	h, pool := newMediaRouter(t)
	token, _ := signUp(t, h, pool, "+79990000030")

	rec := authedReq(t, h, http.MethodPost, "/media/upload", token, map[string]any{
		"mime": "image/jpeg", "size": 2048, "width": 100, "height": 100,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		MediaID   int64  `json:"media_id"`
		UploadURL string `json:"upload_url"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.MediaID == 0 || created.UploadURL == "" {
		t.Fatalf("bad upload response: %s", rec.Body.String())
	}

	rec = authedReq(t, h, http.MethodGet, "/media/"+itoa(created.MediaID), token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get: %d %s", rec.Code, rec.Body.String())
	}
	var got struct {
		DownloadURL string `json:"download_url"`
		Mime        string `json:"mime"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got.DownloadURL == "" || got.Mime != "image/jpeg" {
		t.Fatalf("bad get response: %s", rec.Body.String())
	}
}
```

- [ ] **Step 8: Run the tests and build**

Run: `cd backend && go build ./... && go test ./internal/messaging/ -run 'Send_WithMedia' -v && go test ./internal/transport/http/ -run 'Media_' -v && go test ./...`
Expected: build clean; new tests pass; whole suite green.

- [ ] **Step 9: Commit**

```bash
git add backend/internal/messaging/ backend/internal/transport/http/ backend/cmd/server/main.go
git commit -m "feat(backend): attach media to messages + media REST endpoints + wiring"
```

---

### Task 5: Full-stack verification

**Files:** none (verification only).

- [ ] **Step 1: Whole suite + vet**

Run: `cd backend && go test ./... && go vet ./...`
Expected: all PASS, vet clean.

- [ ] **Step 2: End-to-end media round-trip over docker (real MinIO)**

Run:
```bash
cat > /tmp/plan-d1-stack.yml <<'EOF'
name: plan-d1-verify
services:
  pg:
    image: postgres:16-alpine
    environment: {POSTGRES_USER: messenger, POSTGRES_PASSWORD: messenger, POSTGRES_DB: messenger}
    healthcheck: {test: ["CMD-SHELL","pg_isready -U messenger"], interval: 3s, timeout: 3s, retries: 10}
  minio:
    image: minio/minio:latest
    command: server /data
    environment: {MINIO_ROOT_USER: minioadmin, MINIO_ROOT_PASSWORD: minioadmin}
    healthcheck: {test: ["CMD","mc","ready","local"], interval: 3s, timeout: 3s, retries: 10}
  backend:
    build: /Users/denisurevic/Documents/messenger-denis/backend
    environment:
      HTTP_ADDR: ":8080"
      DATABASE_URL: "postgres://messenger:messenger@pg:5432/messenger?sslmode=disable"
      DEV_OTP_CODE: "12345"
      MINIO_ENDPOINT: "minio:9000"
      MINIO_ACCESS_KEY: "minioadmin"
      MINIO_SECRET_KEY: "minioadmin"
      MINIO_BUCKET: "media"
    depends_on:
      pg: {condition: service_healthy}
      minio: {condition: service_healthy}
    ports: ["18087:8080"]
EOF
docker compose -f /tmp/plan-d1-stack.yml up -d --build
sleep 8
docker compose -f /tmp/plan-d1-stack.yml logs backend | grep -i "media enabled"
B="localhost:18087"
curl -s -X POST $B/auth/request_code -d '{"phone":"+700"}' >/dev/null
TOK=$(curl -s -X POST $B/auth/sign_in -d '{"phone":"+700","code":"12345"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')
UP=$(curl -s -X POST $B/media/upload -H "Authorization: Bearer $TOK" -d '{"mime":"text/plain","size":11}')
echo "upload resp: $UP"
PUT_URL=$(echo "$UP" | sed 's/.*"upload_url":"\([^"]*\)".*/\1/' | sed 's|minio:9000|localhost:9000|')
MID=$(echo "$UP" | sed 's/.*"media_id":\([0-9]*\).*/\1/')
echo -n "hello media" | curl -s -o /dev/null -w 'PUT status: %{http_code}\n' -X PUT --data-binary @- "$PUT_URL"
DL=$(curl -s $B/media/$MID -H "Authorization: Bearer $TOK" | sed 's/.*"download_url":"\([^"]*\)".*/\1/' | sed 's|minio:9000|localhost:9000|')
echo "download body: $(curl -s "$DL")"
echo "range 206: $(curl -s -o /dev/null -w '%{http_code}' -H 'Range: bytes=0-4' "$DL")"
docker compose -f /tmp/plan-d1-stack.yml down -v
```
Note: MinIO presigned URLs embed the internal host `minio:9000`; the script rewrites it to `localhost:9000` so the host curl can reach the published MinIO port. (Publish MinIO's port if needed by adding `ports: ["9000:9000"]` to the minio service — add it to the compose above.)
Expected: log "media enabled (minio bucket \"media\")"; PUT status 200; download body "hello media"; range request 206.

- [ ] **Step 3:** Add `ports: ["9000:9000"]` to the `minio` service in the verification compose if the host can't reach MinIO, then re-run. No app code changes expected.

---

## Self-Review Notes

- **Spec coverage:** §6 media table + messages.media_id; §11 presigned upload (PUT) / download (GET) direct to MinIO (bytes bypass the backend) + HTTP Range (verified via 206 in tests). `blur_preview` stored (client-supplied LQIP).
- **Out of scope (later):** Web Push (Plan D2); server-side transcode / multiple `sizes` / generated thumbnails; cleanup of orphan media (uploaded but never attached) — a GC sweep is a follow-up.
- **Security:** upload requires auth (owner = caller); `Send` rejects attaching media the sender doesn't own (`ErrNotFound`→403 via the chat handler's existing mapping); presigned URLs are time-limited (15 min). Object keys are namespaced by owner id + random.
- **Nil-safety:** media routes only mounted when MinIO connects; the server still serves everything else if MinIO is down. `media.Service` takes a `Storage` interface (fake in tests, miniostore in prod) — no MinIO needed for handler/service unit tests.
- **messages_repo media_id:** added to the Message struct + all SELECT/INSERT/scan sites consistently; existing rows have NULL media_id → nil pointer, so Plan B/C tests keep passing.
- **Type consistency:** `media.Media`/`Repo`/`Service`/`UploadInput`/`Storage`/`ErrNotFound`/`ErrTooLarge`, `miniostore.Client` (Bucket/EnsureBucket/PresignedPut/PresignedGet), `NewRouter(authSvc, chatSvc, wsHandler, mediaH)` updated across router/main/tests, `SendInput.MediaID`/`Message.MediaID` consistent.
```
