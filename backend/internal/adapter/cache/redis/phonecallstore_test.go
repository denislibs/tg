package redis

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"

	"github.com/messenger-denis/backend/internal/domain"
)

func newTestPhoneCallStore(t *testing.T) (*PhoneCallStore, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	return NewPhoneCallStore(goredis.NewClient(&goredis.Options{Addr: mr.Addr()})), mr
}

func TestPhoneCallStore_Lifecycle(t *testing.T) {
	s, mr := newTestPhoneCallStore(t)
	ctx := context.Background()
	call := domain.PhoneCall{ID: "c1", CallerID: 1, CalleeID: 2, Video: true}

	if ok, err := s.Create(ctx, call); err != nil || !ok {
		t.Fatalf("Create: ok=%v err=%v", ok, err)
	}
	// Повтор call_request состояние не перезаписывает.
	if ok, err := s.Create(ctx, domain.PhoneCall{ID: "c1", CallerID: 9, CalleeID: 8}); err != nil || ok {
		t.Fatalf("повторный Create: ok=%v err=%v, want false", ok, err)
	}
	if ttl := mr.TTL(phoneCallKey("c1")); ttl != phoneCallTTL {
		t.Fatalf("TTL звонка = %v, want %v", ttl, phoneCallTTL)
	}
	got, err := s.Get(ctx, "c1")
	if err != nil || got != call {
		t.Fatalf("Get: %+v err=%v, want %+v", got, err, call)
	}
	if got.Answered() {
		t.Fatal("звонок без ответа помечен отвеченным")
	}

	at := time.UnixMilli(1_700_000_000_123)
	if err := s.Accept(ctx, "c1", at); err != nil {
		t.Fatalf("Accept: %v", err)
	}
	// Повторный ответ (второй девайс) время не сдвигает.
	if err := s.Accept(ctx, "c1", at.Add(time.Minute)); err != nil {
		t.Fatalf("Accept 2: %v", err)
	}
	got, err = s.Get(ctx, "c1")
	if err != nil || !got.AcceptedAt.Equal(at) {
		t.Fatalf("после ответа: %+v err=%v, want AcceptedAt=%v", got, err, at)
	}

	fin, err := s.Finish(ctx, "c1")
	if err != nil || fin.CallerID != 1 || fin.CalleeID != 2 || !fin.Video || !fin.AcceptedAt.Equal(at) {
		t.Fatalf("Finish: %+v err=%v", fin, err)
	}
	if _, err := s.Finish(ctx, "c1"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("второй Finish: %v, want ErrNotFound", err)
	}
	if _, err := s.Get(ctx, "c1"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("Get после Finish: %v, want ErrNotFound", err)
	}
	if mr.Exists(phoneCallAcceptedKey("c1")) {
		t.Fatal("отметка ответа пережила конец звонка")
	}
}

// Обе стороны шлют call_end почти одновременно: звонок достаётся ровно одной.
func TestPhoneCallStore_FinishOnce(t *testing.T) {
	s, _ := newTestPhoneCallStore(t)
	ctx := context.Background()
	if _, err := s.Create(ctx, domain.PhoneCall{ID: "c2", CallerID: 1, CalleeID: 2}); err != nil {
		t.Fatal(err)
	}
	var (
		wg   sync.WaitGroup
		mu   sync.Mutex
		wins int
	)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Finish(ctx, "c2"); err == nil {
				mu.Lock()
				wins++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("звонок забрали %d раз, want 1", wins)
	}
}
