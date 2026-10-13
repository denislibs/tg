package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	usecasenotify "github.com/messenger-denis/backend/internal/usecase/notify"
)

type memNotifyRepo struct {
	mu  sync.Mutex
	row *domain.NotifySettings
}

func (r *memNotifyRepo) Get(context.Context, int64) (domain.NotifySettings, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.row == nil {
		return domain.NotifySettings{}, domain.ErrNotFound
	}
	return *r.row, nil
}

func (r *memNotifyRepo) PatchType(_ context.Context, _ int64, t domain.NotifyType, muted, preview *bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	s := domain.DefaultNotifySettings()
	if r.row != nil {
		s = *r.row
	}
	cur := s.ForType(t)
	if muted != nil {
		cur.Muted = *muted
	}
	if preview != nil {
		cur.Preview = *preview
	}
	s = s.WithType(t, cur)
	r.row = &s
	return nil
}

func notifyCall(h http.HandlerFunc, method, target, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), userKey, domain.UserRecord{ID: 1}))
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

// Круг PUT → GET по каждому ключу типа: ответ — конструктор peerNotifySettings
// с явными show_previews и mute_until; значения одного типа не видны другому.
func TestNotifyHandler_RoundTripPerPeerType(t *testing.T) {
	h := NewNotifyHandler(usecasenotify.New(&memNotifyRepo{}))
	for _, key := range []string{"notifyUsers", "notifyChats", "notifyBroadcasts"} {
		put := notifyCall(h.Update, http.MethodPut, "/me/notify_settings?peer="+key,
			`{"_":"inputPeerNotifySettings","show_previews":false,"mute_until":2147483647}`)
		if put.Code != http.StatusOK || strings.TrimSpace(put.Body.String()) != `{"_":"boolTrue"}` {
			t.Fatalf("%s: PUT = %d %s", key, put.Code, put.Body.String())
		}
		get := notifyCall(h.Get, http.MethodGet, "/me/notify_settings?peer="+key, "")
		var got map[string]any
		if err := json.Unmarshal(get.Body.Bytes(), &got); err != nil || get.Code != http.StatusOK {
			t.Fatalf("%s: GET = %d %s", key, get.Code, get.Body.String())
		}
		if got["_"] != "peerNotifySettings" || got["show_previews"] != false || got["mute_until"] != float64(domain.MuteUntilForever) {
			t.Fatalf("%s: GET body = %v", key, got)
		}
	}
}

func TestNotifyHandler_GetDefaultsAreExplicit(t *testing.T) {
	h := NewNotifyHandler(usecasenotify.New(&memNotifyRepo{}))
	rec := notifyCall(h.Get, http.MethodGet, "/me/notify_settings?peer=notifyUsers", "")
	var got map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got["show_previews"] != true || got["mute_until"] != float64(0) {
		t.Fatalf("дефолт = %v", got)
	}
}

func TestNotifyHandler_BadPeerAndBody(t *testing.T) {
	h := NewNotifyHandler(usecasenotify.New(&memNotifyRepo{}))
	for _, target := range []string{"/me/notify_settings", "/me/notify_settings?peer=", "/me/notify_settings?peer=notifyPeer", "/me/notify_settings?peer=users"} {
		if rec := notifyCall(h.Get, http.MethodGet, target, ""); rec.Code != http.StatusBadRequest {
			t.Errorf("GET %s = %d", target, rec.Code)
		}
		if rec := notifyCall(h.Update, http.MethodPut, target, `{}`); rec.Code != http.StatusBadRequest {
			t.Errorf("PUT %s = %d", target, rec.Code)
		}
	}
	if rec := notifyCall(h.Update, http.MethodPut, "/me/notify_settings?peer=notifyUsers", `{`); rec.Code != http.StatusBadRequest {
		t.Errorf("PUT с битым телом = %d", rec.Code)
	}
}

// Частичный PUT не трогает непереданное поле.
func TestNotifyHandler_PartialPutKeepsOtherField(t *testing.T) {
	h := NewNotifyHandler(usecasenotify.New(&memNotifyRepo{}))
	notifyCall(h.Update, http.MethodPut, "/me/notify_settings?peer=notifyChats", `{"show_previews":false}`)
	notifyCall(h.Update, http.MethodPut, "/me/notify_settings?peer=notifyChats", `{"mute_until":2147483647}`)
	var got map[string]any
	_ = json.Unmarshal(notifyCall(h.Get, http.MethodGet, "/me/notify_settings?peer=notifyChats", "").Body.Bytes(), &got)
	if got["show_previews"] != false || got["mute_until"] != float64(domain.MuteUntilForever) {
		t.Fatalf("%v", got)
	}
}
