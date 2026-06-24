// Package auth is the authentication application logic (interactor + ports).
package auth

import (
	"context"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type UserRepo interface {
	UpsertByPhone(ctx context.Context, phone string) (domain.User, error)
}

type DeviceRepo interface {
	Create(ctx context.Context, userID int64, name, platform, tokenHash string) (domain.Device, error)
	SessionByTokenHash(ctx context.Context, tokenHash string) (domain.User, int64, error)
	ListByUser(ctx context.Context, userID int64) ([]domain.Device, error)
	Delete(ctx context.Context, userID, deviceID int64) (tokenHash string, found bool, err error)
}

// CodeRepo uses *Code-suffixed method names so a single adapter struct can also
// satisfy DeviceRepo (which has its own Delete with a different signature).
type CodeRepo interface {
	SaveCode(ctx context.Context, phone, code string, expires time.Time) error
	GetCode(ctx context.Context, phone string) (string, error) // domain.ErrNotFound if absent/expired
	DeleteCode(ctx context.Context, phone string) error
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
