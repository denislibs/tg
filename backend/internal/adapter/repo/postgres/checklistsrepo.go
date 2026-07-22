package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
)

// ChecklistsRepo хранит чек-листы и отметки (таблицы checklists / checklist_marks).
type ChecklistsRepo struct {
	pool *pgxpool.Pool
}

func NewChecklistsRepo(pool *pgxpool.Pool) *ChecklistsRepo { return &ChecklistsRepo{pool: pool} }

func (r *ChecklistsRepo) Create(ctx context.Context, c domain.Checklist) (domain.Checklist, error) {
	items, err := json.Marshal(c.Items)
	if err != nil {
		return domain.Checklist{}, err
	}
	err = querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO checklists (chat_id, title, items, others_can_add, others_can_mark)
		 VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		c.ChatID, c.Title, string(items), c.OthersCanAdd, c.OthersCanMark).Scan(&c.ID)
	return c, err
}

func (r *ChecklistsRepo) ByID(ctx context.Context, id int64) (domain.Checklist, error) {
	var c domain.Checklist
	var itemsRaw []byte
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT id, chat_id, title, items, others_can_add, others_can_mark
		   FROM checklists WHERE id=$1`, id).
		Scan(&c.ID, &c.ChatID, &c.Title, &itemsRaw, &c.OthersCanAdd, &c.OthersCanMark)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Checklist{}, domain.ErrNotFound
	}
	if err == nil {
		_ = json.Unmarshal(itemsRaw, &c.Items)
	}
	return c, err
}

// SetItems заменяет список пунктов чек-листа целиком (используется при добавлении
// пунктов: usecase дочитывает старые, считает id новых и пишет объединённый список).
func (r *ChecklistsRepo) SetItems(ctx context.Context, checklistID int64, items []domain.ChecklistItem) error {
	raw, err := json.Marshal(items)
	if err != nil {
		return err
	}
	_, err = querier(ctx, r.pool).Exec(ctx,
		`UPDATE checklists SET items=$2 WHERE id=$1`, checklistID, string(raw))
	return err
}

// ToggleMark переключает отметку «выполнено» пользователя на пункте: если строки
// нет — вставляет (возвращает true), если есть — удаляет (возвращает false).
func (r *ChecklistsRepo) ToggleMark(ctx context.Context, checklistID int64, itemID int, userID int64) (bool, error) {
	q := querier(ctx, r.pool)
	tag, err := q.Exec(ctx,
		`DELETE FROM checklist_marks WHERE checklist_id=$1 AND item_id=$2 AND user_id=$3`,
		checklistID, itemID, userID)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() > 0 {
		return false, nil // была отметка — сняли
	}
	_, err = q.Exec(ctx,
		`INSERT INTO checklist_marks (checklist_id, item_id, user_id) VALUES ($1,$2,$3)
		 ON CONFLICT DO NOTHING`, checklistID, itemID, userID)
	return err == nil, err
}

// Info собирает представление чек-листа: пункты + кто отметил каждый.
func (r *ChecklistsRepo) Info(ctx context.Context, checklistID int64) (domain.ChecklistInfo, error) {
	c, err := r.ByID(ctx, checklistID)
	if err != nil {
		return domain.ChecklistInfo{}, err
	}
	marks := make(map[int][]int64, len(c.Items))
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT item_id, user_id FROM checklist_marks WHERE checklist_id=$1 ORDER BY marked_at`, checklistID)
	if err != nil {
		return domain.ChecklistInfo{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var itemID int
		var userID int64
		if e := rows.Scan(&itemID, &userID); e != nil {
			return domain.ChecklistInfo{}, e
		}
		marks[itemID] = append(marks[itemID], userID)
	}
	if err := rows.Err(); err != nil {
		return domain.ChecklistInfo{}, err
	}
	info := domain.ChecklistInfo{
		ID: c.ID, Title: c.Title, OthersCanAdd: c.OthersCanAdd, OthersCanMark: c.OthersCanMark,
		Items: make([]domain.ChecklistItemInfo, 0, len(c.Items)),
	}
	for _, it := range c.Items {
		by := marks[it.ID]
		if by == nil {
			by = []int64{}
		}
		info.Items = append(info.Items, domain.ChecklistItemInfo{ID: it.ID, Text: it.Text, MarkedBy: by})
	}
	return info, nil
}
