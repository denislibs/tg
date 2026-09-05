// Package auth is the authentication application logic (interactor + ports).
package auth

import (
	"context"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type UserRepo interface {
	// ByPhone возвращает пользователя с этим номером или domain.ErrNotFound —
	// незнакомый номер НЕ создаётся молча (вход отправляет клиента на шаг
	// регистрации, Telegram auth.authorizationSignUpRequired).
	ByPhone(ctx context.Context, phone string) (domain.UserRecord, error)
	// CreateWithName заводит пользователя с подтверждённым номером и именем
	// (шаг auth.signUp). domain.ErrConflict, если номер заняли параллельно.
	CreateWithName(ctx context.Context, phone, first, last string) (domain.UserRecord, error)
	GetByID(ctx context.Context, id int64) (domain.UserRecord, error)
	UpdateProfile(ctx context.Context, id int64, first, last, bio string, birthday *time.Time) (domain.UserRecord, error)
	UsernameAvailable(ctx context.Context, username string, excludeID int64) (bool, error)
	SetUsername(ctx context.Context, id int64, username *string) (domain.UserRecord, error) // domain.ErrConflict if taken
	// PhoneInUse reports whether phone already belongs to another (non-excluded)
	// account. Used before starting a phone-number change.
	PhoneInUse(ctx context.Context, phone string, excludeID int64) (bool, error)
	// UpdatePhone changes the user's phone number, returning domain.ErrConflict if
	// the number was taken by someone else in the meantime (unique constraint).
	UpdatePhone(ctx context.Context, id int64, phone string) (domain.UserRecord, error)
	// SoftDelete anonymizes the account (Telegram "Delete my account"): the phone
	// is freed, personal fields are cleared and deleted_at is stamped. Message
	// history is preserved and shown as coming from a "Deleted Account".
	SoftDelete(ctx context.Context, id int64) error
	// SetEmojiStatus writes the user's emoji status ("" clears it).
	SetEmojiStatus(ctx context.Context, id int64, emoji string) (domain.UserRecord, error)
	// SetPremium flips the Telegram Premium flag.
	SetPremium(ctx context.Context, id int64, premium bool) (domain.UserRecord, error)
	// AddProfilePhoto inserts a gallery photo and, in the same transaction,
	// promotes it to the user's current avatar (users.avatar_media_id +
	// users.avatar_preview). preview — stripped-превью аватарки (nil, если
	// сгенерировать не удалось — колонка останется NULL).
	AddProfilePhoto(ctx context.Context, userID, mediaID int64, videoMediaID *int64, preview []byte) (domain.ProfilePhoto, error)
	// ListProfilePhotos returns the user's gallery, newest first.
	ListProfilePhotos(ctx context.Context, userID int64) ([]domain.ProfilePhoto, error)
	// DeleteProfilePhoto removes a photo owned by userID, addressed by MEDIA id
	// (то же число, что уходит наружу списком — profile_photos.id снаружи не
	// виден). Если это была текущая аватарка, она пересчитывается на
	// следующее по свежести фото (или снимается). Возвращает id медиа новой
	// аватарки (nil — аватарки не осталось). domain.ErrNotFound, если
	// чужого/несуществующего media id не нашлось.
	DeleteProfilePhoto(ctx context.Context, userID, mediaID int64) (newAvatarMediaID *int64, err error)
}

// AvatarPreviewer возвращает stripped-превью загруженного медиа (крошечный JPEG
// ~40px), генерируя и сохраняя его по требованию, если фоновая обработка ещё не
// успела. Реализуется media usecase. Optional — без него avatar_preview остаётся
// NULL (клиент фолбэкает на градиент).
type AvatarPreviewer interface {
	StrippedPreview(ctx context.Context, mediaID int64) ([]byte, error)
}

// PremiumRepo persists Telegram Premium subscriptions (clone: mock checkout).
type PremiumRepo interface {
	// GetPremiumSubscription returns the user's subscription, or domain.ErrNotFound
	// when they never subscribed.
	GetPremiumSubscription(ctx context.Context, userID int64) (domain.PremiumSubscription, error)
	// UpsertPremiumSubscription creates or replaces the user's subscription row
	// (single row per user, keyed by user_id) and returns the stored value.
	UpsertPremiumSubscription(ctx context.Context, sub domain.PremiumSubscription) (domain.PremiumSubscription, error)
	// SetPremiumAutoRenew toggles auto-renew on the user's existing subscription,
	// returning domain.ErrNotFound when there is none.
	SetPremiumAutoRenew(ctx context.Context, userID int64, autoRenew bool) (domain.PremiumSubscription, error)
}

type DeviceRepo interface {
	Create(ctx context.Context, d domain.Device) (domain.Device, error)
	// SessionByTokenHash разрешает токен в пару юзер+устройство и попутно
	// отмечает активность. appVersion — версия сборки, которой клиент назвался
	// В ЭТОМ запросе: пустая означает «не назвался», прежнюю она не затирает.
	SessionByTokenHash(ctx context.Context, tokenHash, appVersion string) (domain.UserRecord, int64, error)
	ListByUser(ctx context.Context, userID int64) ([]domain.Device, error)
	Delete(ctx context.Context, userID, deviceID int64) (tokenHash string, found bool, err error)
	// DeleteOthers removes every device of the user except keepDeviceID and
	// returns the removed rows (ids + token hashes, for cache/WS eviction).
	DeleteOthers(ctx context.Context, userID, keepDeviceID int64) ([]domain.Device, error)
	// DeleteAll removes every device of the user and returns the removed rows
	// (ids + token hashes), so the caller can evict caches and close sockets. Used
	// on account deletion to revoke all sessions at once.
	DeleteAll(ctx context.Context, userID int64) ([]domain.Device, error)
}

// CodeRepo uses *Code-suffixed method names so a single adapter struct can also
// satisfy DeviceRepo (which has its own Delete with a different signature).
type CodeRepo interface {
	SaveCode(ctx context.Context, phone, code string, expires time.Time) error
	GetCode(ctx context.Context, phone string) (string, error) // domain.ErrNotFound if absent/expired
	DeleteCode(ctx context.Context, phone string) error
}

// PasswordRepo хранит облачный пароль (2FA) и одноразовые токены шага пароля.
type PasswordRepo interface {
	// Password возвращает bcrypt-хеш (nil = пароль не установлен), подсказку и
	// почту восстановления.
	Password(ctx context.Context, userID int64) (hash *string, hint, email string, err error)
	SetPassword(ctx context.Context, userID int64, hash *string, hint, email string) error
	SavePasswordToken(ctx context.Context, tokenHash string, userID int64, expires time.Time) error
	PasswordTokenUser(ctx context.Context, tokenHash string) (int64, error) // domain.ErrNotFound если нет/истёк
	DeletePasswordToken(ctx context.Context, tokenHash string) error
}

// SignUpTokenStore — одноразовые токены шага регистрации: номер уже подтверждён
// кодом, но пользователя ещё нет. Хранится только хеш токена (как у
// password_login_tokens), сырой токен живёт только у клиента.
type SignUpTokenStore interface {
	SaveSignUpToken(ctx context.Context, tokenHash, phone string, expires time.Time) error
	SignUpTokenPhone(ctx context.Context, tokenHash string) (string, error) // domain.ErrNotFound если нет/истёк
	DeleteSignUpToken(ctx context.Context, tokenHash string) error
}

// PasswordRecoveryStore — коды сброса облачного пароля по почте. Ключ —
// хеш того же password_token, что выдал SignIn: восстановление привязано к
// уже пройденному шагу OTP. Код хранится хешем, nextSendAt — серверный таймер
// повторной отправки.
type PasswordRecoveryStore interface {
	SaveRecoveryCode(ctx context.Context, tokenHash string, userID int64, codeHash string, expires, nextSendAt time.Time) error
	// RecoveryCode возвращает живую запись; domain.ErrNotFound если нет/истекла.
	RecoveryCode(ctx context.Context, tokenHash string) (userID int64, codeHash string, nextSendAt time.Time, err error)
	DeleteRecoveryCode(ctx context.Context, tokenHash string) error
}

// WebAuthTokenStore — одноразовые веб-токены входа (#?tgWebAuthToken=…,
// Telegram auth.importWebTokenAuthorization). Тот же приём, что у QR-логина:
// ключ — хеш токена, запись живёт TTL и сгорает при обмене.
type WebAuthTokenStore interface {
	SaveWebAuthToken(ctx context.Context, tokenHash string, userID int64, expires time.Time) error
	WebAuthTokenUser(ctx context.Context, tokenHash string) (int64, error) // domain.ErrNotFound если нет/истёк
	DeleteWebAuthToken(ctx context.Context, tokenHash string) error
}

// AccountResetStore — отложенные сбросы аккаунта: одна запись на пользователя.
// Сброс планируется первым вызовом ручки, исполняется повторным (когда окно
// истекло) и отменяется входом владельца.
type AccountResetStore interface {
	// ScheduleAccountReset заводит (или перезаписывает) отложенный сброс.
	ScheduleAccountReset(ctx context.Context, userID int64, requestedAt, deleteAt time.Time) error
	// AccountReset возвращает запланированный сброс: срок исполнения и момент
	// отмены владельцем (нулевое время — не отменён). domain.ErrNotFound, если
	// сброса не заказывали.
	AccountReset(ctx context.Context, userID int64) (deleteAt, cancelledAt time.Time, err error)
	// CancelAccountReset помечает ЖДУЩИЙ сброс отменённым; cancelled=false, если
	// отменять было нечего (сброса нет или он уже отменён — отметку не двигаем,
	// иначе карантин продлевался бы каждым входом).
	CancelAccountReset(ctx context.Context, userID int64, at time.Time) (cancelled bool, err error)
	// DeleteAccountReset убирает запись после исполнения сброса.
	DeleteAccountReset(ctx context.Context, userID int64) error
}

// LoginStepRepo — единая точка подключения хранилищ артефактов входа
// (регистрация, восстановление пароля, веб-токен, отложенный сброс аккаунта).
// Реализуется тем же postgres-адаптером, что и остальные auth-порты.
type LoginStepRepo interface {
	SignUpTokenStore
	PasswordRecoveryStore
	WebAuthTokenStore
	AccountResetStore
}

// Mailer доставляет письмо с кодом восстановления облачного пароля. Порт
// опционален: без него код совпадает с dev-OTP (DEV_OTP_CODE) — ровно как код
// входа по SMS на стенде. Реальная доставка подключается адаптером через
// SetMailer.
type Mailer interface {
	SendRecoveryCode(ctx context.Context, email, code string) error
}

type SessionCache interface {
	GetSession(ctx context.Context, tokenHash string) (*domain.Session, error) // (nil,nil) on miss
	SetSession(ctx context.Context, tokenHash string, s domain.Session, ttl time.Duration) error
	DelSession(ctx context.Context, tokenHash string) error
}

type RevocationNotifier interface {
	NotifyRevoked(ctx context.Context, deviceID int64) error
}

const SessionCacheTTL = 30 * time.Minute

// QRStore persists ephemeral QR-login records keyed by the token hash.
type QRStore interface {
	Put(ctx context.Context, tokenHash string, rec domain.QRLogin, ttl time.Duration) error
	Get(ctx context.Context, tokenHash string) (domain.QRLogin, error) // domain.ErrNotFound when absent/expired
	Delete(ctx context.Context, tokenHash string) error
}

const QRLoginTTL = 60 * time.Second
