package domain

import (
	"testing"
	"time"
)

// «Новый вход» (tweb appAccountManager.ts:277-294, layer.d.ts:2869-2879): флаг
// unconfirmed на строке сессии живёт AuthorizationAutoconfirmPeriod (7 суток,
// authorizationAutoconfirmPeriod.ts:1) от входа; потом сессия считается
// подтверждённой сама.
func TestNewAuthorization_UnconfirmedFlag(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	d := otherDevice()
	d.Unconfirmed = true

	d.CreatedAt = now.Add(-6 * 24 * time.Hour)
	if a := NewAuthorization(d, false, now); !a.PFlags["unconfirmed"] {
		t.Errorf("6 суток: pFlags = %v, want unconfirmed", a.PFlags)
	}
	// У текущей строки флаг тоже ставится: клиент отфильтрует её сам (tweb :285).
	if a := NewAuthorization(d, true, now); !a.PFlags["unconfirmed"] || !a.PFlags["current"] {
		t.Errorf("текущая: pFlags = %v, want current+unconfirmed", a.PFlags)
	}
	d.CreatedAt = now.Add(-8 * 24 * time.Hour)
	if a := NewAuthorization(d, false, now); a.PFlags["unconfirmed"] {
		t.Errorf("8 суток: pFlags = %v, флаг должен погаснуть сам", a.PFlags)
	}
	// Граница — в целых секундах, строго «больше» (date + PERIOD > now).
	d.CreatedAt = now.Add(-AuthorizationAutoconfirmPeriod)
	if d.IsUnconfirmed(now) {
		t.Error("ровно 7 суток: сессия уже подтверждена")
	}
	d.CreatedAt = now.Add(-AuthorizationAutoconfirmPeriod + time.Second)
	if !d.IsUnconfirmed(now) {
		t.Error("7 суток без секунды: сессия ещё неподтверждена")
	}
	d.Unconfirmed = false
	if d.IsUnconfirmed(now) {
		t.Error("подтверждённая сессия не бывает неподтверждённой")
	}
}

func TestNewUpdateNewAuthorization_Wire(t *testing.T) {
	d := Device{ID: 11, Name: "Chrome", Platform: "web", Location: "Москва, Россия",
		CreatedAt: time.Unix(1_800_000_000, 0), Unconfirmed: true}
	got, _ := roundTripJSON(t, NewUpdateNewAuthorization(d)).(map[string]any)
	if got["_"] != UpdateNewAuthorizationTag || got["hash"] != float64(11) ||
		got["date"] != float64(1_800_000_000) || got["device"] != "Chrome, web" ||
		got["location"] != "Москва, Россия" {
		t.Fatalf("тело = %#v", got)
	}
	if flags, _ := got["pFlags"].(map[string]any); flags["unconfirmed"] != true {
		t.Fatalf("pFlags = %#v, want unconfirmed", got["pFlags"])
	}

	// device склеивается как у tweb: пустые части пропускаются; пустое место опускается.
	bare := Device{ID: 12, Platform: "web", CreatedAt: time.Unix(5, 0), Unconfirmed: true}
	b, _ := roundTripJSON(t, NewUpdateNewAuthorization(bare)).(map[string]any)
	if b["device"] != "web" {
		t.Errorf("device = %#v, want web (пустое имя пропущено)", b["device"])
	}
	if _, has := b["location"]; has {
		t.Errorf("пустое место не опускается: %#v", b)
	}

	rem, _ := roundTripJSON(t, NewUpdateNewAuthorizationRemoved(11)).(map[string]any)
	if len(rem) != 2 || rem["_"] != UpdateNewAuthorizationTag || rem["hash"] != float64(11) {
		t.Fatalf("«убрать» = %#v, want только _ и hash (без pFlags)", rem)
	}
}
