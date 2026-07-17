package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasepasskeys "github.com/messenger-denis/backend/internal/usecase/passkeys"
)

// PasskeysRepo реализует passkeys.Repo поверх таблицы passkeys.
type PasskeysRepo struct{ pool *pgxpool.Pool }

func NewPasskeysRepo(pool *pgxpool.Pool) *PasskeysRepo { return &PasskeysRepo{pool: pool} }

var _ usecasepasskeys.Repo = (*PasskeysRepo)(nil)

const passkeyCols = `id, user_id, name, cred_id, credential, created_at, last_used_at`

func scanPasskey(row pgx.Row) (domain.Passkey, error) {
	var p domain.Passkey
	err := row.Scan(&p.ID, &p.UserID, &p.Name, &p.CredID, &p.Credential, &p.CreatedAt, &p.LastUsedAt)
	return p, err
}

func (r *PasskeysRepo) Save(ctx context.Context, pk domain.Passkey) (domain.Passkey, error) {
	return scanPasskey(querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO passkeys (user_id, name, cred_id, credential)
		 VALUES ($1,$2,$3,$4) RETURNING `+passkeyCols,
		pk.UserID, pk.Name, pk.CredID, string(pk.Credential)))
}

func (r *PasskeysRepo) List(ctx context.Context, userID int64) ([]domain.Passkey, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+passkeyCols+` FROM passkeys WHERE user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.Passkey, 0)
	for rows.Next() {
		p, err := scanPasskey(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *PasskeysRepo) Delete(ctx context.Context, userID, id int64) (bool, error) {
	tag, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM passkeys WHERE id=$1 AND user_id=$2`, id, userID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (r *PasskeysRepo) ByCredID(ctx context.Context, credID string) (domain.Passkey, error) {
	p, err := scanPasskey(querier(ctx, r.pool).QueryRow(ctx,
		`SELECT `+passkeyCols+` FROM passkeys WHERE cred_id=$1`, credID))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Passkey{}, domain.ErrNotFound
	}
	return p, err
}

func (r *PasskeysRepo) UpdateCredential(ctx context.Context, id int64, credential []byte) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE passkeys SET credential=$2, last_used_at=now() WHERE id=$1`, id, string(credential))
	return err
}
