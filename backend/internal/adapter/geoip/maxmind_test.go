package geoip

import "testing"

// Uses MaxMind's MIT-licensed test database (testdata/geoip/GeoIP2-City-Test.mmdb),
// which carries documented fixture records (e.g. 81.2.69.142 → London, GB).
const testDB = "../../../testdata/geoip/GeoIP2-City-Test.mmdb"

func TestResolver_Locate(t *testing.T) {
	r, err := Open(testDB)
	if err != nil {
		t.Skipf("test mmdb unavailable (%v) — geoip integration still builds", err)
	}
	defer r.Close()

	// A known public fixture IP resolves to a non-empty place.
	if got := r.Locate("81.2.69.142"); got == "" {
		t.Fatalf("Locate(81.2.69.142) = empty, want a place")
	} else {
		t.Logf("81.2.69.142 → %q", got)
	}

	// Private / loopback / garbage resolve to "".
	for _, ip := range []string{"192.168.1.5", "10.0.0.1", "127.0.0.1", "not-an-ip", ""} {
		if got := r.Locate(ip); got != "" {
			t.Errorf("Locate(%q) = %q, want empty", ip, got)
		}
	}
}

func TestResolver_Country(t *testing.T) {
	r, err := Open(testDB)
	if err != nil {
		t.Skipf("test mmdb unavailable (%v) — geoip integration still builds", err)
	}
	defer r.Close()

	// Документированная фикстура MaxMind: 81.2.69.142 → London, GB.
	// Код всегда ISO 3166-1 alpha-2 в ВЕРХНЕМ регистре — контракт ручки
	// /auth/nearest_country.
	if got := r.Country("81.2.69.142"); got != "GB" {
		t.Fatalf("Country(81.2.69.142) = %q, want GB", got)
	}

	// Приватные / петлевые / мусорные адреса — пусто, а не ошибка: экран входа
	// просто не преднастраивает страну.
	for _, ip := range []string{"192.168.1.5", "10.0.0.1", "127.0.0.1", "not-an-ip", ""} {
		if got := r.Country(ip); got != "" {
			t.Errorf("Country(%q) = %q, want empty", ip, got)
		}
	}
}

func TestResolver_NilSafe(t *testing.T) {
	var r *Resolver
	if got := r.Locate("81.2.69.142"); got != "" {
		t.Errorf("nil resolver Locate = %q, want empty", got)
	}
	// Базы GeoIP нет вовсе (GEOIP_DB_PATH не задан) — ручка отвечает пустой
	// строкой, а не падает.
	if got := r.Country("81.2.69.142"); got != "" {
		t.Errorf("nil resolver Country = %q, want empty", got)
	}
	if err := r.Close(); err != nil {
		t.Errorf("nil Close = %v", err)
	}
}
