package http

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestSessions_ListAndLogout(t *testing.T) {
	h, pool := newMessagingRouter(t)
	token, _ := signUp(t, h, pool, "+79990000010")

	// List shows one current session.
	rec := authedReq(t, h, http.MethodGet, "/sessions", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
	}
	// account.authorizations: адрес сессии зовётся `hash`, а «текущая» это
	// ФЛАГ — его отсутствие и есть «не текущая».
	var listed sessionList
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if len(listed.Authorizations) != 1 || !listed.Authorizations[0].PFlags["current"] {
		t.Fatalf("sessions = %+v", listed.Authorizations)
	}

	// Logout, then the token is rejected.
	rec = authedReq(t, h, http.MethodPost, "/auth/logout", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("logout: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/me", token, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 after logout, got %d", rec.Code)
	}
}

func TestSessions_RevokeOther(t *testing.T) {
	h, pool := newMessagingRouter(t)
	// Same phone signs in twice → two devices/sessions.
	tokenA, _ := signUp(t, h, pool, "+79990000011")
	tokenB, _ := signUp(t, h, pool, "+79990000011")

	rec := authedReq(t, h, http.MethodGet, "/sessions", tokenA, nil)
	// account.authorizations: адрес сессии зовётся `hash`, а «текущая» это
	// ФЛАГ — его отсутствие и есть «не текущая».
	var listed sessionList
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if len(listed.Authorizations) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(listed.Authorizations))
	}
	// Find the non-current (session B) and revoke it from A.
	var other int64
	for _, s := range listed.Authorizations {
		if !s.PFlags["current"] {
			other = s.Hash
		}
	}
	rec = authedReq(t, h, http.MethodDelete, "/sessions/"+itoa(other), tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("revoke: %d %s", rec.Code, rec.Body.String())
	}
	// Token B no longer works.
	rec = authedReq(t, h, http.MethodGet, "/me", tokenB, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected B revoked (401), got %d", rec.Code)
	}
}

func TestSessions_RevokeOthers(t *testing.T) {
	h, pool := newMessagingRouter(t)
	// Three sessions of the same account.
	tokenA, _ := signUp(t, h, pool, "+79990000012")
	tokenB, _ := signUp(t, h, pool, "+79990000012")
	tokenC, _ := signUp(t, h, pool, "+79990000012")

	// A terminates all other sessions.
	rec := authedReq(t, h, http.MethodDelete, "/sessions/others", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("revoke others: %d %s", rec.Code, rec.Body.String())
	}
	var res struct {
		Revoked int `json:"revoked"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Revoked != 2 {
		t.Fatalf("revoked = %d, want 2", res.Revoked)
	}
	// B and C are dead, A still works and is the only session left.
	for _, tok := range []string{tokenB, tokenC} {
		if rec := authedReq(t, h, http.MethodGet, "/me", tok, nil); rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected revoked (401), got %d", rec.Code)
		}
	}
	rec = authedReq(t, h, http.MethodGet, "/sessions", tokenA, nil)
	var listed sessionList
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if len(listed.Authorizations) != 1 || !listed.Authorizations[0].PFlags["current"] {
		t.Fatalf("sessions after revoke-others = %+v", listed.Authorizations)
	}
}

// sessionList — ответ `GET /sessions`: контейнер account.authorizations, где
// каждая сессия это конструктор `authorization`.
type sessionList struct {
	Authorizations []struct {
		Hash   int64           `json:"hash"`
		PFlags map[string]bool `json:"pFlags"`
	} `json:"authorizations"`
}
