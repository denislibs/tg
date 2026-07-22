package domain

import "slices"

// PrivacyKey перечисляет регулируемые аспекты (tweb InputPrivacyKey*).
type PrivacyKey string

const (
	PrivacyPhoneNumber  PrivacyKey = "phone_number"   // кто видит мой номер
	PrivacyAddedByPhone PrivacyKey = "added_by_phone" // кто может найти меня по номеру (без nobody)
	PrivacyLastSeen     PrivacyKey = "last_seen"      // кто видит время захода
	PrivacyProfilePhoto PrivacyKey = "profile_photo"  // кто видит фото профиля
	PrivacyAbout        PrivacyKey = "about"          // кто видит «О себе»
	PrivacyBirthday     PrivacyKey = "birthday"       // кто видит день рождения
	PrivacyCalls        PrivacyKey = "calls"          // кто может мне звонить
	PrivacyForwards     PrivacyKey = "forwards"       // кто может ссылаться на аккаунт при пересылке
	PrivacyChatInvite   PrivacyKey = "chat_invite"    // кто может приглашать меня в группы
	PrivacyMessages     PrivacyKey = "messages"       // кто может отправлять мне сообщения
	PrivacyVoices       PrivacyKey = "voice_messages" // кто может отправлять мне голосовые
	PrivacyReadTime     PrivacyKey = "read_time"      // кто видит, когда я прочитал (взаимно)
)

// PrivacyKeys — канонический порядок ключей (порядок секции Privacy в tweb).
var PrivacyKeys = []PrivacyKey{
	PrivacyPhoneNumber, PrivacyAddedByPhone, PrivacyLastSeen, PrivacyProfilePhoto,
	PrivacyAbout, PrivacyCalls, PrivacyForwards, PrivacyChatInvite,
	PrivacyVoices, PrivacyMessages, PrivacyBirthday, PrivacyReadTime,
}

// Значения правила (tweb PrivacyType).
const (
	PrivacyEverybody = "everybody"
	PrivacyContacts  = "contacts"
	PrivacyNobody    = "nobody"
)

// PrivacyRule — правило одного ключа: базовое значение + точечные исключения.
// Deny перекрывает Allow, оба перекрывают Value (tweb: exceptions override).
type PrivacyRule struct {
	Key          PrivacyKey
	Value        string
	AllowUserIDs []int64
	DenyUserIDs  []int64
}

// DefaultPrivacyValue — значение ключа, пока пользователь ничего не менял
// (дефолты Telegram: номер и день рождения — контактам, остальное — всем).
func DefaultPrivacyValue(key PrivacyKey) string {
	switch key {
	case PrivacyPhoneNumber, PrivacyBirthday:
		return PrivacyContacts
	default:
		return PrivacyEverybody
	}
}

// DefaultPrivacyRule — правило-дефолт для ключа (без исключений).
func DefaultPrivacyRule(key PrivacyKey) PrivacyRule {
	return PrivacyRule{Key: key, Value: DefaultPrivacyValue(key)}
}

// ValidPrivacyKey сообщает, известен ли ключ.
func ValidPrivacyKey(k PrivacyKey) bool {
	return slices.Contains(PrivacyKeys, k)
}

// ValidPrivacyValue проверяет значение для ключа: added_by_phone не допускает
// nobody (как в Telegram — по номеру всегда может найти хотя бы контакт).
func ValidPrivacyValue(key PrivacyKey, v string) bool {
	switch v {
	case PrivacyEverybody, PrivacyContacts:
		return true
	case PrivacyNobody:
		return key != PrivacyAddedByPhone
	}
	return false
}

// Allows решает, разрешает ли правило действие/видимость для viewer.
func (r PrivacyRule) Allows(viewerID int64, viewerIsContact bool) bool {
	if slices.Contains(r.DenyUserIDs, viewerID) {
		return false
	}
	if slices.Contains(r.AllowUserIDs, viewerID) {
		return true
	}
	switch r.Value {
	case PrivacyEverybody:
		return true
	case PrivacyContacts:
		return viewerIsContact
	default: // nobody
		return false
	}
}

// BlockedUser — строка чёрного списка (обогащена профилем для рендера ряда).
type BlockedUser struct {
	UserID      int64
	Username    string
	DisplayName string
	AvatarURL   string
	Phone       string
}

// UserProfile — карточка чужого профиля после применения privacy: скрытые поля
// пустые/nil. IsBlocked — заблокировал ли viewer этого пользователя (для кнопки
// «Разблокировать»); CallsAvailable — пройдёт ли call_request (tweb
// phone_calls_available); CanMessage — пройдёт ли отправка сообщения.
type UserProfile struct {
	ID             int64
	Username       *string
	FirstName      string
	LastName       string
	DisplayName    string
	Bio            string
	Birthday       *string // "DD.MM" или "DD.MM.YYYY"; nil когда скрыт/не задан
	AvatarURL      string
	Verified       bool
	Premium        bool   // Telegram Premium subscriber (gold star badge)
	EmojiStatus    string // unicode emoji shown after the name ("" when unset)
	IsBot          bool
	IsBlocked      bool
	CallsAvailable bool
	CanMessage     bool
	Phone          string // пустой, когда скрыт
	LastSeenOK     bool   // false — viewer не видит время захода (показывать «недавно»)
}
