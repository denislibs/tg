package domain

import (
	"encoding/json"
	"sort"
	"testing"
)

// Сверка конфига приложения со схемой TL — со стороны производителя: лишнего
// нет, обязательные параметры выведены (нулями, где сервер значение не применяет).
func TestHelpConfig_MatchesSchema(t *testing.T) {
	cases := []struct {
		name  string
		value any
	}{
		{"help.appConfig", NewHelpAppConfig(NewAppConfig(false))},
		{"help.appConfigNotModified", NewHelpAppConfigNotModified()},
		{"config", NewConfig(1_700_000_000)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := &schemaChecker{
				constructors: loadSchemaConstructors(t),
				additional:   loadAdditionalParams(t),
				own:          loadOwnConstructors(t),
				omittedOK:    OmittedWithoutSubject,
			}
			c.walk(roundTripJSON(t, tc.value), "help")
			sort.Strings(c.unexpected)
			sort.Strings(c.omitted)
			for _, s := range c.unexpected {
				t.Errorf("лишнее: %s", s)
			}
			for _, s := range c.omitted {
				t.Errorf("пропущено: %s", s)
			}
		})
	}
}

// Провод TL принимает все три конструктора и возвращает их же (кодек строит
// байты по схеме: падение здесь значит, что клиент с `Accept: application/x-tl`
// получит JSON вместо конфига).
func TestHelpConfig_TravelsAsTL(t *testing.T) {
	for name, v := range map[string]any{
		"help.appConfig":            NewHelpAppConfig(NewAppConfig(true)),
		"help.appConfigNotModified": NewHelpAppConfigNotModified(),
		"config":                    NewConfig(1_700_000_000),
	} {
		body, err := WireCodec.Marshal(v)
		if err != nil {
			t.Fatalf("%s: кодек не собрал значение: %v", name, err)
		}
		tree, err := WireCodec.UnmarshalTree(body)
		if err != nil {
			t.Fatalf("%s: байты не разбираются: %v", name, err)
		}
		raw, _ := json.Marshal(tree)
		var got struct {
			Underscore string `json:"_"`
		}
		if err := json.Unmarshal(raw, &got); err != nil || got.Underscore != name {
			t.Fatalf("%s: разобрано %s (err=%v)", name, raw, err)
		}
	}
}

// Ключи и значения app_config — из domain/limits.go (одна константа на правило
// сервера и на значение, которое получает клиент).
func TestAppConfig_Values(t *testing.T) {
	flat := func(dev bool) map[string]any {
		out := map[string]any{}
		for _, kv := range NewAppConfig(dev).Value {
			switch v := kv.Value.(type) {
			case JSONNumber:
				out[kv.Key] = v.Value
			case JSONBool:
				out[kv.Key] = v.Value
			default:
				t.Fatalf("ключ %s: значение неожиданного вида %T", kv.Key, kv.Value)
			}
		}
		return out
	}

	prod := flat(false)
	for key, want := range map[string]any{
		"dialogs_pinned_limit_default":      float64(MaxPinnedDialogs),
		"dialogs_pinned_limit_premium":      float64(MaxPinnedDialogs),
		"stickers_faved_limit_default":      float64(FavedStickersLimit),
		"stickers_faved_limit_premium":      float64(FavedStickersLimit),
		"saved_gifs_limit_default":          float64(SavedGifsLimit),
		"saved_gifs_limit_premium":          float64(SavedGifsLimit),
		"dialog_filters_limit_default":      float64(MaxFoldersPerUser),
		"dialog_filters_limit_premium":      float64(MaxFoldersPerUser),
		"reactions_user_max_default":        float64(ReactionsUserMaxDefault),
		"reactions_user_max_premium":        float64(ReactionsUserMaxPremium),
		"chat_read_mark_size_threshold":     float64(ChatReadMarkSizeThreshold),
		"chat_read_mark_expire_period":      float64(7 * 24 * 3600),
		"passkeys_account_passkeys_max":     float64(MaxPasskeys),
		"groupcall_video_participants_max":  float64(5),
		"stories_stealth_past_period":       float64(300),
		"stories_stealth_future_period":     float64(1500),
		"stars_purchase_blocked":            true,
		"premium_purchase_blocked":          true,
		"giveaway_gifts_purchase_available": false,
	} {
		if got, ok := prod[key]; !ok || got != want {
			t.Errorf("%s = %v (есть=%v), want %v", key, got, ok, want)
		}
	}
	if _, ok := prod["stories_pinned_to_top_count_max"]; ok {
		t.Error("stories_pinned_to_top_count_max отдан, а сервер число закреплённых историй не ограничивает")
	}
	if _, ok := prod["forum_upgrade_participants_min"]; ok {
		t.Error("forum_upgrade_participants_min отдан, а сервер включает темы в группе любого размера")
	}

	dev := flat(true)
	if dev["stars_purchase_blocked"] != false || dev["premium_purchase_blocked"] != false {
		t.Errorf("при DEV_PURCHASES покупки не заблокированы: %v / %v", dev["stars_purchase_blocked"], dev["premium_purchase_blocked"])
	}
}

// hash меняется только вместе со значениями и никогда не равен нулю.
func TestAppConfigHash(t *testing.T) {
	prod, dev := AppConfigHash(NewAppConfig(false)), AppConfigHash(NewAppConfig(true))
	if prod == 0 || dev == 0 {
		t.Fatalf("hash = 0 (prod=%d dev=%d): клиент шлёт 0, когда конфига у него нет", prod, dev)
	}
	if prod == dev {
		t.Fatalf("hash одинаков при разных значениях флагов покупок: %d", prod)
	}
	if again := AppConfigHash(NewAppConfig(false)); again != prod {
		t.Fatalf("hash нестабилен: %d, затем %d", prod, again)
	}
	if prod < 0 || dev < 0 {
		t.Fatalf("hash отрицателен (prod=%d dev=%d)", prod, dev)
	}
}

func TestConfig_AppliedLimits(t *testing.T) {
	c := NewConfig(1_700_000_000)
	if c.EditTimeLimit != 172800 {
		t.Errorf("edit_time_limit = %d, want 172800", c.EditTimeLimit)
	}
	if c.MessageLengthMax != MaxMessageRunes || c.CaptionLengthMax != MaxMessageRunes {
		t.Errorf("message_length_max/caption_length_max = %d/%d, want %d", c.MessageLengthMax, c.CaptionLengthMax, MaxMessageRunes)
	}
	if c.StickersRecentLimit != RecentStickersLimit {
		t.Errorf("stickers_recent_limit = %d, want %d", c.StickersRecentLimit, RecentStickersLimit)
	}
	if c.Date != 1_700_000_000 || c.Expires != c.Date+ConfigTTLSeconds {
		t.Errorf("date/expires = %d/%d", c.Date, c.Expires)
	}
	if len(c.PFlags) != 0 {
		t.Errorf("флаги схемы подняты: %v", c.PFlags)
	}
}
