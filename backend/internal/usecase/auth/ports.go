// Package auth is the authentication application logic (interactor + ports).
package auth

import (
	"context"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type UserRepo interface {
	UpsertByPhone(ctx context.Context, phone string) (domain.User, error)
	GetByID(ctx context.Context, id int64) (domain.User, error)
	UpdateProfile(ctx context.Context, id int64, first, last, bio string, birthday *time.Time, phoneVisibility string) (domain.User, error)
	UsernameAvailable(ctx context.Context, username string, excludeID int64) (bool, error)
	SetUsername(ctx context.Context, id int64, username *string) (domain.User, error) // domain.ErrConflict if taken
	SetAvatar(ctx context.Context, id int64, url string) (domain.User, error)
}

type DeviceRepo interface {
	Create(ctx context.Context, userID int64, name, platform, tokenHash, ip, location string) (domain.Device, error)
	SessionByTokenHash(ctx context.Context, tokenHash string) (domain.User, int64, error)
	ListByUser(ctx context.Context, userID int64) ([]domain.Device, error)
	Delete(ctx context.Context, userID, deviceID int64) (tokenHash string, found bool, err error)
	// DeleteOthers removes every device of the user except keepDeviceID and
	// returns the removed rows (ids + token hashes, for cache/WS eviction).
	DeleteOthers(ctx context.Context, userID, keepDeviceID int64) ([]domain.Device, error)
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
