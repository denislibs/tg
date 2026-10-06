package postgres_test

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// База ушла вперёд (применена последняя миграция), а одна из более ранних ещё
// не применена — так бывает, когда параллельные ветки держат разные диапазоны
// номеров и вливаются не по порядку. Migrate обязан её доприменить, а не
// падать «missing migrations».
func TestMigrate_AppliesMissingLowerVersion(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	var latest, missing int64
	if err := pool.QueryRow(ctx,
		`SELECT max(version_id) FROM goose_db_version WHERE is_applied`).Scan(&latest); err != nil {
		t.Fatal(err)
	}
	// «Пропускаем» предпоследнюю: снимаем её отметку, как если бы ветка с ней
	// влилась позже ветки с последней миграцией.
	if err := pool.QueryRow(ctx,
		`SELECT max(version_id) FROM goose_db_version WHERE is_applied AND version_id < $1`, latest).Scan(&missing); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM goose_db_version WHERE version_id = $1`, missing); err != nil {
		t.Fatal(err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("Migrate на базе с пропущенной миграцией %d (последняя %d): %v", missing, latest, err)
	}
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM goose_db_version WHERE version_id = $1 AND is_applied`, missing).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("пропущенная миграция %d не доприменена", missing)
	}
}
