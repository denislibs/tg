package story

import (
	"context"
	"encoding/json"
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
	createSeq     int64
	idBySeq       map[int64]int64
	readHorizon   map[int64]int64
	readCalled    bool
	readErr       error
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
	viewers       domain.StoryViewers
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
	editAreas       *domain.MediaAreas
	editErr         error
	origin          domain.StoryOrigin
	originErr       error
	allowIDsByStory map[int64][]int64
	allowIDsErr     error
	archiveItems    []domain.StoryRecord
	archiveErr      error
	pinnedItems     []domain.StoryRecord
	pinnedItemsErr  error
	byID            map[int64]domain.StoryRecord
	purgedSince     time.Time
	purgeCalled     bool
	purgeErr        error
}

func (f *fakeRepo) Create(ctx context.Context, s domain.Story, allowIDs []int64) (int64, int64, error) {
	f.createStory = s
	f.createAllow = allowIDs
	// Номер внутри автора у фейка по умолчанию совпадает с ключом строки —
	// тестам важно, что наружу возвращается ИМЕННО номер, а не ключ; там, где
	// разница существенна, номер задаётся отдельно (`createSeq`).
	seq := f.createSeq
	if seq == 0 {
		seq = f.createID
	}
	return f.createID, seq, f.createErr
}

func (f *fakeRepo) IDBySeq(ctx context.Context, authorID, seq int64) (int64, error) {
	if id, ok := f.idBySeq[seq]; ok {
		return id, nil
	}
	return seq, nil
}

func (f *fakeRepo) SetRead(ctx context.Context, viewerID, authorID, maxID int64) (int64, error) {
	if f.readHorizon == nil {
		f.readHorizon = map[int64]int64{}
	}
	if maxID > f.readHorizon[authorID] {
		f.readHorizon[authorID] = maxID
	}
	f.readCalled = true
	return f.readHorizon[authorID], f.readErr
}

func (f *fakeRepo) ReadHorizons(ctx context.Context, viewerID int64, authorIDs []int64) (map[int64]int64, error) {
	return f.readHorizon, nil
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
func (f *fakeRepo) Viewers(ctx context.Context, storyID int64) (domain.StoryViewers, error) {
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
func (f *fakeRepo) Edit(ctx context.Context, storyID, authorID int64, caption, privacy *string, allowIDs []int64, mediaAreas *domain.MediaAreas) error {
	f.editCalled = true
	f.editCaption = caption
	f.editPrivacy = privacy
	f.editAllow = allowIDs
	f.editAreas = mediaAreas
	return f.editErr
}
func (f *fakeRepo) Origin(ctx context.Context, storyID int64) (domain.StoryOrigin, error) {
	return f.origin, f.originErr
}
func (f *fakeRepo) AllowIDs(ctx context.Context, storyID int64) ([]int64, error) {
	return f.allowIDsByStory[storyID], f.allowIDsErr
}
func (f *fakeRepo) Archive(ctx context.Context, ownerID, limit, offsetID int64) ([]domain.StoryRecord, error) {
	return f.archiveItems, f.archiveErr
}
func (f *fakeRepo) Pinned(ctx context.Context, peerID, viewerID int64) ([]domain.StoryRecord, error) {
	return f.pinnedItems, f.pinnedItemsErr
}

// ByID — одна история для кадра `updateStory`. По умолчанию отдаёт «нет такой»:
// тестам, которых кадр не касается, историю сеять незачем.
func (f *fakeRepo) ByID(ctx context.Context, storyID, viewerID int64) (domain.StoryRecord, error) {
	if f.byID == nil {
		return domain.StoryRecord{}, domain.ErrNotFound
	}
	rec, ok := f.byID[storyID]
	if !ok {
		return domain.StoryRecord{}, domain.ErrNotFound
	}
	return rec, nil
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
	dims  map[int64]domain.MediaSource
}

func (f *fakeMedia) OwnerID(ctx context.Context, mediaID int64) (int64, error) {
	return f.owner, f.err
}

// dims — метаданные файлов по id; из них сервис строит СТУПЕНЬ вложения
// истории. Пустая карта означает «файла нет», и тогда история едет без `media`.
func (f *fakeMedia) DimsByIDs(ctx context.Context, ids []int64) (map[int64]domain.MediaSource, error) {
	out := map[int64]domain.MediaSource{}
	for _, id := range ids {
		if d, ok := f.dims[id]; ok {
			out[id] = d
		}
	}
	return out, nil
}

type fakeSender struct {
	calls   []int64 // chatIDs the story was shared into
	mediaID int64
	caption string
	senders []int64
	err     error
	failFor map[int64]error // per-chat errors (e.g. ErrNotFound for non-member)
}

func (f *fakeSender) SendStoryShare(ctx context.Context, chatID, senderID, mediaID int64, caption string) error {
	if e, ok := f.failFor[chatID]; ok {
		return e
	}
	if f.err != nil {
		return f.err
	}
	f.calls = append(f.calls, chatID)
	f.senders = append(f.senders, senderID)
	f.mediaID = mediaID
	f.caption = caption
	return nil
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
	_, err := svc.Post(context.Background(), 1, 7, "hi", "contacts", nil, nil, 0)
	if !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
}

func TestPost_OK_DefaultPrivacyAndExpiry(t *testing.T) {
	repo := &fakeRepo{createID: 42}
	tx := &fakeTx{}
	svc := New(repo, &fakePartners{}, &fakeMedia{owner: 1}, tx)
	before := time.Now()
	id, err := svc.Post(context.Background(), 1, 7, "hi", "", nil, nil, 0)
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
	err := svc.View(context.Background(), 10, 5, 1)
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
	if err := svc.View(context.Background(), 10, 5, 1); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !repo.marked {
		t.Fatal("expected MarkViewed to be called")
	}
}

func TestViewers_NonAuthor_Forbidden(t *testing.T) {
	repo := &fakeRepo{author: 99}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	_, err := svc.Viewers(context.Background(), 1, 5, 1)
	if !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
}

func TestViewers_Author_ReturnsList(t *testing.T) {
	repo := &fakeRepo{author: 1, viewers: domain.StoryViewers{
		Views: []domain.StoryView{domain.NewStoryView(2, 1787334148, nil)},
		Users: []domain.UserReal{{ID: 2}},
	}}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	got, err := svc.Viewers(context.Background(), 1, 5, 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Просмотр и карточка едут РАЗНЫМИ векторами — форма stories.storyViewsList.
	if len(got.Views) != 1 || got.Views[0].UserID != 2 {
		t.Fatalf("unexpected views: %+v", got.Views)
	}
	if len(got.Users) != 1 || got.Users[0].ID != 2 {
		t.Fatalf("unexpected viewers: %+v", got.Users)
	}
}

func TestStats_NonAuthor_Forbidden(t *testing.T) {
	repo := &fakeRepo{author: 99}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	_, err := svc.Stats(context.Background(), 1, 5, 1)
	if !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
}

func TestStats_Author_ReturnsStats(t *testing.T) {
	repo := &fakeRepo{author: 1, stats: domain.StoryStats{Views: 7}}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	got, err := svc.Stats(context.Background(), 1, 5, 1)
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
		if _, err := svc.Post(context.Background(), 1, 7, "hi", "everyone", nil, nil, c.period); err != nil {
			t.Fatalf("period %d: %v", c.period, err)
		}
		got := repo.createStory.ExpiresAt.Sub(before)
		// Allow a small window for execution time.
		if got < c.want-time.Minute || got > c.want+time.Minute {
			t.Fatalf("period %d: expiry delta = %v, want ~%v", c.period, got, c.want)
		}
	}
}

// seedStory кладёт историю, которую кадр `updateStory` читает через ByID:
// кадр несёт историю ЦЕЛИКОМ, а не плоские поля, поэтому без неё он не уедет.
func seedStory(f *fakeRepo, id int64, over ...func(*domain.StoryRecord)) {
	rec := domain.StoryRecord{ID: id, Seq: id, MediaID: 7, Caption: "hi", Privacy: "contacts"}
	for _, fn := range over {
		fn(&rec)
	}
	if f.byID == nil {
		f.byID = map[int64]domain.StoryRecord{}
	}
	f.byID[id] = rec
}

// frameTag — дискриминатор кадра: маршрутизация идёт по нему, а не по имени
// конверта.
func frameTag(t *testing.T, raw []byte) string {
	t.Helper()
	var env struct {
		D struct {
			Underscore string `json:"_"`
		} `json:"d"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatalf("кадр не разбирается: %v", err)
	}
	return env.D.Underscore
}

func TestPost_BroadcastsStoryUpdate(t *testing.T) {
	repo := &fakeRepo{createID: 42}
	seedStory(repo, 42)
	pub := newFakePublisher()
	svc := New(repo, &fakePartners{ids: []int64{2, 3}}, &fakeMedia{owner: 1}, &fakeTx{})
	svc.SetPublisher(pub)
	if _, err := svc.Post(context.Background(), 1, 7, "hi", "contacts", nil, nil, 0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// contacts/everyone -> partners (2,3) + author (1).
	for _, uid := range []int64{1, 2, 3} {
		if len(pub.frames[uid]) != 1 {
			t.Fatalf("user %d: want 1 updateStory frame, got %d", uid, len(pub.frames[uid]))
		}
		if tag := frameTag(t, pub.frames[uid][0]); tag != domain.UpdateStoryTag {
			t.Fatalf("user %d: кадр = %q, ожидался %q", uid, tag, domain.UpdateStoryTag)
		}
	}
}

// Тело кадра одно на ВСЕХ получателей, поэтому пер-зрительских частей в нём
// быть не может: реакция и аудитория у каждого свои. Та же ловушка уже ловилась
// у pFlags.out и у `unread`. Прочитанность сюда не попадает по построению — она
// больше не свойство истории, а горизонт группы.
func TestPost_FrameCarriesNoPerViewerParts(t *testing.T) {
	repo := &fakeRepo{createID: 42}
	seedStory(repo, 42, func(r *domain.StoryRecord) {
		r.MyReaction = "👍"
		r.Privacy = "selected"
		r.AllowIDs = []int64{2}
	})
	pub := newFakePublisher()
	svc := New(repo, &fakePartners{ids: []int64{2}}, &fakeMedia{owner: 1}, &fakeTx{})
	svc.SetPublisher(pub)
	if _, err := svc.Post(context.Background(), 1, 7, "hi", "selected", []int64{2}, nil, 0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var env struct {
		D struct {
			Story map[string]any `json:"story"`
		} `json:"d"`
	}
	if err := json.Unmarshal(pub.frames[2][0], &env); err != nil {
		t.Fatalf("кадр не разбирается: %v", err)
	}
	for _, key := range []string{"sent_reaction", "privacy"} {
		if _, exists := env.D.Story[key]; exists {
			t.Errorf("в общем теле кадра пер-зрительская часть: %s", key)
		}
	}
}

func TestPost_SelectedBroadcastsToAllowlist(t *testing.T) {
	repo := &fakeRepo{createID: 42}
	pub := newFakePublisher()
	// Partners would be 9, but selected must target the allowlist only (+author).
	seedStory(repo, 42)
	svc := New(repo, &fakePartners{ids: []int64{9}}, &fakeMedia{owner: 1}, &fakeTx{})
	svc.SetPublisher(pub)
	if _, err := svc.Post(context.Background(), 1, 7, "hi", "selected", []int64{2}, nil, 0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(pub.frames[2]) != 1 || len(pub.frames[1]) != 1 {
		t.Fatalf("want updateStory to allowlisted 2 and author 1")
	}
	if len(pub.frames[9]) != 0 {
		t.Fatalf("selected story must not reach non-allowlisted partner 9")
	}
}

func TestSetReaction_NotVisible_Forbidden(t *testing.T) {
	repo := &fakeRepo{visible: false}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	err := svc.SetReaction(context.Background(), 10, 5, 1, "👍")
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
	if err := svc.SetReaction(context.Background(), 10, 5, 1, ""); !errors.Is(err, domain.ErrBadReaction) {
		t.Fatalf("want ErrBadReaction, got %v", err)
	}
}

// Реакция рассылается ДВУМЯ разными кадрами, потому что это два разных факта:
// автору — свежая история (`updateStory`, агрегат внутри неё), самому зрителю —
// его личный выбор (`updateSentStoryReaction`) для других его устройств.
func TestSetReaction_OK_UpsertsAndNotifiesBothSides(t *testing.T) {
	repo := &fakeRepo{visible: true, author: 10, reactionsCount: 3}
	seedStory(repo, 5)
	pub := newFakePublisher()
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	svc.SetPublisher(pub)
	if err := svc.SetReaction(context.Background(), 10, 5, 1, "👍"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !repo.setCalled || repo.setReaction != "👍" {
		t.Fatalf("expected SetReaction with 👍, got called=%v r=%q", repo.setCalled, repo.setReaction)
	}
	if len(pub.frames[10]) != 1 || frameTag(t, pub.frames[10][0]) != domain.UpdateStoryTag {
		t.Fatalf("автору должен уехать updateStory, got %d кадров", len(pub.frames[10]))
	}
	if len(pub.frames[1]) != 1 || frameTag(t, pub.frames[1][0]) != domain.UpdateSentStoryReactionTag {
		t.Fatalf("зрителю должен уехать updateSentStoryReaction, got %d кадров", len(pub.frames[1]))
	}
}

func TestRemoveReaction_OK_NotifiesBothSides(t *testing.T) {
	repo := &fakeRepo{visible: true, author: 10, reactionsCount: 0}
	seedStory(repo, 5)
	pub := newFakePublisher()
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	svc.SetPublisher(pub)
	if err := svc.RemoveReaction(context.Background(), 10, 5, 1); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !repo.removeCalled {
		t.Fatal("expected RemoveReaction to be called")
	}
	if len(pub.frames[10]) != 1 || frameTag(t, pub.frames[10][0]) != domain.UpdateStoryTag {
		t.Fatalf("автору должен уехать updateStory, got %d кадров", len(pub.frames[10]))
	}
	if len(pub.frames[1]) != 1 || frameTag(t, pub.frames[1][0]) != domain.UpdateSentStoryReactionTag {
		t.Fatalf("зрителю должен уехать updateSentStoryReaction, got %d кадров", len(pub.frames[1]))
	}
}

func TestRemoveReaction_NotVisible_Forbidden(t *testing.T) {
	repo := &fakeRepo{visible: false}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	if err := svc.RemoveReaction(context.Background(), 10, 5, 1); !errors.Is(err, domain.ErrForbidden) {
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
	if _, err := svc.Post(context.Background(), 1, 7, "hi", "public", nil, nil, 0); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("want ErrInvalid, got %v", err)
	}
}

func TestPost_CloseBroadcastsToCloseFriendsOnly(t *testing.T) {
	repo := &fakeRepo{createID: 42, closeFriends: []int64{2}}
	seedStory(repo, 42)
	pub := newFakePublisher()
	// Partners would be 9, but close must target the close-friends list only (+author).
	svc := New(repo, &fakePartners{ids: []int64{9}}, &fakeMedia{owner: 1}, &fakeTx{})
	svc.SetPublisher(pub)
	if _, err := svc.Post(context.Background(), 1, 7, "hi", "close", nil, nil, 0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(pub.frames[2]) != 1 || len(pub.frames[1]) != 1 {
		t.Fatalf("want updateStory to close friend 2 and author 1")
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
			{Author: domain.UserReal{ID: 1}, Stories: []domain.StoryRecord{
				{ID: 10, Privacy: "selected"},
				{ID: 11, Privacy: "contacts"},
			}},
			{Author: domain.UserReal{ID: 2}, Stories: []domain.StoryRecord{
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
	if err := svc.View(context.Background(), 10, 5, 1); err != nil {
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
	if err := svc.View(context.Background(), 10, 5, 1); err != nil {
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
	if err := svc.EditStory(context.Background(), 5, 1, &cap, nil, nil, nil); !errors.Is(err, domain.ErrForbidden) {
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
	if err := svc.EditStory(context.Background(), 5, 1, &long, nil, nil, nil); !errors.Is(err, domain.ErrTooLong) {
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
	if err := svc.EditStory(context.Background(), 5, 1, nil, &bad, nil, nil); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("want ErrInvalid, got %v", err)
	}
}

func TestEditStory_Author_OK(t *testing.T) {
	repo := &fakeRepo{author: 1}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	cap := "new"
	priv := "everyone"
	if err := svc.EditStory(context.Background(), 5, 1, &cap, &priv, nil, nil); err != nil {
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
	if _, err := svc.Post(context.Background(), 1, 7, longCaption, "contacts", nil, nil, 0); !errors.Is(err, domain.ErrTooLong) {
		t.Fatalf("want ErrTooLong, got %v", err)
	}
	if repo.createStory.MediaID != 0 {
		t.Fatal("must not create a story with an oversized caption")
	}
}

// --- media areas / repost / share (4d) ---

func coords(x, y, w, h float64) domain.MediaAreaCoordinates {
	return domain.NewMediaAreaCoordinates(x, y, w, h, 0)
}

func sampleAreas() domain.MediaAreas {
	return domain.MediaAreas{
		domain.NewMediaAreaSuggestedReaction(coords(50, 50, 10, 10), "👍", false, false),
		domain.NewMediaAreaURL(coords(10, 20, 0, 0), "https://t.me"),
		domain.NewMediaAreaGeoPoint(coords(1, 2, 0, 0), 55.75, 37.61),
	}
}

func TestPost_MediaAreas_RoundTrip(t *testing.T) {
	repo := &fakeRepo{createID: 1}
	svc := New(repo, &fakePartners{}, &fakeMedia{owner: 1}, &fakeTx{})
	areas := sampleAreas()
	if _, err := svc.Post(context.Background(), 1, 7, "hi", "contacts", nil, areas, 0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !reflect.DeepEqual(repo.createStory.MediaAreas, areas) {
		t.Fatalf("media areas not persisted: got %+v", repo.createStory.MediaAreas)
	}
}

func TestPost_MediaAreas_Validation(t *testing.T) {
	// «Неизвестный тип» из этого списка ушёл, и это не ослабление проверки:
	// вид области теперь ВЫБОР конструктора, и незнакомый до валидации не
	// доезжает — его отбрасывает разбор объединения (см. MediaAreas.UnmarshalJSON).
	cases := map[string]domain.MediaAreas{
		"coord over":  {domain.NewMediaAreaURL(coords(101, 0, 0, 0), "x")},
		"coord neg":   {domain.NewMediaAreaURL(coords(0, -1, 0, 0), "x")},
		"empty react": {domain.NewMediaAreaSuggestedReaction(coords(1, 0, 0, 0), "", false, false)},
		"empty url":   {domain.NewMediaAreaURL(coords(1, 0, 0, 0), "")},
		"geo off map": {domain.NewMediaAreaGeoPoint(coords(1, 0, 0, 0), 95, 0)},
	}
	for name, areas := range cases {
		t.Run(name, func(t *testing.T) {
			repo := &fakeRepo{createID: 1}
			svc := New(repo, &fakePartners{}, &fakeMedia{owner: 1}, &fakeTx{})
			if _, err := svc.Post(context.Background(), 1, 7, "hi", "contacts", nil, areas, 0); !errors.Is(err, domain.ErrInvalid) {
				t.Fatalf("want ErrInvalid, got %v", err)
			}
			if repo.createStory.MediaID != 0 {
				t.Fatal("must not create a story with invalid media areas")
			}
		})
	}
}

func TestPost_MediaAreas_Overflow(t *testing.T) {
	repo := &fakeRepo{createID: 1}
	svc := New(repo, &fakePartners{}, &fakeMedia{owner: 1}, &fakeTx{})
	areas := make(domain.MediaAreas, maxMediaAreas+1)
	for i := range areas {
		areas[i] = domain.NewMediaAreaURL(coords(0, 0, 0, 0), "x")
	}
	if _, err := svc.Post(context.Background(), 1, 7, "hi", "contacts", nil, areas, 0); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("want ErrInvalid on overflow, got %v", err)
	}
}

func TestEditStory_MediaAreas(t *testing.T) {
	repo := &fakeRepo{author: 1}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	areas := sampleAreas()
	if err := svc.EditStory(context.Background(), 5, 1, nil, nil, nil, &areas); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if repo.editAreas == nil || !reflect.DeepEqual(*repo.editAreas, areas) {
		t.Fatalf("media areas not passed to Edit: %+v", repo.editAreas)
	}
	// invalid areas rejected before touching the repo.
	repo2 := &fakeRepo{author: 1}
	svc2 := New(repo2, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	bad := domain.MediaAreas{domain.NewMediaAreaURL(coords(0, 0, 0, 0), "")}
	if err := svc2.EditStory(context.Background(), 5, 1, nil, nil, nil, &bad); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("want ErrInvalid, got %v", err)
	}
	if repo2.editCalled {
		t.Fatal("must not call Edit with invalid media areas")
	}
}

func TestRepost_OK(t *testing.T) {
	repo := &fakeRepo{
		createID: 77,
		visible:  true,
		origin:   domain.StoryOrigin{AuthorID: 9, AuthorName: "Bob", MediaID: 500},
	}
	tx := &fakeTx{}
	svc := New(repo, &fakePartners{ids: []int64{2}}, &fakeMedia{}, tx)
	id, err := svc.Repost(context.Background(), 1, 9, 42, "look", "everyone", nil, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != 77 {
		t.Fatalf("want id 77, got %d", id)
	}
	if !tx.called {
		t.Fatal("expected Create within tx")
	}
	if repo.createStory.MediaID != 500 {
		t.Fatalf("repost must reuse source media, got %d", repo.createStory.MediaID)
	}
	if repo.createStory.FwdFrom == nil || repo.createStory.FwdFrom.AuthorID != 9 || repo.createStory.FwdFrom.StoryID != 42 {
		t.Fatalf("unexpected fwd_from: %+v", repo.createStory.FwdFrom)
	}
	if repo.createStory.AuthorID != 1 {
		t.Fatalf("repost author must be the reposter, got %d", repo.createStory.AuthorID)
	}
}

func TestRepost_ForbiddenWhenSourceNotVisible(t *testing.T) {
	repo := &fakeRepo{visible: false, origin: domain.StoryOrigin{MediaID: 500}}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	if _, err := svc.Repost(context.Background(), 1, 9, 42, "", "", nil, 0); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
	if repo.createStory.MediaID != 0 {
		t.Fatal("must not create a story when the source is not visible")
	}
}

func TestShare_OK(t *testing.T) {
	repo := &fakeRepo{visible: true, origin: domain.StoryOrigin{AuthorID: 9, AuthorName: "Bob", MediaID: 500}}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	sender := &fakeSender{}
	svc.SetMessageSender(sender)
	sent, err := svc.Share(context.Background(), 10, 42, 1, []int64{10, 20, 30})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sent != 3 {
		t.Fatalf("want sent 3, got %d", sent)
	}
	if !reflect.DeepEqual(sender.calls, []int64{10, 20, 30}) {
		t.Fatalf("unexpected share targets: %v", sender.calls)
	}
	if sender.mediaID != 500 {
		t.Fatalf("share must use story media 500, got %d", sender.mediaID)
	}
	if !strings.Contains(sender.caption, "Bob") {
		t.Fatalf("caption must attribute the author, got %q", sender.caption)
	}
}

func TestShare_ForbiddenWhenNotVisible(t *testing.T) {
	repo := &fakeRepo{visible: false}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	sender := &fakeSender{}
	svc.SetMessageSender(sender)
	if _, err := svc.Share(context.Background(), 10, 42, 1, []int64{10}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
	if len(sender.calls) != 0 {
		t.Fatal("must not send when the story is not visible")
	}
}

func TestShare_UnavailableWithoutSender(t *testing.T) {
	repo := &fakeRepo{visible: true}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	if _, err := svc.Share(context.Background(), 10, 42, 1, []int64{10}); !errors.Is(err, domain.ErrUnavailable) {
		t.Fatalf("want ErrUnavailable, got %v", err)
	}
}

func TestShare_SkipsNonMemberChats(t *testing.T) {
	repo := &fakeRepo{visible: true, origin: domain.StoryOrigin{MediaID: 500}}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	sender := &fakeSender{failFor: map[int64]error{20: domain.ErrNotFound}}
	svc.SetMessageSender(sender)
	sent, err := svc.Share(context.Background(), 10, 42, 1, []int64{10, 20, 30})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sent != 2 {
		t.Fatalf("want sent 2 (non-member 20 skipped), got %d", sent)
	}
	if !reflect.DeepEqual(sender.calls, []int64{10, 30}) {
		t.Fatalf("unexpected share targets: %v", sender.calls)
	}
}

// Ступень вложения собирается ИЗ МЕТАДАННЫХ файла, а не остаётся его номером.
//
// До этого шага наружу ехал голый `media_id`, и клиент спрашивал mime, размеры
// и длительность ОТДЕЛЬНЫМ запросом на каждую историю (`useStoryPreviewMedia`).
// Вид вложения при этом выводится из mime: столбца `type` у истории нет — тот
// же вывод, который клиент и делал.
func TestFeed_AttachesMediaLadder(t *testing.T) {
	repo := &fakeRepo{feedGroups: []domain.StoryGroup{{
		Author:  domain.UserReal{ID: 1},
		Stories: []domain.StoryRecord{{ID: 7, MediaID: 55}},
	}}}
	media := &fakeMedia{dims: map[int64]domain.MediaSource{
		55: {Mime: "video/mp4", Width: 720, Height: 1280, Duration: 15, Size: 4096},
	}}

	groups, err := New(repo, &fakePartners{}, media, &fakeTx{}).Feed(context.Background(), 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	md := groups[0].Stories[0].Media
	if md == nil {
		t.Fatalf("ступень не собрана: media = nil")
	}
	if md.Tag() != domain.MessageMediaDocumentTag {
		t.Fatalf("видео должно ехать документом, а не %s", md.Tag())
	}
}

// Файла нет — истории едут без `media`, и это НЕ паника: пропуск обязательного
// параметра ловит сверка со схемой, а не пользователь.
func TestFeed_MissingMediaLeavesLadderEmpty(t *testing.T) {
	repo := &fakeRepo{feedGroups: []domain.StoryGroup{{
		Author:  domain.UserReal{ID: 1},
		Stories: []domain.StoryRecord{{ID: 7, MediaID: 55}},
	}}}

	groups, err := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{}).Feed(context.Background(), 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if groups[0].Stories[0].Media != nil {
		t.Fatalf("ступень собралась из ничего: %+v", groups[0].Stories[0].Media)
	}
}

// Архив и закреплённые ходят тем же путём: ступень наполняется НА МЕСТЕ, иначе
// вложение осталось бы в копии записи.
func TestArchiveAndPinned_AttachMediaLadder(t *testing.T) {
	media := &fakeMedia{dims: map[int64]domain.MediaSource{
		55: {Mime: "image/jpeg", Width: 1080, Height: 1920, Size: 2048},
	}}
	repo := &fakeRepo{
		archiveItems: []domain.StoryRecord{{ID: 7, MediaID: 55}},
		pinnedItems:  []domain.StoryRecord{{ID: 8, MediaID: 55}},
	}
	svc := New(repo, &fakePartners{}, media, &fakeTx{})

	arch, err := svc.Archive(context.Background(), 1, 10, 0)
	if err != nil || len(arch) != 1 || arch[0].Media == nil {
		t.Fatalf("архив без ступени: %+v (err %v)", arch, err)
	}
	pinned, err := svc.PinnedStories(context.Background(), 1, 1)
	if err != nil || len(pinned) != 1 || pinned[0].Media == nil {
		t.Fatalf("закреплённые без ступени: %+v (err %v)", pinned, err)
	}
	if arch[0].Media.Tag() != domain.MessageMediaPhotoTag {
		t.Fatalf("картинка должна ехать фотографией, а не %s", arch[0].Media.Tag())
	}
}
