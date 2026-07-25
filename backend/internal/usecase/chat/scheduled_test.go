package chat

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeScheduled — in-memory ScheduledRepo для юнит-тестов.
type fakeScheduled struct {
	mu   sync.Mutex
	next int64
	rows map[int64]domain.ScheduledMessage
}

func newFakeScheduled() *fakeScheduled {
	return &fakeScheduled{rows: map[int64]domain.ScheduledMessage{}}
}

func (f *fakeScheduled) Create(_ context.Context, m domain.ScheduledMessage) (domain.ScheduledMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.next++
	m.ID = f.next
	m.CreatedAt = time.Now()
	f.rows[m.ID] = m
	return m, nil
}

func (f *fakeScheduled) ListByChat(_ context.Context, chatID, senderID int64) ([]domain.ScheduledMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []domain.ScheduledMessage
	for _, m := range f.rows {
		if m.ChatID == chatID && m.SenderID == senderID {
			out = append(out, m)
		}
	}
	return out, nil
}

func (f *fakeScheduled) CountByUser(_ context.Context, senderID int64) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, m := range f.rows {
		if m.SenderID == senderID {
			n++
		}
	}
	return n, nil
}

func (f *fakeScheduled) ByID(_ context.Context, id int64) (domain.ScheduledMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	m, ok := f.rows[id]
	if !ok {
		return domain.ScheduledMessage{}, domain.ErrNotFound
	}
	return m, nil
}

func (f *fakeScheduled) Delete(_ context.Context, id int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.rows, id)
	return nil
}

func (f *fakeScheduled) Due(_ context.Context, now time.Time, limit int) ([]domain.ScheduledMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []domain.ScheduledMessage
	for _, m := range f.rows {
		if !m.WhenOnline && !m.SendAt.After(now) {
			out = append(out, m)
		}
	}
	return out, nil
}

func (f *fakeScheduled) DueWhenOnline(_ context.Context, limit int) ([]domain.ScheduledMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []domain.ScheduledMessage
	for _, m := range f.rows {
		if m.WhenOnline {
			out = append(out, m)
		}
	}
	return out, nil
}

func (f *fakeScheduled) UpdateSendAt(_ context.Context, id int64, sendAt time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	m, ok := f.rows[id]
	if !ok {
		return domain.ErrNotFound
	}
	m.SendAt = sendAt
	m.WhenOnline = false
	f.rows[id] = m
	return nil
}

// fakePresence — управляемый онлайн-статус для тестов диспетчера.
type fakePresence struct{ online map[int64]bool }

func (p fakePresence) IsOnline(_ context.Context, userID int64) (bool, error) {
	return p.online[userID], nil
}

// newScheduledTestInteractor: interactor c fakeChats + fakeScheduled (+presence).
func newScheduledTestInteractor() (*Interactor, *store, *fakeScheduled) {
	s := newStore()
	fs := newFakeScheduled()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, nil, nil, nil, nil, nil)
	in.SetScheduled(fs)
	return in, s, fs
}

func TestScheduleWhenOnline_SavesFlagWithoutFutureTime(t *testing.T) {
	in, s, fs := newScheduledTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)

	// send_at в прошлом, но when_online=true — не должно требовать будущего времени.
	m, err := in.ScheduleMessage(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "когда онлайн"},
		time.Now().Add(-time.Hour), true)
	if err != nil {
		t.Fatalf("schedule when_online: %v", err)
	}
	if !m.WhenOnline {
		t.Fatalf("when_online flag not saved")
	}
	got, _ := fs.ByID(ctx, m.ID)
	if !got.WhenOnline {
		t.Fatalf("stored row missing when_online")
	}
}

func TestScheduleWhenOnline_NonPrivateForbidden(t *testing.T) {
	in, s, _ := newScheduledTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	s.chatType[cid] = "group" // делаем чат групповым

	_, err := in.ScheduleMessage(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "hi"},
		time.Now(), true)
	if err != domain.ErrForbidden {
		t.Fatalf("want ErrForbidden for non-private when_online, got %v", err)
	}
}

func TestDispatchWhenOnline_SendsWhenRecipientOnline(t *testing.T) {
	in, s, fs := newScheduledTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)

	m, err := in.ScheduleMessage(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "привет"}, time.Now(), true)
	if err != nil {
		t.Fatalf("schedule: %v", err)
	}

	// Собеседник (2) оффлайн — не отправляем, запись остаётся.
	in.SetPresence(fakePresence{online: map[int64]bool{}})
	if n, err := in.DispatchDueScheduled(ctx); err != nil || n != 0 {
		t.Fatalf("offline dispatch: n=%d err=%v (want 0, nil)", n, err)
	}
	if _, err := fs.ByID(ctx, m.ID); err != nil {
		t.Fatalf("row should remain while recipient offline")
	}
	if len(s.messages[cid]) != 0 {
		t.Fatalf("no message should be sent while offline")
	}

	// Собеседник онлайн — сообщение уходит, запись удаляется.
	in.SetPresence(fakePresence{online: map[int64]bool{2: true}})
	if n, err := in.DispatchDueScheduled(ctx); err != nil || n != 1 {
		t.Fatalf("online dispatch: n=%d err=%v (want 1, nil)", n, err)
	}
	if _, err := fs.ByID(ctx, m.ID); err != domain.ErrNotFound {
		t.Fatalf("row should be removed after send, got %v", err)
	}
	if len(s.messages[cid]) != 1 || s.messages[cid][0].Text != "привет" {
		t.Fatalf("message not delivered: %+v", s.messages[cid])
	}
}

func TestUpdateScheduled_Reschedule(t *testing.T) {
	in, s, _ := newScheduledTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)

	m, err := in.ScheduleMessage(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "later"},
		time.Now().Add(time.Hour), false)
	if err != nil {
		t.Fatalf("schedule: %v", err)
	}

	// Владелец переносит на новое будущее время.
	newAt := time.Now().Add(3 * time.Hour)
	upd, err := in.UpdateScheduled(ctx, m.ID, 1, newAt)
	if err != nil {
		t.Fatalf("reschedule by owner: %v", err)
	}
	if !upd.SendAt.Equal(newAt) {
		t.Fatalf("send_at not updated: %v want %v", upd.SendAt, newAt)
	}

	// Чужой — forbidden.
	if _, err := in.UpdateScheduled(ctx, m.ID, 99, time.Now().Add(time.Hour)); err != domain.ErrForbidden {
		t.Fatalf("want ErrForbidden for non-owner, got %v", err)
	}

	// Прошлое время — ошибка.
	if _, err := in.UpdateScheduled(ctx, m.ID, 1, time.Now().Add(-time.Hour)); err != domain.ErrTooLong {
		t.Fatalf("want ErrTooLong for past time, got %v", err)
	}
}
