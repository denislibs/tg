package http

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Провод REST выбирается ЗАГОЛОВКОМ — тот же приём, что подпротокол `tl.1` у
// сокета. Витрина при этом не меняется: одно и то же значение уезжает
// JSON-текстом старому клиенту и байтами схемы новому.

// tlReq — запрос, просящий провод TL.
func tlReq(t *testing.T, h http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		buf, _ := json.Marshal(body)
		rdr = bytes.NewReader(buf)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req := httptest.NewRequestWithContext(context.Background(), method, path, rdr)
	req.Header.Set("Accept", WireTLContentType)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestWireTL_ResponsesTravelAsSchemaBytes(t *testing.T) {
	h, pool := newMessagingRouter(t)
	token, meID := signUp(t, h, pool, "+79990130001")

	// «Получилось» — тот же конструктор, но байтами.
	rec := tlReq(t, h, http.MethodPost, "/auth/request_code", "", map[string]string{"phone": "+79990130009"})
	if rec.Code != http.StatusOK {
		t.Fatalf("запрос кода: %d %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != WireTLContentType {
		t.Fatalf("Content-Type = %q, ожидался провод TL", ct)
	}
	var ok domain.Bool
	if err := domain.WireCodec.Unmarshal(rec.Body.Bytes(), &ok); err != nil {
		t.Fatalf("тело не разбирается кодеком: %v (% x)", err, rec.Body.Bytes())
	}
	if ok.Underscore != domain.BoolTrueTag {
		t.Fatalf("_ = %q, ожидался boolTrue", ok.Underscore)
	}

	// Отказ — тоже конструктор, и тоже байтами.
	rec = tlReq(t, h, http.MethodPost, "/auth/request_code", "", map[string]string{"phone": ""})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("отказ: %d %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != WireTLContentType {
		t.Fatalf("Content-Type отказа = %q", ct)
	}
	var e domain.Error
	if err := domain.WireCodec.Unmarshal(rec.Body.Bytes(), &e); err != nil {
		t.Fatalf("отказ не разбирается: %v", err)
	}
	if e.Code != http.StatusBadRequest || e.Text == "" {
		t.Fatalf("отказ = %+v", e)
	}

	// Составная витрина: ключ пира конструктором.
	rec = tlReq(t, h, http.MethodPost, "/saved", token, map[string]any{})
	if rec.Code != http.StatusOK {
		t.Fatalf("«Избранное»: %d %s", rec.Code, rec.Body.String())
	}
	tree, err := domain.WireCodec.UnmarshalTree(rec.Body.Bytes())
	if err != nil {
		t.Fatalf("ключ пира не разбирается: %v", err)
	}
	raw, _ := json.Marshal(tree)
	peer, err := domain.UnmarshalPeer(raw)
	if err != nil {
		t.Fatalf("ключ пира не раскладывается: %v (%s)", err, raw)
	}
	if int64(peer.PeerID()) != meID {
		t.Fatalf("ключ пира = %d, ожидался %d", peer.PeerID(), meID)
	}
}

// Тот же запрос БЕЗ заголовка остаётся на JSON: договорённость о проводе
// заключает клиент, и старый её не заключает вовсе.
func TestWireTL_WithoutHeaderStaysJSON(t *testing.T) {
	h, pool := newMessagingRouter(t)
	_, _ = signUp(t, h, pool, "+79990130002")

	rec := postJSON(t, h, "/auth/request_code", map[string]string{"phone": "+79990130009"})
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q, ожидался JSON", ct)
	}
	if !isBoolTrue(rec.Body.Bytes()) {
		t.Fatalf("тело = %s", rec.Body.String())
	}
}

// Витрина БЕЗ конструктора (границы шага A/B: чужие протоколы, транспорт
// медиа, свои подсистемы) уезжает JSON-ом на ЛЮБОМ проводе — кодировать её
// нечем, и клиент узнаёт об этом по Content-Type.
func TestWireTL_ViewWithoutConstructorFallsBackToJSON(t *testing.T) {
	h, pool := newMessagingRouter(t)
	token, _ := signUp(t, h, pool, "+79990130003")

	rec := tlReq(t, h, http.MethodGet, "/me/password", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("облачный пароль: %d %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q; витрина без конструктора обязана остаться на JSON", ct)
	}
}
