package iv

import (
	"net"
	"testing"
)

func TestParseTargetURL(t *testing.T) {
	for _, raw := range []string{"https://example.com/a", "http://example.com", " https://ex.com/x?y=1 "} {
		if _, err := ParseTargetURL(raw); err != nil {
			t.Errorf("ParseTargetURL(%q): unexpected error %v", raw, err)
		}
	}
	for _, raw := range []string{"", "not a url", "ftp://example.com", "javascript:alert(1)", "file:///etc/passwd", "//example.com", "https://"} {
		if _, err := ParseTargetURL(raw); err != ErrBadURL {
			t.Errorf("ParseTargetURL(%q): got %v, want ErrBadURL", raw, err)
		}
	}
}

func TestAllowedIP(t *testing.T) {
	reject := []string{
		"127.0.0.1",    // loopback
		"127.8.8.8",    // весь 127/8
		"10.1.2.3",     // private
		"172.16.0.1",   // private
		"192.168.1.10", // private
		"169.254.1.1",  // link-local (metadata endpoint)
		"0.0.0.0",      // unspecified
		"::1",          // IPv6 loopback
		"fe80::1",      // IPv6 link-local
		"fc00::1",      // IPv6 unique-local
		"::",           // IPv6 unspecified
		"224.0.0.1",    // multicast
	}
	for _, s := range reject {
		if AllowedIP(net.ParseIP(s)) {
			t.Errorf("AllowedIP(%s) = true, want false", s)
		}
	}
	allow := []string{"93.184.216.34", "1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"}
	for _, s := range allow {
		if !AllowedIP(net.ParseIP(s)) {
			t.Errorf("AllowedIP(%s) = false, want true", s)
		}
	}
	if AllowedIP(nil) {
		t.Error("AllowedIP(nil) = true, want false")
	}
}

func TestCheckResolved(t *testing.T) {
	pub := net.ParseIP("93.184.216.34")
	if err := CheckResolved("example.com", []net.IP{pub}); err != nil {
		t.Errorf("public ip: unexpected error %v", err)
	}
	// localhost резолвится в loopback — отказ.
	if err := CheckResolved("localhost", []net.IP{net.ParseIP("127.0.0.1")}); err == nil {
		t.Error("localhost/127.0.0.1: want error")
	}
	if err := CheckResolved("evil.example", []net.IP{net.ParseIP("::1")}); err == nil {
		t.Error("[::1]: want error")
	}
	// Смесь публичного и приватного — отказ (проверяется КАЖДЫЙ адрес).
	if err := CheckResolved("mixed.example", []net.IP{pub, net.ParseIP("10.0.0.5")}); err == nil {
		t.Error("mixed public+private: want error")
	}
	if err := CheckResolved("empty.example", nil); err == nil {
		t.Error("no addresses: want error")
	}
}
