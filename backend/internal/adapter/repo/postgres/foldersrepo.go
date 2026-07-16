package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasefolders "github.com/messenger-denis/backend/internal/usecase/folders"
)

// FoldersRepo реализует folders.Repo поверх таблицы folders.
// include/exclude-списки — jsonb-массивы chat_id (пишутся как string(json),
// см. правило jsonb в CLAUDE.md).
type FoldersRepo struct{ pool *pgxpool.Pool }

func NewFoldersRepo(pool *pgxpool.Pool) *FoldersRepo { return &FoldersRepo{pool: pool} }

var _ usecasefolders.Repo = (*FoldersRepo)(nil)

const folderCols = `id, title, pos, contacts, non_contacts, groups, broadcasts, bots,
	exclude_muted, exclude_read, COALESCE(include_chats, '[]'::jsonb), COALESCE(exclude_chats, '[]'::jsonb)`

func scanFolder(row pgx.Row) (domain.Folder, error) {
	var f domain.Folder
	var inc, exc []byte
	if err := row.Scan(&f.ID, &f.Title, &f.Pos, &f.Contacts, &f.NonContacts, &f.Groups,
		&f.Broadcasts, &f.Bots, &f.ExcludeMuted, &f.ExcludeRead, &inc, &exc); err != nil {
		return domain.Folder{}, err
	}
	_ = json.Unmarshal(inc, &f.IncludeChats)
	_ = json.Unmarshal(exc, &f.ExcludeChats)
	return f, nil
}

func chatsJSON(ids []int64) any {
	if len(ids) == 0 {
		return nil
	}
	b, _ := json.Marshal(ids)
	return string(b)
}

func (r *FoldersRepo) List(ctx context.Context, ownerID int64) ([]domain.Folder, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+folderCols+` FROM folders WHERE owner_id=$1 ORDER BY pos, id`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.Folder, 0)
	for rows.Next() {
		f, err := scanFolder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (r *FoldersRepo) Create(ctx context.Context, ownerID int64, f domain.Folder) (domain.Folder, error) {
	// pos = в конец списка
	row := querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO folders (owner_id, title, pos, contacts, non_contacts, groups, broadcasts, bots,
		                      exclude_muted, exclude_read, include_chats, exclude_chats)
		 VALUES ($1,$2,(SELECT COALESCE(MAX(pos)+1,0) FROM folders WHERE owner_id=$1),
		         $3,$4,$5,$6,$7,$8,$9,$10,$11)
		 RETURNING `+folderCols,
		ownerID, f.Title, f.Contacts, f.NonContacts, f.Groups, f.Broadcasts, f.Bots,
		f.ExcludeMuted, f.ExcludeRead, chatsJSON(f.IncludeChats), chatsJSON(f.ExcludeChats))
	return scanFolder(row)
}

func (r *FoldersRepo) Update(ctx context.Context, ownerID int64, f domain.Folder) (domain.Folder, error) {
	row := querier(ctx, r.pool).QueryRow(ctx,
		`UPDATE folders SET title=$3, contacts=$4, non_contacts=$5, groups=$6, broadcasts=$7,
		        bots=$8, exclude_muted=$9, exclude_read=$10, include_chats=$11, exclude_chats=$12
		 WHERE id=$2 AND owner_id=$1
		 RETURNING `+folderCols,
		ownerID, f.ID, f.Title, f.Contacts, f.NonContacts, f.Groups, f.Broadcasts, f.Bots,
		f.ExcludeMuted, f.ExcludeRead, chatsJSON(f.IncludeChats), chatsJSON(f.ExcludeChats))
	out, err := scanFolder(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Folder{}, domain.ErrNotFound
	}
	return out, err
}

func (r *FoldersRepo) Delete(ctx context.Context, ownerID, folderID int64) error {
	ct, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM folders WHERE id=$2 AND owner_id=$1`, ownerID, folderID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *FoldersRepo) Count(ctx context.Context, ownerID int64) (int, error) {
	var n int
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT count(*) FROM folders WHERE owner_id=$1`, ownerID).Scan(&n)
	return n, err
}
