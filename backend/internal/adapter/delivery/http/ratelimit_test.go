package http

import (
	"net/http/httptest"
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

func TestClientIP(t *testing.T) {
	// X-Real-IP (nginx = $remote_addr, перезаписывает присланное) — приоритетнее,
	// и левый спуф в X-Forwarded-For игнорируется.
	r := httptest.NewRequest("POST", "/", nil)
	r.RemoteAddr = "10.0.0.1:5555" // адрес nginx
	r.Header.Set("X-Real-IP", "203.0.113.7")
	r.Header.Set("X-Forwarded-For", "9.9.9.9, 203.0.113.7") // 9.9.9.9 — спуф клиента
	if got := clientIP(r); got != "203.0.113.7" {
		t.Fatalf("clientIP с X-Real-IP = %q, want 203.0.113.7", got)
	}

	// Без X-Real-IP — правая (добавленная nginx) запись XFF, не левая-спуф.
	r2 := httptest.NewRequest("POST", "/", nil)
	r2.RemoteAddr = "10.0.0.1:5555"
	r2.Header.Set("X-Forwarded-For", "9.9.9.9, 203.0.113.7")
	if got := clientIP(r2); got != "203.0.113.7" {
		t.Fatalf("clientIP XFF-rightmost = %q, want 203.0.113.7", got)
	}

	// Мусор в X-Real-IP игнорируется, падаем на XFF.
	r3 := httptest.NewRequest("POST", "/", nil)
	r3.RemoteAddr = "10.0.0.1:5555"
	r3.Header.Set("X-Real-IP", "not-an-ip")
	r3.Header.Set("X-Forwarded-For", "203.0.113.9")
	if got := clientIP(r3); got != "203.0.113.9" {
		t.Fatalf("clientIP мусорный X-Real-IP = %q, want 203.0.113.9", got)
	}

	// Без прокси-заголовков — host из RemoteAddr.
	r4 := httptest.NewRequest("POST", "/", nil)
	r4.RemoteAddr = "198.51.100.4:4444"
	if got := clientIP(r4); got != "198.51.100.4" {
		t.Fatalf("clientIP RemoteAddr = %q, want 198.51.100.4", got)
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
