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

func TestStoryRepo_Reactions(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewStoryRepo(pool)
	ctx := context.Background()
	u1 := seedUser(t, pool, "+930") // author
	u2 := seedUser(t, pool, "+931") // reactor

	future := time.Now().Add(24 * time.Hour)
	storyID := createStory(t, pool, u1, "everyone", future, nil)

	// Set a reaction.
	if err := repo.SetReaction(ctx, storyID, u2, "👍"); err != nil {
		t.Fatalf("SetReaction: %v", err)
	}
	if n, err := repo.ReactionsCount(ctx, storyID); err != nil || n != 1 {
		t.Fatalf("ReactionsCount = %d, %v; want 1", n, err)
	}

	// Feed reflects the aggregate for the reactor.
	groups, err := repo.ActiveFeed(ctx, u2, []int64{u1})
	if err != nil || len(groups) != 1 || len(groups[0].Stories) != 1 {
		t.Fatalf("feed: %+v, %v", groups, err)
	}
	it := groups[0].Stories[0]
	if it.ReactionsCount != 1 || it.MyReaction != "👍" {
		t.Fatalf("feed item = %+v; want count 1 / my 👍", it)
	}
	if len(it.Reactions) != 1 || it.Reactions[0].Emoji != "👍" || it.Reactions[0].Count != 1 || !it.Reactions[0].Mine {
		t.Fatalf("feed reactions breakdown = %+v", it.Reactions)
	}

	// Author's feed sees the count but no personal reaction.
	ag, _ := repo.ActiveFeed(ctx, u1, []int64{u1})
	if ag[0].Stories[0].ReactionsCount != 1 || ag[0].Stories[0].MyReaction != "" {
		t.Fatalf("author feed item = %+v; want count 1 / my empty", ag[0].Stories[0])
	}

	// Replace the reaction (upsert): count stays 1, emoji changes.
	if err := repo.SetReaction(ctx, storyID, u2, "❤"); err != nil {
		t.Fatalf("SetReaction replace: %v", err)
	}
	if n, _ := repo.ReactionsCount(ctx, storyID); n != 1 {
		t.Fatalf("count after replace = %d; want 1", n)
	}

	// Stats include reactions.
	st, err := repo.Stats(ctx, storyID)
	if err != nil {
		t.Fatalf("Stats: %v", err)
	}
	if st.ReactionsTotal != 1 || len(st.Reactions) != 1 || st.Reactions[0].Emoji != "❤" {
		t.Fatalf("stats reactions = total %d / %+v", st.ReactionsTotal, st.Reactions)
	}

	// Remove the reaction: count drops to 0.
	if err := repo.RemoveReaction(ctx, storyID, u2); err != nil {
		t.Fatalf("RemoveReaction: %v", err)
	}
	if n, _ := repo.ReactionsCount(ctx, storyID); n != 0 {
		t.Fatalf("count after remove = %d; want 0", n)
	}
}

func TestStoryRepo_CloseFriends_SetGetAndVisibility(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewStoryRepo(pool)
	ctx := context.Background()
	author := seedUser(t, pool, "+940")
	friend := seedUser(t, pool, "+941")
	stranger := seedUser(t, pool, "+942")

	if err := repo.SetCloseFriends(ctx, author, []int64{friend}); err != nil {
		t.Fatalf("SetCloseFriends: %v", err)
	}
	got, err := repo.CloseFriends(ctx, author)
	if err != nil || len(got) != 1 || got[0] != friend {
		t.Fatalf("CloseFriends = %v, %v; want [%d]", got, err, friend)
	}

	future := time.Now().Add(24 * time.Hour)
	storyID := createStory(t, pool, author, "close", future, nil)

	// Close friend sees it; a stranger does not.
	if ok, _ := repo.Visible(ctx, storyID, friend, nil); !ok {
		t.Fatal("close friend should see the close story")
	}
	if ok, _ := repo.Visible(ctx, storyID, stranger, nil); ok {
		t.Fatal("stranger should NOT see the close story")
	}

	// Replacement drops the old friend.
	if err := repo.SetCloseFriends(ctx, author, []int64{stranger}); err != nil {
		t.Fatalf("SetCloseFriends replace: %v", err)
	}
	if ok, _ := repo.Visible(ctx, storyID, friend, nil); ok {
		t.Fatal("former close friend should no longer see the close story")
	}
	if ok, _ := repo.Visible(ctx, storyID, stranger, nil); !ok {
		t.Fatal("new close friend should see the close story")
	}
}

// TestStoryRepo_Feed_CloseFriendNonPartner: зритель, состоящий в close_friends
// автора, видит его 'close'-историю в ленте, даже если автор не является его
// чат-партнёром (не входит в переданный authorIDs). Посторонний — не видит.
func TestStoryRepo_Feed_CloseFriendNonPartner(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewStoryRepo(pool)
	ctx := context.Background()
	author := seedUser(t, pool, "+945")
	friend := seedUser(t, pool, "+946")   // close friend, но НЕ чат-партнёр
	stranger := seedUser(t, pool, "+947") // ни то, ни другое

	if err := repo.SetCloseFriends(ctx, author, []int64{friend}); err != nil {
		t.Fatalf("SetCloseFriends: %v", err)
	}
	future := time.Now().Add(24 * time.Hour)
	closeID := createStory(t, pool, author, "close", future, nil)

	// friend не партнёр: authorIDs не содержит author (только сам friend), но
	// close-история автора всё равно всплывает в его ленте.
	groups, err := repo.ActiveFeed(ctx, friend, []int64{friend})
	if err != nil {
		t.Fatalf("ActiveFeed(friend): %v", err)
	}
	if len(groups) != 1 || len(groups[0].Stories) != 1 || groups[0].Stories[0].ID != closeID {
		t.Fatalf("friend feed = %+v; want the close story %d", groups, closeID)
	}
	if groups[0].Author.ID != author {
		t.Fatalf("group author = %d; want %d", groups[0].Author.ID, author)
	}

	// Посторонний (не close, не партнёр) close-историю не видит.
	sg, err := repo.ActiveFeed(ctx, stranger, []int64{stranger})
	if err != nil {
		t.Fatalf("ActiveFeed(stranger): %v", err)
	}
	if len(sg) != 0 {
		t.Fatalf("stranger feed = %+v; want empty", sg)
	}

	// А 'everyone'-история автора-не-партнёра НЕ должна всплывать у постороннего
	// (иначе лента забьётся историями незнакомцев).
	_ = createStory(t, pool, author, "everyone", future, nil)
	sg, _ = repo.ActiveFeed(ctx, stranger, []int64{stranger})
	if len(sg) != 0 {
		t.Fatalf("stranger feed (everyone from non-partner) = %+v; want empty", sg)
	}
}

// TestStoryRepo_Feed_SelectedNonPartner: allow-listed зритель видит 'selected'-
// историю автора-не-партнёра в ленте.
func TestStoryRepo_Feed_SelectedNonPartner(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewStoryRepo(pool)
	ctx := context.Background()
	author := seedUser(t, pool, "+955")
	allowed := seedUser(t, pool, "+956")
	other := seedUser(t, pool, "+957")

	future := time.Now().Add(24 * time.Hour)
	selID := createStory(t, pool, author, "selected", future, []int64{allowed})

	g, err := repo.ActiveFeed(ctx, allowed, []int64{allowed})
	if err != nil {
		t.Fatalf("ActiveFeed(allowed): %v", err)
	}
	if len(g) != 1 || len(g[0].Stories) != 1 || g[0].Stories[0].ID != selID {
		t.Fatalf("allowed feed = %+v; want selected story %d", g, selID)
	}
	og, _ := repo.ActiveFeed(ctx, other, []int64{other})
	if len(og) != 0 {
		t.Fatalf("non-allowlisted feed = %+v; want empty", og)
	}
}

func TestStoryRepo_Archive_OwnExpiredOnly(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewStoryRepo(pool)
	ctx := context.Background()
	u1 := seedUser(t, pool, "+950")
	u2 := seedUser(t, pool, "+951")

	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)
	expired := createStory(t, pool, u1, "everyone", past, nil)
	_ = createStory(t, pool, u1, "everyone", future, nil) // active — not in archive
	_ = createStory(t, pool, u2, "everyone", past, nil)   // other user's — not in archive

	items, err := repo.Archive(ctx, u1, 50, 0)
	if err != nil {
		t.Fatalf("Archive: %v", err)
	}
	if len(items) != 1 || items[0].ID != expired {
		t.Fatalf("archive = %+v; want only expired story %d", items, expired)
	}
}

func TestStoryRepo_Pinned_IncludesExpired(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewStoryRepo(pool)
	ctx := context.Background()
	author := seedUser(t, pool, "+960")
	viewer := seedUser(t, pool, "+961")

	past := time.Now().Add(-time.Hour)
	expiredPinned := createStory(t, pool, author, "everyone", past, nil)
	_ = createStory(t, pool, author, "everyone", past, nil) // not pinned

	if err := repo.SetPinned(ctx, expiredPinned, author, true); err != nil {
		t.Fatalf("SetPinned: %v", err)
	}
	items, err := repo.Pinned(ctx, author, viewer)
	if err != nil {
		t.Fatalf("Pinned: %v", err)
	}
	if len(items) != 1 || items[0].ID != expiredPinned || !items[0].Pinned {
		t.Fatalf("pinned = %+v; want only pinned expired story %d", items, expiredPinned)
	}
}

func TestStoryRepo_Edit_CaptionPrivacyAndFlag(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewStoryRepo(pool)
	ctx := context.Background()
	author := seedUser(t, pool, "+970")
	allowed := seedUser(t, pool, "+971")
	viewer := seedUser(t, pool, "+972")

	future := time.Now().Add(24 * time.Hour)
	storyID := createStory(t, pool, author, "everyone", future, nil)

	newCap := "edited caption"
	newPriv := "selected"
	if err := repo.Edit(ctx, storyID, author, &newCap, &newPriv, []int64{allowed}); err != nil {
		t.Fatalf("Edit: %v", err)
	}

	// edited flag + new privacy reflected in the author's own feed; caption updated.
	ag, _ := repo.ActiveFeed(ctx, author, []int64{author})
	if len(ag) != 1 || len(ag[0].Stories) != 1 {
		t.Fatalf("author feed shape: %+v", ag)
	}
	it := ag[0].Stories[0]
	if !it.Edited || it.Caption != newCap || it.Privacy != "selected" {
		t.Fatalf("edited item = %+v; want edited/selected/%q", it, newCap)
	}

	// Now selected → only the allowlisted user sees it.
	if ok, _ := repo.Visible(ctx, storyID, allowed, nil); !ok {
		t.Fatal("allowlisted user should see the edited selected story")
	}
	if ok, _ := repo.Visible(ctx, storyID, viewer, nil); ok {
		t.Fatal("non-allowlisted user should NOT see the edited selected story")
	}
}

func TestStoryRepo_PurgeRecentViews(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewStoryRepo(pool)
	ctx := context.Background()
	author := seedUser(t, pool, "+980")
	viewer := seedUser(t, pool, "+981")

	future := time.Now().Add(24 * time.Hour)
	storyID := createStory(t, pool, author, "everyone", future, nil)
	if err := repo.MarkViewed(ctx, storyID, viewer); err != nil {
		t.Fatalf("MarkViewed: %v", err)
	}

	if err := repo.PurgeRecentViews(ctx, viewer, time.Now().Add(-5*time.Minute)); err != nil {
		t.Fatalf("PurgeRecentViews: %v", err)
	}
	viewers, _ := repo.Viewers(ctx, storyID)
	if len(viewers) != 0 {
		t.Fatalf("view should be purged, got %+v", viewers)
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
