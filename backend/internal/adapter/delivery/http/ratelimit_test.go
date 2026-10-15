package http

import (
	"strconv"
	"testing"
	"time"
)

func TestKeyRateLimiter_Burst(t *testing.T) {
	l := newKeyRateLimiter()
	// rps=0 → без пополнения: ровно burst проходов, дальше отказ.
	for n := 1; n <= 3; n++ {
		if !l.allow("k", 0, 3) {
			t.Fatalf("call %d: allow=false, want true (в пределах burst)", n)
		}
	}
	if l.allow("k", 0, 3) {
		t.Fatal("call 4: allow=true, want false (burst исчерпан)")
	}
	// Другой ключ — независимое ведро.
	if !l.allow("other", 0, 3) {
		t.Fatal("другой ключ должен иметь своё ведро")
	}
}

func TestAllowWait(t *testing.T) {
	l := newKeyRateLimiter()
	for i := 0; i < 2; i++ {
		if ok, _ := l.allowWait("k", 0.5, 2); !ok {
			t.Fatalf("burst %d", i)
		}
	}
	ok, wait := l.allowWait("k", 0.5, 2)
	if ok || wait != 2 {
		t.Fatalf("ok=%v wait=%d; want false, 2", ok, wait)
	}
	// Ожидание не меньше секунды, даже когда ведро почти полное.
	l2 := newKeyRateLimiter()
	l2.allowWait("fast", 100, 1)
	if ok, wait := l2.allowWait("fast", 100, 1); ok && wait != 0 || !ok && wait < 1 {
		t.Fatalf("ok=%v wait=%d; ожидание ≥ 1", ok, wait)
	}
}

// Свой срок простоя: бакеты, не тронутые дольше него, убирает sweep.
func TestKeyRateLimiter_IdleSweep(t *testing.T) {
	l := newKeyRateLimiterIdle(time.Minute)
	for i := 0; i < limiterMaxBuckets; i++ {
		l.allow("k"+strconv.Itoa(i), 1, 1)
	}
	for _, b := range l.buckets {
		b.last = time.Now().Add(-2 * time.Minute)
	}
	l.allow("fresh", 1, 1) // новый ключ при полной карте запускает sweep
	if n := len(l.buckets); n != 1 {
		t.Fatalf("после sweep бакетов %d, want 1", n)
	}
}
