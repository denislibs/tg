# Stories — Plan St-1: Backend

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec: `docs/superpowers/specs/2026-06-24-stories-design.md`.

**Goal:** Stories backend — schema, repo, service (post/feed/view/viewers/delete + privacy/visibility), HTTP, merge + smoke. Backend repo, branch `stories-st1`. New usecase package `internal/usecase/story`.

**Verified:** clean-arch — `usecase/<area>` (interactor + ports) ← `adapter/repo/postgres` + `adapter/delivery/http`; fx wiring in `internal/app/{providers.go,app.go,server.go}`; `NewRouter(...)` builds handlers (mediaH/pushH are optional/nil-safe params). Repos `*pgxpool.Pool`+`querier`; testcontainers `storepostgres.NewTestDB(t)`+`seedUser`. `usecasechat.Interactor.ChatPartners(ctx,userID)([]int64,error)` exists. `MediaAccessRepo.OwnerID(ctx,mediaID)(int64,error)` exists (postgres adapter). `domain.UserCard{ID,Username,DisplayName,AvatarURL}`. Auth handlers use UserFromContext/pathInt/writeJSON/writeError; `Date.Now` not in scope (Go uses time.Now).

---

## Task St1-1: migration 0009 + domain + StoryRepo

**Files:** create `migrations/0009_stories.sql`, `internal/domain/story.go`, `internal/usecase/story/ports.go`, `adapter/repo/postgres/storyrepo.go` (+ test).

- [ ] **Step 1: Branch + migration** — `git checkout -b stories-st1`. `0009_stories.sql`:
```sql
-- +goose Up
CREATE TABLE stories (
  id         BIGSERIAL PRIMARY KEY,
  author_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id   BIGINT NOT NULL,
  caption    TEXT NOT NULL DEFAULT '',
  privacy    TEXT NOT NULL DEFAULT 'contacts',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_stories_author_exp ON stories (author_id, expires_at);
CREATE TABLE story_views (
  story_id  BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, viewer_id)
);
CREATE TABLE story_allow (
  story_id BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (story_id, user_id)
);
-- +goose Down
DROP TABLE story_allow; DROP TABLE story_views; DROP TABLE stories;
```

- [ ] **Step 2: domain** — `internal/domain/story.go`:
```go
package domain
import "time"
type Story struct { ID, AuthorID, MediaID int64; Caption, Privacy string; CreatedAt, ExpiresAt time.Time }
type StoryItem struct { ID, MediaID int64; Caption string; CreatedAt time.Time; Viewed bool }
type StoryGroup struct { Author UserCard; Stories []StoryItem }
```

- [ ] **Step 3: port** — `internal/usecase/story/ports.go`:
```go
package story
import ("context"; "github.com/messenger-denis/backend/internal/domain")
type StoryRepo interface {
	Create(ctx context.Context, s domain.Story, allowIDs []int64) (int64, error)
	ActiveFeed(ctx context.Context, viewerID int64, authorIDs []int64) ([]domain.StoryGroup, error)
	MarkViewed(ctx context.Context, storyID, viewerID int64) error
	Viewers(ctx context.Context, storyID int64) ([]domain.UserCard, error)
	GetAuthor(ctx context.Context, storyID int64) (int64, error) // domain.ErrNotFound
	Delete(ctx context.Context, storyID, authorID int64) error
	Visible(ctx context.Context, storyID, viewerID int64, partnerIDs []int64) (bool, error)
}
```

- [ ] **Step 4: Test** (`storyrepo_test.go`) — author u1 posts a story (privacy 'contacts', expires now+24h) via Create; ActiveFeed(u2, [u1]) returns 1 group with 1 story, Viewed=false; MarkViewed(story,u2) → ActiveFeed shows Viewed=true; Viewers(story)=[u2]; an expired story (expires in the past) does NOT appear; Delete(story,u1) → gone; a 'selected' story with allow=[u2] is visible to u2 (Visible true) but not u3.

- [ ] **Step 5: Implement** `storyrepo.go` (`StoryRepo struct{pool *pgxpool.Pool}` + `NewStoryRepo`; `var _ storyusecase.StoryRepo = (*StoryRepo)(nil)`):
  - `Create`: INSERT story RETURNING id; if privacy='selected' && allowIDs → INSERT story_allow rows (within the caller's tx ideally; the service wraps in tx).
  - `ActiveFeed(viewerID, authorIDs)`: authorIDs already includes the viewer + partners (service builds it). SQL: `SELECT s.id,s.author_id,s.media_id,s.caption,s.created_at, u.id,u.display_name,COALESCE(u.avatar_url,''), (sv.viewer_id IS NOT NULL) AS viewed FROM stories s JOIN users u ON u.id=s.author_id LEFT JOIN story_views sv ON sv.story_id=s.id AND sv.viewer_id=$1 WHERE s.expires_at>now() AND s.author_id = ANY($2) AND (s.author_id=$1 OR s.privacy IN ('everyone','contacts') OR EXISTS(SELECT 1 FROM story_allow sa WHERE sa.story_id=s.id AND sa.user_id=$1)) ORDER BY (s.author_id=$1) DESC, u.display_name, s.created_at`. Group rows by author into []StoryGroup in Go (own group first via the ORDER BY).
  - `MarkViewed`: INSERT story_views ON CONFLICT DO NOTHING.
  - `Viewers`: SELECT users JOIN story_views WHERE story_id ORDER BY viewed_at.
  - `GetAuthor`: SELECT author_id (ErrNotFound on no row).
  - `Delete`: DELETE WHERE id AND author_id.
  - `Visible`: replicate the WHERE predicate for a single story id (used by View).

- [ ] **Step 6: Run + commit** — `cd backend && go build ./... && go test ./internal/adapter/repo/postgres/ -run Story -v` (Docker). Commit `feat(stories): migration 0009 + domain + StoryRepo`.

---

## Task St1-2: StoryService usecase + fx wiring

**Files:** create `internal/usecase/story/service.go` (+ test); modify `internal/app/{providers.go,app.go}`.

- [ ] **Step 1: Ports** — in `ports.go` add:
```go
type Partners interface { ChatPartners(ctx context.Context, userID int64) ([]int64, error) }
type MediaOwner interface { OwnerID(ctx context.Context, mediaID int64) (int64, error) }
```
- [ ] **Step 2: Service** — `service.go`:
```go
type Service struct { repo StoryRepo; partners Partners; media MediaOwner; tx TxManager }
```
(TxManager: reuse the same interface shape as chat — define a local `TxManager interface { WithinTx(ctx, func(ctx) error) error }` in ports.go; the postgres tx manager satisfies it.) Methods:
  - `Post(ctx, authorID, mediaID int64, caption, privacy string, allowIDs []int64) (int64, error)`: validate media owner == authorID (media.OwnerID; else domain.ErrForbidden); default privacy 'contacts'; expires = time-now+24h passed in? — use `time.Now().Add(24h)` (Go time is allowed). tx: repo.Create.
  - `Feed(ctx, viewerID) ([]domain.StoryGroup, error)`: partners,_ := partners.ChatPartners(viewerID); authorIDs = append(partners, viewerID); repo.ActiveFeed(viewerID, authorIDs).
  - `View(ctx, storyID, viewerID) error`: partners := ChatPartners; if !repo.Visible(storyID, viewerID, partners) → ErrForbidden; repo.MarkViewed.
  - `Viewers(ctx, storyID, requesterID) ([]domain.UserCard, error)`: author := repo.GetAuthor; if author != requesterID → ErrForbidden; repo.Viewers.
  - `Delete(ctx, storyID, authorID) error`: repo.Delete (scoped by author_id; if 0 rows → ErrNotFound? keep simple: ok).
- [ ] **Step 3: Tests** (`service_test.go`, fakes): Post with media owned by other → ErrForbidden; owned → ok; Feed returns repo feed for partners+self; View not-visible → ErrForbidden; Viewers by non-author → ErrForbidden, by author → list.
- [ ] **Step 4: fx wiring** — providers.go: `provideStoryRepo(pool)`, `provideStoryService(repo, chatUC /* as Partners */, mediaAccessRepo /* as MediaOwner */, txManager)`. app.go: register providers. (chatUC satisfies Partners via ChatPartners; mediaAccessRepo satisfies MediaOwner via OwnerID; the existing tx manager satisfies TxManager.) Ensure `go build ./...` clean.
- [ ] **Step 5: Run + commit** — `go build ./... && go test ./internal/usecase/story/...`; commit `feat(stories): StoryService (post/feed/view/viewers/delete) + fx wiring`.

---

## Task St1-3: HTTP + docs + merge + smoke

**Files:** create `internal/adapter/delivery/http/story_handler.go` (+ test); modify `router.go` (+ NewRouter param + server.go wiring); contracts/openapi.

- [ ] **Step 1: Handler** — `StoryHandler{svc *storyusecase.Service}`, `NewStoryHandler`, mapErr (Forbidden→403, NotFound→404):
  - `Post` (POST /stories): body `{media_id, caption, privacy, allow_user_ids}` → svc.Post → `{id}`.
  - `Feed` (GET /stories): svc.Feed(me) → `{groups:[{author:{id,display_name,avatar_url}, stories:[{id,media_id,caption,created_at,viewed}]}]}`.
  - `View` (POST /stories/{id}/view) → `{ok}`.
  - `Viewers` (GET /stories/{id}/viewers) → `{viewers:[{id,display_name,avatar_url}], count}`.
  - `Delete` (DELETE /stories/{id}) → `{ok}`.
- [ ] **Step 2: Routes + wiring** — add a `storyH *StoryHandler` param to `NewRouter` (nil-safe like mediaH); in the Bearer group `if storyH != nil { pr.Post("/stories", storyH.Post); pr.Get("/stories", storyH.Feed); pr.Post("/stories/{storyID}/view", storyH.View); pr.Get("/stories/{storyID}/viewers", storyH.Viewers); pr.Delete("/stories/{storyID}", storyH.Delete) }`. Wire StoryHandler in server.go/providers (build from the StoryService) and pass to NewRouter. Update other NewRouter call sites (tests) with nil.
- [ ] **Step 3: Handler test** — A signs up, uploads media (or insert a media row owned by A — reuse the media handler test helper if any; else POST /media/upload), posts a story; B (a chat partner of A — create a private chat A↔B first) GET /stories → sees A's story; B POST view; A GET viewers → [B]; B GET viewers → 403; A delete → gone.
- [ ] **Step 4: docs** — contracts.md + openapi: the 5 endpoints.
- [ ] **Step 5: Suite + merge** — `cd backend && go build ./... && go vet ./... && go test ./...` all green; commit docs; `git checkout master && git merge --no-ff stories-st1 -m "Merge stories-st1: stories backend (post/feed/view/viewers + privacy)"`.
- [ ] **Step 6: Smoke (:38080)** — rebuild verify backend; A↔B private chat exists; A uploads a tiny image (POST /media/upload + PUT content), A POST /stories {media_id, caption, privacy:"contacts"}; B GET /stories → A's story (viewed=false); B POST view; A GET viewers → B; A GET /stories includes own group. (Use `ST`/`MID`, avoid `GID`.)

## Self-review
- New `usecase/story` package (clean-arch); reuses ChatPartners (Partners port) + MediaAccessRepo.OwnerID (MediaOwner) + tx. Privacy visibility in repo SQL (own/everyone/contacts/selected-allow). 24h TTL via expires_at filtered on read. Viewers author-gated. ✓
