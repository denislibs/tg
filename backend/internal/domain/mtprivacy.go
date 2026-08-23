package domain

import (
	"encoding/json"
	"fmt"
)

// Настройки приватности: КЛЮЧ настройки и ПРАВИЛА аудитории.
//
// Наша запись (`PrivacyRuleRecord` в privacy.go) держала это плоско:
//
//	{key: "last_seen", value: "contacts", allow_user_ids: […], deny_user_ids: […]}
//
// — то есть вид ключа СТРОКОЙ, базовое значение СТРОКОЙ и два исключения
// отдельными списками. В схеме всё это два объединения:
//
//	PrivacyKey  — какой ключ настраивается (`privacyKeyStatusTimestamp` и другие);
//	PrivacyRule — ОДНО правило, а настройка есть ВЕКТОР правил: базовое
//	              (`privacyValueAllowContacts`) плюс исключения
//	              (`privacyValueAllowUsers`, `privacyValueDisallowUsers`) —
//	              равноправные элементы одного вектора.
//
// Половина объединения `PrivacyRule` в пакете уже была: её завёл порт историй
// (mtstory.go), где аудитория истории выражается теми же конструкторами. Один
// предмет жил у нас в ДВУХ формах — объединением в историях и плоской записью в
// настройках; этот файл сводит их в одну и снимает долг, названный в mtstory.go.

// ── PrivacyKey: какой ключ настраивается ───────────────────────────────────

// Значения дискриминатора `_` объединения PrivacyKey.
//
// Ровно те десять, которые мы производим. Наши прежние строки и есть эти
// конструкторы — с точностью до имени: «время захода» в схеме называется
// `privacyKeyStatusTimestamp`, а «звонки» — `privacyKeyPhoneCall`.
const (
	PrivacyKeyPhoneNumberTag     = "privacyKeyPhoneNumber"
	PrivacyKeyAddedByPhoneTag    = "privacyKeyAddedByPhone"
	PrivacyKeyStatusTimestampTag = "privacyKeyStatusTimestamp"
	PrivacyKeyProfilePhotoTag    = "privacyKeyProfilePhoto"
	PrivacyKeyAboutTag           = "privacyKeyAbout"
	PrivacyKeyBirthdayTag        = "privacyKeyBirthday"
	PrivacyKeyPhoneCallTag       = "privacyKeyPhoneCall"
	PrivacyKeyForwardsTag        = "privacyKeyForwards"
	PrivacyKeyChatInviteTag      = "privacyKeyChatInvite"
	PrivacyKeyVoiceMessagesTag   = "privacyKeyVoiceMessages"

	// Два конструктора — НАШИ (объявлены в schema_additional_params.json с
	// явно назначенными id). Предмет у оригинала есть, но в ДРУГОЙ форме:
	// «кто может мне писать» там премиум-гейт, а «кто видит время прочтения» —
	// переключатель `hide_read_marks`; оба живут флагами globalPrivacySettings
	// и потому ДВУЗНАЧНЫ. Наш экран настроек предлагает этим двум ключам тот же
	// выбор из трёх, что и всем остальным, и сузить его — решение продуктовое,
	// а не про формат провода. Поэтому ключи остаются ключами.
	PrivacyKeyMessagesTag = "privacyKeyMessages"
	PrivacyKeyReadTimeTag = "privacyKeyReadTime"
)

// privacyKeyTags — наш ключ настройки → конструктор схемы.
var privacyKeyTags = map[PrivacyKey]string{
	PrivacyPhoneNumber:  PrivacyKeyPhoneNumberTag,
	PrivacyAddedByPhone: PrivacyKeyAddedByPhoneTag,
	PrivacyLastSeen:     PrivacyKeyStatusTimestampTag,
	PrivacyProfilePhoto: PrivacyKeyProfilePhotoTag,
	PrivacyAbout:        PrivacyKeyAboutTag,
	PrivacyBirthday:     PrivacyKeyBirthdayTag,
	PrivacyCalls:        PrivacyKeyPhoneCallTag,
	PrivacyForwards:     PrivacyKeyForwardsTag,
	PrivacyChatInvite:   PrivacyKeyChatInviteTag,
	PrivacyVoices:       PrivacyKeyVoiceMessagesTag,
	PrivacyMessages:     PrivacyKeyMessagesTag,
	PrivacyReadTime:     PrivacyKeyReadTimeTag,
}

// PrivacyKeyTag — конструктор для нашего ключа. Второе значение — «такого
// ключа нет вовсе»: имя пришло снаружи и его надо отвергнуть, а не подставить
// значение по умолчанию.
func PrivacyKeyTag(key PrivacyKey) (string, bool) {
	tag, ok := privacyKeyTags[key]
	return tag, ok
}

// PrivacyKeyOf — обратный перевод: конструктор схемы → наш ключ. Обе половины
// соответствия стоят рядом: врозь они расходятся.
func PrivacyKeyOf(tag string) (PrivacyKey, bool) {
	for key, t := range privacyKeyTags {
		if t == tag {
			return key, true
		}
	}
	return "", false
}

// ── PrivacyRule: запрещающая половина объединения ──────────────────────────
//
// Разрешающая (`privacyValueAllowAll` / `AllowContacts` / `AllowCloseFriends` /
// `AllowUsers`) объявлена в mtstory.go — то же объединение, тот же интерфейс.

const (
	PrivacyValueDisallowAllTag      = "privacyValueDisallowAll"
	PrivacyValueDisallowContactsTag = "privacyValueDisallowContacts"
	PrivacyValueDisallowUsersTag    = "privacyValueDisallowUsers"
)

// privacyValueDisallowAll#8b73e763 = PrivacyRule;
//
// Наше `value: "nobody"`.
type PrivacyValueDisallowAll struct {
	Underscore string `json:"_"`
}

func (PrivacyValueDisallowAll) isPrivacyRule() {}
func (r PrivacyValueDisallowAll) Tag() string  { return r.Underscore }

// privacyValueDisallowContacts#f888fa1a = PrivacyRule;
type PrivacyValueDisallowContacts struct {
	Underscore string `json:"_"`
}

func (PrivacyValueDisallowContacts) isPrivacyRule() {}
func (r PrivacyValueDisallowContacts) Tag() string  { return r.Underscore }

// privacyValueDisallowUsers#e4621141 users:Vector<long> = PrivacyRule;
//
// Наш `deny_user_ids`, лежавший отдельным ключом рядом со строкой `value`.
type PrivacyValueDisallowUsers struct {
	Underscore string  `json:"_"`
	Users      []int64 `json:"users"`
}

func (PrivacyValueDisallowUsers) isPrivacyRule() {}
func (r PrivacyValueDisallowUsers) Tag() string  { return r.Underscore }

// PrivacyRulesOf переводит нашу запись в ВЕКТОР правил схемы.
//
// Порядок — как у оригинала: сначала исключения, потом базовое значение. Он не
// косметика: правила читаются по очереди, и исключение, поставленное после
// «всем», уже ничего не изменило бы (порт `getPrivacyRulesDetails`).
func PrivacyRulesOf(r PrivacyRuleRecord) []PrivacyRule {
	out := make([]PrivacyRule, 0, 3)
	if len(r.AllowUserIDs) > 0 {
		out = append(out, PrivacyValueAllowUsers{Underscore: PrivacyValueAllowUsersTag, Users: r.AllowUserIDs})
	}
	if len(r.DenyUserIDs) > 0 {
		out = append(out, PrivacyValueDisallowUsers{Underscore: PrivacyValueDisallowUsersTag, Users: r.DenyUserIDs})
	}
	switch r.Value {
	case PrivacyEverybody:
		out = append(out, PrivacyValueAllowAll{Underscore: PrivacyValueAllowAllTag})
	case PrivacyContacts:
		out = append(out, PrivacyValueAllowContacts{Underscore: PrivacyValueAllowContactsTag})
	case PrivacyNobody:
		out = append(out, PrivacyValueDisallowAll{Underscore: PrivacyValueDisallowAllTag})
	}
	return out
}

// PrivacyRecordOf — обратный перевод: вектор правил схемы в нашу запись.
// Нужен на ВХОДЕ, где клиент присылает тот же вектор.
func PrivacyRecordOf(key PrivacyKey, rules []PrivacyRule) PrivacyRuleRecord {
	rec := PrivacyRuleRecord{Key: key, Value: DefaultPrivacyValue(key)}
	for _, rule := range rules {
		switch v := rule.(type) {
		case PrivacyValueAllowAll:
			rec.Value = PrivacyEverybody
		case PrivacyValueAllowContacts:
			rec.Value = PrivacyContacts
		case PrivacyValueDisallowAll:
			rec.Value = PrivacyNobody
		case PrivacyValueAllowUsers:
			rec.AllowUserIDs = v.Users
		case PrivacyValueDisallowUsers:
			rec.DenyUserIDs = v.Users
		}
	}
	return rec
}

// PrivacyRuleUnion — вектор правил с разбором по дискриминатору.
//
// Именованный тип, а не голый срез: `encoding/json` в интерфейс разбирать не
// умеет, и ветвление по `_` живёт здесь — тем же приёмом, что MessageEntities и
// MediaAreas.
type PrivacyRuleUnion []PrivacyRule

func (u *PrivacyRuleUnion) UnmarshalJSON(raw []byte) error {
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return err
	}
	out := make(PrivacyRuleUnion, 0, len(items))
	for _, item := range items {
		tag, ok, err := peekTag(item)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("правило приватности без дискриминатора")
		}
		var rule PrivacyRule
		switch tag {
		case PrivacyValueAllowAllTag:
			rule = PrivacyValueAllowAll{Underscore: tag}
		case PrivacyValueAllowContactsTag:
			rule = PrivacyValueAllowContacts{Underscore: tag}
		case PrivacyValueAllowCloseFriendsTag:
			rule = PrivacyValueAllowCloseFriends{Underscore: tag}
		case PrivacyValueDisallowAllTag:
			rule = PrivacyValueDisallowAll{Underscore: tag}
		case PrivacyValueDisallowContactsTag:
			rule = PrivacyValueDisallowContacts{Underscore: tag}
		case PrivacyValueAllowUsersTag:
			v, err := unmarshalCtor[PrivacyValueAllowUsers](item)
			if err != nil {
				return err
			}
			rule = v
		case PrivacyValueDisallowUsersTag:
			v, err := unmarshalCtor[PrivacyValueDisallowUsers](item)
			if err != nil {
				return err
			}
			rule = v
		default:
			// Незнакомый конструктор — ОШИБКА, а не пропуск: молча выброшенное
			// правило означает аудиторию шире той, что просил владелец. Здесь
			// нельзя как у реакций чата, где лишний элемент безобиден.
			return fmt.Errorf("неизвестный конструктор правила приватности: %s", tag)
		}
		out = append(out, rule)
	}
	*u = out
	return nil
}

// ── account.privacyRules: витрина одного ключа ─────────────────────────────

const AccountPrivacyRulesTag = "account.privacyRules"

// account.privacyRules#50a04e45 rules:Vector<PrivacyRule> chats:Vector<Chat>
// users:Vector<User> = account.PrivacyRules;
//
// Ключа в ответе НЕТ — его несёт запрос (`account.getPrivacy(key)`), и наш
// маршрут устроен так же: `/me/privacy/{key}`.
//
// `chats`/`users` — карточки названных исключениями. Едут пустыми: интерфейс
// показывает исключения числом, а карточки берёт из общего кэша пиров.
type AccountPrivacyRules struct {
	Underscore string        `json:"_"`
	Rules      []PrivacyRule `json:"rules"`
	Chats      []Chat        `json:"chats"`
	Users      []UserReal    `json:"users"`
}

func NewAccountPrivacyRules(rules []PrivacyRule, chats []Chat, users []UserReal) AccountPrivacyRules {
	return AccountPrivacyRules{
		Underscore: AccountPrivacyRulesTag,
		Rules:      orEmpty(rules),
		Chats:      orEmpty(chats),
		Users:      orEmpty(users),
	}
}
