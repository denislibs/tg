package postgres

import (
	"context"
	"crypto/rand"
	"encoding/base64"
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

// --- Ссылки-приглашения в папку (folder_invites) ---

// inviteSlug — случайный URL-safe слаг (12 байт → 16 символов base64url).
func inviteSlug() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func (r *FoldersRepo) CreateFolderInvite(ctx context.Context, inv domain.FolderInvite) (string, error) {
	slug := inviteSlug()
	err := r.tx(ctx, func(ctx context.Context) error {
		q := querier(ctx, r.pool)
		var id int64
		if err := q.QueryRow(ctx,
			`INSERT INTO folder_invites (slug, folder_id, owner_id, title)
			 VALUES ($1,$2,$3,$4) RETURNING id`,
			slug, inv.FolderID, inv.OwnerID, inv.Title).Scan(&id); err != nil {
			return err
		}
		for _, chatID := range inv.ChatIDs {
			if _, err := q.Exec(ctx,
				`INSERT INTO folder_invite_chats (invite_id, chat_id) VALUES ($1,$2)
				 ON CONFLICT DO NOTHING`, id, chatID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	return slug, nil
}

func (r *FoldersRepo) ListFolderInvites(ctx context.Context, folderID, ownerID int64) ([]domain.FolderInvite, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT id, slug, folder_id, owner_id, title, created_at
		   FROM folder_invites WHERE folder_id=$1 AND owner_id=$2 ORDER BY id DESC`, folderID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.FolderInvite, 0)
	for rows.Next() {
		var inv domain.FolderInvite
		if err := rows.Scan(&inv.ID, &inv.Slug, &inv.FolderID, &inv.OwnerID, &inv.Title, &inv.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, inv)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		ids, err := r.inviteChatIDs(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].ChatIDs = ids
	}
	return out, nil
}

func (r *FoldersRepo) GetFolderInviteBySlug(ctx context.Context, slug string) (domain.FolderInvite, error) {
	var inv domain.FolderInvite
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT id, slug, folder_id, owner_id, title, created_at
		   FROM folder_invites WHERE slug=$1`, slug).
		Scan(&inv.ID, &inv.Slug, &inv.FolderID, &inv.OwnerID, &inv.Title, &inv.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.FolderInvite{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.FolderInvite{}, err
	}
	ids, err := r.inviteChatIDs(ctx, inv.ID)
	if err != nil {
		return domain.FolderInvite{}, err
	}
	inv.ChatIDs = ids
	return inv, nil
}

func (r *FoldersRepo) DeleteFolderInvite(ctx context.Context, slug string, ownerID int64) error {
	ct, err := querier(ctx, r.pool).Exec(ctx,
		`DELETE FROM folder_invites WHERE slug=$1 AND owner_id=$2`, slug, ownerID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *FoldersRepo) inviteChatIDs(ctx context.Context, inviteID int64) ([]int64, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT chat_id FROM folder_invite_chats WHERE invite_id=$1 ORDER BY chat_id`, inviteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// tx запускает fn в транзакции, если контекст ещё не в ней (CreateFolderInvite
// пишет в две таблицы). Если tx уже есть — переиспользует его.
func (r *FoldersRepo) tx(ctx context.Context, fn func(ctx context.Context) error) error {
	if _, ok := ctx.Value(txKey).(pgx.Tx); ok {
		return fn(ctx)
	}
	dbTx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer dbTx.Rollback(ctx)
	if err := fn(context.WithValue(ctx, txKey, dbTx)); err != nil {
		return err
	}
	return dbTx.Commit(ctx)
}
