# Backend Plan A — Foundation + Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Go backend skeleton and a working phone+OTP authentication API (dev OTP), with users, devices/sessions, Postgres storage, and Docker dev dependencies.

**Architecture:** Modular monolith in one Go binary. `chi` HTTP router, `pgx` for Postgres, `goose` for embedded migrations. Auth is phone + dev-OTP: `request_code` stores a fixed code, `sign_in` verifies it, upserts the user, creates a device row, and returns an opaque session token (sha256 hash stored). A middleware validates the token on protected routes. DB-touching code is tested with `testcontainers-go` (ephemeral Postgres); pure logic is unit-tested.

**Tech Stack:** Go 1.22+, chi/v5, pgx/v5, pressly/goose/v3, testcontainers-go, Docker Compose (Postgres 16, Redis 7, MinIO — Redis/MinIO scaffolded now, used in later plans).

This plan implements spec sections §2, §4 (users/devices), §9 (auth), §10 (project structure), §11 (docker partial) of `docs/superpowers/specs/2026-06-23-messenger-backend-design.md`.

---

## File Structure

```
backend/
  go.mod
  cmd/server/main.go              — entrypoint, wiring, graceful shutdown
  internal/
    config/config.go              — env config
    config/config_test.go
    store/postgres/db.go          — pgxpool connect + run migrations
    store/postgres/migrations/0001_init.sql
    store/postgres/migrate.go     — embed FS + goose runner
    store/postgres/testdb.go      — testcontainers helper (build tag-free, used by tests)
    auth/code.go                  — OTP code logic (pure) + phone normalize
    auth/code_test.go
    auth/token.go                 — token generate/hash (pure)
    auth/token_test.go
    auth/repo.go                  — user/device/code repository (pgx)
    auth/repo_test.go
    auth/service.go               — request_code / sign_in orchestration
    auth/service_test.go
    transport/http/router.go      — chi router assembly
    transport/http/auth_handler.go— /auth/* handlers
    transport/http/auth_handler_test.go
    transport/http/middleware.go  — auth middleware (token → user)
    transport/http/me_handler.go  — GET /me (protected)
    transport/http/me_handler_test.go
  Dockerfile
docker-compose.yml                — at repo root
nginx/nginx.conf                  — at repo root (basic proxy, expanded later)
.env.example                      — at repo root
```

Each file has one responsibility: pure logic (`code.go`, `token.go`) is separated from IO (`repo.go`), which is separated from orchestration (`service.go`) and transport (`http/`).

---

### Task 1: Project scaffolding + config

**Files:**
- Create: `backend/go.mod`
- Create: `backend/internal/config/config.go`
- Test: `backend/internal/config/config_test.go`

- [ ] **Step 1: Initialize the Go module**

Run:
```bash
cd backend && go mod init github.com/messenger-denis/backend && go mod tidy
```
Expected: creates `go.mod` with `module github.com/messenger-denis/backend` and a Go version line.

- [ ] **Step 2: Write the failing config test**

Create `backend/internal/config/config_test.go`:
```go
package config

import "testing"

func TestLoad_Defaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("HTTP_ADDR", "")
	t.Setenv("DEV_OTP_CODE", "")

	c, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.HTTPAddr != ":8080" {
		t.Errorf("HTTPAddr default = %q, want :8080", c.HTTPAddr)
	}
	if c.DevOTPCode != "12345" {
		t.Errorf("DevOTPCode default = %q, want 12345", c.DevOTPCode)
	}
	if c.DatabaseURL != "postgres://localhost/db" {
		t.Errorf("DatabaseURL = %q", c.DatabaseURL)
	}
}

func TestLoad_MissingDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected error when DATABASE_URL is empty")
	}
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && go test ./internal/config/ -run TestLoad -v`
Expected: FAIL — `Load` / `Config` undefined (build error).

- [ ] **Step 4: Write minimal config implementation**

Create `backend/internal/config/config.go`:
```go
package config

import (
	"fmt"
	"os"
)

type Config struct {
	HTTPAddr    string
	DatabaseURL string
	RedisURL    string
	DevOTPCode  string
}

func Load() (*Config, error) {
	c := &Config{
		HTTPAddr:    getenv("HTTP_ADDR", ":8080"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		RedisURL:    getenv("REDIS_URL", "redis://localhost:6379"),
		DevOTPCode:  getenv("DEV_OTP_CODE", "12345"),
	}
	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	return c, nil
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && go test ./internal/config/ -v`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add backend/go.mod backend/go.sum backend/internal/config/
git commit -m "feat(backend): scaffold module and config loader"
```

---

### Task 2: Docker dev dependencies + .env

**Files:**
- Create: `docker-compose.yml` (repo root)
- Create: `.env.example` (repo root)

- [ ] **Step 1: Write docker-compose for dev dependencies**

Create `docker-compose.yml` at repo root:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: messenger
      POSTGRES_PASSWORD: messenger
      POSTGRES_DB: messenger
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U messenger"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9001:9001"]
    volumes: ["miniodata:/data"]
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
  miniodata:
```

- [ ] **Step 2: Write .env.example**

Create `.env.example` at repo root:
```
HTTP_ADDR=:8080
DATABASE_URL=postgres://messenger:messenger@localhost:5432/messenger?sslmode=disable
REDIS_URL=redis://localhost:6379
DEV_OTP_CODE=12345
```

- [ ] **Step 3: Verify dependencies start**

Run: `docker compose up -d postgres redis minio && docker compose ps`
Expected: all three services `healthy` within ~15s. Then `docker compose down` is optional (leave Postgres up for later tasks).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore: docker-compose dev dependencies (postgres, redis, minio)"
```

---

### Task 3: Postgres connection + embedded migrations

**Files:**
- Create: `backend/internal/store/postgres/migrations/0001_init.sql`
- Create: `backend/internal/store/postgres/migrate.go`
- Create: `backend/internal/store/postgres/db.go`

- [ ] **Step 1: Add dependencies**

Run:
```bash
cd backend && go get github.com/jackc/pgx/v5/pgxpool@latest github.com/pressly/goose/v3@latest
```
Expected: dependencies added to `go.mod`.

- [ ] **Step 2: Write the initial migration**

Create `backend/internal/store/postgres/migrations/0001_init.sql`:
```sql
-- +goose Up
CREATE TABLE users (
  id           BIGSERIAL PRIMARY KEY,
  phone        TEXT UNIQUE NOT NULL,
  username     TEXT UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  bio          TEXT NOT NULL DEFAULT '',
  avatar_url   TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  platform    TEXT NOT NULL DEFAULT '',
  token_hash  TEXT UNIQUE NOT NULL,
  last_active TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_codes (
  phone      TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- +goose Down
DROP TABLE auth_codes;
DROP TABLE devices;
DROP TABLE users;
```

- [ ] **Step 3: Write the migration runner**

Create `backend/internal/store/postgres/migrate.go`:
```go
package postgres

import (
	"database/sql"
	"embed"
	"fmt"

	"github.com/pressly/goose/v3"
	_ "github.com/jackc/pgx/v5/stdlib"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Migrate runs all up migrations against the database at databaseURL.
func Migrate(databaseURL string) error {
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return fmt.Errorf("open db for migrate: %w", err)
	}
	defer db.Close()

	goose.SetBaseFS(migrationsFS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return goose.Up(db, "migrations")
}
```

- [ ] **Step 4: Write the pool connector**

Create `backend/internal/store/postgres/db.go`:
```go
package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect opens a pgx connection pool.
func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return pool, nil
}
```

- [ ] **Step 5: Verify it builds**

Run: `cd backend && go build ./... && go mod tidy`
Expected: builds with no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/store/postgres/ backend/go.mod backend/go.sum
git commit -m "feat(backend): postgres pool and embedded migrations (users, devices, auth_codes)"
```

---

### Task 4: testcontainers Postgres helper

**Files:**
- Create: `backend/internal/store/postgres/testdb.go`

- [ ] **Step 1: Add testcontainers dependency**

Run:
```bash
cd backend && go get github.com/testcontainers/testcontainers-go@latest github.com/testcontainers/testcontainers-go/modules/postgres@latest
```
Expected: dependencies added.

- [ ] **Step 2: Write the test helper**

Create `backend/internal/store/postgres/testdb.go`:
```go
package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// NewTestDB spins up an ephemeral Postgres, runs migrations, and returns a pool.
// It registers cleanup with t. Skips the test if Docker is unavailable.
func NewTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()

	container, err := tcpostgres.Run(ctx, "postgres:16-alpine",
		tcpostgres.WithDatabase("messenger"),
		tcpostgres.WithUsername("messenger"),
		tcpostgres.WithPassword("messenger"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).WithStartupTimeout(60*time.Second)),
	)
	if err != nil {
		t.Skipf("cannot start postgres container (is Docker running?): %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(ctx) })

	url, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}
	if err := Migrate(url); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := Connect(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}
```

- [ ] **Step 3: Verify it builds**

Run: `cd backend && go build ./... && go vet ./internal/store/postgres/`
Expected: builds with no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/store/postgres/testdb.go backend/go.mod backend/go.sum
git commit -m "test(backend): testcontainers postgres helper"
```

---

### Task 5: OTP code + phone normalization (pure)

**Files:**
- Create: `backend/internal/auth/code.go`
- Test: `backend/internal/auth/code_test.go`

- [ ] **Step 1: Write the failing test**

Create `backend/internal/auth/code_test.go`:
```go
package auth

import "testing"

func TestNormalizePhone(t *testing.T) {
	cases := map[string]string{
		"+7 (999) 123-45-67": "+79991234567",
		"89991234567":        "89991234567",
		"  +1 555 000 ":      "+1555000",
	}
	for in, want := range cases {
		if got := NormalizePhone(in); got != want {
			t.Errorf("NormalizePhone(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCodeMatches(t *testing.T) {
	if !CodeMatches("12345", "12345") {
		t.Error("expected exact match to pass")
	}
	if CodeMatches("12345", "00000") {
		t.Error("expected mismatch to fail")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./internal/auth/ -run 'TestNormalizePhone|TestCodeMatches' -v`
Expected: FAIL — `NormalizePhone` / `CodeMatches` undefined.

- [ ] **Step 3: Write minimal implementation**

Create `backend/internal/auth/code.go`:
```go
package auth

import "strings"

// NormalizePhone strips spaces, parentheses, and dashes, keeping a leading +.
func NormalizePhone(phone string) string {
	var b strings.Builder
	for i, r := range phone {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '+' && i == 0:
			b.WriteRune(r)
		case r == '+': // leading + after trimmed spaces
			if strings.TrimSpace(phone[:i]) == "" {
				b.WriteRune(r)
			}
		}
	}
	return b.String()
}

// CodeMatches reports whether the supplied code equals the expected code.
func CodeMatches(expected, supplied string) bool {
	return expected != "" && expected == supplied
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && go test ./internal/auth/ -run 'TestNormalizePhone|TestCodeMatches' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/auth/code.go backend/internal/auth/code_test.go
git commit -m "feat(backend): phone normalization and OTP code matching"
```

---

### Task 6: Session token generate + hash (pure)

**Files:**
- Create: `backend/internal/auth/token.go`
- Test: `backend/internal/auth/token_test.go`

- [ ] **Step 1: Write the failing test**

Create `backend/internal/auth/token_test.go`:
```go
package auth

import "testing"

func TestGenerateToken(t *testing.T) {
	tok, hash, err := GenerateToken()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(tok) < 20 {
		t.Errorf("token too short: %q", tok)
	}
	if hash != HashToken(tok) {
		t.Error("returned hash does not match HashToken(token)")
	}
}

func TestHashTokenStable(t *testing.T) {
	if HashToken("abc") != HashToken("abc") {
		t.Error("HashToken must be deterministic")
	}
	if HashToken("abc") == HashToken("abd") {
		t.Error("different tokens must hash differently")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./internal/auth/ -run 'Token' -v`
Expected: FAIL — `GenerateToken` / `HashToken` undefined.

- [ ] **Step 3: Write minimal implementation**

Create `backend/internal/auth/token.go`:
```go
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
)

// GenerateToken returns an opaque session token and its sha256 hex hash.
// Only the hash is stored server-side.
func GenerateToken() (token string, hash string, err error) {
	buf := make([]byte, 32)
	if _, err = rand.Read(buf); err != nil {
		return "", "", err
	}
	token = hex.EncodeToString(buf)
	return token, HashToken(token), nil
}

// HashToken returns the hex-encoded sha256 of the token.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && go test ./internal/auth/ -run 'Token' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/auth/token.go backend/internal/auth/token_test.go
git commit -m "feat(backend): opaque session token generation and hashing"
```

---

### Task 7: Auth repository (users, devices, auth_codes)

**Files:**
- Create: `backend/internal/auth/repo.go`
- Test: `backend/internal/auth/repo_test.go`

- [ ] **Step 1: Write the repository (types + queries)**

Create `backend/internal/auth/repo.go`:
```go
package auth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type User struct {
	ID          int64
	Phone       string
	Username    *string
	DisplayName string
	AvatarURL   string
}

type Device struct {
	ID        int64
	UserID    int64
	Name      string
	Platform  string
	TokenHash string
}

var ErrNotFound = errors.New("not found")

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

// SaveCode upserts a verification code for a phone with an expiry.
func (r *Repo) SaveCode(ctx context.Context, phone, code string, expires time.Time) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO auth_codes (phone, code, expires_at) VALUES ($1,$2,$3)
		 ON CONFLICT (phone) DO UPDATE SET code=$2, expires_at=$3`,
		phone, code, expires)
	return err
}

// GetCode returns the stored code for a phone if not expired.
func (r *Repo) GetCode(ctx context.Context, phone string) (string, error) {
	var code string
	var expires time.Time
	err := r.pool.QueryRow(ctx,
		`SELECT code, expires_at FROM auth_codes WHERE phone=$1`, phone).Scan(&code, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if time.Now().After(expires) {
		return "", ErrNotFound
	}
	return code, nil
}

// DeleteCode removes a used code.
func (r *Repo) DeleteCode(ctx context.Context, phone string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM auth_codes WHERE phone=$1`, phone)
	return err
}

// UpsertUserByPhone returns the existing user for a phone or creates one.
func (r *Repo) UpsertUserByPhone(ctx context.Context, phone string) (User, error) {
	var u User
	err := r.pool.QueryRow(ctx,
		`INSERT INTO users (phone, display_name) VALUES ($1,$1)
		 ON CONFLICT (phone) DO UPDATE SET phone=EXCLUDED.phone
		 RETURNING id, phone, username, display_name, avatar_url`,
		phone).Scan(&u.ID, &u.Phone, &u.Username, &u.DisplayName, &u.AvatarURL)
	return u, err
}

// CreateDevice inserts a device row holding the token hash.
func (r *Repo) CreateDevice(ctx context.Context, userID int64, name, platform, tokenHash string) (Device, error) {
	var d Device
	err := r.pool.QueryRow(ctx,
		`INSERT INTO devices (user_id, name, platform, token_hash)
		 VALUES ($1,$2,$3,$4)
		 RETURNING id, user_id, name, platform, token_hash`,
		userID, name, platform, tokenHash).Scan(&d.ID, &d.UserID, &d.Name, &d.Platform, &d.TokenHash)
	return d, err
}

// UserByTokenHash resolves a session token hash to a user, touching last_active.
func (r *Repo) UserByTokenHash(ctx context.Context, tokenHash string) (User, error) {
	var u User
	err := r.pool.QueryRow(ctx,
		`UPDATE devices SET last_active=now() WHERE token_hash=$1
		 RETURNING user_id`, tokenHash).Scan(new(int64))
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, err
	}
	err = r.pool.QueryRow(ctx,
		`SELECT u.id, u.phone, u.username, u.display_name, u.avatar_url
		 FROM users u JOIN devices d ON d.user_id=u.id WHERE d.token_hash=$1`,
		tokenHash).Scan(&u.ID, &u.Phone, &u.Username, &u.DisplayName, &u.AvatarURL)
	return u, err
}
```

- [ ] **Step 2: Write the repository test**

Create `backend/internal/auth/repo_test.go`:
```go
package auth

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestRepo_CodeLifecycle(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	ctx := context.Background()

	if err := repo.SaveCode(ctx, "+700", "12345", time.Now().Add(time.Minute)); err != nil {
		t.Fatalf("SaveCode: %v", err)
	}
	got, err := repo.GetCode(ctx, "+700")
	if err != nil || got != "12345" {
		t.Fatalf("GetCode = %q, %v", got, err)
	}
	if err := repo.DeleteCode(ctx, "+700"); err != nil {
		t.Fatalf("DeleteCode: %v", err)
	}
	if _, err := repo.GetCode(ctx, "+700"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
}

func TestRepo_ExpiredCode(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	ctx := context.Background()
	_ = repo.SaveCode(ctx, "+701", "12345", time.Now().Add(-time.Minute))
	if _, err := repo.GetCode(ctx, "+701"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound for expired, got %v", err)
	}
}

func TestRepo_UserAndDeviceAndToken(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	ctx := context.Background()

	u1, err := repo.UpsertUserByPhone(ctx, "+702")
	if err != nil {
		t.Fatalf("UpsertUserByPhone: %v", err)
	}
	u2, _ := repo.UpsertUserByPhone(ctx, "+702")
	if u1.ID != u2.ID {
		t.Fatalf("upsert created duplicate user: %d != %d", u1.ID, u2.ID)
	}

	_, err = repo.CreateDevice(ctx, u1.ID, "web", "browser", "hash-abc")
	if err != nil {
		t.Fatalf("CreateDevice: %v", err)
	}
	got, err := repo.UserByTokenHash(ctx, "hash-abc")
	if err != nil {
		t.Fatalf("UserByTokenHash: %v", err)
	}
	if got.ID != u1.ID {
		t.Fatalf("resolved wrong user: %d != %d", got.ID, u1.ID)
	}
	if _, err := repo.UserByTokenHash(ctx, "missing"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound for missing token, got %v", err)
	}
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/auth/ -run 'Repo' -v`
Expected: PASS (skips gracefully if Docker is unavailable).

- [ ] **Step 4: Commit**

```bash
git add backend/internal/auth/repo.go backend/internal/auth/repo_test.go
git commit -m "feat(backend): auth repository (users, devices, codes)"
```

---

### Task 8: Auth service (request_code + sign_in)

**Files:**
- Create: `backend/internal/auth/service.go`
- Test: `backend/internal/auth/service_test.go`

- [ ] **Step 1: Write the service**

Create `backend/internal/auth/service.go`:
```go
package auth

import (
	"context"
	"errors"
	"time"
)

const codeTTL = 5 * time.Minute

var ErrInvalidCode = errors.New("invalid code")

type Service struct {
	repo    *Repo
	devCode string // fixed dev OTP, also logged
	logf    func(format string, args ...any)
}

func NewService(repo *Repo, devCode string, logf func(string, ...any)) *Service {
	return &Service{repo: repo, devCode: devCode, logf: logf}
}

// RequestCode stores the (dev-fixed) code for the phone and "sends" it (logs it).
func (s *Service) RequestCode(ctx context.Context, rawPhone string) error {
	phone := NormalizePhone(rawPhone)
	if phone == "" {
		return errors.New("empty phone")
	}
	if err := s.repo.SaveCode(ctx, phone, s.devCode, time.Now().Add(codeTTL)); err != nil {
		return err
	}
	s.logf("[dev-otp] phone=%s code=%s", phone, s.devCode)
	return nil
}

// SignInResult is returned to the client after a successful sign-in.
type SignInResult struct {
	Token string
	User  User
}

// SignIn verifies the code, upserts the user, creates a device, and returns a token.
func (s *Service) SignIn(ctx context.Context, rawPhone, suppliedCode, deviceName, platform string) (SignInResult, error) {
	phone := NormalizePhone(rawPhone)
	stored, err := s.repo.GetCode(ctx, phone)
	if errors.Is(err, ErrNotFound) {
		return SignInResult{}, ErrInvalidCode
	}
	if err != nil {
		return SignInResult{}, err
	}
	if !CodeMatches(stored, suppliedCode) {
		return SignInResult{}, ErrInvalidCode
	}

	user, err := s.repo.UpsertUserByPhone(ctx, phone)
	if err != nil {
		return SignInResult{}, err
	}
	token, hash, err := GenerateToken()
	if err != nil {
		return SignInResult{}, err
	}
	if _, err := s.repo.CreateDevice(ctx, user.ID, deviceName, platform, hash); err != nil {
		return SignInResult{}, err
	}
	_ = s.repo.DeleteCode(ctx, phone)
	return SignInResult{Token: token, User: user}, nil
}

// Authenticate resolves a raw token to a user.
func (s *Service) Authenticate(ctx context.Context, token string) (User, error) {
	return s.repo.UserByTokenHash(ctx, HashToken(token))
}
```

- [ ] **Step 2: Write the service test**

Create `backend/internal/auth/service_test.go`:
```go
package auth

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func newTestService(t *testing.T) *Service {
	pool := postgres.NewTestDB(t)
	return NewService(NewRepo(pool), "12345", func(string, ...any) {})
}

func TestService_RequestAndSignIn(t *testing.T) {
	ctx := context.Background()
	s := newTestService(t)

	if err := s.RequestCode(ctx, "+7 (999) 000-00-00"); err != nil {
		t.Fatalf("RequestCode: %v", err)
	}
	res, err := s.SignIn(ctx, "+79990000000", "12345", "web", "browser")
	if err != nil {
		t.Fatalf("SignIn: %v", err)
	}
	if res.Token == "" || res.User.ID == 0 {
		t.Fatalf("empty result: %+v", res)
	}

	got, err := s.Authenticate(ctx, res.Token)
	if err != nil || got.ID != res.User.ID {
		t.Fatalf("Authenticate = %+v, %v", got, err)
	}
}

func TestService_WrongCode(t *testing.T) {
	ctx := context.Background()
	s := newTestService(t)
	_ = s.RequestCode(ctx, "+79991112233")
	if _, err := s.SignIn(ctx, "+79991112233", "00000", "web", "browser"); err != ErrInvalidCode {
		t.Fatalf("expected ErrInvalidCode, got %v", err)
	}
}

func TestService_NoCodeRequested(t *testing.T) {
	ctx := context.Background()
	s := newTestService(t)
	if _, err := s.SignIn(ctx, "+79994445566", "12345", "web", "browser"); err != ErrInvalidCode {
		t.Fatalf("expected ErrInvalidCode, got %v", err)
	}
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/auth/ -run 'Service' -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/auth/service.go backend/internal/auth/service_test.go
git commit -m "feat(backend): auth service (request_code, sign_in, authenticate)"
```

---

### Task 9: HTTP router + auth handlers

**Files:**
- Create: `backend/internal/transport/http/router.go`
- Create: `backend/internal/transport/http/auth_handler.go`
- Test: `backend/internal/transport/http/auth_handler_test.go`

- [ ] **Step 1: Add chi dependency**

Run: `cd backend && go get github.com/go-chi/chi/v5@latest`
Expected: dependency added.

- [ ] **Step 2: Write the auth handlers**

Create `backend/internal/transport/http/auth_handler.go`:
```go
package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/messenger-denis/backend/internal/auth"
)

type AuthHandler struct{ svc *auth.Service }

func NewAuthHandler(svc *auth.Service) *AuthHandler { return &AuthHandler{svc: svc} }

type requestCodeBody struct {
	Phone string `json:"phone"`
}

func (h *AuthHandler) RequestCode(w http.ResponseWriter, r *http.Request) {
	var body requestCodeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Phone == "" {
		writeError(w, http.StatusBadRequest, "phone is required")
		return
	}
	if err := h.svc.RequestCode(r.Context(), body.Phone); err != nil {
		writeError(w, http.StatusInternalServerError, "could not request code")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type signInBody struct {
	Phone    string `json:"phone"`
	Code     string `json:"code"`
	Device   string `json:"device"`
	Platform string `json:"platform"`
}

func (h *AuthHandler) SignIn(w http.ResponseWriter, r *http.Request) {
	var body signInBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	res, err := h.svc.SignIn(r.Context(), body.Phone, body.Code, body.Device, body.Platform)
	if errors.Is(err, auth.ErrInvalidCode) {
		writeError(w, http.StatusUnauthorized, "invalid code")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "sign in failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token": res.Token,
		"user": map[string]any{
			"id":           res.User.ID,
			"phone":        res.User.Phone,
			"display_name": res.User.DisplayName,
		},
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
```

- [ ] **Step 3: Write the router**

Create `backend/internal/transport/http/router.go`:
```go
package http

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/messenger-denis/backend/internal/auth"
)

func NewRouter(svc *auth.Service) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	authH := NewAuthHandler(svc)
	r.Post("/auth/request_code", authH.RequestCode)
	r.Post("/auth/sign_in", authH.SignIn)

	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	return r
}
```

- [ ] **Step 4: Write the handler test**

Create `backend/internal/transport/http/auth_handler_test.go`:
```go
package http

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/messenger-denis/backend/internal/auth"
	"github.com/messenger-denis/backend/internal/store/postgres"
)

func newTestRouter(t *testing.T) http.Handler {
	pool := postgres.NewTestDB(t)
	svc := auth.NewService(auth.NewRepo(pool), "12345", func(string, ...any) {})
	return NewRouter(svc)
}

func postJSON(t *testing.T, h http.Handler, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	buf, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, path, bytes.NewReader(buf))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestAuthFlow_HTTP(t *testing.T) {
	h := newTestRouter(t)

	rec := postJSON(t, h, "/auth/request_code", map[string]string{"phone": "+79990000000"})
	if rec.Code != http.StatusOK {
		t.Fatalf("request_code status = %d, body=%s", rec.Code, rec.Body.String())
	}

	rec = postJSON(t, h, "/auth/sign_in", map[string]string{
		"phone": "+79990000000", "code": "12345", "device": "web", "platform": "browser",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("sign_in status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Token == "" {
		t.Fatal("expected non-empty token")
	}
}

func TestSignIn_WrongCode_HTTP(t *testing.T) {
	h := newTestRouter(t)
	_ = postJSON(t, h, "/auth/request_code", map[string]string{"phone": "+79991112233"})
	rec := postJSON(t, h, "/auth/sign_in", map[string]string{
		"phone": "+79991112233", "code": "99999",
	})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/transport/http/ -run 'AuthFlow|WrongCode' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/transport/http/ backend/go.mod backend/go.sum
git commit -m "feat(backend): http router and auth handlers"
```

---

### Task 10: Auth middleware + GET /me

**Files:**
- Create: `backend/internal/transport/http/middleware.go`
- Create: `backend/internal/transport/http/me_handler.go`
- Modify: `backend/internal/transport/http/router.go`
- Test: `backend/internal/transport/http/me_handler_test.go`

- [ ] **Step 1: Write the middleware**

Create `backend/internal/transport/http/middleware.go`:
```go
package http

import (
	"context"
	"net/http"
	"strings"

	"github.com/messenger-denis/backend/internal/auth"
)

type ctxKey int

const userKey ctxKey = 0

// AuthMiddleware validates the Bearer token and injects the user into the context.
func AuthMiddleware(svc *auth.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := bearerToken(r)
			if token == "" {
				writeError(w, http.StatusUnauthorized, "missing token")
				return
			}
			user, err := svc.Authenticate(r.Context(), token)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "invalid token")
				return
			}
			ctx := context.WithValue(r.Context(), userKey, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return ""
}

// UserFromContext returns the authenticated user, if any.
func UserFromContext(ctx context.Context) (auth.User, bool) {
	u, ok := ctx.Value(userKey).(auth.User)
	return u, ok
}
```

- [ ] **Step 2: Write the /me handler**

Create `backend/internal/transport/http/me_handler.go`:
```go
package http

import "net/http"

func MeHandler(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":           u.ID,
		"phone":        u.Phone,
		"display_name": u.DisplayName,
	})
}
```

- [ ] **Step 3: Wire the protected route into the router**

In `backend/internal/transport/http/router.go`, add a protected group. Replace the `r.Get("/health", ...)` block with:
```go
	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Group(func(pr chi.Router) {
		pr.Use(AuthMiddleware(svc))
		pr.Get("/me", MeHandler)
	})
	return r
```

- [ ] **Step 4: Write the /me test**

Create `backend/internal/transport/http/me_handler_test.go`:
```go
package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMe_RequiresToken(t *testing.T) {
	h := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/me", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without token, got %d", rec.Code)
	}
}

func TestMe_WithToken(t *testing.T) {
	h := newTestRouter(t)
	_ = postJSON(t, h, "/auth/request_code", map[string]string{"phone": "+79990000000"})
	rec := postJSON(t, h, "/auth/sign_in", map[string]string{
		"phone": "+79990000000", "code": "12345",
	})
	var signin struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &signin)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/me", nil)
	req.Header.Set("Authorization", "Bearer "+signin.Token)
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req)
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 with token, got %d body=%s", rec2.Code, rec2.Body.String())
	}
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/transport/http/ -run 'Me_' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/transport/http/
git commit -m "feat(backend): auth middleware and GET /me"
```

---

### Task 11: main.go wiring + Dockerfile + run verification

**Files:**
- Create: `backend/cmd/server/main.go`
- Create: `backend/Dockerfile`
- Create: `nginx/nginx.conf` (repo root)

- [ ] **Step 1: Write main.go**

Create `backend/cmd/server/main.go`:
```go
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/messenger-denis/backend/internal/auth"
	"github.com/messenger-denis/backend/internal/config"
	httptransport "github.com/messenger-denis/backend/internal/transport/http"
	"github.com/messenger-denis/backend/internal/store/postgres"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if err := postgres.Migrate(cfg.DatabaseURL); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	ctx := context.Background()
	pool, err := postgres.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	svc := auth.NewService(auth.NewRepo(pool), cfg.DevOTPCode, log.Printf)
	srv := &http.Server{Addr: cfg.HTTPAddr, Handler: httptransport.NewRouter(svc)}

	go func() {
		log.Printf("listening on %s", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	log.Println("shut down")
}
```

- [ ] **Step 2: Verify it builds and runs against local Postgres**

Run:
```bash
cd backend && go build ./... && \
DATABASE_URL="postgres://messenger:messenger@localhost:5432/messenger?sslmode=disable" \
go run ./cmd/server &
sleep 2
curl -s localhost:8080/health
curl -s -X POST localhost:8080/auth/request_code -d '{"phone":"+79990000000"}'
curl -s -X POST localhost:8080/auth/sign_in -d '{"phone":"+79990000000","code":"12345"}'
```
Expected: `{"status":"ok"}`, then `{"ok":true}`, then a JSON with a `token`. Stop the server with `kill %1`.

- [ ] **Step 3: Write the Dockerfile**

Create `backend/Dockerfile`:
```dockerfile
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /bin/server ./cmd/server

FROM alpine:latest
RUN apk add --no-cache ca-certificates
COPY --from=build /bin/server /bin/server
EXPOSE 8080
ENTRYPOINT ["/bin/server"]
```

- [ ] **Step 4: Write a basic nginx config**

Create `nginx/nginx.conf` at repo root:
```nginx
events {}
http {
  upstream backend { server backend:8080; }
  server {
    listen 80;
    location /api/ {
      proxy_pass http://backend/;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
    }
  }
}
```

- [ ] **Step 5: Add backend + nginx to docker-compose**

Append to `docker-compose.yml` `services:` (before `volumes:`):
```yaml
  backend:
    build: ./backend
    environment:
      HTTP_ADDR: ":8080"
      DATABASE_URL: "postgres://messenger:messenger@postgres:5432/messenger?sslmode=disable"
      REDIS_URL: "redis://redis:6379"
      DEV_OTP_CODE: "12345"
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }

  nginx:
    image: nginx:alpine
    volumes: ["./nginx/nginx.conf:/etc/nginx/nginx.conf:ro"]
    ports: ["8080:80"]
    depends_on: [backend]
```

- [ ] **Step 6: Verify the full stack via Docker**

Run:
```bash
docker compose up -d --build
sleep 5
curl -s localhost:8080/api/health
curl -s -X POST localhost:8080/api/auth/request_code -d '{"phone":"+700"}'
```
Expected: `{"status":"ok"}` then `{"ok":true}`. Run `docker compose logs backend | grep dev-otp` to see the logged code.

- [ ] **Step 7: Commit**

```bash
git add backend/cmd backend/Dockerfile nginx/ docker-compose.yml
git commit -m "feat(backend): server entrypoint, Dockerfile, nginx proxy, compose wiring"
```

---

## Self-Review Notes

- **Spec coverage:** §2 stack (Go/PG/Redis/MinIO/nginx/docker) — Tasks 1,2,11. §4 users/devices — Task 3. §9 auth (phone+dev-OTP, device sessions, token hash) — Tasks 5–10. §10 project structure — followed. §11 docker (partial; MinIO/Redis scaffolded, fully used in Plans C/D) — Tasks 2,11.
- **Out of scope (later plans):** chats/messages/history/sync (Plan B), Redis/WS/presence/reactions (Plan C), media/web-push (Plan D). Redis & MinIO containers are started now but not yet consumed.
- **Type consistency:** `auth.User`, `auth.Service`, `NewRouter(svc)`, `HashToken`, `GenerateToken`, `UserByTokenHash` used consistently across repo/service/transport tasks.
- **Testing note:** DB tests use `postgres.NewTestDB(t)` which **skips** when Docker is unavailable, so `go test ./...` never hard-fails on machines without Docker; pure-logic tests (config, code, token) always run.
```
