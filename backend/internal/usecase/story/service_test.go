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

	closeFriends    []int64
	closeFriendsErr error
	setCloseArg     []int64
	setCloseErr     error
	pinnedCalled    bool
	pinnedArg       bool
	pinnedErr       error
	editCalled      bool
	editCaption     *string
	editPrivacy     *string
	editAllow       []int64
	editErr         error
	allowIDsByStory map[int64][]int64
	allowIDsErr     error
	archiveItems    []domain.StoryItem
	archiveErr      error
	pinnedItems     []domain.StoryItem
	pinnedItemsErr  error
	purgedSince     time.Time
	purgeCalled     bool
	purgeErr        error
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
func (f *fakeRepo) CloseFriends(ctx context.Context, ownerID int64) ([]int64, error) {
	return f.closeFriends, f.closeFriendsErr
}
func (f *fakeRepo) SetCloseFriends(ctx context.Context, ownerID int64, userIDs []int64) error {
	f.setCloseArg = userIDs
	return f.setCloseErr
}
func (f *fakeRepo) SetPinned(ctx context.Context, storyID, authorID int64, pinned bool) error {
	f.pinnedCalled = true
	f.pinnedArg = pinned
	return f.pinnedErr
}
func (f *fakeRepo) Edit(ctx context.Context, storyID, authorID int64, caption, privacy *string, allowIDs []int64) error {
	f.editCalled = true
	f.editCaption = caption
	f.editPrivacy = privacy
	f.editAllow = allowIDs
	return f.editErr
}
func (f *fakeRepo) AllowIDs(ctx context.Context, storyID int64) ([]int64, error) {
	return f.allowIDsByStory[storyID], f.allowIDsErr
}
func (f *fakeRepo) Archive(ctx context.Context, ownerID, limit, offsetID int64) ([]domain.StoryItem, error) {
	return f.archiveItems, f.archiveErr
}
func (f *fakeRepo) Pinned(ctx context.Context, peerID, viewerID int64) ([]domain.StoryItem, error) {
	return f.pinnedItems, f.pinnedItemsErr
}
func (f *fakeRepo) PurgeRecentViews(ctx context.Context, viewerID int64, since time.Time) error {
	f.purgeCalled = true
	f.purgedSince = since
	return f.purgeErr
}

// fakeStealth is an in-memory StealthStore for service tests.
type fakeStealth struct {
	mode map[int64]domain.StealthMode
	err  error
}

func newFakeStealth() *fakeStealth { return &fakeStealth{mode: map[int64]domain.StealthMode{}} }

func (f *fakeStealth) Get(ctx context.Context, userID int64) (domain.StealthMode, error) {
	return f.mode[userID], f.err
}
func (f *fakeStealth) Set(ctx context.Context, userID int64, mode domain.StealthMode) error {
	if f.err != nil {
		return f.err
	}
	f.mode[userID] = mode
	return nil
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

func TestPost_InvalidPrivacy(t *testing.T) {
	repo := &fakeRepo{createID: 1}
	svc := New(repo, &fakePartners{}, &fakeMedia{owner: 1}, &fakeTx{})
	if _, err := svc.Post(context.Background(), 1, 7, "hi", "public", nil, 0); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("want ErrInvalid, got %v", err)
	}
}

func TestPost_CloseBroadcastsToCloseFriendsOnly(t *testing.T) {
	repo := &fakeRepo{createID: 42, closeFriends: []int64{2}}
	pub := newFakePublisher()
	// Partners would be 9, but close must target the close-friends list only (+author).
	svc := New(repo, &fakePartners{ids: []int64{9}}, &fakeMedia{owner: 1}, &fakeTx{})
	svc.SetPublisher(pub)
	if _, err := svc.Post(context.Background(), 1, 7, "hi", "close", nil, 0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(pub.frames[2]) != 1 || len(pub.frames[1]) != 1 {
		t.Fatalf("want story_new to close friend 2 and author 1")
	}
	if len(pub.frames[9]) != 0 {
		t.Fatalf("close story must not reach non-close partner 9")
	}
}

func TestSetCloseFriends_DropsSelfAndDedup(t *testing.T) {
	repo := &fakeRepo{}
	tx := &fakeTx{}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, tx)
	if err := svc.SetCloseFriends(context.Background(), 1, []int64{2, 2, 1, 3, 0, -5}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []int64{2, 3}
	if !reflect.DeepEqual(repo.setCloseArg, want) {
		t.Fatalf("want cleaned %v, got %v", want, repo.setCloseArg)
	}
	if !tx.called {
		t.Fatal("expected SetCloseFriends to run within a transaction")
	}
}

func TestFeed_AttachesAllowIDsForOwnSelectedOnly(t *testing.T) {
	// Group 1 — viewer's own stories: a selected story (allow attached) and a
	// contacts story (untouched). Group 2 — another author's selected story:
	// allow must NOT be attached (we don't reveal others' audiences).
	repo := &fakeRepo{
		feedGroups: []domain.StoryGroup{
			{Author: domain.UserCard{ID: 1}, Stories: []domain.StoryItem{
				{ID: 10, Privacy: "selected"},
				{ID: 11, Privacy: "contacts"},
			}},
			{Author: domain.UserCard{ID: 2}, Stories: []domain.StoryItem{
				{ID: 20, Privacy: "selected"},
			}},
		},
		allowIDsByStory: map[int64][]int64{10: {5, 6}, 20: {7}},
	}
	svc := New(repo, &fakePartners{ids: []int64{2}}, &fakeMedia{}, &fakeTx{})
	groups, err := svc.Feed(context.Background(), 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !reflect.DeepEqual(groups[0].Stories[0].AllowIDs, []int64{5, 6}) {
		t.Fatalf("own selected story: want allow [5 6], got %v", groups[0].Stories[0].AllowIDs)
	}
	if groups[0].Stories[1].AllowIDs != nil {
		t.Fatalf("own non-selected story must not carry allow, got %v", groups[0].Stories[1].AllowIDs)
	}
	if groups[1].Stories[0].AllowIDs != nil {
		t.Fatalf("another author's selected story must not reveal allow, got %v", groups[1].Stories[0].AllowIDs)
	}
}

func TestView_StealthActive_DoesNotRecord(t *testing.T) {
	repo := &fakeRepo{visible: true}
	st := newFakeStealth()
	st.mode[1] = domain.StealthMode{ActiveUntil: time.Now().Add(10 * time.Minute)}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	svc.SetStealthStore(st)
	if err := svc.View(context.Background(), 5, 1); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if repo.marked {
		t.Fatal("stealth-active viewer must not record a view")
	}
}

func TestView_StealthExpired_Records(t *testing.T) {
	repo := &fakeRepo{visible: true}
	st := newFakeStealth()
	st.mode[1] = domain.StealthMode{ActiveUntil: time.Now().Add(-time.Minute)} // expired
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	svc.SetStealthStore(st)
	if err := svc.View(context.Background(), 5, 1); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !repo.marked {
		t.Fatal("expired-stealth viewer must record a view")
	}
}

func TestActivateStealth_SetsWindowAndPurges(t *testing.T) {
	repo := &fakeRepo{}
	st := newFakeStealth()
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	svc.SetStealthStore(st)
	before := time.Now()
	m, err := svc.ActivateStealth(context.Background(), 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if m.ActiveUntil.Before(before.Add(stealthFuturePeriod-time.Minute)) || m.CooldownUntil.Before(before) {
		t.Fatalf("unexpected window: %+v", m)
	}
	if !repo.purgeCalled || repo.purgedSince.After(before) {
		t.Fatalf("expected past-purge with since<=now, called=%v since=%v", repo.purgeCalled, repo.purgedSince)
	}
}

func TestActivateStealth_CooldownConflict(t *testing.T) {
	repo := &fakeRepo{}
	st := newFakeStealth()
	st.mode[1] = domain.StealthMode{CooldownUntil: time.Now().Add(10 * time.Minute)}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	svc.SetStealthStore(st)
	if _, err := svc.ActivateStealth(context.Background(), 1); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("want ErrConflict during cooldown, got %v", err)
	}
}

func TestStealth_Unavailable_WhenNoStore(t *testing.T) {
	svc := New(&fakeRepo{}, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	if _, err := svc.StealthState(context.Background(), 1); !errors.Is(err, domain.ErrUnavailable) {
		t.Fatalf("want ErrUnavailable, got %v", err)
	}
	if _, err := svc.ActivateStealth(context.Background(), 1); !errors.Is(err, domain.ErrUnavailable) {
		t.Fatalf("want ErrUnavailable, got %v", err)
	}
}

func TestSetPinned_NonAuthor_Forbidden(t *testing.T) {
	repo := &fakeRepo{author: 99}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	if err := svc.SetPinned(context.Background(), 5, 1, true); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
	if repo.pinnedCalled {
		t.Fatal("must not pin another user's story")
	}
}

func TestSetPinned_Author_OK(t *testing.T) {
	repo := &fakeRepo{author: 1}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	if err := svc.SetPinned(context.Background(), 5, 1, true); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !repo.pinnedCalled || !repo.pinnedArg {
		t.Fatalf("expected pin=true, got called=%v arg=%v", repo.pinnedCalled, repo.pinnedArg)
	}
}

func TestEditStory_NonAuthor_Forbidden(t *testing.T) {
	repo := &fakeRepo{author: 99}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	cap := "x"
	if err := svc.EditStory(context.Background(), 5, 1, &cap, nil, nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
	if repo.editCalled {
		t.Fatal("must not edit another user's story")
	}
}

func TestEditStory_CaptionTooLong(t *testing.T) {
	repo := &fakeRepo{author: 1}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	long := strings.Repeat("а", maxCaptionRunes+1)
	if err := svc.EditStory(context.Background(), 5, 1, &long, nil, nil); !errors.Is(err, domain.ErrTooLong) {
		t.Fatalf("want ErrTooLong, got %v", err)
	}
	if repo.editCalled {
		t.Fatal("must not edit with an oversized caption")
	}
}

func TestEditStory_BadPrivacy(t *testing.T) {
	repo := &fakeRepo{author: 1}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	bad := "public"
	if err := svc.EditStory(context.Background(), 5, 1, nil, &bad, nil); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("want ErrInvalid, got %v", err)
	}
}

func TestEditStory_Author_OK(t *testing.T) {
	repo := &fakeRepo{author: 1}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	cap := "new"
	priv := "everyone"
	if err := svc.EditStory(context.Background(), 5, 1, &cap, &priv, nil); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !repo.editCalled || repo.editCaption == nil || *repo.editCaption != "new" || repo.editPrivacy == nil || *repo.editPrivacy != "everyone" {
		t.Fatalf("unexpected edit args: called=%v cap=%v priv=%v", repo.editCalled, repo.editCaption, repo.editPrivacy)
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
