package http

import (
	"encoding/json"
	"net/http"
	"testing"

	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestPush_SubscribeAndVAPID_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	pushH := NewPushHandler(pgadapter.NewPushRepo(pool), "TEST_PUBLIC_KEY")
	h := NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, pushH)

	token, _ := signUp(t, h, pool, "+79990000050")

	rec := authedReq(t, h, http.MethodGet, "/push/vapid_public_key", token, nil)
	var key struct {
		PublicKey string `json:"public_key"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &key)
	if key.PublicKey != "TEST_PUBLIC_KEY" {
		t.Fatalf("vapid key = %q", key.PublicKey)
	}

	rec = authedReq(t, h, http.MethodPost, "/push/subscribe", token, map[string]string{
		"endpoint": "https://push/x", "p256dh": "p", "auth": "a",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("subscribe: %d %s", rec.Code, rec.Body.String())
	}
}
