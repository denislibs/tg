package postgres

import (
	"context"
	"encoding/json"
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
// order matches scanContact. Карточка пира — глазами ВЛАДЕЛЬЦА книги
// (userSeenCols): имя, под которым он её сохранил, и pFlags.contact — та же
// линза, что у любого другого ответа с этим пользователем.
var contactSelect = `
	SELECT c.owner_id, c.user_id, c.first_name, c.last_name, c.note, c.note_entities, c.share_phone, c.created_at,
	       ` + userSeenCols("u.", "c.owner_id") + `, u.phone
	FROM contacts c JOIN users u ON u.id = c.user_id`

func scanContact(row pgx.Row) (domain.ContactRecord, error) {
	var c domain.ContactRecord
	var u userSeenScan
	var phone, noteText string
	var noteEntities []byte
	dest := []any{&c.OwnerID, &c.UserID, &c.FirstName, &c.LastName, &noteText, &noteEntities, &c.SharePhone, &c.CreatedAt}
	dest = append(dest, u.dest()...)
	dest = append(dest, &phone)
	if err := row.Scan(dest...); err != nil {
		return domain.ContactRecord{}, err
	}
	c.Note = contactNote(noteText, noteEntities)
	c.IsBot = u.isBot
	c.User = u.user(true)
	c.User.Phone = phone
	return c, nil
}

// contactNote собирает заметку из пары колонок (contacts.note +
// contacts.note_entities). Пустой текст — заметки НЕТ (nil), а не пустой
// конструктор: у оригинала пустая заметка это отсутствие userFull.note.
func contactNote(text string, entities []byte) *domain.TextWithEntities {
	if text == "" {
		return nil
	}
	var es domain.MessageEntities
	if len(entities) > 0 {
		_ = json.Unmarshal(entities, &es)
	}
	return domain.NewTextWithEntities(text, es)
}

// noteParams — пара параметров записи заметки: текст и разметка jsonb-строкой.
// nil-заметка даёт два NULL — «не трогать» у upsert'а (COALESCE ниже).
func noteParams(n *domain.TextWithEntities) (text, entities any) {
	if n == nil {
		return nil, nil
	}
	es := n.Entities
	if es == nil {
		es = domain.MessageEntities{}
	}
	b, err := json.Marshal(es)
	if err != nil {
		b = []byte("[]")
	}
	return n.Text, string(b)
}

// isForeignKeyViolation reports a Postgres FK error (e.g. adding a non-existent user).
func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

func (r *ContactsRepo) Add(ctx context.Context, c domain.ContactRecord) (domain.ContactRecord, error) {
	// Заметка без значения (addContact без note) — «не трогать»: прежняя
	// заметка переживает правку имени, у новой записи она пустая.
	noteText, noteEntities := noteParams(c.Note)
	_, err := r.pool.Exec(ctx,
		`INSERT INTO contacts (owner_id, user_id, first_name, last_name, note, note_entities, share_phone)
		 VALUES ($1,$2,$3,$4,COALESCE($5::text,''),COALESCE($6::jsonb,'[]'),$7)
		 ON CONFLICT (owner_id, user_id)
		 DO UPDATE SET first_name=$3, last_name=$4,
		   note=COALESCE($5::text, contacts.note),
		   note_entities=COALESCE($6::jsonb, contacts.note_entities),
		   share_phone=$7`,
		c.OwnerID, c.UserID, c.FirstName, c.LastName, noteText, noteEntities, c.SharePhone)
	if isForeignKeyViolation(err) {
		return domain.ContactRecord{}, domain.ErrNotFound // the contact user doesn't exist
	}
	if err != nil {
		return domain.ContactRecord{}, err
	}
	// Re-read with the user join so the response carries the enriched fields.
	return scanContact(r.pool.QueryRow(ctx, contactSelect+` WHERE c.owner_id=$1 AND c.user_id=$2`, c.OwnerID, c.UserID))
}

func (r *ContactsRepo) List(ctx context.Context, ownerID int64) ([]domain.ContactRecord, error) {
	rows, err := r.pool.Query(ctx, contactSelect+` WHERE c.owner_id=$1 ORDER BY c.first_name, c.last_name, c.user_id`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.ContactRecord, 0)
	for rows.Next() {
		c, err := scanContact(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// UpdateNote переписывает заметку существующего контакта
// (contacts.updateContactNote); found=false — такого контакта в книге нет.
func (r *ContactsRepo) UpdateNote(ctx context.Context, ownerID, userID int64, note domain.TextWithEntities) (bool, error) {
	text, entities := noteParams(&note)
	tag, err := r.pool.Exec(ctx,
		`UPDATE contacts SET note=$3, note_entities=$4::jsonb WHERE owner_id=$1 AND user_id=$2`,
		ownerID, userID, text, entities)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
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

// SeenUser — карточка userID глазами viewerID (userSeenCols).
func (r *ContactsRepo) SeenUser(ctx context.Context, viewerID, userID int64) (domain.UserReal, error) {
	u, err := scanUserSeen(querier(ctx, r.pool).QueryRow(ctx,
		`SELECT `+userSeenCols("u.", "$2")+` FROM users u WHERE u.id = $1`, userID, viewerID))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.UserReal{}, domain.ErrNotFound
	}
	return u, err
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
