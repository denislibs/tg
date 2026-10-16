package netx

import (
	"net/http/httptest"
	"testing"
)

func TestClientIP(t *testing.T) {
	// X-Real-IP (nginx = $remote_addr, перезаписывает присланное) — приоритетнее,
	// и левый спуф в X-Forwarded-For игнорируется.
	r := httptest.NewRequest("POST", "/", nil)
	r.RemoteAddr = "10.0.0.1:5555" // адрес nginx
	r.Header.Set("X-Real-IP", "203.0.113.7")
	r.Header.Set("X-Forwarded-For", "9.9.9.9, 203.0.113.7") // 9.9.9.9 — спуф клиента
	if got := ClientIP(r); got != "203.0.113.7" {
		t.Fatalf("ClientIP с X-Real-IP = %q, want 203.0.113.7", got)
	}

	// Без X-Real-IP — правая (добавленная nginx) запись XFF, не левая-спуф.
	r2 := httptest.NewRequest("POST", "/", nil)
	r2.RemoteAddr = "10.0.0.1:5555"
	r2.Header.Set("X-Forwarded-For", "9.9.9.9, 203.0.113.7")
	if got := ClientIP(r2); got != "203.0.113.7" {
		t.Fatalf("ClientIP XFF-rightmost = %q, want 203.0.113.7", got)
	}

	// Мусор в X-Real-IP игнорируется, падаем на XFF.
	r3 := httptest.NewRequest("POST", "/", nil)
	r3.RemoteAddr = "10.0.0.1:5555"
	r3.Header.Set("X-Real-IP", "not-an-ip")
	r3.Header.Set("X-Forwarded-For", "203.0.113.9")
	if got := ClientIP(r3); got != "203.0.113.9" {
		t.Fatalf("ClientIP мусорный X-Real-IP = %q, want 203.0.113.9", got)
	}

	// Без прокси-заголовков — host из RemoteAddr.
	r4 := httptest.NewRequest("POST", "/", nil)
	r4.RemoteAddr = "198.51.100.4:4444"
	if got := ClientIP(r4); got != "198.51.100.4" {
		t.Fatalf("ClientIP RemoteAddr = %q, want 198.51.100.4", got)
	}
}
