package ownsync

import (
	"context"
	"encoding/json"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type loggedRow struct {
	pts     int64
	typ     string
	payload json.RawMessage
}

// fakeLog — журнал в памяти с плотным pts, как у postgres. LockState держит
// пер-юзерный мьютекс до конца транзакции fakeTx, как FOR UPDATE.
type fakeLog struct {
	mu        sync.Mutex
	pts       map[int64]int64
	rows      map[int64][]loggedRow
	bulkCalls [][]int64
	locks     map[int64]*sync.Mutex
}

func newFakeLog() *fakeLog {
	return &fakeLog{pts: map[int64]int64{}, rows: map[int64][]loggedRow{}, locks: map[int64]*sync.Mutex{}}
}

func (l *fakeLog) AppendUpdate(_ context.Context, userID int64, ptsCount int, _ int64, typ string, payload json.RawMessage) (int64, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.pts[userID] += int64(ptsCount)
	p := l.pts[userID]
	l.rows[userID] = append(l.rows[userID], loggedRow{pts: p, typ: typ, payload: payload})
	return p, nil
}

func (l *fakeLog) AppendUpdateBulk(ctx context.Context, userIDs []int64, ptsCount int, date int64, typ string, payload json.RawMessage) (map[int64]int64, error) {
	l.mu.Lock()
	l.bulkCalls = append(l.bulkCalls, append([]int64(nil), userIDs...))
	l.mu.Unlock()
	out := map[int64]int64{}
	for _, uid := range userIDs {
		p, _ := l.AppendUpdate(ctx, uid, ptsCount, date, typ, payload)
		out[uid] = p
	}
	return out, nil
}

type txState struct{ release []func() }
type txKey struct{}

func (l *fakeLog) LockState(ctx context.Context, userID int64) error {
	l.mu.Lock()
	m, ok := l.locks[userID]
	if !ok {
		m = &sync.Mutex{}
		l.locks[userID] = m
	}
	l.mu.Unlock()
	m.Lock()
	st := ctx.Value(txKey{}).(*txState)
	st.release = append(st.release, m.Unlock)
	return nil
}

type fakeTx struct{}

func (fakeTx) WithinTx(ctx context.Context, fn func(context.Context) error) error {
	st := &txState{}
	defer func() {
		for _, r := range st.release {
			r()
		}
	}()
	return fn(context.WithValue(ctx, txKey{}, st))
}

type fakePub struct {
	mu     sync.Mutex
	frames map[int64][][]byte
}

func newFakePub() *fakePub { return &fakePub{frames: map[int64][][]byte{}} }

func (p *fakePub) PublishToUser(_ context.Context, userID int64, frame []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.frames[userID] = append(p.frames[userID], frame)
	return nil
}

type envelope struct {
	T    string          `json:"t"`
	Pts  *int64          `json:"pts"`
	D    map[string]any  `json:"d"`
	Refs json.RawMessage `json:"_refs"`
}

func decode(t *testing.T, raw []byte) envelope {
	t.Helper()
	var env envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatalf("кадр не разбирается: %v", err)
	}
	return env
}

// Конструктор без параметра pts (updateNotifySettings): курсор едет в конверте,
// в теле его нет — иначе на конструкторе появилось бы поле, которого в схеме нет.
func TestEmit_EnvelopePtsForConstructorWithoutPts(t *testing.T) {
	log, pub := newFakeLog(), newFakePub()
	e := New(log, pub, nil)
	body := map[string]any{"_": domain.UpdateNotifySettingsTag, "peer": map[string]any{"_": "notifyUsers"}}
	if err := e.Emit(context.Background(), []int64{7}, "notify_settings", body); err != nil {
		t.Fatal(err)
	}
	row := log.rows[7][0]
	if row.typ != "notify_settings" {
		t.Fatalf("тип строки = %q", row.typ)
	}
	var logged map[string]any
	_ = json.Unmarshal(row.payload, &logged)
	if logged["_"] != domain.UpdateNotifySettingsTag {
		t.Fatalf("тело строки без _: %v", logged)
	}
	env := decode(t, pub.frames[7][0])
	if env.T != "notify_settings" || env.Pts == nil || *env.Pts != row.pts || env.D["pts"] != nil {
		t.Fatalf("конверт = %+v", env)
	}
}

// Конструктор с параметром pts (updatePinnedMessages): курсор в теле, не в конверте.
func TestEmit_BodyPtsForConstructorWithPts(t *testing.T) {
	log, pub := newFakeLog(), newFakePub()
	e := New(log, pub, nil)
	body := map[string]any{"_": domain.UpdatePinnedMessagesTag, "messages": []int64{1}}
	if err := e.Emit(context.Background(), []int64{7}, "pin_message", body); err != nil {
		t.Fatal(err)
	}
	env := decode(t, pub.frames[7][0])
	if env.Pts != nil || env.D["pts"] != float64(log.rows[7][0].pts) {
		t.Fatalf("конверт = %+v", env)
	}
	if _, mutated := body["pts"]; mutated {
		t.Fatal("общее тело мутировано: pts попал в body вызывающего")
	}
}

func TestEmit_NilSafe(t *testing.T) {
	ctx := context.Background()
	if err := New(nil, nil, nil).Emit(ctx, []int64{1}, "x", map[string]any{"_": "x"}); err != nil {
		t.Fatalf("Emit без журнала: %v", err)
	}
	if err := New(nil, nil, nil).EmitSnapshot(ctx, 1, "x", func(context.Context) (map[string]any, error) {
		t.Fatal("build зван без журнала")
		return nil, nil
	}); err != nil {
		t.Fatalf("EmitSnapshot без журнала: %v", err)
	}
	var nilEmitter *Emitter
	if err := nilEmitter.Emit(ctx, []int64{1}, "x", nil); err != nil {
		t.Fatal(err)
	}
	// Без издателя пишет журнал и молчит.
	log := newFakeLog()
	if err := New(log, nil, nil).Emit(ctx, []int64{1}, "x", map[string]any{"_": "x"}); err != nil {
		t.Fatal(err)
	}
	if len(log.rows[1]) != 1 {
		t.Fatalf("строк = %d", len(log.rows[1]))
	}
}

// Ссылки тела на пиров едут в конверте: по ним соединение доклеивает карточки.
func TestEmit_EnvelopeCarriesPeerRefs(t *testing.T) {
	log, pub := newFakeLog(), newFakePub()
	body := map[string]any{"_": domain.UpdateNotifySettingsTag, "peer_id": domain.NewPeerUser(5)}
	if err := New(log, pub, nil).Emit(context.Background(), []int64{7}, "notify_settings", body); err != nil {
		t.Fatal(err)
	}
	env := decode(t, pub.frames[7][0])
	var refs domain.PeerRefs
	if err := json.Unmarshal(env.Refs, &refs); err != nil || !reflect.DeepEqual(refs.Users, []int64{5}) {
		t.Fatalf("_refs = %s (%v)", env.Refs, err)
	}
}

// Дубль id валил бы INSERT … ON CONFLICT, а разный порядок двух параллельных
// пачек — взаимная блокировка на user_state: в журнал идёт отсортированный набор.
func TestEmit_RecipientsDedupedAndSorted(t *testing.T) {
	log, pub := newFakeLog(), newFakePub()
	body := map[string]any{"_": domain.UpdateNotifySettingsTag}
	if err := New(log, pub, nil).Emit(context.Background(), []int64{9, 7, 9}, "notify_settings", body); err != nil {
		t.Fatal(err)
	}
	if len(log.bulkCalls) != 1 || !reflect.DeepEqual(log.bulkCalls[0], []int64{7, 9}) {
		t.Fatalf("AppendUpdateBulk получил %v, want [[7 9]]", log.bulkCalls)
	}
	if len(log.rows[7]) != 1 || len(log.rows[9]) != 1 || len(pub.frames[7]) != 1 || len(pub.frames[9]) != 1 {
		t.Fatalf("строки %d/%d, кадры %d/%d", len(log.rows[7]), len(log.rows[9]), len(pub.frames[7]), len(pub.frames[9]))
	}
}

func TestEmit_DoesNotMutateCallerSlice(t *testing.T) {
	log := newFakeLog()
	ids := []int64{9, 7, 9}
	_ = New(log, nil, nil).Emit(context.Background(), ids, "x", map[string]any{"_": "x"})
	if !reflect.DeepEqual(ids, []int64{9, 7, 9}) {
		t.Fatalf("срез вызывающего изменён: %v", ids)
	}
}

// Два устройства: снимок A собран ДО мутации B, но запись A не может лечь после
// записи B со старым значением. Блокировка строки курсора заставляет B ждать, а
// build — перечитать состояние уже под замком, поэтому большему pts достаётся
// не более старое состояние.
func TestEmitSnapshot_LargerPtsNeverHoldsOlderState(t *testing.T) {
	log, pub := newFakeLog(), newFakePub()
	e := New(log, pub, fakeTx{})
	ctx := context.Background()

	var stateMu sync.Mutex
	state := 1
	read := func() int { stateMu.Lock(); defer stateMu.Unlock(); return state }

	aReading := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { // устройство A: build читает 1 и «думает» под замком
		defer wg.Done()
		err := e.EmitSnapshot(ctx, 7, "notify_settings", func(context.Context) (map[string]any, error) {
			v := read()
			close(aReading)
			time.Sleep(50 * time.Millisecond)
			return map[string]any{"_": domain.UpdateNotifySettingsTag, "v": v}, nil
		})
		if err != nil {
			t.Error(err)
		}
	}()
	go func() { // устройство B: мутация закоммичена, пока A в build, затем её эмит
		defer wg.Done()
		<-aReading
		stateMu.Lock()
		state = 2
		stateMu.Unlock()
		err := e.EmitSnapshot(ctx, 7, "notify_settings", func(context.Context) (map[string]any, error) {
			return map[string]any{"_": domain.UpdateNotifySettingsTag, "v": read()}, nil
		})
		if err != nil {
			t.Error(err)
		}
	}()
	wg.Wait()

	if len(log.rows[7]) != 2 {
		t.Fatalf("строк = %d, want 2", len(log.rows[7]))
	}
	prev := 0.0
	for _, r := range log.rows[7] {
		var b map[string]any
		_ = json.Unmarshal(r.payload, &b)
		v, _ := b["v"].(float64)
		if v < prev {
			t.Fatalf("pts %d несёт состояние %v старее предыдущего %v", r.pts, v, prev)
		}
		prev = v
	}
	if prev != 2 {
		t.Fatalf("последняя строка несёт %v, want 2", prev)
	}
	// Кадры уходят с курсорами строк.
	for i, f := range pub.frames[7] {
		env := decode(t, f)
		if env.Pts == nil || *env.Pts == 0 {
			t.Fatalf("кадр %d без pts: %+v", i, env)
		}
	}
}

// Ошибка build (например, строки больше нет) откатывает запись: ни строки, ни кадра.
func TestEmitSnapshot_BuildErrorWritesNothing(t *testing.T) {
	log, pub := newFakeLog(), newFakePub()
	e := New(log, pub, fakeTx{})
	wantErr := context.DeadlineExceeded
	err := e.EmitSnapshot(context.Background(), 7, "x", func(context.Context) (map[string]any, error) {
		return nil, wantErr
	})
	if err != wantErr {
		t.Fatalf("err = %v", err)
	}
	if len(log.rows[7]) != 0 || len(pub.frames[7]) != 0 {
		t.Fatal("после ошибки build что-то записано или отправлено")
	}
}

// Без TxManager EmitSnapshot — Emit одному получателю: build → AppendUpdate без замка.
func TestEmitSnapshot_WithoutTxDegradesToEmit(t *testing.T) {
	log, pub := newFakeLog(), newFakePub()
	e := New(log, pub, nil)
	err := e.EmitSnapshot(context.Background(), 7, "notify_settings", func(context.Context) (map[string]any, error) {
		return map[string]any{"_": domain.UpdateNotifySettingsTag}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(log.rows[7]) != 1 || len(pub.frames[7]) != 1 {
		t.Fatalf("строк %d, кадров %d", len(log.rows[7]), len(pub.frames[7]))
	}
}
