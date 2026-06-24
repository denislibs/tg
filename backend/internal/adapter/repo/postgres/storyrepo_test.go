package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// createStory inserts a story via StoryRepo.Create and returns its id. media_id
// has no FK (the migration intentionally omits one), so any int is accepted.
func createStory(t *testing.T, pool *pgxpool.Pool, authorID int64, privacy string, expiresAt time.Time, allowIDs []int64) int64 {
	t.Helper()
	repo := NewStoryRepo(pool)
	id, err := repo.Create(context.Background(), domain.Story{
		AuthorID:  authorID,
		MediaID:   42,
		Caption:   "hi",
		Privacy:   privacy,
		ExpiresAt: expiresAt,
	}, allowIDs)
	if err != nil {
		t.Fatalf("createStory: %v", err)
	}
	return id
}

func TestStoryRepo_FeedViewViewersDelete(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewStoryRepo(pool)
	ctx := context.Background()
	u1 := seedUser(t, pool, "+900")
	u2 := seedUser(t, pool, "+901")

	future := time.Now().Add(24 * time.Hour)
	storyID := createStory(t, pool, u1, "contacts", future, nil)

	// u2 sees u1's contacts story, unviewed.
	groups, err := repo.ActiveFeed(ctx, u2, []int64{u1})
	if err != nil {
		t.Fatalf("ActiveFeed: %v", err)
	}
	if len(groups) != 1 || len(groups[0].Stories) != 1 {
		t.Fatalf("feed = %+v; want 1 group with 1 story", groups)
	}
	if groups[0].Author.ID != u1 {
		t.Fatalf("group author = %d; want %d", groups[0].Author.ID, u1)
	}
	if groups[0].Stories[0].ID != storyID || groups[0].Stories[0].Viewed {
		t.Fatalf("story = %+v; want id %d viewed=false", groups[0].Stories[0], storyID)
	}

	// Mark viewed -> feed reflects Viewed=true.
	if err := repo.MarkViewed(ctx, storyID, u2); err != nil {
		t.Fatalf("MarkViewed: %v", err)
	}
	if err := repo.MarkViewed(ctx, storyID, u2); err != nil {
		t.Fatalf("MarkViewed (idempotent): %v", err)
	}
	groups, _ = repo.ActiveFeed(ctx, u2, []int64{u1})
	if len(groups) != 1 || !groups[0].Stories[0].Viewed {
		t.Fatalf("feed after view = %+v; want viewed=true", groups)
	}

	// Viewers lists u2.
	viewers, err := repo.Viewers(ctx, storyID)
	if err != nil {
		t.Fatalf("Viewers: %v", err)
	}
	if len(viewers) != 1 || viewers[0].ID != u2 {
		t.Fatalf("viewers = %+v; want [%d]", viewers, u2)
	}

	// GetAuthor returns u1.
	author, err := repo.GetAuthor(ctx, storyID)
	if err != nil || author != u1 {
		t.Fatalf("GetAuthor = %d, %v; want %d", author, err, u1)
	}

	// Delete by author removes it from the feed.
	if err := repo.Delete(ctx, storyID, u1); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	groups, _ = repo.ActiveFeed(ctx, u2, []int64{u1})
	if len(groups) != 0 {
		t.Fatalf("feed after delete = %+v; want empty", groups)
	}
}

func TestStoryRepo_ExpiredHidden(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewStoryRepo(pool)
	ctx := context.Background()
	u1 := seedUser(t, pool, "+910")
	u2 := seedUser(t, pool, "+911")

	past := time.Now().Add(-1 * time.Hour)
	_ = createStory(t, pool, u1, "contacts", past, nil)

	groups, err := repo.ActiveFeed(ctx, u2, []int64{u1})
	if err != nil {
		t.Fatalf("ActiveFeed: %v", err)
	}
	if len(groups) != 0 {
		t.Fatalf("expired story should be hidden, got %+v", groups)
	}
}

func TestStoryRepo_Visible_SelectedAllowlist(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewStoryRepo(pool)
	ctx := context.Background()
	u1 := seedUser(t, pool, "+920")
	u2 := seedUser(t, pool, "+921")
	u3 := seedUser(t, pool, "+922")

	future := time.Now().Add(24 * time.Hour)
	storyID := createStory(t, pool, u1, "selected", future, []int64{u2})

	// u2 is on the allowlist -> visible.
	ok, err := repo.Visible(ctx, storyID, u2, nil)
	if err != nil {
		t.Fatalf("Visible(u2): %v", err)
	}
	if !ok {
		t.Fatal("u2 should see the selected story")
	}
	// u3 is not on the allowlist -> not visible.
	ok, err = repo.Visible(ctx, storyID, u3, nil)
	if err != nil {
		t.Fatalf("Visible(u3): %v", err)
	}
	if ok {
		t.Fatal("u3 should NOT see the selected story")
	}
	// Author always sees own story.
	ok, _ = repo.Visible(ctx, storyID, u1, nil)
	if !ok {
		t.Fatal("author should see own story")
	}

	// ActiveFeed honors the allowlist too: u2 sees it, u3 does not.
	g2, _ := repo.ActiveFeed(ctx, u2, []int64{u1})
	if len(g2) != 1 {
		t.Fatalf("u2 feed = %+v; want 1 group", g2)
	}
	g3, _ := repo.ActiveFeed(ctx, u3, []int64{u1})
	if len(g3) != 0 {
		t.Fatalf("u3 feed = %+v; want empty", g3)
	}
}

func TestStoryRepo_GetAuthor_NotFound(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewStoryRepo(pool)
	ctx := context.Background()
	if _, err := repo.GetAuthor(ctx, 999999); err != domain.ErrNotFound {
		t.Fatalf("GetAuthor(absent) = %v; want ErrNotFound", err)
	}
}
