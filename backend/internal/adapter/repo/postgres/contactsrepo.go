package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/messenger-denis/backend/internal/domain"
	usecasecontacts "github.com/messenger-denis/backend/internal/usecase/contacts"
)

// ContactsRepo is a postgres-backed adapter implementing the contacts usecase ports.
type ContactsRepo struct{ pool *pgxpool.Pool }

var (
	_ usecasecontacts.ContactsRepo    = (*ContactsRepo)(nil)
	_ usecasecontacts.CustomPhotoRepo = (*ContactsRepo)(nil)
)

func NewContactsRepo(pool *pgxpool.Pool) *ContactsRepo { return &ContactsRepo{pool: pool} }

// contactSelect joins the saved contact row with the peer's live profile so a
// listing renders the avatar/username/phone without a second round-trip. Column
// order matches scanContact.
var contactSelect = `
	SELECT c.owner_id, c.user_id, c.first_name, c.last_name, c.note, c.share_phone, c.created_at,
	       ` + userRealCols("u.") + `, u.phone
	FROM contacts c JOIN users u ON u.id = c.user_id`

func scanContact(row pgx.Row) (domain.Contact, error) {
	var c domain.Contact
	var u userRealScan
	var phone string
	dest := []any{&c.OwnerID, &c.UserID, &c.FirstName, &c.LastName, &c.Note, &c.SharePhone, &c.CreatedAt}
	dest = append(dest, u.dest()...)
	dest = append(dest, &phone)
	if err := row.Scan(dest...); err != nil {
		return domain.Contact{}, err
	}
	c.IsBot = u.isBot
	c.User = u.user(true)
	c.User.Phone = phone
	// Имя карточки — сохранённое ВЛАДЕЛЬЦЕМ, а не профильное: это и есть
	// смысл адресной книги.
	c.User.FirstName, c.User.LastName = c.FirstName, c.LastName
	return c, nil
}

// isForeignKeyViolation reports a Postgres FK error (e.g. adding a non-existent user).
func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

func (r *ContactsRepo) Add(ctx context.Context, c domain.Contact) (domain.Contact, error) {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO contacts (owner_id, user_id, first_name, last_name, note, share_phone)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 ON CONFLICT (owner_id, user_id)
		 DO UPDATE SET first_name=$3, last_name=$4, note=$5, share_phone=$6`,
		c.OwnerID, c.UserID, c.FirstName, c.LastName, c.Note, c.SharePhone)
	if isForeignKeyViolation(err) {
		return domain.Contact{}, domain.ErrNotFound // the contact user doesn't exist
	}
	if err != nil {
		return domain.Contact{}, err
	}
	// Re-read with the user join so the response carries the enriched fields.
	return scanContact(r.pool.QueryRow(ctx, contactSelect+` WHERE c.owner_id=$1 AND c.user_id=$2`, c.OwnerID, c.UserID))
}

func (r *ContactsRepo) List(ctx context.Context, ownerID int64) ([]domain.Contact, error) {
	rows, err := r.pool.Query(ctx, contactSelect+` WHERE c.owner_id=$1 ORDER BY c.first_name, c.last_name, c.user_id`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.Contact, 0)
	for rows.Next() {
		c, err := scanContact(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ResolveByPhone finds a registered user by normalized phone; domain.ErrNotFound
// when the number isn't registered.
func (r *ContactsRepo) ResolveByPhone(ctx context.Context, phone string) (int64, error) {
	var id int64
	err := r.pool.QueryRow(ctx, `SELECT id FROM users WHERE phone=$1`, phone).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	return id, nil
}

func (r *ContactsRepo) Delete(ctx context.Context, ownerID, userID int64) (bool, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM contacts WHERE owner_id=$1 AND user_id=$2`, ownerID, userID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// SetCustomPhoto upserts the owner's personal photo for a contact.
func (r *ContactsRepo) SetCustomPhoto(ctx context.Context, ownerID, contactUserID, mediaID int64) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO contact_custom_photo (owner_id, contact_user_id, media_id)
		 VALUES ($1,$2,$3)
		 ON CONFLICT (owner_id, contact_user_id) DO UPDATE SET media_id=$3, created_at=now()`,
		ownerID, contactUserID, mediaID)
	if isForeignKeyViolation(err) {
		return domain.ErrNotFound
	}
	return err
}

// ClearCustomPhoto removes the owner's personal photo for a contact (idempotent).
func (r *ContactsRepo) ClearCustomPhoto(ctx context.Context, ownerID, contactUserID int64) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM contact_custom_photo WHERE owner_id=$1 AND contact_user_id=$2`, ownerID, contactUserID)
	return err
}

// CustomPhotoMap returns the owner's personal photos for the given contacts,
// keyed by contact user id (absent when there is no personal photo).
func (r *ContactsRepo) CustomPhotoMap(ctx context.Context, ownerID int64, contactIDs []int64) (map[int64]int64, error) {
	out := make(map[int64]int64)
	if len(contactIDs) == 0 {
		return out, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT contact_user_id, media_id FROM contact_custom_photo WHERE owner_id=$1 AND contact_user_id = ANY($2)`,
		ownerID, contactIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, mediaID int64
		if err := rows.Scan(&id, &mediaID); err != nil {
			return nil, err
		}
		out[id] = mediaID
	}
	return out, rows.Err()
}
