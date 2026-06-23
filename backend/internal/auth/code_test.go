package auth

import "testing"

func TestNormalizePhone(t *testing.T) {
	cases := map[string]string{
		"+7 (999) 123-45-67": "+79991234567",
		"89991234567":        "89991234567",
		"  +1 555 000 ":      "+1555000",
	}
	for in, want := range cases {
		if got := NormalizePhone(in); got != want {
			t.Errorf("NormalizePhone(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCodeMatches(t *testing.T) {
	if !CodeMatches("12345", "12345") {
		t.Error("expected exact match to pass")
	}
	if CodeMatches("12345", "00000") {
		t.Error("expected mismatch to fail")
	}
}
