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
const userCols = `id, phone, username, first_name, last_name, display_name, bio, birthday, avatar_url, phone_visibility, is_premium, emoji_status`

// scanUser scans a row selected with userCols into a domain.User. Phone is
// nullable (freed on account deletion), so it is scanned via a pointer and left
// empty for a soft-deleted "Deleted Account".
func scanUser(row pgx.Row) (domain.User, error) {
	var u domain.User
	var phone *string
	err := row.Scan(&u.ID, &phone, &u.Username, &u.FirstName, &u.LastName,
		&u.DisplayName, &u.Bio, &u.Birthday, &u.AvatarURL, &u.PhoneVisibility,
		&u.IsPremium, &u.EmojiStatus)
	if phone != nil {
		u.Phone = *phone
	}
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

// PhoneInUse reports whether phone already belongs to another (non-excluded)
// account. Soft-deleted users hold a NULL phone and never match.
func (r *AuthRepo) PhoneInUse(ctx context.Context, phone string, excludeID int64) (bool, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM users WHERE phone=$1 AND id<>$2`, phone, excludeID).Scan(&n)
	return n > 0, err
}

// UpdatePhone changes the user's phone number, mapping a uniqueness collision to
// domain.ErrConflict (the atomic re-check against a concurrent claim).
func (r *AuthRepo) UpdatePhone(ctx context.Context, id int64, phone string) (domain.User, error) {
	u, err := scanUser(r.pool.QueryRow(ctx,
		`UPDATE users SET phone=$2 WHERE id=$1 RETURNING `+userCols, id, phone))
	if isUniqueViolation(err) {
		return domain.User{}, domain.ErrConflict
	}
	return u, err
}

// SoftDelete anonymizes the account: the phone is freed (NULL), the username is
// cleared, personal fields are reset to the "Deleted Account" placeholder and
// deleted_at is stamped. The cloud password (2FA) is also cleared. Message rows
// are untouched.
func (r *AuthRepo) SoftDelete(ctx context.Context, id int64) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users SET phone=NULL, username=NULL,
		        first_name='Deleted', last_name='Account', display_name='Deleted Account',
		        bio='', avatar_url='', emoji_status='',
		        password_hash=NULL, password_hint='', recovery_email='',
		        deleted_at=now()
		 WHERE id=$1`, id)
	return err
}

// SetAvatar writes the avatar URL (a /media/{id}/content path) and returns the user.
func (r *AuthRepo) SetAvatar(ctx context.Context, id int64, url string) (domain.User, error) {
	return scanUser(r.pool.QueryRow(ctx,
		`UPDATE users SET avatar_url=$2 WHERE id=$1 RETURNING `+userCols, id, url))
}

// SetEmojiStatus writes the user's emoji status ("" clears it) and returns the user.
func (r *AuthRepo) SetEmojiStatus(ctx context.Context, id int64, emoji string) (domain.User, error) {
	return scanUser(r.pool.QueryRow(ctx,
		`UPDATE users SET emoji_status=$2 WHERE id=$1 RETURNING `+userCols, id, emoji))
}

// SetPremium flips the Telegram Premium flag and returns the fresh user.
func (r *AuthRepo) SetPremium(ctx context.Context, id int64, premium bool) (domain.User, error) {
	return scanUser(r.pool.QueryRow(ctx,
		`UPDATE users SET is_premium=$2 WHERE id=$1 RETURNING `+userCols, id, premium))
}

// --- Telegram Premium subscription (mock checkout) ---

const premiumSubCols = `user_id, plan, price_cents, started_at, expires_at, auto_renew`

func scanPremiumSub(row pgx.Row) (domain.PremiumSubscription, error) {
	var s domain.PremiumSubscription
	err := row.Scan(&s.UserID, &s.Plan, &s.PriceCents, &s.StartedAt, &s.ExpiresAt, &s.AutoRenew)
	return s, err
}

// GetPremiumSubscription returns the user's subscription, or domain.ErrNotFound.
func (r *AuthRepo) GetPremiumSubscription(ctx context.Context, userID int64) (domain.PremiumSubscription, error) {
	s, err := scanPremiumSub(r.pool.QueryRow(ctx,
		`SELECT `+premiumSubCols+` FROM premium_subscriptions WHERE user_id=$1`, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.PremiumSubscription{}, domain.ErrNotFound
	}
	return s, err
}

// UpsertPremiumSubscription creates or replaces the user's single subscription row.
func (r *AuthRepo) UpsertPremiumSubscription(ctx context.Context, sub domain.PremiumSubscription) (domain.PremiumSubscription, error) {
	return scanPremiumSub(r.pool.QueryRow(ctx,
		`INSERT INTO premium_subscriptions (`+premiumSubCols+`)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (user_id) DO UPDATE
		   SET plan=EXCLUDED.plan, price_cents=EXCLUDED.price_cents,
		       started_at=EXCLUDED.started_at, expires_at=EXCLUDED.expires_at,
		       auto_renew=EXCLUDED.auto_renew
		 RETURNING `+premiumSubCols,
		sub.UserID, sub.Plan, sub.PriceCents, sub.StartedAt, sub.ExpiresAt, sub.AutoRenew))
}

// SetPremiumAutoRenew toggles auto-renew, returning domain.ErrNotFound when absent.
func (r *AuthRepo) SetPremiumAutoRenew(ctx context.Context, userID int64, autoRenew bool) (domain.PremiumSubscription, error) {
	s, err := scanPremiumSub(r.pool.QueryRow(ctx,
		`UPDATE premium_subscriptions SET auto_renew=$2 WHERE user_id=$1 RETURNING `+premiumSubCols,
		userID, autoRenew))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.PremiumSubscription{}, domain.ErrNotFound
	}
	return s, err
}

// --- Profile-photo gallery (Telegram getUserPhotos) ---

// AddProfilePhoto inserts a gallery photo and promotes it to the user's current
// avatar (users.avatar_url) in one transaction, so the denormalized avatar and
// the gallery never diverge.
func (r *AuthRepo) AddProfilePhoto(ctx context.Context, userID int64, url, videoURL string) (domain.ProfilePhoto, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return domain.ProfilePhoto{}, err
	}
	defer tx.Rollback(ctx)

	var video *string
	if videoURL != "" {
		video = &videoURL
	}
	p := domain.ProfilePhoto{UserID: userID, URL: url, VideoURL: videoURL}
	if err := tx.QueryRow(ctx,
		`INSERT INTO profile_photos (user_id, url, video_url) VALUES ($1,$2,$3)
		 RETURNING id, created_at`, userID, url, video).Scan(&p.ID, &p.CreatedAt); err != nil {
		return domain.ProfilePhoto{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET avatar_url=$2 WHERE id=$1`, userID, url); err != nil {
		return domain.ProfilePhoto{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.ProfilePhoto{}, err
	}
	return p, nil
}

// ListProfilePhotos returns a user's gallery, newest first.
func (r *AuthRepo) ListProfilePhotos(ctx context.Context, userID int64) ([]domain.ProfilePhoto, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, url, video_url, created_at FROM profile_photos
		 WHERE user_id=$1 ORDER BY created_at DESC, id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ProfilePhoto
	for rows.Next() {
		var p domain.ProfilePhoto
		var video *string
		if err := rows.Scan(&p.ID, &p.UserID, &p.URL, &video, &p.CreatedAt); err != nil {
			return nil, err
		}
		if video != nil {
			p.VideoURL = *video
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// DeleteProfilePhoto removes a photo owned by userID. If the deleted photo was
// the current avatar, avatar_url is recomputed to the next most-recent photo (or
// "") — all in one transaction. Returns the resulting avatar_url. Deleting an
// unknown/other-user photo is a no-op that returns the unchanged avatar_url.
func (r *AuthRepo) DeleteProfilePhoto(ctx context.Context, userID, photoID int64) (string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var deletedURL string
	err = tx.QueryRow(ctx,
		`DELETE FROM profile_photos WHERE id=$1 AND user_id=$2 RETURNING url`,
		photoID, userID).Scan(&deletedURL)
	if errors.Is(err, pgx.ErrNoRows) {
		// Nothing deleted; report the current avatar unchanged.
		var cur string
		if err := tx.QueryRow(ctx, `SELECT avatar_url FROM users WHERE id=$1`, userID).Scan(&cur); err != nil {
			return "", err
		}
		if err := tx.Commit(ctx); err != nil {
			return "", err
		}
		return cur, nil
	}
	if err != nil {
		return "", err
	}

	var cur string
	if err := tx.QueryRow(ctx, `SELECT avatar_url FROM users WHERE id=$1`, userID).Scan(&cur); err != nil {
		return "", err
	}
	newURL := cur
	if cur == deletedURL {
		// Fall back to the next most-recent remaining photo (or clear it).
		newURL = ""
		var next string
		err := tx.QueryRow(ctx,
			`SELECT url FROM profile_photos WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`,
			userID).Scan(&next)
		if err == nil {
			newURL = next
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET avatar_url=$2 WHERE id=$1`, userID, newURL); err != nil {
			return "", err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return newURL, nil
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
	var phone *string
	var deviceID int64
	err := r.pool.QueryRow(ctx,
		`SELECT u.id, u.phone, u.username, u.first_name, u.last_name, u.display_name,
		        u.bio, u.birthday, u.avatar_url, u.phone_visibility, u.is_premium, u.emoji_status, d.id
		 FROM users u JOIN devices d ON d.user_id=u.id WHERE d.token_hash=$1`,
		tokenHash).Scan(&u.ID, &phone, &u.Username, &u.FirstName, &u.LastName, &u.DisplayName,
		&u.Bio, &u.Birthday, &u.AvatarURL, &u.PhoneVisibility, &u.IsPremium, &u.EmojiStatus, &deviceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.User{}, 0, domain.ErrNotFound
	}
	if err != nil {
		return domain.User{}, 0, err
	}
	if phone != nil {
		u.Phone = *phone
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

// DeleteAll removes every device of the user, returning the removed rows so the
// caller can evict session caches and close sockets (account deletion).
func (r *AuthRepo) DeleteAll(ctx context.Context, userID int64) ([]domain.Device, error) {
	rows, err := r.pool.Query(ctx,
		`DELETE FROM devices WHERE user_id=$1 RETURNING id, token_hash`, userID)
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
