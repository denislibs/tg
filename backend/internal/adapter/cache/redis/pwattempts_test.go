package redis

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"
)

func newPwAttemptsTestStore(t *testing.T) (*PasswordAttemptStore, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	return NewPasswordAttemptStore(goredis.NewClient(&goredis.Options{Addr: mr.Addr()})), mr
}

// Lua-формула совпадает с usecase passwordLockFor (В-S2): 4 неудачи — без
// блокировки, 5-я — 60 с, дальше удвоение до потолка 24 ч.
func TestPasswordAttemptStore_FailGrowsLock(t *testing.T) {
	s, mr := newPwAttemptsTestStore(t)
	ctx := context.Background()
	want := map[int]time.Duration{
		1: 0, 4: 0, 5: time.Minute, 6: 2 * time.Minute, 7: 4 * time.Minute,
		15: 1024 * time.Minute, 16: 24 * time.Hour, 17: 24 * time.Hour, 40: 24 * time.Hour,
	}
	for f := 1; f <= 40; f++ {
		got, err := s.Fail(ctx, 7, 3)
		if err != nil || got != f {
			t.Fatalf("Fail #%d = %d, %v", f, got, err)
		}
		lock, ok := want[f]
		if !ok {
			continue
		}
		left, err := s.Locked(ctx, 7, 3)
		if err != nil || left != lock {
			t.Fatalf("после %d неудач Locked = %v, %v; want %v", f, left, err, lock)
		}
	}
	// Счётчик живёт 24 ч от последней неудачи.
	if ttl := mr.TTL("pwfail:7:3"); ttl != 24*time.Hour {
		t.Fatalf("TTL счётчика = %v, want 24h", ttl)
	}
	// Чужая пара не заперта.
	if left, _ := s.Locked(ctx, 7, 4); left != 0 {
		t.Fatalf("сессия 4 заперта: %v", left)
	}
}

func TestPasswordAttemptStore_LockExpiresAndReset(t *testing.T) {
	s, mr := newPwAttemptsTestStore(t)
	ctx := context.Background()
	for n := 0; n < 5; n++ {
		if _, err := s.Fail(ctx, 7, 3); err != nil {
			t.Fatal(err)
		}
	}
	mr.FastForward(61 * time.Second)
	if left, _ := s.Locked(ctx, 7, 3); left != 0 {
		t.Fatalf("блокировка не истекла: %v", left)
	}
	// Счётчик пережил блокировку: следующая неудача — 6-я, 120 с.
	if f, _ := s.Fail(ctx, 7, 3); f != 6 {
		t.Fatalf("неудача после блокировки = %d, want 6", f)
	}
	if left, _ := s.Locked(ctx, 7, 3); left != 2*time.Minute {
		t.Fatalf("6-я блокировка = %v", left)
	}
	if err := s.Reset(ctx, 7, 3); err != nil {
		t.Fatal(err)
	}
	if left, _ := s.Locked(ctx, 7, 3); left != 0 {
		t.Fatalf("Reset не снял блокировку: %v", left)
	}
	if mr.Exists("pwfail:7:3") || mr.Exists("pwlock:7:3") {
		t.Fatal("Reset оставил ключи")
	}
	if f, _ := s.Fail(ctx, 7, 3); f != 1 {
		t.Fatalf("после Reset счёт с %d, want 1", f)
	}
}
