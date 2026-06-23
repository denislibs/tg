// Package postgres holds the postgres-backed repository adapters. It is distinct
// from internal/store/postgres (the low-level pool/migration helpers).
package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
)

// AuthRepo is a postgres-backed adapter implementing the auth usecase's
// UserRepo, DeviceRepo and CodeRepo ports.
type AuthRepo struct{ pool *pgxpool.Pool }

var (
	_ usecaseauth.UserRepo   = (*AuthRepo)(nil)
	_ usecaseauth.DeviceRepo = (*AuthRepo)(nil)
	_ usecaseauth.CodeRepo   = (*AuthRepo)(nil)
)

func NewAuthRepo(pool *pgxpool.Pool) *AuthRepo { return &AuthRepo{pool: pool} }

// --- CodeRepo ---

// SaveCode upserts a verification code for a phone with an expiry.
func (r *AuthRepo) SaveCode(ctx context.Context, phone, code string, expires time.Time) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO auth_codes (phone, code, expires_at) VALUES ($1,$2,$3)
		 ON CONFLICT (phone) DO UPDATE SET code=$2, expires_at=$3`,
		phone, code, expires)
	return err
}

// GetCode returns the stored code for a phone if not expired, else domain.ErrNotFound.
func (r *AuthRepo) GetCode(ctx context.Context, phone string) (string, error) {
	var code string
	var expires time.Time
	err := r.pool.QueryRow(ctx,
		`SELECT code, expires_at FROM auth_codes WHERE phone=$1`, phone).Scan(&code, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if time.Now().After(expires) {
		return "", domain.ErrNotFound
	}
	return code, nil
}

// DeleteCode removes a used code.
func (r *AuthRepo) DeleteCode(ctx context.Context, phone string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM auth_codes WHERE phone=$1`, phone)
	return err
}

// --- UserRepo ---

// UpsertByPhone returns the existing user for a phone or creates one.
func (r *AuthRepo) UpsertByPhone(ctx context.Context, phone string) (domain.User, error) {
	var u domain.User
	err := r.pool.QueryRow(ctx,
		`INSERT INTO users (phone, display_name) VALUES ($1,$1)
		 ON CONFLICT (phone) DO UPDATE SET phone=EXCLUDED.phone
		 RETURNING id, phone, username, display_name, avatar_url`,
		phone).Scan(&u.ID, &u.Phone, &u.Username, &u.DisplayName, &u.AvatarURL)
	return u, err
}

// --- DeviceRepo ---

// Create inserts a device row holding the token hash.
func (r *AuthRepo) Create(ctx context.Context, userID int64, name, platform, tokenHash string) (domain.Device, error) {
	var d domain.Device
	err := r.pool.QueryRow(ctx,
		`INSERT INTO devices (user_id, name, platform, token_hash)
		 VALUES ($1,$2,$3,$4)
		 RETURNING id, user_id, name, platform, token_hash`,
		userID, name, platform, tokenHash).Scan(&d.ID, &d.UserID, &d.Name, &d.Platform, &d.TokenHash)
	return d, err
}

// SessionByTokenHash resolves a token hash to its user and device id, and
// lazily touches last_active. Returns domain.ErrNotFound if unknown.
func (r *AuthRepo) SessionByTokenHash(ctx context.Context, tokenHash string) (domain.User, int64, error) {
	var u domain.User
	var deviceID int64
	err := r.pool.QueryRow(ctx,
		`SELECT u.id, u.phone, u.username, u.display_name, u.avatar_url, d.id
		 FROM users u JOIN devices d ON d.user_id=u.id WHERE d.token_hash=$1`,
		tokenHash).Scan(&u.ID, &u.Phone, &u.Username, &u.DisplayName, &u.AvatarURL, &deviceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.User{}, 0, domain.ErrNotFound
	}
	if err != nil {
		return domain.User{}, 0, err
	}
	_, _ = r.pool.Exec(ctx, `UPDATE devices SET last_active=now() WHERE id=$1`, deviceID)
	return u, deviceID, nil
}

// ListByUser returns a user's devices, most recently active first.
func (r *AuthRepo) ListByUser(ctx context.Context, userID int64) ([]domain.Device, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, name, platform, last_active FROM devices
		 WHERE user_id=$1 ORDER BY last_active DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Device
	for rows.Next() {
		var d domain.Device
		if err := rows.Scan(&d.ID, &d.UserID, &d.Name, &d.Platform, &d.LastActive); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// Delete removes a user's device by id and returns its token hash (so the
// caller can evict the cache). found is false if no such device exists.
func (r *AuthRepo) Delete(ctx context.Context, userID, deviceID int64) (tokenHash string, found bool, err error) {
	err = r.pool.QueryRow(ctx,
		`DELETE FROM devices WHERE id=$1 AND user_id=$2 RETURNING token_hash`,
		deviceID, userID).Scan(&tokenHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return tokenHash, true, nil
}
