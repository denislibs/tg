package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/store/postgres"
)

// Ф7-К: help.getAppConfig / help.getConfig через настоящий роутер (за Bearer,
// как у всех ручек пользователя).

type appConfigBody struct {
	Underscore string `json:"_"`
	Hash       int32  `json:"hash"`
	Config     struct {
		Value []struct {
			Key      string          `json:"key"`
			RawValue json.RawMessage `json:"value"`
		} `json:"value"`
	} `json:"config"`
}

// flatAppConfig разворачивает jsonObject в плоскую карту (как tweb formatJSONValue).
func flatAppConfig(t *testing.T, body []byte) (int32, map[string]any) {
	t.Helper()
	var got appConfigBody
	if err := json.Unmarshal(body, &got); err != nil || got.Underscore != "help.appConfig" {
		t.Fatalf("тело не help.appConfig: %v / %s", err, body)
	}
	out := map[string]any{}
	for _, kv := range got.Config.Value {
		var v struct {
			Underscore string          `json:"_"`
			Value      json.RawMessage `json:"value"`
		}
		if err := json.Unmarshal(kv.RawValue, &v); err != nil {
			t.Fatalf("ключ %s: %v", kv.Key, err)
		}
		switch v.Underscore {
		case "jsonNumber":
			var n float64
			_ = json.Unmarshal(v.Value, &n)
			out[kv.Key] = n
		case "jsonBool":
			var b bool
			_ = json.Unmarshal(v.Value, &b)
			out[kv.Key] = b
		default:
			t.Fatalf("ключ %s: конструктор %q", kv.Key, v.Underscore)
		}
	}
	return got.Hash, out
}

func TestHelpAppConfig_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	build := func(dev bool) http.Handler {
		return NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, dev)
	}
	devRouter, prodRouter := build(true), build(false)
	token, _ := loginViaHTTP(t, devRouter, "+79990170001")

	// Без токена ручки нет в открытом доступе.
	rec := httptest.NewRecorder()
	prodRouter.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/help/app_config", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("без токена: %d, want 401", rec.Code)
	}

	// Прод: покупки заблокированы, лимиты — из domain/limits.go.
	rec = authedReq(t, prodRouter, http.MethodGet, "/help/app_config", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("app_config: %d %s", rec.Code, rec.Body.String())
	}
	prodHash, prod := flatAppConfig(t, rec.Body.Bytes())
	for key, want := range map[string]any{
		"dialogs_pinned_limit_default":      float64(domain.MaxPinnedDialogs),
		"passkeys_account_passkeys_max":     float64(domain.MaxPasskeys),
		"stories_stealth_past_period":       float64(300),
		"stories_stealth_future_period":     float64(1500),
		"stars_purchase_blocked":            true,
		"premium_purchase_blocked":          true,
		"giveaway_gifts_purchase_available": false,
	} {
		if prod[key] != want {
			t.Errorf("прод: %s = %v, want %v", key, prod[key], want)
		}
	}
	if _, ok := prod["stories_pinned_to_top_count_max"]; ok {
		t.Error("stories_pinned_to_top_count_max отдан")
	}

	// DEV_PURCHASES: покупки открыты, и hash другой (флаг входит в hash).
	rec = authedReq(t, devRouter, http.MethodGet, "/help/app_config", token, nil)
	devHash, dev := flatAppConfig(t, rec.Body.Bytes())
	if dev["stars_purchase_blocked"] != false || dev["premium_purchase_blocked"] != false {
		t.Errorf("dev: покупки заблокированы: %v / %v", dev["stars_purchase_blocked"], dev["premium_purchase_blocked"])
	}
	if devHash == prodHash {
		t.Errorf("hash одинаков при разных флагах: %d", devHash)
	}

	// Повтор с полученным hash — «не менялось»; с чужим или нулевым — полный конфиг.
	rec = authedReq(t, prodRouter, http.MethodGet, "/help/app_config?hash="+strconv.Itoa(int(prodHash)), token, nil)
	var nm struct {
		Underscore string `json:"_"`
	}
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &nm) != nil || nm.Underscore != "help.appConfigNotModified" {
		t.Fatalf("повтор с hash: %d %s", rec.Code, rec.Body.String())
	}
	for _, h := range []string{"0", strconv.Itoa(int(prodHash) + 1), "не число"} {
		rec = authedReq(t, prodRouter, http.MethodGet, "/help/app_config?hash="+url.QueryEscape(h), token, nil)
		if _, full := flatAppConfig(t, rec.Body.Bytes()); full["dialogs_pinned_limit_default"] == nil {
			t.Errorf("hash=%q: полного конфига нет", h)
		}
	}
}

func TestHelpConfig_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	token, _ := signUp(t, h, pool, "+79990170002")

	rec := authedReq(t, h, http.MethodGet, "/help/config", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("config: %d %s", rec.Code, rec.Body.String())
	}
	var c struct {
		Underscore       string `json:"_"`
		EditTimeLimit    int    `json:"edit_time_limit"`
		MessageLengthMax int    `json:"message_length_max"`
		Date             int64  `json:"date"`
		Expires          int64  `json:"expires"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &c); err != nil || c.Underscore != "config" {
		t.Fatalf("тело не config: %v / %s", err, rec.Body.String())
	}
	if c.EditTimeLimit != 172800 || c.MessageLengthMax != domain.MaxMessageRunes {
		t.Errorf("edit_time_limit=%d message_length_max=%d", c.EditTimeLimit, c.MessageLengthMax)
	}
	if c.Date == 0 || c.Expires != c.Date+domain.ConfigTTLSeconds {
		t.Errorf("date=%d expires=%d", c.Date, c.Expires)
	}

	// Тем же маршрутом провод TL.
	tl := tlReq(t, h, http.MethodGet, "/help/config", token, nil)
	if ct := tl.Header().Get("Content-Type"); tl.Code != http.StatusOK || ct != WireTLContentType {
		t.Fatalf("TL: %d %q", tl.Code, ct)
	}
	tl = tlReq(t, h, http.MethodGet, "/help/app_config", token, nil)
	if ct := tl.Header().Get("Content-Type"); tl.Code != http.StatusOK || ct != WireTLContentType {
		t.Fatalf("TL app_config: %d %q", tl.Code, ct)
	}
}
