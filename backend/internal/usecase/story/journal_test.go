package story

import (
	"context"
	"encoding/json"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/usecase/ownsync"
)

// fakeJournal — пер-юзерный журнал апдейтов: ровно то, что getDifference потом
// отдаёт устройству. Строка — тип и тело-конструктор.
type fakeJournal struct {
	mu   sync.Mutex
	pts  map[int64]int64
	rows map[int64][]journalRow
}

type journalRow struct {
	pts     int64
	typ     string
	payload json.RawMessage
}

func newFakeJournal() *fakeJournal {
	return &fakeJournal{pts: map[int64]int64{}, rows: map[int64][]journalRow{}}
}

func (l *fakeJournal) AppendUpdate(_ context.Context, userID int64, n int, _ int64, typ string, payload json.RawMessage) (int64, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.pts[userID] += int64(n)
	l.rows[userID] = append(l.rows[userID], journalRow{l.pts[userID], typ, payload})
	return l.pts[userID], nil
}

func (l *fakeJournal) AppendUpdateBulk(ctx context.Context, ids []int64, n int, d int64, typ string, p json.RawMessage) (map[int64]int64, error) {
	out := map[int64]int64{}
	for _, id := range ids {
		pts, _ := l.AppendUpdate(ctx, id, n, d, typ, p)
		out[id] = pts
	}
	return out, nil
}

func (l *fakeJournal) LockState(context.Context, int64) error { return nil }

// body — тело строки журнала словарём.
func (r journalRow) body(t *testing.T) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(r.payload, &m); err != nil {
		t.Fatalf("тело строки не разбирается: %v", err)
	}
	return m
}

// useJournal подключает к сервису журнал и живой издатель через ownsync.
func useJournal(svc *Service, pub *fakePublisher) *fakeJournal {
	log := newFakeJournal()
	svc.SetEmitter(ownsync.New(log, pub, nil))
	return log
}

// rowsOf — строки журнала пользователя заданного типа.
func rowsOf(l *fakeJournal, userID int64, typ string) []journalRow {
	var out []journalRow
	for _, r := range l.rows[userID] {
		if r.typ == typ {
			out = append(out, r)
		}
	}
	return out
}

// storyOf — вложенный объект `story` тела updateStory.
func storyOf(t *testing.T, r journalRow) map[string]any {
	t.Helper()
	st, _ := r.body(t)["story"].(map[string]any)
	if st == nil {
		t.Fatalf("в теле нет story: %s", r.payload)
	}
	return st
}

// framesTagged — кадры пользователю с данным дискриминатором тела.
func framesTagged(t *testing.T, pub *fakePublisher, userID int64, tag string) [][]byte {
	t.Helper()
	var out [][]byte
	for _, f := range pub.frames[userID] {
		if frameTag(t, f) == tag {
			out = append(out, f)
		}
	}
	return out
}

// ownsyncNew — эмиттер без живого издателя (сборка без Redis).
func ownsyncNew(log *fakeJournal) *ownsync.Emitter { return ownsync.New(log, nil, nil) }
