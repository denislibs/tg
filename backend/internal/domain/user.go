// Package domain holds the core entities, value objects, and errors. It has no
// dependency on any framework or infrastructure.
package domain

import (
	"errors"
	"regexp"
	"strings"
	"time"
)

// UserRecord — СТРОКА таблицы users, а не объект провода. На провод уходят
// конструкторы схемы: краткий `user` (UserReal) и полный `userFull` — их
// собирают ToUser/ToUserFull. Раздваивать эти две роли обязательно: строка
// знает всё сразу (и bio, и телефон, и превью аватарки), а витрина решает,
// что из этого видит КОНКРЕТНЫЙ зритель.
//
// Чего здесь больше нет и почему:
//   - DisplayName — денормализация «First Last». Имя собирается на клиенте из
//     first_name/last_name (tweb PeerTitle), поэтому на проводе его нет вовсе;
//     колонка display_name остаётся ПОИСКОВОЙ (ILIKE) и пересчитывается прямо
//     в SQL при записи;
//   - AvatarURL/AvatarPreview → PhotoID/PhotoPreview: аватарка адресуется id
//     медиа, ровно тем числом, которого ждёт клиентский downloadMediaURL.
//     Строка «/media/N/content» больше не строится, чтобы потом выпарсивать из
//     неё то же N обратно;
//   - PhoneVisibility — это ПРАВИЛО ПРИВАТНОСТИ (PrivacyPhoneNumber), а не
//     свойство пользователя (решение №5 разбора). Двух независимых механизмов
//     на один вопрос больше нет.
type UserRecord struct {
	ID        int64
	Phone     string
	Username  *string
	FirstName string
	LastName  string
	Bio       string
	Birthday  *time.Time // nil when unset; year may be the no-year sentinel
	// PhotoID — media id текущей аватарки; nil — аватарки нет (клиент рисует
	// градиент по id). PhotoPreview — stripped-превью (формат — см.
	// domain.Media.BlurPreview); nil у аватарок, поставленных до появления
	// генерации превью.
	PhotoID      *int64
	PhotoPreview []byte
	// IsPremium — подписчик Telegram Premium (золотая звезда у имени),
	// IsVerified — официальный аккаунт (синяя галочка), IsBot — бот,
	// Deleted — аккаунт удалён (анонимизирован).
	IsPremium   bool
	IsVerified  bool
	IsBot       bool
	Deleted     bool
	EmojiStatus string
	// AutoDeletePeriod — глобальный период автоудаления пользователя в секундах
	// (users.auto_delete_period, Telegram messages.setDefaultHistoryTTL): им
	// заводятся новые чаты. 0 — выключено.
	AutoDeletePeriod int
}

// ToUser собирает КРАТКУЮ форму — конструктор `user` схемы. Флаги и статус
// зависят от зрителя (self/contact/mutual_contact, видимость last seen),
// поэтому приходят параметрами: строка таблицы их не знает.
//
// Аватарка гасится не здесь: витрина, которой правило profile_photo не даёт
// показать фото, передаёт showPhoto=false — и тогда едет userProfilePhotoEmpty,
// то есть «фото нет» как СОСТОЯНИЕ, а не пустая строка.
func (u UserRecord) ToUser(f UserFlags, status UserStatus, showPhoto bool) UserReal {
	f.Deleted = f.Deleted || u.Deleted
	f.Bot = f.Bot || u.IsBot
	f.Verified = f.Verified || u.IsVerified
	f.Premium = f.Premium || u.IsPremium
	out := NewUser(u.ID, f)
	out.FirstName = u.FirstName
	out.LastName = u.LastName
	if u.Username != nil {
		out.Username = *u.Username
	}
	out.EmojiStatus = u.EmojiStatus
	out.Status = status
	out.Photo = u.ProfilePhoto(showPhoto)
	return out
}

// ProfilePhoto — объединение UserProfilePhoto для этой строки. show=false —
// правило приватности не пускает зрителя к фото: едет userProfilePhotoEmpty.
func (u UserRecord) ProfilePhoto(show bool) UserProfilePhoto {
	if !show || u.PhotoID == nil {
		return NewUserProfilePhotoEmpty()
	}
	return NewUserProfilePhoto(*u.PhotoID, u.PhotoPreview, false, false)
}

// MaxEmojiStatusRunes bounds a stored emoji status. It's a short unicode string
// (a single emoji, possibly with ZWJ/skin-tone modifiers), not free text.
const MaxEmojiStatusRunes = 16

// ProfilePhoto is one entry of a user's profile-photo gallery (Telegram
// getUserPhotos). The newest photo is the user's current avatar, denormalized
// into UserRecord.PhotoID. VideoMediaID is an optional video-avatar variant.
type ProfilePhoto struct {
	ID           int64
	UserID       int64
	MediaID      int64
	VideoMediaID *int64
	CreatedAt    time.Time
}

// ServiceUserID is the reserved id of the official "Telegram" service account
// that delivers system notifications (login alerts, etc.). Seeded by migration.
const ServiceUserID int64 = 777000

// BirthdayNoYear is the sentinel year stored when a user provides a birthday
// without a year (Telegram allows this). It's a leap year so Feb 29 is valid;
// the birthday constructor omits `year` for dates carrying this sentinel.
const BirthdayNoYear = 4

var (
	usernameRe        = regexp.MustCompile(`^[a-z0-9_]{5,32}$`)
	ErrUsernameFormat = errors.New("username must be 5-32 chars of a-z, 0-9, _")
)

// NormalizeUsername lowercases and trims a username for storage/comparison.
func NormalizeUsername(s string) string {
	return strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(s), "@")))
}

// ValidateUsername checks a normalized username against the allowed format.
func ValidateUsername(s string) error {
	if !usernameRe.MatchString(s) {
		return ErrUsernameFormat
	}
	return nil
}

type Device struct {
	ID         int64
	UserID     int64
	Name       string
	Platform   string
	TokenHash  string
	LastActive time.Time
	IP         string // sign-in IP (best effort)
	Location   string // human place from GeoIP, when available
}

// Session is a resolved auth context (cached): who, on which device.
type Session struct {
	User     UserRecord
	DeviceID int64
}
