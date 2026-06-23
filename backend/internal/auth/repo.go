package auth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type User struct {
	ID          int64
	Phone       string
	Username    *string
	DisplayName string
	AvatarURL   string
}

type Device struct {
	ID         int64
	UserID     int64
	Name       string
	Platform   string
	TokenHash  string
	LastActive time.Time
}

var ErrNotFound = errors.New("not found")

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

// SaveCode upserts a verification code for a phone with an expiry.
func (r *Repo) SaveCode(ctx context.Context, phone, code string, expires time.Time) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO auth_codes (phone, code, expires_at) VALUES ($1,$2,$3)
		 ON CONFLICT (phone) DO UPDATE SET code=$2, expires_at=$3`,
		phone, code, expires)
	return err
}

// GetCode returns the stored code for a phone if not expired.
func (r *Repo) GetCode(ctx context.Context, phone string) (string, error) {
	var code string
	var expires time.Time
	err := r.pool.QueryRow(ctx,
		`SELECT code, expires_at FROM auth_codes WHERE phone=$1`, phone).Scan(&code, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if time.Now().After(expires) {
		return "", ErrNotFound
	}
	return code, nil
}

// DeleteCode removes a used code.
func (r *Repo) DeleteCode(ctx context.Context, phone string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM auth_codes WHERE phone=$1`, phone)
	return err
}

// UpsertUserByPhone returns the existing user for a phone or creates one.
func (r *Repo) UpsertUserByPhone(ctx context.Context, phone string) (User, error) {
	var u User
	err := r.pool.QueryRow(ctx,
		`INSERT INTO users (phone, display_name) VALUES ($1,$1)
		 ON CONFLICT (phone) DO UPDATE SET phone=EXCLUDED.phone
		 RETURNING id, phone, username, display_name, avatar_url`,
		phone).Scan(&u.ID, &u.Phone, &u.Username, &u.DisplayName, &u.AvatarURL)
	return u, err
}

// CreateDevice inserts a device row holding the token hash.
func (r *Repo) CreateDevice(ctx context.Context, userID int64, name, platform, tokenHash string) (Device, error) {
	var d Device
	err := r.pool.QueryRow(ctx,
		`INSERT INTO devices (user_id, name, platform, token_hash)
		 VALUES ($1,$2,$3,$4)
		 RETURNING id, user_id, name, platform, token_hash`,
		userID, name, platform, tokenHash).Scan(&d.ID, &d.UserID, &d.Name, &d.Platform, &d.TokenHash)
	return d, err
}

// UserByTokenHash resolves a session token hash to a user, touching last_active.
func (r *Repo) UserByTokenHash(ctx context.Context, tokenHash string) (User, error) {
	var u User
	err := r.pool.QueryRow(ctx,
		`UPDATE devices SET last_active=now() WHERE token_hash=$1
		 RETURNING user_id`, tokenHash).Scan(new(int64))
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, err
	}
	err = r.pool.QueryRow(ctx,
		`SELECT u.id, u.phone, u.username, u.display_name, u.avatar_url
		 FROM users u JOIN devices d ON d.user_id=u.id WHERE d.token_hash=$1`,
		tokenHash).Scan(&u.ID, &u.Phone, &u.Username, &u.DisplayName, &u.AvatarURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

// SessionByTokenHash resolves a token hash to its user and device id, and
// lazily touches last_active. Returns ErrNotFound if unknown.
func (r *Repo) SessionByTokenHash(ctx context.Context, tokenHash string) (User, int64, error) {
	var u User
	var deviceID int64
	err := r.pool.QueryRow(ctx,
		`SELECT u.id, u.phone, u.username, u.display_name, u.avatar_url, d.id
		 FROM users u JOIN devices d ON d.user_id=u.id WHERE d.token_hash=$1`,
		tokenHash).Scan(&u.ID, &u.Phone, &u.Username, &u.DisplayName, &u.AvatarURL, &deviceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, 0, ErrNotFound
	}
	if err != nil {
		return User{}, 0, err
	}
	_, _ = r.pool.Exec(ctx, `UPDATE devices SET last_active=now() WHERE id=$1`, deviceID)
	return u, deviceID, nil
}

// ListDevices returns a user's devices, most recently active first.
func (r *Repo) ListDevices(ctx context.Context, userID int64) ([]Device, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, name, platform, last_active FROM devices
		 WHERE user_id=$1 ORDER BY last_active DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Device
	for rows.Next() {
		var d Device
		if err := rows.Scan(&d.ID, &d.UserID, &d.Name, &d.Platform, &d.LastActive); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// DeleteDevice removes a user's device by id and returns its token hash (so the
// caller can evict the cache). found is false if no such device exists.
func (r *Repo) DeleteDevice(ctx context.Context, userID, deviceID int64) (tokenHash string, found bool, err error) {
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
