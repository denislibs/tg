package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// BeginLogin отвечает конструктором `auth.passkeyLoginOptions` (tweb
// passkeyLoginButton.tsx:38-41, :49-51): options — dataJSON со строкой JSON
// `{"publicKey":{…}}`, session — одноразовый ключ церемонии. Раньше ответом
// была безымянная карта {session, options: <объект>}.
func TestPasskeyBeginLogin_ReturnsPasskeyLoginOptions(t *testing.T) {
	h, err := NewPasskeyHandler("localhost", []string{"http://localhost"}, nil, nil)
	if err != nil {
		t.Fatalf("NewPasskeyHandler: %v", err)
	}
	rec := httptest.NewRecorder()
	h.BeginLogin(rec, httptest.NewRequest(http.MethodPost, "/auth/passkey/begin", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body)
	}

	var got struct {
		Underscore string `json:"_"`
		Session    string `json:"session"`
		Options    struct {
			Underscore string `json:"_"`
			Data       string `json:"data"`
		} `json:"options"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("ответ не JSON: %v", err)
	}
	if got.Underscore != "auth.passkeyLoginOptions" || got.Options.Underscore != "dataJSON" {
		t.Fatalf("конструкторы = %q / %q", got.Underscore, got.Options.Underscore)
	}
	var data struct {
		PublicKey struct {
			Challenge string `json:"challenge"`
		} `json:"publicKey"`
	}
	if err := json.Unmarshal([]byte(got.Options.Data), &data); err != nil {
		t.Fatalf("options.data не JSON: %v", err)
	}
	if data.PublicKey.Challenge == "" {
		t.Fatalf("в options.data нет publicKey.challenge: %s", got.Options.Data)
	}
	if got.Session == "" || h.takeSession(got.Session) == nil {
		t.Fatal("session пуст или не найден в хранилище церемоний")
	}
}
