package push

import (
	"context"
	"errors"
	"strconv"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// --- fakes ---

type fakeQueue struct {
	jobs    []QueuedJob
	acked   []string
	nextID  int
	enqErr  error
	consErr error
	ackErr  error
	batches int // вызовов EnqueueMany
}

func (q *fakeQueue) EnqueueMany(ctx context.Context, jobs []Job) error {
	q.batches++
	for _, j := range jobs {
		if err := q.Enqueue(ctx, j); err != nil {
			return err
		}
	}
	return nil
}

func (q *fakeQueue) Enqueue(_ context.Context, j Job) error {
	if q.enqErr != nil {
		return q.enqErr
	}
	q.nextID++
	q.jobs = append(q.jobs, QueuedJob{ID: strconv.Itoa(q.nextID), Job: j})
	return nil
}

func (q *fakeQueue) Consume(_ context.Context, _ int, _ int) ([]QueuedJob, error) {
	if q.consErr != nil {
		return nil, q.consErr
	}
	out := q.jobs
	q.jobs = nil
	return out, nil
}

func (q *fakeQueue) Ack(_ context.Context, id string) error {
	if q.ackErr != nil {
		return q.ackErr
	}
	q.acked = append(q.acked, id)
	for i, qj := range q.jobs {
		if qj.ID == id {
			q.jobs = append(q.jobs[:i], q.jobs[i+1:]...)
			break
		}
	}
	return nil
}

type fakeOnline struct {
	online map[int64]bool
	err    error
}

func (o *fakeOnline) IsOnline(_ context.Context, userID int64) (bool, error) {
	return o.online[userID], o.err
}

func (o *fakeOnline) OnlineMany(_ context.Context, userIDs []int64) (map[int64]bool, error) {
	out := map[int64]bool{}
	for _, id := range userIDs {
		if o.online[id] {
			out[id] = true
		}
	}
	return out, o.err
}

type fakeNotify struct {
	muted     map[int64]bool
	noPreview map[int64]bool
	err       error
	batches   int // вызовов NotifyTargets
}

func (m *fakeNotify) ShouldNotify(_ context.Context, _, userID, _ int64, _ bool) (bool, bool, error) {
	return !m.muted[userID], !m.noPreview[userID], m.err
}

func (m *fakeNotify) NotifyTargets(_ context.Context, _ int64, userIDs []int64) (map[int64]bool, error) {
	m.batches++
	out := map[int64]bool{}
	for _, id := range userIDs {
		if !m.muted[id] {
			out[id] = !m.noPreview[id]
		}
	}
	return out, m.err
}

type fakeSubs struct {
	byUser  map[int64][]domain.PushSubscription
	forErr  error
	deleted []string
}

func (s *fakeSubs) Add(context.Context, int64, domain.PushSubscription) error { return nil }

func (s *fakeSubs) ForUser(_ context.Context, userID int64) ([]domain.PushSubscription, error) {
	if s.forErr != nil {
		return nil, s.forErr
	}
	return s.byUser[userID], nil
}

func (s *fakeSubs) DeleteByEndpoint(_ context.Context, endpoint string) error {
	s.deleted = append(s.deleted, endpoint)
	return nil
}

type sentCall struct {
	sub     domain.PushSubscription
	payload []byte
}

type fakeSender struct {
	status    int
	statusFor map[string]int // per-endpoint override
	err       error
	sent      []sentCall
}

func (s *fakeSender) Send(_ context.Context, sub domain.PushSubscription, payload []byte) (int, error) {
	s.sent = append(s.sent, sentCall{sub: sub, payload: payload})
	if s.err != nil {
		return 0, s.err
	}
	if st, ok := s.statusFor[sub.Endpoint]; ok {
		return st, nil
	}
	return s.status, nil
}

type fakeEnricher struct {
	names      map[int64]string
	badges     map[int64]int
	badgeCalls int
}

func (e *fakeEnricher) SenderName(_ context.Context, userID int64) (string, error) {
	return e.names[userID], nil
}

func (e *fakeEnricher) UnreadBadge(_ context.Context, userID int64) (int, error) {
	e.badgeCalls++
	return e.badges[userID], nil
}

// --- notifier tests ---

func TestNotifier_EnqueuesWhenOfflineAndUnmuted(t *testing.T) {
	q := &fakeQueue{}
	n := NewNotifier(&fakeOnline{online: map[int64]bool{}}, &fakeNotify{muted: map[int64]bool{}}, q)

	n.NotifyNewMessage(context.Background(), 7, 3, 5, 9, "hi", -3, false, 0)

	if len(q.jobs) != 1 {
		t.Fatalf("expected 1 enqueued job, got %d", len(q.jobs))
	}
	got := q.jobs[0].Job
	// PeerID — ключ пира ГЛАЗАМИ получателя; ChatID внутренний и наружу не едет.
	want := Job{RecipientID: 7, ChatID: 3, PeerID: -3, Seq: 5, SenderID: 9, Text: "hi", Preview: true}
	if got != want {
		t.Fatalf("enqueued job = %+v, want %+v", got, want)
	}
}

func TestNotifier_PreviewOffPropagatesToJob(t *testing.T) {
	q := &fakeQueue{}
	n := NewNotifier(&fakeOnline{online: map[int64]bool{}}, &fakeNotify{noPreview: map[int64]bool{7: true}}, q)

	n.NotifyNewMessage(context.Background(), 7, 3, 5, 9, "hi", -3, false, 0)

	if len(q.jobs) != 1 {
		t.Fatalf("expected 1 enqueued job, got %d", len(q.jobs))
	}
	if q.jobs[0].Job.Preview {
		t.Fatalf("expected Preview=false in job")
	}
}

func TestNotifier_SkipsWhenOnline(t *testing.T) {
	q := &fakeQueue{}
	n := NewNotifier(&fakeOnline{online: map[int64]bool{7: true}}, &fakeNotify{}, q)

	n.NotifyNewMessage(context.Background(), 7, 3, 5, 9, "hi", -3, false, 0)

	if len(q.jobs) != 0 {
		t.Fatalf("expected no enqueue when online, got %d", len(q.jobs))
	}
}

func TestNotifier_SkipsWhenMuted(t *testing.T) {
	q := &fakeQueue{}
	n := NewNotifier(&fakeOnline{online: map[int64]bool{}}, &fakeNotify{muted: map[int64]bool{7: true}}, q)

	n.NotifyNewMessage(context.Background(), 7, 3, 5, 9, "hi", -3, false, 0)

	if len(q.jobs) != 0 {
		t.Fatalf("expected no enqueue when muted, got %d", len(q.jobs))
	}
}

func TestNotifier_SkipsOnMuteCheckError(t *testing.T) {
	q := &fakeQueue{}
	n := NewNotifier(&fakeOnline{online: map[int64]bool{}}, &fakeNotify{err: errors.New("db down")}, q)

	n.NotifyNewMessage(context.Background(), 7, 3, 5, 9, "hi", -3, false, 0)

	if len(q.jobs) != 0 {
		t.Fatalf("expected no enqueue on mute-check error, got %d", len(q.jobs))
	}
}

// A3-06: пуш поста канала — одним батчем на всех подписчиков: онлайн и
// замьюченные отсекаются, решение по мьюту — один запрос, заголовок — название
// канала (автор поста у канала скрыт).
func TestNotifier_ChannelPostBatch(t *testing.T) {
	q := &fakeQueue{}
	notify := &fakeNotify{muted: map[int64]bool{9: true}, noPreview: map[int64]bool{10: true}}
	n := NewNotifier(&fakeOnline{online: map[int64]bool{8: true}}, notify, q)

	n.NotifyChannelPost(context.Background(), 3, []int64{8, 9, 10, 11}, 5, "Новости", "пост", -3)

	if notify.batches != 1 {
		t.Fatalf("решений по мьюту = %d запросов, want 1 на пачку", notify.batches)
	}
	if len(q.jobs) != 2 || q.batches != 1 {
		t.Fatalf("заданий = %d пачек %d, want 2 одной пачкой (10 и 11: 8 онлайн, 9 замьючен)", len(q.jobs), q.batches)
	}
	want := map[int64]Job{
		10: {RecipientID: 10, ChatID: 3, PeerID: -3, Seq: 5, Title: "Новости", Text: "пост", Preview: false},
		11: {RecipientID: 11, ChatID: 3, PeerID: -3, Seq: 5, Title: "Новости", Text: "пост", Preview: true},
	}
	for _, qj := range q.jobs {
		if qj.Job != want[qj.Job.RecipientID] {
			t.Fatalf("задание = %+v, want %+v", qj.Job, want[qj.Job.RecipientID])
		}
	}
}
