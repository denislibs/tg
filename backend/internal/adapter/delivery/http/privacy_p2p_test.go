package http

import (
	"encoding/json"
	"net/http"
	"testing"

	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecaseprivacy "github.com/messenger-denis/backend/internal/usecase/privacy"
)

// Ключ privacyKeyPhoneP2P адресуется конструктором схемы (tweb
// privacy/calls.tsx:19-27): GET отдаёт правило по умолчанию («все»), PUT
// «никто» сохраняется и читается обратно.
func TestPrivacyPhoneP2P_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	privacyUC := usecaseprivacy.New(pgadapter.NewPrivacyRepo(pool))
	h := NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, privacyUC, nil, nil, nil, nil, nil, nil, nil, false)
	token, _ := signInToken(t, h, "+79990000031")

	first := func(path string) string {
		t.Helper()
		rec := reqJSONAuth(t, h, http.MethodGet, path, nil, token)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s: %d %s", path, rec.Code, rec.Body.String())
		}
		var res struct {
			Underscore string           `json:"_"`
			Rules      []map[string]any `json:"rules"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
			t.Fatal(err)
		}
		if res.Underscore != "account.privacyRules" || len(res.Rules) == 0 {
			t.Fatalf("ответ %s = %s", path, rec.Body.String())
		}
		tag, _ := res.Rules[len(res.Rules)-1]["_"].(string)
		return tag
	}

	const path = "/me/privacy/privacyKeyPhoneP2P"
	if got := first(path); got != "privacyValueAllowAll" {
		t.Fatalf("правило по умолчанию = %q; want privacyValueAllowAll", got)
	}
	if rec := reqJSONAuth(t, h, http.MethodPut, path, map[string]any{
		"rules": []map[string]any{{"_": "privacyValueDisallowAll"}},
	}, token); rec.Code != http.StatusOK {
		t.Fatalf("PUT %s: %d %s", path, rec.Code, rec.Body.String())
	}
	if got := first(path); got != "privacyValueDisallowAll" {
		t.Fatalf("после PUT = %q; want privacyValueDisallowAll", got)
	}
	// Наша строка вместо конструктора по-прежнему не адресует ключ.
	if rec := reqJSONAuth(t, h, http.MethodGet, "/me/privacy/phone_p2p", nil, token); rec.Code != http.StatusNotFound {
		t.Fatalf("GET /me/privacy/phone_p2p: %d; want 404", rec.Code)
	}
}
