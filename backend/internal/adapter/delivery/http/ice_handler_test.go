package http

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

type iceResponse struct {
	IceServers []struct {
		URLs       []string `json:"urls"`
		Username   string   `json:"username"`
		Credential string   `json:"credential"`
	} `json:"ice_servers"`
	TTL int `json:"ttl"`
}

func TestICEHandler_TurnCredentials(t *testing.T) {
	rec := httptest.NewRecorder()
	NewICEHandler("turn.example.com", "sec").Get(rec, httptest.NewRequest("GET", "/calls/ice", nil))

	var res iceResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if len(res.IceServers) != 2 {
		t.Fatalf("servers = %d, want 2 (stun + turn)", len(res.IceServers))
	}
	turn := res.IceServers[1]
	if len(turn.URLs) != 3 || turn.URLs[1] != "turn:turn.example.com:3478?transport=udp" {
		t.Fatalf("turn urls = %v", turn.URLs)
	}
	// username — unix-expiry в будущем
	exp, err := strconv.ParseInt(turn.Username, 10, 64)
	if err != nil || time.Unix(exp, 0).Before(time.Now()) {
		t.Fatalf("username %q is not a future expiry", turn.Username)
	}
	// credential = base64(HMAC-SHA1(secret, username)) — схема coturn use-auth-secret
	mac := hmac.New(sha1.New, []byte("sec"))
	mac.Write([]byte(turn.Username))
	if want := base64.StdEncoding.EncodeToString(mac.Sum(nil)); turn.Credential != want {
		t.Fatalf("credential = %q, want %q", turn.Credential, want)
	}
}

func TestICEHandler_StunOnlyWithoutTurnHost(t *testing.T) {
	rec := httptest.NewRecorder()
	NewICEHandler("", "sec").Get(rec, httptest.NewRequest("GET", "/calls/ice", nil))
	var res iceResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if len(res.IceServers) != 1 || res.IceServers[0].Username != "" {
		t.Fatalf("expected stun only, got %+v", res.IceServers)
	}
}
