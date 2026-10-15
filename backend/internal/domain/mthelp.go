package domain

import (
	"hash/crc32"
	"sort"
	"strconv"
)

// Конфиг приложения: `help.getAppConfig` (лимиты и флаги в JSON-значении) и
// `help.getConfig` (плоский конструктор `config`). Клиент tweb читает первый
// через `getLimit(...)` и `appConfig.<ключ>` (`apiManagerMethods.ts:340-394`),
// второй — `config.edit_time_limit`, `config.message_length_max` и т. п.
// (`apiManagerMethods.ts:310-322`).
//
// Правило В-12: в конфиге только то, что сервер ПРИМЕНЯЕТ, и флаги, которые
// читает наш клиент. Остальные обязательные поля `config` — нулевые значения
// (параметр занимает место в потоке TL), флаги сняты.

// Значения дискриминатора `_`.
const (
	HelpAppConfigTag            = "help.appConfig"
	HelpAppConfigNotModifiedTag = "help.appConfigNotModified"
	JSONObjectTag               = "jsonObject"
	JSONObjectValueTag          = "jsonObjectValue"
	JSONNumberTag               = "jsonNumber"
	JSONBoolTag                 = "jsonBool"
	ConfigTag                   = "config"
)

// JSONValue — объединение схемы: число, булево, объект (остальные конструкторы
// объединения конфигу не нужны и не производятся).
type JSONValue interface{ isJSONValue() }

// jsonNumber#2be0dfa4 value:double = JSONValue;
type JSONNumber struct {
	Underscore string  `json:"_"`
	Value      float64 `json:"value"`
}

func (JSONNumber) isJSONValue() {}

// NewJSONNumber — число.
func NewJSONNumber(v float64) JSONNumber { return JSONNumber{Underscore: JSONNumberTag, Value: v} }

// jsonBool#c7345e6a value:Bool = JSONValue;
type JSONBool struct {
	Underscore string `json:"_"`
	Value      bool   `json:"value"`
}

func (JSONBool) isJSONValue() {}

// NewJSONBool — булево.
func NewJSONBool(v bool) JSONBool { return JSONBool{Underscore: JSONBoolTag, Value: v} }

// jsonObjectValue#c0de1bd9 key:string value:JSONValue = JSONObjectValue;
type JSONObjectValue struct {
	Underscore string    `json:"_"`
	Key        string    `json:"key"`
	Value      JSONValue `json:"value"`
}

// jsonObject#99c1d49d value:Vector<JSONObjectValue> = JSONValue;
type JSONObject struct {
	Underscore string            `json:"_"`
	Value      []JSONObjectValue `json:"value"`
}

func (JSONObject) isJSONValue() {}

// NewJSONObject собирает объект из пар «ключ — значение». Порядок ключей
// сортированный: один и тот же набор значений всегда даёт одни и те же байты,
// а значит и один и тот же hash конфига.
func NewJSONObject(values map[string]JSONValue) JSONObject {
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]JSONObjectValue, 0, len(keys))
	for _, k := range keys {
		out = append(out, JSONObjectValue{Underscore: JSONObjectValueTag, Key: k, Value: values[k]})
	}
	return JSONObject{Underscore: JSONObjectTag, Value: out}
}

// HelpAppConfig — help.appConfig#dd18782e hash:int config:JSONValue = help.AppConfig.
type HelpAppConfig struct {
	Underscore string     `json:"_"`
	Hash       int32      `json:"hash"`
	Config     JSONObject `json:"config"`
}

// NewHelpAppConfig — конфиг с хэшем. Хэш — стабильная сумма значений
// (AppConfigHash): меняется только при смене ключей или значений.
func NewHelpAppConfig(config JSONObject) HelpAppConfig {
	return HelpAppConfig{Underscore: HelpAppConfigTag, Hash: AppConfigHash(config), Config: config}
}

// HelpAppConfigNotModified — help.appConfigNotModified#7cde641d = help.AppConfig.
type HelpAppConfigNotModified struct {
	Underscore string `json:"_"`
}

// NewHelpAppConfigNotModified — «конфиг не менялся» (hash запроса совпал).
func NewHelpAppConfigNotModified() HelpAppConfigNotModified {
	return HelpAppConfigNotModified{Underscore: HelpAppConfigNotModifiedTag}
}

// AppConfigHash — int32 от CRC-32 по ключам и значениям, в порядке ключей.
// Ноль не возвращается: клиент шлёт `hash: 0`, когда конфига у него нет
// (`apiManagerMethods.ts:351`), и совпадение с нулём вернуло бы «не менялось»
// тому, у кого ничего нет.
func AppConfigHash(config JSONObject) int32 {
	h := crc32.NewIEEE()
	for _, kv := range config.Value {
		_, _ = h.Write([]byte(kv.Key))
		_, _ = h.Write([]byte{0})
		switch v := kv.Value.(type) {
		case JSONNumber:
			_, _ = h.Write([]byte{'n'})
			_, _ = h.Write([]byte(strconv.FormatFloat(v.Value, 'g', -1, 64)))
		case JSONBool:
			if v.Value {
				_, _ = h.Write([]byte{'t'})
			} else {
				_, _ = h.Write([]byte{'f'})
			}
		}
		_, _ = h.Write([]byte{0})
	}
	// Положительный int32: старший бит клиент не должен принимать за знак.
	sum := int32(h.Sum32() & 0x7fffffff)
	if sum == 0 {
		return 1
	}
	return sum
}

// Config — config#cc1a241e ... = Config. Обязательные параметры схемы, которых
// сервер не применяет, пишутся нулями (правило В-12); флаги сняты, необязательные
// параметры не выведены.
type Config struct {
	Underscore string `json:"_"`
	// pFlags — булевы флаги схемы (default_p2p_contacts, preload_featured_stickers,
	// revoke_pm_inbox, blocked_mode, force_try_ipv6); у сервера все сняты.
	PFlags                  map[string]bool `json:"pFlags"`
	Date                    int64           `json:"date"`
	Expires                 int64           `json:"expires"`
	TestMode                bool            `json:"test_mode"`
	ThisDC                  int             `json:"this_dc"`
	DCOptions               []any           `json:"dc_options"`
	DCTxtDomainName         string          `json:"dc_txt_domain_name"`
	ChatSizeMax             int             `json:"chat_size_max"`
	MegagroupSizeMax        int             `json:"megagroup_size_max"`
	ForwardedCountMax       int             `json:"forwarded_count_max"`
	OnlineUpdatePeriodMs    int             `json:"online_update_period_ms"`
	OfflineBlurTimeoutMs    int             `json:"offline_blur_timeout_ms"`
	OfflineIdleTimeoutMs    int             `json:"offline_idle_timeout_ms"`
	OnlineCloudTimeoutMs    int             `json:"online_cloud_timeout_ms"`
	NotifyCloudDelayMs      int             `json:"notify_cloud_delay_ms"`
	NotifyDefaultDelayMs    int             `json:"notify_default_delay_ms"`
	PushChatPeriodMs        int             `json:"push_chat_period_ms"`
	PushChatLimit           int             `json:"push_chat_limit"`
	EditTimeLimit           int             `json:"edit_time_limit"`
	RevokeTimeLimit         int             `json:"revoke_time_limit"`
	RevokePmTimeLimit       int             `json:"revoke_pm_time_limit"`
	RatingEDecay            int             `json:"rating_e_decay"`
	StickersRecentLimit     int             `json:"stickers_recent_limit"`
	ChannelsReadMediaPeriod int             `json:"channels_read_media_period"`
	CallReceiveTimeoutMs    int             `json:"call_receive_timeout_ms"`
	CallRingTimeoutMs       int             `json:"call_ring_timeout_ms"`
	CallConnectTimeoutMs    int             `json:"call_connect_timeout_ms"`
	CallPacketTimeoutMs     int             `json:"call_packet_timeout_ms"`
	MeURLPrefix             string          `json:"me_url_prefix"`
	CaptionLengthMax        int             `json:"caption_length_max"`
	MessageLengthMax        int             `json:"message_length_max"`
	WebfileDCID             int             `json:"webfile_dc_id"`
}

// ConfigTTLSeconds — сколько клиент держит `config` (поле `expires` — момент,
// после которого его надо перезапросить).
const ConfigTTLSeconds = 3600

// NewConfig собирает `help.getConfig`: применяемые сервером значения из
// domain/limits.go, остальное — нули. now — unix-секунды.
func NewConfig(now int64) Config {
	return Config{
		Underscore:          ConfigTag,
		PFlags:              map[string]bool{},
		Date:                now,
		Expires:             now + ConfigTTLSeconds,
		DCOptions:           []any{},
		EditTimeLimit:       int(EditTimeLimit.Seconds()),
		StickersRecentLimit: RecentStickersLimit,
		CaptionLengthMax:    MaxMessageRunes,
		MessageLengthMax:    MaxMessageRunes,
	}
}

// NewAppConfig собирает объект `help.getAppConfig`: лимиты, которые сервер
// применяет (из domain/limits.go), и флаги-выключатели покупок.
//
// Ключи `_default` и `_premium` совпадают там, где сервер премиум-подписчика от
// остальных не отличает. Не отдаются ключи, которых сервер не применяет:
// `forum_upgrade_participants_min` (темы включаются в группе любого размера),
// `stories_pinned_to_top_count_max` (закреплённых историй сервер не ограничивает).
//
// devPurchases — DEV_PURCHASES (config.Config.DevPurchases): при включённом
// dev-начислении звёзд и моке Premium покупки НЕ заблокированы; в проде обе
// покупки скрыты (`stars_purchase_blocked`, `premium_purchase_blocked` —
// `components/popups/stars.tsx:972`, `lib/apiManagerProxy.ts:1380-1384`).
// `giveaway_gifts_purchase_available` tweb только объявляет (`appConfig.d.ts:98`)
// и нигде не читает; ключ декоративный, ничего не прячет.
func NewAppConfig(devPurchases bool) JSONObject {
	num := func(v float64) JSONValue { return NewJSONNumber(v) }
	both := func(m map[string]JSONValue, base string, v float64) {
		m[base+"_default"] = num(v)
		m[base+"_premium"] = num(v)
	}

	m := map[string]JSONValue{}
	both(m, "dialogs_pinned_limit", MaxPinnedDialogs)
	both(m, "stickers_faved_limit", FavedStickersLimit)
	both(m, "saved_gifs_limit", SavedGifsLimit)
	both(m, "dialog_filters_limit", MaxFoldersPerUser)
	m["reactions_user_max_default"] = num(ReactionsUserMaxDefault)
	m["reactions_user_max_premium"] = num(ReactionsUserMaxPremium)
	m["chat_read_mark_size_threshold"] = num(ChatReadMarkSizeThreshold)
	m["chat_read_mark_expire_period"] = num(ChatReadMarkExpirePeriod.Seconds())
	m["passkeys_account_passkeys_max"] = num(MaxPasskeys)
	m["stories_stealth_past_period"] = num(StealthPastPeriod.Seconds())
	m["stories_stealth_future_period"] = num(StealthFuturePeriod.Seconds())
	m["stars_purchase_blocked"] = NewJSONBool(!devPurchases)
	m["premium_purchase_blocked"] = NewJSONBool(!devPurchases)
	m["giveaway_gifts_purchase_available"] = NewJSONBool(false)
	return NewJSONObject(m)
}
