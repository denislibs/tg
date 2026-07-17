// Package postgres holds the postgres-backed repository adapters. It is distinct
// from internal/store/postgres (the low-level pool/migration helpers).
package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
)

// userCols is the canonical user column list / scan order, shared by every
// query that returns a full domain.User.
const userCols = `id, phone, username, first_name, last_name, display_name, bio, birthday, avatar_url, phone_visibility`

// scanUser scans a row selected with userCols into a domain.User.
func scanUser(row pgx.Row) (domain.User, error) {
	var u domain.User
	err := row.Scan(&u.ID, &u.Phone, &u.Username, &u.FirstName, &u.LastName,
		&u.DisplayName, &u.Bio, &u.Birthday, &u.AvatarURL, &u.PhoneVisibility)
	return u, err
}

// isUniqueViolation reports whether err is a Postgres unique-constraint error.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

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
	return scanUser(r.pool.QueryRow(ctx,
		`INSERT INTO users (phone, display_name) VALUES ($1,$1)
		 ON CONFLICT (phone) DO UPDATE SET phone=EXCLUDED.phone
		 RETURNING `+userCols,
		phone))
}

// GetByID returns the full user record, or domain.ErrNotFound.
func (r *AuthRepo) GetByID(ctx context.Context, id int64) (domain.User, error) {
	u, err := scanUser(r.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.User{}, domain.ErrNotFound
	}
	return u, err
}

// UpdateProfile writes the editable profile fields and returns the fresh user.
// The caller is responsible for having computed display_name.
func (r *AuthRepo) UpdateProfile(ctx context.Context, id int64, first, last, bio string, birthday *time.Time, phoneVisibility string) (domain.User, error) {
	display := domain.BuildDisplayName(first, last)
	return scanUser(r.pool.QueryRow(ctx,
		`UPDATE users SET first_name=$2, last_name=$3, display_name=$4, bio=$5, birthday=$6, phone_visibility=$7
		 WHERE id=$1 RETURNING `+userCols,
		id, first, last, display, bio, birthday, phoneVisibility))
}

// UsernameAvailable reports whether a (normalized, CITEXT) username is free,
// ignoring the caller's own row.
func (r *AuthRepo) UsernameAvailable(ctx context.Context, username string, excludeID int64) (bool, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM users WHERE username=$1 AND id<>$2`, username, excludeID).Scan(&n)
	return n == 0, err
}

// SetUsername sets (or clears, when username is nil) the user's username,
// returning domain.ErrConflict on a uniqueness collision.
func (r *AuthRepo) SetUsername(ctx context.Context, id int64, username *string) (domain.User, error) {
	u, err := scanUser(r.pool.QueryRow(ctx,
		`UPDATE users SET username=$2 WHERE id=$1 RETURNING `+userCols, id, username))
	if isUniqueViolation(err) {
		return domain.User{}, domain.ErrConflict
	}
	return u, err
}

// SetAvatar writes the avatar URL (a /media/{id}/content path) and returns the user.
func (r *AuthRepo) SetAvatar(ctx context.Context, id int64, url string) (domain.User, error) {
	return scanUser(r.pool.QueryRow(ctx,
		`UPDATE users SET avatar_url=$2 WHERE id=$1 RETURNING `+userCols, id, url))
}

// --- DeviceRepo ---

// Create inserts a device row holding the token hash + sign-in metadata.
func (r *AuthRepo) Create(ctx context.Context, userID int64, name, platform, tokenHash, ip, location string) (domain.Device, error) {
	var d domain.Device
	err := r.pool.QueryRow(ctx,
		`INSERT INTO devices (user_id, name, platform, token_hash, ip, location)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 RETURNING id, user_id, name, platform, token_hash, ip, location`,
		userID, name, platform, tokenHash, ip, location).
		Scan(&d.ID, &d.UserID, &d.Name, &d.Platform, &d.TokenHash, &d.IP, &d.Location)
	return d, err
}

// SessionByTokenHash resolves a token hash to its user and device id, and
// lazily touches last_active. Returns domain.ErrNotFound if unknown.
func (r *AuthRepo) SessionByTokenHash(ctx context.Context, tokenHash string) (domain.User, int64, error) {
	var u domain.User
	var deviceID int64
	err := r.pool.QueryRow(ctx,
		`SELECT u.id, u.phone, u.username, u.first_name, u.last_name, u.display_name,
		        u.bio, u.birthday, u.avatar_url, u.phone_visibility, d.id
		 FROM users u JOIN devices d ON d.user_id=u.id WHERE d.token_hash=$1`,
		tokenHash).Scan(&u.ID, &u.Phone, &u.Username, &u.FirstName, &u.LastName, &u.DisplayName,
		&u.Bio, &u.Birthday, &u.AvatarURL, &u.PhoneVisibility, &deviceID)
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
		`SELECT id, user_id, name, platform, last_active, ip, location FROM devices
		 WHERE user_id=$1 ORDER BY last_active DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Device
	for rows.Next() {
		var d domain.Device
		if err := rows.Scan(&d.ID, &d.UserID, &d.Name, &d.Platform, &d.LastActive, &d.IP, &d.Location); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// DeleteOthers removes every device of the user except keepDeviceID, returning
// the removed rows so the caller can evict session caches and close sockets.
func (r *AuthRepo) DeleteOthers(ctx context.Context, userID, keepDeviceID int64) ([]domain.Device, error) {
	rows, err := r.pool.Query(ctx,
		`DELETE FROM devices WHERE user_id=$1 AND id<>$2 RETURNING id, token_hash`,
		userID, keepDeviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Device
	for rows.Next() {
		var d domain.Device
		if err := rows.Scan(&d.ID, &d.TokenHash); err != nil {
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

// --- Облачный пароль (2FA): usecase/auth.PasswordRepo ---

// Password возвращает bcrypt-хеш (nil = не установлен), подсказку и почту.
func (r *AuthRepo) Password(ctx context.Context, userID int64) (*string, string, string, error) {
	var hash *string
	var hint, email string
	err := r.pool.QueryRow(ctx,
		`SELECT password_hash, password_hint, recovery_email FROM users WHERE id=$1`, userID).
		Scan(&hash, &hint, &email)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", "", domain.ErrNotFound
	}
	return hash, hint, email, err
}

// SetPassword пишет хеш/подсказку/почту (hash=nil выключает пароль целиком).
func (r *AuthRepo) SetPassword(ctx context.Context, userID int64, hash *string, hint, email string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users SET password_hash=$2, password_hint=$3, recovery_email=$4 WHERE id=$1`,
		userID, hash, hint, email)
	return err
}

// SavePasswordToken сохраняет одноразовый токен шага пароля (вход с 2FA).
func (r *AuthRepo) SavePasswordToken(ctx context.Context, tokenHash string, userID int64, expires time.Time) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO password_login_tokens (token_hash, user_id, expires_at) VALUES ($1,$2,$3)
		 ON CONFLICT (token_hash) DO UPDATE SET user_id=$2, expires_at=$3`,
		tokenHash, userID, expires)
	return err
}

// PasswordTokenUser возвращает владельца живого токена (истёкшие не считаются).
func (r *AuthRepo) PasswordTokenUser(ctx context.Context, tokenHash string) (int64, error) {
	var userID int64
	err := r.pool.QueryRow(ctx,
		`SELECT user_id FROM password_login_tokens WHERE token_hash=$1 AND expires_at > now()`,
		tokenHash).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return userID, err
}

// DeletePasswordToken сжигает токен после успешного входа.
func (r *AuthRepo) DeletePasswordToken(ctx context.Context, tokenHash string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM password_login_tokens WHERE token_hash=$1`, tokenHash)
	return err
}
