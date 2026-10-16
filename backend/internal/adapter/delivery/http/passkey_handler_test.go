package http

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/messenger-denis/backend/internal/domain"
	usecasepasskeys "github.com/messenger-denis/backend/internal/usecase/passkeys"
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

// begin публичный и без аутентификации: лимит по реальному IP (потолок размера
// карты церемоний и ключ IPv6 по /64 — вне этой задачи, см. «Не закрыто» в PR).
func TestPasskeyBeginLogin_RateLimitedByIP(t *testing.T) {
	h, err := NewPasskeyHandler("localhost", []string{"http://localhost"}, nil, nil)
	if err != nil {
		t.Fatalf("NewPasskeyHandler: %v", err)
	}
	var last int
	var lastBody string
	for n := 0; n < 12; n++ {
		req := httptest.NewRequest(http.MethodPost, "/auth/passkey/begin", nil)
		req.Header.Set("X-Real-IP", "203.0.113.7")
		rec := httptest.NewRecorder()
		h.BeginLogin(rec, req)
		last, lastBody = rec.Code, rec.Body.String()
	}
	if last != 420 || !strings.Contains(lastBody, "FLOOD_WAIT_") {
		t.Fatalf("12-й begin с одного IP = %d %s, ожидался 420 FLOOD_WAIT_N", last, lastBody)
	}
	req := httptest.NewRequest(http.MethodPost, "/auth/passkey/begin", nil)
	req.Header.Set("X-Real-IP", "203.0.113.8")
	rec := httptest.NewRecorder()
	h.BeginLogin(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("другой IP = %d, ожидался 200", rec.Code)
	}
}

// fakePasskeyRepo — хранилище ключей одного credential (или пустое).
type fakePasskeyRepo struct{ byCred map[string]domain.Passkey }

func (f fakePasskeyRepo) Save(_ context.Context, pk domain.Passkey) (domain.Passkey, error) {
	return pk, nil
}
func (f fakePasskeyRepo) List(context.Context, int64) ([]domain.Passkey, error) { return nil, nil }
func (f fakePasskeyRepo) Delete(context.Context, int64, int64) (bool, error)    { return false, nil }
func (f fakePasskeyRepo) ByCredID(_ context.Context, credID string) (domain.Passkey, error) {
	if pk, ok := f.byCred[credID]; ok {
		return pk, nil
	}
	return domain.Passkey{}, domain.ErrNotFound
}
func (f fakePasskeyRepo) UpdateCredential(context.Context, int64, []byte) error { return nil }

// finishWithAssertion — begin (настоящая церемония) + finish с синтаксически
// верным assertion, у которого подпись не сходится: разбор проходит, колбэк
// поиска credential зовётся, проверка подписи — нет.
func finishWithAssertion(t *testing.T, h *PasskeyHandler, rawID []byte) *httptest.ResponseRecorder {
	t.Helper()
	begin := httptest.NewRecorder()
	h.BeginLogin(begin, httptest.NewRequest(http.MethodPost, "/auth/passkey/begin", nil))
	var opts struct {
		Session string `json:"session"`
	}
	if err := json.Unmarshal(begin.Body.Bytes(), &opts); err != nil || opts.Session == "" {
		t.Fatalf("begin: %d %s", begin.Code, begin.Body)
	}
	b64 := base64.RawURLEncoding.EncodeToString
	clientData, _ := json.Marshal(map[string]string{"type": "webauthn.get", "challenge": "bm90LXRoZS1jaGFsbGVuZ2U", "origin": "http://localhost"})
	authData := make([]byte, 37)
	authData[32] = 0x01 // UP
	body, _ := json.Marshal(map[string]any{
		"id": b64(rawID), "rawId": b64(rawID), "type": "public-key",
		"response": map[string]string{
			"clientDataJSON":    b64(clientData),
			"authenticatorData": b64(authData),
			"signature":         b64([]byte("not-a-signature")),
			"userHandle":        b64([]byte("1")),
		},
	})
	rec := httptest.NewRecorder()
	h.FinishLogin(rec, httptest.NewRequest(http.MethodPost, "/auth/passkey/finish?session="+opts.Session, bytes.NewReader(body)))
	return rec
}

// Ф7-И2 (правка 10): ключ, которого нет в базе, — 400 PASSKEY_CREDENTIAL_NOT_FOUND
// (tweb passkeyLoginButton.tsx:72-73 — тост Login.Passkey.Error.NotFound);
// знакомый ключ с неверной подписью — прежний 401 `passkey login failed`
// (прочие отказы tweb показывают общим тостом, :74-76).
func TestPasskeyFinishLogin_CredentialNotFound(t *testing.T) {
	known := []byte("known-credential")
	cred, _ := json.Marshal(webauthn.Credential{ID: known})
	repo := fakePasskeyRepo{byCred: map[string]domain.Passkey{
		base64.RawURLEncoding.EncodeToString(known): {ID: 7, UserID: 1, Credential: cred},
	}}
	h, err := NewPasskeyHandler("localhost", []string{"http://localhost"}, usecasepasskeys.New(repo), nil)
	if err != nil {
		t.Fatalf("NewPasskeyHandler: %v", err)
	}

	rec := finishWithAssertion(t, h, []byte("unknown-credential"))
	if e := wireErrorOf(rec); rec.Code != http.StatusBadRequest || e.Text != "PASSKEY_CREDENTIAL_NOT_FOUND" {
		t.Fatalf("незнакомый ключ = %d %s; want 400 PASSKEY_CREDENTIAL_NOT_FOUND", rec.Code, rec.Body)
	}
	rec = finishWithAssertion(t, h, known)
	if e := wireErrorOf(rec); rec.Code != http.StatusUnauthorized || e.Text != "passkey login failed" {
		t.Fatalf("знакомый ключ, неверная подпись = %d %s; want 401 passkey login failed", rec.Code, rec.Body)
	}
}
