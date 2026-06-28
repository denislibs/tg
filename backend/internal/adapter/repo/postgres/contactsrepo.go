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

var _ usecasecontacts.ContactsRepo = (*ContactsRepo)(nil)

func NewContactsRepo(pool *pgxpool.Pool) *ContactsRepo { return &ContactsRepo{pool: pool} }

// contactSelect joins the saved contact row with the peer's live profile so a
// listing renders the avatar/username/phone without a second round-trip. Column
// order matches scanContact.
const contactSelect = `
	SELECT c.owner_id, c.user_id, c.first_name, c.last_name, c.note, c.share_phone, c.created_at,
	       u.username, u.avatar_url, u.phone, u.display_name
	FROM contacts c JOIN users u ON u.id = c.user_id`

func scanContact(row pgx.Row) (domain.Contact, error) {
	var c domain.Contact
	err := row.Scan(&c.OwnerID, &c.UserID, &c.FirstName, &c.LastName, &c.Note, &c.SharePhone,
		&c.CreatedAt, &c.Username, &c.AvatarURL, &c.Phone, &c.DisplayName)
	return c, err
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

func (r *ContactsRepo) Delete(ctx context.Context, ownerID, userID int64) (bool, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM contacts WHERE owner_id=$1 AND user_id=$2`, ownerID, userID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
