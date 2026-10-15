package stickers

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/usecase/ownsync"
)

// Журнал своих устройств (f6-stickers): каждая мутация пишет строку на
// устройства владельца — tweb appStickersManager.ts:80-88, appGifsManager.ts:21-29.

type loggedRow struct {
	pts     int64
	typ     string
	payload json.RawMessage
}

type fakeLog struct {
	mu   sync.Mutex
	pts  map[int64]int64
	rows map[int64][]loggedRow
}

func newFakeLog() *fakeLog { return &fakeLog{pts: map[int64]int64{}, rows: map[int64][]loggedRow{}} }

func (l *fakeLog) AppendUpdate(_ context.Context, userID int64, n int, _ int64, typ string, payload json.RawMessage) (int64, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.pts[userID] += int64(n)
	l.rows[userID] = append(l.rows[userID], loggedRow{l.pts[userID], typ, payload})
	return l.pts[userID], nil
}

func (l *fakeLog) AppendUpdateBulk(ctx context.Context, ids []int64, n int, d int64, typ string, p json.RawMessage) (map[int64]int64, error) {
	out := map[int64]int64{}
	for _, id := range ids {
		pts, _ := l.AppendUpdate(ctx, id, n, d, typ, p)
		out[id] = pts
	}
	return out, nil
}

func (l *fakeLog) LockState(context.Context, int64) error { return nil }

type fakePub struct {
	mu     sync.Mutex
	frames map[int64][][]byte
}

func (p *fakePub) PublishToUser(_ context.Context, userID int64, f []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.frames == nil {
		p.frames = map[int64][][]byte{}
	}
	p.frames[userID] = append(p.frames[userID], f)
	return nil
}

func newSyncInteractor() (*Interactor, *fakeRepo, *fakeLog, *fakePub) {
	f := newFakeRepo()
	in := newInteractor(f)
	log, pub := newFakeLog(), &fakePub{}
	in.SetEmitter(ownsync.New(log, pub, nil))
	return in, f, log, pub
}

// rows — типы строк журнала пользователя по порядку.
func (l *fakeLog) types(userID int64) []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	var out []string
	for _, r := range l.rows[userID] {
		out = append(out, r.typ)
	}
	return out
}

func (l *fakeLog) last(userID int64) loggedRow {
	l.mu.Lock()
	defer l.mu.Unlock()
	r := l.rows[userID]
	return r[len(r)-1]
}

func wantTypes(t *testing.T, l *fakeLog, userID int64, want ...string) {
	t.Helper()
	got := l.types(userID)
	if len(got) != len(want) {
		t.Fatalf("строки журнала = %v, want %v", got, want)
	}
	for k := range want {
		if got[k] != want[k] {
			t.Fatalf("строки журнала = %v, want %v", got, want)
		}
	}
}

func bodyUnderscore(t *testing.T, r loggedRow) string {
	t.Helper()
	var b struct {
		U string `json:"_"`
	}
	if err := json.Unmarshal(r.payload, &b); err != nil {
		t.Fatal(err)
	}
	return b.U
}

func TestSync_InstallWritesNewStickerSetWithFullSet(t *testing.T) {
	in, f, log, pub := newSyncInteractor()
	ctx := context.Background()
	set, _ := seedSet(t, in, f, 1, "sync_set", 2)
	const user = int64(7)

	if err := in.Install(ctx, user, set.ID); err != nil {
		t.Fatal(err)
	}
	wantTypes(t, log, user, "stickers_new_set")
	row := log.last(user)
	var body struct {
		U          string `json:"_"`
		Stickerset struct {
			U         string             `json:"_"`
			Set       struct{ ID int64 } `json:"set"`
			Documents []json.RawMessage  `json:"documents"`
		} `json:"stickerset"`
	}
	if err := json.Unmarshal(row.payload, &body); err != nil {
		t.Fatal(err)
	}
	if body.U != domain.UpdateNewStickerSetTag || body.Stickerset.U != domain.MessagesStickerSetTag {
		t.Fatalf("тело = %s", row.payload)
	}
	if body.Stickerset.Set.ID != set.ID || len(body.Stickerset.Documents) != 2 {
		t.Fatalf("набор в строке неполный: %s", row.payload)
	}
	if len(pub.frames[user]) != 1 {
		t.Fatalf("живых кадров = %d, want 1", len(pub.frames[user]))
	}
	// Чужим устройствам строк нет.
	if got := log.types(1); len(got) != 0 {
		t.Fatalf("у владельца набора строки: %v", got)
	}
}

func TestSync_InstallTwiceWritesOnce(t *testing.T) {
	in, f, log, _ := newSyncInteractor()
	ctx := context.Background()
	set, _ := seedSet(t, in, f, 1, "twice_set", 1)
	for range 2 {
		if err := in.Install(ctx, 7, set.ID); err != nil {
			t.Fatal(err)
		}
	}
	wantTypes(t, log, 7, "stickers_new_set")
}

func TestSync_InstallUnknownSetWritesNothing(t *testing.T) {
	in, _, log, _ := newSyncInteractor()
	if err := in.Install(context.Background(), 7, 9999); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
	wantTypes(t, log, 7)
}

// Uninstall без кадра (В-5): tweb updateStickerSets закомментирован.
func TestSync_UninstallWritesNothing(t *testing.T) {
	in, f, log, _ := newSyncInteractor()
	ctx := context.Background()
	set, _ := seedSet(t, in, f, 1, "un_set", 1)
	_ = in.Install(ctx, 7, set.ID)
	if err := in.Uninstall(ctx, 7, set.ID); err != nil {
		t.Fatal(err)
	}
	wantTypes(t, log, 7, "stickers_new_set")
}

func TestSync_UseWritesRecentOnlyWhenOrderChanges(t *testing.T) {
	in, f, log, _ := newSyncInteractor()
	ctx := context.Background()
	_, sts := seedSet(t, in, f, 1, "use_set", 2)
	const user = int64(7)

	if err := in.Use(ctx, user, sts[0].MediaID); err != nil {
		t.Fatal(err)
	}
	// Тот же стикер уже первый: порядок не меняется — строки нет.
	if err := in.Use(ctx, user, sts[0].MediaID); err != nil {
		t.Fatal(err)
	}
	wantTypes(t, log, user, "stickers_recent")
	if bodyUnderscore(t, log.last(user)) != domain.UpdateRecentStickersTag {
		t.Fatalf("тело = %s", log.last(user).payload)
	}
	// Другой стикер вышел вперёд — строка.
	if err := in.Use(ctx, user, sts[1].MediaID); err != nil {
		t.Fatal(err)
	}
	// И возврат первого — снова смена порядка.
	if err := in.Use(ctx, user, sts[0].MediaID); err != nil {
		t.Fatal(err)
	}
	wantTypes(t, log, user, "stickers_recent", "stickers_recent", "stickers_recent")
}

func TestSync_UseUnknownStickerWritesNothing(t *testing.T) {
	in, _, log, _ := newSyncInteractor()
	if err := in.Use(context.Background(), 7, 424242); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
	wantTypes(t, log, 7)
}

func TestSync_ClearRecentWritesRecent(t *testing.T) {
	in, _, log, _ := newSyncInteractor()
	if err := in.ClearRecent(context.Background(), 7); err != nil {
		t.Fatal(err)
	}
	wantTypes(t, log, 7, "stickers_recent")
	if bodyUnderscore(t, log.last(7)) != domain.UpdateRecentStickersTag {
		t.Fatalf("тело = %s", log.last(7).payload)
	}
}

func TestSync_FaveUnfaveWriteFaved(t *testing.T) {
	in, f, log, _ := newSyncInteractor()
	ctx := context.Background()
	_, sts := seedSet(t, in, f, 1, "fav_sync", 1)
	if err := in.Fave(ctx, 7, sts[0].MediaID); err != nil {
		t.Fatal(err)
	}
	if err := in.Unfave(ctx, 7, sts[0].MediaID); err != nil {
		t.Fatal(err)
	}
	wantTypes(t, log, 7, "stickers_faved", "stickers_faved")
	if bodyUnderscore(t, log.last(7)) != domain.UpdateFavedStickersTag {
		t.Fatalf("тело = %s", log.last(7).payload)
	}
	if err := in.Fave(ctx, 7, 424242); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
	wantTypes(t, log, 7, "stickers_faved", "stickers_faved")
}

func TestSync_SaveDeleteGifWriteSavedGifs(t *testing.T) {
	in, f, log, _ := newSyncInteractor()
	ctx := context.Background()
	f.media[20] = domain.Media{ID: 20, OwnerID: 2, Mime: "video/mp4", Animated: true}
	f.media[21] = domain.Media{ID: 21, OwnerID: 2, Mime: "image/jpeg"}
	if err := in.SaveGif(ctx, 7, 20); err != nil {
		t.Fatal(err)
	}
	// Отказ проверки Ф7-А — без строки.
	if err := in.SaveGif(ctx, 7, 21); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
	if err := in.DeleteGif(ctx, 7, 20); err != nil {
		t.Fatal(err)
	}
	wantTypes(t, log, 7, "saved_gifs", "saved_gifs")
	if bodyUnderscore(t, log.last(7)) != domain.UpdateSavedGifsTag {
		t.Fatalf("тело = %s", log.last(7).payload)
	}
}

// Без подключённого журнала мутации работают как прежде.
func TestSync_NoEmitterIsHarmless(t *testing.T) {
	f := newFakeRepo()
	in := newInteractor(f)
	_, sts := seedSet(t, in, f, 1, "noemit", 1)
	if err := in.Use(context.Background(), 7, sts[0].MediaID); err != nil {
		t.Fatal(err)
	}
}

// StickerSetWire — тот же контейнер, что отдаёт GET набора.
func TestStickerSetWire(t *testing.T) {
	in, f, _, _ := newSyncInteractor()
	set, _ := seedSet(t, in, f, 1, "wire_set", 2)
	got, err := in.StickerSetWire(context.Background(), 7, set.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Underscore != domain.MessagesStickerSetTag || got.Set.ID != set.ID || len(got.Documents) != 2 {
		t.Fatalf("контейнер = %+v", got)
	}
	if _, err := in.StickerSetWire(context.Background(), 7, 9999); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
}
