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
// query that returns a full domain.UserRecord.
const userCols = `id, phone, username, first_name, last_name, bio, birthday, avatar_media_id, avatar_preview, is_premium, is_verified, is_bot, deleted_at IS NOT NULL, emoji_status, auto_delete_period`

// scanUser scans a row selected with userCols into a domain.UserRecord. Phone is
// nullable (freed on account deletion), so it is scanned via a pointer and left
// empty for a soft-deleted "Deleted Account".
func scanUser(row pgx.Row) (domain.UserRecord, error) {
	var u domain.UserRecord
	var phone *string
	err := row.Scan(&u.ID, &phone, &u.Username, &u.FirstName, &u.LastName,
		&u.Bio, &u.Birthday, &u.PhotoID, &u.PhotoPreview,
		&u.IsPremium, &u.IsVerified, &u.IsBot, &u.Deleted, &u.EmojiStatus, &u.AutoDeletePeriod)
	if phone != nil {
		u.Phone = *phone
	}
	return u, err
}

// displayNameExpr — «Имя Фамилия» из параметров $2/$3 прямо в SQL. Колонка
// users.display_name остаётся ПОИСКОВОЙ (ILIKE-разыскание пользователей) и на
// провод не выходит: имя пира собирает клиент. Поэтому и склейка живёт здесь, а
// не в домене — доменного помощника BuildDisplayName больше нет.
const displayNameExpr = `btrim(btrim($2) || ' ' || btrim($3))`

// isUniqueViolation reports whether err is a Postgres unique-constraint error.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// AuthRepo is a postgres-backed adapter implementing the auth usecase's
// UserRepo, DeviceRepo and CodeRepo ports.
type AuthRepo struct{ pool *pgxpool.Pool }

var (
	_ usecaseauth.UserRepo      = (*AuthRepo)(nil)
	_ usecaseauth.DeviceRepo    = (*AuthRepo)(nil)
	_ usecaseauth.CodeRepo      = (*AuthRepo)(nil)
	_ usecaseauth.PasswordRepo  = (*AuthRepo)(nil)
	_ usecaseauth.LoginStepRepo = (*AuthRepo)(nil)
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

// ByPhone returns the user owning the phone, or domain.ErrNotFound. Soft-deleted
// accounts hold a NULL phone and never match.
func (r *AuthRepo) ByPhone(ctx context.Context, phone string) (domain.UserRecord, error) {
	u, err := scanUser(r.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE phone=$1`, phone))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.UserRecord{}, domain.ErrNotFound
	}
	return u, err
}

// CreateWithName inserts a brand-new account for an already verified phone
// (sign-up step). A concurrent claim of the same number maps to domain.ErrConflict.
func (r *AuthRepo) CreateWithName(ctx context.Context, phone, first, last string) (domain.UserRecord, error) {
	u, err := scanUser(r.pool.QueryRow(ctx,
		`INSERT INTO users (phone, first_name, last_name, display_name)
		 VALUES ($1,$2,$3,`+displayNameExpr+`)
		 RETURNING `+userCols,
		phone, first, last))
	if isUniqueViolation(err) {
		return domain.UserRecord{}, domain.ErrConflict
	}
	return u, err
}

// GetByID returns the full user record, or domain.ErrNotFound.
func (r *AuthRepo) GetByID(ctx context.Context, id int64) (domain.UserRecord, error) {
	u, err := scanUser(r.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.UserRecord{}, domain.ErrNotFound
	}
	return u, err
}

// UpdateProfile writes the editable profile fields and returns the fresh user.
func (r *AuthRepo) UpdateProfile(ctx context.Context, id int64, first, last, bio string, birthday *time.Time) (domain.UserRecord, error) {
	return scanUser(r.pool.QueryRow(ctx,
		`UPDATE users SET first_name=$2, last_name=$3, display_name=`+displayNameExpr+`, bio=$4, birthday=$5
		 WHERE id=$1 RETURNING `+userCols,
		id, first, last, bio, birthday))
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
func (r *AuthRepo) SetUsername(ctx context.Context, id int64, username *string) (domain.UserRecord, error) {
	u, err := scanUser(r.pool.QueryRow(ctx,
		`UPDATE users SET username=$2 WHERE id=$1 RETURNING `+userCols, id, username))
	if isUniqueViolation(err) {
		return domain.UserRecord{}, domain.ErrConflict
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
func (r *AuthRepo) UpdatePhone(ctx context.Context, id int64, phone string) (domain.UserRecord, error) {
	u, err := scanUser(r.pool.QueryRow(ctx,
		`UPDATE users SET phone=$2 WHERE id=$1 RETURNING `+userCols, id, phone))
	if isUniqueViolation(err) {
		return domain.UserRecord{}, domain.ErrConflict
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
		        bio='', avatar_media_id=NULL, avatar_preview=NULL, emoji_status='',
		        password_hash=NULL, password_hint='', recovery_email='',
		        deleted_at=now()
		 WHERE id=$1`, id)
	return err
}

// SetEmojiStatus writes the user's emoji status ("" clears it) and returns the user.
func (r *AuthRepo) SetEmojiStatus(ctx context.Context, id int64, emoji string) (domain.UserRecord, error) {
	return scanUser(r.pool.QueryRow(ctx,
		`UPDATE users SET emoji_status=$2 WHERE id=$1 RETURNING `+userCols, id, emoji))
}

// SetPremium flips the Telegram Premium flag and returns the fresh user.
func (r *AuthRepo) SetPremium(ctx context.Context, id int64, premium bool) (domain.UserRecord, error) {
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
// avatar (users.avatar_media_id + users.avatar_preview) in one transaction, so
// the denormalized avatar and the gallery never diverge. preview
// (stripped-превью) пишется и на строку галереи — для отката аватарки при
// удалении текущей.
func (r *AuthRepo) AddProfilePhoto(ctx context.Context, userID, mediaID int64, videoMediaID *int64, preview []byte) (domain.ProfilePhoto, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return domain.ProfilePhoto{}, err
	}
	defer tx.Rollback(ctx)

	p := domain.ProfilePhoto{UserID: userID, MediaID: mediaID, VideoMediaID: videoMediaID}
	if err := tx.QueryRow(ctx,
		`INSERT INTO profile_photos (user_id, media_id, video_media_id, preview) VALUES ($1,$2,$3,$4)
		 RETURNING id, created_at`, userID, mediaID, videoMediaID, preview).Scan(&p.ID, &p.CreatedAt); err != nil {
		return domain.ProfilePhoto{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET avatar_media_id=$2, avatar_preview=$3 WHERE id=$1`, userID, mediaID, preview); err != nil {
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
		`SELECT id, user_id, media_id, video_media_id, created_at FROM profile_photos
		 WHERE user_id=$1 ORDER BY created_at DESC, id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ProfilePhoto
	for rows.Next() {
		var p domain.ProfilePhoto
		if err := rows.Scan(&p.ID, &p.UserID, &p.MediaID, &p.VideoMediaID, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// DeleteProfilePhoto removes a photo owned by userID. If the deleted photo was
// the current avatar, it is recomputed to the next most-recent photo (or none) —
// all in one transaction. Returns the resulting avatar media id (nil — аватарки
// не осталось). Deleting an unknown/other-user photo is a no-op that returns the
// unchanged avatar.
func (r *AuthRepo) DeleteProfilePhoto(ctx context.Context, userID, photoID int64) (*int64, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var deleted int64
	err = tx.QueryRow(ctx,
		`DELETE FROM profile_photos WHERE id=$1 AND user_id=$2 RETURNING media_id`,
		photoID, userID).Scan(&deleted)
	if errors.Is(err, pgx.ErrNoRows) {
		// Nothing deleted; report the current avatar unchanged.
		var cur *int64
		if err := tx.QueryRow(ctx, `SELECT avatar_media_id FROM users WHERE id=$1`, userID).Scan(&cur); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return cur, nil
	}
	if err != nil {
		return nil, err
	}

	var cur *int64
	if err := tx.QueryRow(ctx, `SELECT avatar_media_id FROM users WHERE id=$1`, userID).Scan(&cur); err != nil {
		return nil, err
	}
	if cur != nil && *cur == deleted {
		// Fall back to the next most-recent remaining photo (or clear it).
		// Превью откатывается вместе с фото — из preview той же строки галереи.
		var next *int64
		var newPreview []byte
		err := tx.QueryRow(ctx,
			`SELECT media_id, preview FROM profile_photos WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`,
			userID).Scan(&next, &newPreview)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET avatar_media_id=$2, avatar_preview=$3 WHERE id=$1`, userID, next, newPreview); err != nil {
			return nil, err
		}
		cur = next
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return cur, nil
}

// --- DeviceRepo ---

// Create inserts a device row holding the token hash + sign-in metadata.
// Принимает саму сущность, а не восемь строк подряд: реквизиты клиента
// (браузер, ОС, версия сборки) уже разложены по своим полям в usecase.
func (r *AuthRepo) Create(ctx context.Context, in domain.Device) (domain.Device, error) {
	var d domain.Device
	err := r.pool.QueryRow(ctx,
		`INSERT INTO devices (user_id, name, platform, system_version, app_version, token_hash, ip, location)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		 RETURNING id, user_id, name, platform, system_version, app_version, token_hash, created_at, last_active, ip, location`,
		in.UserID, in.Name, in.Platform, in.SystemVersion, in.AppVersion, in.TokenHash, in.IP, in.Location).
		Scan(&d.ID, &d.UserID, &d.Name, &d.Platform, &d.SystemVersion, &d.AppVersion, &d.TokenHash,
			&d.CreatedAt, &d.LastActive, &d.IP, &d.Location)
	return d, err
}

// SessionByTokenHash resolves a token hash to its user and device id, and
// lazily touches last_active. Returns domain.ErrNotFound if unknown.
func (r *AuthRepo) SessionByTokenHash(ctx context.Context, tokenHash, appVersion string) (domain.UserRecord, int64, error) {
	var u domain.UserRecord
	var phone *string
	var deviceID int64
	err := r.pool.QueryRow(ctx,
		`SELECT u.id, u.phone, u.username, u.first_name, u.last_name,
		        u.bio, u.birthday, u.avatar_media_id, u.avatar_preview, u.is_premium,
		        u.is_verified, u.is_bot, u.deleted_at IS NOT NULL, u.emoji_status, u.auto_delete_period, d.id
		 FROM users u JOIN devices d ON d.user_id=u.id WHERE d.token_hash=$1`,
		tokenHash).Scan(&u.ID, &phone, &u.Username, &u.FirstName, &u.LastName,
		&u.Bio, &u.Birthday, &u.PhotoID, &u.PhotoPreview, &u.IsPremium,
		&u.IsVerified, &u.IsBot, &u.Deleted, &u.EmojiStatus, &u.AutoDeletePeriod, &deviceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.UserRecord{}, 0, domain.ErrNotFound
	}
	if err != nil {
		return domain.UserRecord{}, 0, err
	}
	if phone != nil {
		u.Phone = *phone
	}
	// Версия сборки обновляется ТЕМ ЖЕ запросом, что двигает активность:
	// у оригинала клиент называет себя в преамбуле КАЖДОГО соединения, поэтому
	// экран сессий показывает версию, которой пользуются сейчас, а не ту, с
	// которой когда-то вошли (клиент обновляется сам, и замороженная строка
	// врала бы до следующего входа). Пустое значение прежнюю не затирает:
	// «клиент не назвался» — не то же самое, что «клиент безымянный».
	_, _ = r.pool.Exec(ctx,
		`UPDATE devices SET last_active=now(),
		        app_version=CASE WHEN $2 <> '' THEN $2 ELSE app_version END
		  WHERE id=$1`, deviceID, appVersion)
	return u, deviceID, nil
}

// ListByUser returns a user's devices, most recently active first.
func (r *AuthRepo) ListByUser(ctx context.Context, userID int64) ([]domain.Device, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, name, platform, system_version, app_version,
		        created_at, last_active, ip, location FROM devices
		 WHERE user_id=$1 ORDER BY last_active DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Device
	for rows.Next() {
		var d domain.Device
		if err := rows.Scan(&d.ID, &d.UserID, &d.Name, &d.Platform, &d.SystemVersion, &d.AppVersion,
			&d.CreatedAt, &d.LastActive, &d.IP, &d.Location); err != nil {
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

// --- Одноразовые шаги входа: usecase/auth.LoginStepRepo ---

// SaveSignUpToken сохраняет токен шага регистрации (номер подтверждён, аккаунта ещё нет).
func (r *AuthRepo) SaveSignUpToken(ctx context.Context, tokenHash, phone string, expires time.Time) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO signup_tokens (token_hash, phone, expires_at) VALUES ($1,$2,$3)
		 ON CONFLICT (token_hash) DO UPDATE SET phone=$2, expires_at=$3`,
		tokenHash, phone, expires)
	return err
}

// SignUpTokenPhone возвращает номер живого токена регистрации (истёкшие не считаются).
func (r *AuthRepo) SignUpTokenPhone(ctx context.Context, tokenHash string) (string, error) {
	var phone string
	err := r.pool.QueryRow(ctx,
		`SELECT phone FROM signup_tokens WHERE token_hash=$1 AND expires_at > now()`,
		tokenHash).Scan(&phone)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	return phone, err
}

// DeleteSignUpToken сжигает токен регистрации.
func (r *AuthRepo) DeleteSignUpToken(ctx context.Context, tokenHash string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM signup_tokens WHERE token_hash=$1`, tokenHash)
	return err
}

// SaveRecoveryCode кладёт (или заменяет) код сброса пароля для шага входа.
func (r *AuthRepo) SaveRecoveryCode(ctx context.Context, tokenHash string, userID int64, codeHash string, expires, nextSendAt time.Time) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO password_recovery_codes (token_hash, user_id, code_hash, expires_at, next_send_at)
		 VALUES ($1,$2,$3,$4,$5)
		 ON CONFLICT (token_hash) DO UPDATE
		   SET user_id=$2, code_hash=$3, expires_at=$4, next_send_at=$5`,
		tokenHash, userID, codeHash, expires, nextSendAt)
	return err
}

// RecoveryCode возвращает живой код сброса; истёкший — domain.ErrNotFound.
func (r *AuthRepo) RecoveryCode(ctx context.Context, tokenHash string) (int64, string, time.Time, error) {
	var userID int64
	var codeHash string
	var nextSendAt time.Time
	err := r.pool.QueryRow(ctx,
		`SELECT user_id, code_hash, next_send_at FROM password_recovery_codes
		 WHERE token_hash=$1 AND expires_at > now()`,
		tokenHash).Scan(&userID, &codeHash, &nextSendAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, "", time.Time{}, domain.ErrNotFound
	}
	return userID, codeHash, nextSendAt, err
}

// DeleteRecoveryCode сжигает код сброса (успех или исчерпание попыток).
func (r *AuthRepo) DeleteRecoveryCode(ctx context.Context, tokenHash string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM password_recovery_codes WHERE token_hash=$1`, tokenHash)
	return err
}

// SaveWebAuthToken сохраняет одноразовый веб-токен входа.
func (r *AuthRepo) SaveWebAuthToken(ctx context.Context, tokenHash string, userID int64, expires time.Time) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO web_auth_tokens (token_hash, user_id, expires_at) VALUES ($1,$2,$3)
		 ON CONFLICT (token_hash) DO UPDATE SET user_id=$2, expires_at=$3`,
		tokenHash, userID, expires)
	return err
}

// WebAuthTokenUser возвращает владельца живого веб-токена.
func (r *AuthRepo) WebAuthTokenUser(ctx context.Context, tokenHash string) (int64, error) {
	var userID int64
	err := r.pool.QueryRow(ctx,
		`SELECT user_id FROM web_auth_tokens WHERE token_hash=$1 AND expires_at > now()`,
		tokenHash).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	return userID, err
}

// DeleteWebAuthToken сжигает веб-токен после обмена.
func (r *AuthRepo) DeleteWebAuthToken(ctx context.Context, tokenHash string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM web_auth_tokens WHERE token_hash=$1`, tokenHash)
	return err
}

// ScheduleAccountReset планирует отложенный сброс. ON CONFLICT перезаписывает
// строку целиком (в том числе снимает cancelled_at): сюда доходят только новые
// окна — ждущее и карантин usecase отсекает раньше.
func (r *AuthRepo) ScheduleAccountReset(ctx context.Context, userID int64, requestedAt, deleteAt time.Time) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO account_resets (user_id, requested_at, delete_at, cancelled_at)
		 VALUES ($1,$2,$3,NULL)
		 ON CONFLICT (user_id) DO UPDATE SET requested_at=$2, delete_at=$3, cancelled_at=NULL`,
		userID, requestedAt, deleteAt)
	return err
}

// AccountReset возвращает запланированный сброс; нулевой cancelledAt — ждёт
// исполнения, ненулевой — отменён владельцем.
func (r *AuthRepo) AccountReset(ctx context.Context, userID int64) (time.Time, time.Time, error) {
	var deleteAt time.Time
	var cancelledAt *time.Time
	err := r.pool.QueryRow(ctx,
		`SELECT delete_at, cancelled_at FROM account_resets WHERE user_id=$1`,
		userID).Scan(&deleteAt, &cancelledAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, time.Time{}, domain.ErrNotFound
	}
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	if cancelledAt == nil {
		return deleteAt, time.Time{}, nil
	}
	return deleteAt, *cancelledAt, nil
}

// CancelAccountReset отменяет ждущий сброс (владелец вошёл в аккаунт). Условие
// cancelled_at IS NULL делает вызов идемпотентным: повторные входы не сдвигают
// момент отмены, от которого отсчитывается карантин.
func (r *AuthRepo) CancelAccountReset(ctx context.Context, userID int64, at time.Time) (bool, error) {
	tag, err := r.pool.Exec(ctx,
		`UPDATE account_resets SET cancelled_at=$2 WHERE user_id=$1 AND cancelled_at IS NULL`,
		userID, at)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// DeleteAccountReset убирает запись исполненного сброса.
func (r *AuthRepo) DeleteAccountReset(ctx context.Context, userID int64) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM account_resets WHERE user_id=$1`, userID)
	return err
}
