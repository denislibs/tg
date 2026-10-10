package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0163 переносит булев мьют темы в СРОК: «замьючено» становится
// «навсегда» (domain.MuteUntilForever), «нет» — отсутствием срока; старая
// колонка уходит. Повторный накат ничего не ломает.
func TestMigration0163_TopicMuteBecomesDeadline(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()
	if err := storepostgres.MigrateDownTo(url, 162); err != nil {
		t.Fatalf("откат до 162: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO topic_user_state (chat_id, root_msg_id, user_id, muted) VALUES (1, 10, 7, true), (1, 10, 8, false)`); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0163: %v", err)
	}
	var muted, unmuted *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT (SELECT muted_until FROM topic_user_state WHERE user_id=7),
		        (SELECT muted_until FROM topic_user_state WHERE user_id=8)`).Scan(&muted, &unmuted); err != nil {
		t.Fatal(err)
	}
	if muted == nil || muted.Unix() != domain.MuteUntilForever {
		t.Fatalf("замьюченная тема: срок %v, ждали «навсегда»", muted)
	}
	if unmuted != nil {
		t.Fatalf("незамьюченная тема получила срок %v", unmuted)
	}
	var hasMuted bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM information_schema.columns
		WHERE table_name='topic_user_state' AND column_name='muted')`).Scan(&hasMuted); err != nil || hasMuted {
		t.Fatalf("колонка muted осталась: %v, %v", hasMuted, err)
	}
}
