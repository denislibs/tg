package stickers

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeRepo — in-memory реализация порта Repo (стиль соседних usecase-тестов).
type fakeRepo struct {
	mu        sync.Mutex
	nextSet   int64
	nextStick int64
	clock     int64 // логическое время для used_at/faved_at/saved_at
	sets      map[int64]domain.StickerSet
	stickers  map[int64]domain.Sticker
	installed map[int64]map[int64]int   // userID -> setID -> position
	recent    map[int64]map[int64]int64 // userID -> stickerID -> usedAt
	faved     map[int64]map[int64]int64
	gifs      map[int64]map[int64]int64 // userID -> mediaID -> savedAt
	media     map[int64]bool
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		sets:      map[int64]domain.StickerSet{},
		stickers:  map[int64]domain.Sticker{},
		installed: map[int64]map[int64]int{},
		recent:    map[int64]map[int64]int64{},
		faved:     map[int64]map[int64]int64{},
		gifs:      map[int64]map[int64]int64{},
		media:     map[int64]bool{},
	}
}

func (f *fakeRepo) tick() int64 { f.clock++; return f.clock }

func (f *fakeRepo) CreateSet(_ context.Context, set domain.StickerSet) (domain.StickerSet, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, s := range f.sets {
		if s.Slug == set.Slug {
			return domain.StickerSet{}, domain.ErrConflict
		}
	}
	f.nextSet++
	set.ID = f.nextSet
	f.sets[set.ID] = set
	return set, nil
}

func (f *fakeRepo) SetBySlug(_ context.Context, slug string) (domain.StickerSet, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, s := range f.sets {
		if s.Slug == slug {
			return s, nil
		}
	}
	return domain.StickerSet{}, domain.ErrNotFound
}

func (f *fakeRepo) SetByID(_ context.Context, id int64) (domain.StickerSet, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.sets[id]
	if !ok {
		return domain.StickerSet{}, domain.ErrNotFound
	}
	return s, nil
}

func (f *fakeRepo) Stickers(_ context.Context, setID int64) ([]domain.Sticker, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []domain.Sticker
	for _, s := range f.stickers {
		if s.SetID == setID {
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Position < out[j].Position })
	return out, nil
}

func (f *fakeRepo) AddSticker(_ context.Context, s domain.Sticker) (domain.Sticker, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nextStick++
	s.ID = f.nextStick
	pos := 0
	for _, st := range f.stickers {
		if st.SetID == s.SetID && st.Position >= pos {
			pos = st.Position + 1
		}
	}
	s.Position = pos
	f.stickers[s.ID] = s
	return s, nil
}

func (f *fakeRepo) StickerByID(_ context.Context, id int64) (domain.Sticker, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.stickers[id]
	if !ok {
		return domain.Sticker{}, domain.ErrNotFound
	}
	return s, nil
}

func (f *fakeRepo) Install(_ context.Context, userID, setID int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	m := f.installed[userID]
	if m == nil {
		m = map[int64]int{}
		f.installed[userID] = m
	}
	if _, ok := m[setID]; !ok {
		m[setID] = len(m)
	}
	return nil
}

func (f *fakeRepo) Uninstall(_ context.Context, userID, setID int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.installed[userID], setID)
	return nil
}

func (f *fakeRepo) InstalledSets(_ context.Context, userID int64) ([]domain.StickerSet, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	type row struct {
		set domain.StickerSet
		pos int
	}
	var rows []row
	for setID, pos := range f.installed[userID] {
		rows = append(rows, row{f.sets[setID], pos})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].pos < rows[j].pos })
	out := make([]domain.StickerSet, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.set)
	}
	return out, nil
}

func (f *fakeRepo) SearchSets(_ context.Context, q string, limit int) ([]domain.StickerSet, error) {
	return nil, nil
}

// trim оставляет keep записей с наибольшим временем.
func trim(m map[int64]int64, keep int) {
	for len(m) > keep {
		var oldest int64
		var oldestAt int64 = 1<<63 - 1
		for id, at := range m {
			if at < oldestAt {
				oldest, oldestAt = id, at
			}
		}
		delete(m, oldest)
	}
}

func touch(byUser map[int64]map[int64]int64, userID, id, at int64, keep int) {
	m := byUser[userID]
	if m == nil {
		m = map[int64]int64{}
		byUser[userID] = m
	}
	m[id] = at
	trim(m, keep)
}

func newestFirst(f *fakeRepo, m map[int64]int64, limit int) []domain.Sticker {
	type row struct {
		id, at int64
	}
	var rows []row
	for id, at := range m {
		rows = append(rows, row{id, at})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].at > rows[j].at })
	var out []domain.Sticker
	for _, r := range rows {
		if len(out) == limit {
			break
		}
		out = append(out, f.stickers[r.id])
	}
	return out
}

func (f *fakeRepo) TouchRecent(_ context.Context, userID, stickerID int64, keep int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	touch(f.recent, userID, stickerID, f.tick(), keep)
	return nil
}

func (f *fakeRepo) Recent(_ context.Context, userID int64, limit int) ([]domain.Sticker, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return newestFirst(f, f.recent[userID], limit), nil
}

func (f *fakeRepo) Fave(_ context.Context, userID, stickerID int64, keep int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	touch(f.faved, userID, stickerID, f.tick(), keep)
	return nil
}

func (f *fakeRepo) Unfave(_ context.Context, userID, stickerID int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.faved[userID], stickerID)
	return nil
}

func (f *fakeRepo) Faved(_ context.Context, userID int64, limit int) ([]domain.Sticker, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return newestFirst(f, f.faved[userID], limit), nil
}

func (f *fakeRepo) SearchByEmoji(_ context.Context, userID int64, emoji string, limit int) ([]domain.Sticker, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []domain.Sticker
	for _, s := range f.stickers {
		if s.Emoji != emoji {
			continue
		}
		if _, ok := f.installed[userID][s.SetID]; !ok {
			continue
		}
		if len(out) < limit {
			out = append(out, s)
		}
	}
	return out, nil
}

func (f *fakeRepo) SavedGifs(_ context.Context, userID int64) ([]domain.SavedGif, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	type row struct {
		id, at int64
	}
	var rows []row
	for id, at := range f.gifs[userID] {
		rows = append(rows, row{id, at})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].at > rows[j].at })
	var out []domain.SavedGif
	for _, r := range rows {
		out = append(out, domain.SavedGif{MediaID: r.id, SavedAt: time.Unix(r.at, 0)})
	}
	return out, nil
}

func (f *fakeRepo) SaveGif(_ context.Context, userID, mediaID int64, keep int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	touch(f.gifs, userID, mediaID, f.tick(), keep)
	return nil
}

func (f *fakeRepo) DeleteGif(_ context.Context, userID, mediaID int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.gifs[userID], mediaID)
	return nil
}

func (f *fakeRepo) MediaExists(_ context.Context, mediaID int64) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.media[mediaID], nil
}

func (f *fakeRepo) IsStickerMedia(_ context.Context, mediaID int64) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, s := range f.stickers {
		if s.MediaID == mediaID {
			return true, nil
		}
	}
	return false, nil
}

// seedSet — набор из n стикеров; возвращает набор и id стикеров.
func seedSet(t *testing.T, in *Interactor, f *fakeRepo, owner int64, slug string, n int) (domain.StickerSet, []int64) {
	t.Helper()
	set, err := in.CreateSet(context.Background(), owner, slug, "Набор "+slug, "sticker")
	if err != nil {
		t.Fatalf("CreateSet(%s): %v", slug, err)
	}
	ids := make([]int64, 0, n)
	for k := 0; k < n; k++ {
		mediaID := int64(1000 + len(f.media))
		f.media[mediaID] = true
		s, err := in.AddSticker(context.Background(), owner, set.ID, mediaID, "😀")
		if err != nil {
			t.Fatalf("AddSticker: %v", err)
		}
		ids = append(ids, s.ID)
	}
	return set, ids
}

func TestCreateSet_Validation(t *testing.T) {
	in := New(newFakeRepo())
	ctx := context.Background()
	for _, slug := range []string{"ab", "Upper", "with space", "тест", "a-b", strings.Repeat("a", 65)} {
		if _, err := in.CreateSet(ctx, 1, slug, "Title", "sticker"); !errors.Is(err, domain.ErrInvalid) {
			t.Fatalf("slug %q: want ErrInvalid, got %v", slug, err)
		}
	}
	if _, err := in.CreateSet(ctx, 1, "good_slug_1", "Title", "weird"); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("kind whitelist: want ErrInvalid, got %v", err)
	}
	if _, err := in.CreateSet(ctx, 1, "good_slug_1", "  ", "sticker"); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("empty title: want ErrInvalid, got %v", err)
	}
	set, err := in.CreateSet(ctx, 1, "good_slug_1", "Ок", "")
	if err != nil || set.Kind != "sticker" {
		t.Fatalf("valid set: %+v, %v", set, err)
	}
	if _, err := in.CreateSet(ctx, 1, "good_slug_1", "Дубль", "sticker"); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("duplicate slug: want ErrConflict, got %v", err)
	}
}

func TestAddSticker_OwnerAndMedia(t *testing.T) {
	f := newFakeRepo()
	in := New(f)
	ctx := context.Background()
	set, _ := seedSet(t, in, f, 1, "owner_set", 1)
	f.media[500] = true
	if _, err := in.AddSticker(ctx, 2, set.ID, 500, "😀"); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("чужой набор: want ErrForbidden, got %v", err)
	}
	if _, err := in.AddSticker(ctx, 1, set.ID, 99999, "😀"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("нет media: want ErrNotFound, got %v", err)
	}
}

func TestInstallUninstall_Idempotent(t *testing.T) {
	f := newFakeRepo()
	in := New(f)
	ctx := context.Background()
	set, _ := seedSet(t, in, f, 1, "duck_set", 1)
	const user = int64(7)
	if err := in.Install(ctx, user, set.ID); err != nil {
		t.Fatalf("Install: %v", err)
	}
	if err := in.Install(ctx, user, set.ID); err != nil {
		t.Fatalf("Install повторно: %v", err)
	}
	sets, _ := in.MySets(ctx, user)
	if len(sets) != 1 {
		t.Fatalf("MySets: want 1, got %d", len(sets))
	}
	if err := in.Install(ctx, user, 9999); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("Install несуществующего: want ErrNotFound, got %v", err)
	}
	if err := in.Uninstall(ctx, user, set.ID); err != nil {
		t.Fatalf("Uninstall: %v", err)
	}
	if err := in.Uninstall(ctx, user, set.ID); err != nil {
		t.Fatalf("Uninstall повторно: %v", err)
	}
	if sets, _ = in.MySets(ctx, user); len(sets) != 0 {
		t.Fatalf("MySets после Uninstall: want 0, got %d", len(sets))
	}
}

func TestRecent_LimitAndOrder(t *testing.T) {
	f := newFakeRepo()
	in := New(f)
	ctx := context.Background()
	_, ids := seedSet(t, in, f, 1, "many_set", 25)
	const user = int64(7)
	for _, id := range ids {
		if err := in.Use(ctx, user, id); err != nil {
			t.Fatalf("Use(%d): %v", id, err)
		}
	}
	got, err := in.Recent(ctx, user)
	if err != nil || len(got) != 20 {
		t.Fatalf("Recent: want 20, got %d (%v)", len(got), err)
	}
	// Новые первыми: последний использованный — в начале.
	if got[0].ID != ids[24] {
		t.Fatalf("Recent[0]: want %d, got %d", ids[24], got[0].ID)
	}
	if err := in.Use(ctx, user, 424242); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("Use несуществующего: want ErrNotFound, got %v", err)
	}
}

func TestFaved_Limit(t *testing.T) {
	f := newFakeRepo()
	in := New(f)
	ctx := context.Background()
	_, ids := seedSet(t, in, f, 1, "fav_set", 12)
	const user = int64(7)
	for _, id := range ids {
		if err := in.Fave(ctx, user, id); err != nil {
			t.Fatalf("Fave(%d): %v", id, err)
		}
	}
	got, err := in.Faved(ctx, user)
	if err != nil || len(got) != 10 {
		t.Fatalf("Faved: want 10, got %d (%v)", len(got), err)
	}
	if err := in.Unfave(ctx, user, got[0].ID); err != nil {
		t.Fatalf("Unfave: %v", err)
	}
	if got, _ = in.Faved(ctx, user); len(got) != 9 {
		t.Fatalf("Faved после Unfave: want 9, got %d", len(got))
	}
}

func TestSavedGifs_LimitLIFO(t *testing.T) {
	f := newFakeRepo()
	in := New(f)
	ctx := context.Background()
	const user = int64(7)
	for k := 0; k < 205; k++ {
		mediaID := int64(10000 + k)
		f.media[mediaID] = true
		if err := in.SaveGif(ctx, user, mediaID); err != nil {
			t.Fatalf("SaveGif(%d): %v", mediaID, err)
		}
	}
	gifs, err := in.SavedGifs(ctx, user)
	if err != nil || len(gifs) != 200 {
		t.Fatalf("SavedGifs: want 200, got %d (%v)", len(gifs), err)
	}
	// LIFO: последний сохранённый — первый, самые старые 5 вытеснены.
	if gifs[0].MediaID != 10204 || gifs[199].MediaID != 10005 {
		t.Fatalf("SavedGifs order: got first=%d last=%d", gifs[0].MediaID, gifs[199].MediaID)
	}
	if err := in.SaveGif(ctx, user, 99999); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("SaveGif несуществующего media: want ErrNotFound, got %v", err)
	}
}

func TestSearchByEmoji_InstalledOnly(t *testing.T) {
	f := newFakeRepo()
	in := New(f)
	ctx := context.Background()
	installedSet, installedIDs := seedSet(t, in, f, 1, "installed_set", 2)
	_, otherIDs := seedSet(t, in, f, 1, "other_set", 2)
	const user = int64(7)
	if err := in.Install(ctx, user, installedSet.ID); err != nil {
		t.Fatalf("Install: %v", err)
	}
	got, err := in.SearchByEmoji(ctx, user, "😀")
	if err != nil {
		t.Fatalf("SearchByEmoji: %v", err)
	}
	want := map[int64]bool{installedIDs[0]: true, installedIDs[1]: true}
	if len(got) != 2 || !want[got[0].ID] || !want[got[1].ID] {
		t.Fatalf("SearchByEmoji: want %v, got %+v (лишний из %v?)", installedIDs, got, otherIDs)
	}
	if _, err := in.SearchByEmoji(ctx, user, ""); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("пустой emoji: want ErrInvalid, got %v", err)
	}
}

func TestSearchGifs_NoProviderIsEmptyPage(t *testing.T) {
	in := New(newFakeRepo())
	page, err := in.SearchGifs(context.Background(), "cats", "")
	if err != nil || page.Gifs == nil || len(page.Gifs) != 0 || page.Next != "" {
		t.Fatalf("без провайдера: want пустая страница, got %+v, %v", page, err)
	}
}

func TestCanUseStickerMedia(t *testing.T) {
	f := newFakeRepo()
	in := New(f)
	ctx := context.Background()
	_, ids := seedSet(t, in, f, 1, "media_set", 1)
	s, _ := f.StickerByID(ctx, ids[0])
	if ok, err := in.CanUseStickerMedia(ctx, 7, s.MediaID); err != nil || !ok {
		t.Fatalf("стикер-медиа: want true, got %v, %v", ok, err)
	}
	if ok, _ := in.CanUseStickerMedia(ctx, 7, 555555); ok {
		t.Fatalf("постороннее медиа: want false")
	}
}
