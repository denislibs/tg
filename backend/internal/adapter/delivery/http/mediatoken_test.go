package http

import (
	"testing"
	"time"
)

func TestMediaToken_RoundTrip(t *testing.T) {
	secret := []byte("s3cr3t")
	now := time.Unix(1_700_000_000, 0)
	tok := signMediaToken(secret, 42, now)

	uid, ok := parseMediaToken(secret, tok, now.Add(time.Minute))
	if !ok || uid != 42 {
		t.Fatalf("round trip failed: uid=%d ok=%v", uid, ok)
	}
}

func TestMediaToken_Rejects(t *testing.T) {
	secret := []byte("s3cr3t")
	now := time.Unix(1_700_000_000, 0)
	tok := signMediaToken(secret, 42, now)

	if _, ok := parseMediaToken(secret, tok, now.Add(mediaTokenTTL+time.Second)); ok {
		t.Fatal("expired token should be rejected")
	}
	if _, ok := parseMediaToken([]byte("other"), tok, now); ok {
		t.Fatal("wrong secret should be rejected")
	}
	if _, ok := parseMediaToken(secret, tok+"x", now); ok {
		t.Fatal("tampered token should be rejected")
	}
	if _, ok := parseMediaToken(secret, "garbage", now); ok {
		t.Fatal("malformed token should be rejected")
	}
}
