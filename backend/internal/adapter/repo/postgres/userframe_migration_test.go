package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0120 кладёт карточку ВНУТРЬ кадра: прежде кадр и его предмет были
// одним объектом (тело было самой карточкой), и отличить «кадр про карточку» от
// «карточка» было нечем, кроме колонки type.
const userFrameMigrationPrevVersion = 119

func TestMigration0120_UserFrameBecomesConstructor(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, userFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", userFrameMigrationPrevVersion, err)
	}

	user := seedUser(t, pool, "+79990011001")

	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload) VALUES
		   ($1, 1, 'user_update', jsonb_build_object('_', 'user', 'id', $1::bigint, 'first_name', 'Денис'))`,
		user); err != nil {
		t.Fatalf("seed update: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0120: %v", err)
	}

	var tag, inner, name string
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', payload->'user'->>'_', payload->'user'->>'first_name'
		   FROM updates WHERE pts = 1`).Scan(&tag, &inner, &name); err != nil {
		t.Fatalf("кадр: %v", err)
	}
	if tag != "updateUserSnapshot" || inner != "user" || name != "Денис" {
		t.Fatalf("кадр = %s/%s/%q", tag, inner, name)
	}

	// Круг Down → Up.
	if err := storepostgres.MigrateDownTo(url, userFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT payload->>'_' FROM updates WHERE pts = 1`).Scan(&tag); err != nil {
		t.Fatalf("после отката: %v", err)
	}
	if tag != "user" {
		t.Fatalf("после отката тело = %q; ждали саму карточку", tag)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT payload->>'_' FROM updates WHERE pts = 1`).Scan(&tag); err != nil {
		t.Fatalf("после круга: %v", err)
	}
	if tag != "updateUserSnapshot" {
		t.Fatalf("после круга Down→Up = %q", tag)
	}
}
