package redis

import (
	"context"
	"strconv"
	"sync"
	"sync/atomic"
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

const (
	pwFail = "pwfail:7:3:v1"
	pwLock = "pwlock:7:3:v1"
)

// acquireFree — попытка разрешена (пара не заперта), иначе тест падает.
func acquireFree(t *testing.T, s *PasswordAttemptStore, what string) {
	t.Helper()
	left, err := s.Acquire(context.Background(), 7, 3, "v1")
	if err != nil || left != 0 {
		t.Fatalf("%s: Acquire = %v, %v; want 0", what, left, err)
	}
}

// Формула В-S2 из констант usecase: 4 попытки — без блокировки, 5-я — 60 с,
// дальше удвоение до потолка 24 ч; в блокировке попытка не засчитывается.
func TestPasswordAttemptStore_GrowingLock(t *testing.T) {
	s, mr := newPwAttemptsTestStore(t)
	ctx := context.Background()
	want := map[int]time.Duration{
		1: 0, 4: 0, 5: time.Minute, 6: 2 * time.Minute, 7: 4 * time.Minute,
		15: 1024 * time.Minute, 16: 24 * time.Hour, 17: 24 * time.Hour, 40: 24 * time.Hour,
	}
	for f := 1; f <= 40; f++ {
		acquireFree(t, s, "попытка")
		lock := mr.TTL(pwLock)
		if w, ok := want[f]; ok && lock != w {
			t.Fatalf("после %d попыток блокировка %v, want %v", f, lock, w)
		}
		// Счётчик живёт сутки после последней попытки или после конца блокировки.
		if ttl := mr.TTL(pwFail); ttl != lock+24*time.Hour {
			t.Fatalf("после %d попыток срок счётчика %v, want %v", f, ttl, lock+24*time.Hour)
		}
		if lock > 0 {
			// В блокировке — её остаток, попытка не засчитана.
			left, err := s.Acquire(ctx, 7, 3, "v1")
			if err != nil || left != lock {
				t.Fatalf("в блокировке Acquire = %v, %v; want %v", left, err, lock)
			}
			if got, _ := mr.Get(pwFail); got != strconv.Itoa(f) {
				t.Fatalf("в блокировке счётчик %s, want %d", got, f)
			}
			mr.FastForward(lock)
		}
	}
	// Другая сессия и другая версия пароля не заперты.
	if left, _ := s.Acquire(ctx, 7, 4, "v1"); left != 0 {
		t.Fatalf("сессия 4 заперта: %v", left)
	}
	if left, _ := s.Acquire(ctx, 7, 3, "v2"); left != 0 {
		t.Fatalf("новая версия пароля заперта: %v", left)
	}
}

// На потолке счётчик переживает блокировку: следующая попытка — снова сутки, а
// не счёт с единицы.
func TestPasswordAttemptStore_CeilingSurvivesLock(t *testing.T) {
	s, mr := newPwAttemptsTestStore(t)
	for f := 1; f <= 16; f++ {
		acquireFree(t, s, "разгон")
		mr.FastForward(mr.TTL(pwLock))
	}
	acquireFree(t, s, "17-я после конца суточной блокировки")
	if got, _ := mr.Get(pwFail); got != "17" {
		t.Fatalf("счётчик %s, want 17", got)
	}
	if lock := mr.TTL(pwLock); lock != 24*time.Hour {
		t.Fatalf("17-я блокировка %v, want 24h", lock)
	}
}

func TestPasswordAttemptStore_Reset(t *testing.T) {
	s, mr := newPwAttemptsTestStore(t)
	for n := 0; n < 5; n++ {
		acquireFree(t, s, "попытка")
	}
	if err := s.Reset(context.Background(), 7, 3, "v1"); err != nil {
		t.Fatal(err)
	}
	if mr.Exists(pwFail) || mr.Exists(pwLock) {
		t.Fatal("Reset оставил ключи")
	}
	acquireFree(t, s, "после Reset")
	if got, _ := mr.Get(pwFail); got != "1" {
		t.Fatalf("после Reset счёт с %s, want 1", got)
	}
}

// Проверка и счёт атомарны: после 4 попыток из 50 параллельных к сверке
// пропускается ровно одна (она и ставит блокировку).
func TestPasswordAttemptStore_ConcurrentAcquire(t *testing.T) {
	s, _ := newPwAttemptsTestStore(t)
	for n := 0; n < 4; n++ {
		acquireFree(t, s, "разгон")
	}
	var free atomic.Int32
	var wg sync.WaitGroup
	for n := 0; n < 50; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			left, err := s.Acquire(context.Background(), 7, 3, "v1")
			if err == nil && left == 0 {
				free.Add(1)
			}
		}()
	}
	wg.Wait()
	if free.Load() != 1 {
		t.Fatalf("к сверке пропущено %d из 50, want 1", free.Load())
	}
}
