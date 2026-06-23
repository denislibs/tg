package domain

import "testing"

func TestGenerateToken(t *testing.T) {
	tok, hash, err := GenerateToken()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(tok) < 20 {
		t.Errorf("token too short: %q", tok)
	}
	if hash != HashToken(tok) {
		t.Error("returned hash does not match HashToken(token)")
	}
}

func TestHashTokenStable(t *testing.T) {
	if HashToken("abc") != HashToken("abc") {
		t.Error("HashToken must be deterministic")
	}
	if HashToken("abc") == HashToken("abd") {
		t.Error("different tokens must hash differently")
	}
}
