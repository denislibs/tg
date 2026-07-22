package story

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// --- fakes ---

type fakeRepo struct {
	createStory   domain.Story
	createAllow   []int64
	createID      int64
	createErr     error
	feedArgView   int64
	feedArgAuthor []int64
	feedGroups    []domain.StoryGroup
	feedErr       error
	visible       bool
	visibleErr    error
	marked        bool
	markErr       error
	author        int64
	authorErr     error
	viewers       []domain.UserCard
	viewersErr    error
	stats         domain.StoryStats
	statsErr      error
	deleted       bool
	deleteErr     error
}

func (f *fakeRepo) Create(ctx context.Context, s domain.Story, allowIDs []int64) (int64, error) {
	f.createStory = s
	f.createAllow = allowIDs
	return f.createID, f.createErr
}
func (f *fakeRepo) ActiveFeed(ctx context.Context, viewerID int64, authorIDs []int64) ([]domain.StoryGroup, error) {
	f.feedArgView = viewerID
	f.feedArgAuthor = authorIDs
	return f.feedGroups, f.feedErr
}
func (f *fakeRepo) MarkViewed(ctx context.Context, storyID, viewerID int64) error {
	f.marked = true
	return f.markErr
}
func (f *fakeRepo) Viewers(ctx context.Context, storyID int64) ([]domain.UserCard, error) {
	return f.viewers, f.viewersErr
}
func (f *fakeRepo) GetAuthor(ctx context.Context, storyID int64) (int64, error) {
	return f.author, f.authorErr
}
func (f *fakeRepo) Stats(ctx context.Context, storyID int64) (domain.StoryStats, error) {
	return f.stats, f.statsErr
}
func (f *fakeRepo) Delete(ctx context.Context, storyID, authorID int64) error {
	f.deleted = true
	return f.deleteErr
}
func (f *fakeRepo) Visible(ctx context.Context, storyID, viewerID int64, partnerIDs []int64) (bool, error) {
	return f.visible, f.visibleErr
}

type fakePartners struct {
	ids []int64
	err error
}

func (f *fakePartners) ChatPartners(ctx context.Context, userID int64) ([]int64, error) {
	return f.ids, f.err
}

type fakeMedia struct {
	owner int64
	err   error
}

func (f *fakeMedia) OwnerID(ctx context.Context, mediaID int64) (int64, error) {
	return f.owner, f.err
}

type fakeTx struct{ called bool }

func (f *fakeTx) WithinTx(ctx context.Context, fn func(ctx context.Context) error) error {
	f.called = true
	return fn(ctx)
}

// --- tests ---

func TestPost_ForbiddenWhenOtherOwner(t *testing.T) {
	repo := &fakeRepo{}
	svc := New(repo, &fakePartners{}, &fakeMedia{owner: 99}, &fakeTx{})
	_, err := svc.Post(context.Background(), 1, 7, "hi", "contacts", nil)
	if !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
}

func TestPost_OK_DefaultPrivacyAndExpiry(t *testing.T) {
	repo := &fakeRepo{createID: 42}
	tx := &fakeTx{}
	svc := New(repo, &fakePartners{}, &fakeMedia{owner: 1}, tx)
	before := time.Now()
	id, err := svc.Post(context.Background(), 1, 7, "hi", "", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != 42 {
		t.Fatalf("want id 42, got %d", id)
	}
	if !tx.called {
		t.Fatal("expected Create to run within tx")
	}
	if repo.createStory.Privacy != "contacts" {
		t.Fatalf("want default privacy contacts, got %q", repo.createStory.Privacy)
	}
	if repo.createStory.AuthorID != 1 || repo.createStory.MediaID != 7 || repo.createStory.Caption != "hi" {
		t.Fatalf("unexpected story: %+v", repo.createStory)
	}
	if !repo.createStory.ExpiresAt.After(before.Add(23 * time.Hour)) {
		t.Fatalf("want ExpiresAt ~24h in the future, got %v", repo.createStory.ExpiresAt)
	}
}

func TestFeed_AuthorIDsIncludeViewer(t *testing.T) {
	repo := &fakeRepo{feedGroups: []domain.StoryGroup{{}}}
	svc := New(repo, &fakePartners{ids: []int64{2, 3}}, &fakeMedia{}, &fakeTx{})
	groups, err := svc.Feed(context.Background(), 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(groups) != 1 {
		t.Fatalf("want 1 group, got %d", len(groups))
	}
	if repo.feedArgView != 1 {
		t.Fatalf("want viewer 1, got %d", repo.feedArgView)
	}
	want := []int64{2, 3, 1}
	if !reflect.DeepEqual(repo.feedArgAuthor, want) {
		t.Fatalf("want authorIDs %v, got %v", want, repo.feedArgAuthor)
	}
}

func TestView_NotVisible_Forbidden(t *testing.T) {
	repo := &fakeRepo{visible: false}
	svc := New(repo, &fakePartners{ids: []int64{2}}, &fakeMedia{}, &fakeTx{})
	err := svc.View(context.Background(), 5, 1)
	if !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
	if repo.marked {
		t.Fatal("should not mark viewed when not visible")
	}
}

func TestView_Visible_MarksViewed(t *testing.T) {
	repo := &fakeRepo{visible: true}
	svc := New(repo, &fakePartners{ids: []int64{2}}, &fakeMedia{}, &fakeTx{})
	if err := svc.View(context.Background(), 5, 1); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !repo.marked {
		t.Fatal("expected MarkViewed to be called")
	}
}

func TestViewers_NonAuthor_Forbidden(t *testing.T) {
	repo := &fakeRepo{author: 99}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	_, err := svc.Viewers(context.Background(), 5, 1)
	if !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
}

func TestViewers_Author_ReturnsList(t *testing.T) {
	repo := &fakeRepo{author: 1, viewers: []domain.UserCard{{ID: 2}}}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	got, err := svc.Viewers(context.Background(), 5, 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0].ID != 2 {
		t.Fatalf("unexpected viewers: %+v", got)
	}
}

func TestStats_NonAuthor_Forbidden(t *testing.T) {
	repo := &fakeRepo{author: 99}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	_, err := svc.Stats(context.Background(), 5, 1)
	if !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
}

func TestStats_Author_ReturnsStats(t *testing.T) {
	repo := &fakeRepo{author: 1, stats: domain.StoryStats{Views: 7}}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	got, err := svc.Stats(context.Background(), 5, 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Views != 7 {
		t.Fatalf("Views: want 7, got %d", got.Views)
	}
}
