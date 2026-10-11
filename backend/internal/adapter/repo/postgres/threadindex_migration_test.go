package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// 0165 снимает idx_messages_thread только при валидном
// idx_messages_thread_seq (0164); Down возвращает старый индекс.
func TestMigration0165_DropsOldThreadIndex(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()
	exists := func(name string) bool {
		t.Helper()
		var ok bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = $1 AND relkind = 'i')`, name).Scan(&ok); err != nil {
			t.Fatal(err)
		}
		return ok
	}
	if exists("idx_messages_thread") || !exists("idx_messages_thread_seq") {
		t.Fatalf("после наката: старый %v, новый %v; ждали только новый", exists("idx_messages_thread"), exists("idx_messages_thread_seq"))
	}
	if err := storepostgres.MigrateDownTo(url, 164); err != nil {
		t.Fatalf("откат 0165: %v", err)
	}
	if !exists("idx_messages_thread") {
		t.Fatal("Down 0165 не вернул idx_messages_thread")
	}
	// Без валидного нового индекса старый не снимается: миграция падает.
	if _, err := pool.Exec(ctx, `DROP INDEX idx_messages_thread_seq`); err != nil {
		t.Fatal(err)
	}
	if err := storepostgres.MigrateUpTo(url, 165); err == nil {
		t.Fatal("0165 прошла без idx_messages_thread_seq")
	}
	if !exists("idx_messages_thread") {
		t.Fatal("старый индекс снят без нового")
	}
}
