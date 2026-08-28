package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0115 удаляет замороженные кадры правки СТАРОЙ формы (патч полей).
//
// Проверяется ровно граница: старая форма уходит, новая (конструктор) остаётся,
// и соседние типы кадров не задеты. Достраивать из патча целое сообщение нельзя
// честно — основание в докблоке миграции.
const editFrameMigrationPrevVersion = 114

func TestMigration0115_LegacyEditFramesRemoved(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, editFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", editFrameMigrationPrevVersion, err)
	}

	user := seedUser(t, pool, "+79990006001")

	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload) VALUES
		   ($1, 1, 'edit_message', jsonb_build_object('id', 12, 'peer_id', 5, 'message', 'старая форма')),
		   ($1, 2, 'edit_message', jsonb_build_object('_', 'updateEditMessage',
		        'message', jsonb_build_object('_', 'message', 'id', 13), 'pts_count', 1)),
		   ($1, 3, 'read',         jsonb_build_object('_', 'updateReadHistoryInbox'))`,
		user); err != nil {
		t.Fatalf("seed updates: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0115: %v", err)
	}

	var kept []int
	rows, err := pool.Query(ctx, `SELECT pts FROM updates ORDER BY pts`)
	if err != nil {
		t.Fatalf("выборка: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var pts int
		if err := rows.Scan(&pts); err != nil {
			t.Fatalf("скан: %v", err)
		}
		kept = append(kept, pts)
	}
	if len(kept) != 2 || kept[0] != 2 || kept[1] != 3 {
		t.Fatalf("осталось %v, want [2 3] — старый кадр правки должен уйти, новый и чужой остаться", kept)
	}
}
