package notify

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/usecase/ownsync"
)

type fakeRepo struct {
	mu   sync.Mutex
	rows map[int64]domain.NotifySettings
}

func newFakeRepo() *fakeRepo { return &fakeRepo{rows: map[int64]domain.NotifySettings{}} }

func (r *fakeRepo) Get(_ context.Context, userID int64) (domain.NotifySettings, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.rows[userID]
	if !ok {
		return domain.NotifySettings{}, domain.ErrNotFound
	}
	return s, nil
}

func (r *fakeRepo) PatchType(_ context.Context, userID int64, t domain.NotifyType, muted, preview *bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.rows[userID]
	if !ok {
		s = domain.DefaultNotifySettings()
	}
	cur := s.ForType(t)
	if muted != nil {
		cur.Muted = *muted
	}
	if preview != nil {
		cur.Preview = *preview
	}
	r.rows[userID] = s.WithType(t, cur)
	return nil
}

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

func ptr[T any](v T) *T { return &v }

func newUC() (*Interactor, *fakeLog, *fakePub) {
	log, pub := newFakeLog(), &fakePub{}
	uc := New(newFakeRepo())
	uc.SetEmitter(ownsync.New(log, pub, nil))
	uc.now = func() time.Time { return time.Unix(1_800_000_000, 0) }
	return uc, log, pub
}

func TestUpdate_MuteUntilFutureStoresForever_PreviewKept(t *testing.T) {
	uc, _, _ := newUC()
	ctx := context.Background()
	if err := uc.Update(ctx, 1, domain.NotifyTypeUsers, domain.InputPeerNotifySettings{ShowPreviews: ptr(false)}); err != nil {
		t.Fatal(err)
	}
	if err := uc.Update(ctx, 1, domain.NotifyTypeUsers, domain.InputPeerNotifySettings{MuteUntil: ptr(int64(domain.MuteUntilForever))}); err != nil {
		t.Fatal(err)
	}
	got, err := uc.Get(ctx, 1, domain.NotifyTypeUsers)
	if err != nil {
		t.Fatal(err)
	}
	if got.MuteUntil == nil || *got.MuteUntil != domain.MuteUntilForever {
		t.Fatalf("mute_until = %v", got.MuteUntil)
	}
	if got.ShowPreviews == nil || *got.ShowPreviews {
		t.Fatalf("show_previews затёрт мьютом: %v", got.ShowPreviews)
	}
	// Остальные типы не тронуты.
	other, _ := uc.Get(ctx, 1, domain.NotifyTypeChats)
	if *other.MuteUntil != 0 || !*other.ShowPreviews {
		t.Fatalf("notifyChats изменился: %+v", other)
	}
}

func TestUpdate_MuteUntilZeroUnmutes(t *testing.T) {
	uc, _, _ := newUC()
	ctx := context.Background()
	_ = uc.Update(ctx, 1, domain.NotifyTypeChats, domain.InputPeerNotifySettings{MuteUntil: ptr(int64(domain.MuteUntilForever))})
	_ = uc.Update(ctx, 1, domain.NotifyTypeChats, domain.InputPeerNotifySettings{MuteUntil: ptr(int64(0))})
	got, _ := uc.Get(ctx, 1, domain.NotifyTypeChats)
	if got.MuteUntil == nil || *got.MuteUntil != 0 {
		t.Fatalf("mute_until = %v, want явный 0", got.MuteUntil)
	}
}

// Срок в прошлом — уже не мьют (как у пер-чатного мьюта: истёкший срок = 0).
func TestUpdate_ExpiredMuteUntilIsUnmuted(t *testing.T) {
	uc, _, _ := newUC()
	ctx := context.Background()
	_ = uc.Update(ctx, 1, domain.NotifyTypeBroadcasts, domain.InputPeerNotifySettings{MuteUntil: ptr(int64(domain.MuteUntilForever))})
	_ = uc.Update(ctx, 1, domain.NotifyTypeBroadcasts, domain.InputPeerNotifySettings{MuteUntil: ptr(int64(1_700_000_000))})
	got, _ := uc.Get(ctx, 1, domain.NotifyTypeBroadcasts)
	if *got.MuteUntil != 0 {
		t.Fatalf("mute_until = %d", *got.MuteUntil)
	}
}

func TestGet_DefaultsWhenNeverSaved(t *testing.T) {
	uc, _, _ := newUC()
	got, err := uc.Get(context.Background(), 9, domain.NotifyTypeUsers)
	if err != nil || got.MuteUntil == nil || *got.MuteUntil != 0 || got.ShowPreviews == nil || !*got.ShowPreviews {
		t.Fatalf("%+v, %v", got, err)
	}
}

// Журнал владельца получает строку notify_settings с адресом типа; у чужого — ничего.
func TestUpdate_LogsOwnRowOnly(t *testing.T) {
	uc, log, pub := newUC()
	ctx := context.Background()
	if err := uc.Update(ctx, 1, domain.NotifyTypeUsers, domain.InputPeerNotifySettings{MuteUntil: ptr(int64(domain.MuteUntilForever))}); err != nil {
		t.Fatal(err)
	}
	if len(log.rows[1]) != 1 || len(log.rows[2]) != 0 {
		t.Fatalf("строки: владелец %d, чужой %d", len(log.rows[1]), len(log.rows[2]))
	}
	row := log.rows[1][0]
	var body struct {
		Underscore string `json:"_"`
		Peer       struct {
			Underscore string `json:"_"`
		} `json:"peer"`
		Settings struct {
			Underscore string `json:"_"`
			MuteUntil  *int   `json:"mute_until"`
		} `json:"notify_settings"`
	}
	if err := json.Unmarshal(row.payload, &body); err != nil {
		t.Fatal(err)
	}
	if row.typ != "notify_settings" || body.Underscore != domain.UpdateNotifySettingsTag ||
		body.Peer.Underscore != "notifyUsers" || body.Settings.Underscore != domain.PeerNotifySettingsTag ||
		body.Settings.MuteUntil == nil || *body.Settings.MuteUntil != domain.MuteUntilForever {
		t.Fatalf("строка = %s (%s)", row.payload, row.typ)
	}
	if len(pub.frames[1]) != 1 || len(pub.frames[2]) != 0 {
		t.Fatalf("кадры: владелец %d, чужой %d", len(pub.frames[1]), len(pub.frames[2]))
	}
}

// Без эмиттера (тесты, сборка без журнала) мутация проходит.
func TestUpdate_WithoutEmitter(t *testing.T) {
	uc := New(newFakeRepo())
	if err := uc.Update(context.Background(), 1, domain.NotifyTypeUsers, domain.InputPeerNotifySettings{ShowPreviews: ptr(false)}); err != nil {
		t.Fatal(err)
	}
}
