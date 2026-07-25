package story

import (
	"context"
	"errors"
	"reflect"
	"strings"
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

	setReaction    string
	setCalled      bool
	setErr         error
	removeCalled   bool
	removeErr      error
	reactionsCount int
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
func (f *fakeRepo) SetReaction(ctx context.Context, storyID, userID int64, reaction string) error {
	f.setCalled = true
	f.setReaction = reaction
	return f.setErr
}
func (f *fakeRepo) RemoveReaction(ctx context.Context, storyID, userID int64) error {
	f.removeCalled = true
	return f.removeErr
}
func (f *fakeRepo) ReactionsCount(ctx context.Context, storyID int64) (int, error) {
	return f.reactionsCount, nil
}

type fakePublisher struct {
	frames map[int64][][]byte
}

func newFakePublisher() *fakePublisher { return &fakePublisher{frames: map[int64][][]byte{}} }

func (f *fakePublisher) PublishToUser(ctx context.Context, userID int64, frame []byte) error {
	f.frames[userID] = append(f.frames[userID], frame)
	return nil
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
	_, err := svc.Post(context.Background(), 1, 7, "hi", "contacts", nil, 0)
	if !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
}

func TestPost_OK_DefaultPrivacyAndExpiry(t *testing.T) {
	repo := &fakeRepo{createID: 42}
	tx := &fakeTx{}
	svc := New(repo, &fakePartners{}, &fakeMedia{owner: 1}, tx)
	before := time.Now()
	id, err := svc.Post(context.Background(), 1, 7, "hi", "", nil, 0)
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

func TestPost_PeriodToExpiry(t *testing.T) {
	cases := []struct {
		period int64
		want   time.Duration
	}{
		{21600, 6 * time.Hour},
		{43200, 12 * time.Hour},
		{86400, 24 * time.Hour},
		{172800, 48 * time.Hour},
		{0, 24 * time.Hour},   // unset -> default
		{999, 24 * time.Hour}, // invalid -> default
	}
	for _, c := range cases {
		repo := &fakeRepo{createID: 1}
		svc := New(repo, &fakePartners{}, &fakeMedia{owner: 1}, &fakeTx{})
		before := time.Now()
		if _, err := svc.Post(context.Background(), 1, 7, "hi", "everyone", nil, c.period); err != nil {
			t.Fatalf("period %d: %v", c.period, err)
		}
		got := repo.createStory.ExpiresAt.Sub(before)
		// Allow a small window for execution time.
		if got < c.want-time.Minute || got > c.want+time.Minute {
			t.Fatalf("period %d: expiry delta = %v, want ~%v", c.period, got, c.want)
		}
	}
}

func TestPost_BroadcastsStoryNew(t *testing.T) {
	repo := &fakeRepo{createID: 42}
	pub := newFakePublisher()
	svc := New(repo, &fakePartners{ids: []int64{2, 3}}, &fakeMedia{owner: 1}, &fakeTx{})
	svc.SetPublisher(pub)
	if _, err := svc.Post(context.Background(), 1, 7, "hi", "contacts", nil, 0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// contacts/everyone -> partners (2,3) + author (1).
	for _, uid := range []int64{1, 2, 3} {
		if len(pub.frames[uid]) != 1 {
			t.Fatalf("user %d: want 1 story_new frame, got %d", uid, len(pub.frames[uid]))
		}
	}
}

func TestPost_SelectedBroadcastsToAllowlist(t *testing.T) {
	repo := &fakeRepo{createID: 42}
	pub := newFakePublisher()
	// Partners would be 9, but selected must target the allowlist only (+author).
	svc := New(repo, &fakePartners{ids: []int64{9}}, &fakeMedia{owner: 1}, &fakeTx{})
	svc.SetPublisher(pub)
	if _, err := svc.Post(context.Background(), 1, 7, "hi", "selected", []int64{2}, 0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(pub.frames[2]) != 1 || len(pub.frames[1]) != 1 {
		t.Fatalf("want story_new to allowlisted 2 and author 1")
	}
	if len(pub.frames[9]) != 0 {
		t.Fatalf("selected story must not reach non-allowlisted partner 9")
	}
}

func TestSetReaction_NotVisible_Forbidden(t *testing.T) {
	repo := &fakeRepo{visible: false}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	err := svc.SetReaction(context.Background(), 5, 1, "👍")
	if !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
	if repo.setCalled {
		t.Fatal("should not set reaction when not visible")
	}
}

func TestSetReaction_InvalidEmoji_BadReaction(t *testing.T) {
	repo := &fakeRepo{visible: true}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	if err := svc.SetReaction(context.Background(), 5, 1, ""); !errors.Is(err, domain.ErrBadReaction) {
		t.Fatalf("want ErrBadReaction, got %v", err)
	}
}

func TestSetReaction_OK_UpsertsAndNotifiesAuthor(t *testing.T) {
	repo := &fakeRepo{visible: true, author: 10, reactionsCount: 3}
	pub := newFakePublisher()
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	svc.SetPublisher(pub)
	if err := svc.SetReaction(context.Background(), 5, 1, "👍"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !repo.setCalled || repo.setReaction != "👍" {
		t.Fatalf("expected SetReaction with 👍, got called=%v r=%q", repo.setCalled, repo.setReaction)
	}
	if len(pub.frames[10]) != 1 {
		t.Fatalf("expected story_reaction to author 10, got %d", len(pub.frames[10]))
	}
}

func TestRemoveReaction_OK_NotifiesAuthor(t *testing.T) {
	repo := &fakeRepo{visible: true, author: 10, reactionsCount: 0}
	pub := newFakePublisher()
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	svc.SetPublisher(pub)
	if err := svc.RemoveReaction(context.Background(), 5, 1); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !repo.removeCalled {
		t.Fatal("expected RemoveReaction to be called")
	}
	if len(pub.frames[10]) != 1 {
		t.Fatalf("expected story_reaction to author 10, got %d", len(pub.frames[10]))
	}
}

func TestRemoveReaction_NotVisible_Forbidden(t *testing.T) {
	repo := &fakeRepo{visible: false}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	if err := svc.RemoveReaction(context.Background(), 5, 1); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
	if repo.removeCalled {
		t.Fatal("should not remove reaction when not visible")
	}
}

func TestDelete_BroadcastsStoryDeleted(t *testing.T) {
	repo := &fakeRepo{author: 1}
	pub := newFakePublisher()
	svc := New(repo, &fakePartners{ids: []int64{2}}, &fakeMedia{}, &fakeTx{})
	svc.SetPublisher(pub)
	if err := svc.Delete(context.Background(), 5, 1); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !repo.deleted {
		t.Fatal("expected Delete to be called")
	}
	// author (1) + partner (2).
	if len(pub.frames[1]) != 1 || len(pub.frames[2]) != 1 {
		t.Fatalf("expected story_deleted to author 1 and partner 2")
	}
}

func TestDelete_NonAuthor_ForbiddenNoBroadcast(t *testing.T) {
	repo := &fakeRepo{author: 99}
	pub := newFakePublisher()
	svc := New(repo, &fakePartners{ids: []int64{2}}, &fakeMedia{}, &fakeTx{})
	svc.SetPublisher(pub)
	if err := svc.Delete(context.Background(), 5, 1); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
	if repo.deleted {
		t.Fatal("must not delete another user's story")
	}
	if len(pub.frames[1]) != 0 || len(pub.frames[2]) != 0 {
		t.Fatal("must not broadcast story_deleted for a forbidden delete")
	}
}

func TestDelete_NotFound_NoBroadcast(t *testing.T) {
	repo := &fakeRepo{authorErr: domain.ErrNotFound}
	pub := newFakePublisher()
	svc := New(repo, &fakePartners{ids: []int64{2}}, &fakeMedia{}, &fakeTx{})
	svc.SetPublisher(pub)
	if err := svc.Delete(context.Background(), 5, 1); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
	if repo.deleted {
		t.Fatal("must not delete a missing story")
	}
	if len(pub.frames[1]) != 0 {
		t.Fatal("must not broadcast story_deleted for a missing story")
	}
}

func TestPost_CaptionTooLong(t *testing.T) {
	repo := &fakeRepo{createID: 1}
	svc := New(repo, &fakePartners{}, &fakeMedia{owner: 1}, &fakeTx{})
	longCaption := strings.Repeat("а", maxCaptionRunes+1)
	if _, err := svc.Post(context.Background(), 1, 7, longCaption, "contacts", nil, 0); !errors.Is(err, domain.ErrTooLong) {
		t.Fatalf("want ErrTooLong, got %v", err)
	}
	if (repo.createStory != domain.Story{}) {
		t.Fatal("must not create a story with an oversized caption")
	}
}
