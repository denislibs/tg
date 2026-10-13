package privacy

import (
	"context"
	"encoding/json"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/usecase/ownsync"
)

// syncRepo — хранилище правил и блокировок, нужное записи в журнал.
type syncRepo struct {
	Repo
	mu      sync.Mutex
	rules   map[domain.PrivacyKey]domain.PrivacyRuleRecord
	blocked map[[2]int64]bool
}

func newSyncRepo() *syncRepo {
	return &syncRepo{rules: map[domain.PrivacyKey]domain.PrivacyRuleRecord{}, blocked: map[[2]int64]bool{}}
}

func (r *syncRepo) Upsert(_ context.Context, _ int64, rule domain.PrivacyRuleRecord) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.rules[rule.Key] = rule
	return nil
}

func (r *syncRepo) Get(_ context.Context, _ int64, key domain.PrivacyKey) (domain.PrivacyRuleRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if rule, ok := r.rules[key]; ok {
		return rule, nil
	}
	return domain.PrivacyRuleRecord{}, domain.ErrNotFound
}

func (r *syncRepo) Block(_ context.Context, a, b int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.blocked[[2]int64{a, b}] = true
	return nil
}

func (r *syncRepo) Unblock(_ context.Context, a, b int64) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	had := r.blocked[[2]int64{a, b}]
	delete(r.blocked, [2]int64{a, b})
	return had, nil
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

type announcerCall struct {
	userID   int64
	viewers  []int64
	targeted bool
}

type fakeAnnouncer struct{ calls []announcerCall }

func (a *fakeAnnouncer) AnnounceUser(_ context.Context, userID int64) error {
	a.calls = append(a.calls, announcerCall{userID: userID})
	return nil
}

func (a *fakeAnnouncer) AnnounceUserTo(_ context.Context, userID int64, viewers []int64) error {
	a.calls = append(a.calls, announcerCall{userID: userID, viewers: viewers, targeted: true})
	return nil
}

type fakeReannouncer struct{ calls []announcerCall }

func (a *fakeReannouncer) Reannounce(_ context.Context, userID int64) error {
	a.calls = append(a.calls, announcerCall{userID: userID})
	return nil
}

func (a *fakeReannouncer) ReannounceTo(_ context.Context, userID int64, viewers []int64) error {
	a.calls = append(a.calls, announcerCall{userID: userID, viewers: viewers, targeted: true})
	return nil
}

func newSyncUC() (*Interactor, *fakeLog, *fakePub, *fakeAnnouncer, *fakeReannouncer) {
	log, pub := newFakeLog(), &fakePub{}
	ann, re := &fakeAnnouncer{}, &fakeReannouncer{}
	uc := New(newSyncRepo())
	uc.async = func(f func()) { f() }
	uc.SetEmitter(ownsync.New(log, pub, nil))
	uc.SetAnnouncer(ann)
	uc.SetReannouncer(re)
	return uc, log, pub, ann, re
}

func rowBody(t *testing.T, row loggedRow) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(row.payload, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

// Блок: своим устройствам — строка журнала updatePeerBlocked; заблокированному
// пересчитывают карточку и статус АДРЕСНО ему одному, а не всем партнёрам.
func TestBlock_LogsToOwnDevicesAndRecomputesTargetOnly(t *testing.T) {
	uc, log, pub, ann, re := newSyncUC()
	ctx := context.Background()

	if err := uc.Block(ctx, 1, 2); err != nil {
		t.Fatal(err)
	}
	rows := log.rows[1]
	if len(rows) != 1 || rows[0].typ != "peer_blocked" {
		t.Fatalf("журнал Алисы = %+v; ждали одну строку peer_blocked", rows)
	}
	body := rowBody(t, rows[0])
	if body["_"] != domain.UpdatePeerBlockedTag {
		t.Fatalf("тело = %v", body)
	}
	if flags, _ := body["pFlags"].(map[string]any); flags["blocked"] != true {
		t.Fatalf("нет pFlags.blocked: %v", body)
	}
	if peer, _ := body["peer_id"].(map[string]any); peer["_"] != "peerUser" || peer["user_id"] != float64(2) {
		t.Fatalf("peer_id = %v", body["peer_id"])
	}
	if _, stray := body["pts"]; stray {
		t.Fatalf("курсор попал в тело: %v", body)
	}
	if len(log.rows[2]) != 0 || len(pub.frames[2]) != 0 {
		t.Fatalf("заблокированному ушла строка или кадр о самом блоке")
	}
	var env struct {
		T   string `json:"t"`
		Pts int64  `json:"pts"`
	}
	if err := json.Unmarshal(pub.frames[1][0], &env); err != nil || env.T != "peer_blocked" || env.Pts != rows[0].pts {
		t.Fatalf("кадр = %s (%v); курсор должен быть в конверте", pub.frames[1][0], err)
	}
	if len(ann.calls) != 1 || !ann.calls[0].targeted || ann.calls[0].userID != 1 ||
		len(ann.calls[0].viewers) != 1 || ann.calls[0].viewers[0] != 2 {
		t.Fatalf("AnnounceUserTo: %+v", ann.calls)
	}
	if len(re.calls) != 1 || !re.calls[0].targeted || re.calls[0].viewers[0] != 2 {
		t.Fatalf("ReannounceTo: %+v", re.calls)
	}
}

// Разблок: тот же конструктор без pFlags («выключено» — отсутствие ключа).
func TestUnblock_BodyWithoutFlags(t *testing.T) {
	uc, log, _, ann, re := newSyncUC()
	ctx := context.Background()
	_ = uc.Block(ctx, 1, 2)
	ann.calls, re.calls = nil, nil

	if err := uc.Unblock(ctx, 1, 2); err != nil {
		t.Fatal(err)
	}
	rows := log.rows[1]
	if len(rows) != 2 || rows[1].typ != "peer_blocked" {
		t.Fatalf("журнал = %+v", rows)
	}
	if _, has := rowBody(t, rows[1])["pFlags"]; has {
		t.Fatalf("у разблока остался pFlags: %s", rows[1].payload)
	}
	if len(ann.calls) != 1 || !ann.calls[0].targeted || len(re.calls) != 1 || !re.calls[0].targeted {
		t.Fatalf("разблок не пересчитал адресно: %+v %+v", ann.calls, re.calls)
	}
}

// Разблок того, кто не был заблокирован, ничего не меняет — строку не пишем.
func TestUnblock_NotBlockedWritesNothing(t *testing.T) {
	uc, log, _, ann, re := newSyncUC()
	if err := uc.Unblock(context.Background(), 1, 2); err != nil {
		t.Fatal(err)
	}
	if len(log.rows[1]) != 0 || len(ann.calls) != 0 || len(re.calls) != 0 {
		t.Fatalf("лишние записи: %+v %+v %+v", log.rows, ann.calls, re.calls)
	}
}

// last_seen → снимок правила своим устройствам + статус всем партнёрам; карточку
// (фото) это правило не меняет.
func TestSetRule_LastSeen_LogsSnapshotAndReannouncesPresence(t *testing.T) {
	uc, log, _, ann, re := newSyncUC()
	ctx := context.Background()

	_, err := uc.SetRule(ctx, 1, domain.PrivacyRuleRecord{Key: domain.PrivacyLastSeen, Value: domain.PrivacyNobody})
	if err != nil {
		t.Fatal(err)
	}
	rows := log.rows[1]
	if len(rows) != 1 || rows[0].typ != "privacy_update" {
		t.Fatalf("журнал = %+v", rows)
	}
	body := rowBody(t, rows[0])
	key, _ := body["key"].(map[string]any)
	if body["_"] != domain.UpdatePrivacyTag || key["_"] != "privacyKeyStatusTimestamp" {
		t.Fatalf("тело = %v", body)
	}
	rules, _ := body["rules"].([]any)
	if len(rules) != 1 || rules[0].(map[string]any)["_"] != "privacyValueDisallowAll" {
		t.Fatalf("rules = %v", body["rules"])
	}
	if len(re.calls) != 1 || re.calls[0].targeted || re.calls[0].userID != 1 {
		t.Fatalf("Reannounce: %+v", re.calls)
	}
	if len(ann.calls) != 0 {
		t.Fatalf("карточку пересылать не нужно: %+v", ann.calls)
	}
}

// profile_photo → карточка всем партнёрам, присутствие не трогаем.
func TestSetRule_ProfilePhoto_AnnouncesCardOnly(t *testing.T) {
	uc, log, _, ann, re := newSyncUC()
	_, err := uc.SetRule(context.Background(), 1, domain.PrivacyRuleRecord{Key: domain.PrivacyProfilePhoto, Value: domain.PrivacyContacts})
	if err != nil {
		t.Fatal(err)
	}
	if len(log.rows[1]) != 1 || log.rows[1][0].typ != "privacy_update" {
		t.Fatalf("журнал = %+v", log.rows[1])
	}
	if len(ann.calls) != 1 || ann.calls[0].targeted || ann.calls[0].userID != 1 {
		t.Fatalf("AnnounceUser: %+v", ann.calls)
	}
	if len(re.calls) != 0 {
		t.Fatalf("Reannounce вызван зря: %+v", re.calls)
	}
}

// Остальные ключи (about, calls…) пересчёта у собеседников не требуют.
func TestSetRule_OtherKey_NoRecompute(t *testing.T) {
	uc, log, _, ann, re := newSyncUC()
	_, err := uc.SetRule(context.Background(), 1, domain.PrivacyRuleRecord{Key: domain.PrivacyCalls, Value: domain.PrivacyNobody})
	if err != nil {
		t.Fatal(err)
	}
	if len(log.rows[1]) != 1 || len(ann.calls) != 0 || len(re.calls) != 0 {
		t.Fatalf("%+v %+v %+v", log.rows[1], ann.calls, re.calls)
	}
}

// Неверное правило: ни строки, ни пересчёта.
func TestSetRule_BadRule_NoSideEffects(t *testing.T) {
	uc, log, _, ann, re := newSyncUC()
	_, err := uc.SetRule(context.Background(), 1, domain.PrivacyRuleRecord{Key: "nope", Value: domain.PrivacyNobody})
	if err != ErrBadRule {
		t.Fatalf("err = %v", err)
	}
	if len(log.rows[1]) != 0 || len(ann.calls) != 0 || len(re.calls) != 0 {
		t.Fatal("побочные эффекты при отказе")
	}
}

// Без журнала и без пересчётчиков (нет Redis) мутации проходят.
func TestMutationsWorkWithoutWiring(t *testing.T) {
	uc := New(newSyncRepo())
	ctx := context.Background()
	if err := uc.Block(ctx, 1, 2); err != nil {
		t.Fatal(err)
	}
	if err := uc.Unblock(ctx, 1, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := uc.SetRule(ctx, 1, domain.PrivacyRuleRecord{Key: domain.PrivacyLastSeen, Value: domain.PrivacyNobody}); err != nil {
		t.Fatal(err)
	}
}
