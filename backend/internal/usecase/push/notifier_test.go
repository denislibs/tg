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

type fakeMute struct {
	muted map[int64]bool
	err   error
}

func (m *fakeMute) IsMuted(_ context.Context, _, userID int64) (bool, error) {
	return m.muted[userID], m.err
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
	names  map[int64]string
	badges map[int64]int
}

func (e *fakeEnricher) SenderName(_ context.Context, userID int64) (string, error) {
	return e.names[userID], nil
}

func (e *fakeEnricher) UnreadBadge(_ context.Context, userID int64) (int, error) {
	return e.badges[userID], nil
}

// --- notifier tests ---

func TestNotifier_EnqueuesWhenOfflineAndUnmuted(t *testing.T) {
	q := &fakeQueue{}
	n := NewNotifier(&fakeOnline{online: map[int64]bool{}}, &fakeMute{muted: map[int64]bool{}}, q)

	n.NotifyNewMessage(context.Background(), 7, 3, 100, 5, 9, "hi")

	if len(q.jobs) != 1 {
		t.Fatalf("expected 1 enqueued job, got %d", len(q.jobs))
	}
	got := q.jobs[0].Job
	want := Job{RecipientID: 7, ChatID: 3, MsgID: 100, Seq: 5, SenderID: 9, Text: "hi"}
	if got != want {
		t.Fatalf("enqueued job = %+v, want %+v", got, want)
	}
}

func TestNotifier_SkipsWhenOnline(t *testing.T) {
	q := &fakeQueue{}
	n := NewNotifier(&fakeOnline{online: map[int64]bool{7: true}}, &fakeMute{}, q)

	n.NotifyNewMessage(context.Background(), 7, 3, 100, 5, 9, "hi")

	if len(q.jobs) != 0 {
		t.Fatalf("expected no enqueue when online, got %d", len(q.jobs))
	}
}

func TestNotifier_SkipsWhenMuted(t *testing.T) {
	q := &fakeQueue{}
	n := NewNotifier(&fakeOnline{online: map[int64]bool{}}, &fakeMute{muted: map[int64]bool{7: true}}, q)

	n.NotifyNewMessage(context.Background(), 7, 3, 100, 5, 9, "hi")

	if len(q.jobs) != 0 {
		t.Fatalf("expected no enqueue when muted, got %d", len(q.jobs))
	}
}

func TestNotifier_SkipsOnMuteCheckError(t *testing.T) {
	q := &fakeQueue{}
	n := NewNotifier(&fakeOnline{online: map[int64]bool{}}, &fakeMute{err: errors.New("db down")}, q)

	n.NotifyNewMessage(context.Background(), 7, 3, 100, 5, 9, "hi")

	if len(q.jobs) != 0 {
		t.Fatalf("expected no enqueue on mute-check error, got %d", len(q.jobs))
	}
}
