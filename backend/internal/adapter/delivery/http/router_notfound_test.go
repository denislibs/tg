package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
	usecasepublic "github.com/messenger-denis/backend/internal/usecase/public"
)

// Ф7-И1 (MC-08, В-М1): неизвестный маршрут и неразрешённый метод отвечают
// конструктором error с текстом METHOD_INVALID, а не text/plain chi. Иначе
// клиент получает HttpError с пустым type (restClient.ts:23-26), а ветка
// tweb `error.type === 'UNKNOWN'` (apiManager.ts:810) повторяет запрос раз в
// секунду.
func notFoundRouter() http.Handler {
	pub := NewPublicHandler(usecasepublic.New(&fakePublicRepo{}), nil, testTme, testApp)
	uc := usecaseauth.New(nil, nil, nil, nil, nil, "12345", func(string, ...any) {})
	return NewRouter(uc, nil, nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, pub, nil, nil, nil, nil, nil, nil, nil, nil, true)
}

func TestRouter_UnknownRoute_MethodInvalid(t *testing.T) {
	h := notFoundRouter()

	rec := doReq(t, h, http.MethodGet, "/nope", nil, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("/nope = %d, want 404", rec.Code)
	}
	var e domain.Error
	if err := json.Unmarshal(rec.Body.Bytes(), &e); err != nil || e.Underscore != domain.ErrorTag || e.Code != 404 || e.Text != "METHOD_INVALID" {
		t.Fatalf("тело = %s (%+v, %v)", rec.Body.String(), e, err)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type = %q", ct)
	}

	// Провод TL: тот же отказ байтами конструктора error.
	req := httptest.NewRequest(http.MethodGet, "/nope", nil)
	req.Header.Set("Accept", WireTLContentType)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var tl domain.Error
	if rec.Code != http.StatusNotFound || rec.Header().Get("Content-Type") != WireTLContentType ||
		domain.WireCodec.Unmarshal(rec.Body.Bytes(), &tl) != nil || tl.Code != 404 || tl.Text != "METHOD_INVALID" {
		t.Fatalf("TL: %d %q %+v", rec.Code, rec.Header().Get("Content-Type"), tl)
	}

	// Путь есть, метода нет → 405 с Allow.
	rec = doReq(t, h, http.MethodDelete, "/auth/sign_in", nil, nil)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("DELETE /auth/sign_in = %d, want 405", rec.Code)
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &e); err != nil || e.Code != 405 || e.Text != "METHOD_INVALID" {
		t.Fatalf("405 тело = %s", rec.Body.String())
	}
	if !strings.Contains(rec.Header().Get("Allow"), http.MethodPost) {
		t.Fatalf("Allow = %q, want POST", rec.Header().Get("Allow"))
	}

	// Подроутер /langpack наследует обработчик корня.
	rec = doReq(t, h, http.MethodGet, "/langpack/ru/nope/nope", nil, nil)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "METHOD_INVALID") {
		t.Fatalf("/langpack/…: %d %s", rec.Code, rec.Body.String())
	}
}

// Публичный хост страниц (/tme — t.me) отвечает людям: неизвестный путь — HTML.
func TestRouter_PublicHost_NotFoundIsHTML(t *testing.T) {
	h := notFoundRouter()
	rec := doReq(t, h, http.MethodGet, "/tme/a/b/c/d", nil, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("= %d, want 404", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("Content-Type = %q, want text/html", ct)
	}
	if strings.Contains(rec.Body.String(), "METHOD_INVALID") {
		t.Fatalf("публичная страница отдала JSON: %s", rec.Body.String())
	}
}

// Хост страниц и неразрешённый метод отвечает HTML, а не JSON корня.
func TestRouter_PublicHost_MethodNotAllowedIsHTML(t *testing.T) {
	rec := doReq(t, notFoundRouter(), http.MethodPost, "/tme/alice", nil, nil)
	if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("= %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") || strings.Contains(rec.Body.String(), "METHOD_INVALID") {
		t.Fatalf("Content-Type %q, тело %s", ct, rec.Body.String())
	}
}
